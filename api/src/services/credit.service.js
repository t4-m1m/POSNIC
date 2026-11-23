'use strict';

const { ObjectId } = require('mongodb');
const BaseModel = require('../models/base.model');

const oid = (v) => (v && ObjectId.isValid(String(v)) ? new ObjectId(String(v)) : v);
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const saleLookupQuery = (ref, branchId) => {
  const value = String(ref == null ? '' : ref).trim();
  const alternatives = [{ sales_id: value }, { sale_id: value }];
  if (ObjectId.isValid(value)) alternatives.unshift({ _id: oid(value) });
  const query = { license: BaseModel.license, $or: alternatives };
  if (branchId) query.branch_id = { $in: [oid(branchId), String(branchId)] };
  return query;
};

const DEFAULTS = {
  default_credit_limit: 0, // 0 = unlimited
  credit_terms_days: 0, // 0 = no due date
  reminder_enabled: false,
  reminder_channel: 'sms',
  reminder_template:
    'Hi {name}, you have {currency}{due} due at {shop}. Please pay at your convenience. Thank you.',
  reminder_min_due: 0,
  currency: '',
};

/*
 * Customer credit ("khata") + payment reminders.
 *
 * The outstanding a customer owes is the sum of `pending` across their rows in
 * the `transaction` ledger (the same figure the outstanding report uses); this
 * service reads it, enforces an optional credit limit, and sends reminders
 * through the shop's own messaging providers. The message building is a pure
 * function so it is currency-agnostic and unit-tested on its own.
 */
class CreditService {
  // ============================ pure ============================

  /** Fill {name} {due} {currency} {shop} in a reminder template. */
  static renderReminder(template, data = {}) {
    const map = {
      name: data.name || 'Customer',
      due: data.due != null ? round2(data.due) : 0,
      currency: data.currency || '',
      shop: data.shop || '',
    };
    return String(template || DEFAULTS.reminder_template).replace(/\{(\w+)\}/g, (m, k) => {
      const key = String(k).toLowerCase();
      return Object.prototype.hasOwnProperty.call(map, key) ? String(map[key]) : m;
    });
  }

  /**
   * Decide whether a new credit amount fits within a customer's limit.
   * limit 0 = unlimited. `outstanding` and `addAmount` are branch-currency
   * numbers. Pure so it is easy to test; the DB read is in checkCreditLimit.
   */
  static withinLimit(limit, outstanding, addAmount) {
    const lim = Number(limit) || 0;
    const out = Number(outstanding) || 0;
    const add = Number(addAmount) || 0;
    if (lim <= 0) return { allowed: true, limit: 0, outstanding: out, wouldBe: out + add };
    const wouldBe = out + add;
    return { allowed: wouldBe <= lim, limit: lim, outstanding: out, wouldBe };
  }

  // ============================ settings ============================

  async getSettings(branchId) {
    const db = await BaseModel.getDb();
    const q = { license: BaseModel.license };
    if (branchId) q.branch_id = oid(branchId);
    const row = await db.collection('credit_settings').findOne(q);
    return {
      ...DEFAULTS,
      ...(row || {}),
      branch_id: branchId ? oid(branchId) : row && row.branch_id,
    };
  }

