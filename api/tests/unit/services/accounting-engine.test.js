'use strict';

const {
  calculateDailyClose,
  reconstructOutstandingAsOf,
} = require('../../../src/services/accounting-engine');

describe('accounting engine daily close', () => {
  test('uses the required gross and net profit equations', () => {
    const result = calculateDailyClose({
      salesTotal: 1000,
      costOfGoodsTotal: 600,
      costDataComplete: true,
      expensesTotal: 50,
      salaryPaymentsTotal: 100,
      salaryAdvancesTotal: 20,
      salaryPrimesTotal: 30,
    });
    expect(result.grossProfitTotal).toBe(400);
    expect(result.netProfitTotal).toBe(200);
  });

  test('never turns missing historical cost into zero profit cost', () => {
    const result = calculateDailyClose({
      salesTotal: 1000,
      costOfGoodsTotal: null,
      costDataComplete: false,
      expensesTotal: 50,
      salaryPaymentsTotal: 0,
      salaryAdvancesTotal: 0,
      salaryPrimesTotal: 0,
    });
    expect(result.costOfGoodsTotal).toBeNull();
    expect(result.grossProfitTotal).toBeNull();
    expect(result.netProfitTotal).toBeNull();
  });

  test('includes opening cash, versements and credit collections but excludes non-cash tenders', () => {
    const result = calculateDailyClose({
      salesTotal: 1000,
      costOfGoodsTotal: 400,
      costDataComplete: true,
      expensesTotal: 0,
      salaryPaymentsTotal: 0,
      salaryAdvancesTotal: 0,
      salaryPrimesTotal: 0,
      cashDataComplete: true,
      cash: {
        openingBalance: 500,
        cashSales: 200,
        cashVersements: 100,
        cashCreditCollections: 75,
        deliveryPayouts: 25,
        cashExpenses: 50,
        cashSalaries: 0,
        cashAdvances: 0,
        cashBonuses: 0,
        cashRefunds: 20,
        otherCashOutflows: 10,
      },
    });
    expect(result.cashExpected).toBe(820);
  });

  test('uses cash register opening float plus pre-day cash movements and only manual same-day movements', () => {
    const result = require('../../../src/services/accounting-engine').summarizeCashRegisterSessions([
      {
        register_opendate: '2026-11-20T08:00:00Z',
        register_closedate: '2026-11-25T20:00:00Z',
        opening_float: 100,
        cashInOutDetail: [
          { date: '2026-11-22T18:00:00Z', cashin_amount: 20, cashout_amount: 5, source: 'manual' },
          { date: '2026-11-23T10:00:00Z', cashin_amount: 10, cashout_amount: 15, source: 'manual' },
          { date: '2026-11-23T11:00:00Z', cashin_amount: 50, cashout_amount: 0, source: 'credit_settlement' },
        ],
      },
    ], '2026-11-23T00:00:00Z', '2026-11-24T00:00:00Z');
    expect(result.openingBalance).toBe(115);
    expect(result.otherCashOutflows).toBe(5);
    expect(result.complete).toBe(true);
  });

  test('marks the drawer unavailable when no matching register session exists', () => {
    const result = require('../../../src/services/accounting-engine').summarizeCashRegisterSessions([], '2026-11-23T00:00:00Z', new Date('2026-11-24T00:00:00Z'));
    expect(result.complete).toBe(false);
  });

  test('keeps cash unavailable when the opening float or tender classification is unknown', () => {
    const result = calculateDailyClose({
      salesTotal: 10, costOfGoodsTotal: 5, costDataComplete: true,
      expensesTotal: 0, salaryPaymentsTotal: 0, salaryAdvancesTotal: 0, salaryPrimesTotal: 0,
      cashDataComplete: false,
      cash: { openingBalance: null },
    });
    expect(result.cashExpected).toBeNull();
  });
});

describe('accounting engine historical receivables', () => {
  const end = new Date('2026-11-23T00:00:00.000Z');

  test('adds back collections made after the selected closing date', () => {
    const result = reconstructOutstandingAsOf({
      end,
      transactions: [{ sale_id: 'S-1', created_date: '2026-11-20T10:00:00Z', pending: 20 }],
      creditPayments: [{ amount: 30, received_at: '2026-11-24T10:00:00Z', allocations: [{ transaction_id: 't1', sale_id: 'S-1', amount: 30 }] }],
    });
    expect(result.amount).toBe(50);
    expect(result.complete).toBe(true);
  });

  test('adds collections once across multiple debt rows', () => {
    const result = reconstructOutstandingAsOf({
      end,
      transactions: [
        { _id: 't1', sale_id: 'S-1', created_date: '2026-11-20T10:00:00Z', pending: 20 },
        { _id: 't2', sale_id: 'S-2', created_date: '2026-11-21T10:00:00Z', pending: 10 },
      ],
      creditPayments: [{ amount: 30, received_at: '2026-11-24T10:00:00Z', allocations: [{ transaction_id: 't1', sale_id: 'S-1', amount: 30 }] }],
    });
    expect(result.amount).toBe(60);
  });

  test('does not add collections allocated to a debt created after the selected day', () => {
    const result = reconstructOutstandingAsOf({
      end,
      transactions: [{ _id: 't-new', sale_id: 'S-new', created_date: '2026-11-24T10:00:00Z', pending: 0 }],
      creditPayments: [{ amount: 25, received_at: '2026-11-25T10:00:00Z', allocations: [{ transaction_id: 't-new', sale_id: 'S-new', amount: 25 }] }],
    });
    expect(result.amount).toBe(0);
    expect(result.complete).toBe(true);
  });

  test('reverses later edits and returns when reconstructing an earlier balance', () => {
    const result = reconstructOutstandingAsOf({
      end,
      transactions: [{ sale_id: 'S-2', created_date: '2026-11-20T10:00:00Z', pending: 40 }],
      editAdjustments: [{ sale_id: 'S-2', amount: 10, created_at: '2026-11-24T10:00:00Z' }],
      returns: [{ sale_id: 'S-2', amount: 5, date: '2026-11-25T10:00:00Z' }],
    });
    expect(result.amount).toBe(35);
  });

  test('reconstructs an unsettled Versement without counting its initial deposit twice', () => {
    const result = reconstructOutstandingAsOf({
      end,
      versements: [{
        sale_key: 'S-3', sale_date: '2026-11-20T10:00:00Z',
        created_at: '2026-11-20T10:05:00Z', initial_collected_at: '2026-11-20T10:05:00Z',
        initial_amount: 30, remaining: 70, sale_total: 100,
      }],
    });
    expect(result.amount).toBe(70);
  });

  test('adds a later Versement settlement back to the earlier outstanding balance', () => {
    const result = reconstructOutstandingAsOf({
      end,
      versements: [{
        sale_key: 'S-4', sale_date: '2026-11-20T10:00:00Z',
        created_at: '2026-11-20T10:05:00Z', initial_collected_at: '2026-11-20T10:05:00Z',
        initial_amount: 30, remaining: 0, sale_total: 100,
        settlement: { amount: 70, method: 'cash', settled_at: '2026-11-24T10:00:00Z' },
      }],
    });
    expect(result.amount).toBe(70);
  });
});
