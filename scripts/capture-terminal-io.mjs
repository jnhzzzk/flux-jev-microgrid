import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const measurementEndpoint = "http://127.0.0.1:8787/api/measurements";
const forecastEndpoint = "http://127.0.0.1:8787/api/dispatch/forecast";
const edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

const capturedAt = new Date();
const horizonStart = new Date(capturedAt);
horizonStart.setUTCMinutes(0, 0, 0);
horizonStart.setUTCHours(horizonStart.getUTCHours() + 1);

const measurementPayload = {
  siteId: "binhai-microgrid",
  measuredAt: capturedAt.toISOString(),
  sequence: Math.floor(capturedAt.getTime() / 1000),
  values: {
    loadKW: 149,
    solarKW: 205,
    gridPowerKW: -56,
    batteryPowerKW: 0,
    batterySocPercent: 46,
  },
};

function makeForecastPayload(measurementId, issuedAt) {
  return {
    siteId: "binhai-microgrid",
    measurementId,
    useJev: true,
    forecast: {
      forecastId: `fc-${issuedAt.replace(/\D/g, "").slice(0, 14)}`,
      issuedAt,
      horizonStart: horizonStart.toISOString(),
      resolutionMinutes: 60,
    loadKW: [76, 72, 69, 68, 70, 82, 108, 148, 172, 166, 154, 149, 152, 148, 151, 160, 178, 212, 236, 248, 231, 202, 154, 108],
    solarKW: [0, 0, 0, 0, 0, 4, 20, 55, 98, 142, 181, 205, 218, 210, 184, 143, 92, 41, 10, 0, 0, 0, 0, 0],
    tariffCnyPerKWh: [0.31, 0.31, 0.31, 0.31, 0.31, 0.34, 0.42, 0.68, 0.78, 0.78, 0.56, 0.52, 0.52, 0.52, 0.56, 0.62, 0.76, 0.92, 1.18, 1.18, 1.18, 1.05, 0.72, 0.42],
    },
  };
}

