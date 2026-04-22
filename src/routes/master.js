/**
 * src/routes/master.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Master-data routes.
 * Mounted at /api/v1/master in server.js.
 *
 * ORIGINAL routes (accessories — unchanged):
 *   GET /api/v1/master/accessory-categories
 *   GET /api/v1/master/accessory-brands?category_id=<id>
 *
 * NEW routes (marketplace form options):
 *   GET /api/v1/master/marketplace-options
 *       All options grouped by group_key — fetched once on screen load.
 *
 *   GET /api/v1/master/marketplace-options/:group
 *       Options for a specific group (e.g. /marketplace-options/fuel_type)
 *
 * Auth: all endpoints require a valid JWT (add auth middleware).
 *       Remove `auth,` to make them public if needed.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const router = require('express').Router();
const ctrl   = require('../controllers/masterController');
const auth   = require('../middleware/auth');

// ── Accessory master data (existing) ──────────────────────────────────────────
router.get('/accessory-categories', auth, ctrl.getAccessoryCategories);
router.get('/accessory-brands',     auth, ctrl.getAccessoryBrands);

// ── Marketplace form options (NEW) ────────────────────────────────────────────
// IMPORTANT: specific route (/marketplace-options) MUST come before
// the parameterised route (/marketplace-options/:group) in Express.
router.get('/marketplace-options',        auth, ctrl.getMarketplaceOptions);
router.get('/marketplace-options/:group', auth, ctrl.getMarketplaceOptionsByGroup);

module.exports = router;
