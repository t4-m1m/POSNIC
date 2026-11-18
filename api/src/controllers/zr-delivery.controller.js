'use strict';
const { ObjectId } = require('mongodb');

function scope(req) {
  const user = req.user || {};
  const rawBranch = user.branch_id || user.branchId || user.branch?._id;
  const license = user.license || user.license_id;
  if (!req.db || !rawBranch || !ObjectId.isValid(String(rawBranch)) || !license) {
    const error = new Error('Authenticated branch context is unavailable.');
    error.status = 403; throw error;
  }
  return { branch_id: new ObjectId(String(rawBranch)), license };
}
function fail(res, error) {
  return res.status(error.status || 500).json({ type: 'error', message: error.status ? error.message : 'ZR delivery operation failed.' });
}
function saleId(value) {
  if (!ObjectId.isValid(String(value || ''))) {
    const error = new Error('Invalid sale reference.'); error.status = 400; throw error;
  }
  return new ObjectId(String(value));
}
function statusOf(value) {
  const s = String(value || '').toLowerCase();
  if (/cancel|annul/.test(s)) return 'ANNULEE';
  if (/return|returned|retour/.test(s)) return 'RETOUR';
  if (/paid|encaiss|payout/.test(s)) return 'ENCAISSE';
  if (/deliver|livr/.test(s)) return 'LIVRE';
  return 'EN_COURS';
}
exports.ensureZrCustomer = async (req, res) => {
  try {
    const sc = scope(req), customers = req.db.collection('customers');
    const filter = { name: 'ZR Express', branch_id: sc.branch_id, license: sc.license, is_deleted: { $ne: true } };
    let customer = await customers.findOne(filter);
    if (!customer) {
      const now = new Date();
      const candidate = {
        _id: new ObjectId(), name: 'ZR Express', branch_id: sc.branch_id,
        branch_name: String(req.user?.branch_name || req.user?.branch?.name || ''),
        license: sc.license, phone: '', country: 'Algeria', status: 'active',
        gst: 'disable', gst_type: 'consumer', price_tier: 1,
        creditLimit: 0, currentBalance: 0, paymentTerms: 'net30',
        notes: 'Compte système pour les ventes livrées par ZR Express.',
        created_date: now, updated_date: now,
        created_by: String(req.user?._id || req.user?.username || 'System'),
        updated_by: String(req.user?._id || req.user?.username || 'System')
      };
      try {
        await customers.insertOne(candidate);
        customer = candidate;
      } catch (error) {
        if (!error || error.code !== 11000) throw error;
        customer = await customers.findOne(filter);
        if (!customer) throw error;
      }
    }
    return res.json({ type: 'success', data: { id: String(customer._id), name: 'ZR Express' } });
  } catch (error) { return fail(res, error); }
};
exports.link = async (req, res) => {
  try {
    const sc = scope(req), id = saleId(req.body.saleId);
    const sales = req.db.collection('sales'), deliveries = req.db.collection('zr_deliveries');
    await deliveries.createIndex({sale_id:1,license:1},{unique:true});
    const sale = await sales.findOne({ _id: id, ...sc });
    if (!sale) return res.status(404).json({ type:'error', message:'Sale not found in this branch.' });
    const p = req.body.parcel || {};
    if (!p.id || !p.trackingNumber) return res.status(422).json({ type:'error', message:'ZR Express tracking data is incomplete.' });
    const now = new Date();
    const doc = {
      sale_id: id, sale_number: String(sale.sales_id || ''), branch_id: sc.branch_id, license: sc.license,
      tracking_number: String(p.trackingNumber), parcel_id: String(p.id), external_id: String(req.body.externalId || ''),
      status: statusOf(p.status),
      customer_name: String(req.body.recipientName || req.body.customerName || sale.customer_name || '').trim().slice(0,200),
      customer_phone: String(req.body.recipientPhone || req.body.phone || '').trim().slice(0,40),
      recipient_name: String(req.body.recipientName || req.body.customerName || sale.customer_name || '').trim().slice(0,200),
      recipient_phone: String(req.body.recipientPhone || req.body.phone || '').trim().slice(0,40),
      wilaya: String(req.body.wilaya || ''), commune: String(req.body.commune || ''),
      delivery_type: req.body.deliveryType === 'pickup-point' ? 'pickup-point' : 'home',
      delivery_fee: Math.max(0, Number(req.body.deliveryFee) || 0),
      cod_total: Math.max(0, Number(req.body.codTotal) || 0),
      address: String(req.body.address || '').slice(0,500),
      items: Array.isArray(sale.items) ? sale.items.map(x => ({ item_id:String(x.item_id || ''), name:String(x.item_name || x.name || ''), quantity:Number(x.item_quantity)||0, price:Number(x.item_price)||0, track_inventory:x.track_inventory === true || x.track_inventory === 'true' })) : [],
      created_at: now, updated_at: now, returned_at: null, paid_at: null
    };
    await deliveries.updateOne({ sale_id:id, ...sc }, { $setOnInsert: doc }, { upsert:true });
    const zrCustomer = await req.db.collection('customers').findOne({
      name: 'ZR Express', branch_id: sc.branch_id, license: sc.license, is_deleted: { $ne: true }
    });
    await sales.updateOne({ _id:id, ...sc }, { $set: {
      ...(zrCustomer ? { customer_id: zrCustomer._id, customer_name: 'ZR Express', customer_phone: '', customer_address: '' } : {}),
      delivery_provider:'ZR_EXPRESS', delivery_tracking_number:doc.tracking_number,
      delivery_status:doc.status, deliveryStatus:doc.status,
      payment_mode:'LIVRAISON_ZR', payment_method:'LIVRAISON_ZR',
      delivery_fee:doc.delivery_fee, delivery_cod_total:doc.cod_total
    }});
    const saved = await deliveries.findOne({ sale_id:id, ...sc });
    return res.json({ type:'success', data:saved });
  } catch (e) { return fail(res,e); }
};
exports.list = async (req,res) => {
  try {
    const sc=scope(req), q=String(req.query.q||'').trim().slice(0,100), filter={...sc};
    const status=String(req.query.status||'').toUpperCase();
    if (['EN_COURS','LIVRE','ENCAISSE','RETOUR','ANNULEE'].includes(status)) filter.status=status;
    if(q){const escaped=q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');filter.$or=[
      {tracking_number:{$regex:escaped,$options:'i'}},{customer_name:{$regex:escaped,$options:'i'}},
      {customer_phone:{$regex:escaped,$options:'i'}},{wilaya:{$regex:escaped,$options:'i'}}];}
    const rows=await req.db.collection('zr_deliveries').find(filter).sort({created_at:-1}).limit(1000).toArray();
    const summary=await req.db.collection('zr_deliveries').aggregate([
      {$match:sc},{$group:{_id:'$status',count:{$sum:1},amount:{$sum:'$cod_total'}}}
    ]).toArray();
    return res.json({type:'success',data:{list:rows,summary}});
  } catch(e){return fail(res,e);}
};
exports.cancel = async (req, res) => {
  try {
    const sc = scope(req), tracking = String(req.params.tracking || '').trim();
    const deliveries = req.db.collection('zr_deliveries');
    const row = await deliveries.findOne({ tracking_number: tracking, ...sc });
    if (!row) return res.status(404).json({ type: 'error', message: 'Delivery not found.' });
    const sale = await req.db.collection('sales').findOne({ _id: row.sale_id, ...sc });
    if (!sale || String(sale.status || '').toLowerCase() !== 'cancelled') {
      return res.status(409).json({ type: 'error', message: 'Cancel the linked sale successfully before closing this delivery.' });
    }
    const now = new Date();
    const updated = await deliveries.findOneAndUpdate(
      { _id: row._id, status: { $ne: 'ANNULEE' }, ...sc },
      { $set: { status: 'ANNULEE', cancelled_at: now, updated_at: now } },
      { returnDocument: 'after' }
    );
    const doc = updated && updated.value !== undefined ? updated.value : updated;
    if (!doc) return res.status(409).json({ type: 'error', message: 'Delivery changed; refresh and retry.' });
    await req.db.collection('sales').updateOne({ _id: row.sale_id, ...sc }, {
      $set: { delivery_status: 'ANNULEE', deliveryStatus: 'ANNULEE' }
    });
    return res.json({ type: 'success', data: { tracking_number: tracking, status: 'ANNULEE' } });
  } catch (error) { return fail(res, error); }
};

