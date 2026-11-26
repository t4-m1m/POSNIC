const { ObjectId } = require('mongodb');
const BaseModel = require('../models/base.model');
const shopDb = async (req) => req.db || await BaseModel.getDb();
const crypto = require('crypto');
const COLLECTION = 'sale_versements';
const money = (v) => Math.round((Number(v) || 0) * 100) / 100;
const actor = (req) => String(req.user?.username || req.user?.name || req.user?.email || req.user?._id || 'unknown');
const fail = (res, status, message) => res.status(status).json({ type: 'error', message });
const saleKey = (s) => String(s.sales_id || s.sale_id || s.invoice_number || s._id || '');
const saleTotal = (s) => money(s.sales_total ?? s.grand_total ?? s.total_amount ?? s.total ?? s.items_total ?? 0);
const branchOf = (req) => String(req.tenantContext?.branchId || req.query.branch || req.body?.branch_id || req.session?.selectedBranchId || req.session?.branch_id || req.user?.branch_id || req.user?.branchId || req.user?.branch?._id || '');

async function recoverSettlingVersement(db, collection, current) {
  if (!current || current.status !== 'settling') return true;
  // Do not race a live settle request between its claim and sale update.
  const startedAt = new Date(current.settlement_started_at || current.updated_at || current.created_at || 0).getTime();
  if (Number.isFinite(startedAt) && startedAt > 0 && Date.now() - startedAt < 120000) return true;
  const saleFilter = current.sale_object_id
    ? { _id: current.sale_object_id }
    : { $or: [{ sales_id: current.sale_key }, { sale_id: current.sale_key }] };
  const sale = await db.collection('sales').findOne(saleFilter);
  if (!sale) return false;

  if (sale.versement_settled === true || sale.versement_settled === 'true') {
    const method = String(sale.payment_mode || current.settlement_started_method || '').toLowerCase();
    const amount = money(sale.versement_settlement_amount ?? current.settlement_started_amount ?? current.remaining ?? 0);
    if (!['cash', 'tpe', 'baridimob'].includes(method) || amount < 0) return false;
    const settledAt = sale.versement_settled_at || sale.settled_at || current.settlement_started_at || new Date();
    const by = String(current.settlement_started_by || current.created_by || 'System');
    const hasHistory = Array.isArray(current.history) && current.history.some(event => event.type === 'settlement');
    const registerId = sale.versement_settlement_register_id || current.settlement_started_register_id || null;
    await collection.updateOne({ _id: current._id, status: 'settling' }, {
      $set: {
        status: 'settled', remaining: 0, settled_at: settledAt,
        ...(registerId ? { settlement_register_id: registerId } : {}),
        settlement: { amount, method, settled_at: settledAt, recorded_by: by, ...(registerId ? { register_id: registerId } : {}) },
      },
      ...(!hasHistory ? { $push: { history: { type: 'settlement', amount, method, at: settledAt, by } } } : {}),
      $unset: { settlement_started_at: '', settlement_started_by: '', settlement_started_method: '', settlement_started_amount: '', settlement_started_register_id: '' },
    });
    return true;
  }

  // The sale update never committed: release the claim so the cashier can retry.
  await collection.updateOne({ _id: current._id, status: 'settling' }, {
    $set: { status: 'pending' },
    $unset: { settlement_started_at: '', settlement_started_by: '', settlement_started_method: '', settlement_started_amount: '', settlement_started_register_id: '' },
  });
  return true;
}


