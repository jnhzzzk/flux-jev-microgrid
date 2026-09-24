import express, { type NextFunction, type Request, type Response } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { AuthenticationError, PermissionDeniedError } from "@typesafe-ai/sdk";
import type {
  DispatchRequest,
  DispatchResponse,
  ForecastDispatchRequest,
  JevSessionInfo,
  JevSessionReceipt,
  MeasurementIngestRequest,
  ServiceStatus,
} from "../shared/contracts.js";
import { deriveRuleIntents, runDispatch, validateScenario } from "./dispatch.js";
import {
  acceptMeasurement,
  buildScenarioFromForecast,
  type StoredMeasurement,
} from "./inputs.js";
import { askJevForIntents, verifyJevApiKey } from "./jev.js";
import {
  JevSessionCapacityError,
  JevSessionStore,
} from "./jevSessions.js";
import { InMemoryRateLimiter, type RateLimitResult } from "./security.js";

const app = express();
const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "127.0.0.1";
const measurementStore = new Map<string, StoredMeasurement>();
const measurementTtlMs = 15 * 60 * 1000;
const sessionCallWindowMs = 15 * 60 * 1000;
const sessionCallLimit = readBoundedInteger("JEV_SESSION_MAX_CALLS", 20, 1, 50);
const connectionAttemptLimit = readBoundedInteger("JEV_CONNECTION_ATTEMPTS", 5, 1, 12);
const sessionStore = new JevSessionStore({
  absoluteTtlMs: readBoundedInteger("JEV_SESSION_TTL_MINUTES", 15, 1, 15) * 60 * 1000,
  idleTtlMs: readBoundedInteger("JEV_SESSION_IDLE_MINUTES", 5, 1, 5) * 60 * 1000,
  maxSessions: readBoundedInteger("JEV_MAX_ACTIVE_SESSIONS", 64, 1, 256),
});
const rateLimiter = new InMemoryRateLimiter();
const allowedOrigins = parseAllowedOrigins(process.env.CORS_ALLOWED_ORIGINS);
// Production must opt in before an API may spend the deployer's credential.
// Local development preserves the existing environment-key workflow by default.
const allowEnvironmentKey = process.env.JEV_ALLOW_ENVIRONMENT_KEY === "true"
  || (process.env.JEV_ALLOW_ENVIRONMENT_KEY === undefined && process.env.NODE_ENV !== "production");

app.disable("x-powered-by");
if (process.env.TRUST_PROXY === "1") {
  app.set("trust proxy", 1);
}

app.use((request, response, next) => {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  next();
});

app.use("/api", (request, response, next) => {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  response.setHeader("Pragma", "no-cache");
  response.setHeader("Expires", "0");
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
  );

  const origin = request.get("origin");
  if (origin && !isAllowedOrigin(request, origin)) {
    response.status(403).json({ error: "不允许的请求来源" });
    return;
  }

  if (origin) {
    response.vary("Origin");
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Jev-Session");
    response.setHeader("Access-Control-Max-Age", "600");
  }

  if (request.method === "OPTIONS") {
    response.status(204).end();
    return;
  }
  next();
});

// The credential route is deliberately parsed under a much smaller body cap;
// forecast payloads still need the broader limit below.
app.use("/api/jev/session", express.json({ limit: "1kb" }));
app.use(express.json({ limit: "1mb" }));

// Never let malformed JSON echo a request body that might have contained a key.
app.use((error: unknown, request: Request, response: Response, next: NextFunction) => {
  if (request.path.startsWith("/api")) {
    const status = isPayloadTooLarge(error) ? 413 : 400;
    response.status(status).json({
      error: status === 413 ? "请求体过大" : "请求格式不正确",
    });
    return;
  }
  next(error);
});

app.get("/api/status", (request, response) => {
  const credential = resolveJevCredential(request);
  if (credential.kind === "invalid-session") {
    respondInvalidSession(response);
    return;
  }

  const status: ServiceStatus = {
    ready: true,
    jevConfigured: credential.kind !== "none",
    defaultModel: "jev-latest",
    jevSession: toSessionInfo(credential),
  };
  response.json(status);
});

