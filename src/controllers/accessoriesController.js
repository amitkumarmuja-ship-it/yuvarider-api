/**
 * accessoriesController.js — Updated for AccessoryDetail redesign
 * Supports multi-photo (image_urls TEXT[]) and single invoice image_url
 */
'use strict';
const pool = require('../config/db');

const VALID_TYPES = [
  'Helmet','Jacket','Gloves','Boots','Balaclava',
  'Riding Bag','Goggles','Guards','Bike Accessories',
  'Pants','Other',
];

const TYPE_EMOJI = {
  Helmet:'🪖', Jacket:'🧥', Gloves:'🧤', Boots:'🥾',
  Balaclava:'🧣', 'Riding Bag':'🎒', Goggles:'🥽',
  Guards:'🛡️', 'Bike Accessories':'🔧', Pants:'👖', Other:'📦',
};

// ── GET /api/v1/accessories ───────────────────────────────────────────────────
exports.getAccessories = async (req, res, next) => {
  try {
    const { type } = req.query;
    let where = 'WHERE a.user_id=$1';
    const params = [req.user.id];

    if (type) { where += ` AND a.type=$${params.length + 1}`; params.push(type); }

    const totalRes = await pool.query(`
      SELECT COALESCE(SUM(price), 0) AS total_investment, COUNT(*) AS total_count
      FROM accessories a ${where}
    `, params);

    const r = await pool.query(`
      SELECT a.*, v.name AS vehicle_name, v.nickname AS vehicle_nickname
      FROM accessories a
      LEFT JOIN vehicles v ON v.id = a.vehicle_id
      ${where}
      ORDER BY a.created_at DESC
    `, params);

    res.json({
      success:          true,
      total_investment: parseFloat(totalRes.rows[0].total_investment),
      total_count:      parseInt(totalRes.rows[0].total_count),
      accessories:      r.rows,
    });
  } catch (err) { next(err); }
};

// ── GET /api/v1/accessories/:id ───────────────────────────────────────────────
exports.getAccessoryById = async (req, res, next) => {
  try {
    const r = await pool.query(`
      SELECT a.*, v.name AS vehicle_name, v.nickname AS vehicle_nickname
      FROM accessories a
      LEFT JOIN vehicles v ON v.id = a.vehicle_id
      WHERE a.id=$1 AND a.user_id=$2
    `, [req.params.id, req.user.id]);

    if (!r.rows.length)
      return res.status(404).json({ success: false, message: 'Accessory not found' });

    // Ensure image_urls is always an array
    const acc = r.rows[0];
    if (!acc.image_urls) acc.image_urls = [];
    res.json({ success: true, accessory: acc });
  } catch (err) { next(err); }
};

// ── POST /api/v1/accessories ──────────────────────────────────────────────────
exports.createAccessory = async (req, res, next) => {
  try {
    const {
      vehicle_id, name, brand, type, price, purchase_date,
      size, color, store, emoji, bike_name, image_url, image_urls, notes,
    } = req.body;

    if (!name)
      return res.status(400).json({ success: false, message: 'name is required' });

    const resolvedEmoji = emoji || TYPE_EMOJI[type] || '📦';
    // Ensure image_urls is a valid Postgres array string or null
    const imgUrls = Array.isArray(image_urls) ? image_urls : [];

    const r = await pool.query(`
      INSERT INTO accessories
        (user_id, vehicle_id, name, brand, type, price, purchase_date,
         size, color, store, emoji, bike_name, image_url, image_urls, notes)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      RETURNING *
    `, [
      req.user.id, vehicle_id||null, name.trim(), brand||null,
      type||'Other', price ? parseFloat(price) : null, purchase_date||null,
      size||null, color||null, store||null, resolvedEmoji,
      bike_name||null, image_url||null, imgUrls, notes||null,
    ]);

    if (!r.rows[0].image_urls) r.rows[0].image_urls = [];
    res.status(201).json({ success: true, accessory: r.rows[0] });
  } catch (err) { next(err); }
};

