// src/routes/auth.js  — ADD the /search endpoint for role assignment

const router = require('express').Router();
const ctrl   = require('../controllers/authController');
const rides  = require('../controllers/ridesController');
const auth   = require('../middleware/auth');

router.post('/register', ctrl.register);
router.post('/login',    ctrl.login);
router.get ('/me',       auth, ctrl.me);
router.put ('/me',       auth, ctrl.updateMe);

// NEW: user search for AssignRoles step in CreateRideScreen
// GET /api/v1/auth/users/search?q=name
router.get('/users/search', auth, rides.searchUsers);

module.exports = router;
