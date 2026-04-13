/**
 * routes/accessories.js — Updated with image management routes
 */
const router = require('express').Router();
const ctrl   = require('../controllers/accessoriesController');
const auth   = require('../middleware/auth');

router.get   ('/',              auth, ctrl.getAccessories);
router.get   ('/:id',           auth, ctrl.getAccessoryById);
router.post  ('/',              auth, ctrl.createAccessory);
router.put   ('/:id',           auth, ctrl.updateAccessory);
router.delete('/:id',           auth, ctrl.deleteAccessory);
// Multi-photo management
router.post  ('/:id/images',    auth, ctrl.addImage);
router.delete('/:id/images',    auth, ctrl.removeImage);

module.exports = router;
