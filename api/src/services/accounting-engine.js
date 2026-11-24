'use strict';

const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;
const finite = (value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
const asAmount = (value) => (finite(value) ? Number(value) : null);
const normalizeTenderName = (method) => {
  const raw = String(method || '').trim();
  const key = raw.toLowerCase().replaceAll(' ', '').replaceAll('_', '').replaceAll('-', '');
  if (['cash','especes','espèce','espèces'].includes(key)) return 'CASH';
  if (['card','tpe','carte'].includes(key)) return 'TPE';
  if (['banktransfer','baridimob','baridi'].includes(key)) return 'BaridiMob';
  if (['credit','crédit'].includes(key)) return 'Crédit';
  if (['other','autre'].includes(key)) return 'Autre';
  return raw || 'Non classé';
};
const isCashTender = (method) => /^(cash|esp[eè]ces?|esp[eè]ce)$/i.test(String(method || '').trim());

/**
 * The single pure calculation boundary for the daily closing ticket.
 * Inputs are already scoped and date-classified by the caller. Unknown
 * financial inputs remain unavailable; they are never silently coerced to zero.
 */
function summarizeCashRegisterSessions(sessions = [], start, end) {
  const startTime = new Date(start).getTime(), endTime = new Date(end).getTime();
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) throw new Error('Valid cash-register date boundaries are required.');
  let openingBalance = 0, otherCashOutflows = 0, complete = true, unresolved = 0, matched = 0;
  const canonicalSources = new Set([
    'sale', 'sales', 'sale_payment', 'cash_sale', 'cash_sales',
    'expense', 'salary_payment', 'advance', 'prime',
    'credit_settlement', 'credit_payment', 'credit_collection',
    'debt_settlement', 'debt_payment', 'debt_collection',
    'customer_debt_payment', 'customer_credit_payment',
    'versement', 'refund', 'zr_delivery_payout',
  ]);
  for (const session of sessions) {
    const closed = session.register_closedate ? new Date(session.register_closedate).getTime() : Infinity;
    // Ignore clearly unrelated historical sessions before validating their
    // opening metadata. Old closed sessions must not poison today's close.
    if (Number.isFinite(closed) && closed < startTime) continue;
    const opened = session.register_opendate ? new Date(session.register_opendate).getTime() : NaN;
    if (Number.isFinite(opened) && opened >= endTime) continue;
    if (!Number.isFinite(opened)) { complete = false; unresolved += 1; continue; }
    matched += 1;
    if (!finite(session.opening_float)) { complete = false; unresolved += 1; }
    else openingBalance += Number(session.opening_float);
    if (!Array.isArray(session.cashInOutDetail)) { complete = false; unresolved += 1; continue; }
    for (const entry of session.cashInOutDetail) {
      const time = entry.date || entry.created_at ? new Date(entry.date || entry.created_at).getTime() : NaN;
      const cashIn = Number(entry.cashin_amount ?? entry.cash_in ?? 0) || 0;
      const cashOut = Number(entry.cashout_amount ?? entry.cash_out ?? 0) || 0;
      if (!Number.isFinite(time)) { if (cashIn || cashOut) { complete = false; unresolved += 1; } continue; }
      if (time < opened) continue;
      if (time < startTime) openingBalance += cashIn - cashOut;
      else if (time < endTime) {
        const source = String(entry.source || entry.origin || entry.category || '').trim().toLowerCase().replaceAll(' ', '_').replaceAll('-', '_');
        const isLedgerTrackedSource = canonicalSources.has(source) ||
          /^(?:credit|debt|customer_credit|customer_debt)_(?:settlement|payment|collection)$/.test(source);
        if (!isLedgerTrackedSource) otherCashOutflows += cashOut - cashIn;
      }
    }
  }
  if (!matched) complete = false;
  return { openingBalance: round2(openingBalance), otherCashOutflows: round2(otherCashOutflows), complete, unresolved };
}

