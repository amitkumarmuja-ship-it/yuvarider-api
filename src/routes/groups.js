/**
 * src/routes/groups.js
 * All group API routes — updated with new invite/contacts/delete endpoints
 * that support the new ShareGroup and InviteMembers screens.
 */
const router = require('express').Router();
const ctrl   = require('../controllers/groupsController');
const auth   = require('../middleware/auth');

// Optional auth — passes user if token present, continues without if not
const optAuth = (req, res, next) => {
  const h = req.headers.authorization;
  if (h && h.startsWith('Bearer ')) return auth(req, res, next);
  next();
};

// ── Groups CRUD ───────────────────────────────────────────────────────────────
router.get   ('/',     optAuth, ctrl.getGroups);     // list / search groups
router.post  ('/',     auth,    ctrl.createGroup);   // create group
router.get   ('/:id',  optAuth, ctrl.getGroupById);  // get group detail
router.put   ('/:id',  auth,    ctrl.updateGroup);   // update group (admin)
router.delete('/:id',  auth,    ctrl.deleteGroup);   // delete group (creator) ← NEW

// ── Membership ────────────────────────────────────────────────────────────────
router.post  ('/:id/join',                    auth, ctrl.joinGroup);       // join public group
router.post  ('/:id/request-join',            auth, ctrl.requestJoin);     // request private group
router.delete('/:id/leave',                   auth, ctrl.leaveGroup);      // leave group
router.delete('/:id/members/:userId',         auth, ctrl.removeMember);    // remove member (admin only)

// ── Join Requests (admin) ─────────────────────────────────────────────────────
router.get   ('/:id/join-requests',             auth, ctrl.getJoinRequests);      // list pending
router.put   ('/:id/join-requests/:reqId',      auth, ctrl.respondJoinRequest);   // approve/reject

// ── Invitations (NEW — for ShareGroup & InviteMembers screens) ────────────────
router.post  ('/:id/invite',   auth, ctrl.inviteMembers);          // invite by user_ids
router.get   ('/:id/contacts', auth, ctrl.getInvitableContacts);   // get invitable users

// ── Messages ──────────────────────────────────────────────────────────────────
router.get   ('/:id/messages', auth, ctrl.getMessages);   // get messages
router.post  ('/:id/messages', auth, ctrl.sendMessage);   // send message

// ── Rules ─────────────────────────────────────────────────────────────────────
router.get   ('/:id/rules',             optAuth, ctrl.getRules);    // list rules
router.post  ('/:id/rules',             auth,    ctrl.addRule);     // add rule
router.delete('/:id/rules/:ruleId',     auth,    ctrl.deleteRule);  // delete rule

module.exports = router;
