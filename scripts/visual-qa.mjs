import { chromium } from "playwright";

const edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const cases = [
  { width: 320, height: 700 },
  { width: 375, height: 812 },
  { width: 390, height: 844, hero: true },
  { width: 414, height: 896 },
  { width: 768, height: 1024 },
];

const browser = await chromium.launch({ executablePath: edgePath, headless: true });

async function viewportFit(page) {
  return page.locator(".app-content").evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
    fits: element.scrollHeight <= element.clientHeight + 1,
  }));
}

try {
  for (const item of cases) {
    const page = await browser.newPage({
      viewport: { width: item.width, height: item.height },
      deviceScaleFactor: 1,
      isMobile: item.width < 600,
      hasTouch: item.width < 600,
    });
    await page.goto("http://127.0.0.1:8787/", { waitUntil: "networkidle" });
    await page.locator(".decision-card").waitFor({ state: "visible" });
    await page.waitForTimeout(500);

    const metrics = await page.evaluate(() => ({
      viewport: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
      selectedHour: document.querySelector(".hour-card.is-selected")?.getAttribute("data-hour"),
      selectedHourVisible: (() => {
        const selected = document.querySelector(".hour-card.is-selected");
        const rail = document.querySelector(".hour-rail");
        if (!(selected instanceof HTMLElement) || !(rail instanceof HTMLElement)) return false;
        const selectedRect = selected.getBoundingClientRect();
        const railRect = rail.getBoundingClientRect();
        return selectedRect.left >= railRect.left && selectedRect.right <= railRect.right;
      })(),
    }));

    const dispatchFit = await viewportFit(page);

    const path = item.hero
      ? "artifacts/flux-mobile.png"
      : `artifacts/qa-${item.width}.png`;
    await page.screenshot({ path, fullPage: false });
    if (item.width === 768) {
      await page.screenshot({ path: "artifacts/flux-iphone.png", fullPage: false });
    }
    console.log(JSON.stringify({ width: item.width, ...metrics, dispatchFit, path }));

    if (!dispatchFit.fits) throw new Error(`Dispatch screen overflows vertically at ${item.width}px`);

    if (item.hero) {
      const liveHourBefore = await page.locator(".hour-card.is-selected").getAttribute("data-hour");
      await page.waitForTimeout(4500);
      const liveHourAfter = await page.locator(".hour-card.is-selected").getAttribute("data-hour");
      if (liveHourAfter === liveHourBefore) throw new Error("Live decision stream did not advance automatically");

      await page.getByRole("button", { name: "暂停实时推演" }).click();
      const pausedHour = await page.locator(".hour-card.is-selected").getAttribute("data-hour");
      await page.waitForTimeout(4500);
      const pausedHourAfterWait = await page.locator(".hour-card.is-selected").getAttribute("data-hour");
      if (pausedHourAfterWait !== pausedHour) throw new Error("Live decision stream advanced while paused");

      await page.locator('[data-hour="12"]').click();
      const switchedHour = await page.locator(".decision-card__top > span").first().textContent();
      if (!switchedHour?.startsWith("12:00")) throw new Error("Hourly decision did not update after tapping 12:00");

      await page.locator("#tab-trend").click();
      await page.locator("#panel-trend").waitFor({ state: "visible" });
      const trendFit = await viewportFit(page);
      if (!trendFit.fits) throw new Error(`Trend screen overflows vertically at ${item.width}px`);
      await page.screenshot({ path: "artifacts/qa-trend.png", fullPage: false });

      await page.locator("#tab-settings").click();
      await page.locator("#panel-settings").waitFor({ state: "visible" });
      const settingsFit = await viewportFit(page);
      if (!settingsFit.fits) throw new Error(`Settings screen overflows vertically at ${item.width}px`);
      await page.screenshot({ path: "artifacts/qa-settings.png", fullPage: false });

      const visibleCopy = await page.locator("body").innerText();
      if (/demo|演示/i.test(visibleCopy)) throw new Error("Forbidden Demo wording is still visible");
      console.log(JSON.stringify({
        liveAdvance: `${liveHourBefore}→${liveHourAfter}`,
        pausedAt: pausedHour,
        hourlySwitch: switchedHour,
        tabs: { trend: trendFit, settings: settingsFit },
        forbiddenCopy: false,
      }));
    } else {
      for (const tab of ["trend", "settings"]) {
        await page.locator(`#tab-${tab}`).click();
        await page.locator(`#panel-${tab}`).waitFor({ state: "visible" });
        const fit = await viewportFit(page);
        console.log(JSON.stringify({ width: item.width, tab, fit }));
        if (!fit.fits) throw new Error(`${tab} screen overflows vertically at ${item.width}px`);
      }
    }
    await page.close();
  }
} finally {
  await browser.close();
}
