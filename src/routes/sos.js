const router = require('express').Router();
const ctrl   = require('../controllers/sosController');
const auth   = require('../middleware/auth');

// Fix: route was calling ctrl.sendSOS and ctrl.getMySOS
// but controller exports triggerSOS and myAlerts
router.post('/',             auth, ctrl.triggerSOS);
router.get ('/my',           auth, ctrl.myAlerts);
router.put ('/:id/resolve',  auth, ctrl.resolveSOS);

module.exports = router;
