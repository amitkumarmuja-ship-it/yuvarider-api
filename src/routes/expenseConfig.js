/**
 * routes/expenseConfig.js
 * GET /api/v1/expense-config — returns dynamic categories & payment methods
 */
const router = require('express').Router();
const ctrl   = require('../controllers/expenseConfigController');
const auth   = require('../middleware/auth');

router.get('/', auth, ctrl.getExpenseConfig);   // GET /api/v1/expense-config

module.exports = router;
