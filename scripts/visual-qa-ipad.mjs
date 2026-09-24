import { chromium } from "playwright";

const edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const cases = [
  { width: 320, height: 700 },
  { width: 375, height: 812 },
  { width: 414, height: 896 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768, inspect: true },
  { width: 1194, height: 834, hero: true },
].filter((item) => !process.env.QA_WIDTH || item.width === Number(process.env.QA_WIDTH));
const connectedMode = process.env.QA_CONNECTED === "1";
const coldStartSelectors = [
  ".unified-workspace",
  ".workflow-strip",
  ".decision-stream",
  ".stream-feed",
  ".stream-command",
  ".energy-workbench",
  ".dispatch-timeline",
  ".hour-rail",
  ".control-dock",
  ".measurement-grid",
  ".scenario-picker",
  ".soc-telemetry",
];

async function assertColdStart(page, { width, apiCalls }) {
  const gate = page.locator(".jev-start-gate");
  await gate.waitFor({ state: "visible", timeout: 30000 });
  await page.waitForFunction(() => {
    const action = document.querySelector(".jev-start-gate button");
    return Boolean(action && !action.hasAttribute("disabled"));
  }, undefined, { timeout: 30000 });

  const metrics = await page.evaluate((operationalSelectors) => {
    const isVisible = (selector) => {
      const node = document.querySelector(selector);
      if (!node) return false;
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) > 0
        && rect.width > 0 && rect.height > 0;
    };
    const gateNode = document.querySelector(".jev-start-gate");
    const connectionAction = document.querySelector(".connection-action");
    return {
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      noHorizontalOverflow: document.documentElement.scrollWidth <= window.innerWidth,
      gateVisible: isVisible(".jev-start-gate"),
      operationalSections: operationalSelectors.filter(isVisible),
      connectionActionVisible: isVisible(".connection-action"),
      connectionActionNoWrap: (() => {
        if (!(connectionAction instanceof HTMLElement)) return false;
        const style = getComputedStyle(connectionAction);
        return style.whiteSpace === "nowrap" && connectionAction.scrollHeight <= connectionAction.clientHeight + 2;
      })(),
      gateCopy: gateNode?.textContent?.replace(/\s+/g, " ").trim() ?? "",
    };
  }, coldStartSelectors);

  console.log(JSON.stringify({ width, metrics, phase: "cold-start" }));
  if (!metrics.noHorizontalOverflow) throw new Error(`Horizontal overflow in cold start at ${width}px`);
  if (!metrics.gateVisible) throw new Error(`Jev cold-start gate is not visible at ${width}px`);
  if (metrics.operationalSections.length) {
    throw new Error(`Operational configuration or results leaked into cold start at ${width}px: ${metrics.operationalSections.join(", ")}`);
  }
  if (!metrics.connectionActionVisible || !metrics.connectionActionNoWrap) {
    throw new Error(`Jev connection entry is not usable in cold start at ${width}px`);
  }
  if (apiCalls.length) {
    throw new Error(`Cold start must not invoke measurement, forecast, or dispatch APIs: ${apiCalls.join(" → ")}`);
  }

  const connectionTrigger = page.locator(".connection-action");
  await connectionTrigger.click();
  const connectionDialog = page.getByRole("dialog", { name: "连接 Jev" });
  if (!await connectionDialog.isVisible()) throw new Error("Jev connection dialog did not open from cold start");
  const apiKeyInput = connectionDialog.getByLabel("Jev API Key", { exact: true });
  if (await apiKeyInput.getAttribute("type") !== "password" || await apiKeyInput.getAttribute("autocomplete") !== "off") {
    throw new Error("Jev key input is not a write-only password field in cold start");
  }
  if (await apiKeyInput.inputValue()) throw new Error("Cold-start Jev key field is unexpectedly prefilled");
  const focusInDialog = await page.evaluate(() => document.activeElement?.closest(".jev-connection-dialog") !== null);
  if (!focusInDialog) throw new Error("Jev connection dialog did not move focus into the modal in cold start");
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.querySelector(".jev-connection-dialog")?.hasAttribute("open"));
  const focusRestored = await page.evaluate(() => document.activeElement === document.querySelector(".connection-action"));
  if (!focusRestored) throw new Error("Jev connection dialog did not restore focus in cold start");

  return metrics;
}

const browser = await chromium.launch({ executablePath: edgePath, headless: true });

