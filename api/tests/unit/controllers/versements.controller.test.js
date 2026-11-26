const { ObjectId } = require('mongodb');
const controller = require('../../../src/controllers/versements.controller');

const BRANCH = '507f1f77bcf86cd799439011';
const SALE_ID = new ObjectId('507f1f77bcf86cd799439012');
const cursor = (rows) => ({
  sort() { return this; },
  limit() { return this; },
  toArray: async () => rows,
});

function makeHarness({ settled }) {
  const row = {
    _id: new ObjectId('507f1f77bcf86cd799439013'),
    sale_key: 'F6-0000123',
    sale_object_id: SALE_ID,
    branch_id: new ObjectId(BRANCH),
    status: 'settling',
    remaining: 5000,
    settlement_started_at: new Date('2026-11-25T10:00:00Z'),
    settlement_started_by: 'Cashier',
    settlement_started_method: 'cash',
    settlement_started_amount: 5000,
    history: [{ type: 'initial', amount: 1000, method: 'cash' }],
  };
  const sale = {
    _id: SALE_ID,
    sales_id: 'F6-0000123',
    versement_settled: settled,
    payment_mode: 'cash',
    versement_settlement_amount: 5000,
    versement_settled_at: new Date('2026-11-25T10:00:00Z'),
  };
  const versements = {
    find: jest.fn((filter) => cursor([row])),
    updateOne: jest.fn(async (filter, update) => {
      if (update.$set) Object.assign(row, update.$set);
      if (update.$unset) Object.keys(update.$unset).forEach(key => delete row[key]);
      if (update.$push?.history) row.history.push(update.$push.history);
      return { modifiedCount: 1 };
    }),
  };
  const sales = {
    find: jest.fn(() => cursor([])),
    findOne: jest.fn(async () => sale),
  };
  const db = { collection: jest.fn((name) => name === 'sale_versements' ? versements : sales) };
  const req = { db, params: {}, query: {}, body: {}, tenantContext: { branchId: BRANCH }, user: {} };
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  return { row, versements, req, res };
}

describe('Versement deferred inventory contract', () => {
  test('persists stock_deferred so the initial F6 deposit cannot consume inventory', async () => {
    const stored = [];
    const collection = {
      createIndex: jest.fn(async () => {}),
      findOne: jest.fn(async () => null),
      insertOne: jest.fn(async doc => { stored.push(doc); return { insertedId: new ObjectId('507f1f77bcf86cd799439014') }; }),
    };
    const db = { collection: jest.fn(() => collection) };
    const sale = {
      _id: SALE_ID,
      sales_id: 'F6-0000456',
      sales_total: 6000,
      branch_id: new ObjectId(BRANCH),
      versement_checkout: {
        customer_name: 'Client test',
        initial_amount: 1000,
        initial_method: 'cash',
        stock_deferred: true,
      },
      items: [],
    };
    const req = { db, tenantContext: { branchId: BRANCH }, user: { username: 'Cashier' } };
    const result = await controller.ensureForSale(req, sale);
    expect(result.stock_deferred).toBe(true);
    expect(stored[0]).toMatchObject({ status: 'pending', initial_amount: 1000, remaining: 5000, stock_deferred: true });
  });
});

describe('Versements interrupted settlement recovery', () => {
  test('finalizes the ledger and appends one settlement history event when the linked sale was settled', async () => {
    const h = makeHarness({ settled: true });
    await controller.list(h.req, h.res);

    expect(h.row.status).toBe('settled');
    expect(h.row.remaining).toBe(0);
    expect(h.row.settlement).toMatchObject({ amount: 5000, method: 'cash' });
    expect(h.row.history.filter(event => event.type === 'settlement')).toHaveLength(1);
    expect(h.res.json.mock.calls[0][0].data[0].status).toBe('settled');
  });

  test('releases the settling claim when the linked sale update never committed', async () => {
    const h = makeHarness({ settled: false });
    await controller.list(h.req, h.res);

    expect(h.row.status).toBe('pending');
    expect(h.row.remaining).toBe(5000);
    expect(h.row.history.filter(event => event.type === 'settlement')).toHaveLength(0);
    expect(h.res.json.mock.calls[0][0].data[0].status).toBe('pending');
  });
});
