/**
 * src/controllers/marketplaceController.js
 * ─────────────────────────────────────────────────────────────────────────────
 * SELLER-CONFIRMS PURCHASE FLOW
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  BUYER flow:
 *   POST /:id/request-purchase   → buyer submits interest (status: pending)
 *   DELETE /:id/request-purchase → buyer withdraws their request
 *   GET  /requests/my            → buyer sees all their own requests + status
 *
 *  SELLER flow:
 *   GET  /:id/requests           → seller sees all pending requests for their listing
 *   POST /:id/requests/:reqId/accept  → seller accepts one buyer → listing=sold, others=rejected
 *   POST /:id/requests/:reqId/reject  → seller rejects one buyer
 *
 *  LISTING RULES:
 *   - status=sold listings cannot be updated or deleted (blocked in updateListing)
 *   - Only seller can mark-sold / accept / reject
 *   - Buyer can only request once per listing
 * ─────────────────────────────────────────────────────────────────────────────
 */
'use strict';
const pool = require('../config/db');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// LISTINGS — existing endpoints (unchanged except sold-lock on update/delete)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// GET /marketplace
exports.getListings = async (req, res, next) => {
  try {
    const { category, condition, page = 1, limit = 20, search, location } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    let where = `WHERE ml.status='active'`;
    const params = [];
    if (category)  { params.push(category);        where += ` AND ml.category=$${params.length}`; }
    if (condition) { params.push(condition);        where += ` AND ml.condition=$${params.length}`; }
    if (location)  { params.push(`%${location}%`); where += ` AND ml.location ILIKE $${params.length}`; }
    if (search)    { params.push(`%${search}%`);   where += ` AND (ml.title ILIKE $${params.length} OR ml.description ILIKE $${params.length})`; }

    const countRes = await pool.query(`SELECT COUNT(*) FROM marketplace_listings ml ${where}`, params);
    params.push(parseInt(limit), offset);
    const r = await pool.query(`
      SELECT ml.*, u.name AS seller_name, u.phone AS seller_phone, u.avatar_url AS seller_avatar
      FROM marketplace_listings ml
      JOIN users u ON u.id = ml.seller_id
      ${where}
      ORDER BY ml.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params);
    res.json({ success: true, total: parseInt(countRes.rows[0].count), page: parseInt(page), limit: parseInt(limit), listings: r.rows });
  } catch (err) { next(err); }
};

// GET /marketplace/my
exports.getMyListings = async (req, res, next) => {
  try {
    // Also return pending request count per listing so seller sees them in the sell tab
    const r = await pool.query(`
      SELECT ml.*,
             u.name AS seller_name, u.avatar_url AS seller_avatar,
             COALESCE(req_counts.pending_count, 0)::int AS pending_requests
      FROM marketplace_listings ml
      JOIN users u ON u.id = ml.seller_id
      LEFT JOIN (
        SELECT listing_id, COUNT(*) AS pending_count
        FROM marketplace_purchase_requests
        WHERE status = 'pending'
        GROUP BY listing_id
      ) req_counts ON req_counts.listing_id = ml.id
      WHERE ml.seller_id = $1
      ORDER BY ml.created_at DESC
    `, [req.user.id]);
    res.json({ success: true, listings: r.rows });
  } catch (err) { next(err); }
};

// GET /marketplace/:id
exports.getListingById = async (req, res, next) => {
  try {
    await pool.query(`UPDATE marketplace_listings SET view_count=view_count+1 WHERE id=$1`, [req.params.id]);
    const r = await pool.query(`
      SELECT ml.*, u.name AS seller_name, u.phone AS seller_phone,
             u.avatar_url AS seller_avatar, u.location AS seller_location
      FROM marketplace_listings ml JOIN users u ON u.id=ml.seller_id WHERE ml.id=$1
    `, [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'Listing not found' });
    res.json({ success: true, listing: r.rows[0] });
  } catch (err) { next(err); }
};

// POST /marketplace
exports.createListing = async (req, res, next) => {
  try {
    const {
      title, description, price, condition, category, location, contact_pref,
      brand, model, year, km_driven, fuel_type, transmission, owners,
      gear_type, gear_size, gender, certification, part_type, compatible_bikes, image_urls,
    } = req.body;
    if (!title || !price) return res.status(400).json({ success: false, message: 'title and price are required' });
    const r = await pool.query(`
      INSERT INTO marketplace_listings (
        seller_id, title, description, price, condition, category, location, contact_pref,
        brand, model, year, km_driven, fuel_type, transmission, owners,
        gear_type, gear_size, gender, certification, part_type, compatible_bikes, image_urls
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
      RETURNING *
    `, [
      req.user.id, title, description||null, price, condition||null, category||null,
      location||null, contact_pref||'Chat Only', brand||null, model||null, year||null,
      km_driven||null, fuel_type||null, transmission||null, owners||null,
      gear_type||null, gear_size||null, gender||null, certification||null,
      part_type||null, compatible_bikes||null, image_urls||[],
    ]);
    res.status(201).json({ success: true, listing: r.rows[0] });
  } catch (err) { next(err); }
};

// PUT /marketplace/:id  — SOLD items cannot be edited
exports.updateListing = async (req, res, next) => {
  try {
    const l = await pool.query('SELECT seller_id, status FROM marketplace_listings WHERE id=$1', [req.params.id]);
    if (!l.rows.length) return res.status(404).json({ success: false, message: 'Listing not found' });
    if (l.rows[0].seller_id !== req.user.id) return res.status(403).json({ success: false, message: 'Not authorised' });
    // ── SOLD LOCK: sold items cannot be edited ──────────────────────────────
    if (l.rows[0].status === 'sold') {
      return res.status(400).json({ success: false, message: 'Sold listings cannot be edited or updated.' });
    }
    const {
      title, description, price, condition, category, location, contact_pref, status,
      brand, model, year, km_driven, fuel_type, transmission, owners,
      gear_type, gear_size, gender, certification, part_type, compatible_bikes, image_urls,
    } = req.body;
    const r = await pool.query(`
      UPDATE marketplace_listings SET
        title=$1, description=COALESCE($2,description), price=COALESCE($3,price),
        condition=COALESCE($4,condition), category=COALESCE($5,category),
        location=COALESCE($6,location), contact_pref=COALESCE($7,contact_pref),
        status=COALESCE($8,status), brand=COALESCE($9,brand), model=COALESCE($10,model),
        year=COALESCE($11,year), km_driven=COALESCE($12,km_driven),
        fuel_type=COALESCE($13,fuel_type), transmission=COALESCE($14,transmission),
        owners=COALESCE($15,owners), gear_type=COALESCE($16,gear_type),
        gear_size=COALESCE($17,gear_size), gender=COALESCE($18,gender),
        certification=COALESCE($19,certification), part_type=COALESCE($20,part_type),
        compatible_bikes=COALESCE($21,compatible_bikes), image_urls=COALESCE($22,image_urls),
        updated_at=NOW()
      WHERE id=$23 RETURNING *
    `, [
      title||null, description||null, price||null, condition||null, category||null,
      location||null, contact_pref||null, status||null, brand||null, model||null,
      year||null, km_driven||null, fuel_type||null, transmission||null, owners||null,
      gear_type||null, gear_size||null, gender||null, certification||null,
      part_type||null, compatible_bikes||null, image_urls||null, req.params.id,
    ]);
    res.json({ success: true, listing: r.rows[0] });
  } catch (err) { next(err); }
};

// DELETE /marketplace/:id — SOLD items cannot be deleted
exports.deleteListing = async (req, res, next) => {
  try {
    const l = await pool.query('SELECT seller_id, status FROM marketplace_listings WHERE id=$1', [req.params.id]);
    if (!l.rows.length) return res.status(404).json({ success: false, message: 'Listing not found' });
    if (l.rows[0].seller_id !== req.user.id) return res.status(403).json({ success: false, message: 'Not authorised' });
    if (l.rows[0].status === 'sold') {
      return res.status(400).json({ success: false, message: 'Sold listings cannot be deleted.' });
    }
    await pool.query(`DELETE FROM marketplace_listings WHERE id=$1`, [req.params.id]);
    res.json({ success: true, message: 'Listing deleted' });
  } catch (err) { next(err); }
};

// POST /marketplace/:id/mark-sold  (seller manually marks sold, no buyer)
exports.markSold = async (req, res, next) => {
  try {
    const r = await pool.query(
      `UPDATE marketplace_listings SET status='sold', updated_at=NOW()
       WHERE id=$1 AND seller_id=$2 RETURNING id`,
      [req.params.id, req.user.id],
    );
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'Listing not found or not authorised' });
    // Reject all pending requests since seller marked it sold manually
    await pool.query(
      `UPDATE marketplace_purchase_requests SET status='rejected', updated_at=NOW()
       WHERE listing_id=$1 AND status='pending'`,
      [req.params.id],
    );
    res.json({ success: true, message: 'Listing marked as sold' });
  } catch (err) { next(err); }
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PURCHASE REQUESTS — new endpoints
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// POST /marketplace/:id/request-purchase  (BUYER — express interest)
exports.requestPurchase = async (req, res, next) => {
  try {
    const listingRes = await pool.query(
      `SELECT id, seller_id, status, title, price FROM marketplace_listings WHERE id=$1`,
      [req.params.id],
    );
    if (!listingRes.rows.length) return res.status(404).json({ success: false, message: 'Listing not found' });
    const listing = listingRes.rows[0];

    if (listing.seller_id === req.user.id) {
      return res.status(400).json({ success: false, message: 'You cannot request to buy your own listing' });
    }
    if (listing.status !== 'active') {
      return res.status(400).json({ success: false, message: 'This listing is no longer available' });
    }

    // Upsert: if buyer already has a rejected request, allow re-requesting
    const r = await pool.query(`
      INSERT INTO marketplace_purchase_requests (listing_id, buyer_id, message, status)
      VALUES ($1, $2, $3, 'pending')
      ON CONFLICT (listing_id, buyer_id)
      DO UPDATE SET status='pending', message=EXCLUDED.message, updated_at=NOW()
      WHERE marketplace_purchase_requests.status = 'rejected'
      RETURNING *
    `, [listing.id, req.user.id, req.body.message || null]);

    if (!r.rows.length) {
      // Already has a pending request
      return res.status(400).json({ success: false, message: 'You have already sent a purchase request for this listing' });
    }

    res.status(201).json({ success: true, message: 'Purchase request sent! The seller will review and confirm.', request: r.rows[0] });
  } catch (err) { next(err); }
};

// DELETE /marketplace/:id/request-purchase  (BUYER — withdraw request)
exports.withdrawRequest = async (req, res, next) => {
  try {
    const r = await pool.query(
      `DELETE FROM marketplace_purchase_requests
       WHERE listing_id=$1 AND buyer_id=$2 AND status='pending'
       RETURNING id`,
      [req.params.id, req.user.id],
    );
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'No pending request found to withdraw' });
    res.json({ success: true, message: 'Request withdrawn' });
  } catch (err) { next(err); }
};

// GET /marketplace/:id/requests  (SELLER — see all requests for their listing)
exports.getListingRequests = async (req, res, next) => {
  try {
    // Verify ownership
    const l = await pool.query('SELECT seller_id FROM marketplace_listings WHERE id=$1', [req.params.id]);
    if (!l.rows.length) return res.status(404).json({ success: false, message: 'Listing not found' });
    if (l.rows[0].seller_id !== req.user.id) return res.status(403).json({ success: false, message: 'Not authorised' });

    const r = await pool.query(`
      SELECT mpr.*,
             u.name AS buyer_name, u.phone AS buyer_phone,
             u.avatar_url AS buyer_avatar, u.location AS buyer_location
      FROM marketplace_purchase_requests mpr
      JOIN users u ON u.id = mpr.buyer_id
      WHERE mpr.listing_id = $1
      ORDER BY
        CASE mpr.status WHEN 'pending' THEN 0 WHEN 'accepted' THEN 1 ELSE 2 END,
        mpr.created_at ASC
    `, [req.params.id]);

    res.json({ success: true, requests: r.rows });
  } catch (err) { next(err); }
};

// POST /marketplace/:id/requests/:reqId/accept  (SELLER — confirm sale to this buyer)
exports.acceptRequest = async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Verify listing ownership and active status
    const lRes = await client.query(
      'SELECT seller_id, status, title, price FROM marketplace_listings WHERE id=$1',
      [req.params.id],
    );
    if (!lRes.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, message: 'Listing not found' }); }
    const listing = lRes.rows[0];
    if (listing.seller_id !== req.user.id) { await client.query('ROLLBACK'); return res.status(403).json({ success: false, message: 'Not authorised' }); }
    if (listing.status === 'sold') { await client.query('ROLLBACK'); return res.status(400).json({ success: false, message: 'Listing is already sold' }); }

    // Verify the request exists and is pending
    const rRes = await client.query(
      `SELECT * FROM marketplace_purchase_requests WHERE id=$1 AND listing_id=$2`,
      [req.params.reqId, req.params.id],
    );
    if (!rRes.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, message: 'Request not found' }); }
    if (rRes.rows[0].status !== 'pending') { await client.query('ROLLBACK'); return res.status(400).json({ success: false, message: 'This request is no longer pending' }); }

    const acceptedBuyerId = rRes.rows[0].buyer_id;

    // 1. Accept this request
    await client.query(
      `UPDATE marketplace_purchase_requests SET status='accepted', updated_at=NOW() WHERE id=$1`,
      [req.params.reqId],
    );

    // 2. Reject all OTHER pending requests for this listing
    await client.query(
      `UPDATE marketplace_purchase_requests SET status='rejected', updated_at=NOW()
       WHERE listing_id=$1 AND id!=$2 AND status='pending'`,
      [req.params.id, req.params.reqId],
    );

    // 3. Mark listing as sold
    await client.query(
      `UPDATE marketplace_listings SET status='sold', updated_at=NOW() WHERE id=$1`,
      [req.params.id],
    );

    // 4. Record in purchase history
    await client.query(
      `INSERT INTO marketplace_purchases (listing_id, buyer_id, seller_id, price_at_purchase, title_at_purchase, request_id)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
      [req.params.id, acceptedBuyerId, req.user.id, listing.price, listing.title, req.params.reqId],
    );

    await client.query('COMMIT');

    // Fetch buyer info for response
    const buyerRes = await pool.query('SELECT name, phone FROM users WHERE id=$1', [acceptedBuyerId]);
    const buyer = buyerRes.rows[0] || {};

    res.json({
      success: true,
      message: `Sale confirmed! ${buyer.name || 'Buyer'} will contact you to arrange pickup.`,
      sale: {
        listing_id: req.params.id,
        buyer_id:   acceptedBuyerId,
        buyer_name: buyer.name,
        buyer_phone: buyer.phone,
        price:      listing.price,
        title:      listing.title,
      },
    });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
};

// POST /marketplace/:id/requests/:reqId/reject  (SELLER — decline a buyer)
exports.rejectRequest = async (req, res, next) => {
  try {
    const l = await pool.query('SELECT seller_id FROM marketplace_listings WHERE id=$1', [req.params.id]);
    if (!l.rows.length) return res.status(404).json({ success: false, message: 'Listing not found' });
    if (l.rows[0].seller_id !== req.user.id) return res.status(403).json({ success: false, message: 'Not authorised' });

    const r = await pool.query(
      `UPDATE marketplace_purchase_requests SET status='rejected', updated_at=NOW()
       WHERE id=$1 AND listing_id=$2 AND status='pending' RETURNING id`,
      [req.params.reqId, req.params.id],
    );
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'Request not found or already actioned' });
    res.json({ success: true, message: 'Request rejected' });
  } catch (err) { next(err); }
};

