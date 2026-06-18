---
name: tailwind-v4-css-var-arbitrary
description: Tailwind v4 dropped the bare [--var] arbitrary shorthand; shadcn classes that reference CSS vars must use [var(--var)] or they silently emit invalid CSS.
---

# Tailwind v4: CSS-variable arbitrary values need explicit `var()`

erp-platform is on **Tailwind v4** (`^4.1.14`).

**Rule:** when an arbitrary utility value references a CSS custom property, write `class-[var(--my-var)]` (or the v4 paren shorthand `class-(--my-var)`). The bare v3-era form `class-[--my-var]` is **no longer auto-wrapped in `var()`** in v4 — it compiles to invalid CSS (e.g. `max-height: --radix-...`) and the rule is silently dropped.

**Why:** the stock shadcn/ui components were authored for Tailwind v3 and ship classes like `max-h-[--radix-select-content-available-height]` and `origin-[--radix-*-transform-origin]`. Under v4 these produced no `max-height`, so Radix Select/Context-menu/Dropdown content grew unbounded past the viewport with **no scroll cap** — long dropdowns (e.g. the field picker in the view-config editor) ran off-screen and couldn't be scrolled. The width worked only because its class already used explicit `var()` (`min-w-[var(--radix-select-trigger-width)]`).

**How to apply:**
- Any shadcn/Radix `ui/*` component copied from v3 docs/registry must have its `[--radix-*]` (and any `[--foo]`) arbitrary values converted to `[var(--radix-*)]` before it works under v4. Sweep: `rg "\[--" artifacts/erp-platform/src/components/ui/`.
- This applies to ALL Radix popper surfaces: select, dropdown-menu, context-menu, menubar, popover, hover-card, tooltip (`*-content-available-height` for scroll caps, `*-content-transform-origin` for animation origin).
- Don't "fix" dropdown scrolling by pinning a fixed Viewport height — the correct cap is `max-h-[var(--radix-*-content-available-height)]` + `overflow-y-auto` on Content, which adapts to available space below/above the trigger.