  async saveSettings(branchId, data = {}, ctx = {}) {
    const db = await BaseModel.getDb();
    const now = new Date();
    const num = (v, d) => (v === undefined || v === null || v === '' ? d : Number(v));
    const set = {
      default_credit_limit: Math.max(
        0,
        num(data.default_credit_limit, DEFAULTS.default_credit_limit)
      ),
      credit_terms_days: Math.max(0, parseInt(num(data.credit_terms_days, 0), 10) || 0),
      reminder_enabled: data.reminder_enabled === true || data.reminder_enabled === 'true',
      reminder_channel: data.reminder_channel === 'whatsapp' ? 'whatsapp' : 'sms',
      reminder_template:
        data.reminder_template !== undefined
          ? String(data.reminder_template)
          : DEFAULTS.reminder_template,
      reminder_min_due: Math.max(0, num(data.reminder_min_due, 0)),
      currency: data.currency !== undefined ? String(data.currency) : ctx.currency || '',
      branch_id: oid(branchId),
      branch_name: ctx.branchName || '',
      updated_date: now,
      updated_by: ctx.userName || '',
      license: BaseModel.license,
    };
    await db
      .collection('credit_settings')
      .updateOne(
        { license: BaseModel.license, branch_id: oid(branchId) },
        { $set: set, $setOnInsert: { created_date: now, created_by: ctx.userName || '' } },
        { upsert: true }
      );
    return this.getSettings(branchId);
  }

  // ============================ outstanding ============================

  /** A customer's outstanding = sum of `pending` across their ledger rows. */
  async dueFor(customerId, branchId) {
    const db = await BaseModel.getDb();
    const customerIds = [oid(customerId), String(customerId)].filter(value => value != null);
    const match = { customer_id: { $in: customerIds }, license: BaseModel.license };
    if (branchId) match.branch_id = { $in: [oid(branchId), String(branchId)] };
    const rows = await db.collection('transaction').aggregate([
      { $match: match },
      { $group: { _id: '$customer_id', due: { $sum: { $convert: { input: '$pending', to: 'double', onError: 0, onNull: 0 } } } } },
    ]).toArray();
    return rows.length ? round2(rows[0].due) : 0;
  }

  /** Customers who owe money, most-owed first, with their phone for reminders. */
  async outstanding(branchId, { minDue = 0, minAgeDays = 0 } = {}) {
    const db = await BaseModel.getDb();
    const match = { license: BaseModel.license };
    if (branchId) match.branch_id = { $in: [oid(branchId), String(branchId)] };
    const grouped = await db.collection('transaction').aggregate([
      { $match: match },
      {
        $group: {
          _id: '$customer_id',
          name: { $first: '$customer_name' },
          due: { $sum: { $convert: { input: '$pending', to: 'double', onError: 0, onNull: 0 } } },
          oldest_debt_date: { $min: '$created_date' },
        },
      },
      { $match: { due: { $gt: Math.max(0, Number(minDue) || 0) } } },
    ]).toArray();
    const custCol = db.collection('customers');
    const list = [];
    for (const group of grouped) {
      const customerId = String(group._id?._id || group._id || '').trim();
      if (!customerId || Number(group.due) <= 0) continue;
      const customerObjectId = ObjectId.isValid(customerId) ? new ObjectId(customerId) : null;
      let cust = customerObjectId
        ? await custCol.findOne({ _id: customerObjectId, license: BaseModel.license })
        : null;
      if (!cust) cust = await custCol.findOne({ _id: customerId, license: BaseModel.license });
      const oldest = group.oldest_debt_date ? new Date(group.oldest_debt_date) : null;
      const daysOverdue = oldest && !Number.isNaN(oldest.getTime())
        ? Math.max(0, Math.floor((Date.now() - oldest.getTime()) / 86400000))
        : 0;
      if (daysOverdue < Math.max(0, Number(minAgeDays) || 0)) continue;
      list.push({
        customer_id: customerId,
        name: group.name || (cust && (cust.name || cust.customer_name)) || '',
        phone: (cust && (cust.phone || cust.customer_phone)) || '',
        due: round2(group.due),
        oldest_debt_date: group.oldest_debt_date || null,
        days_overdue: daysOverdue,
        credit_limit: (cust && Number(cust.creditLimit)) || 0,
      });
    }
    list.sort((left, right) => right.due - left.due);
    return { status: true, data: list, message: 'Outstanding customers' };
  }

