const router = require('express').Router();
const ctrl   = require('../controllers/groupsController');
const auth   = require('../middleware/auth');

router.get ('/',                      auth, ctrl.getGroups);
router.get ('/:id',                   auth, ctrl.getGroupById);
router.post('/',                      auth, ctrl.createGroup);
router.put ('/:id',                   auth, ctrl.updateGroup);
router.post('/:id/join',              auth, ctrl.joinGroup);
router.delete('/:id/leave',           auth, ctrl.leaveGroup);
router.get ('/:id/messages',          auth, ctrl.getMessages);
router.post('/:id/messages',          auth, ctrl.sendMessage);
router.get ('/:id/rules',             auth, ctrl.getRules);
router.post('/:id/rules',             auth, ctrl.addRule);
router.delete('/:id/rules/:ruleId',   auth, ctrl.deleteRule);

module.exports = router;
