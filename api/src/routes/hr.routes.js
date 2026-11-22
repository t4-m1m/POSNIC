const express = require('express');
const { ObjectId } = require('mongodb');
const { protect } = require('../middleware/auth');
const BaseModel = require('../models/base.model');

const router = express.Router();
router.use(protect);

function context(req) {
  const user = req.user || {};
  // Legacy POSNIC accounts can have usertype="staff" as a default while
  // the actual authorization role is stored in role="admin". Evaluate every
  // known role field instead of letting a truthy default mask the admin role.
  const roleValues = [
    user.usertype,
    user.role && typeof user.role === 'object'
      ? (user.role.name || user.role.role || user.role.usertype || user.role.key)
      : user.role,
    user.role_name, user.user_type, user.type, user.userType,
  ].filter(value => value !== undefined && value !== null && value !== '');
  const roles = roleValues.map(value => String(value).trim().toLowerCase().replace(/[\s-]+/g, '_'));
  const adminRoles = ['admin', 'admin_user', 'administrator', 'owner', 'super_admin', 'superadmin', 'super_administrator'];
  const isAdmin = [true, 'true', 1, '1'].includes(user.is_admin) ||
    [true, 'true', 1, '1'].includes(user.admin) ||
    roles.some(role => adminRoles.includes(role));
  const quickAdvanceRoute = req.path === '/quick-advance' || req.path === '/quick-advance/workers' || req.path === '/vendors';
  if (!isAdmin && !quickAdvanceRoute) {
    const error = new Error('Only administrators can access employee salary records.');
    error.status = 403;
    throw error;
  }
  const license = req.tenantContext?.licenseId || user.license || user.license_id || BaseModel.license;
  if (!license) {
    const error = new Error('Shop context is missing.');
    error.status = 400;
    throw error;
  }
  return { license, userId: user._id || null, username: user.username || user.name || user.email || 'system' };
}
async function collection(name) {
  const model = new BaseModel(name);
  return model.getCollection(name);
}
function amount(value, field) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 1e12) {
    const error = new Error(field + ' must be a non-negative amount.');
    error.status = 400;
    throw error;
  }
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
function dateValue(value, field = 'date') {
  const d = value ? new Date(value) : new Date();
  if (!Number.isFinite(d.getTime())) {
    const error = new Error('Invalid ' + field + '.');
    error.status = 400;
    throw error;
  }
  return d;
}
function payrollPeriod(value, fallbackDate) {
  const period = String(value || fallbackDate.toISOString().slice(0, 7)).slice(0, 7);
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(period) === false) {
    const error = new Error('Period must use a valid YYYY-MM month.');
    error.status = 400;
    throw error;
  }
  return period;
}
function sendError(res, error) {
  return res.status(error.status || 500).json({ status: false, message: error.message || 'HR operation failed.' });
}
router.use((req, res, next) => { try { req.hrContext = context(req); next(); } catch (e) { sendError(res, e); } });

