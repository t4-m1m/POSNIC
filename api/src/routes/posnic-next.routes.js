'use strict';

const express = require('express');
const { ObjectId } = require('mongodb');
const { protect } = require('../middleware/auth');

const router = express.Router();
router.use(protect);

function scope(req) {
  const user = req.user || {};
  const branch = req.tenantContext?.branchId || req.session?.selectedBranchId || req.session?.branch_id || user.branch_id || user.branchId || user.branch?._id || user.default_branch_id;
  const license = req.tenantContext?.licenseId || user.license || user.license_id;
  if (!req.db || !branch || !license || !ObjectId.isValid(String(branch))) {
    const error = new Error('Active branch and license context are required.');
    error.status = 403;
    throw error;
  }
  return { branch_id: new ObjectId(String(branch)), license: ObjectId.isValid(String(license)) ? new ObjectId(String(license)) : license };
}

function collection(req) {
  return req.db.collection('posnic_next_settings');
}

async function ensureIndex(req) {
  await collection(req).createIndex({ branch_id: 1, license: 1 }, { unique: true, name: 'posnic_next_branch_license' });
}

router.get('/settings/costing', async (req, res) => {
  try {
    const filter = scope(req);
    const col = collection(req);
    await ensureIndex(req);
    const row = await col.findOne(filter, { projection: { costing: 1 } });
    return res.json({ type: 'success', data: row?.costing || { exchangeRate: 280, markupPercent: 0, rounding: 'none', cipherMap: {} } });
  } catch (error) {
    return res.status(error.status || 500).json({ type: 'error', message: error.message || 'Could not read costing settings.' });
  }
});

router.put('/settings/costing', async (req, res) => {
  try {
    if (req.user?.access?.setting?.write === false) return res.status(403).json({ type: 'error', message: 'Unauthorized.' });
    const filter = scope(req);
    const exchangeRate = Number(req.body?.exchangeRate);
    const markupPercent = Number(req.body?.markupPercent);
    const rounding = String(req.body?.rounding || 'none');
    const allowedRounding = ['none', '50', '100', 'x900', 'x950'];
    if (!Number.isFinite(exchangeRate) || exchangeRate <= 0 || exchangeRate > 100000 ||
        !Number.isFinite(markupPercent) || markupPercent < 0 || markupPercent > 10000 ||
        !allowedRounding.includes(rounding)) {
      return res.status(400).json({ type: 'error', message: 'Invalid exchange rate, markup or rounding rule.' });
    }
    const cipherMap = req.body?.cipherMap && typeof req.body.cipherMap === 'object' && !Array.isArray(req.body.cipherMap) ? req.body.cipherMap : {};
    await ensureIndex(req);
    const costing = { exchangeRate, markupPercent, rounding, cipherMap, updatedAt: new Date(), updatedBy: String(req.user?._id || req.user?.username || '') };
    await collection(req).updateOne(filter, { $set: { costing, updated_at: new Date() }, $setOnInsert: { created_at: new Date() } }, { upsert: true });
    return res.json({ type: 'success', data: costing, message: 'Costing settings saved.' });
  } catch (error) {
    return res.status(error.status || 500).json({ type: 'error', message: error.message || 'Could not save costing settings.' });
  }
});

router.get('/settings/label-template', async (req, res) => {
  try {
    const filter = scope(req);
    await ensureIndex(req);
    const row = await collection(req).findOne(filter, { projection: { labelTemplate: 1 } });
    return res.json({ type: 'success', data: row?.labelTemplate || { width: 30, height: 45, showName: true, showPrice: true, showBarcode: true, copies: 1 } });
  } catch (error) {
    return res.status(error.status || 500).json({ type: 'error', message: error.message || 'Could not read label settings.' });
  }
});