  /**
   * Enforce an optional credit limit before a credit sale. The effective limit
   * is the customer's own if set, else the branch default. 0 = unlimited.
   */
  async checkCreditLimit(customerId, addAmount, branchId) {
    if (!customerId) return { allowed: true, limit: 0, outstanding: 0 };
    const db = await BaseModel.getDb();
    const cust = await db
      .collection('customers')
      .findOne({ _id: oid(customerId), license: BaseModel.license });
    const settings = await this.getSettings(branchId);
    const custLimit = cust && Number(cust.creditLimit) > 0 ? Number(cust.creditLimit) : 0;
    const limit = custLimit > 0 ? custLimit : Number(settings.default_credit_limit) || 0;
    const outstanding = await this.dueFor(customerId, branchId);
    const r = CreditService.withinLimit(limit, outstanding, addAmount);
    return { ...r, error: r.allowed ? null : 'Credit limit exceeded' };
  }

  // ============================ customer debt ledger ============================

  async ledger(customerId, branchId) {
    if (!ObjectId.isValid(String(customerId || ''))) throw new Error('Invalid customer ID');
    const db = await BaseModel.getDb();
    const query = { customer_id: { $in: [oid(customerId), String(customerId)] }, license: BaseModel.license };
    if (branchId) query.branch_id = { $in: [oid(branchId), String(branchId)] };
    const rows = await db.collection('transaction').find(query).sort({ created_date: 1, _id: 1 }).toArray();
    const sales = db.collection('sales');
    const result = [];
    for (const row of rows) {
      const pending = round2(row.pending);
      if (pending <= 0) continue;
      let sale = null;
      if (row.sale_id) {
        const saleQuery = saleLookupQuery(row.sale_id, branchId);
        sale = await sales.findOne(saleQuery, { projection: { sales_id: 1, sale_id: 1, customer_name: 1, created_date: 1, sales_total: 1, total: 1, payment_pending: 1, payment_status: 1 } });
      }
      result.push({
        transaction_id: String(row._id),
        sale_id: row.sale_id ? String(row.sale_id) : '',
        receipt_number: (sale && (sale.sales_id || sale.sale_id)) || String(row.sale_id || ''),
        customer_name: row.customer_name || (sale && sale.customer_name) || '',
        date: (row.created_date || (sale && sale.created_date) || row.updated_date || null),
        sale_total: round2(row.sale_total != null ? row.sale_total : (sale && (sale.sales_total || sale.total))),
        pending,
        description: row.description || 'Credit sale',
      });
    }
    return result;
  }

