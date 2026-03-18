const router = require('express').Router();
const ctrl   = require('../controllers/groupsController');
const auth   = require('../middleware/auth');

const optAuth = (req, res, next) => {
  const h = req.headers.authorization;
  if (h && h.startsWith('Bearer ')) return auth(req, res, next);
  next();
};

router.get ('/',                              optAuth, ctrl.getGroups);
router.get ('/:id',                           optAuth, ctrl.getGroupById);
router.post('/',                              auth,    ctrl.createGroup);
router.put ('/:id',                           auth,    ctrl.updateGroup);
router.post('/:id/join',                      auth,    ctrl.joinGroup);
router.post('/:id/request-join',              auth,    ctrl.requestJoin);
router.delete('/:id/leave',                   auth,    ctrl.leaveGroup);
router.get ('/:id/join-requests',             auth,    ctrl.getJoinRequests);
router.put ('/:id/join-requests/:reqId',      auth,    ctrl.respondJoinRequest);
router.get ('/:id/messages',                  auth,    ctrl.getMessages);
router.post('/:id/messages',                  auth,    ctrl.sendMessage);
router.get ('/:id/rules',                     optAuth, ctrl.getRules);
router.post('/:id/rules',                     auth,    ctrl.addRule);
router.delete('/:id/rules/:ruleId',           auth,    ctrl.deleteRule);

module.exports = router;
