import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { transformWithEsbuild } from "vite";
import { chromium } from "@playwright/test";

test("real form serializer distinguishes clearing from omission and creation", async () => {
  const source = readFileSync(new URL("./EntityRecords.tsx", import.meta.url), "utf8");
  const converter = source.slice(source.indexOf("function formToValues("), source.indexOf("\nfunction renderCellValue("));
  const { code } = await transformWithEsbuild(converter, "formToValues.ts");
  const convert = new Function(code + "\nreturn formToValues;")();
  const fields = [
    { fieldKey: "comment", fieldType: "text" },
    { fieldKey: "amount", fieldType: "number" },
    { fieldKey: "percent", fieldType: "percent" },
    { fieldKey: "missing", fieldType: "text" },
    { fieldKey: "computed", fieldType: "function" },
    { fieldKey: "flag", fieldType: "boolean" },
  ].map(field => ({ ...field, isActive: true }));
  fields.push({ fieldKey: "crm_deal_id", fieldType: "text", isActive: false });
  fields.push({ fieldKey: "inactive_flag", fieldType: "boolean", isActive: false });
  const empty = { comment: "", amount: "", percent: null, computed: "", flag: false };
  assert.deepEqual(convert(fields, empty, true), { comment: null, amount: null, percent: null, flag: false });
  assert.deepEqual(convert(fields, empty), { flag: false });
  for (const value of ["", null, "legacy-value"]) {
    assert.deepEqual(convert(fields, { ...empty, crm_deal_id: value, inactive_flag: true }, true),
      { comment: null, amount: null, percent: null, flag: false });
  }
  assert.deepEqual(convert(fields, { comment: "8551\nhttps://example.test/doc", amount: 0, percent: "0", flag: false }, true),
    { comment: "8551\nhttps://example.test/doc", amount: 0, percent: 0, flag: false });
});

