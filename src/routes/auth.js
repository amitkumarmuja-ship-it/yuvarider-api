const router = require('express').Router();
const ctrl   = require('../controllers/authController');
const auth   = require('../middleware/auth');

router.post('/register', ctrl.register);
router.post('/login',    ctrl.login);
router.get ('/me',       auth, ctrl.me);
router.put ('/me',       auth, ctrl.updateMe);

module.exports = router;
