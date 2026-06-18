---
name: Popover content must cap height and scroll
description: The base ui/popover.tsx had no height cap, so long popover-based dropdowns ran off-screen with no scroll; Select/DropdownMenu already cap height — keep all three in sync.
---

# Popover dropdowns overflowing the viewport

The shadcn `ui/select.tsx` (`SelectContent`) and `ui/dropdown-menu.tsx`
(`DropdownMenuContent`) both cap their height with
`max-h-[var(--radix-<name>-content-available-height)] overflow-y-auto`, so long
option lists scroll inside the viewport. The base `ui/popover.tsx`
(`PopoverContent`) originally did NOT — so every popover-driven dropdown in the
app (filter value pickers, role/field checklists, icon picker, etc.) could grow
taller than the screen with no way to scroll the off-screen items.

**Rule:** the base `PopoverContent` must carry
`max-h-[var(--radix-popover-content-available-height)] overflow-y-auto` (plus a
small default `collisionPadding`), mirroring Select/DropdownMenu. Fixing it once
on the base component fixes every consumer at once — do NOT patch individual
popovers.

**Why:** Radix only exposes `--radix-*-content-available-height` when collision
avoidance is on (default), and it equals the space between the trigger and the
viewport edge. Without binding it to `max-h` + `overflow-y-auto`, the content has
no height limit and silently overflows. Consumers that already wrap their list in
a fixed-height `ScrollArea` (e.g. FilterValuePicker `max-h-64`) stay unaffected —
the inner cap is smaller, so the outer scroll never engages.
