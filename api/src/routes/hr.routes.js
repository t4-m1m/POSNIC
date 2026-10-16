const express = require('express');
const { ObjectId } = require('mongodb');
const { protect } = require('../middleware/auth');
const BaseModel = require('../models/base.model');

const router = express.Router();
router.use(protect);

function context(req) {
  const user = req.user || {};
  const role = String(user.usertype || user.role || user.role_name || user.user_type || '').toLowerCase().replace(/[\s-]+/g, '_');
  const isAdmin = [true, 'true', 1, '1'].includes(user.is_admin) || [true, 'true', 1, '1'].includes(user.admin) || ['admin', 'administrator', 'owner', 'super_admin', 'superadmin'].includes(role);
  if (!isAdmin) {
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
function sendError(res, error) {
  return res.status(error.status || 500).json({ status: false, message: error.message || 'HR operation failed.' });
}
router.use((req, res, next) => { try { req.hrContext = context(req); next(); } catch (e) { sendError(res, e); } });

router.get('/summary', async (req, res) => {
  try {
    const { license } = req.hrContext;
    const [workers, tx] = await Promise.all([
      (await collection('hr_workers')).find({ license, active: { $ne: false } }).toArray(),
      (await collection('hr_transactions')).find({ license }).sort({ date: -1 }).limit(5000).toArray()
    ]);
    const now = new Date(), period = String(now.getFullYear()) + '-' + String(now.getMonth() + 1).padStart(2, '0');
    const monthTx = tx.filter(t => String(t.period || '').startsWith(period));
    const advances = monthTx.filter(t => t.type === 'advance').reduce((s,t)=>s+t.amount,0);
    const overtime = monthTx.filter(t => t.type === 'overtime').reduce((s,t)=>s+t.amount,0);
    const payments = monthTx.filter(t => t.type === 'salary_payment').reduce((s,t)=>s+t.amount,0);
    res.json({ status:true, data:{ workers:workers.length, monthlyPayroll:workers.reduce((s,w)=>s+Number(w.monthly_salary||0),0), advances, overtime, payments, period } });
  } catch(e) { sendError(res,e); }
});
router.get('/workers', async (req,res) => {
  try {
    const rows = await (await collection('hr_workers')).find({ license:req.hrContext.license }).sort({ name:1 }).toArray();
    res.json({status:true,data:rows.map(w=>({...w,_id:String(w._id)}))});
  } catch(e) { sendError(res,e); }
});
router.post('/workers', async (req,res) => {
  try {
    const {license,username,userId}=req.hrContext, b=req.body||{};
    const name=String(b.name||'').trim();
    if (!name) return res.status(400).json({status:false,message:'Worker name is required.'});
    const now=new Date(), worker={name,job_title:String(b.job_title||'').trim(),phone:String(b.phone||'').trim(),start_date:dateValue(b.start_date,'start date'),monthly_salary:amount(b.monthly_salary,'Monthly salary'),hourly_rate:amount(b.hourly_rate||0,'Hourly rate'),active:b.active!==false,notes:String(b.notes||'').trim(),license,created_at:now,updated_at:now,created_by:userId,created_by_name:username};
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
    if (b.notes!==undefined)set.notes=String(b.notes).trim();
    if (b.monthly_salary!==undefined)set.monthly_salary=amount(b.monthly_salary,'Monthly salary');
    if (b.hourly_rate!==undefined)set.hourly_rate=amount(b.hourly_rate,'Hourly rate');
    if (b.start_date!==undefined)set.start_date=dateValue(b.start_date,'start date');
    if (b.active!==undefined)set.active=!!b.active;
    const col=await collection('hr_workers'),result=await col.findOneAndUpdate({_id:new ObjectId(req.params.id),license},{$set:set},{returnDocument:'after'});
    if(!result.value)return res.status(404).json({status:false,message:'Worker not found.'});
    res.json({status:true,data:{...result.value,_id:String(result.value._id)},message:'Worker updated.'});
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
    if(!['salary_payment','advance','overtime','adjustment'].includes(type))return res.status(400).json({status:false,message:'Invalid transaction type.'});
    const d=dateValue(b.date), period=String(b.period||d.toISOString().slice(0,7)).slice(0,7);
    if(!/^\d{4}-\d{2}$/.test(period))return res.status(400).json({status:false,message:'Period must use YYYY-MM.'});
    let value;
    if(type==='overtime') {
      const hours=amount(b.hours,'Overtime hours'), rate=amount(b.hourly_rate===undefined?worker.hourly_rate:b.hourly_rate,'Hourly rate');
      if(hours<=0)return res.status(400).json({status:false,message:'Overtime hours must be greater than zero.'});
      value={hours,hourly_rate:rate,amount:amount(hours*rate,'Overtime amount')};
    } else value={amount:amount(b.amount,'Amount')};
    if(value.amount<=0)return res.status(400).json({status:false,message:'Amount must be greater than zero.'});
    const doc={worker_id:workerId,worker_name:worker.name,type,...value,date:d,period,method:String(b.method||'cash'),reference:String(b.reference||'').trim(),notes:String(b.notes||'').trim(),license,created_at:new Date(),created_by:userId,created_by_name:username};
    const result=await (await collection('hr_transactions')).insertOne(doc);
    res.status(201).json({status:true,data:{...doc,_id:String(result.insertedId),worker_id:String(workerId)},message:'Transaction recorded.'});
  } catch(e) { sendError(res,e); }
});
router.get('/payroll/:period', async (req,res) => {
  try {
    const period=String(req.params.period||'');
    if(!/^\d{4}-\d{2}$/.test(period))return res.status(400).json({status:false,message:'Period must use YYYY-MM.'});
    const {license}=req.hrContext;
    const [workers,tx]=await Promise.all([
      (await collection('hr_workers')).find({license,active:{$ne:false}}).toArray(),
      (await collection('hr_transactions')).find({license,period}).toArray()
    ]);
    const rows=workers.map(w=>{
      const entries=tx.filter(t=>String(t.worker_id)===String(w._id));
      const advances=entries.filter(t=>t.type==='advance').reduce((s,t)=>s+t.amount,0);
      const overtime=entries.filter(t=>t.type==='overtime').reduce((s,t)=>s+t.amount,0);
      const adjustments=entries.filter(t=>t.type==='adjustment').reduce((s,t)=>s+t.amount,0);
      const paid=entries.filter(t=>t.type==='salary_payment').reduce((s,t)=>s+t.amount,0);
      const gross=Math.max(0,Number(w.monthly_salary||0)+overtime+adjustments);
      return {_id:String(w._id),name:w.name,monthly_salary:Number(w.monthly_salary||0),overtime,adjustments,advances,paid,gross,remaining:Math.max(0,gross-advances-paid)};
    });
    res.json({status:true,data:rows});
  } catch(e) { sendError(res,e); }
});
module.exports=router;
