/**
 * Read-only preview and additive import for standalone articles from the
 * legacy EHANOUTE Firebird database. This deliberately does NOT use the
 * general CSV importer: that path can update existing records.
 */
const { ObjectId } = require('mongodb');
const BaseModel = require('../models/base.model');
const itemBarcodes = require('../utils/item-barcodes');

const MAX_ROWS = 1000;
const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function normalizePayload(payload) {
  const metadata = payload && payload.metadata;
  const rows = payload && payload.articles;
  if (!metadata || metadata.source_database !== 'EHANOUTE.FDB') {
    throw new Error('This file is not an EHANOUTE.FDB migration export.');
  }
  if (metadata.currency !== 'DZD') throw new Error('Only DZD migration files are supported.');
  if (metadata.variants_supported !== false || metadata.brands_supported !== false) {
    throw new Error('This migration accepts standalone articles only (no variants or brands).');
  }
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > MAX_ROWS) {
    throw new Error('The JSON must contain between 1 and ' + MAX_ROWS + ' articles.');
  }

  const errors = [];
  const seenBarcodes = new Map();
  const seenNames = new Map();
  const normalized = [];
  rows.forEach((row, index) => {
    const line = index + 1;
    const name = String(row && row.name != null ? row.name : '').trim();
    const barcode = String(row && row.barcode != null ? row.barcode : '').trim();
    const category = String(row && row.category != null ? row.category : '').trim();
    const quantity = Number(row && row.quantity);
    const buying = Number(row && row.buying_price);
    const p1 = Number(row && row.selling_price_1);
    const p2 = Number(row && row.selling_price_2);
    const p3 = Number(row && row.selling_price_3);
    const numeric = [quantity, buying, p1, p2, p3];
    if (!name) errors.push({ row: line, field: 'name', message: 'Article name is empty.' });
    if (!barcode) errors.push({ row: line, field: 'barcode', message: 'Barcode is empty.' });
    if (!category) errors.push({ row: line, field: 'category', message: 'Category is empty.' });
    if (!numeric.every(Number.isFinite) || numeric.some((v) => v < 0)) {
      errors.push({ row: line, field: 'prices/quantity', message: 'Quantity and prices must be valid non-negative numbers.' });
    }
    if (Number.isFinite(quantity) && quantity <= 0) {
      errors.push({ row: line, field: 'quantity', message: 'Only articles with quantity greater than zero are accepted.' });
    }
    if (barcode && seenBarcodes.has(barcode)) {
      errors.push({ row: line, field: 'barcode', message: 'Barcode also appears on row ' + seenBarcodes.get(barcode) + '.' });
    } else if (barcode) seenBarcodes.set(barcode, line);
    const nameKey = name.toLocaleLowerCase();
    if (name && seenNames.has(nameKey)) {
      errors.push({ row: line, field: 'name', message: 'Name also appears on row ' + seenNames.get(nameKey) + '.' });
    } else if (name) seenNames.set(nameKey, line);
    normalized.push({ name, barcode, category, quantity, buying, p1, p2, p3, row: line });
  });
  if (errors.length) {
    const error = new Error('The migration file contains invalid or duplicate rows.');
    error.details = errors;
    throw error;
  }
  return { metadata, rows: normalized };
}

async function getScope(context) {
  const branchId = context && context.branchId;
  const licenseId = context && context.licenseId;
  if (!branchId || !licenseId) throw new Error('Active branch and license context are required.');
  const asObjectId = (v) => v instanceof ObjectId ? v : new ObjectId(String(v));
  return { branchId: asObjectId(branchId), licenseId: asObjectId(licenseId) };
}

async function inspect(payload, context) {
  const { metadata, rows } = normalizePayload(payload);
  const scope = await getScope(context);
  const db = await BaseModel.getDb();
  const items = db.collection('items');
  const categories = db.collection('categories');
  const names = rows.map((r) => r.name);
  const barcodes = rows.map((r) => r.barcode);
  const namePatterns = names.map((name) => new RegExp('^' + escapeRegex(name) + '$', 'i'));
  const existing = await items.find({
    license: scope.licenseId,
    del_status: { $nin: [1, '1', true] },
    $and: [itemBarcodes.branchScope(scope.branchId)],
    $or: [
      { barcode_id: { $in: barcodes } },
      { barcodes: { $in: barcodes } },
      { name: { $in: namePatterns } },
    ],
  }, { projection: { name: 1, barcode_id: 1, barcodes: 1 } }).toArray();

  const byBarcode = new Map();
  const byName = new Map();
  existing.forEach((item) => {
    itemBarcodes.codes(item).forEach((code) => byBarcode.set(String(code), item));
    if (item.name) byName.set(String(item.name).toLocaleLowerCase(), item);
  });
  const conflicts = [];
  const candidates = [];
  rows.forEach((row) => {
    const barcodeMatch = byBarcode.get(row.barcode);
    const nameMatch = byName.get(row.name.toLocaleLowerCase());
    if (barcodeMatch || nameMatch) {
      conflicts.push({
        row: row.row,
        name: row.name,
        barcode: row.barcode,
        reason: barcodeMatch && nameMatch ? 'Barcode and name already exist' : barcodeMatch ? 'Barcode already exists' : 'Name already exists',
        existing_name: (barcodeMatch || nameMatch).name,
      });
    } else candidates.push(row);
  });

  const categoryNames = Array.from(new Set(rows.map((r) => r.category)));
  const categoryPatterns = categoryNames.map((name) => new RegExp('^' + escapeRegex(name) + '$', 'i'));
  const foundCategories = await categories.find({
    branch_id: scope.branchId,
    license: scope.licenseId,
    is_deleted: { $ne: true },
    name: { $in: categoryPatterns },
  }, { projection: { name: 1 } }).toArray();
  const known = new Set(foundCategories.map((c) => String(c.name).toLocaleLowerCase()));
  const missingCategories = categoryNames.filter((name) => !known.has(name.toLocaleLowerCase()));

  return {
    source_database: metadata.source_database,
    currency: metadata.currency,
    declared_articles: Number(metadata.total_articles_extracted) || null,
    received_articles: rows.length,
    valid_articles: rows.length,
    ready_to_import: candidates.length,
    conflicts,
    missing_categories: missingCategories,
    skipped_existing: conflicts.length,
  };
}

