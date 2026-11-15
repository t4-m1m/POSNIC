const { ObjectId } = require('mongodb');
const COLLECTION = 'sale_versements';
const money = (v) => Math.round((Number(v) || 0) * 100) / 100;
const actor = (req) => String(req.user?.username || req.user?.name || req.user?.email || req.user?._id || 'unknown');
const fail = (res, status, message) => res.status(status).json({ type: 'error', message });
const saleKey = (s) => String(s.sales_id || s.sale_id || s.invoice_number || s._id || '');
const saleTotal = (s) => money(s.sales_total ?? s.grand_total ?? s.total_amount ?? s.total ?? s.items_total ?? 0);
const branchOf = (req) => String(req.query.branch || req.body?.branch_id || req.session?.selectedBranchId || req.session?.branch_id || req.user?.branch_id || req.user?.branchId || req.user?.branch?._id || '');

exports.list = async (req,res) => {
  try {
    if (!req.db) return fail(res,500,'Shop database is unavailable.');
    const branch = branchOf(req);
    const filter = branch && ObjectId.isValid(branch) ? { branch_id: new ObjectId(branch) } : {};
    const status = String(req.query.status || 'all');
    if (status !== 'all') filter.status = status;
    const q = String(req.query.q || '').trim().slice(0,120);
    if (q) filter.$or = [{ customer_name: { $regex: q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'), $options:'i' } },{ phone: { $regex: q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'), $options:'i' } },{ versement_number: { $regex: q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'), $options:'i' } }];
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
    const total = saleTotal(sale);
    if (total <= 0 || initial > total) return fail(res,400,'Initial versement must be greater than zero and no more than the sale total.');
    const collection = req.db.collection(COLLECTION);
    await collection.createIndex({ sale_key:1 },{ unique:true });
    await collection.createIndex({ versement_number:1 },{ unique:true });
    const existing = await collection.findOne({ sale_key:saleKey(sale) });
    if (existing) return fail(res,409,'A versement already exists for this sale.');
    const number = 'V-' + new Date().toISOString().slice(0,10).replace(/-/g,'') + '-' + require('crypto').randomBytes(3).toString('hex').toUpperCase();
    const doc = { versement_number:number, sale_key:saleKey(sale), sale_object_id:sale._id, branch_id:new ObjectId(branch), customer_name:customer, phone, sale_total:total, initial_amount:initial, remaining:money(total-initial), status:initial===total?'settled':'pending', created_at:new Date(), created_by:actor(req), initial_collected_at:new Date(), initial_recorded_amount:initial, settlement:initial===total?{ amount:0, method:'none', settled_at:new Date(), recorded_by:actor(req) }:null, history:[{type:'initial',amount:initial,at:new Date(),by:actor(req)}] };
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
    const result = await collection.updateOne({_id:id,status:'pending',remaining:current.remaining},{$set:{status:'settled',remaining:0,settlement:{amount,method,settled_at:new Date(),recorded_by:actor(req)}},$push:{history:{type:'settlement',amount,method,at:new Date(),by:actor(req)}}});
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
