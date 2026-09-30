import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";

// Runs against the already-running Vite preview. Every API call is intercepted:
// this regression never creates or changes database records.
test("multi selector uses full snapshot, saves normalized IDs with CAS, and exposes errors", async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH ?? execFileSync("which", ["chromium"], { encoding: "utf8" }).trim() });
  const page = await browser.newPage();
  const browserErrors = [];
  page.on("pageerror", error => browserErrors.push(error.message));
  const writes = [];
  let candidateRequest;
  let failSave = false;
  const candidates = Array.from({ length: 135 }, (_, i) => ({ id: i + 1, label: `Item ${i + 1}` }));
  await page.route("**/api/**", async route => {
    const data = route.request().postDataJSON();
    if (route.request().url().includes("related-candidates")) {
      candidateRequest = data;
      return route.fulfill({ json: { candidates, relatedEntityId: 2, canCreate: false } });
    }
    if (route.request().url().includes("related-link")) {
      writes.push(data);
      return failSave
        ? route.fulfill({ status: 409, json: { error: "Selection conflict" } })
        : route.fulfill({ json: { linkedRecordId: null, linkedRecordIds: data.linkedRecordIds, version: 8 } });
    }
    return route.fulfill({ status: 403, json: { error: "Unexpected API request in isolated test" } });
  });
  await page.route("**/__relation_picker_test", route => route.fulfill({
    contentType: "text/html",
    body: `<html><body><div id="root"></div><script type="module">
      import RefreshRuntime from "/@react-refresh";
      RefreshRuntime.injectIntoGlobalHook(window);
      window.$RefreshReg$ = () => {};
      window.$RefreshSig$ = () => (type) => type;
      window.__vite_plugin_react_preamble_installed__ = true;
      const componentSource = await (await fetch("/src/components/MultipleRelationPicker.tsx")).text();
      const version = componentSource.match(/react.js(\\?v=[a-z0-9]+)/)[1];
      const {default: React} = await import("/node_modules/.vite/deps/react.js" + version);
      const {default: {createRoot}} = await import("/node_modules/.vite/deps/react-dom_client.js" + version);
      const {QueryClient, QueryClientProvider} = await import("/node_modules/.vite/deps/@tanstack_react-query.js" + version);
      const {MultipleRelationPicker} = await import("/src/components/MultipleRelationPicker.tsx");
      const root = createRoot(document.getElementById("root"));
      const client = new QueryClient({defaultOptions:{mutations:{retry:false}}});
      let key = 0;
      window.renderPicker = (props = {}) => root.render(React.createElement(QueryClientProvider,
        {client}, React.createElement(MultipleRelationPicker, {key:++key, entityId:1, fieldKey:"items", recordId:10,
          expectedVersion:7, ids:[1], members:[{id:1,label:"Item 1"}], dependent:true, parentValue:"99", ...props})));
      window.renderPicker();
    </script></body></html>`,
  }));
  try {
    await page.goto(`${process.env.FRONTEND_URL ?? "http://localhost:80"}/__relation_picker_test`);
    await page.waitForTimeout(2500);
    assert.deepEqual(browserErrors, [], "Isolated component must mount without runtime errors");
    await page.getByRole("button", { name: "1 записей", exact: true }).click();
    await page.getByRole("button", { name: "Выбрать все (135)" }).click();
    assert.equal(candidateRequest.all, true);
    assert.equal(candidateRequest.parentValue, "99");
    await page.getByRole("button", { name: "Сохранить выбор" }).click();
    await page.getByRole("button", { name: "1 записей", exact: true }).waitFor();
    assert.equal(writes[0].linkedRecordIds.length, 135);
    assert.equal(writes[0].expectedVersion, 7);
    assert.equal(writes[0].linkedRecordId, undefined);
    assert.equal(writes[0].valuesJson, undefined);
    await page.getByRole("button", { name: "1 записей", exact: true }).click();
    await page.getByRole("textbox", { name: "Поиск связанных записей" }).fill("Item 135");
    await page.getByRole("checkbox").check();
    failSave = true;
    await page.getByRole("button", { name: "Сохранить выбор" }).click();
    await page.getByRole("alert").waitFor();
    assert.deepEqual(writes[1].linkedRecordIds, [1, 135]);
    assert.equal(await page.getByRole("dialog").count(), 1);
    await page.getByRole("button", { name: "Закрыть", exact: true }).click();
    await page.evaluate(() => window.renderPicker({ recordId: undefined, value: "", onChange: value => { window.draftSelection = value; } }));
    await page.getByRole("button", { name: "0 записей", exact: true }).click();
    await page.getByRole("button", { name: "Выбрать все (135)" }).click();
    await page.getByRole("button", { name: "Сохранить выбор" }).click();
    assert.equal(JSON.parse(await page.evaluate(() => window.draftSelection)).length, 135);
    assert.equal(writes.length, 2, "Create mode must not persist links before the atomic record create");
    await page.evaluate(() => window.renderPicker({ disabled: true }));
    await page.getByRole("button", { name: "1 записей", exact: true }).click();
    await page.getByText("Item 1", { exact: true }).waitFor();
    assert.equal(await page.getByRole("checkbox").count(), 0);
    assert.equal(await page.getByRole("button", { name: "Сохранить выбор" }).count(), 0);
    await page.getByRole("button", { name: "Закрыть", exact: true }).click();
    await page.evaluate(() => window.renderPicker({ recordId: undefined, value: "", parentValue: null }));
    await page.getByRole("button", { name: "0 записей", exact: true }).click();
    await page.getByText("Сначала выберите родительскую запись.").waitFor();
    assert.equal(await page.getByRole("button", { name: "Сохранить выбор" }).isDisabled(), true);
  } finally {
    await browser.close();
  }
});