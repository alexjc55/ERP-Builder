---
name: Dialog outside-click policy
description: Why modal dialogs must not close on outside clicks (data loss via open dropdowns).
---
- Base ui/dialog.tsx DialogContent preventDefaults onPointerDownOutside/onInteractOutside: modals close ONLY via X / Cancel / Escape.
- **Why:** with a Select/Popover open inside a dialog, stray clicks land on the overlay; the next overlay click silently closed the whole form and lost user input (on prod's older Radix it could happen in one step).
- **How to apply:** keep this in the BASE component, not per-dialog. Escape stays correct: first Esc closes the dropdown, second closes the dialog. Consumers can still override via props (spread after the defaults).
