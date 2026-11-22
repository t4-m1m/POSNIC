const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
router.use(protect);
router.get('/', async (req, res) => {
  try {
    if (!req.db) return res.status(500).json({ type: 'error', message: 'Shop database is unavailable.' });
    const rows = await req.db.collection('brands').find({}).sort({ name: 1, fullName: 1 }).limit(2000).toArray();
    const data = rows.map(row => ({ ...row, _id: String(row._id), name: String(row.fullName || row.full_name || row.name || row.label || row.abbreviation || row.code || '').trim(), fullName: String(row.fullName || row.full_name || row.name || row.label || '').trim(), abbreviation: String(row.abbreviation || row.brand_abbreviation || row.code || row.brand_code || '').trim() }));
    return res.json({ type: 'success', data });
  } catch (error) {
    console.error('[brands] list', error);
    return res.status(500).json({ type: 'error', message: 'Unable to load brands.' });
  }
});
module.exports = router;
