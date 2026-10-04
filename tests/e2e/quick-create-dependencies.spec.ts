import { test, expect } from "@playwright/test";

test("quick create resolves and locks arbitrary ancestors and formats a user lookup", async ({ page }) => {
  const field = (entityId: number, fieldKey: string, fieldType = "text", extra = {}) => ({
    id: entityId * 100 + fieldKey.length, entityId, fieldKey, fieldType,
    nameJson: { en: fieldKey }, isActive: true, sortOrder: 0, optionsJson: [], ...extra,
  });
  const fields = {
    1: [field(1, "parent", "relation", { relationConfigJson: { relationId: 10, relatedFieldKey: "title" } }),
      field(1, "children", "relation", { dependencyConfigJson: { dependsOnFieldKey: "parent", relatedFilterFieldKey: "anchor" },
        relationConfigJson: { relationId: 11, relatedFieldKey: "title", selectionMode: "multiple", allowCreate: true } })],
    2: [field(2, "title"), field(2, "customer"), field(2, "project", "relation", {
      dependencyConfigJson: { dependsOnFieldKey: "customer", relatedFilterFieldKey: "customer" },
      relationConfigJson: { relationId: 12, relatedFieldKey: "title" } }),
      field(2, "anchor", "relation", { dependencyConfigJson: { dependsOnFieldKey: "project", relatedFilterFieldKey: "project" },
        relationConfigJson: { relationId: 13, relatedFieldKey: "title" } }),
      field(2, "manager", "lookup", { relationConfigJson: { relationId: 13, relatedFieldKey: "manager" } })],
    3: [field(3, "title"), field(3, "project", "relation"), field(3, "manager", "user")],
    4: [field(4, "title"), field(4, "customer")],
  };
  const entities = [1, 2, 3, 4].map(id => ({ id, entityKey: `entity${id}`, nameJson: { en: `Entity ${id}` }, isActive: true, pageId: id === 1 ? 1 : null, allowNoStatus: true }));
  const records = [
    { id: 100, entityId: 1, valuesJson: {}, version: 1 },
    { id: 300, entityId: 3, valuesJson: { title: "Order alpha", manager: 7 }, version: 1 },
    { id: 400, entityId: 4, valuesJson: { title: "Project beta", customer: "Customer gamma" }, version: 1 },
  ];
  let created: any;
  await page.addInitScript(() => localStorage.setItem("erp_token", "fixture-only"));
  await page.route("**/api/**", async route => {
    const req = route.request(), path = new URL(req.url()).pathname;
    const reply = (data: unknown) => route.fulfill({ json: data });
    if (path === "/api/auth/me") return reply({ id: 7, roleId: 1, roleIds: [1], language: "en", direction: "ltr", permissions: { superAdmin: true, admin: {}, records: {}, pageIds: [1] } });
    if (path === "/api/pages") return reply([{ id: 1, path: "/quick-fixture", nameJson: { en: "Fixture" }, isActive: true }]);
    if (path === "/api/entities") return reply(entities);
    if (path === "/api/settings") return reply({ defaultLanguage: "en" });
    if (path.includes("/collaboration/")) return route.abort();
    if (path.includes("user-options") || path === "/api/users/options") return reply([{ id: 7, name: "Manager delta" }]);
    const match = path.match(/\/entities\/(\d+)(.*)/);
    if (match) {
      const id = Number(match[1]), suffix = match[2];
      if (!suffix) return reply(entities.find(e => e.id === id));
      if (suffix === "/fields") return reply(fields[id as keyof typeof fields] ?? []);
      if (suffix === "/records/query") return reply({ data: records.filter(r => r.entityId === id), total: 1, page: 1, pageSize: 50, numericTotals: {} });
      if (suffix === "/records" && req.method() === "POST") { created = req.postDataJSON(); return reply({ id: 200, entityId: 2, valuesJson: created.valuesJson, version: 1 }); }
      if (suffix === "/related-candidates") return reply({ candidates: [], canCreate: true, relatedEntityId: 2 });
      if (suffix === "/related-values") return reply(id === 1 ? {
        columns: [{ fieldKey: "parent", relatedFieldKey: "title", relatedFieldType: "text", editableColumn: true }, { fieldKey: "children", relatedFieldKey: "title", relatedFieldType: "text", editableColumn: true }],
        values: [{ recordId: 100, fieldKey: "parent", linkedRecordId: 300, value: "Order alpha", editable: true }, { recordId: 100, fieldKey: "children", linkedRecordIds: [], members: [], editable: true }],
      } : id === 3 ? { columns: [], values: [{ recordId: 300, fieldKey: "project", linkedRecordId: 400, value: "Project beta" }] } : { columns: [], values: [] });
    }
    if (path.startsWith("/api/records/")) return reply(records.find(r => r.id === Number(path.split("/").pop())));
    if (path.endsWith("/related-values")) return reply({ columns: [], values: [] });
    return reply([]);
  });
  await page.goto("/quick-fixture");
  await page.getByRole("button", { name: "0", exact: true }).first().click();
  await page.getByRole("button", { name: "Создать связанную запись" }).click();
  const dialog = page.getByTestId("quick-create-related-dialog");
  await expect(dialog.getByText("Customer gamma", { exact: true }).or(dialog.locator('input[value="Customer gamma"]'))).toBeVisible();
  await expect(dialog.getByText("Project beta", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Order alpha", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Manager delta", { exact: true })).toBeVisible();
  await expect(dialog.locator('input[value="Customer gamma"]')).toBeDisabled();
  await dialog.locator('input:not([disabled])').first().fill("New child");
  await dialog.getByRole("button", { name: /Save|Сохранить|Create|Создать/, exact: true }).click();
  await expect.poll(() => created).toBeTruthy();
  expect(created.valuesJson.customer).toBe("Customer gamma");
  expect(JSON.stringify(created.relationSelections)).toContain("400");
  expect(JSON.stringify(created.relationSelections)).toContain("300");
});