router.put('/settings/label-template', async (req, res) => {
  try {
    if (req.user?.access?.setting?.write === false) return res.status(403).json({ type: 'error', message: 'Unauthorized.' });
    const filter = scope(req);
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    const serialized = JSON.stringify(body);
    if (serialized.length > 2 * 1024 * 1024) return res.status(413).json({ type: 'error', message: 'Label template is too large (maximum 2 MB).' });
    const width = Number(body.width), height = Number(body.height), copies = Number(body.copies || 1);
    if (!Number.isFinite(width) || width < 15 || width > 210 || !Number.isFinite(height) || height < 15 || height > 1500 || !Number.isInteger(copies) || copies < 1 || copies > 999) {
      return res.status(400).json({ type: 'error', message: 'Label dimensions or copy count are outside supported limits.' });
    }
    let elements;
    if (body.elements !== undefined) {
      if (!Array.isArray(body.elements) || body.elements.length > 100) return res.status(400).json({ type: 'error', message: 'A label template may contain at most 100 design objects.' });
      elements = body.elements.map((element, index) => {
        if (!element || typeof element !== 'object' || Array.isArray(element)) throw new Error('Invalid label design object at position ' + (index + 1) + '.');
        const item = { ...element, id: String(element.id || 'label-object-' + (index + 1)).slice(0, 100), type: String(element.type || 'custom').slice(0, 40) };
        for (const key of ['x', 'y', 'w', 'h', 'rotation', 'fontSize']) {
          if (item[key] === undefined) continue;
          const number = Number(item[key]);
          if (!Number.isFinite(number) || Math.abs(number) > 10000) throw new Error('Invalid ' + key + ' value in label design object ' + (index + 1) + '.');
          item[key] = number;
        }
        return item;
      });
    }
    const labelTemplate = {
      ...body,
      width,
      height,
      copies,
      showName: body.showName !== false,
      showPrice: body.showPrice !== false,
      showBarcode: body.showBarcode !== false,
      ...(elements ? { elements } : {}),
      updatedAt: new Date(),
    };
    await ensureIndex(req);
    await collection(req).updateOne(filter, { $set: { labelTemplate, updated_at: new Date() }, $setOnInsert: { created_at: new Date() } }, { upsert: true });
    return res.json({ type: 'success', data: labelTemplate, message: 'Label template saved.' });
  } catch (error) {
    return res.status(error.status || 500).json({ type: 'error', message: error.message || 'Could not save label template.' });
  }
});

router.get('/settings/receipt-template', async (req, res) => {
  try {
    const filter = scope(req);
    await ensureIndex(req);
    const row = await collection(req).findOne(filter, { projection: { receiptTemplate: 1 } });
    return res.json({ type: 'success', data: row?.receiptTemplate || { version: 12, width: 80, format: 'thermal', blocks: [] } });
  } catch (error) {
    return res.status(error.status || 500).json({ type: 'error', message: error.message || 'Could not read receipt settings.' });
  }
});

router.put('/settings/receipt-template', async (req, res) => {
  try {
    if (req.user?.access?.setting?.write === false) return res.status(403).json({ type: 'error', message: 'Unauthorized.' });
    const filter = scope(req);
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    const serialized = JSON.stringify(body);
    if (serialized.length > 9 * 1024 * 1024) return res.status(413).json({ type: 'error', message: 'Receipt template is too large (maximum 9 MB).' });
    if (!Array.isArray(body.blocks) || body.blocks.length > 100) return res.status(400).json({ type: 'error', message: 'A receipt template must contain at most 100 blocks.' });
    const width = Number(body.width);
    if (![58, 80].includes(width)) return res.status(400).json({ type: 'error', message: 'Receipt paper width must be 58 or 80 mm.' });
    const blocks = body.blocks.map((block, index) => {
      if (!block || typeof block !== 'object' || Array.isArray(block)) throw new Error('Invalid receipt block at position ' + (index + 1) + '.');
      const normalized = { ...block, id: String(block.id || 'receipt-block-' + (index + 1)).slice(0, 100), type: String(block.type || 'text').slice(0, 40) };
      for (const key of ['fontSize', 'topSpace', 'bottomSpace', 'spacingTop', 'spacingBottom', 'logoWidth', 'logoMaxHeight']) {
        if (normalized[key] === undefined) continue;
        const value = Number(normalized[key]);
        if (!Number.isFinite(value) || Math.abs(value) > 10000) throw new Error('Invalid ' + key + ' in receipt block ' + (index + 1) + '.');
        normalized[key] = value;
      }
      return normalized;
    });
    const receiptTemplate = { ...body, version: 12, width, blocks, updatedAt: new Date() };
    await ensureIndex(req);
    await collection(req).updateOne(filter, { $set: { receiptTemplate, updated_at: new Date() }, $setOnInsert: { created_at: new Date() } }, { upsert: true });
    return res.json({ type: 'success', data: receiptTemplate, message: 'Receipt template saved.' });
  } catch (error) {
    return res.status(error.status || 500).json({ type: 'error', message: error.message || 'Could not save receipt template.' });
  }
});

module.exports = router;