exports.updateStatus = async (req,res) => {
  try {
    const sc=scope(req), tracking=String(req.params.tracking||'').trim(), next=statusOf(req.body.status);
    if (next === 'ANNULEE') return res.status(400).json({ type:'error', message:'Use the Annuler action to cancel the parcel and its linked sale together.' });
    const col=req.db.collection('zr_deliveries'), row=await col.findOne({tracking_number:tracking,...sc});
    if(!row) return res.status(404).json({type:'error',message:'Delivery not found.'});
    if(row.status==='ANNULEE') return res.status(409).json({type:'error',message:'Cancelled deliveries are closed.'});
    if(row.status==='RETOUR' && next!=='RETOUR') return res.status(409).json({type:'error',message:'Returned parcels are closed.'});
    const now=new Date(), set={status:next,updated_at:now};
    if(next==='ENCAISSE') { if(row.status!=='LIVRE' && row.status!=='ENCAISSE') return res.status(409).json({type:'error',message:'Only delivered parcels can be paid out.'}); set.paid_at=row.paid_at||now; }
    if(next==='RETOUR') set.returned_at=row.returned_at||now;
    const updated=await col.findOneAndUpdate({_id:row._id,status:row.status},{ $set:set },{returnDocument:'after'});
    const updatedDoc = updated && updated.value !== undefined ? updated.value : updated;
    if(!updatedDoc) return res.status(409).json({type:'error',message:'Delivery changed; refresh and retry.'});
    const saleCol=req.db.collection('sales');
    await saleCol.updateOne({_id:row.sale_id,...sc},{$set:{delivery_status:next,deliveryStatus:next,...(next==='ENCAISSE'?{delivery_paid_at:set.paid_at}:{})}});
    if(next==='RETOUR' && !row.returned_at) {
      const sales=await saleCol.findOne({_id:row.sale_id,...sc});
      const items=req.db.collection('items');
      for(const line of (sales?.items||[])){
        if(!(line.track_inventory===true||line.track_inventory==='true')) continue;
        if(!ObjectId.isValid(String(line.item_id||''))) continue;
        await items.updateOne({_id:new ObjectId(String(line.item_id)),license:sc.license},{$inc:{available_quantity:Number(line.item_quantity)||0}});
      }
    }
    if(next==='ENCAISSE' && row.status!=='ENCAISSE') {
      const payoutCollection=req.db.collection('zr_delivery_payouts');
      await payoutCollection.createIndex({tracking_number:1,license:1},{unique:true});
      await payoutCollection.updateOne({tracking_number:tracking,...sc},
        {$setOnInsert:{tracking_number:tracking,sale_id:row.sale_id,branch_id:sc.branch_id,license:sc.license,amount:row.cod_total,method:'cash',paid_at:set.paid_at,created_by:String(req.user?._id||'')}},{upsert:true});
    }
    return res.json({type:'success',data:{tracking_number:tracking,status:next}});
  } catch(e){return fail(res,e);}
};
