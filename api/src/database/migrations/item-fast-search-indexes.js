'use strict';

/**
 * Supporting indexes for the authenticated POSNIC fast catalogue search.
 * Names and fields follow the live legacy items collection (itemid=SKU,
 * barcode_id=barcode, category_name=category, updated_date=updatedAt).
 * Tenant/branch scope is kept in each compound index.
 */
async function ensureItemFastSearchIndexes(db) {
  if (!db || typeof db.collection !== 'function') {
    throw new TypeError('A connected MongoDB database is required');
  }
  const items = db.collection('items');
  const definitions = [
    { key: { license: 1, branch_id: 1, barcode_id: 1 }, name: 'v2_items_barcode_scope' },
    { key: { license: 1, branch_id: 1, itemid: 1 }, name: 'v2_items_sku_scope' },
    { key: { license: 1, branch_id: 1, name: 1 }, name: 'v2_items_name_scope' },
    { key: { license: 1, branch_id: 1, category_name: 1 }, name: 'v2_items_category_scope' },
    { key: { license: 1, branch_id: 1, updated_date: -1 }, name: 'v2_items_updated_scope' },
    { key: { license: 1, branch_id: 1, reference: 1 }, name: 'v2_items_reference_scope', sparse: true }
  ];
  const created = [];
  for (const definition of definitions) {
    const { name, ...options } = definition;
    await items.createIndex(options.key, { name, ...(options.sparse ? { sparse: true } : {}) });
    created.push(name);
  }
  return created;
}

module.exports = { ensureItemFastSearchIndexes };