function aggregateSalePaymentEvents(sales = [], start, end) {
  const startTime = new Date(start).getTime(), endTime = new Date(end).getTime();
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) throw new Error('Valid payment-event date boundaries are required.');
  const map = new Map();
  let complete = true;
  const add = (method, amount) => {
    const normalized = normalizeTenderName(method);
    const value = Number(amount);
    if (!normalized || normalized === 'Non classé' || !Number.isFinite(value)) { complete = false; return; }
    if (normalized === 'Crédit' || value <= 0) return;
    const row = map.get(normalized) || { payment_mode: normalized, sale_payment: 0, count: 0 };
    row.sale_payment = round2(row.sale_payment + value);
    row.count += 1;
    map.set(normalized, row);
  };
  for (const sale of sales) {
    const events = Array.isArray(sale.payments) ? sale.payments : null;
    if (events && events.length) {
      for (const event of events) {
        const origin = event.origin && typeof event.origin === 'object' ? event.origin : {};
        const eventSource = [
          origin.type, origin.source, origin.kind, event.source, event.origin_type,
          event.transaction_type, event.payment_type, event.kind,
        ].filter(Boolean).join(' ').toLowerCase().replace(/[\\s-]+/g, '_');
        // Debt collections live in credit_payments and must never be counted
        // as a second sale tender, even when older event records use a
        // different origin field name.
        if (
          /(?:credit|debt)_(?:settlement|collection|payment)/.test(eventSource) ||
          event.is_credit_collection === true ||
          event.is_debt_collection === true ||
          !!event.credit_payment_id
        ) continue;
        const eventDate = event.date || event.created_at || sale.date || sale.created_date;
        const time = eventDate ? new Date(eventDate).getTime() : NaN;
        if (!Number.isFinite(time)) { complete = false; continue; }
        if (time < startTime || time >= endTime) continue;
        const method = event.payment_mode || event.method || event.type || event.name ||
          sale.payment_mode || sale.payment_method;
        if (String(method || '').trim().toLowerCase() === 'credit') continue;
        const amount = event.amount ?? event.sale_payment ?? event.paid_amount ??
          event.payment_amount ?? event.total ?? event.value;
        add(method, amount);
      }
      continue;
    }
    const multi = sale.multi_payment ?? sale.multiPayment ?? sale.payment_details;
    const entries = [];
    if (Array.isArray(multi)) {
      multi.forEach(row => entries.push({
        method: row?.payment_mode || row?.method || row?.type || row?.name,
        amount: row?.amount ?? row?.sale_payment ?? row?.total ?? row?.value,
      }));
    } else if (multi && typeof multi === 'object') {
      const nested = Array.isArray(multi.payments) ? multi.payments : null;
      if (nested) nested.forEach(row => entries.push({
        method: row?.payment_mode || row?.method || row?.type || row?.name,
        amount: row?.amount ?? row?.sale_payment ?? row?.total ?? row?.value,
      }));
      else Object.entries(multi).forEach(([method, value]) => entries.push({
        method,
        amount: value && typeof value === 'object'
          ? (value.amount ?? value.sale_payment ?? value.total ?? value.value)
          : value,
      }));
    }
    if (entries.length) { entries.forEach(row => add(row.method, row.amount)); continue; }
    const method = sale.payment_mode || sale.payment_method;
    const total = sale.sales_total ?? sale.total;
    const pending = sale.payment_pending;
    const paid = sale.paid_amount ?? sale.partial_balance ??
      (total != null && pending != null ? Number(total) - Number(pending) :
        (String(sale.payment_status || '').toLowerCase() === 'paid' ? total : 0));
    if (!method) { complete = false; continue; }
    add(method, paid);
  }
  return { details: Array.from(map.values()).filter(row => row.sale_payment > 0), complete };
}

