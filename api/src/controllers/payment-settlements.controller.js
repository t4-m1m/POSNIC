const { ObjectId } = require('mongodb');
const crypto = require('crypto');

const COLLECTION = 'payment_settlements';
const SUPPORTED = ['tpe', 'baridimob'];
const money = (v) => Math.round((Number(v) || 0) * 100) / 100;
const normMethod = (value) => {
  const key = String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
  if (key.includes('baridimob')) return 'baridimob';
  if (key === 'tpe' || key.includes('terminal') || key.includes('creditcard') || key === 'card' || key.includes('cartebancaire') || key === 'pos') return 'tpe';
  return '';
};
const saleId = (sale) => String(sale.sales_id || sale.sale_id || sale.invoice_number || sale._id || '');
const saleDate = (sale) => sale.updated_date || sale.created_date || sale.sale_date || sale.date || null;
const saleAmountForMethod = (sale, method) => {
  // Split tenders are normally stored in multi_payment as an object, such as
  // { Cash: 500, TPE: 1200, BaridiMob: 800 }. Also accept legacy array shapes.
  const breakdown = sale.multi_payment || sale.payment_breakdown || sale.payment_details || sale.payments || sale.payment_methods || sale.captain_payments;
  const amountOf = (value) => {
    if (value && typeof value === 'object') return Number(value.amount || value.value || value.paid_amount || value.collected || 0);
    return Number(value || 0);
  };
  let splitAmount = 0;
  if (Array.isArray(breakdown)) {
    splitAmount = money(breakdown.reduce((sum, row) => {
      if (!row || typeof row !== 'object') return sum;
      const mode = normMethod(row.payment_mode || row.payment_method || row.label || row.name || row.method || row.reference || row.notes || row.tender || '');
      return sum + (mode === method ? amountOf(row.amount != null ? row.amount : row.value != null ? row.value : row.paid_amount) : 0);
    }, 0));
  } else if (breakdown && typeof breakdown === 'object') {
    splitAmount = money(Object.keys(breakdown).reduce((sum, key) => normMethod(key) === method ? sum + amountOf(breakdown[key]) : sum, 0));
  }
  // Some older sales have a multi-payment field present but empty or only
  // containing other tenders. Do not let that suppress their primary method.
  if (splitAmount > 0) return splitAmount;
  const mode = normMethod(sale.payment_mode || sale.payment_method || sale.register_paymentmode || sale.paymentmode || sale.payment_type);
  if (mode !== method) return 0;
  return money(sale.paid_amount || sale.sales_total || sale.total_paid || sale.items_total || sale.grand_total || sale.total || sale.register_amount || sale.amount || 0);
};
const actor = (req) => {
  const u = req.user || {};
  return String(u.username || u.name || u.email || u._id || u.id || 'unknown');
};
const sendError = (res, status, message) => res.status(status).json({ type: 'error', message });
const sendNotSaved = (res, status, message, requestId) => res.status(status).json({
  type: 'error', message,
  data: { submission_outcome: 'not_saved', request_id: requestId },
});

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
        history.push({ ...line, request_id: batch.request_id || '', batch_id: String(batch._id), collected_at: batch.collected_at, reference: batch.reference || '', note: batch.note || '', recorded_by: batch.recorded_by || '', sale_key: line.sale_key });
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
  let requestId = String(req.body && req.body.request_id || '').trim();
  let requestHash = '';
  try {
    if (!req.db) return sendError(res, 500, 'Shop database is unavailable.');
    if (!/^[A-Za-z0-9._:-]{8,128}$/.test(requestId)) {
      return sendError(res, 400, 'A valid collection request id is required.');
    }

    const collection = req.db.collection(COLLECTION);
    // A retry after a lost response must resolve to the original batch, not
    // create another payment. Sparse keeps legacy batches without request_id.
    await collection.createIndex({ request_id: 1 }, { unique: true, sparse: true });

    const linesIn = Array.isArray(req.body.lines) ? req.body.lines : [];
    if (!linesIn.length) return sendNotSaved(res, 400, 'Select at least one transaction.', requestId);
    const collectedAt = req.body.collected_at ? new Date(req.body.collected_at) : new Date();
    if (Number.isNaN(collectedAt.getTime())) return sendNotSaved(res, 400, 'Collection date is invalid.', requestId);
    const reference = String(req.body.reference || '').trim().slice(0, 160);
    const note = String(req.body.note || '').trim().slice(0, 1000);

    // Normalize before checking the request journal. An already-committed
    // request can then be acknowledged even when its remaining balance is 0.
    const lines = [];
    for (const input of linesIn) {
      const key = String(input.sale_key || '');
      const method = normMethod(input.method);
      const amount = money(input.amount);
      if (!key || !SUPPORTED.includes(method) || amount <= 0) {
        return sendNotSaved(res, 400, 'Each collection needs a valid sale, method, and positive amount.', requestId);
      }
      lines.push({ sale_key: key, method, amount });
    }
    const hashPayload = {
      lines: lines.slice().sort((x, y) => (x.sale_key + '|' + x.method).localeCompare(y.sale_key + '|' + y.method)),
      reference,
      note,
      collected_at: collectedAt.toISOString(),
    };
    requestHash = crypto.createHash('sha256').update(JSON.stringify(hashPayload)).digest('hex');

    const previous = await collection.findOne({ request_id: requestId });
    if (previous) {
      if (previous.request_hash === requestHash) {
        return res.status(200).json({
          type: 'success',
          message: 'Collection already recorded. Duplicate payment prevented.',
          data: { id: String(previous._id), duplicate: true },
        });
      }
      return sendError(res, 409, 'This collection request id was already used for different payment details.');
    }

    const sales = await req.db.collection('sales').find({}).toArray();
    const saleMap = new Map(sales.map(s => [saleId(s), s]));
    const existing = await collection.find({}).toArray();
    const already = new Map();
    existing.forEach(b => (b.lines || []).forEach(l => {
      const k = l.sale_key + '|' + l.method;
      already.set(k, money((already.get(k) || 0) + Number(l.amount || 0)));
    }));

    const validatedLines = [];
    for (const line of lines) {
      const sale = saleMap.get(line.sale_key);
      if (!sale) return sendNotSaved(res, 404, 'A selected sale could not be found. Refresh and try again.', requestId);
      const total = saleAmountForMethod(sale, line.method);
      const paid = money(already.get(line.sale_key + '|' + line.method) || 0);
      const remaining = money(total - paid);
      if (total <= 0 || line.amount > remaining + 0.001) {
        return sendNotSaved(res, 409, 'Collection amount exceeds the remaining balance for sale ' + line.sale_key + '. Refresh before recording.', requestId);
      }
      already.set(line.sale_key + '|' + line.method, money(paid + line.amount));
      validatedLines.push({ ...line, sale_amount: total });
    }

    const doc = {
      request_id: requestId,
      request_hash: requestHash,
      collected_at: collectedAt,
      recorded_at: new Date(),
      recorded_by: actor(req),
      reference,
      note,
      lines: validatedLines,
    };
    const result = await collection.insertOne(doc);
    return res.status(201).json({ type: 'success', message: 'Collection recorded.', data: { id: String(result.insertedId) } });
  } catch (error) {
    // Two concurrent retries can both pass the initial lookup; the unique
    // index elects one winner and the loser reads back that exact result.
    if (error && error.code === 11000 && requestId && req.db) {
      try {
        const previous = await req.db.collection(COLLECTION).findOne({ request_id: requestId });
        if (previous && previous.request_hash === requestHash) {
          return res.status(200).json({
            type: 'success',
            message: 'Collection already recorded. Duplicate payment prevented.',
            data: { id: String(previous._id), duplicate: true },
          });
        }
        if (previous) return sendError(res, 409, 'This collection request id was already used for different payment details.');
      } catch (lookupError) {
        console.error('[payment-settlements] duplicate lookup failed', lookupError);
      }
    }
    console.error('[payment-settlements] collect failed', error);
    return sendError(res, 500, 'Unable to record collection.');
  }
};
