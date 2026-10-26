'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6Z1AAAAAASUVORK5CYII=';

test('saved Receipt Studio sale uses the Chromium printer-driver path and preserves sale data', async t => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://localhost/', runScripts: 'outside-only'
  });
  t.after(() => dom.window.close());
  const w = dom.window;
  w.$ = w.jQuery = require('jquery')(w);
  w.PosnicPro = {
    escapeHtml: value => w.$('<i>').text(value == null ? '' : String(value)).html(),
    local: { get: key => key === 'currencySign' ? 'DA ' : '', set: () => {} },
    i18n: { t: (_key, fallback) => fallback },
    resolveReceiptPrinter: () => 'Counter',
    afterPrint: () => {}
  };
  let printedHtml = '', printOptions = null;
  w.electronAPI = {
    diagnostics: { event: () => Promise.resolve() },
    printer: {
      getDefault: async () => ({ name: 'Counter' }),
      print: async (html, options) => {
        printedHtml = html;
        printOptions = options;
        return { success: true };
      }
    }
  };
  w.eval(read('api/src/helpers/sale-payment-summary.js'));
  w.eval(read('api/src/helpers/receipt-design.js'));
  w.eval(read('src/receipt-page-layout.js'));
  w.eval(read('frontend/static/script/js/core/receipt-designer.js'));
  const engine = w.PosnicPro.receiptDesigner;
  const branch = { branch_name: 'My Shop', logo: pixel, print_logoimg: true, footer_print: 'Thank you' };
  const design = engine.defaults(branch);
  const sale = {
    ...branch, receipt_designs: design, sales_id: 'S0000123',
    created_date: '26/10/2026 17:00', receipt_date: '26/10/2026 17:00',
    customer_name: 'Sample Customer',
    items: [{ item_name: 'Test item', item_price: 125, item_quantity: 2, item_unit: 'ea', total_amount: 250 }],
    items_subtotal: 250, items_total: 250, tax: 0, discount: 0, payment_mode: 'Cash'
  };
  const result = await engine.printSale(sale, '80', false, {
    preserveWorkspace: true, propagateFailure: true
  });
  assert.equal(result.success, true);
  assert.equal(printOptions.thermalRaster, false,
    'saved Studio layouts must use the same Chromium/driver rendering path as the working sample');
  assert.equal(printOptions.pageSize, '80mm');
  assert.equal(printOptions.silent, true);
  assert.match(printedHtml, /Test item/);
  assert.match(printedHtml, /S0000123/);
  assert.match(printedHtml, /250/);
});
