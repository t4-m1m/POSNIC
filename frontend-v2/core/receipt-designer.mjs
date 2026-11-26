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
  const ordinaryCandidates = [
    sale.date, sale.created_date, sale.createdAt, sale.created_at, sale.sale_date,
    sale.transaction_date, sale.sale_datetime, sale.sold_at, sale.invoice_date, sale.timestamp,
  ];
  // F6 settlement updates sales.date to the final-payment day. The immutable
  // created_date remains the original sale timestamp and must win on its ticket.
  const candidates = sale.versement_checkout
    ? [sale.created_date, sale.createdAt, sale.created_at, sale.date, sale.sale_date,
       sale.transaction_date, sale.sale_datetime, sale.sold_at, sale.invoice_date, sale.timestamp]
    : ordinaryCandidates;
  let dateOnly = '';
  for (let raw of candidates) {
    if (raw == null || raw === '') continue;
    if (typeof raw === 'object') raw = raw.$date?.$numberLong ?? raw.$date ?? raw.$numberLong ?? raw;
    if (raw instanceof Date) {
      if (!Number.isFinite(raw.getTime())) continue;
      if (raw.getUTCHours() === 0 && raw.getUTCMinutes() === 0 && raw.getUTCSeconds() === 0) {
        if (!dateOnly) dateOnly = raw.toLocaleDateString('fr-FR');
        continue;
      }
      return raw.toLocaleString('fr-FR');
    }
    const text = String(raw).trim();
    if (!text) continue;
    if (/^\d{1,2}[./-]\d{1,2}[./-]\d{4}\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?$/i.test(text)) return text;
    if (/^\d{1,2}[./-]\d{1,2}[./-]\d{4}$/.test(text) || /^\d{4}-\d{2}-\d{2}$/.test(text)) {
      if (!dateOnly) dateOnly = text;
      continue;
    }
    if (/^\d{4}-\d{2}-\d{2}[T ]00:00:00(?:\.000)?(?:Z|[+-]00:00)?$/i.test(text)) {
      if (!dateOnly) dateOnly = text.slice(0, 10);
      continue;
    }
    const numericTimestamp = typeof raw === 'number' ? raw : (/^\d{10,}$/.test(text) ? Number(text) : null);
    const date = numericTimestamp !== null
      ? new Date(Math.abs(numericTimestamp) < 1e12 ? numericTimestamp * 1000 : numericTimestamp)
      : new Date(text);
    if (Number.isFinite(date.getTime())) {
      if (date.getUTCHours() === 0 && date.getUTCMinutes() === 0 && date.getUTCSeconds() === 0) {
        if (!dateOnly) dateOnly = date.toLocaleDateString('fr-FR');
        continue;
      }
      return date.toLocaleString('fr-FR');
    }
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

export function receiptAmountDue(sale = {}) {
  const total = Math.max(0, Number(sale.sale_original_total ?? sale.sales_total ?? sale.total ?? sale.total_amount ?? 0) || 0);
  if (!total) return 0;
  if (sale.versement_checkout) {
    if (sale.versement_settled === true || String(sale.versement_settled).toLowerCase() === 'true') return 0;
    const explicitRemaining = sale.versement_remaining ?? sale.versement_checkout?.reste;
    if (explicitRemaining !== undefined && explicitRemaining !== null && explicitRemaining !== '') {
      return Math.min(total, Math.max(0, Number(explicitRemaining) || 0));
    }
    const initial = Math.max(0, Number(sale.versement_initial_amount ?? sale.versement_checkout?.initial_amount ?? 0) || 0);
    return Math.max(0, total - initial);
  }

  const pendingRaw = sale.payment_pending ?? sale.unpaid_amount;
  const paidRaw = sale.paid_amount ?? sale.payment_received ?? sale.partial_balance;
  const partial = sale.unpaid === true
    || String(sale.unpaid).toLowerCase() === 'true'
    || /partial|unpaid|credit|pending|impay/i.test(String(sale.payment_status || sale.sale_status || ''));
  let due;
  if (pendingRaw !== undefined && pendingRaw !== null && pendingRaw !== '') {
    due = Math.max(0, Number(pendingRaw) || 0);
  } else if (paidRaw !== undefined && paidRaw !== null && paidRaw !== '') {
    due = Math.max(0, total - Math.max(0, Number(paidRaw) || 0));
  } else {
    const source = sale.multi_payment ?? sale.payment_details ?? sale.payment_breakdown ?? sale.payments ?? {};
    const rows = Array.isArray(source)
      ? source
      : Object.entries(source && typeof source === 'object' ? source : {}).map(([method, value]) => ({ method, amount: value }));
    const tenderTotal = rows.reduce((sum, row) => sum + Math.max(0, Number(
      typeof row === 'object' ? (row?.amount ?? row?.paid ?? row?.total ?? 0) : row
    ) || 0), 0);
    due = rows.length ? Math.max(0, total - tenderTotal) : (partial ? total : 0);
  }
  if (partial && paidRaw !== undefined && paidRaw !== null && paidRaw !== '') {
    due = Math.max(due, total - Math.max(0, Number(paidRaw) || 0));
  }
  return Math.min(total, Math.max(0, due));
}

export function buildVariantCombinations({ axis1, values1, axis2 = '', values2 = '' } = {}) {
  const firstAxis = String(axis1 || '').trim();
  const secondAxis = String(axis2 || '').trim();
  const split = value => {
    const values = Array.isArray(value) ? value : String(value || '').split(/[\\n,;]+/);
    const unique = new Map();
    for (const raw of values) {
      const label = String(raw ?? '').trim().normalize('NFKC');
      if (label && !unique.has(label.toLocaleLowerCase())) unique.set(label.toLocaleLowerCase(), label);
    }
    return [...unique.values()];
  };
  const firstValues = split(values1);
  const secondValues = split(values2);
  if (!firstAxis || !firstValues.length) throw new Error('Indiquez le nom de l’axe 1 et au moins une valeur.');
  if (secondAxis && !secondValues.length) throw new Error('Indiquez les valeurs de l’axe 2 ou videz son nom.');
  if (!secondAxis && secondValues.length) throw new Error('Renseignez le nom de l’axe 2 pour utiliser ses valeurs.');
  if (secondAxis && firstAxis.toLocaleLowerCase() === secondAxis.toLocaleLowerCase()) throw new Error('Les deux axes doivent avoir des noms différents.');
  const combinations = firstValues.flatMap(value1 => secondValues.length
    ? secondValues.map(value2 => ({ value1, value2, label: value1 + ' / ' + value2 }))
    : [{ value1, value2: '', label: value1 }]);
  if (combinations.length > 50) throw new Error('50 combinaisons maximum.');
  return combinations.map(combo => ({
    ...combo,
    attributes: { [firstAxis]: combo.value1, ...(secondAxis ? { [secondAxis]: combo.value2 } : {}) },
    options: [{ axis: firstAxis, value: combo.value1 }, ...(secondAxis ? [{ axis: secondAxis, value: combo.value2 }] : [])],
  }));
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
