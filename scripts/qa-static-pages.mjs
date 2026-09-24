import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { chromium } from "playwright";

const repoRoot = process.cwd();
const externalUrl = process.env.QA_URL?.trim();
const requestedPort = process.env.QA_PAGES_PORT ? Number(process.env.QA_PAGES_PORT) : null;
const viteCli = resolve(repoRoot, "node_modules", "vite", "bin", "vite.js");
const edgeCandidates = [
  process.env.PLAYWRIGHT_EXECUTABLE_PATH,
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
].filter(Boolean);

async function findAvailablePort() {
  if (requestedPort !== null) return requestedPort;
  const server = createServer();
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  await new Promise((resolveClose, rejectClose) => server.close((error) => error ? rejectClose(error) : resolveClose()));
  if (!address || typeof address === "string") throw new Error("Could not reserve an available port for the static preview.");
  return address.port;
}

const port = externalUrl ? null : await findAvailablePort();
const previewUrl = externalUrl ?? `http://127.0.0.1:${port}/`;

function findKeyShapedLiterals(directory) {
  const patterns = [
    /apikey_[a-z0-9]{24,}/gi,
    /sk-[a-z0-9_-]{24,}/gi,
  ];
  let matches = 0;

  function visit(current) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const target = resolve(current, entry.name);
      if (entry.isDirectory()) {
        visit(target);
        continue;
      }
      if (!/\.(?:html|js|css|map)$/i.test(entry.name)) continue;
      const text = readFileSync(target, "utf8");
      for (const pattern of patterns) matches += text.match(pattern)?.length ?? 0;
    }
  }

  visit(directory);
  return matches;
}

async function waitForServer(url, child) {
  const deadline = Date.now() + 15_000;
  let lastError = "";
  while (Date.now() < deadline) {
    if (child?.exitCode !== null) throw new Error(`Static preview exited before it was ready (${child.exitCode}).`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 150));
  }
  throw new Error(`Timed out waiting for static preview at ${url}: ${lastError}`);
}

