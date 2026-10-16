'use strict';

/*
 * Minimal ESC/POS receipt output for the Tysoo PRP-300 and compatible 80mm
 * thermal printers. Text-only by design: no Chromium screenshots, raster
 * strips, downloaded glyphs, QR images, or HTML sent to the printer queue.
 * Printable content is ASCII before bytes are created.
 */
const ESC = 0x1b;
const GS = 0x1d;
const WIDTHS = { '58': 32, '80': 48, '112': 69 };

function ascii(value) {
  return String(value == null ? '' : value)
    .replace(/€/g, ' EUR ')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7e]/g, '?')
    .replace(/\s+/g, ' ')
    .trim();
}

function wrap(value, width) {
  const words = ascii(value).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    if (word.length > width) {
      if (line) lines.push(line);
      line = '';
      for (let i = 0; i < word.length; i += width) lines.push(word.slice(i, i + width));
      continue;
    }
    if (line && line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else {
      line += (line ? ' ' : '') + word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function fitPair(left, right, width) {
  const r = ascii(right).slice(0, Math.floor(width * 0.55));
  const l = ascii(left).slice(0, Math.max(1, width - r.length - 1));
  return l + ' '.repeat(Math.max(1, width - l.length - r.length)) + r;
}

function render(sale = {}, options = {}) {
  const paperWidth = ['58', '80', '112'].includes(String(options.paperWidth)) ? String(options.paperWidth) : '80';
  const width = WIDTHS[paperWidth];
  const chunks = [];
  const bytes = (...values) => chunks.push(Buffer.from(values));
  const text = (value) => {
    const str = ascii(value);
    if (str) chunks.push(Buffer.from(str, 'ascii'));
  };
  const line = (value = '') => { text(value); bytes(0x0a); };
  const wrapped = (value) => wrap(value, width).forEach(line);
  const centre = (value) => wrap(value, width).forEach((v) => line(' '.repeat(Math.max(0, Math.floor((width - v.length) / 2))) + v));
  const rule = (char = '-') => line(char.repeat(width));
  const money = (n) => {
    const digits = Number.isInteger(sale.currencyDigits) && sale.currencyDigits >= 0 && sale.currencyDigits <= 4 ? sale.currencyDigits : 2;
    const symbol = ascii(sale.currency || 'DA');
    return symbol + ' ' + Number(n || 0).toFixed(digits);
  };

  // ESC @ initialize; ESC t 0 is deliberately not relied on for any glyph.
  bytes(ESC, 0x40, ESC, 0x61, 1);
  if (sale.storeName) { bytes(ESC, 0x45, 1); centre(sale.storeName); bytes(ESC, 0x45, 0); }
  if (sale.storeAddress) String(sale.storeAddress).split(/\r?\n/).forEach(centre);
  if (sale.storePhone) centre('Tel: ' + sale.storePhone);
  if (sale.storeEmail) centre(sale.storeEmail);
  bytes(ESC, 0x61, 0);
  rule('=');
  if (sale.title) { bytes(ESC, 0x45, 1); centre(sale.title); bytes(ESC, 0x45, 0); }
  if (sale.billNo) line('Bill: ' + sale.billNo);
  if (sale.date) line('Date: ' + sale.date);
  if (sale.cashier) line('Cashier: ' + sale.cashier);
  if (sale.branch) line('Branch: ' + sale.branch);
  const customers = Array.isArray(sale.customer) ? sale.customer : (sale.customer ? [sale.customer] : []);
  for (const customer of customers) wrapped(customer);
  rule('-');

  for (const item of sale.items || []) {
    const name = ascii(item.name || 'Item');
    wrapped(name);
    const qty = Number(item.qty || 0);
    const rate = item.rate == null ? '' : Number(item.rate || 0).toFixed(2);
    const amount = money(item.amount == null ? qty * Number(item.rate || 0) : item.amount);
    line(fitPair('  ' + qty + (rate ? ' x ' + rate : ''), amount, width));
  }
  rule('-');
  if (sale.totalQty != null) line(fitPair('Total Qty', String(sale.totalQty), width));
  if (sale.subTotal != null) line(fitPair('Subtotal', money(sale.subTotal), width));
  for (const tax of sale.taxes || []) line(fitPair(tax.label || 'Tax', money(tax.amount), width));
  if (sale.discount) line(fitPair('Discount', '-' + money(sale.discount), width));
  if (sale.roundOff) line(fitPair('Round off', money(sale.roundOff), width));
  rule('=');
  bytes(ESC, 0x45, 1, GS, 0x21, 0x10);
  line(fitPair('TOTAL', money(sale.total), width));
  bytes(GS, 0x21, 0x00, ESC, 0x45, 0);
  rule('=');
  for (const payment of sale.payments || []) line(fitPair(payment.label || 'Payment', money(payment.amount), width));
  if (sale.change != null) line(fitPair('Change', money(sale.change), width));
  for (const extra of sale.extras || []) { line(fitPair(extra.label || '', extra.value || '', width)); }
  if (sale.footer) String(sale.footer).split(/\r?\n/).forEach(centre);
  else if (sale.showThanks !== false) centre('Thank you, please visit again');
  bytes(0x0a, 0x0a, 0x0a);
  if (options.openDrawer) bytes(ESC, 0x70, 0x00, 0x19, 0xfa);
  if (options.cut !== false) bytes(GS, 0x56, 0x00);
  return Buffer.concat(chunks);
}

module.exports = { render, WIDTHS };
