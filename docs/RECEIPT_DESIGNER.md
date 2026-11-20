# Receipt Printing Studio

The current Receipt Printing Studio is available from the desktop settings and edits the same receipt design data used by the shared receipt renderer.

## Design behavior

- Every block is optional. Store details, transaction details, item rows, and totals are provided in the default template, but the owner may remove any block or arrange the remaining blocks freely.
- Each paper format keeps its own layout. Thermal formats and sheet formats can be customized independently.
- Blocks can be added, selected, reordered, duplicated, removed, resized, repositioned, and rotated. Supported text, image, logo, barcode, QR, divider, dynamic-field, and signature blocks are validated before saving.
- Uploaded receipt images are stored as bounded PNG/JPEG/WebP data URLs. Dynamic field names, font families, sizes, and geometry are allow-listed by the shared design contract.
- A blank or intentionally minimal design is valid. It is the store owner's responsibility to include the information they want printed.

## Printing compatibility

- `frontend/static/script/js/core/receipt-designer.js` is the shared renderer and print adapter.
- `frontend/static/script/js/modules/js/receipt-studio.js` is the visual editor.
- `frontend/static/script/js/core/print-settings.js` retains per-computer printer selection, paper size, copies, print mode, and test-print handling.
- The desktop printer integration and native receipt path remain in `src/hardware-manager.js` and the related receipt modules.

The Studio should continue to use the shared print path rather than introducing a separate receipt implementation, so preview, test print, and real sales receipts remain consistent.