function startPreview() {
  if (!existsSync(viteCli)) throw new Error("Vite is not installed. Run npm ci before qa:pages.");
  return spawn(process.execPath, [viteCli, "preview", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
    cwd: repoRoot,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
}

function formatUnsafeRequest(request) {
  const url = new URL(request.url());
  return `${request.method()} ${url.origin}${url.pathname}`;
}

async function assertResponsiveLayout(page, stage) {
  const viewports = [320, 375, 414, 768];
  for (const width of viewports) {
    await page.setViewportSize({ width, height: 834 });
    await page.waitForTimeout(80);
    const audit = await page.evaluate(() => {
      const root = document.documentElement;
      const body = document.body;
      const horizontalOverflow = Math.max(root.scrollWidth, body.scrollWidth) > window.innerWidth + 1;
      const wrappedControls = Array.from(document.querySelectorAll("button, [role='tab']"))
        .filter((control) => {
          const style = window.getComputedStyle(control);
          return style.display !== "none" && style.visibility !== "hidden" && control.getClientRects().length > 0;
        })
        .flatMap((control) => {
          const label = control.textContent?.replace(/\s+/g, " ").trim() ?? "";
          if (!label) return [];
          const walker = document.createTreeWalker(control, NodeFilter.SHOW_TEXT);
          const wrapped = [];
          let node = walker.nextNode();
          while (node) {
            if (node.textContent?.trim()) {
              const range = document.createRange();
              range.selectNodeContents(node);
              const lineCount = Array.from(range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0).length;
              const whiteSpace = window.getComputedStyle(node.parentElement).whiteSpace;
              if (lineCount > 1 && whiteSpace !== "nowrap") {
                wrapped.push(label);
                break;
              }
            }
            node = walker.nextNode();
          }
          return wrapped;
        });
      return { horizontalOverflow, wrappedControls };
    });
    if (audit.horizontalOverflow) throw new Error(`${stage} has horizontal overflow at ${width}px.`);
    if (audit.wrappedControls.length) {
      throw new Error(`${stage} has wrapped clickable labels at ${width}px: ${audit.wrappedControls.join(", ")}`);
    }
  }
  await page.setViewportSize({ width: 1194, height: 834 });
}

let previewProcess;
let browser;

try {
  if (!externalUrl) {
    const distDirectory = resolve(repoRoot, "dist");
    if (!existsSync(distDirectory)) throw new Error("Missing dist/. Run npm run build:pages before qa:pages.");
    const keyLiterals = findKeyShapedLiterals(distDirectory);
    if (keyLiterals) throw new Error(`Static bundle contains ${keyLiterals} key-shaped literal(s).`);
    previewProcess = startPreview();
    await waitForServer(previewUrl, previewProcess);
  }

  const executablePath = edgeCandidates.find((candidate) => existsSync(candidate));
  browser = await chromium.launch(executablePath ? { executablePath, headless: true } : { headless: true });
  const page = await browser.newPage({ viewport: { width: 1194, height: 834 }, deviceScaleFactor: 1 });
  const unsafeRequests = [];
  const pageErrors = [];

  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });

  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.includes("/api/") || url.hostname === "api.typesafe.ai") {
      unsafeRequests.push(formatUnsafeRequest(request));
    }
  });

  await page.goto(previewUrl, { waitUntil: "domcontentloaded" });
  const gate = page.locator(".jev-start-gate");
  try {
    await gate.waitFor({ state: "visible", timeout: 15_000 });
  } catch (error) {
    const rendered = await page.evaluate(() => ({
      title: document.title,
      root: document.getElementById("root")?.innerHTML.slice(0, 600) ?? "missing",
    }));
    throw new Error(`Static start gate did not render. Browser errors: ${pageErrors.join(" | ") || "none"}. Rendered: ${JSON.stringify(rendered)}`, { cause: error });
  }
  const startAction = gate.getByRole("button");
  await startAction.waitFor({ state: "visible" });
  const startLabel = (await startAction.innerText()).replace(/\s+/g, " ").trim();
  if (!/(?:开始|运行)\s*本地仿真/.test(startLabel)) {
    throw new Error(`Static start control must identify the local simulation path, received: ${startLabel}`);
  }
  if (await startAction.isDisabled()) throw new Error("Static local simulation start control is disabled.");

  if (await page.getByLabel("Jev API Key", { exact: true }).count()) {
    throw new Error("Static cold start rendered a Jev API Key field.");
  }
  await assertResponsiveLayout(page, "Static start gate");
  const connectionAction = page.locator(".connection-action");
  await connectionAction.click();
  const connectionDialog = page.locator(".jev-connection-dialog");
  await connectionDialog.waitFor({ state: "visible", timeout: 5_000 });
  if (await connectionDialog.locator("input").count()) {
    throw new Error("Static connection dialog rendered an input field.");
  }
  await page.keyboard.press("Escape");
  await connectionDialog.waitFor({ state: "hidden", timeout: 5_000 });

  await startAction.click();
  await page.locator(".unified-workspace").waitFor({ state: "visible", timeout: 15_000 });
  await page.waitForFunction(
    () => document.querySelectorAll('.workflow-step[data-state="done"]').length === 3,
    undefined,
    { timeout: 15_000 },
  );
  await page.waitForTimeout(350);

  const visibleCopy = await page.locator("body").innerText();
  if (!/本地仿真/.test(visibleCopy) || !/未调用\s*Jev/.test(visibleCopy)) {
    throw new Error("Static results do not clearly state that they are a local, non-Jev simulation.");
  }
  const misleadingStaticTerms = ["现场量测", "实测 SOC", "BMS 实测", "Jev 判断", "最终指令"];
  const misleadingStaticTerm = misleadingStaticTerms.find((term) => visibleCopy.includes(term));
  if (misleadingStaticTerm) {
    throw new Error(`Static results must not present local samples as live Jev/BMS data: ${misleadingStaticTerm}`);
  }
  await assertResponsiveLayout(page, "Static simulation result");

  const packetTrigger = page.getByRole("button", { name: "仿真数据", exact: true });
  await packetTrigger.click();
  const packetDialog = page.getByRole("dialog", { name: "本地仿真数据" });
  await packetDialog.waitFor({ state: "visible", timeout: 5_000 });
  if (!await packetDialog.getByRole("tab", { name: "样本输入", exact: true }).isVisible()) {
    throw new Error("Static packet dialog did not present sample input.");
  }
  const rulesOutputTab = packetDialog.getByRole("tab", { name: "规则输出", exact: true });
  await rulesOutputTab.click();
  if (
    await rulesOutputTab.getAttribute("aria-selected") !== "true"
    || !await packetDialog.getByRole("tabpanel").locator("pre").isVisible()
  ) {
    throw new Error("Static packet dialog did not present local rules output.");
  }
  await page.keyboard.press("Escape");
  await packetDialog.waitFor({ state: "hidden", timeout: 5_000 });

  if (unsafeRequests.length) {
    throw new Error(`Static Pages made an API request: ${unsafeRequests.join(" → ")}`);
  }

  console.log(JSON.stringify({
    url: previewUrl,
    staticStart: startLabel,
    apiKeyField: false,
    unsafeRequests: 0,
    workflowSteps: 3,
  }));
} finally {
  await browser?.close();
  previewProcess?.kill();
}