try {
  for (const item of cases) {
    const page = await browser.newPage({
      viewport: { width: item.width, height: item.height },
      deviceScaleFactor: 1,
      isMobile: item.width < 768,
      hasTouch: true,
    });
    const apiCalls = [];
    const directJevCalls = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (request.method() === "POST" && url.pathname.startsWith("/api/")) apiCalls.push(url.pathname);
      if (url.hostname === "api.typesafe.ai") directJevCalls.push(url.href);
    });

    await page.goto("http://127.0.0.1:8787/", { waitUntil: "domcontentloaded" });
    const coldStart = await assertColdStart(page, { width: item.width, apiCalls });

    if (!connectedMode) {
      const visibleCopy = await page.locator("body").innerText();
      if (/demo|演示/i.test(visibleCopy)) throw new Error("Forbidden Demo wording is visible");
      if (directJevCalls.length) throw new Error(`Browser called Jev directly: ${directJevCalls.join(", ")}`);
      const output = item.hero ? "artifacts/flux-ipad-start-gate.png" : `artifacts/qa-ipad-start-gate-${item.width}.png`;
      await page.screenshot({ path: output, fullPage: false });
      console.log(JSON.stringify({ width: item.width, coldStart, output, mode: "cold-start" }));
      await page.close();
      continue;
    }

    const startDecision = page.getByRole("button", { name: "开始逐时决策", exact: true });
    if (!await startDecision.isVisible()) {
      throw new Error("QA_CONNECTED=1 requires a preconfigured Jev service, then the cold-start gate should offer \"开始逐时决策\".");
    }
    await startDecision.click();
    await page.locator(".unified-workspace").waitFor({ state: "visible", timeout: 30000 });
    await page.waitForFunction(() => document.querySelectorAll('.workflow-step[data-state="done"]').length === 3);

    const metrics = await page.evaluate(() => {
      const content = document.querySelector(".tablet-content");
      const workspace = document.querySelector(".unified-workspace");
      const decision = document.querySelector(".decision-pane");
      const control = document.querySelector(".control-dock");
      const evidence = document.querySelector(".energy-workbench");
      const hourRail = document.querySelector(".hour-rail");
      const hourCells = [...document.querySelectorAll(".hour-rail [role='tab']")];
      const rect = workspace?.getBoundingClientRect();
      return {
        viewportWidth: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        noHorizontalOverflow: document.documentElement.scrollWidth <= window.innerWidth,
        contentHeight: content?.clientHeight ?? 0,
        contentScrollHeight: content?.scrollHeight ?? 0,
        workspaceHeight: workspace?.scrollHeight ?? 0,
        workspaceClientHeight: workspace?.clientHeight ?? 0,
        decisionHeight: decision?.clientHeight ?? 0,
        decisionScrollHeight: decision?.scrollHeight ?? 0,
        controlHeight: control?.clientHeight ?? 0,
        controlScrollHeight: control?.scrollHeight ?? 0,
        workspaceBottom: rect?.bottom ?? 0,
        oneScreen: window.innerWidth < 768 || Boolean(
          rect && rect.bottom <= window.innerHeight + 2
          && (content?.scrollHeight ?? 0) <= (content?.clientHeight ?? 0) + 2
          && (decision?.scrollHeight ?? 0) <= (decision?.clientHeight ?? 0) + 2
          && (control?.scrollHeight ?? 0) <= (control?.clientHeight ?? 0) + 2
        ),
        noSideNavigation: !document.querySelector(".side-rail") && !document.querySelector('[role="tablist"][aria-label="主要导航"]'),
        sectionsVisible: [".decision-stream", ".stream-feed", ".stream-command", ".energy-workbench", ".dispatch-timeline", ".hour-rail", ".control-dock", ".soc-telemetry"]
          .every((selector) => {
            const node = document.querySelector(selector);
            if (!node) return false;
            const box = node.getBoundingClientRect();
            return box.width > 0 && box.height > 0;
          }),
        selectedHour: document.querySelector(".hour-rail button.is-selected")?.getAttribute("data-hour"),
        hourRailCellCount: hourCells.length,
        hourRailNoScroll: Boolean(
          hourRail
          && hourRail.scrollWidth <= hourRail.clientWidth + 2
          && hourRail.scrollHeight <= hourRail.clientHeight + 2
        ),
        hourRailCellsVisible: Boolean(hourRail) && hourCells.every((cell) => {
          const cellRect = cell.getBoundingClientRect();
          const railRect = hourRail.getBoundingClientRect();
          return cellRect.width > 0 && cellRect.height > 0
            && cellRect.left >= railRect.left - 1
            && cellRect.right <= railRect.right + 1
            && cellRect.top >= railRect.top - 1
            && cellRect.bottom <= railRect.bottom + 1;
        }),
        evidenceNoClip: Boolean(evidence) && evidence.scrollHeight <= evidence.clientHeight + 2,
        evidenceInViewport: window.innerWidth < 768 || Boolean(evidence && hourRail) && (() => {
          const evidenceRect = evidence.getBoundingClientRect();
          const railRect = hourRail.getBoundingClientRect();
          const metricRect = document.querySelector(".energy-workbench .metric-ribbon")?.getBoundingClientRect();
          return evidenceRect.top >= 0
            && evidenceRect.bottom <= window.innerHeight + 2
            && railRect.bottom <= evidenceRect.bottom + 1
            && (!metricRect || metricRect.bottom <= evidenceRect.bottom + 1)
            && hourCells.every((cell) => cell.getBoundingClientRect().bottom <= evidenceRect.bottom + 1);
        })(),
        workflowDone: document.querySelectorAll('.workflow-step[data-state="done"]').length,
        connectionActionNoWrap: (() => {
          const button = document.querySelector(".connection-action");
          if (!button) return false;
          const style = getComputedStyle(button);
          return style.whiteSpace === "nowrap" && button.scrollHeight <= button.clientHeight + 2;
        })(),
      };
    });

    console.log(JSON.stringify({ width: item.width, metrics, phase: "layout-check" }));
    if (!metrics.noHorizontalOverflow) throw new Error(`Horizontal overflow at ${item.width}px`);
    if (!metrics.noSideNavigation) throw new Error(`Side navigation is still present at ${item.width}px`);
    if (!metrics.sectionsVisible) throw new Error(`Unified sections are not visible at ${item.width}px`);
    if (!metrics.connectionActionNoWrap) throw new Error(`Jev connection entry wraps at ${item.width}px`);
    if (!metrics.oneScreen) throw new Error(`iPad workspace does not fit one screen at ${item.width}px`);
    if (metrics.hourRailCellCount !== 24 || !metrics.hourRailNoScroll || !metrics.hourRailCellsVisible || !metrics.evidenceNoClip || !metrics.evidenceInViewport) {
      throw new Error(`24-hour rail is not fully visible without scrolling at ${item.width}px: ${JSON.stringify(metrics)}`);
    }
    if (apiCalls[0] !== "/api/measurements" || apiCalls[1] !== "/api/dispatch/forecast") {
      throw new Error(`Initial API order is wrong at ${item.width}px: ${apiCalls.join(" → ")}`);
    }

    const output = item.hero ? "artifacts/flux-ipad.png" : `artifacts/qa-ipad-${item.width}.png`;
    await page.screenshot({ path: output, fullPage: false });

    if (item.inspect) {
      if (await page.getByRole("slider", { name: "下一轮决策使用的模拟 SOC" }).count() !== 0) {
        throw new Error("SOC simulation slider is visible before debug mode is enabled");
      }
      const liveSoc = page.getByRole("meter", { name: "BMS 实测 SOC" });
      if (!await liveSoc.isVisible() || !await page.getByText("校验通过", { exact: true }).isVisible()) {
        throw new Error("Read-only BMS SOC telemetry is incomplete");
      }
      await page.getByRole("button", { name: "开启 SOC 仿真调试", exact: true }).click();
      const simulationSlider = page.getByRole("slider", { name: "下一轮决策使用的模拟 SOC" });
      await simulationSlider.fill("58");
      const simulationAction = page.getByRole("button", { name: "用仿真值重新决策", exact: true });
      if (!await simulationAction.isVisible()) {
        throw new Error("Simulation input is not clearly reflected in the decision action");
      }
      if (await simulationAction.isDisabled()) {
        throw new Error("Simulation decision action is not enabled in its default state");
      }
      await page.screenshot({ path: "artifacts/qa-ipad-soc-simulation.png", fullPage: false });
      await page.getByRole("button", { name: "退出 SOC 仿真调试", exact: true }).click();
      if (await simulationSlider.count() !== 0 || !await liveSoc.isVisible()) {
        throw new Error("SOC control did not return to read-only measurement mode");
      }

      const initialStreamHour = await page.locator(".hour-rail button.is-selected").getAttribute("data-hour");
      await page.waitForFunction(
        (hour) => document.querySelector(".hour-rail button.is-selected")?.getAttribute("data-hour") !== hour,
        initialStreamHour,
        { timeout: 6000 },
      );
      await page.getByRole("button", { name: "暂停逐时决策流", exact: true }).click();
      if (await page.getByRole("button", { name: "继续逐时决策流", exact: true }).getAttribute("aria-pressed") !== "true") {
        throw new Error("Decision stream pause control did not enter the paused state");
      }
      await page.getByRole("button", { name: "继续逐时决策流", exact: true }).click();
      await page.waitForTimeout(700);
      await page.locator(".hour-rail [data-hour='7']").click();
      const selectedHour = await page.locator(".hour-rail button.is-selected").getAttribute("data-hour");
      const chartHour = await page.locator("#energy-trend").getAttribute("data-selected-hour");
      if (selectedHour !== "7" || chartHour !== "7") {
        throw new Error(`Time rail and trend chart are not linked: ${selectedHour} / ${chartHour}`);
      }

      const packetTrigger = page.getByRole("button", { name: "Jev 报文", exact: true });
      if (await packetTrigger.isDisabled()) throw new Error("Jev packet entry is disabled after a completed decision");
      await packetTrigger.click();
      const packetDialog = page.getByRole("dialog", { name: "Jev 调度报文" });
      if (!await packetDialog.isVisible()) throw new Error("Jev packet dialog did not open");
      const outputTab = packetDialog.getByRole("tab", { name: "Jev 输出", exact: true });
      const hasPacketTabs = Boolean(await outputTab.count());
      if (hasPacketTabs) {
        await outputTab.click();
        if (!await packetDialog.getByRole("tabpanel").isVisible()) throw new Error("Jev output panel did not render");
      }
      await page.waitForTimeout(250);
      const focusInDialog = await page.evaluate(() => document.activeElement?.closest(".jev-packet-dialog") !== null);
      if (!focusInDialog) throw new Error("Jev packet dialog did not move focus into the modal");
      if (hasPacketTabs) {
        await page.keyboard.press("Tab");
        const tabFocusInDialog = await page.evaluate(() => document.activeElement?.closest(".jev-packet-dialog") !== null);
        if (!tabFocusInDialog) throw new Error("Jev packet dialog did not keep Tab focus inside the modal");
      }
      await page.screenshot({ path: "artifacts/qa-ipad-jev-packet.png", fullPage: false });
      await page.keyboard.press("Escape");
      await page.waitForFunction(() => !document.querySelector(".jev-packet-dialog")?.hasAttribute("open"));
      if (await packetDialog.count() && await packetDialog.isVisible()) throw new Error("Jev packet dialog did not close");
      const focusRestored = await page.evaluate(() => document.activeElement === document.querySelector(".packet-action"));
      if (!focusRestored) throw new Error("Jev packet dialog did not restore focus to its entry point");

      const connectionTrigger = page.getByRole("button", { name: "管理 Jev 连接", exact: true });
      if (!await connectionTrigger.isVisible()) throw new Error("Jev connection entry is not visible");
      await connectionTrigger.click();
      const connectionDialog = page.getByRole("dialog", { name: "连接 Jev" });
      if (!await connectionDialog.isVisible()) throw new Error("Jev connection dialog did not open");
      await page.screenshot({ path: "artifacts/qa-ipad-jev-connection.png", fullPage: false });
      const apiKeyInput = connectionDialog.getByLabel("Jev API Key", { exact: true });
      if (await apiKeyInput.getAttribute("type") !== "password" || await apiKeyInput.getAttribute("autocomplete") !== "off") {
        throw new Error("Jev key input is not a write-only password field");
      }
      const fixtureKey = "fixture-key-not-for-network-use-000000000000";
      await apiKeyInput.fill(fixtureKey);
      await page.keyboard.press("Escape");
      await page.waitForFunction(() => !document.querySelector(".jev-connection-dialog")?.hasAttribute("open"));
      const connectionFocusRestored = await page.evaluate(() => document.activeElement === document.querySelector(".connection-action"));
      if (!connectionFocusRestored) throw new Error("Jev connection dialog did not restore focus to its entry point");
      await connectionTrigger.click();
      const reopenedKeyInput = connectionDialog.getByLabel("Jev API Key", { exact: true });
      if (await reopenedKeyInput.inputValue()) throw new Error("Jev key input retained a value after closing");
      const secretLeak = await page.evaluate((fixture) => {
        const storageContains = (storage) => Object.keys(storage).some((key) => (
          key.includes(fixture) || storage.getItem(key)?.includes(fixture)
        ));
        return {
          local: storageContains(localStorage),
          session: storageContains(sessionStorage),
          url: location.href.includes(fixture),
          markup: document.documentElement.outerHTML.includes(fixture),
        };
      }, fixtureKey);
      if (Object.values(secretLeak).some(Boolean)) throw new Error(`Jev key persisted in browser state: ${JSON.stringify(secretLeak)}`);
      await page.keyboard.press("Escape");
      await page.screenshot({ path: "artifacts/qa-ipad-unified.png", fullPage: false });
      const beforeRefresh = apiCalls.length;
      await page.getByRole("radio", { name: "需量控制", exact: true }).click();
      await page.getByRole("button", { name: "采集并重新决策", exact: true }).click();
      await page.locator(".primary-action[data-state='success']").waitFor({ state: "visible", timeout: 30000 });
      const refreshCalls = apiCalls.slice(beforeRefresh);
      if (refreshCalls[0] !== "/api/measurements" || refreshCalls[1] !== "/api/dispatch/forecast") {
        throw new Error(`Refresh API order is wrong: ${refreshCalls.join(" → ")}`);
      }
      const demandInputs = await page.locator(".measurement-grid").innerText();
      const demandReason = await page.locator(".stream-feed li").nth(2).innerText();
      const demandAction = await page.locator(".decision-stream").getAttribute("data-action");
      if (!demandInputs.includes("当前 15 分钟需量") || !demandInputs.includes("需量控制目标")) {
        throw new Error("Demand inputs are not integrated into the existing input baseline");
      }
      if (!demandReason.includes("15 分钟需量") || demandAction !== "discharge") {
        throw new Error(`Demand decision is not visible: ${demandAction} / ${demandReason}`);
      }
      const demandLayout = await page.evaluate(() => {
        const dock = document.querySelector(".control-dock");
        const button = document.querySelector(".control-dock > .primary-action");
        const dockRect = dock?.getBoundingClientRect();
        const buttonRect = button?.getBoundingClientRect();
        const sections = [...document.querySelectorAll(".control-section")].map((section) => {
          const rect = section.getBoundingClientRect();
          return { className: section.className, top: rect.top, bottom: rect.bottom, height: rect.height };
        });
        return {
          dockTop: dockRect?.top ?? 0,
          dockBottom: dockRect?.bottom ?? 0,
          dockHeight: dock?.clientHeight ?? 0,
          dockScrollHeight: dock?.scrollHeight ?? 0,
          buttonTop: buttonRect?.top ?? 0,
          buttonBottom: buttonRect?.bottom ?? 0,
          buttonVisible: Boolean(buttonRect && dockRect && buttonRect.top >= dockRect.top && buttonRect.bottom <= dockRect.bottom),
          sections,
        };
      });
      console.log(JSON.stringify({ width: item.width, demandLayout }));
      if (!demandLayout.buttonVisible || demandLayout.dockScrollHeight > demandLayout.dockHeight + 2) {
        throw new Error(`Demand controls do not fit one screen: ${JSON.stringify(demandLayout)}`);
      }
      await page.waitForTimeout(700);
      const visibleStreamRows = await page.locator(".stream-feed li").evaluateAll((rows) => rows.filter((row) => Number(getComputedStyle(row).opacity) > 0.99).length);
      if (visibleStreamRows !== 4) throw new Error(`Expected four visible stream rows, received ${visibleStreamRows}`);
      await page.screenshot({ path: "artifacts/qa-ipad-demand.png", fullPage: false });
    }

    const visibleCopy = await page.locator("body").innerText();
    if (/demo|演示/i.test(visibleCopy)) throw new Error("Forbidden Demo wording is visible");
    if (directJevCalls.length) throw new Error(`Browser called Jev directly: ${directJevCalls.join(", ")}`);
    console.log(JSON.stringify({ width: item.width, metrics, apiOrder: apiCalls.slice(0, 2), output }));
    await page.close();
  }
} finally {
  await browser.close();
}
