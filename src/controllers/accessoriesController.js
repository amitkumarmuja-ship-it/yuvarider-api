/**
 * src/controllers/accessoriesController.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Full accessory CRUD + image management.
 * Supports:
 *   - multi-photo  (image_urls TEXT[])
 *   - single receipt image (receipt_url TEXT)
 *   - upload endpoints that call shared /api/v1/uploads internally
 *
 * Routes (see routes/accessories.js):
 *   GET    /api/v1/accessories
 *   GET    /api/v1/accessories/:id
 *   POST   /api/v1/accessories
 *   PUT    /api/v1/accessories/:id
 *   DELETE /api/v1/accessories/:id
 *   POST   /api/v1/accessories/:id/images           (add product photo)
 *   DELETE /api/v1/accessories/:id/images           (remove product photo)
 *   POST   /api/v1/accessories/:id/receipt          (set receipt image)
 *   DELETE /api/v1/accessories/:id/receipt          (clear receipt)
 *   POST   /api/v1/accessories/upload/receipt       (upload receipt file → url)
 *   POST   /api/v1/accessories/upload/photo         (upload product photo file → url)
 */
'use strict';
const pool    = require('../config/db');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const { v4: uuidv4 } = require('uuid');
const { cloudinary, isConfigured: cloudinaryConfigured } = require('../config/cloudinary');

// ── Upload helpers (mirrors uploadRoutes.js) ──────────────────────────────────
const ALLOWED_TYPES = ['image/jpeg','image/jpg','image/png','image/webp','image/heic','image/heif'];
const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE, 10) || 5 * 1024 * 1024;
const UPLOAD_DIR    = process.env.UPLOAD_DIR || 'uploads';
const uploadPath    = path.resolve(process.cwd(), UPLOAD_DIR);
if (!fs.existsSync(uploadPath)) fs.mkdirSync(uploadPath, { recursive: true });

const storage = cloudinaryConfigured
  ? multer.memoryStorage()
  : multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, uploadPath),
      filename:    (_req,  file, cb) => cb(null, `${uuidv4()}${path.extname(file.originalname).toLowerCase() || '.jpg'}`),
    });

const uploader = multer({
  storage,
  limits:     { fileSize: MAX_FILE_SIZE, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_TYPES.includes(file.mimetype)) return cb(null, true);
    cb(new Error(`Invalid file type "${file.mimetype}". Allowed: jpeg, png, webp.`));
  },
});

async function uploadBufferToCloudinary(buffer) {
  return new Promise((resolve, reject) => {
    const publicId = `bikerapp/${uuidv4()}`;
    const stream   = cloudinary.uploader.upload_stream(
      { public_id: publicId, resource_type: 'image', format: 'jpg',
        transformation: [{ width: 1280, height: 960, crop: 'limit' }, { quality: 'auto:good' }],
        overwrite: false },
      (err, result) => { if (err) return reject(err); resolve(result); }
    );
    const { Readable } = require('stream');
    const readable = new Readable();
    readable.push(buffer);
    readable.push(null);
    readable.pipe(stream);
  });
}

// ── POST /api/v1/accessories/upload/receipt ────────────────────────────────────
// POST /api/v1/accessories/upload/photo
// Uploads a file and returns { success, url } — used by the frontend before create/update.
exports.uploadFile = [
  uploader.single('file'),
  async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file received. Use field name "file".' });
    }
    try {
      let url;
      if (cloudinaryConfigured) {
        const result = await uploadBufferToCloudinary(req.file.buffer, req.file.mimetype);
        url = result.secure_url;
      } else {
        url = `/uploads/${req.file.filename}`;
      }
      return res.status(200).json({ success: true, url });
    } catch (err) {
      console.error('[accessories/upload] error:', err.message);
      return res.status(500).json({ success: false, message: `Upload failed: ${err.message}` });
    }
  },
];

// ── GET /api/v1/accessories ───────────────────────────────────────────────────
exports.getAccessories = async (req, res, next) => {
  try {
    const { type } = req.query;
    let where  = 'WHERE a.user_id=$1';
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
      accessories:      r.rows.map(normalise),
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

    res.json({ success: true, accessory: normalise(r.rows[0]) });
  } catch (err) { next(err); }
};

