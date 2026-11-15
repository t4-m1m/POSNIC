const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const controller = require('../controllers/stock-report.controller');
router.use(protect);
router.get('/', controller.read);
router.post('/settings', controller.read);
module.exports = router;
