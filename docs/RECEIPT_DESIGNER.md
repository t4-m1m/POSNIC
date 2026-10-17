# Receipt printing foundation

The legacy Receipt Studio editor has been retired. Its user interface and editor
implementation are removed; this document no longer describes an available
designer.

The existing printing foundation is intentionally retained while a replacement
designer and printer workflow are developed:

- `frontend/static/script/js/core/receipt-designer.js` remains the receipt
  rendering and print adapter used by the current sale-printing flow.
- `frontend/static/script/js/core/print-settings.js` retains per-computer
  printer selection, paper size, copies, print mode, and test-print handling.
- `src/hardware-manager.js` and its related receipt modules retain the desktop
  printer integration and the existing print submission/recovery behavior.
- `frontend/static/script/js/core/receipt-data.js` and the ESC/POS modules
  remain separate legacy/raw-print paths; they have not been replaced or removed.

No new designer has been added in this change. The retained renderer and printer
paths are compatibility foundations only; the new designer/printer will be
implemented separately and should not be coupled to the retired editor UI.
