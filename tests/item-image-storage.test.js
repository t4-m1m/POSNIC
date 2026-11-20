'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { preserveLegacyItemImages } = require('../src/item-image-storage');

test('preserves legacy item images without overwriting persistent copies', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'posnic-item-images-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const apiPath = path.join(root, 'resources', 'api');
  const userDataPath = path.join(root, 'user-data');
  const oldDir = path.join(apiPath, 'uploads', 'item_images');
  const newDir = path.join(userDataPath, 'uploads', 'item_images');
  fs.mkdirSync(oldDir, { recursive: true });
  fs.mkdirSync(newDir, { recursive: true });
  fs.writeFileSync(path.join(oldDir, 'old-photo.jpg'), 'legacy-bytes');
  fs.writeFileSync(path.join(oldDir, 'existing.jpg'), 'old-version');
  fs.writeFileSync(path.join(newDir, 'existing.jpg'), 'newer-user-copy');

  const result = preserveLegacyItemImages({ apiPath, userDataPath });
  assert.equal(result.copied, 1);
  assert.equal(fs.readFileSync(path.join(newDir, 'old-photo.jpg'), 'utf8'), 'legacy-bytes');
  assert.equal(fs.readFileSync(path.join(newDir, 'existing.jpg'), 'utf8'), 'newer-user-copy');
  assert.equal(preserveLegacyItemImages({ apiPath, userDataPath }).copied, 0);
});

test('missing legacy image directory is a harmless no-op', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'posnic-item-images-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const result = preserveLegacyItemImages({ apiPath: path.join(root, 'missing'), userDataPath: root });
  assert.equal(result.copied, 0);
  assert.equal(result.reason, 'no-legacy-directory');
});