  async settleDebt(customerId, input = {}, ctx = {}) {
    if (!ObjectId.isValid(String(customerId || ''))) throw new Error('Invalid customer ID');
    const amount = round2(input.amount);
    if (!(amount > 0)) throw new Error('Enter a payment amount greater than zero');
    const methodMap = { cash: 'cash', card: 'card', tpe: 'tpe', baridimob: 'baridimob', bank_transfer: 'bank_transfer', other: 'other' };
    const method = methodMap[String(input.method || 'cash').toLowerCase()];
    if (!method) throw new Error('Choose a valid payment method');
    const db = await BaseModel.getDb();
    const customer = await db.collection('customers').findOne({ _id: { $in: [oid(customerId), String(customerId)] }, license: BaseModel.license, is_deleted: { $ne: true } });
    if (!customer) throw new Error('Customer not found');
    const query = { customer_id: { $in: [oid(customerId), String(customerId)] }, license: BaseModel.license };
    if (ctx.branchId) query.branch_id = { $in: [oid(ctx.branchId), String(ctx.branchId)] };
    const transactions = await db.collection('transaction').find(query).sort({ created_date: 1, _id: 1 }).toArray();
    const due = round2(transactions.reduce((sum, row) => sum + Math.max(0, Number(row.pending) || 0), 0));
    if (amount > due + 0.009) throw new Error('Payment exceeds the customer’s outstanding balance');
    // Associate each collection with the current cashier session for daily tender
    // reporting. Only cash collections affect the physical drawer journal.
    let cashRegister = null;
    const registerCollection = db.collection('cashregister');
    const asObjectId = (value) => {
      try { return ObjectId.isValid(String(value || '')) ? oid(value) : null; } catch (_) { return null; }
    };
    const userObjectId = asObjectId(ctx.userId);
    const branchObjectId = asObjectId(ctx.branchId);
    const registerObjectId = asObjectId(input.register_id);
    const registerBaseQuery = { license: BaseModel.license, register_status: 'Opened' };
    if (registerObjectId) {
      cashRegister = await registerCollection.findOne({ ...registerBaseQuery, _id: registerObjectId, ...(ctx.userId ? { current_user_id: { $in: [String(ctx.userId), ...(userObjectId ? [userObjectId] : [])] } } : {}) }, { projection: { _id: 1, register_id: 1 } });
    }
    if (!cashRegister && ctx.userId) {
      const registerQuery = { ...registerBaseQuery, current_user_id: { $in: [String(ctx.userId), ...(userObjectId ? [userObjectId] : [])] } };
      if (ctx.branchId) registerQuery.branch_id = { $in: [String(ctx.branchId), ...(branchObjectId ? [branchObjectId] : [])] };
      cashRegister = await registerCollection.findOne(registerQuery, { projection: { _id: 1 } });
    }
    // Refuse to collect against a ledger row whose original sale no longer
    // exists. Preflight all affected rows before changing any balances.
    let preflightAmount = amount;
    for (const row of transactions) {
      const pending = Math.max(0, Number(row.pending) || 0);
      if (pending <= 0 || preflightAmount <= 0) continue;
      if (!row.sale_id) {
        throw new Error('This debt has no link to its original POS sale. No payment was collected; reconcile the debt record first.');
      }
      const saleQuery = saleLookupQuery(row.sale_id, ctx.branchId);
      const originalSale = await db.collection('sales').findOne(saleQuery);
      if (!originalSale) {
        throw new Error('Original POS sale ' + String(row.sale_id) + ' was not found in this branch. No payment was collected.');
      }
      const originalCustomerId = originalSale.customer_id && typeof originalSale.customer_id === 'object'
        ? String(originalSale.customer_id._id || originalSale.customer_id.id || originalSale.customer_id)
        : String(originalSale.customer_id || '');
      if (originalCustomerId && originalCustomerId !== String(customerId)) {
        throw new Error('The original POS sale belongs to a different customer. No payment was collected.');
      }
      const salePending = Number(originalSale.payment_pending);
      if (Number.isFinite(salePending) && salePending + 0.009 < Math.min(pending, preflightAmount)) {
        throw new Error('The POS sale balance and debt ledger do not match. No payment was collected; reconcile this sale first.');
      }
      preflightAmount = round2(preflightAmount - Math.min(pending, preflightAmount));
    }
    let remaining = amount;
    const now = new Date();
    const allocations = [];
    for (const row of transactions) {
      if (remaining <= 0) break;
      const oldPending = Math.max(0, Number(row.pending) || 0);
      if (!oldPending) continue;
      const paid = round2(Math.min(oldPending, remaining));
      const nextPending = round2(oldPending - paid);
      const changed = await db.collection('transaction').updateOne(
        { _id: row._id, license: BaseModel.license, pending: row.pending },
        { $set: { pending: nextPending, updated_date: now, last_payment_date: now } }
      );
      if (!changed.matchedCount) throw new Error('A debt changed during collection. Refresh the debt page and retry.');
      if (row.sale_id) {
        const saleQuery = saleLookupQuery(row.sale_id, ctx.branchId);
        const sale = await db.collection('sales').findOne(saleQuery);
        if (sale) {
          const oldSalePending = Math.max(0, Number(sale.payment_pending != null ? sale.payment_pending : oldPending) || 0);
          const nextSalePending = round2(Math.max(0, oldSalePending - paid));
          // Keep tender reporting in sync as well as the sale's balance and
          // auditable payment history. The sales collection supports both old
          // array-shaped and newer object-shaped multi-payment values.
/* Preserve original sale-day tender classification; this collection is dated today. */
                    // Optimistic compare-and-set on the original sale prevents two
          // simultaneous collections from spending the same outstanding balance.
          const guardedSaleQuery = { ...saleQuery };
          if (sale.payment_pending == null) guardedSaleQuery.payment_pending = { $exists: false };
          else guardedSaleQuery.payment_pending = sale.payment_pending;
          const saleChanged = await db.collection('sales').updateOne(guardedSaleQuery, {
            $set: {
              payment_pending: nextSalePending,
              payment_status: nextSalePending <= 0 ? 'Paid' : 'Partialy Paid',
              updated_date: now,
              last_debt_payment_date: now,
            },
            $inc: { paid_amount: paid },
            $push: { payments: { amount: paid, date: now, method, notes: 'Customer debt settlement', origin: { type: 'credit_settlement', transaction_id: String(row._id) } } },
          });
          if (!saleChanged.matchedCount) {
            // We already reduced the ledger row above. Restore it before
            // returning an error so no payment is silently half-applied.
            const restored = await db.collection('transaction').updateOne(
              { _id: row._id, license: BaseModel.license, pending: nextPending },
              { $set: { pending: oldPending, updated_date: now, last_payment_date: row.last_payment_date || null } }
            );
            if (!restored.matchedCount) {
              throw new Error('POS sale changed during collection and the debt ledger could not be restored automatically. Stop collecting and reconcile this customer account.');
            }
            throw new Error('The original POS sale changed during collection. No payment was recorded; refresh and retry.');
          }
        }
      }
      allocations.push({ transaction_id: String(row._id), sale_id: row.sale_id ? String(row.sale_id) : '', amount: paid, remaining: nextPending });
      remaining = round2(remaining - paid);
    }
    const payment = {
      customer_id: customer._id, customer_name: customer.name || customer.customer_name || '',
      amount: round2(amount - remaining), method, allocations, branch_id: ctx.branchId ? oid(ctx.branchId) : null,
      license: BaseModel.license, received_by: ctx.userName || '', received_at: now,
      register_id: cashRegister ? cashRegister.register_id : (input.register_id && ObjectId.isValid(String(input.register_id)) ? oid(input.register_id) : null),
      note: String(input.note || '').slice(0, 500),
    };
    const inserted = await db.collection('credit_payments').insertOne(payment);
    // Keep the physical till's cash-in journal in step with a cash debt collection.
    // Non-cash tenders remain in the credit payment ledger and never inflate drawer cash.
    if (method === 'cash' && cashRegister) {
      const registerUpdate = await db.collection('cashregister').updateOne(
        { _id: cashRegister._id, license: BaseModel.license, register_status: 'Opened', current_user_id: { $in: [String(ctx.userId), ...(asObjectId(ctx.userId) ? [asObjectId(ctx.userId)] : [])] } },
        { $push: { cashInOutDetail: {
          cashin_amount: payment.amount, cashout_amount: 0,
          cashin_description: 'Customer debt payment - ' + (customer.name || customerId),
          cashout_description: '', date: now, source: 'credit_settlement',
          credit_payment_id: String(inserted.insertedId),
        } } }
      );
      // If the till closes concurrently, do not report a failed collection
      // after the customer's debt and payment record have already been updated.
    }
    return { payment_id: String(inserted.insertedId || ''), customer_id: String(customerId), amount: payment.amount, method, allocations, due_before: due, due_after: await this.dueFor(customerId, ctx.branchId) };
  }