function calculateDailyClose(input = {}) {
  const salesTotal = asAmount(input.salesTotal);
  const cost = asAmount(input.costOfGoodsTotal);
  const costAvailable = cost !== null && salesTotal !== null;
  const costComplete = input.costDataComplete === true && costAvailable;
  const grossProfit = costAvailable ? round2(salesTotal - cost) : null;

  const expenses = asAmount(input.expensesTotal);
  const salaries = asAmount(input.salaryPaymentsTotal);
  const advances = asAmount(input.salaryAdvancesTotal);
  const bonuses = asAmount(input.salaryPrimesTotal);
  const netProfitAvailable = grossProfit !== null &&
    expenses !== null && salaries !== null && advances !== null && bonuses !== null;
  const profitComplete = costComplete &&
    input.expensesComplete !== false &&
    input.payrollComplete !== false &&
    netProfitAvailable;
  // Preserve the arithmetic result when inputs exist, while keeping the
  // completeness flag separate so estimated/incomplete records are disclosed.
  const netProfit = netProfitAvailable
    ? round2(grossProfit - expenses - salaries - advances - bonuses)
    : null;

  const cash = input.cash || {};
  const cashKeys = [
    'openingBalance',
    'cashSales',
    'cashVersements',
    'cashCreditCollections',
    'cashExpenses',
    'cashSalaries',
    'cashAdvances',
    'cashBonuses',
    'cashRefunds',
    'otherCashOutflows',
  ];
  const cashInputsAvailable = cashKeys.every((key) => finite(cash[key]));
  const cashComplete = input.cashDataComplete === true && cashInputsAvailable;
  // Always return the arithmetic result when every component has a numeric
  // value. Completeness remains a separate trust flag: the UI can show the
  // provisional amount and explain missing register/payment evidence.
  const expectedCash = cashInputsAvailable
    ? round2(
        Number(cash.openingBalance) +
        Number(cash.cashSales) +
        Number(cash.cashVersements) +
        Number(cash.cashCreditCollections) -
        Number(cash.cashExpenses) -
        Number(cash.cashSalaries) -
        Number(cash.cashAdvances) -
        Number(cash.cashBonuses) -
        Number(cash.cashRefunds) -
        Number(cash.otherCashOutflows)
      )
    : null;

  return {
    salesTotal: salesTotal === null ? null : round2(salesTotal),
    costOfGoodsTotal: costAvailable ? round2(cost) : null,
    costDataComplete: costComplete,
    grossProfitTotal: grossProfit,
    expensesTotal: expenses === null ? null : round2(expenses),
    salaryPaymentsTotal: salaries === null ? null : round2(salaries),
    salaryAdvancesTotal: advances === null ? null : round2(advances),
    salaryPrimesTotal: bonuses === null ? null : round2(bonuses),
    netProfitTotal: netProfit,
    profitDataComplete: profitComplete,
    cashExpected: expectedCash,
    cashDataComplete: cashComplete,
  };
}

/**
 * Reconstruct a balance at an earlier close from current ledger balances and
 * dated events. Positive collections after the close are added back; later
 * increases/decreases from edits and returns are reversed. Versements are
 * kept separate from the ordinary customer-debt ledger.
 */