async function applyDeferredVersementStock(db, sale, versement, settledAt) {
  if (versement?.stock_deferred !== true && sale?.versement_checkout?.stock_deferred !== true) return;
  const rawLines = Array.isArray(sale.items) ? sale.items : Array.isArray(sale.itemsale) ? sale.itemsale : [];
  const quantities = new Map();
  for (const line of rawLines) {
    const rawId = line.item_id || line.item || line.product_id || line.view_item_id;
    const itemId = rawId && typeof rawId === 'object' ? String(typeof rawId.toHexString === 'function' ? rawId.toHexString() : (rawId._id || rawId.id || rawId)) : String(rawId || '');
    const qty = Number(line.item_quantity ?? line.quantity ?? line.qty ?? 0);
    if (!ObjectId.isValid(itemId) || !Number.isFinite(qty) || qty <= 0 || String(line.item_status || '').toLowerCase() === 'instant') continue;
    quantities.set(itemId, (quantities.get(itemId) || 0) + qty);
  }
  const saleKeyValue = String(versement.sale_key || saleKey(sale));
  const movementKey = saleKeyValue + ':versement-settlement';
  const items = db.collection('items'), stockLogs = db.collection('stocklogs');
  for (const [itemId, qty] of quantities) {
    const objectId = new ObjectId(itemId);
    const before = await items.findOne({ _id: objectId, track_inventory: { $in: [true, 'true'] } });
    if (!before) continue;
    const alreadyApplied = Array.isArray(before.versement_stock_settlement_keys) && before.versement_stock_settlement_keys.includes(movementKey);
    if (!alreadyApplied) {
      const updated = await items.updateOne(
        { _id: objectId, track_inventory: { $in: [true, 'true'] }, available_quantity: { $gte: qty }, versement_stock_settlement_keys: { $ne: movementKey } },
        { $inc: { available_quantity: -qty }, $addToSet: { versement_stock_settlement_keys: movementKey } }
      );
      if (!updated.modifiedCount) {
        const latest = await items.findOne({ _id: objectId });
        const applied = Array.isArray(latest?.versement_stock_settlement_keys) && latest.versement_stock_settlement_keys.includes(movementKey);
        if (!applied) throw new Error('Stock insuffisant au règlement du versement pour ' + String(before.name || before.item_name || itemId) + '.');
      }
    }
    const after = await items.findOne({ _id: objectId });
    const closing = Number(after?.available_quantity ?? before.available_quantity - qty);
    const opening = closing + qty;
    const logId = new ObjectId(crypto.createHash('sha256').update(movementKey + ':' + itemId).digest('hex').slice(0, 24));
    const log = {
      branch_id: sale.branch_id || versement.branch_id,
      view_item_id: objectId,
      item_barcode_id: String(before.item_barcode_id || before.barcode_id || ''),
      item_name: String(before.name || before.item_name || 'Article'),
      item_quantity: String(qty),
      process: 'Versement réglé',
      reference: String(versement.versement_number || saleKeyValue),
      note: 'Sortie du stock au règlement complet du versement',
      date: settledAt, created_date: settledAt, updated_date: settledAt,
      action: 'Subtract', stocklog: true,
      opening_balance: String(opening), closing_balance: String(closing),
      count: String(-qty), changed_by: 'Versement',
      ...(sale.license ? { license: sale.license } : {}),
    };
    await stockLogs.updateOne({ _id: logId }, { $setOnInsert: log }, { upsert: true });
  }
}

