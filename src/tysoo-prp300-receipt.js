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
  const design = { ...(sale.design || {}) };
  const chunks = [];
  const bytes = (...values) => chunks.push(Buffer.from(values));
  const text = (value) => { const str = ascii(value); if (str) chunks.push(Buffer.from(str, 'ascii')); };
  const line = (value = '') => { text(value); bytes(0x0a); };
  const wrapped = (value) => wrap(value, width).forEach(line);
  const align = (value) => ({ left: 0, center: 1, right: 2 }[value] ?? 0);
  const aligned = (value, where = design.alignment || 'left') => {
    bytes(ESC, 0x61, align(where));
    wrap(value, width).forEach(line);
    bytes(ESC, 0x61, 0);
  };
  const centre = (value) => aligned(value, 'center');
  const rule = (char = (design.separator || '-')) => line(char.repeat(width));
  const money = (n) => {
    const digits = Number.isInteger(sale.currencyDigits) && sale.currencyDigits >= 0 && sale.currencyDigits <= 4 ? sale.currencyDigits : 2;
    const symbol = ascii(sale.currency || 'DA');
    return (design.currencyFirst === false ? Number(n || 0).toFixed(digits) + ' ' + symbol : symbol + ' ' + Number(n || 0).toFixed(digits));
  };
  const pair = (left, right) => line(fitPair(left, right, width));
  const qtyText = (n) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 3 });
  bytes(ESC, 0x40, ESC, 0x61, 1);
  if (design.logoText || sale.storeName) {
    bytes(ESC, 0x45, design.boldStoreName === false ? 0 : 1);
    const storeLines = String(design.logoText || sale.storeName).split(/\\r?\\n/);
    storeLines.forEach(centre);
    bytes(ESC, 0x45, 0);
  }
  if (sale.storeAddress && design.showAddress !== false) String(sale.storeAddress).split(/\\r?\\n/).forEach(centre);
  if (sale.storePhone && design.showPhone !== false) centre('Tel: ' + sale.storePhone);
  if (sale.storeEmail && design.showEmail) centre(sale.storeEmail);
  bytes(ESC, 0x61, 0);
  if (design.headerRule !== false) rule(design.separator || '=');
  if (sale.title && design.showTitle !== false) {
    bytes(ESC, 0x61, align(design.titleAlignment || 'center'));
    if (design.titleBold !== false) bytes(ESC, 0x45, 1);
    const scale = ({ normal: 0, large: 0x10, extra: 0x11 }[design.titleSize] ?? 0x10);
    bytes(GS, 0x21, scale);
    wrapped(sale.title);
    bytes(GS, 0x21, 0, ESC, 0x45, 0, ESC, 0x61, 0);
  }
  if (design.showTicket !== false && sale.billNo) pair('Ticket', sale.billNo);
  if (design.showDate !== false && sale.date) pair('Date', sale.date);
  if (design.showCashier !== false && sale.cashier) pair('Cashier', sale.cashier);
  if (design.showBranch && sale.branch) pair('Branch', sale.branch);
  if (design.showCustomer !== false) {
    const customers = Array.isArray(sale.customer) ? sale.customer : (sale.customer ? [sale.customer] : []);
    for (const customer of customers) wrapped('Customer: ' + customer);
  }
  if (design.itemsHeader !== false) {
    rule(design.separator || '-');
    pair('Article x Qte', 'Montant');
    rule(design.separator || '-');
  }
  for (const item of sale.items || []) {
    const name = ascii(item.name || 'Article');
    wrapped(name);
    if (design.showVariant && item.variant) wrapped('  ' + item.variant);
    const qty = qtyText(item.qty);
    const rate = Number(item.rate || 0);
    const amount = Number(item.amount == null ? Number(item.qty || 0) * rate : item.amount);
    const left = design.showUnitPrice === false ? 'x ' + qty : qty + ' x ' + rate.toFixed(2);
    pair(left, money(amount));
  }
  rule(design.separator || '-');
  if (design.showTotalQty && sale.totalQty != null) pair('Total articles', String(sale.totalQty));
  if (design.showSubtotal !== false && sale.subTotal != null) pair('Sous-total', money(sale.subTotal));
  if (design.showTaxes !== false) for (const tax of sale.taxes || []) pair(tax.label || 'Taxe', money(tax.amount));
  if (design.showDiscount !== false && sale.discount) pair('Remise', '-' + money(sale.discount));
  if (sale.roundOff && design.showRoundOff) pair('Arrondi', money(sale.roundOff));
  if (design.totalRule !== false) rule(design.separator || '=');
  bytes(ESC, 0x45, design.totalBold === false ? 0 : 1, GS, 0x21, design.totalSize === 'normal' ? 0 : design.totalSize === 'extra' ? 0x11 : 0x10);
  pair('TOTAL', money(sale.total));
  bytes(GS, 0x21, 0, ESC, 0x45, 0);
  if (design.totalRule !== false) rule(design.separator || '=');
  if (design.showPayments !== false) for (const payment of sale.payments || []) pair(payment.label || 'Paiement', money(payment.amount));
  if (design.showChange !== false && sale.change != null) pair('Monnaie rendue', money(sale.change));
  for (const extra of sale.extras || []) pair(extra.label || '', extra.value || '');
  if (design.showBarcode && sale.billNo) {
    const barcode = ascii(sale.billNo).replace(/[^0-9A-Za-z _.$/+%-]/g, '').slice(0, 32);
    if (barcode) {
      bytes(ESC, 0x61, 1, GS, 0x48, 2, GS, 0x77, Math.max(2, Math.min(4, Number(design.barcodeWidth) || 2)), GS, 0x68, Math.max(40, Math.min(120, Number(design.barcodeHeight) || 55)));
      bytes(GS, 0x6b, 73, barcode.length);
      chunks.push(Buffer.from(barcode, 'ascii'));
      bytes(0x0a, ESC, 0x61, 1);
      if (design.showBarcodeText !== false) centre(barcode);
      bytes(ESC, 0x61, 0);
    }
  }
  if (design.showNote !== false && design.note) String(design.note).split(/\\r?\\n/).forEach(centre);
  if (sale.footer) String(sale.footer).split(/\\r?\\n/).forEach(centre);
  else if (sale.showThanks !== false) centre('Thank you, please visit again');
  bytes(0x0a, 0x0a, 0x0a);
  if (options.openDrawer) bytes(ESC, 0x70, 0x00, 0x19, 0xfa);
  if (options.cut !== false) bytes(GS, 0x56, 0x00);
  return Buffer.concat(chunks);
}
module.exports = { render, WIDTHS };
