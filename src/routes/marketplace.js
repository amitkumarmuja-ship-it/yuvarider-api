const router = require('express').Router();
const ctrl   = require('../controllers/marketplaceController');
const auth   = require('../middleware/auth');

// NOTE: /my must be declared BEFORE /:id so Express matches it correctly
router.get ('/my',            auth, ctrl.getMyListings);
router.get ('/',                    ctrl.getListings);
router.get ('/:id',                 ctrl.getListingById);
router.post('/',              auth, ctrl.createListing);
router.put ('/:id',           auth, ctrl.updateListing);
router.delete('/:id',         auth, ctrl.deleteListing);
router.post('/:id/mark-sold', auth, ctrl.markSold);

module.exports = router;
