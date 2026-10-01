import { expect, test } from "@playwright/test";

// Browser-only component fixture. No login, API requests or database mutations.
for (const dir of ["ltr", "rtl"]) {
  test(`pivot matches the records grid with totals above headers (${dir})`, async ({ page }) => {
    await page.route("**/src/lib/i18n.tsx*", route => route.fulfill({
      contentType: "text/javascript",
      body: "export const useT = () => (_, fallback) => fallback;",
    }));
    await page.route("**/__pivot-layout-test", route => route.fulfill({
      contentType: "text/html",
      body: `<html dir="${dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div>
        <script type="module">
          import RefreshRuntime from '/@react-refresh';
          RefreshRuntime.injectIntoGlobalHook(window);
          window.$RefreshReg$ = () => {};
          window.$RefreshSig$ = () => type => type;
          window.__vite_plugin_react_preamble_installed__ = true;
          const {default: React} = await import('/node_modules/.vite/deps/react.js');
          const {default: ReactDOM} = await import('/node_modules/.vite/deps/react-dom_client.js');
          const {PivotResultTable} = await import('/src/components/PivotView.tsx');
          await import('/src/index.css');
          const result = {
            rows:[{key:'project',label:'Проект / פרויקט'}],
            cols:[{key:'amount',label:'Сумма'},{key:'count',label:'Количество'}],
            cells:[{rowKey:'project',colKey:'amount',value:1250},{rowKey:'project',colKey:'count',value:3}],
            rowTotals:[], colTotals:[{key:'amount',value:1250},{key:'count',value:3}],
            grandTotal:0, multiMeasure:true, measureLabel:'Показатели'
          };
          const root = ReactDOM.createRoot(document.getElementById('root'));
          window.showPivot = multiMeasure => root.render(React.createElement(PivotResultTable,{
            result:{...result,multiMeasure,rowTotals:[{key:'project',value:1253}],grandTotal:1253}
          }));
          window.showPivot(true);
        </script></body></html>`,
    }));
    await page.goto("/__pivot-layout-test");
    await expect(page.locator("tbody tr")).toHaveCount(1);
    await expect(page.locator("tbody th")).toHaveText("Проект / פרויקט");
    const totals = page.getByTestId("pivot-column-totals");
    await expect(page.locator("thead > tr").first()).toHaveAttribute("data-testid", "pivot-column-totals");
    await expect(page.locator("tfoot")).toHaveCount(0);
    await expect(totals.locator("td")).toHaveCount(2);
    await expect(totals.locator("td").first()).toHaveCSS("background-color", "rgb(209, 250, 229)");
    await expect(page.locator(".erp-main-header")).toHaveCount(1);
    expect((await totals.boundingBox())!.y).toBeLessThan((await page.locator(".erp-main-header").boundingBox())!.y);
    await page.evaluate(() => (window as any).showPivot(false));
    await expect(totals.locator("td")).toHaveCount(3);
    await expect(page.locator("tbody td").last()).toHaveText(/1.?253/);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(totals).toBeVisible();
    await expect(page.locator("thead")).toHaveCSS("position", "sticky");
    await page.screenshot({ path: `/tmp/pivot-table-${dir}.png` });
  });
}