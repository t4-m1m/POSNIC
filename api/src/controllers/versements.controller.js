const { ObjectId } = require('mongodb');
const crypto = require('crypto');
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
      total <= 0 || !['cash','tpe','baridimob'].includes(method)) {
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
    customer_name: customer, phone, vendor_name: String(meta.vendor_name || sale.cashier_name || '').trim().slice(0, 80), sale_note: String(sale.sales_description || sale.sale_note || sale.sales_note || '').trim().slice(0, 1000), sale_total: total, initial_amount: initial, initial_method: method,
    remaining: money(Math.max(0, total - initial)), status: settled ? 'settled' : 'pending',
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
    if (q) {
      const escaped = q.replace(/[.*+?^$()|[\]\\]/g, '\\$&');
      filter.$or = [
        { customer_name: { $regex: escaped, $options: 'i' } },
        { phone: { $regex: escaped, $options: 'i' } },
        { versement_number: { $regex: escaped, $options: 'i' } },
        { sale_key: { $regex: escaped, $options: 'i' } },
      ];
    }
    const saleFilter = { versement_checkout: { $exists: true } };
    if (filter.branch_id) saleFilter.branch_id = filter.branch_id;
    const orphanSales = await req.db.collection('sales').find(saleFilter).limit(2000).toArray();
    for (const sale of orphanSales) await exports.ensureForSale(req, sale);
    const rows = await req.db.collection(COLLECTION).find(filter).sort({ created_at:-1 }).limit(2000).toArray();
    const saleIds = rows.map(r => r.sale_object_id).filter(Boolean);
    const saleKeys = rows.map(r => String(r.sale_key || '')).filter(Boolean);
    const linkedSales = saleIds.length || saleKeys.length
      ? await req.db.collection('sales').find({
          $or: [
            ...(saleIds.length ? [{ _id: { $in: saleIds } }] : []),
            ...(saleKeys.length ? [{ sales_id: { $in: saleKeys } }, { sale_id: { $in: saleKeys } }] : [])
          ]
        }, { projection: { sales_description:1, sale_note:1, sales_note:1 } }).toArray()
      : [];
    const saleById = new Map(linkedSales.map(s => [String(s._id), s]));
    const saleByKey = new Map();
    linkedSales.forEach(s => { saleByKey.set(String(s.sales_id || s.sale_id || ''), s); });
    return res.json({ type:'success', data: rows.map(r => {
      const linked = saleById.get(String(r.sale_object_id || '')) || saleByKey.get(String(r.sale_key || '')) || {};
      return { ...r, sale_note: String(r.sale_note || r.sales_description || linked.sales_description || linked.sale_note || linked.sales_note || '').trim(), _id:String(r._id) };
    }) });
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
    if (total <= 0) return fail(res,400,'The linked sale total must be greater than zero.');
    const collection = req.db.collection(COLLECTION);
    await collection.createIndex({ sale_key:1 },{ unique:true });
    await collection.createIndex({ versement_number:1 },{ unique:true });
    const existing = await collection.findOne({ sale_key:saleKey(sale) });
    if (existing) return fail(res,409,'A versement already exists for this sale.');
    const number = 'V-' + new Date().toISOString().slice(0,10).replace(/-/g,'') + '-' + require('crypto').randomBytes(3).toString('hex').toUpperCase();
    const now = new Date(), initialMethod = String(req.body?.initial_method || 'cash').toLowerCase();
    if (!['cash','tpe','baridimob'].includes(initialMethod)) return fail(res,400,'Choose Espèces, TPE or BaridiMob.');
    const settled = initial >= total - 0.009;
    const doc = { versement_number:number, sale_key:saleKey(sale), sale_object_id:sale._id, branch_id:new ObjectId(branch), ...(sale.cashregister_id && ObjectId.isValid(String(sale.cashregister_id)) ? { register_id:new ObjectId(String(sale.cashregister_id)) } : {}), customer_name:customer, phone, sale_note:String(sale.sales_description || sale.sale_note || sale.sales_note || '').trim().slice(0,1000), sale_total:total, initial_amount:initial, initial_method:initialMethod, remaining:money(Math.max(0,total-initial)), status:settled?'settled':'pending', created_at:now, created_by:actor(req), initial_collected_at:now, initial_recorded_amount:initial, ...(settled?{settled_at:now}:{}), settlement:settled?{ amount:0, method:'none', settled_at:now, recorded_by:actor(req) }:null, history:[{type:'initial',amount:initial,method:initialMethod,at:now,by:actor(req)}] };
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
    const amount = money(current.remaining), settledAt = new Date();
    const registerId = String(req.body?.register_id || req.session?.cashregister_id || req.session?.register_id || req.user?.cashregister_id || '').trim();
    const register = ObjectId.isValid(registerId) ? new ObjectId(registerId) : null;
    const saleFilter = current.sale_object_id ? {_id:current.sale_object_id} : {$or:[{sales_id:current.sale_key},{sale_id:current.sale_key}]};
    const sale = await req.db.collection('sales').findOne(saleFilter);
    if (!sale) return fail(res,409,'The linked sale is missing; settlement was not recorded.');
    const claimed = await collection.updateOne({_id:id,status:'pending',remaining:current.remaining},{$set:{status:'settling',settlement_started_at:settledAt,settlement_started_by:actor(req)}});
    if (!claimed.modifiedCount) return fail(res,409,'This versement was already updated. Refresh the register.');
    try {
      const saleUpdate = {
        versement_settled:true, versement_settled_at:settledAt, settled_at:settledAt, date:settledAt,
        payment_mode:method, payment_status:'Paid', payment_pending:0, partial_check:'false',
        partial_balance:0, paid_amount:money(current.sale_total),
        versement_settlement_amount:amount,
        versement_initial_amount:money(current.initial_recorded_amount ?? current.initial_amount),
        versement_initial_method:current.initial_method
      };
      if (register) saleUpdate.versement_settlement_register_id=register;
      const saleResult = await req.db.collection('sales').updateOne({_id:sale._id,versement_checkout:{$exists:true}},{$set:saleUpdate});
      if (!saleResult.matchedCount) throw new Error('Linked sale could not be marked as settled.');
      const result = await collection.updateOne({_id:id,status:'settling'},{$set:{
        status:'settled',remaining:0,settled_at:settledAt,...(register?{settlement_register_id:register}:{}),
        settlement:{amount,method,settled_at:settledAt,recorded_by:actor(req),...(register?{register_id:register}:{})}
      },$push:{history:{type:'settlement',amount,method,at:settledAt,by:actor(req)}}});
      if (!result.modifiedCount) throw new Error('Versement register could not be finalized.');
    } catch(error) {
      console.error('[versements] settlement commit',error);
      return fail(res,500,'Settlement is being recovered. Refresh the register and retry.');
    }
    return res.json({type:'success',message:'Versement settled and linked sale posted to sales history.',data:{id:String(id),sale_id:String(sale._id),sales_id:sale.sales_id,amount,method,settled_at:settledAt}});
  } catch(e) { console.error('[versements] settle',e); return fail(res,500,'Unable to settle versement.'); }
};

