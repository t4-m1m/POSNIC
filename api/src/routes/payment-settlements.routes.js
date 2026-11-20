const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const controller = require('../controllers/payment-settlements.controller');

router.use(protect);
router.get('/', controller.list);
router.post('/', controller.collect);

module.exports = router;
