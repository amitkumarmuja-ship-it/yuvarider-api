/**
 * src/controllers/marketplaceController.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Full CRUD for marketplace listings.
 *
 * CHANGE: updateListing now updates ALL fields (brand, model, fuel_type, etc.)
 *         not just the original 8 basic fields.
 * ─────────────────────────────────────────────────────────────────────────────
 */
'use strict';
const pool = require('../config/db');

// ── GET /api/v1/marketplace ────────────────────────────────────────────────────
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

    res.json({
      success: true,
      total: parseInt(countRes.rows[0].count),
      page: parseInt(page),
      limit: parseInt(limit),
      listings: r.rows,
    });
  } catch (err) { next(err); }
};

// ── GET /api/v1/marketplace/my ─────────────────────────────────────────────────
exports.getMyListings = async (req, res, next) => {
  try {
    const r = await pool.query(`
      SELECT ml.*, u.name AS seller_name, u.avatar_url AS seller_avatar
      FROM marketplace_listings ml
      JOIN users u ON u.id = ml.seller_id
      WHERE ml.seller_id = $1
      ORDER BY ml.created_at DESC
    `, [req.user.id]);
    res.json({ success: true, listings: r.rows });
  } catch (err) { next(err); }
};

// ── GET /api/v1/marketplace/:id ────────────────────────────────────────────────
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

// ── POST /api/v1/marketplace ───────────────────────────────────────────────────
exports.createListing = async (req, res, next) => {
  try {
    const {
      title, description, price, condition, category, location, contact_pref,
      brand, model, year, km_driven, fuel_type, transmission, owners,
      gear_type, gear_size, gender, certification, part_type, compatible_bikes, image_urls,
    } = req.body;

    if (!title || !price) {
      return res.status(400).json({ success: false, message: 'title and price are required' });
    }

    const r = await pool.query(`
      INSERT INTO marketplace_listings (
        seller_id, title, description, price, condition, category, location, contact_pref,
        brand, model, year, km_driven, fuel_type, transmission, owners,
        gear_type, gear_size, gender, certification, part_type, compatible_bikes, image_urls
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
      RETURNING *
    `, [
      req.user.id,
      title,
      description   || null,
      price,
      condition     || null,
      category      || null,
      location      || null,
      contact_pref  || 'Chat Only',
      brand         || null,
      model         || null,
      year          || null,
      km_driven     || null,
      fuel_type     || null,
      transmission  || null,
      owners        || null,
      gear_type     || null,
      gear_size     || null,
      gender        || null,
      certification || null,
      part_type     || null,
      compatible_bikes || null,
      image_urls    || [],
    ]);

    res.status(201).json({ success: true, listing: r.rows[0] });
  } catch (err) { next(err); }
};

// ── PUT /api/v1/marketplace/:id ────────────────────────────────────────────────
// UPDATED: Now updates ALL fields, not just the original 8.
exports.updateListing = async (req, res, next) => {
  try {
    // Ownership check
    const l = await pool.query(
      'SELECT seller_id FROM marketplace_listings WHERE id=$1',
      [req.params.id],
    );
    if (!l.rows.length) {
      return res.status(404).json({ success: false, message: 'Listing not found' });
    }
    if (l.rows[0].seller_id !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Not authorised' });
    }

    const {
      title, description, price, condition, category, location, contact_pref, status,
      brand, model, year, km_driven, fuel_type, transmission, owners,
      gear_type, gear_size, gender, certification, part_type, compatible_bikes, image_urls,
    } = req.body;

    const r = await pool.query(`
      UPDATE marketplace_listings SET
        title            = COALESCE($1,  title),
        description      = COALESCE($2,  description),
        price            = COALESCE($3,  price),
        condition        = COALESCE($4,  condition),
        category         = COALESCE($5,  category),
        location         = COALESCE($6,  location),
        contact_pref     = COALESCE($7,  contact_pref),
        status           = COALESCE($8,  status),
        brand            = COALESCE($9,  brand),
        model            = COALESCE($10, model),
        year             = COALESCE($11, year),
        km_driven        = COALESCE($12, km_driven),
        fuel_type        = COALESCE($13, fuel_type),
        transmission     = COALESCE($14, transmission),
        owners           = COALESCE($15, owners),
        gear_type        = COALESCE($16, gear_type),
        gear_size        = COALESCE($17, gear_size),
        gender           = COALESCE($18, gender),
        certification    = COALESCE($19, certification),
        part_type        = COALESCE($20, part_type),
        compatible_bikes = COALESCE($21, compatible_bikes),
        image_urls       = COALESCE($22, image_urls),
        updated_at       = NOW()
      WHERE id = $23
      RETURNING *
    `, [
      title         || null,
      description   || null,
      price         || null,
      condition     || null,
      category      || null,
      location      || null,
      contact_pref  || null,
      status        || null,
      brand         || null,
      model         || null,
      year          || null,
      km_driven     || null,
      fuel_type     || null,
      transmission  || null,
      owners        || null,
      gear_type     || null,
      gear_size     || null,
      gender        || null,
      certification || null,
      part_type     || null,
      compatible_bikes || null,
      image_urls    || null,
      req.params.id,
    ]);

    res.json({ success: true, listing: r.rows[0] });
  } catch (err) { next(err); }
};

// ── DELETE /api/v1/marketplace/:id ────────────────────────────────────────────
exports.deleteListing = async (req, res, next) => {
  try {
    const r = await pool.query(
      `DELETE FROM marketplace_listings WHERE id=$1 AND seller_id=$2 RETURNING id`,
      [req.params.id, req.user.id],
    );
    if (!r.rows.length) {
      return res.status(404).json({ success: false, message: 'Listing not found or not authorised' });
    }
    res.json({ success: true, message: 'Listing deleted' });
  } catch (err) { next(err); }
};

// ── POST /api/v1/marketplace/:id/mark-sold ────────────────────────────────────
exports.markSold = async (req, res, next) => {
  try {
    const r = await pool.query(
      `UPDATE marketplace_listings SET status='sold', updated_at=NOW()
       WHERE id=$1 AND seller_id=$2 RETURNING id`,
      [req.params.id, req.user.id],
    );
    if (!r.rows.length) {
      return res.status(404).json({ success: false, message: 'Listing not found or not authorised' });
    }
    res.json({ success: true, message: 'Listing marked as sold' });
  } catch (err) { next(err); }
};