exports.ensureForSale = async (req, sale) => {
  const db = await shopDb(req);
  if (!db || !sale || !sale.versement_checkout) return null;
  const meta = sale.versement_checkout, key = saleKey(sale);
  const customerId = String(meta.customer_id || sale.customer_id?._id || sale.customer_id || '').trim();
  const customer = String(meta.customer_name || sale.customer_name || '').trim().slice(0, 200);
  const phone = String(meta.phone || sale.customer_phone || '').trim().slice(0, 40);
  const initial = money(meta.initial_amount), method = String(meta.initial_method || 'cash').toLowerCase();
  const total = saleTotal(sale), branchRaw = sale.branch_id || branchOf(req);
  if (!key || !customer || !ObjectId.isValid(String(branchRaw)) || !(initial > 0) ||
      total <= 0 || !['cash','tpe','baridimob'].includes(method)) {
    throw new Error('Invalid Versement metadata on the validated sale.');
  }
  const collection = db.collection(COLLECTION);
  await collection.createIndex({ sale_key: 1 }, { unique: true });
  await collection.createIndex({ versement_number: 1 }, { unique: true });
  const existing = await collection.findOne({ sale_key: key });
  if (existing) return { ...existing, _id: String(existing._id) };
  const now = new Date(), settled = initial >= total - 0.009;
  const doc = {
    versement_number: 'V-' + now.toISOString().slice(0,10).replace(/-/g,'') + '-' + require('crypto').randomBytes(3).toString('hex').toUpperCase(),
    sale_key: key, sale_object_id: sale._id, branch_id: new ObjectId(String(branchRaw)),
    ...(sale.cashregister_id && ObjectId.isValid(String(sale.cashregister_id)) ? { register_id: new ObjectId(String(sale.cashregister_id)) } : {}),
    ...(ObjectId.isValid(customerId) ? { customer_id: new ObjectId(customerId) } : {}), customer_name: customer, phone, vendor_name: String(meta.vendor_name || sale.cashier_name || '').trim().slice(0, 80), sale_note: String(sale.sales_description || sale.sale_note || sale.sales_note || '').trim().slice(0, 1000), sale_total: total, initial_amount: initial, initial_method: method,
    remaining: money(Math.max(0, total - initial)), status: settled ? 'settled' : 'pending',
    stock_deferred: meta.stock_deferred === true,
    created_at: now, created_by: actor(req), initial_collected_at: now, initial_recorded_amount: initial,
    ...(settled ? { settled_at: now } : {}),
    settlement: settled ? { amount: 0, method: 'none', settled_at: now, recorded_by: actor(req) } : null,
    history: [{ type: 'initial', amount: initial, method, at: now, by: actor(req) }],
  };
  try {
    const inserted = await collection.insertOne(doc);
    if (settled) {
      await applyDeferredVersementStock(db, sale, doc, now);
      await db.collection('sales').updateOne({ _id: sale._id, versement_checkout: { $exists: true } }, { $set: {
        versement_settled: true, versement_settled_at: now, settled_at: now, date: now,
        payment_status: 'Paid', payment_pending: 0, partial_check: 'false', partial_balance: 0,
        paid_amount: total, versement_settlement_amount: 0,
        versement_initial_amount: initial, versement_initial_method: method,
      } });
    }
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
    const db = await shopDb(req);
    if (!db) return fail(res,500,'Shop database is unavailable.');
    const branch = branchOf(req);
    if (!ObjectId.isValid(branch)) return fail(res,400,'A valid active branch is required to load versements.');
    const filter = { branch_id: new ObjectId(branch) };
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
    const orphanSales = await db.collection('sales').find(saleFilter).limit(2000).toArray();
    const recoveryWarnings = [];
    for (const sale of orphanSales) {
      try { await exports.ensureForSale(req, sale); }
      catch (error) {
        // A malformed/legacy orphan must not make the entire register unloadable.
        // Keep the original sale untouched and report the unresolved reference.
        const key = saleKey(sale);
        recoveryWarnings.push({ sale_key:key, reason:String(error?.message||'Invalid legacy Versement metadata') });
        console.warn('[versements] skipped unrecoverable legacy sale', key, error?.message||error);
      }
    }
    // Repair interrupted F6 settlement commits before applying the requested status filter.
    // This keeps the immutable history visible and lets unfinished claims be retried safely.
    const settlingRows = await db.collection(COLLECTION).find({ branch_id: new ObjectId(branch), status: 'settling' }).toArray();
    for (const row of settlingRows) {
      try {
        const recovered = await recoverSettlingVersement(db, db.collection(COLLECTION), row);
        if (!recovered) recoveryWarnings.push({ sale_key: row.sale_key, reason: 'Settlement is still unresolved; linked sale or tender details are missing.' });
      } catch (error) {
        recoveryWarnings.push({ sale_key: row.sale_key, reason: 'Settlement recovery failed: ' + String(error?.message || 'database error').slice(0, 160) });
      }
    }
    const rows = await db.collection(COLLECTION).find(filter).sort({ created_at:-1 }).limit(2000).toArray();
    const saleIds = rows.map(r => r.sale_object_id).filter(Boolean);
    const saleKeys = rows.map(r => String(r.sale_key || '')).filter(Boolean);
    const linkedSales = saleIds.length || saleKeys.length
      ? await db.collection('sales').find({
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
    }), meta:{ recoveryWarnings } });
  } catch(e) { console.error('[versements] list',e); return fail(res,500,'Unable to load versements: '+String(e?.message||'database error').slice(0,240)); }
};

