import { expect, test } from "@playwright/test";

// Browser-only component fixture. No login, API requests or database mutations.
for (const dir of ["ltr", "rtl"]) {
  test(`pivot matches the records grid with totals above headers (${dir})`, async ({ page }) => {
    await page.route("**/src/lib/i18n.tsx*", route => route.fulfill({
      contentType: "text/javascript",
      body: "export const useT = () => (_, fallback) => fallback; export const useML = () => value => value?.ru ?? '';",
    }));
    await page.route("**/api/settings", route => route.fulfill({
      json: { tableStyle: "striped", tableHeaderColor: "#d9e1f2", tableStripeColor: "#f0f4ff", tableBorderColor: "#94a3b8" },
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
          const authModule = await fetch('/src/lib/auth.tsx').then(r => r.text());
          const queryUrl = authModule.match(/"([^"]*@tanstack_react-query[^"]*)"/)[1];
          const {QueryClient, QueryClientProvider} = await import(queryUrl);
          const {PivotResultTable} = await import('/src/components/PivotView.tsx');
          await import('/src/index.css');
          const result = {
            rows:[{key:'project',label:'Проект / פרויקט'},{key:'other',label:'Другой проект'}],
            cols:[{key:'amount',label:'Сумма'},{key:'count',label:'Количество'}],
            cells:[{rowKey:'project',colKey:'amount',value:1250},{rowKey:'project',colKey:'count',value:3}],
            rowTotals:[], colTotals:[{key:'amount',value:1250},{key:'count',value:3}],
            grandTotal:0, multiMeasure:true, measureLabel:'Показатели', rowLabelJson:{ru:'Проект',en:'Project',he:'פרויקט'}
          };
          const root = ReactDOM.createRoot(document.getElementById('root'));
          const client = new QueryClient();
          window.showPivot = multiMeasure => root.render(React.createElement(QueryClientProvider,{client},React.createElement(PivotResultTable,{
            result:{...result,multiMeasure,rowTotals:[{key:'project',value:1253}],grandTotal:1253}
          })));
          window.showPivot(true);
        </script></body></html>`,
    }));
    await page.goto("/__pivot-layout-test");
    await expect(page.locator("tbody tr")).toHaveCount(2);
    await expect(page.locator("tbody th").first()).toHaveText("Проект / פרויקט");
    await expect(page.locator(".erp-main-header th").first()).toHaveText("Проект");
    await expect(page.locator(".erp-main-header")).toHaveCSS("background-color", "rgb(217, 225, 242)");
    await expect(page.locator("tbody tr").nth(1)).toHaveCSS("background-color", "rgb(240, 244, 255)");
    await expect(page.locator("tbody th").first()).toHaveCSS("padding-top", "12px");
    await expect(page.locator("tbody th").first()).toHaveCSS("border-inline-end-color", "rgb(148, 163, 184)");
    const totals = page.getByTestId("pivot-column-totals");
    await expect(page.locator("thead > tr").first()).toHaveAttribute("data-testid", "pivot-column-totals");
    await expect(page.locator("tfoot")).toHaveCount(0);
    await expect(totals.locator("td")).toHaveCount(2);
    await expect(totals.locator("td").first()).toHaveCSS("background-color", "rgb(209, 250, 229)");
    await expect(page.locator(".erp-main-header")).toHaveCount(1);
    expect((await totals.boundingBox())!.y).toBeLessThan((await page.locator(".erp-main-header").boundingBox())!.y);
    await page.evaluate(() => (window as any).showPivot(false));
    await expect(totals.locator("td")).toHaveCount(3);
    await expect(page.locator("tbody tr").first().locator("td").last()).toHaveText(/1.?253/);
    await page.screenshot({ path: `/tmp/pivot-table-desktop-${dir}.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(totals).toBeVisible();
    await expect(page.locator("thead")).toHaveCSS("position", "sticky");
    await page.screenshot({ path: `/tmp/pivot-table-${dir}.png` });
  });
}