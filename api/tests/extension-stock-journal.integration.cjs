'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { MongoClient, ObjectId } = require('mongodb');
const { runStockBatch } = require('../src/services/extension-stock-journal');
const { applyStockEffect } = require('../src/services/extension-stock-effects');
const BaseModel = require('../src/models/base.model');
const StockLogsRepository = require('../src/repositories/stock-log.repository');
let mongo, client, db;
before(async () => {
  mongo = await MongoMemoryServer.create({
    binary: { systemBinary: process.env.MONGOMS_SYSTEM_BINARY },
  });
  client = await MongoClient.connect(mongo.getUri());
  db = client.db('stock_journal');
});
after(async () => {
  await client?.close();
  await mongo?.stop();
});
async function fixture(amounts = [3, 3]) {
  const scope = { license: new ObjectId(), branchId: new ObjectId(), actorId: new ObjectId() };
  const rows = amounts.map((available_quantity) => ({
    _id: new ObjectId(),
    license: scope.license,
    branch_id: scope.branchId,
    track_inventory: true,
    item_status: 'regular',
    available_quantity,
  }));
  await db.collection('items').insertMany(rows);
  const command = {
    extensionId: 'posnic.example',
    operationId: 'basket-command-0001',
    lines: rows.map((row) => ({ itemId: String(row._id), quantityMilli: 1000 })),
  };
  const stock = async () =>
    Promise.all(
      rows.map(
        async (row) => (await db.collection('items').findOne({ _id: row._id })).available_quantity
      )
    );
  return { scope, command, stock };
}
test('resume after effect applied but acknowledgement lost, including concurrent recovery', async () => {
  const f = await fixture();
  let calls = 0;
  await assert.rejects(
    runStockBatch(db, f.scope, f.command, {
      applyEffect: async (...args) => {
        const result = await applyStockEffect(...args);
        if (++calls === 1) throw new Error('lost acknowledgement');
        return result;
      },
    }),
    /lost acknowledgement/
  );
  const results = await Promise.all(
    Array.from({ length: 8 }, () => runStockBatch(db, f.scope, f.command))
  );
  assert.ok(results.every((result) => result.status === 'committed'));
  assert.deepEqual(await f.stock(), [2, 2]);
});
test('insufficient basket is fully compensated even if recovery also loses an acknowledgement', async () => {
  const f = await fixture([3, 0]);
  await assert.rejects(
    runStockBatch(db, f.scope, f.command, {
      applyEffect: async (...args) => {
        const result = await applyStockEffect(...args);
        if (args[2].deltaMilli > 0) throw new Error('lost reverse acknowledgement');
        return result;
      },
    }),
    /lost reverse acknowledgement/
  );
  assert.equal((await runStockBatch(db, f.scope, f.command)).status, 'rejected');
  assert.deepEqual(await f.stock(), [3, 0]);
});
test('actor or quantity changes cannot reuse a durable operation', async () => {
  const f = await fixture();
  await runStockBatch(db, f.scope, f.command);
  await assert.rejects(runStockBatch(db, { ...f.scope, actorId: new ObjectId() }, f.command), {
    code: 'stock_batch_conflict',
  });
  await assert.rejects(
    runStockBatch(db, f.scope, {
      ...f.command,
      lines: f.command.lines.map((line) => ({ ...line, quantityMilli: 2000 })),
    }),
    { code: 'stock_batch_conflict' }
  );
  assert.deepEqual(await f.stock(), [2, 2]);
});


test('legacy stock journal rows remain readable and new V2 movement rows persist', async () => {
  const branchId = new ObjectId();
  const licenseId = new ObjectId();
  const itemId = new ObjectId();
  const oldBranch = BaseModel.currentBranch;
  const oldLicense = BaseModel.license;
  BaseModel.currentBranch = branchId;
  BaseModel.license = licenseId;
  try {
    await db.collection('stocklogs').insertMany([
      {
        _id: new ObjectId(), branch_id: String(branchId), license: String(licenseId),
        view_item_id: itemId, item_name: 'Legacy article', process: 'Old stock entry',
        date: '2025-02-01T10:00:00.000Z', created_date: '2025-02-01T10:00:00.000Z',
      },
      {
        _id: new ObjectId(), branch_id: branchId, license: licenseId,
        view_item_id: itemId, item_name: 'V2 article', process: 'V2 stock entry',
        date: new Date('2025-02-02T10:00:00.000Z'), created_date: new Date('2025-02-02T10:00:00.000Z'),
      },
    ]);
    const repository = new StockLogsRepository();
    repository.getCollection = async (name) => db.collection(name);
    let result = await repository.getStockLogs({}, { page: 1, limit: 50 });
    assert.equal(result.status, true);
    assert.equal(result.data.total, 2);
    assert.deepEqual(new Set(result.data.list.map((row) => row.item_name)), new Set(['Legacy article', 'V2 article']));

    const created = await repository.createStockLog({
      branch_id: branchId, license: licenseId, view_item_id: itemId,
      item_barcode_id: 'V2-001', item_name: 'Newly adjusted article',
      item_quantity: '7', process: 'Edit Quantity', reference: 'V2-001',
      date: new Date('2025-02-03T10:00:00.000Z'), action: 'Add',
      opening_balance: '5', closing_balance: '7', count: '2',
      changed_by: 'Test cashier', changed_by_userid: new ObjectId(),
    });
    assert.equal(created.status, true);
    const saved = await db.collection('stocklogs').findOne({ process: 'Edit Quantity', item_barcode_id: 'V2-001' });
    assert.ok(saved);
    assert.equal(saved.branch_id.toString(), branchId.toString());
    assert.equal(saved.license.toString(), licenseId.toString());
    assert.equal(new Date(saved.date).toISOString(), '2025-02-03T10:00:00.000Z');
    result = await repository.getStockLogs({}, { page: 1, limit: 50 });
    assert.equal(result.data.total, 3);
  } finally {
    BaseModel.currentBranch = oldBranch;
    BaseModel.license = oldLicense;
  }
});
