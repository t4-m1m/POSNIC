const express = require('express');
const router = express.Router();
const expensesController = require('../controllers/expenses.controller');
const { protect } = require('../middleware/auth');
const { validateExpense, validateId } = require('../middleware/validation');
const { ObjectId } = require('mongodb');

// Apply authentication middleware to all routes
router.use(protect);

const attachments = require('../controllers/expense-attachments.controller');
router.get('/:id/attachments', attachments.handler('list'));
router.get('/:id/attachments/:attId', attachments.handler('read'));
router.post('/:id/attachments', attachments.handler('add'));
router.delete('/:id/attachments/:attId', attachments.handler('remove'));

// GET /api/expenses - Get all expenses with pagination
router.get('/', (req, res) => expensesController.getAll(req, res));

// Legacy report route that frontend still requests under /expenses
router.get('/expensesReportTable', (req, res) => expensesController.expensesReportTable(req, res));

// PHP: getDataChanges() - Data sync
router.get('/getDataChanges', (req, res) => expensesController.getDataChanges(req, res));

// PHP: expensesImport() - Bulk import
router.post('/expensesImport', (req, res) => expensesController.expensesImport(req, res));

// PHP: exportExpenses() - Excel export
router.post('/exportExpenses', (req, res) => expensesController.exportExpenses(req, res));

// PHP: getExpenseDetails() - Get expense details
router.get('/getExpenseDetails', (req, res) => expensesController.getExpenseDetails(req, res));

// GET /api/expenses/summary - Get expense summary
router.get('/summary', (req, res) => expensesController.getSummary(req, res));

// GET /api/expenses/category/:category - Get expenses by category
router.get('/category/:category', (req, res) => expensesController.getByCategory(req, res));

// GET /api/expenses/type/:type - Get expenses by type
router.get('/type/:type', (req, res) => expensesController.getByType(req, res));

// GET /api/expenses/:id - Get expense by ID (with ObjectId validation)
router.get('/:id', validateId, (req, res) => expensesController.getOne(req, res));

// Authenticated cashier quick expense; saved in the same expenses ledger.
router.post('/quick', async (req, res) => {
  try {
    await expensesController.ensureContext(req);
    const body = req.body || {}, value = Number(body.amount), reason = String(body.reason || '').trim();
    if (!Number.isFinite(value) || value <= 0 || value > 1e12)
      return res.status(400).json({ status: false, message: 'Saisissez un montant valide.' });
    if (!reason || reason.length > 255)
      return res.status(400).json({ status: false, message: 'Saisissez la raison de la dépense (255 caractères maximum).' });
    const user = expensesController.user || {}, branch = expensesController.branch;
    const result = await expensesController.service.createExpense({
      amount: Math.round((value + Number.EPSILON) * 100) / 100,
      type: 'Dépense rapide', category: 'Dépense rapide', description: reason, date: new Date(),
      branch_id: branch && ObjectId.isValid(String(branch)) ? new ObjectId(String(branch)) : branch,
      branch_name: expensesController.branchName || '',
      created_by: user.username || user.name || user.email || 'system',
      created_by_id: user._id && ObjectId.isValid(String(user._id)) ? new ObjectId(String(user._id)) : null
    });
    if (!result.status) return res.status(400).json({ status: false, message: result.message || 'Dépense non enregistrée.' });
    return res.status(201).json({ status: true, data: result.data, message: 'Dépense enregistrée.' });
  } catch (error) {
    return res.status(error.status || 500).json({ status: false, message: error.message || 'Dépense non enregistrée.' });
  }
});

// POST /api/expenses - Create new expense
router.post('/', validateExpense, (req, res) => expensesController.create(req, res));

// PUT /api/expenses/:id - Update expense
router.put('/:id', validateId, validateExpense, (req, res) => expensesController.update(req, res));

// DELETE /api/expenses/delete - Legacy bulk delete endpoint used by frontend
router.delete('/delete', (req, res) => expensesController.delete(req, res));

// DELETE /api/expenses - Bulk delete (alternate form, kept for API consistency)
router.delete('/', (req, res) => expensesController.delete(req, res));

module.exports = router;
