const { ObjectId } = require('mongodb');
const COLLECTION = 'sale_versements';
const money = (v) => Math.round((Number(v) || 0) * 100) / 100;
const actor = (req) => String(req.user?.username || req.user?.name || req.user?.email || req.user?._id || 'unknown');
const fail = (res, status, message) => res.status(status).json({ type: 'error', message });
const saleKey = (s) => String(s.sales_id || s.sale_id || s.invoice_number || s._id || '');
const saleTotal = (s) => money(s.sales_total ?? s.grand_total ?? s.total_amount ?? s.total ?? s.items_total ?? 0);
const branchOf = (req) => String(req.query.branch || req.body?.branch_id || req.session?.selectedBranchId || req.session?.branch_id || req.user?.branch_id || req.user?.branchId || req.user?.branch?._id || '');

exports.ensureForSale = async (req, sale) => {
  if (!req.db || !sale || !sale.versement_checkout) return null;
  const meta = sale.versement_checkout, key = saleKey(sale);
  const customer = String(meta.customer_name || '').trim().slice(0, 200);
  const phone = String(meta.phone || '').trim().slice(0, 40);
  const initial = money(meta.initial_amount), method = String(meta.initial_method || 'cash').toLowerCase();
  const total = saleTotal(sale), branchRaw = sale.branch_id || branchOf(req);
  if (!key || !customer || !ObjectId.isValid(String(branchRaw)) || !(initial > 0) ||
      total <= 0 || initial > total || !['cash','tpe','baridimob'].includes(method)) {
    throw new Error('Invalid Versement metadata on the validated sale.');
  }
  const collection = req.db.collection(COLLECTION);
  await collection.createIndex({ sale_key: 1 }, { unique: true });
  await collection.createIndex({ versement_number: 1 }, { unique: true });
  const existing = await collection.findOne({ sale_key: key });
  if (existing) return { ...existing, _id: String(existing._id) };
  const now = new Date(), settled = initial >= total - 0.009;
  const doc = {
    versement_number: 'V-' + now.toISOString().slice(0,10).replace(/-/g,'') + '-' + require('crypto').randomBytes(3).toString('hex').toUpperCase(),
    sale_key: key, sale_object_id: sale._id, branch_id: new ObjectId(String(branchRaw)),
    ...(sale.cashregister_id && ObjectId.isValid(String(sale.cashregister_id)) ? { register_id: new ObjectId(String(sale.cashregister_id)) } : {}),
    customer_name: customer, phone, sale_total: total, initial_amount: initial, initial_method: method,
    remaining: money(total - initial), status: settled ? 'settled' : 'pending',
    created_at: now, created_by: actor(req), initial_collected_at: now, initial_recorded_amount: initial,
    ...(settled ? { settled_at: now } : {}),
    settlement: settled ? { amount: 0, method: 'none', settled_at: now, recorded_by: actor(req) } : null,
    history: [{ type: 'initial', amount: initial, method, at: now, by: actor(req) }],
  };
  try {
    const inserted = await collection.insertOne(doc);
    return { ...doc, _id: String(inserted.insertedId) };
  } catch (error) {
    if (error && error.code === 11000) {
      const winner = await collection.findOne({ sale_key: key });
      if (winner) return { ...winner, _id: String(winner._id) };
    }
    throw error;
  }
};