function redact(value) {
  return value.replace(/apikey_[a-z0-9_]+/gi, "[REDACTED]");
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function formatMeasurement(request) {
  return `{
  "siteId": ${JSON.stringify(request.siteId)},
  "measuredAt": ${JSON.stringify(request.measuredAt)},
  "sequence": ${request.sequence},
  "values": ${JSON.stringify(request.values)}
}`;
}

function formatForecast(request) {
  return `{
  "siteId": ${JSON.stringify(request.siteId)},
  "measurementId": ${JSON.stringify(request.measurementId)},
  "useJev": ${request.useJev},
  "forecast": {
    "forecastId": ${JSON.stringify(request.forecast.forecastId)},
    "issuedAt": ${JSON.stringify(request.forecast.issuedAt)},
    "horizonStart": ${JSON.stringify(request.forecast.horizonStart)},
    "resolutionMinutes": ${request.forecast.resolutionMinutes},
    "loadKW": ${JSON.stringify(request.forecast.loadKW)},
    "solarKW": ${JSON.stringify(request.forecast.solarKW)},
    "tariffCnyPerKWh": ${JSON.stringify(request.forecast.tariffCnyPerKWh)}
  }
}`;
}

function terminalDocument({ title, prompt, label, meta, content }) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    html, body { margin: 0; background: #0d1117; }
    body {
      width: 1400px;
      padding: 44px 52px 56px;
      color: #d8dee9;
      font-family: "Cascadia Mono", "JetBrains Mono", Consolas, monospace;
      font-size: 18px;
      line-height: 1.56;
    }
    .topline { display: flex; justify-content: space-between; gap: 24px; padding-bottom: 18px; border-bottom: 1px solid #30363d; }
    .topline strong { color: #f0f6fc; font-size: 21px; }
    .topline span { color: #8b949e; }
    .prompt { margin: 28px 0 20px; color: #79c0ff; }
    .prompt b { color: #3fb950; font-weight: 600; }
    .label { margin-bottom: 12px; color: #d2a8ff; font-weight: 700; }
    .meta { margin-bottom: 18px; color: #8b949e; }
    pre { margin: 0; color: #e6edf3; white-space: pre-wrap; overflow-wrap: anywhere; tab-size: 2; }
    .accent { color: #58a6ff; }
  </style>
</head>
<body>
  <div class="topline"><strong>${escapeHtml(title)}</strong><span>Flux Control · local terminal capture</span></div>
  <div class="prompt"><b>PS</b> C:\\Users\\zekunzhang\\Documents\\Jev&gt; ${escapeHtml(prompt)}</div>
  <div class="label">${escapeHtml(label)}</div>
  <div class="meta">${escapeHtml(meta)}</div>
  <pre>${escapeHtml(redact(content))}</pre>
</body>
</html>`;
}

await mkdir("artifacts", { recursive: true });

const measurementResponse = await fetch(measurementEndpoint, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(measurementPayload),
});
const receipt = await measurementResponse.json();

if (!measurementResponse.ok) {
  throw new Error(`Measurement ingest failed (${measurementResponse.status}): ${JSON.stringify(receipt)}`);
}

const forecastPayload = makeForecastPayload(receipt.measurementId, new Date().toISOString());
const dispatchResponse = await fetch(forecastEndpoint, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(forecastPayload),
});
const result = await dispatchResponse.json();

if (!dispatchResponse.ok) {
  throw new Error(`Forecast dispatch failed (${dispatchResponse.status}): ${JSON.stringify(result)}`);
}

const responseView = {
  meta: result.meta,
  summary: result.summary,
  scheduleCount: result.schedule.length,
  scheduleExcerpt: result.schedule.filter((item) => [12, 18].includes(item.hour)),
  note: "截图展示 12:00 与 18:00；完整响应文件包含全部 24 个时段。",
};

const stagedInput = {
  step1Measurement: measurementPayload,
  measurementReceipt: receipt,
  step2Forecast: forecastPayload,
};
await writeFile("artifacts/microgrid-measurement.json", `${redact(JSON.stringify(measurementPayload, null, 2))}\n`, "utf8");
await writeFile("artifacts/microgrid-forecast-request.json", `${redact(JSON.stringify(forecastPayload, null, 2))}\n`, "utf8");
await writeFile("artifacts/microgrid-dispatch-request.json", `${redact(JSON.stringify(stagedInput, null, 2))}\n`, "utf8");
await writeFile("artifacts/microgrid-dispatch-response.json", `${redact(JSON.stringify(result, null, 2))}\n`, "utf8");

const stagedTranscript = `[1/2 · 量测入库] POST /api/measurements
${formatMeasurement(measurementPayload)}

[ACK] HTTP ${measurementResponse.status} ${measurementResponse.statusText}
${JSON.stringify(receipt, null, 2)}

[2/2 · 预测触发调度] POST /api/dispatch/forecast
${formatForecast(forecastPayload)}`;

const browser = await chromium.launch({ executablePath: edgePath, headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
  await page.setContent(terminalDocument({
    title: "微电网储能充放电 · 分阶段输入报文",
    prompt: "node scripts\\capture-terminal-io.mjs",
    label: "[INPUT FLOW] 实时量测 → measurementId → 滚动预测",
    meta: "先测量，后预测 · 第二步只引用 measurementId · API key 不进入请求体",
    content: stagedTranscript,
  }));
  await page.screenshot({ path: "artifacts/microgrid-terminal-request.png", fullPage: true });

  await page.setContent(terminalDocument({
    title: "微电网储能充放电 · 输出报文",
    prompt: "node scripts\\capture-terminal-io.mjs",
    label: `[RESPONSE] HTTP ${dispatchResponse.status} ${dispatchResponse.statusText}`,
    meta: `measurement=${result.meta.measurementId} · forecast=${result.meta.forecastId} · source=${result.meta.source} · model=${result.meta.model} · latency=${result.meta.latencyMs} ms`,
    content: JSON.stringify(responseView, null, 2),
  }));
  await page.screenshot({ path: "artifacts/microgrid-terminal-response.png", fullPage: true });
} finally {
  await browser.close();
}

console.log(JSON.stringify({
  request: "artifacts/microgrid-terminal-request.png",
  response: "artifacts/microgrid-terminal-response.png",
  measurementId: result.meta.measurementId,
  forecastId: result.meta.forecastId,
  source: result.meta.source,
  model: result.meta.model,
  scheduleCount: result.schedule.length,
}));