  // ============================ reminders ============================

  async _send(branchId, channel, phone, message) {
    const MessagingService = require('./messaging.service');
    const messagingService = new MessagingService();
    return channel === 'whatsapp'
      ? messagingService.sendWhatsapp(branchId, phone, message)
      : messagingService.sendSms(branchId, phone, message);
  }

  async _logReminder(db, e) {
    await db.collection('reminder_sends').insertOne({
      customer_id: oid(e.customerId),
      customer_name: e.customerName || '',
      phone: e.phone || '',
      channel: e.channel,
      due: round2(e.due || 0),
      status: e.status,
      error: e.error || null,
      message: e.message || '',
      day_key: e.dayKey,
      branch_id: e.branchId ? oid(e.branchId) : null,
      date: new Date(),
      license: BaseModel.license,
    });
  }

  /** Send one customer their outstanding reminder now (used by the button). */
  async sendReminder(customerId, { branchId, ctx = {}, dryRun = false, now = null, channelOverride = null } = {}) {
    const db = await BaseModel.getDb();
    const cust = await db
      .collection('customers')
      .findOne({ _id: oid(customerId), license: BaseModel.license });
    if (!cust) return { status: false, message: 'Customer not found' };
    const due = await this.dueFor(customerId, branchId);
    if (due <= 0) return { status: true, data: { sent: 0 }, message: 'Nothing outstanding' };

    const settings = await this.getSettings(branchId);
    const channel = channelOverride === 'whatsapp' ? 'whatsapp' : (settings.reminder_channel || 'sms');
    const phone = (cust.phone || '').toString().trim();
    const unpaidRows = channelOverride === 'whatsapp' ? await this.ledger(customerId, branchId) : [];
    const oldestDate = unpaidRows.length ? new Date(unpaidRows[0].date || now || Date.now()) : null;
    const daysOverdue = oldestDate ? Math.max(0, Math.floor(((now ? new Date(now) : new Date()).getTime() - oldestDate.getTime()) / 86400000)) : 0;
    const baseMessage = CreditService.renderReminder(settings.reminder_template, {
      name: cust.name,
      due,
      days_overdue: daysOverdue,
      currency: settings.currency || ctx.currency || 'DZD',
      shop: ctx.branchName || settings.branch_name || '',
    });
    const message = channelOverride === 'whatsapp'
      ? baseMessage + '\nAncienneté de la dette : ' + daysOverdue + ' jour(s).\nNous vous invitons cordialement à passer au magasin pour régulariser votre solde. Merci.'
      : baseMessage;
    const dayKey = (now ? new Date(now) : new Date()).toISOString().slice(0, 10);

    let status = 'skipped_nophone';
    let error = null;
    if (phone) {
      if (dryRun) status = 'dry_run';
      else {
        let r;
        if (channelOverride === 'whatsapp') {
          const branch = await db.collection('branches').findOne({ _id: oid(branchId) });
          const deviceId = branch && branch.whatsapp_device_id;
          if (!deviceId) r = { ok: false, error: 'No linked WhatsApp device is configured for this branch.' };
          else {
            const sent = await require('./whatsapp.service').sendMessage(deviceId, branchId, phone, message);
            r = { ok: !!(sent && sent.status), error: sent && sent.status ? null : (sent && sent.message) || 'WhatsApp send failed.' };
          }
        } else {
          r = await this._send(branchId, channel, phone, message);
        }
        status = r && r.ok ? 'sent' : 'failed';
        error = r && r.ok ? null : (r && r.error) || 'send failed';
      }
    }
    await this._logReminder(db, {
      customerId,
      customerName: cust.name,
      phone,
      channel,
      due,
      status,
      error,
      message,
      dayKey,
      branchId,
    });
    return {
      status: status === 'sent' || status === 'dry_run',
      data: { status, due, channel },
      message:
        status === 'sent'
          ? 'Reminder sent'
          : status === 'dry_run'
            ? 'Dry run'
            : 'Reminder ' + status,
    };
  }