exports.cancel = async (req,res) => {
  try {
    if (!req.db) return fail(res,500,'Shop database is unavailable.');
    if (!ObjectId.isValid(String(req.params.id))) return fail(res,400,'Invalid versement reference.');
    const id=new ObjectId(req.params.id), collection=req.db.collection(COLLECTION);
    const current=await collection.findOne({_id:id});
    if (!current) return res.json({type:'success',message:'Versement already removed.',data:{id:String(id)}});
    if (current.status==='settled'||current.status==='settling') return fail(res,409,'A settled or settling versement cannot be cancelled.');
    if (!['pending','cancelling'].includes(current.status)) return fail(res,409,'This versement cannot be cancelled.');
    const reason=String(req.body?.reason||'Deleted from Versements register').trim().slice(0,500);
    if (current.status==='pending') {
      const claimed=await collection.updateOne({_id:id,status:'pending'},{$set:{status:'cancelling',cancellation_reason:reason,cancellation_started_at:new Date(),cancellation_started_by:actor(req)}});
      if (!claimed.modifiedCount) {
        const latest=await collection.findOne({_id:id});
        if (!latest||latest.status!=='cancelling') return fail(res,409,'Versement status changed. Refresh and retry.');
      }
    }
    const saleFilter=current.sale_object_id?{_id:current.sale_object_id}:{$or:[{sales_id:current.sale_key},{sale_id:current.sale_key}]};
    const sale=await req.db.collection('sales').findOne(saleFilter);
    if (!sale) throw new Error('Linked sale is missing; versement retained for recovery.');
    const lines=Array.isArray(sale.itemsale)?sale.itemsale:(Array.isArray(sale.items)?sale.items:[]);
    const quantities=new Map();
    for (const line of lines) {
      const rawId=line.item_id||line.item||line.product_id||line.view_item_id;
      const itemId=rawId&&typeof rawId==='object'?String(rawId._id||rawId.id||''):String(rawId||'');
      const qty=Number(line.item_quantity??line.quantity??line.qty??0);
      if (ObjectId.isValid(itemId)&&Number.isFinite(qty)&&qty>0&&
          (line.track_inventory===true||line.track_inventory==='true')&&
          String(line.item_status||'').toLowerCase()!=='instant')
        quantities.set(itemId,(quantities.get(itemId)||0)+qty);
    }
    const items=req.db.collection('items'), stockLogs=req.db.collection('stocklogs');
    const restoreKey=String(current.sale_key||saleKey(sale))+':versement-cancel';
    for (const [itemId,qty] of quantities) {
      const itemObjectId=new ObjectId(itemId);
      const itemBefore=await items.findOne({_id:itemObjectId,track_inventory:{$in:[true,'true']}});
      if (!itemBefore) continue;
      const alreadyRestored=Array.isArray(itemBefore.versement_stock_restore_keys)&&itemBefore.versement_stock_restore_keys.includes(restoreKey);
      if (!alreadyRestored) {
        await items.updateOne({_id:itemObjectId,track_inventory:{$in:[true,'true']},versement_stock_restore_keys:{$ne:restoreKey}},
          {$inc:{available_quantity:qty},$addToSet:{versement_stock_restore_keys:restoreKey}});
      }
      // A deterministic log id makes the journal write safely retryable if
      // stock was restored but the request was interrupted before logging.
      const logId=new ObjectId(crypto.createHash('sha256').update(restoreKey+':'+itemId).digest('hex').slice(0,24));
      const currentBalance=Number(itemBefore.available_quantity)||0;
      const openingBalance=alreadyRestored?currentBalance-qty:currentBalance;
      const closingBalance=openingBalance+qty;
      const logDate=new Date();
      const log={
        branch_id:current.branch_id,
        view_item_id:itemObjectId,
        item_barcode_id:String(itemBefore.item_barcode_id||itemBefore.barcode_id||''),
        item_name:String(itemBefore.item_name||itemBefore.name||'Article'),
        item_quantity:String(qty),
        process:'Versement annulé',
        reference:String(current.versement_number||current.sale_key||saleKey(sale)),
        note:'Restitution du stock après annulation du versement',
        date:logDate,created_date:logDate,updated_date:logDate,
        action:'Add',stocklog:true,
        opening_balance:String(openingBalance),closing_balance:String(closingBalance),
        count:String(qty),changed_by:actor(req),
        ...(ObjectId.isValid(String(req.user?._id||''))?{changed_by_userid:new ObjectId(String(req.user._id))}:{}),
        ...(sale.license?{license:sale.license}:{}),
      };
      await stockLogs.updateOne({_id:logId},{$setOnInsert:log},{upsert:true});
    }
    await req.db.collection('sales').deleteOne({_id:sale._id,versement_checkout:{$exists:true}});
    await collection.deleteOne({_id:id,status:'cancelling'});
    return res.json({type:'success',message:'Versement deleted and reserved stock restored.',data:{id:String(id)}});
  } catch(e) {
    console.error('[versements] cancel',e);
    return fail(res,500,'Unable to delete the versement completely. It remains available for a safe retry; stock restoration is idempotent.');
  }
};

