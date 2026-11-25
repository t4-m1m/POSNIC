'use strict';

const {
  calculateDailyClose,
  reconstructOutstandingAsOf,
  summarizeSaleReturns,
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

  test('shows provisional profit arithmetic when cost is known but not fully verified', () => {
    const result = calculateDailyClose({
      salesTotal: 1000, costOfGoodsTotal: 600, costDataComplete: false,
      expensesTotal: 50, expensesComplete: true,
      salaryPaymentsTotal: 100, salaryAdvancesTotal: 20, salaryPrimesTotal: 30,
      payrollComplete: true,
    });
    expect(result.costOfGoodsTotal).toBe(600);
    expect(result.grossProfitTotal).toBe(400);
    expect(result.netProfitTotal).toBe(200);
    expect(result.costDataComplete).toBe(false);
    expect(result.profitDataComplete).toBe(false);
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

  test('uses only selected-day physical cash movements and excludes opening float and COD payouts', () => {
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
    expect(result.cashExpected).toBe(305);
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

  test('ignores malformed sessions that were already closed before the report day', () => {
    const result = require('../../../src/services/accounting-engine').summarizeCashRegisterSessions([
      { register_closedate: '2026-11-22T20:00:00Z' },
      {
        register_opendate: '2026-11-23T08:00:00Z',
        opening_float: 250,
        cashInOutDetail: [],
      },
    ], '2026-11-23T00:00:00Z', '2026-11-24T00:00:00Z');
    expect(result.openingBalance).toBe(250);
    expect(result.complete).toBe(true);
  });

  test('marks the drawer unavailable when no matching register session exists', () => {
    const result = require('../../../src/services/accounting-engine').summarizeCashRegisterSessions([], '2026-11-23T00:00:00Z', new Date('2026-11-24T00:00:00Z'));
    expect(result.complete).toBe(false);
  });

  test('returns a provisional cash total when amounts are known but register evidence is incomplete', () => {
    const result = calculateDailyClose({
      salesTotal: 1000, costOfGoodsTotal: 400, costDataComplete: true,
      expensesTotal: 0, salaryPaymentsTotal: 0, salaryAdvancesTotal: 0, salaryPrimesTotal: 0,
      cashDataComplete: false,
      cash: {
        openingBalance: 0, cashSales: 9200, cashVersements: 4000,
        cashCreditCollections: 0, deliveryPayouts: 0, cashExpenses: 0,
        cashSalaries: 0, cashAdvances: 0, cashBonuses: 0, cashRefunds: 0,
        otherCashOutflows: 0,
      },
    });
    expect(result.cashExpected).toBe(13200);
    expect(result.cashDataComplete).toBe(false);
  });

  test('keeps cash unavailable when a required daily cash-flow component is unknown', () => {
    const result = calculateDailyClose({
      salesTotal: 10, costOfGoodsTotal: 5, costDataComplete: true,
      expensesTotal: 0, salaryPaymentsTotal: 0, salaryAdvancesTotal: 0, salaryPrimesTotal: 0,
      cashDataComplete: false,
      cash: { cashSales: null },
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

  test('applies a sale-level edit only once when the sale has multiple debt rows', () => {
    const result = reconstructOutstandingAsOf({
      end,
      transactions: [
        { _id: 't1', sale_id: 'S-5', created_date: '2026-11-20T10:00:00Z', pending: 20 },
        { _id: 't2', sale_id: 'S-5', created_date: '2026-11-20T10:00:00Z', pending: 10 },
      ],
      editAdjustments: [{ sale_id: 'S-5', sales_id: 'S-5', amount: 5, created_at: '2026-11-24T10:00:00Z' }],
    });
    expect(result.amount).toBe(25);
  });

  test('applies a sale-only legacy allocation once across multiple debt rows', () => {
    const result = reconstructOutstandingAsOf({
      end,
      transactions: [
        { _id: 't1', sale_id: 'S-6', created_date: '2026-11-20T10:00:00Z', pending: 5 },
        { _id: 't2', sale_id: 'S-6', created_date: '2026-11-20T10:00:00Z', pending: 5 },
      ],
      creditPayments: [{
        amount: 3,
        received_at: '2026-11-24T10:00:00Z',
        allocations: [{ sale_id: 'S-6', amount: 3 }],
      }],
    });
    expect(result.amount).toBe(13);
    expect(result.complete).toBe(true);
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

describe('sale payment event classification', () => {
  const { aggregateSalePaymentEvents, normalizeTenderName, isCashTender } = require('../../../src/services/accounting-engine');
  const start = '2026-11-23T00:00:00.000Z';
  const end = '2026-11-24T00:00:00.000Z';

  test('normalizes cash, TPE and BaridiMob tender labels', () => {
    expect(normalizeTenderName('cash')).toBe('CASH');
    expect(normalizeTenderName('card')).toBe('TPE');
    expect(normalizeTenderName('bank_transfer')).toBe('BaridiMob');
    expect(isCashTender('CASH')).toBe(true);
    expect(isCashTender('TPE')).toBe(false);
  });

  test('uses dated sale payments and excludes separately recorded credit collections', () => {
    const result = aggregateSalePaymentEvents([{
      date: start,
      payments: [
        { amount: 50, date: '2026-11-23T10:00:00Z', method: 'cash' },
        { amount: 20, date: '2026-11-23T11:00:00Z', method: 'card' },
        { amount: 30, date: '2026-11-23T12:00:00Z', method: 'bank_transfer' },
        { amount: 40, date: '2026-11-23T13:00:00Z', method: 'cash', origin: { type: 'credit_settlement' } },
        { amount: 25, date: '2026-11-24T10:00:00Z', method: 'cash' },
      ],
    }], start, end);
    expect(result.complete).toBe(true);
    expect(result.details).toEqual(expect.arrayContaining([
      expect.objectContaining({ payment_mode: 'CASH', sale_payment: 50 }),
      expect.objectContaining({ payment_mode: 'TPE', sale_payment: 20 }),
      expect.objectContaining({ payment_mode: 'BaridiMob', sale_payment: 30 }),
    ]));
    expect(result.details.reduce((sum, row) => sum + row.sale_payment, 0)).toBe(100);
  });

  test('falls back to saved legacy multi-payment data only when no event ledger exists', () => {
    const result = aggregateSalePaymentEvents([{
      date: start,
      multi_payment: { Cash: 80, TPE: 20, Credit: 10 },
    }], start, end);
    expect(result.complete).toBe(true);
    expect(result.details.reduce((sum, row) => sum + row.sale_payment, 0)).toBe(100);
  });

  test('accepts legacy payment event field names and inherits the sale date', () => {
    const result = aggregateSalePaymentEvents([{
      date: start,
      payments: [
        { payment_mode: 'cash', sale_payment: 120 },
        { type: 'card', paid_amount: 80 },
      ],
    }], start, end);
    expect(result.complete).toBe(true);
    expect(result.details).toEqual(expect.arrayContaining([
      expect.objectContaining({ payment_mode: 'CASH', sale_payment: 120 }),
      expect.objectContaining({ payment_mode: 'TPE', sale_payment: 80 }),
    ]));
  });

  test('marks missing payment event dates or methods as incomplete', () => {
    const result = aggregateSalePaymentEvents([{
      date: start,
      payments: [{ amount: 20, method: '' }],
    }], start, end);
    expect(result.complete).toBe(false);
  });
});


describe('daily close sale return reconciliation', () => {
  test('subtracts dated returned merchandise revenue and its persisted returned COGS', () => {
    const result = summarizeSaleReturns([{
      sales_id: 'S-RET-1',
      sale_original_snapshot: { items: [
        { item_id: 'ret-a', item_quantity: 2, company_price_total: 20 },
        { item_id: 'ret-b', item_quantity: 1, company_price_total: 8 },
      ] },
      items_return: [
        { returnArray: { returnDate: '2026-11-23T10:00:00Z', itemsTotalAmount: 45, returnValue: [
          { item_id: 'ret-a', item_quantity: 2, company_price_total: 20 },
          { item_id: 'ret-b', item_quantity: 1, company_price_total: 8 },
        ] } },
        { returnArray: { returnDate: '2026-11-24T10:00:00Z', itemsTotalAmount: 10, returnValue: [
          { item_quantity: 1, company_price_total: 4 },
        ] } },
      ],
    }], '2026-11-23T00:00:00Z', '2026-11-24T00:00:00Z');
    expect(result).toMatchObject({ amount: 45, cost: 28, complete: true, costComplete: true, count: 1 });
    expect(result.events).toHaveLength(2);
  });

  test('does not invent returned COGS when the return snapshot has no cost', () => {
    const result = summarizeSaleReturns([{
      sales_id: 'S-RET-2',
      items_return: [{ returnArray: { returnDate: '2026-11-23T10:00:00Z', itemsTotalAmount: 10, returnValue: [
        { item_quantity: 1, item_price: 10 },
      ] } }],
    }], '2026-11-23T00:00:00Z', '2026-11-24T00:00:00Z');
    expect(result.amount).toBe(10);
    expect(result.costComplete).toBe(false);
  });
});

describe('sale return historical cost snapshots', () => {
  test('uses original invoice unit cost, not the catalogue cost recorded at return time', () => {
    const result = summarizeSaleReturns([{
      sales_id: 'S-RET-COST',
      sale_original_snapshot: { items: [
        { item_id: 'item-1', item_quantity: 4, company_price_total: 80 },
      ] },
      items_return: [{ returnArray: { returnDate: '2026-11-23T10:00:00Z', itemsTotalAmount: 30, returnValue: [
        { item_id: 'item-1', item_quantity: 2, company_price_total: 120 },
      ] } }],
    }], '2026-11-23T00:00:00Z', '2026-11-24T00:00:00Z');
    expect(result.cost).toBe(40);
    expect(result.costComplete).toBe(true);
  });
});

test('return-only day keeps returned COGS as a negative adjustment instead of clamping it to zero', () => {
  const returned = summarizeSaleReturns([{
    sales_id: 'S-RET-ONLY',
    sale_original_snapshot: { items: [{ item_id: 'item-2', item_quantity: 1, company_price_total: 30 }] },
    items_return: [{ returnArray: { returnDate: '2026-11-23T10:00:00Z', itemsTotalAmount: 50, returnValue: [
      { item_id: 'item-2', item_quantity: 1, company_price_total: 90 },
    ] } }],
  }], '2026-11-23T00:00:00Z', '2026-11-24T00:00:00Z');
  expect(Math.round((0 - returned.cost) * 100) / 100).toBe(-30);
});


describe('fourteen-day business accounting regression fixture', () => {
  test('keeps sales, returns, profit and cash-flow events separate across two weeks', () => {
    const { parseAmount, calculateDailyClose, summarizeSaleReturns, aggregateSalePaymentEvents } =
      require('../../../src/services/accounting-engine');
    expect(parseAmount('1,200.50')).toBe(1200.5);
    expect(parseAmount('1 200,50 DZD')).toBe(1200.5);
    const daily = Array.from({ length: 14 }, (_, index) => {
      const start = new Date(Date.UTC(2026, 10, 1 + index));
      const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
      const result = calculateDailyClose({
        salesTotal: '1,000.00', costOfGoodsTotal: '600,00', costDataComplete: true,
        expensesTotal: '50,00', salaryPaymentsTotal: 100, salaryAdvancesTotal: 20,
        salaryPrimesTotal: 30, cashDataComplete: true,
        cash: { cashSales: '200,00', cashVersements: 100, cashCreditCollections: 75,
          cashExpenses: 50, cashSalaries: 0, cashAdvances: 0, cashBonuses: 0,
          cashRefunds: 20, deliveryPayouts: 9999, openingBalance: 500 },
      });
      const payments = aggregateSalePaymentEvents([{
        date: start.toISOString(), payments: [
          { amount: '50,00', method: 'cash', date: start.toISOString() },
          { amount: '20.00', method: 'card', date: start.toISOString() },
          { amount: '30,00', method: 'bank_transfer', date: start.toISOString() },
          { amount: '75,00', method: 'cash', date: start.toISOString(), origin: { type: 'credit_settlement' } },
        ],
      }], start, end);
      expect(payments.complete).toBe(true);
      expect(payments.details.reduce((sum, row) => sum + row.sale_payment, 0)).toBe(100);
      expect(result.grossProfitTotal).toBe(400);
      expect(result.netProfitTotal).toBe(200);
      expect(result.cashExpected).toBe(305);
      return result;
    });
    expect(daily).toHaveLength(14);
    expect(daily.reduce((sum, row) => sum + row.grossProfitTotal, 0)).toBe(5600);
    expect(daily.reduce((sum, row) => sum + row.netProfitTotal, 0)).toBe(2800);
    expect(daily.reduce((sum, row) => sum + row.cashExpected, 0)).toBe(4270);
    const returned = summarizeSaleReturns([{
      sales_id: 'LEGACY-RETURN-14D',
      sale_original_snapshot: { items: [{ item_id: 'legacy-item', item_quantity: 2, company_price_total: 40 }] },
      items_return: [{ returnArray: { returnDate: '2026-11-07T12:00:00Z', itemsTotalAmount: '60,00',
        returnValue: [{ item_id: 'legacy-item', item_quantity: 1 }] } }],
    }], '2026-11-01T00:00:00Z', '2026-11-15T00:00:00Z');
    expect(returned).toMatchObject({ amount: 60, cost: 20, count: 1, itemsCount: 1, complete: true, costComplete: true });
  });
});
