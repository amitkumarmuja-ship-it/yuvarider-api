/**
 * src/routes/master.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Master-data routes (accessory categories & brands).
 * Mounted at /api/v1/master in server.js.
 *
 * Add in server.js:
 *   app.use('/api/v1/master', require('./routes/master'));
 */
const router = require('express').Router();
const ctrl   = require('../controllers/masterController');
const auth   = require('../middleware/auth');   // optional — protect if needed

// Both endpoints work without auth so the category/brand lists
// load on the Add Accessory screen before the user picks anything.
// Add `auth,` before `ctrl.xxx` if you want them JWT-protected.
router.get('/accessory-categories', auth, ctrl.getAccessoryCategories);
router.get('/accessory-brands',     auth, ctrl.getAccessoryBrands);

module.exports = router;