function reconstructOutstandingAsOf({
  transactions = [],
  creditPayments = [],
  editAdjustments = [],
  returns = [],
  versements = [],
  orphanVersements = [],
  saleDates = {},
  end,
} = {}) {
  const endTime = new Date(end).getTime();
  if (!Number.isFinite(endTime)) throw new Error('A valid exclusive closing boundary is required.');
  const after = (value) => {
    const time = value ? new Date(value).getTime() : NaN;
    return Number.isFinite(time) && time >= endTime;
  };
  const id = (value) => {
    if (value && typeof value.toHexString === 'function') return value.toHexString();
    if (value && typeof value === 'object') return String(value._id || value.id || value.sale_id || '');
    return String(value || '');
  };
  const collectionsAfter = new Map();
  const saleCollectionsAfter = new Map();
  const transactionIds = new Set(transactions.map(row => id(row._id)).filter(Boolean));
  const saleIds = new Set(transactions.map(row => id(row.sale_id)).filter(Boolean));
  let complete = true;
  let unresolved = 0;
  for (const payment of creditPayments.filter(row => after(row.received_at))) {
    const allocations = Array.isArray(payment.allocations) ? payment.allocations : [];
    if (!allocations.length) { complete = false; unresolved += 1; continue; }
    let allocatedTotal = 0;
    for (const allocation of allocations) {
      const amount = Number(allocation.amount);
      if (!Number.isFinite(amount) || amount <= 0) { complete = false; unresolved += 1; continue; }
      allocatedTotal += amount;
      const transactionId = id(allocation.transaction_id);
      const saleId = id(allocation.sale_id);
      if (transactionId && transactionIds.has(transactionId)) {
        collectionsAfter.set(transactionId, (collectionsAfter.get(transactionId) || 0) + amount);
      } else if (saleId && saleIds.has(saleId)) {
        // Older allocations may identify only the sale. Apply them once to
        // the grouped sale balance, never once per transaction row.
        saleCollectionsAfter.set(saleId, (saleCollectionsAfter.get(saleId) || 0) + amount);
      } else {
        complete = false; unresolved += 1;
      }
    }
    if (Math.abs(allocatedTotal - (Number(payment.amount) || 0)) > 0.01) {
      complete = false; unresolved += 1;
    }
  }
  const editsAfter = new Map();
  editAdjustments.filter(row => after(row.created_at)).forEach(row => {
    const keys = [...new Set([id(row.sale_id), id(row.sales_id)].filter(Boolean))];
    for (const key of keys) editsAfter.set(key, (editsAfter.get(key) || 0) + (Number(row.amount) || 0));
  });
  const returnsAfter = new Map();
  returns.filter(row => after(row.date)).forEach(row => {
    const keys = [...new Set([id(row.sale_id), id(row.sales_id)].filter(Boolean))];
    for (const key of keys) returnsAfter.set(key, (returnsAfter.get(key) || 0) + (Number(row.amount) || 0));
  });

  const versementKeys = new Set([
    ...versements.map((row) => String(row.sale_key || row.sale_id || '')),
    ...orphanVersements.map((row) => String(row.sales_id || row.sale_id || row._id || '')),
  ]);
  let total = 0;
  const transactionGroups = new Map();
  for (const row of transactions) {
    const saleKey = id(row.sale_id);
    const groupKey = saleKey || "transaction:" + id(row._id);
    const group = transactionGroups.get(groupKey) || { saleKey, rows: [] };
    group.rows.push(row);
    transactionGroups.set(groupKey, group);
  }
  for (const group of transactionGroups.values()) {
    const saleKey = group.saleKey;
    if (saleKey && versementKeys.has(saleKey)) continue;
    let current = 0;
    let rowCollections = 0;
    let hasHistoricalRows = false;
    for (const row of group.rows) {
      const created = row.created_date || saleDates[saleKey];
      if (!created || !Number.isFinite(new Date(created).getTime())) {
        complete = false; unresolved += 1;
        continue;
      }
      if (new Date(created).getTime() >= endTime) continue;
      hasHistoricalRows = true;
      current += Math.max(0, Number(row.pending) || 0);
      rowCollections += collectionsAfter.get(id(row._id)) || 0;
    }
    if (!hasHistoricalRows) continue;
    const laterCollections = rowCollections + (saleKey ? (saleCollectionsAfter.get(saleKey) || 0) : 0);
    const laterEdit = saleKey ? (editsAfter.get(saleKey) || 0) : 0;
    const laterReturn = saleKey ? (returnsAfter.get(saleKey) || 0) : 0;
    total += Math.max(0, current + laterCollections - laterEdit + laterReturn);
  }

  for (const row of versements) {
    const saleKey = String(row.sale_key || row.sale_id || '');
    const saleDate = row.sale_date || saleDates[saleKey];
    if (!saleDate || !Number.isFinite(new Date(saleDate).getTime())) {
      complete = false; unresolved += 1; continue;
    }
    if (new Date(saleDate).getTime() >= endTime) continue;
    const initialDate = row.initial_collected_at || row.sale_date;
    const settlementDate = row.settlement?.settled_at || row.settled_at;
    let due = Math.max(0, Number(row.remaining ?? row.sale_total - (row.initial_amount || 0) - (row.settlement?.amount || 0)) || 0);
    if (!initialDate || !Number.isFinite(new Date(initialDate).getTime())) {
      complete = false; unresolved += 1;
    } else if (after(initialDate)) due += Number(row.initial_recorded_amount ?? row.initial_amount) || 0;
    if (Number(row.settlement?.amount || 0) > 0) {
      if (!settlementDate || !Number.isFinite(new Date(settlementDate).getTime())) {
        complete = false; unresolved += 1;
      } else if (after(settlementDate)) due += Number(row.settlement.amount) || 0;
    }
    total += Math.max(0, due - (editsAfter.get(saleKey) || 0) + (returnsAfter.get(saleKey) || 0));
  }

  for (const sale of orphanVersements) {
    const saleKey = String(sale.sales_id || sale.sale_id || sale._id || '');
    complete = false; unresolved += 1;
    const saleDate = sale.date || sale.created_date;
    if (!saleDate || !Number.isFinite(new Date(saleDate).getTime())) {
      complete = false; unresolved += 1; continue;
    }
    if (new Date(saleDate).getTime() >= endTime) continue;
    const meta = sale.versement_checkout || {};
    const initialDate = meta.initial_collected_at || sale.date || sale.created_date;
    const initial = Number(meta.initial_amount || 0) || 0;
    let due;
    if (finite(sale.payment_pending)) due = Math.max(0, Number(sale.payment_pending));
    else {
      due = Math.max(0, Number(sale.sales_total ?? sale.total ?? 0) - initial);
      complete = false; unresolved += 1;
    }
    if (initial > 0 && after(initialDate)) due += initial;
    total += Math.max(0, due - (editsAfter.get(saleKey) || 0) + (returnsAfter.get(saleKey) || 0));
  }

  return { amount: round2(total), complete, unresolved };
}

module.exports = { round2, normalizeTenderName, isCashTender, aggregateSalePaymentEvents, summarizeCashRegisterSessions, calculateDailyClose, reconstructOutstandingAsOf };