// GET /marketplace/requests/my  (BUYER — see their own request history)
exports.getMyRequests = async (req, res, next) => {
  try {
    const r = await pool.query(`
      SELECT mpr.*,
             ml.title, ml.price, ml.category, ml.condition, ml.image_urls,
             ml.location AS listing_location, ml.status AS listing_status,
             u.name AS seller_name, u.phone AS seller_phone, u.avatar_url AS seller_avatar
      FROM marketplace_purchase_requests mpr
      JOIN marketplace_listings ml ON ml.id = mpr.listing_id
      JOIN users u ON u.id = ml.seller_id
      WHERE mpr.buyer_id = $1
      ORDER BY mpr.updated_at DESC
    `, [req.user.id]);
    res.json({ success: true, requests: r.rows });
  } catch (err) { next(err); }
};

// GET /marketplace/:id/my-request  (BUYER — check their request status for ONE listing)
exports.getMyRequestForListing = async (req, res, next) => {
  try {
    const r = await pool.query(
      `SELECT * FROM marketplace_purchase_requests WHERE listing_id=$1 AND buyer_id=$2`,
      [req.params.id, req.user.id],
    );
    res.json({ success: true, request: r.rows[0] || null });
  } catch (err) { next(err); }
};

// GET /marketplace/purchases/my  (kept for backward compatibility)
exports.getMyPurchases = async (req, res, next) => {
  try {
    const r = await pool.query(`
      SELECT mp.*, ml.image_urls, ml.category, ml.condition, ml.brand, ml.model, ml.location,
             u.name AS seller_name, u.phone AS seller_phone, u.avatar_url AS seller_avatar
      FROM marketplace_purchases mp
      JOIN marketplace_listings ml ON ml.id = mp.listing_id
      JOIN users u ON u.id = mp.seller_id
      WHERE mp.buyer_id = $1
      ORDER BY mp.purchased_at DESC
    `, [req.user.id]);
    res.json({ success: true, purchases: r.rows });
  } catch (err) { next(err); }
};