// Cashier-safe quick advance: employee names only; payroll data remains admin-only.
router.get('/quick-advance/workers', async (req, res) => {
  try {
    const rows = await (await collection('hr_workers')).find({
      license: req.hrContext.license, active: { $ne: false }, deleted: { $ne: true }
    }).project({ name: 1 }).sort({ name: 1 }).toArray();
    res.json({ status: true, data: rows.map(w => ({ _id: String(w._id), name: w.name })) });
  } catch (e) { sendError(res, e); }
});
router.post('/quick-advance', async (req, res) => {
  try {
    const { license, username, userId } = req.hrContext, b = req.body || {};
    if (!ObjectId.isValid(String(b.worker_id || ''))) return res.status(400).json({ status: false, message: 'Choisissez un employé valide.' });
    const workerId = new ObjectId(String(b.worker_id));
    const worker = await (await collection('hr_workers')).findOne({ _id: workerId, license, active: { $ne: false } });
    if (!worker) return res.status(404).json({ status: false, message: 'Employé actif introuvable.' });
    const value = amount(b.amount, 'Montant');
    if (value <= 0) return res.status(400).json({ status: false, message: 'Le montant doit être supérieur à zéro.' });
    const d = dateValue(b.date), period = payrollPeriod(b.period, d);
    const existing = await (await collection('hr_transactions')).find({
      license, worker_id: workerId, period, cancelled_at: { $exists: false }, is_cancelled: { $ne: true },
      type: { $in: ['salary_payment', 'advance', 'overtime', 'prime_weekly', 'prime_monthly', 'adjustment'] }
    }).toArray();
    const advances = existing.filter(t => t.type === 'advance').reduce((sum,t) => sum + Number(t.amount || 0), 0);
    const paid = existing.filter(t => t.type === 'salary_payment').reduce((sum,t) => sum + Number(t.amount || 0), 0);
    const overtime = existing.filter(t => t.type === 'overtime').reduce((sum,t) => sum + Number(t.amount || 0), 0);
    const adjustments = existing.filter(t => t.type === 'adjustment').reduce((sum,t) => sum + Number(t.amount || 0), 0);
    const gross = Math.max(0, Number(worker.monthly_salary || 0) + overtime + adjustments);
    const remaining = Math.max(0, gross - advances - paid);
    if (value > remaining) return res.status(400).json({ status: false, message: 'Le montant dépasse le solde de salaire disponible.' });
    const doc = { worker_id: workerId, worker_name: worker.name, type: 'advance', amount: value,
      date: d, period, method: String(b.method || 'cash'), reference: '',
      notes: String(b.notes || 'Acompte rapide depuis la caisse').trim(), license,
      created_at: new Date(), created_by: userId, created_by_name: username };
    const result = await (await collection('hr_transactions')).insertOne(doc);
    res.status(201).json({ status: true, data: { ...doc, _id: String(result.insertedId), worker_id: String(workerId) }, message: 'Acompte enregistré.' });
  } catch (e) { sendError(res, e); }
});