app.get("/api/jev/session", (request, response) => {
  const credential = resolveJevCredential(request);
  if (credential.kind === "invalid-session") {
    respondInvalidSession(response);
    return;
  }
  response.json(toSessionInfo(credential));
});

app.post("/api/jev/session", async (request, response) => {
  if (process.env.NODE_ENV === "production" && !request.secure) {
    response.status(400).json({ error: "生产环境仅允许通过 HTTPS 连接 Jev" });
    return;
  }

  const attempt = rateLimiter.consume(
    `connect:${requestIdentity(request)}`,
    connectionAttemptLimit,
    15 * 60 * 1000,
  );
  if (!attempt.allowed) {
    respondRateLimited(response, attempt);
    return;
  }

  let apiKey = parseApiKey(request.body);
  if (!apiKey) {
    response.status(400).json({ error: "请输入有效的 Jev API Key" });
    return;
  }

  try {
    await verifyJevApiKey(apiKey);
    const session = sessionStore.create(apiKey);
    const receipt: JevSessionReceipt = {
      connectionToken: session.token,
      expiresAt: session.expiresAt.toISOString(),
      remainingCalls: sessionCallLimit,
      source: "session",
    };
    response.status(201).json(receipt);
  } catch (error) {
    if (error instanceof JevSessionCapacityError) {
      response.status(503).json({ error: "当前临时连接较多，请稍后重试" });
      return;
    }
    // Provider error details can include request metadata. They must never reach
    // a browser while a credential is being verified.
    response.status(401).json({ error: "无法验证该 Jev API Key，请确认后重试" });
  } finally {
    // The session store retains the original value only after a successful
    // connection. This local reference is not kept by the request handler.
    apiKey = "";
  }
});

app.delete("/api/jev/session", (request, response) => {
  // Idempotent deletion avoids distinguishing an expired token from one that
  // never existed. It never affects a server environment credential.
  sessionStore.revoke(request.get("x-jev-session"));
  response.status(204).end();
});

async function computeDispatch(
  scenario: DispatchRequest["scenario"],
  useJev: boolean,
  credential: ResolvedJevCredential,
  measurement?: StoredMeasurement,
): Promise<DispatchResponse> {
  const startedAt = Date.now();
  validateScenario(scenario);

  let source: "jev" | "rules" = "rules";
  let model = "deterministic-baseline";
  let warning: string | undefined;
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;
  let jevTrace: DispatchResponse["jevTrace"];
  let intents = deriveRuleIntents(scenario);

  if (useJev) {
    if (credential.kind === "none") {
      warning = allowEnvironmentKey
        ? "服务端未读取到 TYPESAFE_API_KEY，已自动切换为本地基准策略。"
        : "Jev 尚未连接，已自动切换为本地基准策略。";
    } else if (credential.kind !== "invalid-session") {
      try {
        const jevResult = await askJevForIntents(scenario, measurement, credential.apiKey);
        intents = jevResult.intents;
        source = "jev";
        model = jevResult.model;
        inputTokens = jevResult.inputTokens;
        outputTokens = jevResult.outputTokens;
        jevTrace = jevResult.trace;
      } catch (error) {
        if (
          credential.kind === "session"
          && (error instanceof AuthenticationError || error instanceof PermissionDeniedError)
        ) {
          // A rejected browser credential is no longer useful and should not
          // remain callable for the rest of its nominal lifetime.
          sessionStore.revoke(credential.token);
          warning = "Jev 临时连接已失效，已回退本地基准策略。";
        } else {
          warning = "Jev 调用暂不可用，已回退本地基准策略。";
        }
        // Do not expose provider errors or diagnostic request details to the UI.
      }
    }
  }

  const result = runDispatch(scenario, intents);
  return {
    ...result,
    jevTrace,
    meta: {
      source,
      model,
      generatedAt: new Date().toISOString(),
      latencyMs: Date.now() - startedAt,
      inputTokens,
      outputTokens,
      warning,
    },
  };
}

