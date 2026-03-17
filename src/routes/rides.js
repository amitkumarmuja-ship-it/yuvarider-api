const router = require('express').Router();
const ctrl   = require('../controllers/ridesController');
const auth   = require('../middleware/auth');

// ── optionalAuth ──────────────────────────────────────────────────────────────
// Passes req.user when a valid token is provided, but does NOT block the
// request when no token is present. Used for public-read endpoints.
const optionalAuth = (req, res, next) => {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    return auth(req, res, next);
  }
  next();
};

// ── Public read (works with OR without a token) ───────────────────────────────
router.get ('/',                         optionalAuth, ctrl.getRides);
router.get ('/:id',                      optionalAuth, ctrl.getRideById);
router.get ('/:id/participants',         auth,         ctrl.getParticipants);
router.get ('/:id/waypoints',            auth,         ctrl.getWaypoints);

// ── Protected write (always require a valid token) ────────────────────────────
router.post  ('/',                         auth, ctrl.createRide);
router.put   ('/:id',                      auth, ctrl.updateRide);
router.delete('/:id',                      auth, ctrl.deleteRide);
router.post  ('/:id/join',                 auth, ctrl.joinRide);
router.delete('/:id/leave',                auth, ctrl.leaveRide);          // NEW
router.post  ('/:id/clone',                auth, ctrl.cloneRide);
router.put   ('/:id/status',               auth, ctrl.updateStatus);
router.get   ('/:id/requests',             auth, ctrl.getRequests);
router.put   ('/:id/requests/:requestId',  auth, ctrl.respondRequest);
router.post  ('/:id/expenses',             auth, ctrl.addRideExpense);
router.post  ('/:id/favourite-location',   auth, ctrl.addFavouriteLocation);

module.exports = router;