// ── PUT /api/v1/accessories/:id ───────────────────────────────────────────────
exports.updateAccessory = async (req, res, next) => {
  try {
    const {
      vehicle_id, name, brand, type, price, purchase_date,
      size, color, store, emoji, bike_name, image_url, image_urls, notes,
    } = req.body;

    // Build image_urls array update if provided
    const imgUrls = Array.isArray(image_urls) ? image_urls : undefined;

    const r = await pool.query(`
      UPDATE accessories SET
        vehicle_id    = COALESCE($1,  vehicle_id),
        name          = COALESCE($2,  name),
        brand         = COALESCE($3,  brand),
        type          = COALESCE($4,  type),
        price         = COALESCE($5,  price),
        purchase_date = COALESCE($6,  purchase_date),
        size          = COALESCE($7,  size),
        color         = COALESCE($8,  color),
        store         = COALESCE($9,  store),
        emoji         = COALESCE($10, emoji),
        bike_name     = COALESCE($11, bike_name),
        image_url     = COALESCE($12, image_url),
        image_urls    = CASE WHEN $13::text[] IS NOT NULL THEN $13::text[] ELSE image_urls END,
        notes         = COALESCE($14, notes),
        updated_at    = NOW()
      WHERE id=$15 AND user_id=$16
      RETURNING *
    `, [
      vehicle_id||null, name||null, brand||null, type||null,
      price ? parseFloat(price) : null, purchase_date||null,
      size||null, color||null, store||null, emoji||null,
      bike_name||null, image_url||null,
      imgUrls || null,
      notes||null,
      req.params.id, req.user.id,
    ]);

    if (!r.rows.length)
      return res.status(404).json({ success: false, message: 'Accessory not found' });

    if (!r.rows[0].image_urls) r.rows[0].image_urls = [];
    res.json({ success: true, accessory: r.rows[0] });
  } catch (err) { next(err); }
};

// ── DELETE /api/v1/accessories/:id ────────────────────────────────────────────
exports.deleteAccessory = async (req, res, next) => {
  try {
    const r = await pool.query(
      `DELETE FROM accessories WHERE id=$1 AND user_id=$2 RETURNING id`,
      [req.params.id, req.user.id],
    );
    if (!r.rows.length)
      return res.status(404).json({ success: false, message: 'Accessory not found' });
    res.json({ success: true, message: 'Accessory deleted' });
  } catch (err) { next(err); }
};

// ── POST /api/v1/accessories/:id/images ──────────────────────────────────────
// Add a photo URL to the accessory's image_urls array
exports.addImage = async (req, res, next) => {
  try {
    const { image_url } = req.body;
    if (!image_url)
      return res.status(400).json({ success: false, message: 'image_url is required' });

    const r = await pool.query(`
      UPDATE accessories
      SET image_urls = array_append(COALESCE(image_urls, '{}'), $1), updated_at = NOW()
      WHERE id = $2 AND user_id = $3
      RETURNING *
    `, [image_url, req.params.id, req.user.id]);

    if (!r.rows.length)
      return res.status(404).json({ success: false, message: 'Accessory not found' });

    if (!r.rows[0].image_urls) r.rows[0].image_urls = [];
    res.json({ success: true, accessory: r.rows[0] });
  } catch (err) { next(err); }
};

// ── DELETE /api/v1/accessories/:id/images ────────────────────────────────────
// Remove a specific image from image_urls array
exports.removeImage = async (req, res, next) => {
  try {
    const { image_url } = req.body;
    if (!image_url)
      return res.status(400).json({ success: false, message: 'image_url is required' });

    const r = await pool.query(`
      UPDATE accessories
      SET image_urls = array_remove(COALESCE(image_urls, '{}'), $1), updated_at = NOW()
      WHERE id = $2 AND user_id = $3
      RETURNING *
    `, [image_url, req.params.id, req.user.id]);

    if (!r.rows.length)
      return res.status(404).json({ success: false, message: 'Accessory not found' });

    if (!r.rows[0].image_urls) r.rows[0].image_urls = [];
    res.json({ success: true, accessory: r.rows[0] });
  } catch (err) { next(err); }
};
