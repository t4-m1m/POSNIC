'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { render: renderThermalReceipt } = require('../src/tysoo-prp300-receipt');
const { parse: parseThermalReceipt, asLines: thermalReceiptLines } = require('../src/escpos-preview');
const {
  receiptSaleNumber,
  receiptSaleDate,
  normalizeReceiptElements,
  moveReceiptElement,
} = require('../frontend-v2/core/receipt-designer.mjs');

test('receipt always prefers the human sale number over Mongo identifiers', () => {
  assert.equal(receiptSaleNumber({
    sales_id: '507f1f77bcf86cd799439011',
    _id: '507f1f77bcf86cd799439012',
    sale_number: '0000128',
  }), '0000128');
  assert.equal(receiptSaleNumber({ sales_id: 'S-128' }), 'S-128');
  assert.equal(receiptSaleNumber({ sales_id: '507f1f77bcf86cd799439011', _id: '507f1f77bcf86cd799439012' }), '');
});

test('receipt date uses a timestamp when the first sale date field contains only a date', () => {
  const value = receiptSaleDate({
    date: '2026-11-25',
    created_at: '2026-11-25T11:42:00.000Z',
  });
  assert.match(value, /11:42/);
});

test('receipt date skips midnight date placeholders when an actual creation timestamp exists', () => {
  const value = receiptSaleDate({
    date: '2026-11-25T00:00:00.000Z',
    createdAt: '2026-11-25T11:42:00.000Z',
  });
  assert.match(value, /11:42/);
  const dateObjectValue = receiptSaleDate({
    date: new Date(Date.UTC(2026, 10, 25)),
    created_at: '2026-11-25T11:42:00.000Z',
  });
  assert.match(dateObjectValue, /11:42/);
});

test('receipt date parses Mongo Extended JSON millisecond timestamps', () => {
  const value = receiptSaleDate({
    date: { $date: { $numberLong: String(Date.UTC(2026, 10, 20, 10, 15)) } },
  });
  assert.match(value, /20\/11\/2026/);
});

test('F6 receipt uses the original sale timestamp instead of the later settlement date', () => {
  const value = receiptSaleDate({
    versement_checkout: { initial_amount: 1000 },
    created_date: '2026-11-20T10:15:00.000Z',
    date: '2026-11-24T18:30:00.000Z',
  });
  assert.match(value, /20\/11\/2026/);
});

test('receipt date uses the original sale date and preserves local date/time strings', () => {
  assert.equal(receiptSaleDate({
    date: '25/11/2026 10:42 AM',
    created_date: '25/11/2026 11:00 AM',
  }), '25/11/2026 10:42 AM');
  assert.notEqual(receiptSaleDate({ created_date: '2026-11-25T10:42:00.000Z' }), 'Date non renseignée');
  assert.equal(receiptSaleDate({ updated_date: '2026-11-26T08:00:00.000Z' }), 'Date non renseignée');
});

test('receipt artwork keeps negative top/left offsets and larger printer fonts after normalization', () => {
  const [logo] = normalizeReceiptElements([{ id: 'logo', type: 'logo', x: -12, y: -18, w: 120, h: 20, fontSize: 64 }]);
  assert.equal(logo.x, -12);
  assert.equal(logo.y, -18);
  assert.equal(logo.w, 120);
  assert.equal(logo.fontSize, 64);
});

test('dragging an image can move its top edge beyond the paper edge', () => {
  const logo = { x: 5, y: 2 };
  moveReceiptElement(logo, { x: 5, y: 2 }, { x: 0, y: -20 });
  assert.equal(logo.y, -18);
});

test('thermal sale receipts wrap long baskets, retain every line and emphasize the total', () => {
  const longName = 'MANTEAU SAMARINA COLLECTION HIVER MODELE 2026 TAILLE XL COULEUR NOIR';
  const bytes = renderThermalReceipt({
    billNo: '0000456',
    date: '26/11/2026 14:35',
    storeName: 'SAMARINA',
    cashier: 'AMINE',
    customer: ['Client: HADDAD NAJIMA'],
    items: Array.from({ length: 28 }, (_, index) => ({
      name: index === 0 ? longName : 'ARTICLE TEST ' + (index + 1),
      qty: 1,
      rate: 1000,
      amount: 1000,
    })),
    subTotal: 28000,
    total: 28000,
    payments: [{ label: 'Cash', amount: 26000 }, { label: 'Credit', amount: 2000 }],
    design: { showBarcode: true, totalSize: 'large', totalBold: true, boldItemNames: true, boldItemAmounts: true },
  }, { paperWidth: '80', cut: true });
  const lines = thermalReceiptLines(parseThermalReceipt(bytes, 48)).join('\n');
  assert.match(lines, /MANTEAU SAMARINA/);
  assert.match(lines, /ARTICLE TEST 28/);
  assert.match(lines, /TOTAL/);
  assert.match(lines, /Cash/);
  assert.match(lines, /Credit/);
  assert.ok(parseThermalReceipt(bytes, 48).rows.length > 70, 'long baskets must extend the roll instead of being clipped');
});

