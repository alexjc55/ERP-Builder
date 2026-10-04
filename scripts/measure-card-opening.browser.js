// Run in the browser console on the target ERP records page with dialogs closed.
// Opens and closes the empty create form three times; NEVER clicks Save.
// No tokens, field contents, URLs, or response bodies are collected or printed.
(async () => {
  const selector = '[data-testid="record-dialog"]';
  const visible = element => element && element.getClientRects().length > 0;
  if (document.visibilityState !== "visible") throw new Error("Keep the ERP tab visible.");
  if (document.querySelector(selector)) throw new Error("Close the current card first.");
  const button = [...document.querySelectorAll("button")].find(element =>
    visible(element) && /^(Добавить запись|Add record)$/.test(element.textContent.trim()));
  if (!button || button.disabled) throw new Error("Open the target records page first (Russian or English).");
  const samples = [];
  for (let sample = 1; sample <= 3; sample++) {
    let request;
    const observer = new PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        if (new URL(entry.name).pathname.endsWith("/card-templates/resolve") && !request) request = entry;
      }
    });
    observer.observe({ type: "resource" });
    const start = performance.now();
    let appeared;
    let longTasks = 0;
    let blockedMs = 0;
    const longObserver = PerformanceObserver.supportedEntryTypes.includes("longtask")
      ? new PerformanceObserver(list => {
        for (const entry of list.getEntries()) { longTasks++; blockedMs += entry.duration; }
      }) : null;
    longObserver?.observe({ type: "longtask" });
    try {
      button.click();
      await new Promise((resolve, reject) => {
        const check = () => {
          const dialog = document.querySelector(selector);
          if (dialog?.querySelector('[data-testid="card-resolve-error"]')) {
            reject(new Error("Template resolution failed; no fallback measurement.")); return;
          }
          if (!appeared && visible(dialog) && dialog.querySelector('[data-testid="card-layout"]') &&
              getComputedStyle(dialog).opacity === "1" && !dialog.inert) appeared = performance.now();
          if (appeared && request) { resolve(); return; }
          if (performance.now() - start > 20_000) {
            reject(new Error("Timed out waiting for a resolved custom card and resource timing.")); return;
          }
          requestAnimationFrame(check);
        };
        requestAnimationFrame(check);
      });
      const durations = Object.fromEntries((request.serverTiming ?? [])
        .filter(entry => ["card_auth", "card_data"].includes(entry.name))
        .map(entry => [entry.name, Math.round(entry.duration)]));
      samples.push({
        opening: sample,
        totalMs: Math.round(appeared - start),
        beforeRequestMs: Math.round(request.startTime - start),
        requestMs: Math.round(request.responseEnd - request.startTime),
        afterResponseMs: Math.round(appeared - request.responseEnd),
        ...durations,
        longTasks: longObserver ? longTasks : "unsupported",
        blockedMs: longObserver ? Math.round(blockedMs) : "unsupported",
      });
    } finally {
      observer.disconnect();
      longObserver?.disconnect();
    }
    document.querySelector(`${selector} [data-testid="button-card-close"]`)?.click();
    await new Promise(resolve => setTimeout(resolve, 600));
    if (document.querySelector(selector)) throw new Error("Card did not close; stopped.");
  }
  console.table(samples);
  console.log(JSON.stringify(samples));
  return samples;
})();