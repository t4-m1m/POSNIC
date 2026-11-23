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
  const collectionsAfter = creditPayments
    .filter((row) => after(row.received_at))
    .reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
  const editsAfter = new Map();
  editAdjustments.filter((row) => after(row.created_at)).forEach((row) => {
    const key = id(row.sale_id || row.sales_id);
    if (key) editsAfter.set(key, (editsAfter.get(key) || 0) + (Number(row.amount) || 0));
  });
  const returnsAfter = new Map();
  returns.filter((row) => after(row.date)).forEach((row) => {
    const key = id(row.sale_id || row.sales_id);
    if (key) returnsAfter.set(key, (returnsAfter.get(key) || 0) + (Number(row.amount) || 0));
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
    total += Math.max(0, current - laterEdit + laterReturn);
  }
  // The collection journal is a single total event stream, not a per-debt
  // amount. Add it back once after summing all current ledger rows.
  total += collectionsAfter;

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

module.exports = { round2, isCashTender, calculateDailyClose, reconstructOutstandingAsOf };