  /** Manually send WhatsApp reminders to selected debtors; never changes debt balances. */
  async sendWhatsAppReminders(branchId, { customerIds = [], minDue = 0, minAgeDays = 0, ctx = {}, dryRun = false } = {}) {
    const db = await BaseModel.getDb();
    const { data: customers } = await this.outstanding(branchId, { minDue });
    const selected = new Set((customerIds || []).map(String));
    const now = new Date();
    const eligible = customers.filter((customer) => {
      const days = customer.oldest_debt_date
        ? Math.max(0, Math.floor((now.getTime() - new Date(customer.oldest_debt_date).getTime()) / 86400000))
        : 0;
      return (!selected.size || selected.has(String(customer.customer_id))) &&
        Number(customer.due) >= Math.max(0, Number(minDue) || 0) &&
        days >= Math.max(0, Number(minAgeDays) || 0);
    });
    const results = [];
    const dayKey = now.toISOString().slice(0, 10);
    for (const customer of eligible) {
      const alreadySent = await db.collection('reminder_sends').findOne({
        customer_id: oid(customer.customer_id),
        day_key: dayKey,
        license: BaseModel.license,
        branch_id: branchId ? oid(branchId) : null,
        status: 'sent',
        channel: 'whatsapp'
      });
      if (alreadySent) {
        results.push({ customer_id: String(customer.customer_id), name: customer.name, phone: customer.phone, due: customer.due, days_overdue: customer.days_overdue, status: 'skipped_already_sent', error: null });
        continue;
      }
      const result = await this.sendReminder(customer.customer_id, {
        branchId, ctx, dryRun, now, channelOverride: 'whatsapp'
      });
      results.push({
        customer_id: String(customer.customer_id),
        name: customer.name,
        phone: customer.phone,
        due: customer.due,
        days_overdue: customer.days_overdue,
        status: result.data?.status || 'failed',
        error: result.status ? null : result.message
      });
    }
    return {
      total: eligible.length,
      sent: results.filter((row) => row.status === 'sent').length,
      failed: results.filter((row) => row.status === 'failed').length,
      skipped: results.filter((row) => !['sent', 'failed'].includes(row.status)).length,
      results
    };
  }