app.post("/api/measurements", (request, response) => {
  try {
    const body = request.body as MeasurementIngestRequest;
    const { stored, receipt } = acceptMeasurement(body);
    measurementStore.set(stored.measurementId, stored);
    response.status(202).json(receipt);
  } catch (error) {
    const message = error instanceof Error ? error.message : "量测入库失败";
    response.status(400).json({ error: message });
  }
});

app.post("/api/dispatch/forecast", async (request, response) => {
  try {
    const body = request.body as ForecastDispatchRequest;
    if (!body.measurementId?.trim()) {
      response.status(400).json({ error: "缺少 measurementId" });
      return;
    }
    const measurement = measurementStore.get(body.measurementId);
    if (!measurement) {
      response.status(404).json({ error: "measurementId 不存在或服务已重启" });
      return;
    }
    if (Date.now() - Date.parse(measurement.receivedAt) > measurementTtlMs) {
      measurementStore.delete(body.measurementId);
      response.status(409).json({ error: "量测已超过 15 分钟，请先提交新量测" });
      return;
    }

    const credential = resolveDispatchCredential(request, Boolean(body.useJev), response);
    if (!credential) {
      return;
    }
    const scenario = buildScenarioFromForecast(measurement, body);
    const payload = await computeDispatch(scenario, body.useJev, credential, measurement);
    payload.meta.measurementId = measurement.measurementId;
    payload.meta.forecastId = body.forecast.forecastId;
    response.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "预测调度失败";
    response.status(400).json({ error: message });
  }
});

app.post("/api/dispatch", async (request, response) => {
  try {
    const body = request.body as Partial<DispatchRequest>;
    if (!body.scenario) {
      response.status(400).json({ error: "缺少 scenario" });
      return;
    }
    const useJev = Boolean(body.useJev);
    const credential = resolveDispatchCredential(request, useJev, response);
    if (!credential) {
      return;
    }
    const payload = await computeDispatch(body.scenario, useJev, credential);
    response.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "调度失败";
    response.status(400).json({ error: message });
  }
});

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const staticDirectory = path.resolve(currentDirectory, "../../dist");
if (existsSync(staticDirectory)) {
  app.use(express.static(staticDirectory));
  app.use((request, response, next) => {
    if (request.method === "GET" && request.accepts("html")) {
      response.sendFile(path.join(staticDirectory, "index.html"));
      return;
    }
    next();
  });
}

// Last-resort API error boundary: provider and request details are never sent
// to a browser, even if a future route forgets to classify an exception.
app.use((error: unknown, request: Request, response: Response, next: NextFunction) => {
  if (request.path.startsWith("/api") && !response.headersSent) {
    response.status(500).json({ error: "服务暂不可用，请稍后重试" });
    return;
  }
  next(error);
});

app.listen(port, host, () => {
  console.log(`Flux microgrid API listening on http://${host}:${port}`);
});

interface SessionCredential {
  kind: "session";
  apiKey: string;
  token: string;
  expiresAt: Date;
}

interface EnvironmentCredential {
  kind: "environment";
  apiKey: string;
}

interface NoCredential {
  kind: "none";
}

interface InvalidSessionCredential {
  kind: "invalid-session";
}

type ResolvedJevCredential =
  | SessionCredential
  | EnvironmentCredential
  | NoCredential
  | InvalidSessionCredential;

function resolveJevCredential(request: Request): ResolvedJevCredential {
  // Presence, rather than truthiness, is intentional: an empty, tampered, or
  // expired session header must never fall through to TYPESAFE_API_KEY.
  const sessionHeader = request.get("x-jev-session");
  if (sessionHeader !== undefined) {
    const resolved = sessionStore.resolve(sessionHeader);
    if (resolved.state === "active") {
      return {
        kind: "session",
        apiKey: resolved.apiKey,
        token: sessionHeader,
        expiresAt: resolved.expiresAt,
      };
    }
    return { kind: "invalid-session" };
  }

  const environmentKey = environmentApiKey();
  if (environmentKey) {
    return { kind: "environment", apiKey: environmentKey };
  }
  return { kind: "none" };
}

