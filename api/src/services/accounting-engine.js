'use strict';

const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;
const finite = (value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
const asAmount = (value) => (finite(value) ? Number(value) : null);
const isCashTender = (method) => /^(cash|esp[eè]ces?|esp[eè]ce)$/i.test(String(method || '').trim());

/**
 * The single pure calculation boundary for the daily closing ticket.
 * Inputs are already scoped and date-classified by the caller. Unknown
 * financial inputs remain unavailable; they are never silently coerced to zero.
 */
function summarizeCashRegisterSessions(sessions = [], start, end) {
  const startTime = new Date(start).getTime(), endTime = new Date(end).getTime();
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) throw new Error('Valid cash-register date boundaries are required.');
  let openingBalance = 0, otherCashOutflows = 0, complete = sessions.length > 0, unresolved = 0, matched = 0;
  const canonicalSources = new Set(['sale','sales','expense','salary_payment','advance','prime','credit_settlement','versement','refund','zr_delivery_payout']);
  for (const session of sessions) {
    const opened = session.register_opendate ? new Date(session.register_opendate).getTime() : NaN;
    const closed = session.register_closedate ? new Date(session.register_closedate).getTime() : Infinity;
    if (!Number.isFinite(opened)) { complete = false; unresolved += 1; continue; }
    if (opened >= endTime || closed < startTime) continue;
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
        if (!canonicalSources.has(source)) otherCashOutflows += cashOut - cashIn;
      }
    }
  }
  if (!matched) complete = false;
  return { openingBalance: round2(openingBalance), otherCashOutflows: round2(otherCashOutflows), complete, unresolved };
}

function calculateDailyClose(input = {}) {
  const salesTotal = asAmount(input.salesTotal);
  const cost = asAmount(input.costOfGoodsTotal);
  const costComplete = input.costDataComplete === true && cost !== null && salesTotal !== null;
  const grossProfit = costComplete ? round2(salesTotal - cost) : null;

  const expenses = asAmount(input.expensesTotal);
  const salaries = asAmount(input.salaryPaymentsTotal);
  const advances = asAmount(input.salaryAdvancesTotal);
  const bonuses = asAmount(input.salaryPrimesTotal);
  const profitComplete = grossProfit !== null &&
    input.expensesComplete !== false &&
    input.payrollComplete !== false &&
    expenses !== null && salaries !== null && advances !== null && bonuses !== null;
  const netProfit = profitComplete
    ? round2(grossProfit - expenses - salaries - advances - bonuses)
    : null;

  const cash = input.cash || {};
  const cashKeys = [
    'openingBalance',
    'cashSales',
    'cashVersements',
    'cashCreditCollections',
    'deliveryPayouts',
    'cashExpenses',
    'cashSalaries',
    'cashAdvances',
    'cashBonuses',
    'cashRefunds',
    'otherCashOutflows',
  ];
  const cashComplete = input.cashDataComplete === true && cashKeys.every((key) => finite(cash[key]));
  const expectedCash = cashComplete
    ? round2(
        Number(cash.openingBalance) +
        Number(cash.cashSales) +
        Number(cash.cashVersements) +
        Number(cash.cashCreditCollections) +
        Number(cash.deliveryPayouts) -
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
    costOfGoodsTotal: costComplete ? round2(cost) : null,
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
  const transactionIds = new Set(transactions.flatMap(row => [id(row._id), id(row.sale_id)].filter(Boolean)));
  const transactionSaleCounts = new Map();
  transactions.forEach(row => {
    const saleId = id(row.sale_id);
    if (saleId) transactionSaleCounts.set(saleId, (transactionSaleCounts.get(saleId) || 0) + 1);
  });
  for (const payment of creditPayments.filter(row => after(row.received_at))) {
    const allocations = Array.isArray(payment.allocations) ? payment.allocations : [];
    if (!allocations.length) { complete = false; unresolved += 1; continue; }
    let allocatedTotal = 0;
    for (const allocation of allocations) {
      const amount = Number(allocation.amount) || 0;
      allocatedTotal += amount;
      const transactionId = id(allocation.transaction_id);
      const saleId = id(allocation.sale_id);
      const hasTransactionId = transactionId && transactions.some(row => id(row._id) === transactionId);
      const uniqueSaleLink = saleId && transactionSaleCounts.get(saleId) === 1;
      if (!hasTransactionId && !uniqueSaleLink) { complete = false; unresolved += 1; continue; }
      const key = hasTransactionId ? transactionId : saleId;
      collectionsAfter.set(key, (collectionsAfter.get(key) || 0) + amount);
    }
    if (Math.abs(allocatedTotal - (Number(payment.amount) || 0)) > 0.01) {
      complete = false; unresolved += 1;
    }
  }
  const editsAfter = new Map();
  editAdjustments.filter((row) => after(row.created_at)).forEach((row) => {
    for (const key of [id(row.sale_id), id(row.sales_id)].filter(Boolean)) {
      editsAfter.set(key, (editsAfter.get(key) || 0) + (Number(row.amount) || 0));
    }
  });
  const returnsAfter = new Map();
  returns.filter((row) => after(row.date)).forEach((row) => {
    for (const key of [id(row.sale_id), id(row.sales_id)].filter(Boolean)) {
      returnsAfter.set(key, (returnsAfter.get(key) || 0) + (Number(row.amount) || 0));
    }
  });

  const versementKeys = new Set([
    ...versements.map((row) => String(row.sale_key || row.sale_id || '')),
    ...orphanVersements.map((row) => String(row.sales_id || row.sale_id || row._id || '')),
  ]);
  let total = 0;
  let complete = true;
  let unresolved = 0;
  for (const row of transactions) {
    const saleKey = String(row.sale_id || '');
    if (saleKey && versementKeys.has(saleKey)) continue;
    const created = row.created_date || saleDates[saleKey];
    if (!created || !Number.isFinite(new Date(created).getTime())) {
      complete = false; unresolved += 1;
    } else if (new Date(created).getTime() >= endTime) continue;
    const current = Math.max(0, Number(row.pending) || 0);
    const laterEdit = editsAfter.get(saleKey) || 0;
    const laterReturn = returnsAfter.get(saleKey) || 0;
    const laterCollections = collectionsAfter.get(id(row._id)) || collectionsAfter.get(saleKey) || 0;
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

module.exports = { round2, isCashTender, summarizeCashRegisterSessions, calculateDailyClose, reconstructOutstandingAsOf };
