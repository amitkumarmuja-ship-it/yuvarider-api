/**
 * routes/expenses.js — all expense routes
 * NOTE: /summary must come before /:id to avoid "summary" being treated as an id
 */
const router = require('express').Router();
const ctrl   = require('../controllers/expensesController');
const auth   = require('../middleware/auth');

router.get   ('/summary', auth, ctrl.getStats);        // GET  /api/v1/expenses/summary
router.get   ('/',        auth, ctrl.getExpenses);      // GET  /api/v1/expenses
router.get   ('/:id',     auth, ctrl.getExpenseById);   // GET  /api/v1/expenses/:id
router.post  ('/',        auth, ctrl.createExpense);    // POST /api/v1/expenses
router.put   ('/:id',     auth, ctrl.updateExpense);    // PUT  /api/v1/expenses/:id
router.delete('/:id',     auth, ctrl.deleteExpense);    // DELETE /api/v1/expenses/:id

module.exports = router;
