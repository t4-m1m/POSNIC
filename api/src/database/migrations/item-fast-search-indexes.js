'use strict';

const inFlightByDatabase = new WeakMap();

async function createIndexes(db) {
  if (!db || typeof db.collection !== 'function') {
    throw new TypeError('A connected MongoDB database is required');
  }
  const items = db.collection('items');
  const definitions = [
    { key: { license: 1, 'branch_access.branch_id': 1, barcode_id: 1 }, name: 'v2_items_barcode_scope' },
    { key: { license: 1, 'branch_access.branch_id': 1, itemid: 1 }, name: 'v2_items_sku_scope' },
    { key: { license: 1, 'branch_access.branch_id': 1, name: 1 }, name: 'v2_items_name_scope' },
    { key: { license: 1, 'branch_access.branch_id': 1, category_name: 1 }, name: 'v2_items_category_scope' },
    { key: { license: 1, 'branch_access.branch_id': 1, updated_date: -1 }, name: 'v2_items_updated_scope' },
    { key: { license: 1, 'branch_access.branch_id': 1, reference: 1 }, name: 'v2_items_reference_scope', sparse: true }
  ];
  const hasItemsCollection = await db.listCollections({ name: 'items' }, { nameOnly: true }).hasNext();
  const existing = hasItemsCollection ? await items.listIndexes().toArray() : [];
  const signature = (key) => JSON.stringify(Object.entries(key || {}));
  const created = [];
  const present = [];
  const warnings = [];

  for (const definition of definitions) {
    const found = existing.find((index) => signature(index.key) === signature(definition.key));
    if (found) {
      present.push(found.name);
      continue;
    }
    // A previous POSNIC release used the same index label for the legacy
    // branch_id key. Keep that live index and add the branch_access index
    // under a stable alternate name; never drop a production index at startup.
    const conflictingName = existing.some((index) =>
      index.name === definition.name && signature(index.key) !== signature(definition.key)
    );
    const indexName = conflictingName ? `${definition.name}_branch_access_v2` : definition.name;
    const indexOptions = { name: indexName, ...(definition.sparse ? { sparse: true } : {}) };
    try {
      await items.createIndex(definition.key, indexOptions);
      created.push(indexName);
      existing.push({ name: indexName, key: definition.key });
    } catch (error) {
      try {
        const refreshed = await items.listIndexes().toArray();
        const equivalent = refreshed.find((index) => signature(index.key) === signature(definition.key));
        if (equivalent) {
          present.push(equivalent.name);
          continue;
        }
        if ((error.code === 85 || error.codeName === 'IndexOptionsConflict') && indexName === definition.name) {
          const alternateName = `${definition.name}_branch_access_v2`;
          await items.createIndex(definition.key, {
            name: alternateName,
            ...(definition.sparse ? { sparse: true } : {}),
          });
          created.push(alternateName);
          existing.push({ name: alternateName, key: definition.key });
          continue;
        }
      } catch (refreshError) {
        warnings.push(`${definition.name}: index refresh/create failed: ${refreshError.message}`);
      }
      warnings.push(`${definition.name}: ${error.message}`);
      console.warn('[ItemSearchIndexes] Could not create index:', definition.name, error.message);
    }
  }
  return { created, present, warnings };
}

function ensureItemFastSearchIndexes(db) {
  if (!db || typeof db !== 'object') {
    return Promise.reject(new TypeError('A connected MongoDB database is required'));
  }
  const pending = inFlightByDatabase.get(db);
  if (pending) return pending;
  const work = createIndexes(db).finally(() => inFlightByDatabase.delete(db));
  inFlightByDatabase.set(db, work);
  return work;
}

module.exports = { ensureItemFastSearchIndexes };
