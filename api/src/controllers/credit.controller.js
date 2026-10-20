'use strict';

const BaseController = require('./base.controller');
const CreditService = require('../services/credit.service');
const BaseModel = require('../models/base.model');

class CreditController extends BaseController {
  constructor() {
    super();
    this.service = new CreditService();
  }

  _ctx(req) {
    const u = req.user || {};
    const t = req.tenantContext || {};
    return {
      branchId: t.branchId || u.branch_id || u.branchId || BaseModel.currentBranch || null,
      branchName: t.branchName || u.branch_name || BaseModel.currentBranchName || '',
      userName: u.name || u.username || u.email || '',
      userId: u._id || u.id || null,
      currency: t.currency || u.currency_type || '',
    };
  }

  _canWrite(req) {
    return req.user?.access?.branch?.write !== false;
  }

  /** GET /credit/settings - this branch's credit + reminder rules. */
  async getSettings(req, res) {
    try {
      const ctx = this._ctx(req);
      const data = await this.service.getSettings(ctx.branchId);
      return this.success(res, data, 'Credit settings');
    } catch (e) {
      console.error('Error in credit.getSettings:', e);
      return this.error(res, e.message, 500);
    }
  }

  /** PUT /credit/settings - save the credit + reminder rules. */
  async saveSettings(req, res) {
    try {
      if (!this._canWrite(req)) return this.error(res, 'Unauthorized', 403);
      const ctx = this._ctx(req);
      const data = await this.service.saveSettings(ctx.branchId, req.body || {}, ctx);
      return this.success(res, data, 'Credit settings saved');
    } catch (e) {
      console.error('Error in credit.saveSettings:', e);
      return this.error(res, e.message, 500);
    }
  }

  /** GET /credit/outstanding - customers who owe money (khata), most first. */
  async outstanding(req, res) {
    try {
      const ctx = this._ctx(req);
      const minDue = Number(req.query.minDue) || 0;
      const r = await this.service.outstanding(ctx.branchId, { minDue });
      return this.success(res, r.data, r.message);
    } catch (e) {
      console.error('Error in credit.outstanding:', e);
      return this.error(res, e.message, 500);
    }
  }

  /** GET /credit/ledger/:customerId - unpaid sale balances for one customer. */
  async ledger(req, res) {
    try {
      const ctx = this._ctx(req);
      const rows = await this.service.ledger(req.params.customerId, ctx.branchId);
      return this.success(res, rows, 'Customer debt ledger');
    } catch (e) {
      console.error('Error in credit.ledger:', e);
      return this.error(res, e.message, 400);
    }
  }

  /** POST /credit/settle/:customerId - collect money against original sale balances. */
  async settle(req, res) {
    try {
      if (!this._canWrite(req)) return this.error(res, 'Unauthorized', 403);
      const ctx = this._ctx(req);
      const data = await this.service.settleDebt(req.params.customerId, req.body || {}, ctx);
      return this.success(res, data, 'Debt payment recorded');
    } catch (e) {
      console.error('Error in credit.settle:', e);
      return this.error(res, e.message, /changed during collection/.test(e.message) ? 409 : 400);
    }
  }


  /** GET /credit/collections?date=YYYY-MM-DD - debt money actually received on that day. */
  async collections(req, res) {
    try {
      const ctx = this._ctx(req);
      const date = String(req.query.date || '').trim();
      if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date)) return this.error(res, 'A valid date is required (YYYY-MM-DD).', 400);
      const start = new Date(date + 'T00:00:00');
      const end = new Date(date + 'T23:59:59.999');
      const db = await BaseModel.getDb();
      const query = { license: BaseModel.license, received_at: { $gte: start, $lte: end } };
      if (ctx.branchId) {
        const ObjectId = require('mongodb').ObjectId;
        query.branch_id = ObjectId.isValid(String(ctx.branchId)) ? new ObjectId(String(ctx.branchId)) : ctx.branchId;
      }
      const rows = await db.collection('credit_payments').find(query).sort({ received_at: 1, _id: 1 }).toArray();
      const totals = { cash: 0, card: 0, bank_transfer: 0, other: 0, total: 0 };
      const collections = rows.map(function (row) {
        const method = String(row.method || 'other').toLowerCase();
        const amount = Math.round((Number(row.amount) || 0) * 100) / 100;
        const key = Object.prototype.hasOwnProperty.call(totals, method) && method !== 'total' ? method : 'other';
        totals[key] = Math.round((totals[key] + amount) * 100) / 100;
        totals.total = Math.round((totals.total + amount) * 100) / 100;
        return { date: row.received_at, amount, method: key, customer: row.customer_name || 'Client', received_by: row.received_by || '', register_id: row.register_id ? String(row.register_id) : '', note: row.note || '', payment_id: String(row._id || ''), allocations: Array.isArray(row.allocations) ? row.allocations : [], branch_id: row.branch_id ? String(row.branch_id) : '' };
      });
      return this.success(res, { date, totals, collections }, 'Debt collections for the selected date');
    } catch (e) {
      console.error('Error in credit.collections:', e);
      return this.error(res, e.message || 'Unable to load debt collections.', 500);
    }
  }

  /** GET /credit/check-limit?customerId=&amount= - would this credit sale fit? */
  async checkLimit(req, res) {
    try {
      const ctx = this._ctx(req);
      const { customerId, amount } = req.query || {};
      const r = await this.service.checkCreditLimit(customerId, Number(amount) || 0, ctx.branchId);
      return this.success(res, r, 'Credit limit check');
    } catch (e) {
      console.error('Error in credit.checkLimit:', e);
      return this.error(res, e.message, 500);
    }
  }

  /** POST /credit/reminder/:customerId - send one customer their reminder now. */
  async sendReminder(req, res) {
    try {
      if (!this._canWrite(req)) return this.error(res, 'Unauthorized', 403);
      const ctx = this._ctx(req);
      const dryRun = (req.body || {}).dryRun === true || (req.body || {}).dryRun === 'true';
      const r = await this.service.sendReminder(req.params.customerId, {
        branchId: ctx.branchId,
        ctx,
        dryRun,
      });
      if (!r.status) return this.error(res, r.message, 400, r.data);
      return this.success(res, r.data, r.message);
    } catch (e) {
      console.error('Error in credit.sendReminder:', e);
      return this.error(res, e.message, 500);
    }
  }

  /** POST /credit/run-reminders - remind every outstanding customer (cron/manual). */
  async runReminders(req, res) {
    try {
      if (!this._canWrite(req)) return this.error(res, 'Unauthorized', 403);
      const ctx = this._ctx(req);
      const dryRun = (req.body || {}).dryRun === true || (req.body || {}).dryRun === 'true';
      const r = await this.service.runReminders(ctx.branchId, { ctx, dryRun });
      return this.success(res, r.data, r.message);
    } catch (e) {
      console.error('Error in credit.runReminders:', e);
      return this.error(res, e.message, 500);
    }
  }
}

module.exports = new CreditController();
