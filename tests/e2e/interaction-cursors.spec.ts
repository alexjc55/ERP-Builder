import { expect, test } from "@playwright/test";

test("ERP controls show pointer cursors without changing text, disabled or drag controls", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    const fixture = document.createElement("div");
    fixture.id = "cursor-fixture";
    fixture.innerHTML = `
      <button data-testid="cursor-button"><svg data-testid="cursor-icon"></svg>Action</button>
      <a data-testid="cursor-link" href="#cursor-fixture">Link</a>
      <div data-testid="cursor-menu" role="menuitem" class="cursor-default">Action</div>
      <div data-testid="cursor-option" role="option" class="cursor-default">Option</div>
      <button data-testid="cursor-tab" role="tab">Tab</button>
      <input data-testid="cursor-checkbox" type="checkbox">
      <select data-testid="cursor-select"><option>Option</option></select>
      <label data-testid="cursor-label" for="cursor-text">Label</label>
      <input id="cursor-text" data-testid="cursor-text" type="text">
      <button data-testid="cursor-disabled" disabled>Disabled</button>
      <div data-testid="cursor-disabled-menu" role="menuitem" data-disabled class="cursor-default">Disabled</div>
      <button data-testid="cursor-grab" class="cursor-grab">Drag</button>
      <button data-testid="cursor-resize" class="cursor-col-resize">Resize</button>
      <div data-testid="cursor-cell" data-clickable>Open editor</div>`;
    document.body.append(fixture);
  });
  for (const id of ["button", "icon", "link", "menu", "option", "tab", "checkbox", "select", "label", "cell"])
    await expect(page.getByTestId(`cursor-${id}`)).toHaveCSS("cursor", "pointer");
  for (const id of ["disabled", "disabled-menu"])
    await expect(page.getByTestId(`cursor-${id}`)).toHaveCSS("cursor", "not-allowed");
  await expect(page.getByTestId("cursor-text")).toHaveCSS("cursor", "text");
  await expect(page.getByTestId("cursor-grab")).toHaveCSS("cursor", "grab");
  await expect(page.getByTestId("cursor-resize")).toHaveCSS("cursor", "col-resize");
});