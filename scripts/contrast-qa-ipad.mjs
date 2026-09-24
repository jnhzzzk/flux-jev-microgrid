import { chromium } from "playwright";

const edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const connectedMode = process.env.QA_CONNECTED === "1";
const coldStartSelectors = [
  ".unified-workspace",
  ".workflow-strip",
  ".decision-stream",
  ".energy-workbench",
  ".dispatch-timeline",
  ".hour-rail",
  ".control-dock",
  ".measurement-grid",
  ".scenario-picker",
  ".soc-telemetry",
];
const browser = await chromium.launch({ executablePath: edgePath, headless: true });
const page = await browser.newPage({ viewport: { width: 1024, height: 768 }, deviceScaleFactor: 1 });

try {
  const apiCalls = [];
  const directJevCalls = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (request.method() === "POST" && url.pathname.startsWith("/api/")) apiCalls.push(url.pathname);
    if (url.hostname === "api.typesafe.ai") directJevCalls.push(url.href);
  });

  await page.goto("http://127.0.0.1:8787/", { waitUntil: "domcontentloaded" });
  await page.locator(".jev-start-gate").waitFor({ state: "visible", timeout: 30000 });
  await page.waitForFunction(() => {
    const action = document.querySelector(".jev-start-gate button");
    return Boolean(action && !action.hasAttribute("disabled"));
  }, undefined, { timeout: 30000 });

  const coldStart = await page.evaluate((operationalSelectors) => {
    const isVisible = (selector) => {
      const node = document.querySelector(selector);
      if (!node) return false;
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) > 0
        && rect.width > 0 && rect.height > 0;
    };
    return {
      gateVisible: isVisible(".jev-start-gate"),
      operationalSections: operationalSelectors.filter(isVisible),
      noHorizontalOverflow: document.documentElement.scrollWidth <= window.innerWidth,
    };
  }, coldStartSelectors);
  if (!coldStart.gateVisible || coldStart.operationalSections.length || !coldStart.noHorizontalOverflow) {
    throw new Error(`Cold-start presentation check failed: ${JSON.stringify(coldStart)}`);
  }
  if (apiCalls.length || directJevCalls.length) {
    throw new Error(`Cold start made an operational network request: ${[...apiCalls, ...directJevCalls].join(" → ")}`);
  }

  const inspectContrast = () => page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Canvas unavailable");

    function rgba(value) {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = value;
      context.fillRect(0, 0, 1, 1);
      return [...context.getImageData(0, 0, 1, 1).data].map((item, index) => index === 3 ? item / 255 : item);
    }

    function luminance([r, g, b]) {
      const linear = [r, g, b].map((value) => {
        const channel = value / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
    }

    function ratio(foreground, background) {
      const a = luminance(foreground);
      const b = luminance(background);
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    }

    function backgroundFor(element) {
      let current = element;
      while (current) {
        const color = rgba(getComputedStyle(current).backgroundColor);
        if (color[3] > 0.98) return color;
        current = current.parentElement;
      }
      return rgba(getComputedStyle(document.body).backgroundColor);
    }

    const failures = [];
    const samples = [];
    const elements = [...document.querySelectorAll("body *")];
    for (const element of elements) {
      if (!(element instanceof HTMLElement) && !(element instanceof SVGElement)) continue;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) < 0.5 || rect.width === 0 || rect.height === 0) continue;
      const hasOwnText = [...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim());
      if (!hasOwnText) continue;
      const foreground = rgba(style.color);
      const background = backgroundFor(element);
      const fontSize = Number.parseFloat(style.fontSize);
      const fontWeight = Number.parseInt(style.fontWeight, 10) || 400;
      const threshold = fontSize >= 24 || (fontSize >= 18.66 && fontWeight >= 700) ? 3 : 4.5;
      const contrast = ratio(foreground, background);
      const sample = {
        selector: `${element.tagName.toLowerCase()}.${[...element.classList].join(".")}`,
        text: element.textContent?.trim().slice(0, 45),
        contrast: Number(contrast.toFixed(2)),
        threshold,
      };
      samples.push(sample);
      if (contrast + 0.01 < threshold) failures.push(sample);
    }

    const root = getComputedStyle(document.documentElement);
    const focus = rgba(root.getPropertyValue("--color-focus"));
    const focusSurfaces = ["--color-paper", "--color-paper-2", "--color-surface"].map((token) => ({
      token,
      contrast: Number(ratio(focus, rgba(root.getPropertyValue(token))).toFixed(2)),
    }));
    return { checked: samples.length, failures, focusSurfaces };
  });

  const reports = [{ mode: "cold-start", ...await inspectContrast() }];
  await page.locator(".connection-action").click();
  await page.waitForTimeout(250);
  reports.push({ mode: "jev-connection-dialog", ...await inspectContrast() });
  const connectionDialog = page.getByRole("dialog", { name: "连接 Jev" });
  const apiKeyInput = connectionDialog.getByLabel("Jev API Key", { exact: true });
  if (await apiKeyInput.getAttribute("type") !== "password" || await apiKeyInput.inputValue()) {
    throw new Error("Cold-start Jev dialog must use an empty password field");
  }
  await connectionDialog.getByRole("button", { name: "关闭 Jev 连接", exact: true }).click();

  if (connectedMode) {
    const startDecision = page.getByRole("button", { name: "开始逐时决策", exact: true });
    if (!await startDecision.isVisible()) {
      throw new Error("QA_CONNECTED=1 requires a preconfigured Jev service and an explicit start action.");
    }
    await startDecision.click();
    await page.locator(".unified-workspace").waitFor({ state: "visible", timeout: 30000 });
    reports.push({ mode: "live", ...await inspectContrast() });
    await page.getByRole("button", { name: "开启 SOC 仿真调试", exact: true }).click();
    reports.push({ mode: "simulation", ...await inspectContrast() });
    await page.getByRole("button", { name: "退出 SOC 仿真调试", exact: true }).click();
    await page.getByRole("button", { name: "Jev 报文", exact: true }).click();
    await page.waitForTimeout(250);
    reports.push({ mode: "packet-dialog", ...await inspectContrast() });
    await page.getByRole("dialog", { name: "Jev 调度报文" })
      .getByRole("button", { name: "关闭 Jev 调度报文", exact: true }).click();
    await page.getByRole("button", { name: "管理 Jev 连接", exact: true }).click();
    await page.waitForTimeout(250);
    reports.push({ mode: "managed-jev-connection-dialog", ...await inspectContrast() });
    await page.getByRole("dialog", { name: "连接 Jev" })
      .getByRole("button", { name: "关闭 Jev 连接", exact: true }).click();
  }

  for (const report of reports) {
    const focusFailure = report.focusSurfaces.some((item) => item.contrast < 3);
    console.log(JSON.stringify({ page: connectedMode ? "connected" : "cold-start", ...report }));
    if (report.failures.length || focusFailure) throw new Error(`Contrast check failed in ${report.mode} mode`);
  }
} finally {
  await browser.close();
}