// Exercise the actual component with controlled network and form dependencies.
// No database reads/writes or automation deliveries.
test("linked editor reopens with fresh values/version, clears comments, and preserves conflicts", async () => {
  const source = readFileSync(new URL("./EntityRecords.tsx", import.meta.url), "utf8");
  const component = source.slice(source.indexOf("function RecordEditModal("), source.indexOf("\n/**", source.indexOf("function RecordEditModal(")));
  const converter = source.slice(source.indexOf("function formToValues("), source.indexOf("\nfunction renderCellValue("));
  const { code } = await transformWithEsbuild(converter + "\n" + component, "RecordEditModal.tsx", { jsx: "transform" });
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH ?? execFileSync("which", ["chromium"], { encoding: "utf8" }).trim() });
  try {
    const page = await browser.newPage();
    await page.route("**/api/**", route => route.fulfill({ json: {} }));
    await page.goto(process.env.PREVIEW_URL ?? "http://localhost:80/");
    await page.evaluate(async (componentCode) => {
      const { default: React } = await import("/node_modules/.vite/deps/react.js");
      const { default: { createRoot } } = await import("/node_modules/.vite/deps/react-dom_client.js");
      document.body.innerHTML = '<div id="test-root"></div>';
      const h = React.createElement;
      const fields = [
        { fieldKey: "comment", fieldType: "text", isActive: true, showInTable: false },
        { fieldKey: "crm_deal_id", fieldType: "text", isActive: false },
      ];
      window.fixture = { record: { id: 3715, entityId: 72, version: 1, valuesJson: { comment: "" } }, writes: [], reads: 0, toasts: [], failRead: false };
      const deps = {
        React, useState: React.useState, useEffect: React.useEffect,
        useLayoutEffect: React.useLayoutEffect, useRef: React.useRef, NO_STATUS: "none",
        useT: () => (_key, fallback) => fallback, useML: () => () => "",
        useToast: () => ({ toast: message => window.fixture.toasts.push(message) }),
        useAuth: () => ({ fieldAccess: () => "edit", user: { permissions: { superAdmin: true } } }),
        getRecord: async () => {
          window.fixture.reads++;
          await new Promise(resolve => setTimeout(resolve, 80));
          if (window.fixture.failRead) throw new Error("read denied");
          return structuredClone(window.fixture.record);
        },
        useListEntityFields: () => ({ data: fields, isLoading: false }),
        useListEntityStatuses: () => ({ data: [] }),
        useListEntities: () => ({ data: [] }), useListUserOptions: () => ({ data: [] }),
        canManuallyEditStatus: () => true,
        valueToForm: (_field, value) => value ?? "",
        maybeRenameDriveFiles: async () => {},
        useUpdateRecord: () => ({ mutateAsync: async ({ data }) => {
          window.fixture.writes.push(structuredClone(data));
          for (const key of Object.keys(data.valuesJson)) {
            if (!fields.some(field => field.isActive && field.fieldKey === key)) {
              throw new Error(`Unknown field: ${key}`);
            }
          }
          if (data.expectedVersion !== window.fixture.record.version) throw Object.assign(new Error("conflict"), { status: 409 });
          // Match PUT semantics: an omitted key leaves the stored value intact.
          window.fixture.record.valuesJson = { ...window.fixture.record.valuesJson, ...structuredClone(data.valuesJson) };
          window.fixture.record.version++;
        } }),
        CardTemplateSnapshot: ({ children }) => children({ status: "ready", layout: null }),
        CardDialogShell: ({ open, header, footer, children }) => open ? h("section", {}, header, children, footer) : null,
        CardSnapshotGate: ({ children }) => children(null),
        layoutIsWide: () => false, layoutPresentation: () => null,
        DialogTitle: ({ children }) => h("h1", {}, children),
        DialogDescription: ({ children }) => h("p", {}, children),
        Button: ({ children, variant, ...props }) => h("button", props, children),
        Loader2: () => null,
        RecordFormBody: ({ form, setForm }) => h("textarea", {
          "aria-label": "Комментарий", value: form.comment ?? "",
          onChange: e => setForm({ ...form, comment: e.target.value }),
        }),
      };
      const Component = new Function(...Object.keys(deps), componentCode + "\nreturn RecordEditModal;")(...Object.values(deps));
      const root = createRoot(document.getElementById("test-root"));
      let opened = true;
      const render = () => root.render(h(Component, { entityId: 72, recordId: 3715, open: opened, onOpenChange: next => { opened = next; render(); }, onSaved() {} }));
      window.openEditor = () => { opened = true; render(); };
      render();
    }, code);
    const input = page.getByRole("textbox", { name: "Комментарий" });
    const save = page.getByRole("button", { name: "Сохранить" });
    await input.waitFor();
    const comment = "8551\nhttps://example.test/document\nhttps://example.test/file";
    await input.fill(comment);
    await save.click();
    await input.waitFor({ state: "hidden" });
    await page.evaluate(() => window.openEditor());
    await input.waitFor();
    assert.equal(await input.inputValue(), comment);
    await input.fill("");
    await save.click();
    await input.waitFor({ state: "hidden" });
    assert.deepEqual(await page.evaluate(() => window.fixture.writes.map(w => w.expectedVersion)), [1, 2]);
    assert.equal(await page.evaluate(() => window.fixture.writes[1].valuesJson.comment), null);
    assert.equal(await page.evaluate(() => window.fixture.record.valuesJson.comment), null);
    await page.evaluate(() => window.openEditor());
    await input.waitFor();
    assert.equal(await input.inputValue(), "");
    await input.fill("keep my draft");
    await page.evaluate(() => window.fixture.record.version++);
    await save.click();
    assert.equal(await input.inputValue(), "keep my draft");
    assert.equal(await page.evaluate(() => window.fixture.toasts.at(-1).title), "Данные изменились на сервере");
    await page.getByRole("button", { name: "Отмена" }).click();
    await page.evaluate(() => { window.fixture.failRead = true; window.openEditor(); });
    await page.getByRole("alert").waitFor();
    assert.equal(await save.isDisabled(), true);
  } finally {
    await browser.close();
  }
});