test('V2 receipt and label screens wire the corrected values into preview and print', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'frontend-v2/core/app.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'frontend-v2/styles/app.css'), 'utf8');
  assert.match(app, /receiptSaleNumber\(sale\)/);
  assert.match(app, /function normalizeReceiptElements\(elements\)/, 'printer settings must use a local normalizer and never depend on a stale module binding');
  assert.ok((app.match(/normalizeReceiptElements\(/g) || []).length >= 3, 'printer settings and both receipt studio paths must use the local normalizer');
  assert.match(app, /async function resolveLabelPrinterName\(/);
  assert.match(app, /async function hydrateLabelPrintItem\(/, 'label routes must fetch the full priced item before rendering');
  assert.match(app, /async function sendLabelPrintJob\(/, 'V2 labels must use the shared V1 HTML printer bridge');
  assert.match(app, /pageSize:'custom',customPageSize:\{width:Number\(width\),height:Number\(height\)\}/, 'label jobs must use the V1 custom-paper print contract');
  assert.ok(app.includes('find(name=>/tsc.*tdp.?225|tdp.?225.*tsc/i.test(name))'), 'label printing must restore the V1 TSC TDP-225 auto-selection');
  assert.match(app, /sendLabelPrintJob\(html,state\.labelLayout\.paper===\x27a4\x27\?210:width/, 'label studio must use the shared V1 label print route and dedicated printer');
  assert.match(app, /date,\s*storeName:/, 'the real ticket payload must use the resolved transaction date and shop header');
  assert.match(app, /stock_deferred:true/, 'F6 must persist the deferred-stock flag consumed by the settlement controller');
  assert.match(app, /async function printSaleReceiptDocument[\s\S]*?bridge\.print\(html,printOptions\)/, 'new and reprinted V2 sales must use the saved Receipt Studio HTML through the fast Windows printer driver');
  assert.match(app, /sale-payment-chip/, 'split payment methods must be visible as chips in the sales status');
  assert.doesNotMatch(app, /receipt-thermal-preview|Aperçu réel de l’imprimante|ESC\/POS/, 'Receipt Studio must not expose the unwanted ESC/POS preview');
  assert.match(app, /boldItemNames:true/);
  assert.match(app, /boldItemAmounts:true/);
  assert.match(app, /date:savedSale\.date\|\|savedSale\.created_date/);
  assert.doesNotMatch(app, /sales_description:payload\.sales_description,date:new Date\(\)\.toLocaleString/);
  assert.doesNotMatch(app, /font-size:inherit!important;font-weight:inherit!important/, 'basket and total child typography must not be flattened to the parent font');
  assert.match(app, /data-receipt-height=/, 'receipt height must grow with basket and totals content');
  const receiptPrintStart = app.indexOf('async function printSaleReceiptDocument');
  const receiptPrintEnd = app.indexOf('async function printStudio', receiptPrintStart);
  assert.ok(receiptPrintStart >= 0 && receiptPrintEnd > receiptPrintStart);
  const receiptPrintBody = app.slice(receiptPrintStart, receiptPrintEnd);
  assert.ok(receiptPrintBody.includes('bridge.print(html,printOptions)') && receiptPrintBody.includes('forceHtml:true') && !receiptPrintBody.includes('printReceipt('), 'the real sale receipt must use the fast Windows HTML printer route, never raw ESC/POS');
  assert.ok(app.includes("printSaleReceiptDocument(receiptSale,{copies:2,source:'F6 Versement'"), 'F6 must print through the same dynamic ticket payload');
  assert.match(app, /salePaymentMethods\(x\)/, 'split tender methods must be visible under the sales status');
  assert.match(app, /Payé · Versement/, 'settled F6 sales must be marked as Versement in history');
  assert.match(app, /art\.style\.width=state\.labelLayout\.width\+'mm'/);
  assert.match(app, /art\.style\.height=state\.labelLayout\.height\+'mm'/);
  assert.ok(app.includes('legacyPortraitDefault?45'));
  assert.ok(app.includes('legacyPortraitDefault?35'));
  assert.ok(app.includes("date:savedSale.date||savedSale.created_date||savedSale.createdAt||savedSale.created_at||savedSale.sale_date||savedSale.transaction_date||payload.date||payload.created_date||payload.created_at||payload.sale_date||''"));
  assert.match(css, /#receipt-artboard\{overflow:visible!important\}/);
  assert.match(css, /#receipt-artboard \.receipt-items-block/);
});


test('V2 visible UI fixes are loaded by cache-busted assets and viewport-pinned sidebar', () => {
 const app=fs.readFileSync(path.join(__dirname,'..','frontend-v2/core/app.js'),'utf8');
 const html=fs.readFileSync(path.join(__dirname,'..','frontend-v2/index.html'),'utf8');
 const css=fs.readFileSync(path.join(__dirname,'..','frontend-v2/styles/app.css'),'utf8');
 const scroll=fs.readFileSync(path.join(__dirname,'..','frontend-v2/styles/scroll-recovery.css'),'utf8');
 const start=app.indexOf('function renderReceiptStudioDocument(sale,layout)');
 const end=app.indexOf('function refreshReceiptDesignerPreview()',start);
 const renderer=app.slice(start,end);
 assert.ok(renderer.includes("let css='@page"),'designer preview CSS must be mutable');
 assert.ok(!renderer.includes("const css='@page"),'const reassignment must not crash Printer Settings');
 assert.ok(html.includes('styles/app.css?v=2.0.0-rebrand.23'));
 assert.ok(html.includes('styles/scroll-recovery.css?v=2.0.0-rebrand.23'));
 assert.ok(html.includes('core/app.js?v=2.0.0-rebrand.23'));
 assert.ok(scroll.includes('.shell:not(.caisse-lock)>.rail{position:fixed!important'));
 assert.ok(scroll.includes('.shell:not(.caisse-lock)>.rail>.rail-bottom{position:absolute!important'));
 assert.ok(app.includes('topbar-quick-actions'),'Acompte and Dépenses stay in the top bar');
 assert.ok(css.includes('.receipt-totals-block>div{border:0!important'));
 assert.ok(!renderer.includes('border:1px solid #2563eb'));
 assert.ok(!renderer.includes('border:2px solid #2563eb'));
});
