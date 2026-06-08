const router = require('express').Router();
const ctrl   = require('../controllers/marketplaceController');
const chat   = require('../controllers/chatController');
const auth   = require('../middleware/auth');

// ── Chat routes ──────────────────────────────────────────────────────────────
router.get ('/chats',                       auth, chat.getMyChats);
router.post('/chats/get-or-create',         auth, chat.getOrCreateChat);
router.get ('/chats/:chatId/messages',      auth, chat.getMessages);
router.post('/chats/:chatId/messages',      auth, chat.sendMessage);
router.put ('/chats/:chatId/read',          auth, chat.markRead);

// ── Named sub-paths MUST come before /:id ────────────────────────────────────
router.get ('/requests/my',                 auth, ctrl.getMyRequests);         // buyer: all my requests
router.get ('/purchases/my',               auth, ctrl.getMyPurchases);         // buyer: purchase history (kept for compat)
router.get ('/my',                          auth, ctrl.getMyListings);          // seller: my listings
router.get ('/',                                  ctrl.getListings);            // public: browse

// ── Single listing ────────────────────────────────────────────────────────────
router.get ('/:id',                               ctrl.getListingById);
router.post('/',                            auth, ctrl.createListing);
router.put ('/:id',                         auth, ctrl.updateListing);          // blocked if sold
router.delete('/:id',                       auth, ctrl.deleteListing);          // blocked if sold
router.post('/:id/mark-sold',               auth, ctrl.markSold);              // seller manual
router.post('/:id/relist',                  auth, ctrl.relistListing);           // seller: re-activate sold listing

// ── Purchase request flow ─────────────────────────────────────────────────────
router.get ('/:id/my-request',              auth, ctrl.getMyRequestForListing); // buyer: check status
router.post('/:id/request-purchase',        auth, ctrl.requestPurchase);        // buyer: express interest
router.delete('/:id/request-purchase',      auth, ctrl.withdrawRequest);        // buyer: withdraw
router.get ('/:id/requests',                auth, ctrl.getListingRequests);     // seller: see all requests
router.post('/:id/requests/:reqId/accept',  auth, ctrl.acceptRequest);          // seller: confirm sale
router.post('/:id/requests/:reqId/reject',  auth, ctrl.rejectRequest);          // seller: decline

module.exports = router;