// ── POST /api/v1/accessories ──────────────────────────────────────────────────
exports.createAccessory = async (req, res, next) => {
  try {
    const {
      vehicle_id, name, brand, type, price, purchase_date,
      size, color, store, emoji, bike_name,
      image_url, image_urls, receipt_url, notes,
    } = req.body;

    if (!name)
      return res.status(400).json({ success: false, message: 'name is required' });

    const resolvedEmoji = emoji || TYPE_EMOJI[type] || '📦';
    const imgUrls = Array.isArray(image_urls) ? image_urls : [];

    const r = await pool.query(`
      INSERT INTO accessories
        (user_id, vehicle_id, name, brand, type, price, purchase_date,
         size, color, store, emoji, bike_name, image_url, image_urls, receipt_url, notes)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
      RETURNING *
    `, [
      req.user.id, vehicle_id||null, name.trim(), brand||null,
      type||'Other', price ? parseFloat(price) : null, purchase_date||null,
      size||null, color||null, store||null, resolvedEmoji,
      bike_name||null, image_url||null, imgUrls, receipt_url||null, notes||null,
    ]);

    res.status(201).json({ success: true, accessory: normalise(r.rows[0]) });
  } catch (err) { next(err); }
};

// ── PUT /api/v1/accessories/:id ───────────────────────────────────────────────
exports.updateAccessory = async (req, res, next) => {
  try {
    const {
      vehicle_id, name, brand, type, price, purchase_date,
      size, color, store, emoji, bike_name,
      image_url, image_urls, receipt_url, notes,
    } = req.body;

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
        receipt_url   = COALESCE($14, receipt_url),
        notes         = COALESCE($15, notes),
        updated_at    = NOW()
      WHERE id=$16 AND user_id=$17
      RETURNING *
    `, [
      vehicle_id||null, name||null, brand||null, type||null,
      price ? parseFloat(price) : null, purchase_date||null,
      size||null, color||null, store||null, emoji||null,
      bike_name||null, image_url||null,
      imgUrls || null,
      receipt_url||null, notes||null,
      req.params.id, req.user.id,
    ]);

    if (!r.rows.length)
      return res.status(404).json({ success: false, message: 'Accessory not found' });

    res.json({ success: true, accessory: normalise(r.rows[0]) });
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

// ── POST /api/v1/accessories/:id/images ───────────────────────────────────────
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

    res.json({ success: true, accessory: normalise(r.rows[0]) });
  } catch (err) { next(err); }
};

// ── DELETE /api/v1/accessories/:id/images ────────────────────────────────────
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

    res.json({ success: true, accessory: normalise(r.rows[0]) });
  } catch (err) { next(err); }
};

// ── POST /api/v1/accessories/:id/receipt ──────────────────────────────────────
// Set the receipt_url for an existing accessory
exports.setReceipt = async (req, res, next) => {
  try {
    const { receipt_url } = req.body;
    if (!receipt_url)
      return res.status(400).json({ success: false, message: 'receipt_url is required' });

    const r = await pool.query(`
      UPDATE accessories
      SET receipt_url = $1, updated_at = NOW()
      WHERE id = $2 AND user_id = $3
      RETURNING *
    `, [receipt_url, req.params.id, req.user.id]);

    if (!r.rows.length)
      return res.status(404).json({ success: false, message: 'Accessory not found' });

    res.json({ success: true, accessory: normalise(r.rows[0]) });
  } catch (err) { next(err); }
};

// ── DELETE /api/v1/accessories/:id/receipt ────────────────────────────────────
exports.clearReceipt = async (req, res, next) => {
  try {
    const r = await pool.query(`
      UPDATE accessories
      SET receipt_url = NULL, updated_at = NOW()
      WHERE id = $1 AND user_id = $2
      RETURNING *
    `, [req.params.id, req.user.id]);

    if (!r.rows.length)
      return res.status(404).json({ success: false, message: 'Accessory not found' });

    res.json({ success: true, accessory: normalise(r.rows[0]) });
  } catch (err) { next(err); }
};

// ── Helpers ───────────────────────────────────────────────────────────────────
const TYPE_EMOJI = {
  Helmet:'🪖', Jacket:'🧥', Gloves:'🧤', Boots:'🥾',
  Balaclava:'🧣', 'Riding Bag':'🎒', Goggles:'🥽',
  Guards:'🛡️', 'Bike Accessories':'🔧', Other:'📦',
};

/** Normalise a DB row — ensure image_urls is always an array */
function normalise(row) {
  if (!row) return row;
  if (!row.image_urls) row.image_urls = [];
  return row;
}
