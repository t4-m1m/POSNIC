const { ObjectId } = require('mongodb');

const COLLECTION = 'payment_settlements';
const SUPPORTED = ['tpe', 'baridimob'];
const money = (v) => Math.round((Number(v) || 0) * 100) / 100;
const normMethod = (value) => {
  const key = String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (key.includes('baridimob')) return 'baridimob';
  if (key === 'tpe' || key.includes('terminalepayment') || key.includes('creditcard')) return 'tpe';
  return '';
};
const saleId = (sale) => String(sale.sales_id || sale.sale_id || sale.invoice_number || sale._id || '');
const saleDate = (sale) => sale.updated_date || sale.created_date || sale.sale_date || sale.date || null;
const saleAmountForMethod = (sale, method) => {
  const breakdown = sale.payment_breakdown || sale.payment_details || sale.payments || sale.payment_methods;
  if (Array.isArray(breakdown)) {
    return money(breakdown.reduce((sum, row) => {
      const mode = normMethod(row.method || row.payment_mode || row.name || row.payment_method);
      return sum + (mode === method ? Number(row.amount || row.value || row.paid_amount || 0) : 0);
    }, 0));
  }
  const mode = normMethod(sale.payment_mode || sale.payment_method);
  if (mode !== method) return 0;
  return money(sale.paid_amount || sale.sales_total || sale.total_paid || sale.items_total || sale.grand_total || sale.total || 0);
};
const actor = (req) => {
  const u = req.user || {};
  return String(u.username || u.name || u.email || u._id || u.id || 'unknown');
};
const sendError = (res, status, message) => res.status(status).json({ type: 'error', message });

exports.list = async (req, res) => {
  try {
    if (!req.db) return sendError(res, 500, 'Shop database is unavailable.');
    const from = req.query.from ? new Date(req.query.from) : null;
    const to = req.query.to ? new Date(req.query.to) : null;
    const methodFilter = normMethod(req.query.method);
    const statusFilter = String(req.query.status || 'all').toLowerCase();
    const sales = await req.db.collection('sales').find({}).sort({ updated_date: -1, created_date: -1 }).limit(5000).toArray();
    const settlementDocs = await req.db.collection(COLLECTION).find({}).sort({ collected_at: -1 }).toArray();
    const collectedByKey = new Map();
    const history = [];
    for (const batch of settlementDocs) {
      for (const line of (batch.lines || [])) {
        const key = line.sale_key + '|' + line.method;
        collectedByKey.set(key, money((collectedByKey.get(key) || 0) + Number(line.amount || 0)));
        history.push({ ...line, batch_id: String(batch._id), collected_at: batch.collected_at, reference: batch.reference || '', note: batch.note || '', recorded_by: batch.recorded_by || '', sale_key: line.sale_key });
      }
    }
    const rows = [];
    for (const sale of sales) {
      const dateRaw = saleDate(sale);
      const date = dateRaw ? new Date(dateRaw.$date || dateRaw) : null;
      if (from && (!date || date < from)) continue;
      if (to && (!date || date > new Date(to.getTime() + 86400000 - 1))) continue;
      for (const method of SUPPORTED) {
        const amount = saleAmountForMethod(sale, method);
        if (amount <= 0 || (methodFilter && method !== methodFilter)) continue;
        const key = saleId(sale) + '|' + method;
        const collected = money(collectedByKey.get(key) || 0);
        const outstanding = money(Math.max(0, amount - collected));
        const status = outstanding <= 0 ? 'collected' : (collected > 0 ? 'partial' : 'pending');
        if (statusFilter !== 'all' && statusFilter !== status && !(statusFilter === 'pending' && status === 'partial')) continue;
        rows.push({ sale_key: saleId(sale), sale_id: saleId(sale), date: date ? date.toISOString() : '', method, amount, collected, outstanding, status, customer: sale.customer_name || sale.customer || sale.customerName || '' });
      }
    }
    rows.sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const totals = { tpe: { amount: 0, collected: 0, outstanding: 0 }, baridimob: { amount: 0, collected: 0, outstanding: 0 } };
    rows.forEach(r => { totals[r.method].amount = money(totals[r.method].amount + r.amount); totals[r.method].collected = money(totals[r.method].collected + r.collected); totals[r.method].outstanding = money(totals[r.method].outstanding + r.outstanding); });
    return res.json({ type: 'success', data: { rows, totals, history: history.sort((a,b) => String(b.collected_at).localeCompare(String(a.collected_at))) } });
  } catch (error) {
    console.error('[payment-settlements] list failed', error);
    return sendError(res, 500, 'Unable to load settlement records.');
  }
};

exports.collect = async (req, res) => {
  try {
    if (!req.db) return sendError(res, 500, 'Shop database is unavailable.');
    const linesIn = Array.isArray(req.body.lines) ? req.body.lines : [];
    if (!linesIn.length) return sendError(res, 400, 'Select at least one transaction.');
    const collectedAt = req.body.collected_at ? new Date(req.body.collected_at) : new Date();
    if (Number.isNaN(collectedAt.getTime())) return sendError(res, 400, 'Collection date is invalid.');
    const sales = await req.db.collection('sales').find({}).toArray();
    const saleMap = new Map(sales.map(s => [saleId(s), s]));
    const existing = await req.db.collection(COLLECTION).find({}).toArray();
    const already = new Map();
    existing.forEach(b => (b.lines || []).forEach(l => {
      const k = l.sale_key + '|' + l.method;
      already.set(k, money((already.get(k) || 0) + Number(l.amount || 0)));
    }));
    const lines = [];
    for (const input of linesIn) {
      const key = String(input.sale_key || '');
      const method = normMethod(input.method);
      const amount = money(input.amount);
      if (!key || !SUPPORTED.includes(method) || amount <= 0) return sendError(res, 400, 'Each collection needs a valid sale, method, and positive amount.');
      const sale = saleMap.get(key);
      if (!sale) return sendError(res, 404, 'A selected sale could not be found. Refresh and try again.');
      const total = saleAmountForMethod(sale, method);
      const paid = money(already.get(key + '|' + method) || 0);
      const remaining = money(total - paid);
      if (total <= 0 || amount > remaining + 0.001) return sendError(res, 409, 'Collection amount exceeds the remaining balance for sale ' + key + '. Refresh before recording.');
      already.set(key + '|' + method, money(paid + amount));
      lines.push({ sale_key: key, method, amount, sale_amount: total });
    }
    const doc = {
      collected_at: collectedAt,
      recorded_at: new Date(),
      recorded_by: actor(req),
      reference: String(req.body.reference || '').trim().slice(0, 160),
      note: String(req.body.note || '').trim().slice(0, 1000),
      lines
    };
    const result = await req.db.collection(COLLECTION).insertOne(doc);
    return res.status(201).json({ type: 'success', message: 'Collection recorded.', data: { id: String(result.insertedId) } });
  } catch (error) {
    console.error('[payment-settlements] collect failed', error);
    return sendError(res, 500, 'Unable to record collection.');
  }
};
