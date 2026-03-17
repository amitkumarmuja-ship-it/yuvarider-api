const router = require('express').Router();
const ctrl   = require('../controllers/expensesController');
const auth   = require('../middleware/auth');

router.get('/summary', auth, ctrl.getStats);
router.get('/',        auth, ctrl.getExpenses);
router.get('/:id',     auth, ctrl.getExpenseById);
router.post('/',       auth, ctrl.createExpense);
router.put('/:id',     auth, ctrl.updateExpense);
router.delete('/:id',  auth, ctrl.deleteExpense);

module.exports = router;