async function preview(payload, context) {
  return inspect(payload, context);
}

async function importArticles(payload, context) {
  return itemBarcodes.withWriteLock(context, async () => {
  const previewResult = await inspect(payload, context);
  if (!previewResult.ready_to_import) {
    return { ...previewResult, imported: 0, migration_id: null, message: 'No new articles to import. Existing records were left unchanged.' };
  }
  const { rows } = normalizePayload(payload);
  const scope = await getScope(context);
  const db = await BaseModel.getDb();
  const categoryCollection = db.collection('categories');
  const itemCollection = db.collection('items');
  const now = new Date();
  const user = context.user || {};
  const migrationId = new ObjectId().toHexString();
  const categoryNameSet = new Set(rows.map((r) => r.category));
  const categoryDocs = await categoryCollection.find({
    branch_id: scope.branchId,
    license: scope.licenseId,
    is_deleted: { $ne: true },
  }, { projection: { _id: 1, name: 1 } }).toArray();
  const categoryMap = new Map(categoryDocs.map((c) => [String(c.name).toLocaleLowerCase(), c]));
  const missing = Array.from(categoryNameSet).filter((name) => !categoryMap.has(name.toLocaleLowerCase()));
  const newCategoryDocs = missing.map((name) => ({
    _id: new ObjectId(),
    name,
    branch_id: scope.branchId,
    branch_name: context.branchName || user.branch_name || user.branch?.branch_name || 'Default Branch',
    license: scope.licenseId,
    discount_amount: 0,
    discount_percentage: 0,
    is_active: true,
    created_by: context.userName || user.username || user.email || '',
    created_by_id: ObjectId.isValid(String(context.userId || user._id || '')) ? new ObjectId(String(context.userId || user._id)) : undefined,
    created_date: now,
    updated_date: now,
    legacy_migration_id: migrationId,
  }));
  if (newCategoryDocs.length) {
    await categoryCollection.insertMany(newCategoryDocs, { ordered: true });
    newCategoryDocs.forEach((c) => categoryMap.set(c.name.toLocaleLowerCase(), c));
  }

  // Re-check duplicates immediately before writing. This operation is additive:
  // it never updates, replaces, or deletes an existing item.
  const freshPreview = await inspect(payload, context);
  const conflicts = new Set(freshPreview.conflicts.map((c) => c.row));
  const importRows = rows.filter((r) => !conflicts.has(r.row));
  const docs = importRows.map((r) => {
    const category = categoryMap.get(r.category.toLocaleLowerCase());
    return {
      _id: new ObjectId(),
      name: r.name,
      barcode_id: r.barcode, // keep leading zeroes and exact source text
      category_id: category ? category._id : undefined,
      category_name: r.category,
      quantity: r.quantity,
      available_quantity: r.quantity,
      cost_price: r.buying,
      company_price: r.buying,
      selling_price: r.p1,
      selling_price_2: r.p2,
      selling_price_3: r.p3,
      track_inventory: true,
      negative_stock: false,
      item_kind: 'product',
      unit: 'qty',
      tax: 0,
      discount_amount: 0,
      discount_percentage: 0,
      is_active: true,
      branch_id: scope.branchId,
      branch_name: context.branchName || user.branch_name || user.branch?.branch_name || 'Default Branch',
      license: scope.licenseId,
      created_by: context.userName || user.username || user.email || '',
      created_by_id: ObjectId.isValid(String(context.userId || user._id || '')) ? new ObjectId(String(context.userId || user._id)) : undefined,
      created_date: now,
      updated_date: now,
      legacy_migration_id: migrationId,
      legacy_source_database: 'EHANOUTE.FDB',
    };
  });
  if (docs.length) await itemCollection.insertMany(docs, { ordered: true });
  const log = {
    _id: new ObjectId(),
    migration_id: migrationId,
    source_database: 'EHANOUTE.FDB',
    currency: 'DZD',
    branch_id: scope.branchId,
    license: scope.licenseId,
    imported_count: docs.length,
    skipped_conflicts: freshPreview.conflicts,
    created_categories: newCategoryDocs.map((c) => c.name),
    inserted_item_ids: docs.map((d) => d._id),
    created_date: now,
    created_by: context.userName || user.username || user.email || '',
  };
  await db.collection('legacy_item_migrations').insertOne(log);
  return {
    ...freshPreview,
    imported: docs.length,
    migration_id: migrationId,
    created_categories: newCategoryDocs.map((c) => c.name),
    message: docs.length + ' article(s) imported. Existing articles were not modified.',
  };
  });
}

module.exports = { preview, importArticles };