  /**
   * Remind every outstanding customer over the minimum due. Idempotent per day
   * (a customer is not reminded twice in one day) and wrapped per recipient so
   * one bad number cannot stop the run. A cron tick calls this per tenant.
   */
  async runReminders(branchId, { ctx = {}, dryRun = false, now = null } = {}) {
    const settings = await this.getSettings(branchId);
    if (!settings.reminder_enabled) {
      return { status: true, data: { sent: 0, skipped: 0 }, message: 'Reminders are off' };
    }
    const db = await BaseModel.getDb();
    const remCol = db.collection('reminder_sends');
    const dayKey = (now ? new Date(now) : new Date()).toISOString().slice(0, 10);
    const { data: customers } = await this.outstanding(branchId, {
      minDue: settings.reminder_min_due,
    });

    let sent = 0;
    let failed = 0;
    let skipped = 0;
    for (const c of customers) {
      // once per customer per day
      const already = await remCol.findOne({
        customer_id: oid(c.customer_id),
        day_key: dayKey,
        license: BaseModel.license,
        status: { $in: ['sent', 'dry_run'] },
      });
      if (already) {
        skipped += 1;
        continue;
      }
      const r = await this.sendReminder(c.customer_id, { branchId, ctx, dryRun, now });
      const st = r.data && r.data.status;
      if (st === 'sent' || st === 'dry_run') sent += 1;
      else if (st === 'failed') failed += 1;
      else skipped += 1;
    }
    return {
      status: true,
      data: { total: customers.length, sent, failed, skipped, dryRun: !!dryRun },
      message: dryRun ? 'Reminder dry run complete' : 'Reminders sent',
    };
  }
}

module.exports = CreditService;
