/**
 * src/routes/accessories.js
 * ─────────────────────────────────────────────────────────────────────────────
 * All accessory routes including file upload for receipt and product photos.
 *
 * Mounted at: /api/v1/accessories   (in server.js)
 */
const router = require('express').Router();
const ctrl   = require('../controllers/accessoriesController');
const auth   = require('../middleware/auth');

// ── CRUD ──────────────────────────────────────────────────────────────────────
router.get   ('/',              auth, ctrl.getAccessories);
router.get   ('/:id',           auth, ctrl.getAccessoryById);
router.post  ('/',              auth, ctrl.createAccessory);
router.put   ('/:id',           auth, ctrl.updateAccessory);
router.delete('/:id',           auth, ctrl.deleteAccessory);

// ── Product photo management ──────────────────────────────────────────────────
router.post  ('/:id/images',    auth, ctrl.addImage);
router.delete('/:id/images',    auth, ctrl.removeImage);

// ── Receipt management ────────────────────────────────────────────────────────
router.post  ('/:id/receipt',   auth, ctrl.setReceipt);
router.delete('/:id/receipt',   auth, ctrl.clearReceipt);

// ── File upload endpoints (upload-then-create pattern) ────────────────────────
// Frontend calls these BEFORE create/update to get a URL, then passes the URL
// in the create/update body as receipt_url or inside image_urls array.
router.post  ('/upload/receipt', auth, ctrl.uploadFile);
router.post  ('/upload/photo',   auth, ctrl.uploadFile);

module.exports = router;
