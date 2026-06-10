/**
 * src/controllers/marketplaceController.js
 * ─────────────────────────────────────────────────────────────────────────────
 * SELLER-CONFIRMS PURCHASE FLOW
 *
 *  BUYER flow:
 *   POST /:id/request-purchase   → buyer submits interest (status: pending)
 *   DELETE /:id/request-purchase → buyer withdraws their request
 *   GET  /requests/my            → buyer sees all their own requests + status
 *
 *  SELLER flow:
 *   GET  /:id/requests           → seller sees all pending requests
 *   POST /:id/requests/:reqId/accept  → seller accepts → listing=sold
 *   POST /:id/requests/:reqId/reject  → seller rejects one buyer
 *
 *  NEW COLUMNS: mrp, is_featured, is_hot_deal, seller_rating
 * ─────────────────────────────────────────────────────────────────────────────
 */
'use strict';
const pool = require('../config/db');

// ── Shared seller SELECT fragment ─────────────────────────────────────────────
const SELLER_FIELDS = `
  u.name        AS seller_name,
  u.phone       AS seller_phone,
  u.avatar_url  AS seller_avatar,
  u.location    AS seller_location
`;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// LISTINGS
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
    if (search)    {
      params.push(`%${search}%`);
      where += ` AND (ml.title ILIKE $${params.length} OR ml.description ILIKE $${params.length})`;
    }

    const countRes = await pool.query(
      `SELECT COUNT(*) FROM marketplace_listings ml ${where}`, params
    );
    params.push(parseInt(limit), offset);
    const r = await pool.query(`
      SELECT ml.*,
             ${SELLER_FIELDS},
             COALESCE(ml.seller_rating, 4.5) AS seller_rating
      FROM marketplace_listings ml
      JOIN users u ON u.id = ml.seller_id
      ${where}
      ORDER BY ml.is_featured DESC, ml.is_hot_deal DESC, ml.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params);
    res.json({
      success: true,
      total:   parseInt(countRes.rows[0].count),
      page:    parseInt(page),
      limit:   parseInt(limit),
      listings: r.rows,
    });
  } catch (err) { next(err); }
};

// GET /marketplace/my  (seller: own listings)
exports.getMyListings = async (req, res, next) => {
  try {
    const r = await pool.query(`
      SELECT ml.*,
             u.name AS seller_name, u.avatar_url AS seller_avatar,
             COALESCE(ml.seller_rating, 4.5) AS seller_rating,
             -- Chat count: number of buyer conversations via marketplace_chats
             COALESCE(chat_counts.chat_count, 0)::int AS pending_requests,
             COALESCE(chat_counts.chat_count, 0)::int AS total_requests,
             buyer.name        AS buyer_name,
             buyer.phone       AS buyer_phone,
             buyer.avatar_url  AS buyer_avatar,
             buyer.location    AS buyer_location,
             mp.purchased_at,
             mp.price_at_purchase
      FROM marketplace_listings ml
      JOIN users u ON u.id = ml.seller_id
      LEFT JOIN (
        SELECT listing_id,
               COUNT(*) AS chat_count
        FROM public.marketplace_chats
        WHERE seller_id = $1
        GROUP BY listing_id
      ) chat_counts ON chat_counts.listing_id = ml.id
      LEFT JOIN marketplace_purchases mp ON mp.listing_id = ml.id
      LEFT JOIN users buyer ON buyer.id = mp.buyer_id
      WHERE ml.seller_id = $1
      ORDER BY ml.created_at DESC
    `, [req.user.id]);
    res.json({ success: true, listings: r.rows });
  } catch (err) { next(err); }
};

// GET /marketplace/:id
exports.getListingById = async (req, res, next) => {
  try {
    await pool.query(
      `UPDATE marketplace_listings SET view_count=view_count+1 WHERE id=$1`,
      [req.params.id]
    );
    const r = await pool.query(`
      SELECT ml.*,
             ${SELLER_FIELDS},
             COALESCE(ml.seller_rating, 4.5) AS seller_rating,
             COALESCE(rv.review_count, 0)::int AS seller_review_count,
             COALESCE(rv.avg_rating, ml.seller_rating, 4.5) AS seller_avg_rating
      FROM marketplace_listings ml
      JOIN users u ON u.id = ml.seller_id
      LEFT JOIN (
        SELECT seller_id,
               COUNT(*)              AS review_count,
               ROUND(AVG(rating),1)  AS avg_rating
        FROM seller_reviews
        GROUP BY seller_id
      ) rv ON rv.seller_id = ml.seller_id
      WHERE ml.id = $1
    `, [req.params.id]);
    if (!r.rows.length)
      return res.status(404).json({ success: false, message: 'Listing not found' });
    res.json({ success: true, listing: r.rows[0] });
  } catch (err) { next(err); }
};

// POST /marketplace
exports.createListing = async (req, res, next) => {
  try {
    const {
      title, description, price, mrp, condition, category, location, contact_pref,
      brand, model, year, km_driven, fuel_type, transmission, owners,
      gear_type, gear_size, gender, certification, part_type, compatible_bikes,
      image_urls, is_featured, is_hot_deal,
    } = req.body;
    if (!title || !price)
      return res.status(400).json({ success: false, message: 'title and price are required' });
    const r = await pool.query(`
      INSERT INTO marketplace_listings (
        seller_id, title, description, price, mrp, condition, category,
        location, contact_pref, brand, model, year, km_driven, fuel_type,
        transmission, owners, gear_type, gear_size, gender, certification,
        part_type, compatible_bikes, image_urls, is_featured, is_hot_deal
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
                $17,$18,$19,$20,$21,$22,$23,$24,$25)
      RETURNING *
    `, [
      req.user.id, title, description||null, price, mrp||null,
      condition||null, category||null, location||null,
      contact_pref||'Chat Only', brand||null, model||null,
      year||null, km_driven||null, fuel_type||null, transmission||null,
      owners||null, gear_type||null, gear_size||null, gender||null,
      certification||null, part_type||null, compatible_bikes||null,
      image_urls||[], is_featured||false, is_hot_deal||false,
    ]);
    res.status(201).json({ success: true, listing: r.rows[0] });
  } catch (err) { next(err); }
};

// PUT /marketplace/:id  — SOLD items cannot be edited
exports.updateListing = async (req, res, next) => {
  try {
    const l = await pool.query(
      'SELECT seller_id, status FROM marketplace_listings WHERE id=$1',
      [req.params.id]
    );
    if (!l.rows.length)
      return res.status(404).json({ success: false, message: 'Listing not found' });
    if (l.rows[0].seller_id !== req.user.id)
      return res.status(403).json({ success: false, message: 'Not authorised' });
    if (l.rows[0].status === 'sold')
      return res.status(400).json({ success: false, message: 'Sold listings cannot be edited.' });

    const {
      title, description, price, mrp, condition, category, location, contact_pref, status,
      brand, model, year, km_driven, fuel_type, transmission, owners,
      gear_type, gear_size, gender, certification, part_type, compatible_bikes,
      image_urls, is_featured, is_hot_deal,
    } = req.body;
    // image_urls: Array.isArray check is REQUIRED — [] is falsy in JS so
    // `image_urls || null` would wrongly pass null and COALESCE would keep old photos.
    // We always replace image_urls when the client sends an array (even empty).
    const imageUrlsParam = Array.isArray(image_urls) ? image_urls : null;

    // mrp: client sends explicit `null` to clear it, `undefined` means don't touch.
    // The body parser gives us undefined when not sent, null when sent as null.
    const mrpParam = (mrp !== undefined) ? (mrp || null) : undefined;

    const r = await pool.query(`
      UPDATE marketplace_listings SET
        title          = COALESCE($1,  title),
        description    = COALESCE($2,  description),
        price          = COALESCE($3,  price),
        mrp            = CASE WHEN $4::boolean THEN $5::numeric ELSE mrp END,
        condition      = COALESCE($6,  condition),
        category       = COALESCE($7,  category),
        location       = COALESCE($8,  location),
        contact_pref   = COALESCE($9,  contact_pref),
        status         = COALESCE($10, status),
        brand          = COALESCE($11, brand),
        model          = COALESCE($12, model),
        year           = COALESCE($13, year),
        km_driven      = COALESCE($14, km_driven),
        fuel_type      = COALESCE($15, fuel_type),
        transmission   = COALESCE($16, transmission),
        owners         = COALESCE($17, owners),
        gear_type      = COALESCE($18, gear_type),
        gear_size      = COALESCE($19, gear_size),
        gender         = COALESCE($20, gender),
        certification  = COALESCE($21, certification),
        part_type      = COALESCE($22, part_type),
        compatible_bikes = COALESCE($23, compatible_bikes),
        image_urls     = CASE WHEN $24::boolean THEN $25 ELSE image_urls END,
        is_featured    = COALESCE($26, is_featured),
        is_hot_deal    = COALESCE($27, is_hot_deal),
        updated_at     = NOW()
      WHERE id = $28
      RETURNING *
    `, [
      title        || null,
      description  || null,
      price        || null,
      // mrp: $4=shouldUpdate (bool), $5=value
      mrp !== undefined,        // $4
      mrp != null ? mrp : null, // $5
      condition    || null,
      category     || null,
      location     || null,
      contact_pref || null,
      status       || null,
      brand        || null,
      model        || null,
      year         || null,
      km_driven    || null,
      fuel_type    || null,
      transmission || null,
      owners       || null,
      gear_type    || null,
      gear_size    || null,
      gender       || null,
      certification || null,
      part_type    || null,
      compatible_bikes || null,
      // image_urls: $24=shouldUpdate (bool), $25=array value
      imageUrlsParam !== null,  // $24
      imageUrlsParam || [],     // $25
      is_featured != null ? is_featured : null,
      is_hot_deal != null ? is_hot_deal : null,
      req.params.id,
    ]);
    res.json({ success: true, listing: r.rows[0] });
  } catch (err) { next(err); }
};

// DELETE /marketplace/:id
exports.deleteListing = async (req, res, next) => {
  try {
    const l = await pool.query(
      'SELECT seller_id, status FROM marketplace_listings WHERE id=$1',
      [req.params.id]
    );
    if (!l.rows.length)
      return res.status(404).json({ success: false, message: 'Listing not found' });
    if (l.rows[0].seller_id !== req.user.id)
      return res.status(403).json({ success: false, message: 'Not authorised' });
    if (l.rows[0].status === 'sold')
      return res.status(400).json({ success: false, message: 'Sold listings cannot be deleted.' });
    await pool.query(`DELETE FROM marketplace_listings WHERE id=$1`, [req.params.id]);
    res.json({ success: true, message: 'Listing deleted' });
  } catch (err) { next(err); }
};

// POST /marketplace/:id/mark-sold
exports.markSold = async (req, res, next) => {
  try {
    const r = await pool.query(
      `UPDATE marketplace_listings SET status='sold', updated_at=NOW()
       WHERE id=$1 AND seller_id=$2 RETURNING id`,
      [req.params.id, req.user.id]
    );
    if (!r.rows.length)
      return res.status(404).json({ success: false, message: 'Listing not found or not authorised' });
    await pool.query(
      `UPDATE marketplace_purchase_requests SET status='rejected', updated_at=NOW()
       WHERE listing_id=$1 AND status='pending'`,
      [req.params.id]
    );
    res.json({ success: true, message: 'Listing marked as sold' });
  } catch (err) { next(err); }
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PURCHASE REQUEST FLOW
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// POST /:id/request-purchase  (BUYER)
exports.requestPurchase = async (req, res, next) => {
  try {
    const listing = await pool.query(
      `SELECT id, seller_id, status FROM marketplace_listings WHERE id=$1`,
      [req.params.id]
    );
    if (!listing.rows.length)
      return res.status(404).json({ success: false, message: 'Listing not found' });
    if (listing.rows[0].status !== 'active')
      return res.status(400).json({ success: false, message: 'This listing is no longer active' });
    if (listing.rows[0].seller_id === req.user.id)
      return res.status(400).json({ success: false, message: 'Cannot request your own listing' });

    const existing = await pool.query(
      `SELECT id, status FROM marketplace_purchase_requests WHERE listing_id=$1 AND buyer_id=$2`,
      [req.params.id, req.user.id]
    );
    if (existing.rows.length) {
      const s = existing.rows[0].status;
      if (s === 'pending')
        return res.status(400).json({ success: false, message: 'You already have a pending request' });
      if (s === 'accepted')
        return res.status(400).json({ success: false, message: 'Your request was already accepted' });
      // rejected — allow re-request
      await pool.query(
        `UPDATE marketplace_purchase_requests SET status='pending', message=$1, updated_at=NOW()
         WHERE id=$2`,
        [req.body.message||null, existing.rows[0].id]
      );
      const updated = await pool.query(
        `SELECT * FROM marketplace_purchase_requests WHERE id=$1`, [existing.rows[0].id]
      );
      return res.json({ success: true, message: 'Purchase request sent', request: updated.rows[0] });
    }

    const r = await pool.query(
      `INSERT INTO marketplace_purchase_requests (listing_id, buyer_id, message)
       VALUES ($1, $2, $3) RETURNING *`,
      [req.params.id, req.user.id, req.body.message||null]
    );
    res.json({ success: true, message: 'Purchase request sent', request: r.rows[0] });
  } catch (err) { next(err); }
};

// DELETE /:id/request-purchase  (BUYER withdraws)
exports.withdrawRequest = async (req, res, next) => {
  try {
    const r = await pool.query(
      `UPDATE marketplace_purchase_requests SET status='rejected', updated_at=NOW()
       WHERE listing_id=$1 AND buyer_id=$2 AND status='pending' RETURNING id`,
      [req.params.id, req.user.id]
    );
    if (!r.rows.length)
      return res.status(404).json({ success: false, message: 'No pending request found' });
    res.json({ success: true, message: 'Request withdrawn' });
  } catch (err) { next(err); }
};

// GET /:id/my-request  (BUYER checks own request for one listing)
exports.getMyRequestForListing = async (req, res, next) => {
  try {
    const r = await pool.query(
      `SELECT * FROM marketplace_purchase_requests WHERE listing_id=$1 AND buyer_id=$2`,
      [req.params.id, req.user.id]
    );
    res.json({ success: true, request: r.rows[0] || null });
  } catch (err) { next(err); }
};

// GET /requests/my  (BUYER: all their requests)
exports.getMyRequests = async (req, res, next) => {
  try {
    const r = await pool.query(`
      SELECT mpr.*,
             ml.title, ml.price, ml.mrp, ml.category, ml.condition,
             ml.image_urls, ml.is_featured, ml.is_hot_deal,
             ml.location AS listing_location, ml.status AS listing_status,
             ${SELLER_FIELDS},
             COALESCE(ml.seller_rating, 4.5) AS seller_rating
      FROM marketplace_purchase_requests mpr
      JOIN marketplace_listings ml ON ml.id = mpr.listing_id
      JOIN users u ON u.id = ml.seller_id
      WHERE mpr.buyer_id = $1
      ORDER BY mpr.updated_at DESC
    `, [req.user.id]);
    res.json({ success: true, requests: r.rows });
  } catch (err) { next(err); }
};

// GET /:id/requests  (SELLER: see all buyers for their listing)
exports.getListingRequests = async (req, res, next) => {
  try {
    const l = await pool.query(
      'SELECT seller_id FROM marketplace_listings WHERE id=$1', [req.params.id]
    );
    if (!l.rows.length)
      return res.status(404).json({ success: false, message: 'Listing not found' });
    if (l.rows[0].seller_id !== req.user.id)
      return res.status(403).json({ success: false, message: 'Not authorised' });

    const r = await pool.query(`
      SELECT mpr.*,
             u.name AS buyer_name, u.phone AS buyer_phone,
             u.avatar_url AS buyer_avatar, u.location AS buyer_location
      FROM marketplace_purchase_requests mpr
      JOIN users u ON u.id = mpr.buyer_id
      WHERE mpr.listing_id = $1
      ORDER BY mpr.created_at DESC
    `, [req.params.id]);
    res.json({ success: true, requests: r.rows });
  } catch (err) { next(err); }
};

// POST /:id/requests/:reqId/accept  (SELLER confirms sale)
exports.acceptRequest = async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const l = await client.query(
      `SELECT id, seller_id, status, price, title FROM marketplace_listings WHERE id=$1`,
      [req.params.id]
    );
    if (!l.rows.length) throw new Error('Listing not found');
    const listing = l.rows[0];
    if (listing.seller_id !== req.user.id) {
      await client.query('ROLLBACK');
      return res.status(403).json({ success: false, message: 'Not authorised' });
    }
    if (listing.status === 'sold') {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: 'Listing already sold' });
    }

    const req_ = await client.query(
      `SELECT id, buyer_id, status FROM marketplace_purchase_requests WHERE id=$1 AND listing_id=$2`,
      [req.params.reqId, req.params.id]
    );
    if (!req_.rows.length) throw new Error('Request not found');
    if (req_.rows[0].status !== 'pending') {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: 'Request already actioned' });
    }
    const acceptedBuyerId = req_.rows[0].buyer_id;

    // 1. Accept this request
    await client.query(
      `UPDATE marketplace_purchase_requests SET status='accepted', updated_at=NOW()
       WHERE id=$1`, [req.params.reqId]
    );
    // 2. Reject all others
    await client.query(
      `UPDATE marketplace_purchase_requests SET status='rejected', updated_at=NOW()
       WHERE listing_id=$1 AND id<>$2 AND status='pending'`,
      [req.params.id, req.params.reqId]
    );
    // 3. Mark listing sold
    await client.query(
      `UPDATE marketplace_listings SET status='sold', updated_at=NOW() WHERE id=$1`,
      [req.params.id]
    );
    // 4. Record purchase
    await client.query(
      `INSERT INTO marketplace_purchases
         (listing_id, buyer_id, seller_id, price_at_purchase, title_at_purchase, request_id)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
      [req.params.id, acceptedBuyerId, req.user.id, listing.price, listing.title, req.params.reqId]
    );

    await client.query('COMMIT');

    const buyerRes = await pool.query('SELECT name, phone FROM users WHERE id=$1', [acceptedBuyerId]);
    const buyer = buyerRes.rows[0] || {};
    res.json({
      success: true,
      message: `Sale confirmed! ${buyer.name || 'Buyer'} will contact you.`,
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

// POST /:id/requests/:reqId/reject  (SELLER declines a buyer)
exports.rejectRequest = async (req, res, next) => {
  try {
    const l = await pool.query(
      'SELECT seller_id FROM marketplace_listings WHERE id=$1', [req.params.id]
    );
    if (!l.rows.length)
      return res.status(404).json({ success: false, message: 'Listing not found' });
    if (l.rows[0].seller_id !== req.user.id)
      return res.status(403).json({ success: false, message: 'Not authorised' });

    const r = await pool.query(
      `UPDATE marketplace_purchase_requests SET status='rejected', updated_at=NOW()
       WHERE id=$1 AND listing_id=$2 AND status='pending' RETURNING id`,
      [req.params.reqId, req.params.id]
    );
    if (!r.rows.length)
      return res.status(404).json({ success: false, message: 'Request not found or already actioned' });
    res.json({ success: true, message: 'Request rejected' });
  } catch (err) { next(err); }
};

// GET /purchases/my  (buyer: purchase history — compat)
exports.getMyPurchases = async (req, res, next) => {
  try {
    const r = await pool.query(`
      SELECT mp.*, ml.image_urls, ml.category, ml.condition, ml.brand, ml.model,
             ml.location, ml.mrp, ml.is_featured, ml.is_hot_deal,
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

// POST /marketplace/:id/relist  — seller re-activates a sold listing
exports.relistListing = async (req, res, next) => {
  try {
    const l = await pool.query(
      'SELECT seller_id, status FROM marketplace_listings WHERE id=$1',
      [req.params.id]
    );
    if (!l.rows.length)
      return res.status(404).json({ success: false, message: 'Listing not found' });
    if (l.rows[0].seller_id !== req.user.id)
      return res.status(403).json({ success: false, message: 'Not authorised' });

    const r = await pool.query(
      `UPDATE marketplace_listings
         SET status='active', updated_at=NOW()
       WHERE id=$1 AND seller_id=$2
       RETURNING id, status`,
      [req.params.id, req.user.id]
    );
    if (!r.rows.length)
      return res.status(404).json({ success: false, message: 'Listing not found' });

    res.json({ success: true, message: 'Listing re-activated successfully', listing: r.rows[0] });
  } catch (err) { next(err); }
};
