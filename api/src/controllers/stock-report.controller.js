const { ObjectId } = require('mongodb');

const money = (n) => Math.round((Number(n) || 0) * 100) / 100;
const asId = (v) => String(v && (v._id || v.id || v.item_id || v.product_id) || v || '');
const qtyOf = (v) => Number(v && (v.quantity ?? v.qty ?? v.item_quantity ?? v.sold_quantity) || 0);
const itemLines = (sale) => {
  const lines = sale.items || sale.sale_items || sale.products || sale.order_items || [];
  return Array.isArray(lines) ? lines : [];
};
const saleDate = (s) => {
  const raw = s.updated_date || s.created_date || s.date || s.order_date || s.sale_date;
  const d = raw ? new Date(raw.$date || raw) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
};
const isCompleted = (s) => {
  const status = String(s.status || s.sale_status || s.sale_process || '').toLowerCase();
  return !/(cancel|void|hold|draft|delete|pending)/.test(status);
};

exports.read = async (req, res) => {
  try {
    if (!req.db) return res.status(500).json({ type: 'error', message: 'Shop database is unavailable.' });
    const branchId = String(req.query.branch || req.session?.selectedBranchId || req.session?.branch_id || req.user?.branch_id || req.user?.branchId || req.user?.branch?._id || '');
    if (!ObjectId.isValid(branchId)) return res.status(400).json({ type: 'error', message: 'Choose a valid branch.' });
    const allowed = req.user?.branch_access;
    if (Array.isArray(allowed) && allowed.length && !allowed.some((b) => String(b.branch_id || b) === branchId))
      return res.status(403).json({ type: 'error', message: 'You do not have access to this branch.' });
    const license = req.tenantContext?.licenseId || req.user?.license || req.user?.license_id || req.user?.licenseId;
    const branchObjectId = new ObjectId(branchId);
    const settingsCollection = req.db.collection('stock_report_settings');
    const settings = await settingsCollection.findOne({ branch_id: branchObjectId }) || {};
    if (req.method === 'POST') {
      const days = Math.max(1, Math.min(3650, Math.floor(Number(req.body?.dormant_days) || 90)));
      await settingsCollection.updateOne({ branch_id: branchObjectId }, { $set: { branch_id: branchObjectId, license, dormant_days: days, updated_at: new Date(), updated_by: String(req.user?.username || req.user?.name || '') } }, { upsert: true });
      return res.json({ type: 'success', data: { dormant_days: days } });
    }
    const dormantDays = Math.max(1, Math.min(3650, Number(settings.dormant_days) || 90));
    const itemFilter = { branch_id: branchObjectId, is_active: { $ne: false } };
    if (license) itemFilter.license = new ObjectId(String(license));
    const items = await req.db.collection('items').find(itemFilter).project({ name: 1, sku: 1, itemid: 1, barcode_id: 1, category_id: 1, category_name: 1, brand: 1, marque: 1, quantity: 1, available_quantity: 1, cost_price: 1, company_price: 1, selling_price: 1, variants: 1, is_active: 1 }).limit(20000).toArray();
    const salesFilter = { branch_id: branchObjectId };
    if (license) salesFilter.license = new ObjectId(String(license));
    const sales = await req.db.collection('sales').find(salesFilter).project({ items: 1, sale_items: 1, products: 1, order_items: 1, status: 1, sale_status: 1, sale_process: 1, date: 1, order_date: 1, updated_date: 1, created_date: 1 }).limit(50000).toArray();
    const lastSold = new Map(), soldQty = new Map(), soldRevenue = new Map();
    for (const sale of sales) {
      if (!isCompleted(sale)) continue;
      const date = saleDate(sale);
      for (const line of itemLines(sale)) {
        const id = asId(line.item_id || line.product_id || line.item || line.product || line._id);
        if (!id) continue;
        const q = qtyOf(line);
        if (q <= 0) continue;
        const prev = lastSold.get(id);
        if (date && (!prev || date > prev)) lastSold.set(id, date);
        soldQty.set(id, money((soldQty.get(id) || 0) + q));
        soldRevenue.set(id, money((soldRevenue.get(id) || 0) + q * Number(line.price || line.selling_price || line.unit_price || 0)));
      }
    }
    const now = new Date(), dormantBefore = new Date(now.getTime() - dormantDays * 86400000);
    const rows = items.map((item) => {
      const id = String(item._id), stock = Number(item.available_quantity ?? item.quantity ?? 0);
      const cost = Number(item.cost_price ?? item.company_price ?? 0), last = lastSold.get(id) || null;
      const qty = soldQty.get(id) || 0;
      return { id, name: item.name || 'Unnamed item', sku: item.sku || item.itemid || item.barcode_id || '', category: item.category_name || '', brand: item.brand || item.marque || '', stock, unit_cost: money(cost), stock_value: money(stock * cost), selling_price: money(item.selling_price), sold_quantity: qty, sold_revenue: soldRevenue.get(id) || 0, last_sale: last ? last.toISOString() : null, days_since_sale: last ? Math.floor((now - last) / 86400000) : null, never_sold: !last };
    }).filter((r) => r.stock > 0);
    const neverSold = rows.filter((r) => r.never_sold).sort((a,b) => b.stock_value-a.stock_value);
    const dormant = rows.filter((r) => !r.never_sold && new Date(r.last_sale) < dormantBefore).sort((a,b) => b.days_since_sale-a.days_since_sale);
    const critical = rows.filter((r) => r.stock <= 5).sort((a,b) => a.stock-b.stock);
    const totals = { products: rows.length, stock_units: money(rows.reduce((s,r)=>s+r.stock,0)), stock_value: money(rows.reduce((s,r)=>s+r.stock_value,0)), critical: critical.length, dormant: dormant.length, never_sold: neverSold.length, sold_quantity: money(rows.reduce((s,r)=>s+r.sold_quantity,0)) };
    return res.json({ type: 'success', data: { totals, dormant_days: dormantDays, rows, critical, dormant, never_sold: neverSold } });
  } catch (error) {
    console.error('[stock-report] read failed', error);
    return res.status(500).json({ type: 'error', message: 'Unable to load stock report.' });
  }
};
