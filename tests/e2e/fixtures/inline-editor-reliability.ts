import { expect, type CDPSession, type Locator, type Page } from "@playwright/test";

// This fixture drives Chromium's input pipeline, not DOM dispatchEvent or
// programmatic scrollTop. Swipe coordinates are remeasured after placement.
export async function touchTap(cdp: CDPSession, target: Locator) {
  const box = await target.boundingBox();
  if (!box) throw new Error("Touch target has no geometry");
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

export async function touchScrollToEnd(cdp: CDPSession, list: Locator, end: "top" | "bottom") {
  for (let attempt = 0; attempt < 80; attempt++) {
    const atEnd = await list.evaluate((el, edge) =>
      edge === "top" ? el.scrollTop <= 1 : el.scrollTop + el.clientHeight >= el.scrollHeight - 2, end);
    if (atEnd) return;
    const box = await list.boundingBox();
    if (!box || box.height < 60) throw new Error("Touch list viewport is too small");
    const x = box.x + box.width / 2;
    const from = box.y + box.height * (end === "bottom" ? 0.8 : 0.2);
    const to = box.y + box.height * (end === "bottom" ? 0.2 : 0.8);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y: from }] });
    for (let step = 1; step <= 12; step++) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: from + (to - from) * step / 12 }] });
      await new Promise(resolve => setTimeout(resolve, 16));
    }
    // Pause at the last coordinate to avoid fling/inertia obscuring tap checks.
    await new Promise(resolve => setTimeout(resolve, 100));
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  }
  throw new Error(`Real touch scrolling failed to reach ${end}`);
}

export async function scrollSnapshot(page: Page) {
  return page.evaluate(() => ({
    window: [scrollX, scrollY],
    scrollers: [...document.querySelectorAll("main *")].filter(el => {
      const style = getComputedStyle(el);
      return (el.scrollHeight > el.clientHeight && /auto|scroll/.test(style.overflowY))
        || (el.scrollWidth > el.clientWidth && /auto|scroll/.test(style.overflowX));
    })
      .map(el => [el.scrollLeft, el.scrollTop]),
    locked: getComputedStyle(document.body).overflow === "hidden" || document.body.hasAttribute("data-scroll-locked"),
  }));
}

export async function armPointerPaint(page: Page, selector: string) {
  await page.evaluate((selector) => {
    const state = window as Window & { __reliabilityPaint?: Promise<{ elapsedMs: number; error: string | null }> };
    state.__reliabilityPaint = new Promise(resolve => {
      let started: number | null = null;
      let scheduled = false;
      let settled = false;
      const visible = () => [...document.querySelectorAll(selector)].some(el => {
        const rect = el.getBoundingClientRect(), style = getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none" && Number(style.opacity) !== 0;
      });
      const finish = (error: string | null) => {
        if (settled) return;
        settled = true;
        observer.disconnect();
        clearTimeout(timer);
        document.removeEventListener("pointerdown", start, true);
        resolve({ elapsedMs: started === null ? -1 : performance.now() - started, error });
      };
      const inspect = () => {
        if (settled || scheduled || started === null || !visible()) return;
        scheduled = true;
        requestAnimationFrame(() => requestAnimationFrame(() => {
          if (visible()) finish(null);
          else { scheduled = false; inspect(); }
        }));
      };
      const start = () => { if (started === null) started = performance.now(); inspect(); };
      const observer = new MutationObserver(inspect);
      observer.observe(document.documentElement, { attributes: true, childList: true, subtree: true });
      document.addEventListener("pointerdown", start, true);
      const timer = setTimeout(() => finish("No candidate paint within 10 seconds"), 10_000);
    });
  }, selector);
}

export async function readPointerPaint(page: Page) {
  const value = await page.evaluate(() => (window as Window & {
    __reliabilityPaint?: Promise<{ elapsedMs: number; error: string | null }>;
  }).__reliabilityPaint);
  expect(value, "Pointer paint probe must be armed").toBeDefined();
  return value!;
}