router.get('/summary', async (req, res) => {
  try {
    const { license } = req.hrContext;
    const [workers, tx] = await Promise.all([
      (await collection('hr_workers')).find({ license, active: { $ne: false }, deleted: { $ne: true } }).toArray(),
      (await collection('hr_transactions')).find({ license, cancelled_at: { $exists: false }, is_cancelled: { $ne: true } }).sort({ date: -1 }).limit(5000).toArray()
    ]);
    const now = new Date(), period = String(now.getFullYear()) + '-' + String(now.getMonth() + 1).padStart(2, '0');
    const monthTx = tx.filter(t => String(t.period || '').startsWith(period));
    const advances = monthTx.filter(t => t.type === 'advance').reduce((s,t)=>s+t.amount,0);
    const overtime = monthTx.filter(t => t.type === 'overtime').reduce((s,t)=>s+t.amount,0);
    const payments = monthTx.filter(t => t.type === 'salary_payment').reduce((s,t)=>s+t.amount,0);
    const activeWorkerIds = new Set(workers.map(w => String(w._id)));
    const additions = monthTx.filter(t => activeWorkerIds.has(String(t.worker_id)) && ['overtime','adjustment'].includes(t.type)).reduce((s,t)=>s+Number(t.amount||0),0);
    res.json({ status:true, data:{ workers:workers.length, monthlyPayroll:workers.reduce((s,w)=>s+Number(w.monthly_salary||0),0)+additions, advances, overtime, payments, period } });
  } catch(e) { sendError(res,e); }
});
router.get('/vendors', async (req,res) => {
  try { const rows=await (await collection('hr_workers')).find({license:req.hrContext.license,active:{$ne:false},deleted:{$ne:true}}).project({name:1,job_title:1,badge_color:1,phone:1}).sort({name:1}).toArray(); res.json({status:true,data:rows.map(w=>({...w,_id:String(w._id)}))}); } catch(e) { sendError(res,e); }
});
router.get('/workers', async (req,res) => {
  try {
    const rows = await (await collection('hr_workers')).find({ license:req.hrContext.license, deleted: { $ne: true } }).sort({ name:1 }).toArray();
    res.json({status:true,data:rows.map(w=>({...w,_id:String(w._id)}))});
  } catch(e) { sendError(res,e); }
});
router.post('/workers', async (req,res) => {
  try {
    const {license,username,userId}=req.hrContext, b=req.body||{};
    const name=String(b.name||'').trim();
    if (!name) return res.status(400).json({status:false,message:'Worker name is required.'});
    const now=new Date(), worker={name,job_title:String(b.job_title||'').trim(),phone:String(b.phone||'').trim(),badge_color:String(b.badge_color||'#2563eb').slice(0,32),start_date:dateValue(b.start_date,'start date'),monthly_salary:amount(b.monthly_salary,'Monthly salary'),hourly_rate:amount(b.hourly_rate||0,'Hourly rate'),active:b.active!==false,notes:String(b.notes||'').trim(),license,created_at:now,updated_at:now,created_by:userId,created_by_name:username};
    const result=await (await collection('hr_workers')).insertOne(worker);
    res.status(201).json({status:true,data:{...worker,_id:String(result.insertedId)},message:'Worker saved.'});
  } catch(e) { sendError(res,e); }
});
router.put('/workers/:id', async (req,res) => {
  try {
    if (!ObjectId.isValid(req.params.id)) return res.status(400).json({status:false,message:'Invalid worker ID.'});
    const {license,username}=req.hrContext,b=req.body||{},set={updated_at:new Date(),updated_by_name:username};
    if (b.name!==undefined) {set.name=String(b.name).trim();if(!set.name)return res.status(400).json({status:false,message:'Worker name is required.'});}
    if (b.job_title!==undefined)set.job_title=String(b.job_title).trim();
    if (b.phone!==undefined)set.phone=String(b.phone).trim();
    if (b.badge_color!==undefined)set.badge_color=String(b.badge_color||'#2563eb').slice(0,32);
    if (b.notes!==undefined)set.notes=String(b.notes).trim();
    if (b.monthly_salary!==undefined)set.monthly_salary=amount(b.monthly_salary,'Monthly salary');
    if (b.hourly_rate!==undefined)set.hourly_rate=amount(b.hourly_rate,'Hourly rate');
    if (b.start_date!==undefined)set.start_date=dateValue(b.start_date,'start date');
    if (b.active!==undefined)set.active=!!b.active;
    const col=await collection('hr_workers'),result=await col.findOneAndUpdate({_id:new ObjectId(req.params.id),license},{$set:set},{returnDocument:'after'});
    const updated = result && Object.prototype.hasOwnProperty.call(result, 'value') ? result.value : result;
    if(!updated)return res.status(404).json({status:false,message:'Worker not found.'});
    res.json({status:true,data:{...updated,_id:String(updated._id)},message:'Worker updated.'});
  } catch(e) { sendError(res,e); }
});
router.post('/workers/:id/delete', async (req,res) => {
  try {
    if (!ObjectId.isValid(req.params.id)) return res.status(400).json({status:false,message:'Invalid worker ID.'});
    const {license,username}=req.hrContext;
    const col=await collection('hr_workers');
    const result=await col.updateOne({_id:new ObjectId(req.params.id),license,deleted:{$ne:true}},{$set:{active:false,deleted:true,deleted_at:new Date(),deleted_by_name:username,updated_at:new Date()}});
    if (!result.matchedCount) return res.status(404).json({status:false,message:'Employee not found or already deleted.'});
    res.json({status:true,message:'Employee removed from the active list. Payroll history has been preserved.'});
  } catch(e) { sendError(res,e); }
});
router.get('/transactions', async (req,res) => {
  try {
    const q={license:req.hrContext.license};
    if(req.query.worker_id){if(!ObjectId.isValid(req.query.worker_id))return res.status(400).json({status:false,message:'Invalid worker ID.'});q.worker_id=new ObjectId(req.query.worker_id);}
    if(req.query.period)q.period=String(req.query.period).slice(0,7);
    const rows=await (await collection('hr_transactions')).find(q).sort({date:-1,created_at:-1}).limit(5000).toArray();
    res.json({status:true,data:rows.map(t=>({...t,_id:String(t._id),worker_id:String(t.worker_id)}))});
  } catch(e) { sendError(res,e); }
});
router.post('/transactions', async (req,res) => {
  try {
    const {license,username,userId}=req.hrContext,b=req.body||{};
    if(!ObjectId.isValid(String(b.worker_id||'')))return res.status(400).json({status:false,message:'Select a valid worker.'});
    const workerId=new ObjectId(String(b.worker_id)), worker=await (await collection('hr_workers')).findOne({_id:workerId,license,active:{$ne:false}});
    if(!worker)return res.status(404).json({status:false,message:'Active worker not found.'});
    const type=String(b.type||'');
    if(!['salary_payment','advance','overtime','prime_weekly','prime_monthly','adjustment'].includes(type))return res.status(400).json({status:false,message:'Invalid transaction type.'});
    const d=dateValue(b.date), period=payrollPeriod(b.period, d);
    let value;
    if(type==='overtime') {
      const hours=amount(b.hours,'Overtime hours'), rate=amount(b.hourly_rate===undefined?worker.hourly_rate:b.hourly_rate,'Hourly rate');
      if(hours<=0)return res.status(400).json({status:false,message:'Overtime hours must be greater than zero.'});
      value={hours,hourly_rate:rate,amount:amount(hours*rate,'Overtime amount')};
    } else value={amount:amount(b.amount,'Amount')};
    if(value.amount<=0)return res.status(400).json({status:false,message:'Amount must be greater than zero.'});
    if (type === 'salary_payment' || type === 'advance') {
      // Prevent both advances and salary payments from exceeding the unpaid balance.
      const existing = await (await collection('hr_transactions'))
        .find({ license, worker_id: workerId, period, cancelled_at: { $exists: false }, is_cancelled: { $ne: true }, type: { $in: ['salary_payment', 'advance', 'overtime', 'prime_weekly', 'prime_monthly', 'adjustment'] } })
        .toArray();
      const advances = existing.filter(t => t.type === 'advance').reduce((sum, t) => sum + Number(t.amount || 0), 0);
      const paid = existing.filter(t => t.type === 'salary_payment').reduce((sum, t) => sum + Number(t.amount || 0), 0);
      const overtime = existing.filter(t => t.type === 'overtime').reduce((sum, t) => sum + Number(t.amount || 0), 0);
      const adjustments = existing.filter(t => t.type === 'adjustment').reduce((sum, t) => sum + Number(t.amount || 0), 0);
      const gross = Math.max(0, Number(worker.monthly_salary || 0) + overtime + adjustments);
      const remaining = Math.max(0, gross - advances - paid);
      if (value.amount > remaining) {
        return res.status(400).json({
          status: false,
          message: (type === 'advance' ? 'Advance' : 'Payment') + ' exceeds the remaining salary balance of ' + remaining.toFixed(2) + ' DA.'
        });
      }
    }
    const doc={worker_id:workerId,worker_name:worker.name,type,...value,date:d,period,method:String(b.method||'cash'),reference:String(b.reference||'').trim(),notes:String(b.notes||'').trim(),license,created_at:new Date(),created_by:userId,created_by_name:username};
    const result=await (await collection('hr_transactions')).insertOne(doc);
    res.status(201).json({status:true,data:{...doc,_id:String(result.insertedId),worker_id:String(workerId)},message:'Transaction recorded.'});
  } catch(e) { sendError(res,e); }
});
router.post('/transactions/:id/delete', async (req,res) => {
  try {
    if (!ObjectId.isValid(req.params.id)) return res.status(400).json({status:false,message:'Invalid transaction ID.'});
    const col=await collection('hr_transactions');
    const result=await col.deleteOne({
      _id:new ObjectId(req.params.id),
      license:req.hrContext.license,
      type:{$in:['salary_payment','advance']}
    });
    if (!result.deletedCount) {
      const existing=await col.findOne({_id:new ObjectId(req.params.id),license:req.hrContext.license});
      if (!existing) return res.status(404).json({status:false,message:'Payroll transaction not found.'});
      return res.status(400).json({status:false,message:'Only salary payments and advances can be deleted here.'});
    }
    res.json({status:true,message:'Payroll transaction deleted. Payroll and cash closing totals are recalculated from the remaining records.'});
  } catch(e) { sendError(res,e); }
});

