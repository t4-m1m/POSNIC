'use strict';

/**
 * Supporting indexes for the authenticated POSNIC fast catalogue search.
 * Live collection fields: itemid=SKU, barcode_id=barcode,
 * category_name=category and updated_date=updatedAt.
 */
async function ensureItemFastSearchIndexes(db) {
  if (!db || typeof db.collection !== 'function') throw new TypeError('A connected MongoDB database is required');
  const items = db.collection('items');
  const definitions = [
    { key: { license: 1, branch_id: 1, barcode_id: 1 }, name: 'v2_items_barcode_scope' },
    { key: { license: 1, branch_id: 1, itemid: 1 }, name: 'v2_items_sku_scope' },
    { key: { license: 1, branch_id: 1, name: 1 }, name: 'v2_items_name_scope' },
    { key: { license: 1, branch_id: 1, category_name: 1 }, name: 'v2_items_category_scope' },
    { key: { license: 1, branch_id: 1, updated_date: -1 }, name: 'v2_items_updated_scope' },
    { key: { license: 1, branch_id: 1, reference: 1 }, name: 'v2_items_reference_scope', sparse: true }
  ];
  const existing = await items.listIndexes().toArray();
  const keySignature = key => JSON.stringify(Object.entries(key || {}));
  const created = [];
  const present = [];
  for (const definition of definitions) {
    const found = existing.find(index => keySignature(index.key) === keySignature(definition.key));
    if (found) { present.push(found.name); continue; }
    const { name, key, sparse } = definition;
    await items.createIndex(key, { name, ...(sparse ? { sparse: true } : {}) });
    created.push(name);
  }
  return { created, present };
}

module.exports = { ensureItemFastSearchIndexes };
