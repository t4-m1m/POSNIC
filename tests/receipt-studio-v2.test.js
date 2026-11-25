'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
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

test('V2 receipt and label screens wire the corrected values into preview and print', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'frontend-v2/core/app.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'frontend-v2/styles/app.css'), 'utf8');
  assert.match(app, /receiptSaleNumber\(sale\)/);
  assert.match(app, /receipt_date:receiptSaleDate\(sale\)/);
  assert.match(app, /date:savedSale\.date\|\|savedSale\.created_date/);
  assert.doesNotMatch(app, /sales_description:payload\.sales_description,date:new Date\(\)\.toLocaleString/);
  assert.match(app, /font-size:inherit!important;font-weight:inherit!important/);
  assert.match(app, /art\.style\.width=state\.labelLayout\.width\+'mm'/);
  assert.match(app, /art\.style\.height=state\.labelLayout\.height\+'mm'/);
  assert.ok(app.includes('legacyPortraitDefault?45'));
  assert.ok(app.includes('legacyPortraitDefault?35'));
  assert.ok(app.includes("date:savedSale.date||savedSale.created_date||savedSale.createdAt||savedSale.created_at||savedSale.sale_date||savedSale.transaction_date||payload.date||payload.created_date||payload.created_at||payload.sale_date||''"));
  assert.match(css, /#receipt-artboard\{overflow:visible!important\}/);
  assert.match(css, /#receipt-artboard \.receipt-items-block/);
});