router.post('/transactions/:id/cancel', async (req,res) => {
  try {
    if (!ObjectId.isValid(req.params.id)) return res.status(400).json({status:false,message:'Invalid transaction ID.'});
    const {license,username,userId}=req.hrContext;
    const col=await collection('hr_transactions');
    const now=new Date();
    const result=await col.updateOne(
      {_id:new ObjectId(req.params.id),license,type:'salary_payment',cancelled_at:{$exists:false},is_cancelled:{$ne:true}},
      {$set:{cancelled_at:now,cancelled_by:userId,cancelled_by_name:username,cancellation_note:String((req.body||{}).reason||'').trim(),updated_at:now}}
    );
    if (!result.matchedCount) {
      const existing=await col.findOne({_id:new ObjectId(req.params.id),license});
      if (!existing) return res.status(404).json({status:false,message:'Salary payment not found.'});
      if (existing.type!=='salary_payment') return res.status(400).json({status:false,message:'Only salary payments can be cancelled here.'});
      return res.status(409).json({status:false,message:'This salary payment is already cancelled.'});
    }
    res.json({status:true,message:'Salary payment cancelled. Payroll and cash closing totals have been recalculated.'});
  } catch(e) { sendError(res,e); }
});

router.get('/payroll/:period', async (req,res) => {
  try {
    const period=String(req.params.period||'');
    if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(period))return res.status(400).json({status:false,message:'Period must use a valid YYYY-MM month.'});
    const {license}=req.hrContext;
    const [workers,tx]=await Promise.all([
      (await collection('hr_workers')).find({license,active:{$ne:false},deleted:{$ne:true}}).toArray(),
      (await collection('hr_transactions')).find({license,period,cancelled_at:{$exists:false},is_cancelled:{$ne:true}}).toArray()
    ]);
    const rows=workers.map(w=>{
      const entries=tx.filter(t=>String(t.worker_id)===String(w._id) && !t.cancelled_at && t.is_cancelled!==true);
      const advances=entries.filter(t=>t.type==='advance').reduce((s,t)=>s+t.amount,0);
      const overtime=entries.filter(t=>t.type==='overtime').reduce((s,t)=>s+t.amount,0);
      const weekly_primes=entries.filter(t=>t.type==='prime_weekly').reduce((s,t)=>s+t.amount,0);
      const monthly_primes=entries.filter(t=>t.type==='prime_monthly').reduce((s,t)=>s+t.amount,0);
      const primes=weekly_primes+monthly_primes;
      const adjustments=entries.filter(t=>t.type==='adjustment').reduce((s,t)=>s+t.amount,0);
      const paid=entries.filter(t=>t.type==='salary_payment').reduce((s,t)=>s+t.amount,0);
      const gross=Math.max(0,Number(w.monthly_salary||0)+overtime+adjustments);
      return {_id:String(w._id),name:w.name,monthly_salary:Number(w.monthly_salary||0),overtime,weekly_primes,monthly_primes,primes,adjustments,advances,paid,gross,remaining:Math.max(0,gross-advances-paid)};
    });
    res.json({status:true,data:rows});
  } catch(e) { sendError(res,e); }
});
module.exports=router;
