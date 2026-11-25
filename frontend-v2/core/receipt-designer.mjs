export function receiptSaleNumber(sale = {}) {
  const candidates = [sale.sales_id, sale.ticket_number, sale.receipt_number, sale.sale_number, sale.sales_number, sale.sale_id, sale.invoice_number, sale.invoice_id, sale.number];
  for (const value of candidates) {
    const text = String(value ?? '').trim();
    if (text && !/^[a-f0-9]{24}$/i.test(text)) return text;
  }
  const id = String(sale._id ?? '').trim();
  return id && !/^[a-f0-9]{24}$/i.test(id) ? id : '';
}

export function receiptSaleDate(sale = {}) {
  const candidates = [
    sale.date, sale.created_date, sale.createdAt, sale.created_at, sale.sale_date,
    sale.transaction_date, sale.sale_datetime, sale.sold_at, sale.invoice_date, sale.timestamp,
  ];
  let dateOnly = '';
  for (let raw of candidates) {
    if (raw == null || raw === '') continue;
    if (typeof raw === 'object') raw = raw.$date?.$numberLong ?? raw.$date ?? raw.$numberLong ?? raw;
    if (raw instanceof Date) {
      if (Number.isFinite(raw.getTime())) return raw.toLocaleString('fr-FR');
      continue;
    }
    const text = String(raw).trim();
    if (!text) continue;
    if (/^\d{1,2}[./-]\d{1,2}[./-]\d{4}\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?$/i.test(text)) return text;
    if (/^\d{1,2}[./-]\d{1,2}[./-]\d{4}$/.test(text) || /^\d{4}-\d{2}-\d{2}$/.test(text)) {
      if (!dateOnly) dateOnly = text;
      continue;
    }
    const date = typeof raw === 'number'
      ? new Date(Math.abs(raw) < 1e12 ? raw * 1000 : raw)
      : new Date(text);
    if (Number.isFinite(date.getTime())) return date.toLocaleString('fr-FR');
  }
  return dateOnly || 'Date non renseignée';
}

export function normalizeReceiptElements(elements) {
  const list = Array.isArray(elements) ? elements.map(item => ({ ...item })) : [];
  const defaults = [
    { id: 'logo', type: 'logo', x: 20, y: 2, w: 60, h: 13, fontFamily: 'Tahoma', fontWeight: 900 },
    { id: 'address', type: 'address', x: 5, y: 16, w: 90, h: 7, fontFamily: 'Tahoma', fontWeight: 900 },
    { id: 'date', type: 'date', x: 5, y: 24, w: 90, h: 4, fontFamily: 'Tahoma', fontWeight: 900 },
    { id: 'ticket', type: 'ticket', x: 5, y: 29, w: 90, h: 4, fontFamily: 'Tahoma', fontWeight: 900 },
    { id: 'cashier', type: 'cashier', x: 5, y: 34, w: 90, h: 4, fontFamily: 'Tahoma', fontWeight: 900 },
    { id: 'customer', type: 'customer', x: 5, y: 39, w: 90, h: 4, fontFamily: 'Tahoma', fontWeight: 900 },
    { id: 'items', type: 'items', x: 5, y: 45, w: 90, h: 36, fontFamily: 'Tahoma', fontWeight: 900 },
    { id: 'totals', type: 'totals', x: 5, y: 83, w: 90, h: 25, fontFamily: 'Tahoma', fontWeight: 900 },
    { id: 'note', type: 'note', x: 5, y: 110, w: 90, h: 6, fontFamily: 'Tahoma', fontWeight: 900 },
    { id: 'barcode', type: 'barcode', x: 15, y: 118, w: 70, h: 10, fontFamily: 'Tahoma', fontWeight: 900 },
  ];
  for (const item of list) {
    const fallback = defaults.find(entry => entry.type === item.type) || { x: 5, y: 5, w: 90, h: 6 };
    const number = (value, fallbackValue, min, max) => {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallbackValue;
    };
    item.x = number(item.x, fallback.x, -250, 300);
    item.y = number(item.y, fallback.y, -500, 1500);
    item.w = number(item.w ?? item.width, fallback.w, 1, 250);
    item.h = number(item.h ?? item.height, fallback.h, 1, 2000);
    item.fontSize = number(item.fontSize, 12, 5, 96);
  }
  for (const entry of defaults) if (!list.some(item => item.type === entry.type)) list.push({ ...entry });
  const items = list.find(item => item.type === 'items');
  const totals = list.find(item => item.type === 'totals');
  const ticket = list.find(item => item.type === 'ticket');
  return [...list.filter(item => item !== items && item !== totals && item !== ticket && !['discount', 'total', 'paid', 'balance', 'payment'].includes(item.type)), ticket, items, totals]
    .filter(Boolean)
    .sort((a, b) => Number(a.y || 0) - Number(b.y || 0));
}

export function moveReceiptElement(element, start, delta, bounds = {}) {
  const minX = Number.isFinite(bounds.minX) ? bounds.minX : -250;
  const maxX = Number.isFinite(bounds.maxX) ? bounds.maxX : 300;
  const minY = Number.isFinite(bounds.minY) ? bounds.minY : -500;
  const maxY = Number.isFinite(bounds.maxY) ? bounds.maxY : 1500;
  element.x = Math.max(minX, Math.min(maxX, start.x + delta.x));
  element.y = Math.max(minY, Math.min(maxY, start.y + delta.y));
  return element;
}