exports.updatePending = async (req,res) => {
  try {
    if (!req.db) return fail(res,500,'Shop database is unavailable.');
    if (!ObjectId.isValid(String(req.params.id))) return fail(res,400,'Invalid versement reference.');
    const total=money(req.body?.sale_total);
    if (!(total>0)) return fail(res,400,'The updated sale total must be positive.');
    const collection=req.db.collection(COLLECTION),id=new ObjectId(req.params.id);
    const branch=branchOf(req),filter={_id:id,...(ObjectId.isValid(branch)?{branch_id:new ObjectId(branch)}:{})};
    const current=await collection.findOne(filter);
    if (!current) return fail(res,404,'Versement not found.');
    if (current.status!=='pending') return fail(res,409,'Only a pending versement can be edited.');
    const deposit=money(current.initial_recorded_amount??current.initial_amount);
    if (total<deposit-0.009) return fail(res,409,'The updated sale total cannot be lower than the deposit already collected.');
    const now=new Date(),remaining=money(Math.max(0,total-deposit));
    const result=await collection.updateOne({_id:id,status:'pending',sale_total:current.sale_total},{$set:{sale_total:total,remaining,updated_at:now,updated_by:actor(req)},$push:{history:{type:'sale_adjusted',amount:money(total-Number(current.sale_total||0)),method:'edit',at:now,by:actor(req)}}});
    if (!result.modifiedCount) return fail(res,409,'Versement changed while it was being edited. Refresh and retry.');
    return res.json({type:'success',message:'Pending versement updated with the edited sale.',data:{id:String(id),sale_total:total,initial_amount:deposit,remaining}});
  } catch(e) { console.error('[versements] update pending',e); return fail(res,500,'Unable to update pending versement.'); }
};