exports.create = async (req,res) => {
  try {
    const db = await shopDb(req);
    if (!db) return fail(res,500,'Shop database is unavailable.');
    const saleRef = String(req.body?.sale_id || '').trim();
    const customer = String(req.body?.customer_name || '').trim().slice(0,200);
    const phone = String(req.body?.phone || '').trim().slice(0,40);
    const initial = money(req.body?.initial_amount);
    if (!saleRef || !customer || initial <= 0) return fail(res,400,'Sale, customer name and a positive initial amount are required.');
    const branch = branchOf(req);
    if (!ObjectId.isValid(branch)) return fail(res,400,'A valid branch is required.');
    const sale = await db.collection('sales').findOne({ $or:[{ sales_id:saleRef },{ sale_id:saleRef }, ...(ObjectId.isValid(saleRef)?[{_id:new ObjectId(saleRef)}]:[])], branch_id:new ObjectId(branch) });
    if (!sale) return fail(res,404,'The validated sale could not be found in this branch.');
    if (!sale.versement_checkout || String(sale.payment_mode || '').toLowerCase() !== 'versement') {
      return fail(res,409,'Créez les versements depuis Nouvelle vente avec F6. Une vente ordinaire ne peut pas être convertie après coup.');
    }
    const recovered = await exports.ensureForSale(req, sale);
    if (recovered) return res.json({ type:'success', message:'Versement déjà enregistré ou récupéré.', data:recovered });
    const total = saleTotal(sale);
    if (total <= 0) return fail(res,400,'The linked sale total must be greater than zero.');
    const collection = db.collection(COLLECTION);
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
    const db = await shopDb(req);
    if (!db) return fail(res,500,'Shop database is unavailable.');
    if (!ObjectId.isValid(String(req.params.id))) return fail(res,400,'Invalid versement reference.');
    const method = String(req.body?.method || '').toLowerCase();
    if (!['cash','tpe','baridimob'].includes(method)) return fail(res,400,'Choose Espèces, TPE or BaridiMob.');
    const collection = db.collection(COLLECTION), id = new ObjectId(req.params.id);
    const current = await collection.findOne({_id:id});
    if (!current) return fail(res,404,'Versement not found.');
    if (current.status !== 'pending') return fail(res,409,'This versement is already settled or cancelled.');
    const amount = money(current.remaining), settledAt = new Date();
    const registerId = String(req.body?.register_id || req.session?.cashregister_id || req.session?.register_id || req.user?.cashregister_id || '').trim();
    const register = ObjectId.isValid(registerId) ? new ObjectId(registerId) : null;
    const saleFilter = current.sale_object_id ? {_id:current.sale_object_id} : {$or:[{sales_id:current.sale_key},{sale_id:current.sale_key}]};
    const sale = await db.collection('sales').findOne(saleFilter);
    if (!sale) return fail(res,409,'The linked sale is missing; settlement was not recorded.');
    const claimed = await collection.updateOne({_id:id,status:'pending',remaining:current.remaining},{$set:{status:'settling',settlement_started_at:settledAt,settlement_started_by:actor(req),settlement_started_method:method,settlement_started_amount:amount,...(register?{settlement_started_register_id:register}:{})}});
    if (!claimed.modifiedCount) return fail(res,409,'This versement was already updated. Refresh the register.');
    try {
      await applyDeferredVersementStock(db, sale, current, settledAt);
      const saleUpdate = {
        versement_settled:true, versement_settled_at:settledAt, settled_at:settledAt, date:settledAt,
        payment_mode:method, payment_status:'Paid', payment_pending:0, partial_check:'false',
        partial_balance:0, paid_amount:money(current.sale_total),
        versement_settlement_amount:amount,
        versement_initial_amount:money(current.initial_recorded_amount ?? current.initial_amount),
        versement_initial_method:current.initial_method
      };
      if (register) saleUpdate.versement_settlement_register_id=register;
      const saleResult = await db.collection('sales').updateOne({_id:sale._id,versement_checkout:{$exists:true}},{$set:saleUpdate});
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
    const db = await shopDb(req);
    if (!db) return fail(res,500,'Shop database is unavailable.');
    if (!ObjectId.isValid(String(req.params.id))) return fail(res,400,'Invalid versement reference.');
    const id=new ObjectId(req.params.id), collection=db.collection(COLLECTION);
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
    const sale=await db.collection('sales').findOne(saleFilter);
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
    const items=db.collection('items'), stockLogs=db.collection('stocklogs');
    const restoreKey=String(current.sale_key||saleKey(sale))+':versement-cancel';
    if (current.stock_deferred !== true) {
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
    }
    await db.collection('sales').deleteOne({_id:sale._id,versement_checkout:{$exists:true}});
    await collection.deleteOne({_id:id,status:'cancelling'});
    return res.json({type:'success',message:'Versement deleted and reserved stock restored.',data:{id:String(id)}});
  } catch(e) {
    console.error('[versements] cancel',e);
    return fail(res,500,'Unable to delete the versement completely. It remains available for a safe retry; stock restoration is idempotent.');
  }
};

exports.updatePending = async (req,res) => {
  try {
    const db = await shopDb(req);
    if (!db) return fail(res,500,'Shop database is unavailable.');
    if (!ObjectId.isValid(String(req.params.id))) return fail(res,400,'Invalid versement reference.');
    const total=money(req.body?.sale_total);
    if (!(total>0)) return fail(res,400,'The updated sale total must be positive.');
    const collection=db.collection(COLLECTION),id=new ObjectId(req.params.id);
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