function resolveDispatchCredential(
  request: Request,
  useJev: boolean,
  response: Response,
): ResolvedJevCredential | null {
  const hasSessionHeader = request.get("x-jev-session") !== undefined;
  const credential: ResolvedJevCredential = hasSessionHeader || useJev
    ? resolveJevCredential(request)
    : { kind: "none" };
  if (credential.kind === "invalid-session") {
    respondInvalidSession(response);
    return null;
  }
  if (!useJev || credential.kind === "none") {
    return { kind: "none" };
  }

  const bucket = credential.kind === "session"
    ? `dispatch:session:${credential.token}`
    : `dispatch:${requestIdentity(request)}`;
  const limit = credential.kind === "environment" ? 12 : sessionCallLimit;
  const rate = rateLimiter.consume(bucket, limit, sessionCallWindowMs);
  if (!rate.allowed) {
    respondRateLimited(response, rate);
    return null;
  }

  return credential;
}

function toSessionInfo(credential: ResolvedJevCredential): JevSessionInfo {
  if (credential.kind === "session") {
    return {
      active: true,
      source: "session",
      expiresAt: credential.expiresAt.toISOString(),
      remainingCalls: rateLimiter.remaining(
        `dispatch:session:${credential.token}`,
        sessionCallLimit,
        sessionCallWindowMs,
      ),
    };
  }
  if (credential.kind === "environment") {
    return { active: true, source: "environment" };
  }
  return { active: false, source: "none" };
}

function respondInvalidSession(response: Response): void {
  response.status(401).json({
    code: "jev_session_expired",
    error: "Jev 临时连接已过期或无效，请重新连接。",
  });
}

function respondRateLimited(response: Response, result: RateLimitResult): void {
  response.setHeader("Retry-After", String(result.retryAfterSeconds));
  response.status(429).json({
    code: "jev_rate_limited",
    error: "请求过于频繁，请稍后重试。",
  });
}

function parseApiKey(body: unknown): string | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return null;
  }
  const candidate = (body as Record<string, unknown>).apiKey;
  if (typeof candidate !== "string") {
    return null;
  }
  if (
    candidate.length < 16
    || candidate.length > 512
    || candidate.trim() !== candidate
    || /[\u0000-\u001F\u007F]/.test(candidate)
  ) {
    return null;
  }
  return candidate;
}

function isPayloadTooLarge(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === "object"
    && "status" in error
    && (error as { status?: unknown }).status === 413,
  );
}

function environmentApiKey(): string | undefined {
  if (!allowEnvironmentKey) {
    return undefined;
  }
  const value = process.env.TYPESAFE_API_KEY?.trim();
  return value || undefined;
}

function requestIdentity(request: Request): string {
  return request.ip || request.socket.remoteAddress || "unknown";
}

function readBoundedInteger(name: string, fallback: number, min: number, max: number): number {
  const configured = Number.parseInt(process.env[name] ?? "", 10);
  if (!Number.isSafeInteger(configured)) {
    return fallback;
  }
  return Math.max(min, Math.min(configured, max));
}

function parseAllowedOrigins(value: string | undefined): Set<string> {
  const origins = new Set<string>();
  if (!value?.trim()) {
    if (process.env.NODE_ENV !== "production") {
      origins.add("http://127.0.0.1:5173");
      origins.add("http://localhost:5173");
    }
    return origins;
  }

  for (const candidate of value.split(",")) {
    const trimmed = candidate.trim();
    if (!trimmed) {
      continue;
    }
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      throw new Error("CORS_ALLOWED_ORIGINS contains an invalid origin");
    }
    if (
      (parsed.protocol !== "https:" && parsed.protocol !== "http:")
      || parsed.origin !== trimmed
    ) {
      throw new Error("CORS_ALLOWED_ORIGINS entries must be absolute origins without paths");
    }
    origins.add(parsed.origin);
  }
  return origins;
}

function isAllowedOrigin(request: Request, origin: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (parsed.origin !== origin) {
    return false;
  }

  const host = request.get("host");
  const sameOrigin = host ? `${request.protocol}://${host}` : undefined;
  return origin === sameOrigin || allowedOrigins.has(origin);
}