exports.list = async (req,res) => {
  try {
    if (!req.db) return fail(res,500,'Shop database is unavailable.');
    const branch = branchOf(req);
    const filter = branch && ObjectId.isValid(branch) ? { branch_id: new ObjectId(branch) } : {};
    const status = String(req.query.status || 'all');
    if (status !== 'all') filter.status = status;
    const q = String(req.query.q || '').trim().slice(0,120);
    if (q) filter.$or = [{ customer_name: { $regex: q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'), $options:'i' } },{ phone: { $regex: q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'), $options:'i' } },{ versement_number: { $regex: q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'), $options:'i' } }];
    const saleFilter = { versement_checkout: { $exists: true } };
    if (filter.branch_id) saleFilter.branch_id = filter.branch_id;
    const orphanSales = await req.db.collection('sales').find(saleFilter).limit(2000).toArray();
    for (const sale of orphanSales) await exports.ensureForSale(req, sale);
    const rows = await req.db.collection(COLLECTION).find(filter).sort({ created_at:-1 }).limit(2000).toArray();
    return res.json({ type:'success', data: rows.map(r => ({ ...r, _id:String(r._id) })) });
  } catch(e) { console.error('[versements] list',e); return fail(res,500,'Unable to load versements.'); }
};

exports.create = async (req,res) => {
  try {
    if (!req.db) return fail(res,500,'Shop database is unavailable.');
    const saleRef = String(req.body?.sale_id || '').trim();
    const customer = String(req.body?.customer_name || '').trim().slice(0,200);
    const phone = String(req.body?.phone || '').trim().slice(0,40);
    const initial = money(req.body?.initial_amount);
    if (!saleRef || !customer || initial <= 0) return fail(res,400,'Sale, customer name and a positive initial amount are required.');
    const branch = branchOf(req);
    if (!ObjectId.isValid(branch)) return fail(res,400,'A valid branch is required.');
    const sale = await req.db.collection('sales').findOne({ $or:[{ sales_id:saleRef },{ sale_id:saleRef }, ...(ObjectId.isValid(saleRef)?[{_id:new ObjectId(saleRef)}]:[])], branch_id:new ObjectId(branch) });
    if (!sale) return fail(res,404,'The validated sale could not be found in this branch.');
    if (!sale.versement_checkout || String(sale.payment_mode || '').toLowerCase() !== 'versement') {
      return fail(res,409,'Créez les versements depuis Nouvelle vente avec F6. Une vente ordinaire ne peut pas être convertie après coup.');
    }
    const recovered = await exports.ensureForSale(req, sale);
    if (recovered) return res.json({ type:'success', message:'Versement déjà enregistré ou récupéré.', data:recovered });
    const total = saleTotal(sale);
    if (total <= 0 || initial > total) return fail(res,400,'Initial versement must be greater than zero and no more than the sale total.');
    const collection = req.db.collection(COLLECTION);
    await collection.createIndex({ sale_key:1 },{ unique:true });
    await collection.createIndex({ versement_number:1 },{ unique:true });
    const existing = await collection.findOne({ sale_key:saleKey(sale) });
    if (existing) return fail(res,409,'A versement already exists for this sale.');
    const number = 'V-' + new Date().toISOString().slice(0,10).replace(/-/g,'') + '-' + require('crypto').randomBytes(3).toString('hex').toUpperCase();
    const now = new Date(), initialMethod = String(req.body?.initial_method || 'cash').toLowerCase();
    if (!['cash','tpe','baridimob'].includes(initialMethod)) return fail(res,400,'Choose Espèces, TPE or BaridiMob.');
    const settled = initial >= total - 0.009;
    const doc = { versement_number:number, sale_key:saleKey(sale), sale_object_id:sale._id, branch_id:new ObjectId(branch), ...(sale.cashregister_id && ObjectId.isValid(String(sale.cashregister_id)) ? { register_id:new ObjectId(String(sale.cashregister_id)) } : {}), customer_name:customer, phone, sale_total:total, initial_amount:initial, initial_method:initialMethod, remaining:money(total-initial), status:settled?'settled':'pending', created_at:now, created_by:actor(req), initial_collected_at:now, initial_recorded_amount:initial, ...(settled?{settled_at:now}:{}), settlement:settled?{ amount:0, method:'none', settled_at:now, recorded_by:actor(req) }:null, history:[{type:'initial',amount:initial,method:initialMethod,at:now,by:actor(req)}] };
    const inserted = await collection.insertOne(doc);
    return res.status(201).json({ type:'success', message:'Versement recorded.', data:{...doc,_id:String(inserted.insertedId)} });
  } catch(e) {
    if (e && e.code===11000) return fail(res,409,'A versement already exists for this sale.');
    console.error('[versements] create',e); return fail(res,500,'Unable to record versement.');
  }
};

exports.settle = async (req,res) => {
  try {
    if (!req.db) return fail(res,500,'Shop database is unavailable.');
    if (!ObjectId.isValid(String(req.params.id))) return fail(res,400,'Invalid versement reference.');
    const method = String(req.body?.method || '').toLowerCase();
    if (!['cash','tpe','baridimob'].includes(method)) return fail(res,400,'Choose Espèces, TPE or BaridiMob.');
    const collection = req.db.collection(COLLECTION), id = new ObjectId(req.params.id);
    const current = await collection.findOne({_id:id});
    if (!current) return fail(res,404,'Versement not found.');
    if (current.status !== 'pending') return fail(res,409,'This versement is already settled or cancelled.');
    const amount = money(current.remaining);
    const settledAt = new Date();
    const settlementRegisterId = String(req.body?.register_id || req.session?.cashregister_id || req.session?.register_id || req.user?.cashregister_id || '').trim();
    const settlementRegister = ObjectId.isValid(settlementRegisterId) ? { settlement_register_id: new ObjectId(settlementRegisterId) } : {};
    const result = await collection.updateOne({_id:id,status:'pending',remaining:current.remaining},{$set:{status:'settled',remaining:0,settled_at:settledAt,...settlementRegister,settlement:{amount,method,settled_at:settledAt,recorded_by:actor(req),...(settlementRegister.settlement_register_id?{register_id:settlementRegister.settlement_register_id}:{})}},$push:{history:{type:'settlement',amount,method,at:settledAt,by:actor(req)}}});
    if (!result.modifiedCount) return fail(res,409,'This versement was already updated. Refresh the register.');
    return res.json({type:'success',message:'Final settlement recorded.',data:{id:String(id),amount,method}});
  } catch(e) { console.error('[versements] settle',e); return fail(res,500,'Unable to settle versement.'); }
};

exports.cancel = async (req,res) => {
  try {
    if (!req.db) return fail(res,500,'Shop database is unavailable.');
    const user = req.user || {};
    const admin = ['super_admin','admin'].includes(String(user.usertype || user.role || '').toLowerCase()) || user.is_super_admin === true;
    if (!admin) return fail(res,403,'Administrator permission is required to cancel a versement.');
    const reason = String(req.body?.reason || '').trim().slice(0,500);
    if (reason.length < 5) return fail(res,400,'A cancellation reason is required.');
    if (!ObjectId.isValid(String(req.params.id))) return fail(res,400,'Invalid versement reference.');
    const id = new ObjectId(req.params.id), collection = req.db.collection(COLLECTION);
    const current = await collection.findOne({_id:id});
    if (!current) return fail(res,404,'Versement not found.');
    if (current.status !== 'pending') return fail(res,409,'Only a pending versement can be cancelled.');
    const result = await collection.updateOne({_id:id,status:'pending'},{$set:{status:'cancelled',cancelled_at:new Date(),cancelled_by:actor(req),cancellation_reason:reason},$push:{history:{type:'cancellation',reason,at:new Date(),by:actor(req)}}});
    if (!result.modifiedCount) return fail(res,409,'Versement status changed. Refresh and retry.');
    return res.json({type:'success',message:'Versement cancelled and retained in history.',data:{id:String(id)}});
  } catch(e) { console.error('[versements] cancel',e); return fail(res,500,'Unable to cancel versement.'); }
};
