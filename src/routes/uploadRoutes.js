/**
 * src/routes/uploadRoutes.js
 *
 * POST   /api/v1/uploads          — upload a cover photo
 * DELETE /api/v1/uploads/:id      — delete a previously uploaded image
 *
 * ── Storage strategy ──────────────────────────────────────────────────────────
 * PRODUCTION (Cloudinary configured):
 *   Image is uploaded to Cloudinary → permanent CDN URL returned.
 *   Response: { success, filename: "bikerapp/uuid", url: "https://res.cloudinary.com/..." }
 *   The frontend stores the full Cloudinary URL as cover_photo / cover_photo_name.
 *
 * LOCAL DEV (no Cloudinary env vars):
 *   Image saved to local /uploads/ directory (existing behaviour).
 *   Response: { success, filename: "uuid.jpg", url: "/uploads/uuid.jpg" }
 *
 * ── Frontend usage (unchanged) ────────────────────────────────────────────────
 *   POST /api/v1/uploads  →  { filename, url }
 *   Store `url` as cover_photo / cover_photo_name in DB.
 *   coverPhotoUrl() in rides.ts detects full https URLs and returns them as-is.
 *
 * ── Auth ──────────────────────────────────────────────────────────────────────
 *   JWT verified inline (no dependency on internal middleware path).
 */

'use strict';

const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const jwt     = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { cloudinary, isConfigured: cloudinaryConfigured } = require('../config/cloudinary');

// ── Allowed image MIME types ───────────────────────────────────────────────────
const ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE, 10) || 5 * 1024 * 1024; // 5 MB

// ── Local disk fallback (development) ─────────────────────────────────────────
const UPLOAD_DIR  = process.env.UPLOAD_DIR || 'uploads';
const uploadPath  = path.resolve(process.cwd(), UPLOAD_DIR);
if (!fs.existsSync(uploadPath)) fs.mkdirSync(uploadPath, { recursive: true });

// ── Multer: memory storage for Cloudinary, disk for local dev ─────────────────
const storage = cloudinaryConfigured
  ? multer.memoryStorage()
  : multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, uploadPath),
      filename:    (_req,  file, cb) => cb(null, `${uuidv4()}${path.extname(file.originalname).toLowerCase() || '.jpg'}`),
    });

const upload = multer({
  storage,
  limits:     { fileSize: MAX_FILE_SIZE, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_TYPES.includes(file.mimetype)) return cb(null, true);
    cb(new Error(`Invalid file type "${file.mimetype}". Allowed: jpeg, png, webp.`));
  },
});

// ── Inline JWT auth ────────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  const header = req.headers['authorization'] || req.headers['Authorization'] || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
  if (!token)
    return res.status(401).json({ success: false, message: 'Authorization header missing.' });
  const secret = process.env.JWT_SECRET;
  if (!secret)
    return res.status(500).json({ success: false, message: 'Server misconfiguration: JWT_SECRET not set.' });
  try {
    req.user = jwt.verify(token, secret);
    next();
  } catch (err) {
    return res.status(401).json({
      success: false,
      message: err.name === 'TokenExpiredError' ? 'Token expired. Please log in again.' : 'Invalid token.',
    });
  }
}

// ── Helper: upload buffer to Cloudinary ───────────────────────────────────────
async function uploadToCloudinary(buffer, mimeType) {
  return new Promise((resolve, reject) => {
    const publicId = `bikerapp/${uuidv4()}`;
    const stream   = cloudinary.uploader.upload_stream(
      {
        public_id:       publicId,
        folder:          'bikerapp',
        resource_type:   'image',
        format:          'jpg',        // normalise all uploads to jpg
        transformation:  [
          { width: 1280, height: 960, crop: 'limit' }, // max size
          { quality: 'auto:good'  },                   // auto quality
          { fetch_format: 'auto'  },                   // serve webp to browsers that support it
        ],
        overwrite: false,
      },
      (err, result) => {
        if (err) return reject(err);
        resolve(result);
      }
    );
    // Convert buffer to stream
    const { Readable } = require('stream');
    const readable = new Readable();
    readable.push(buffer);
    readable.push(null);
    readable.pipe(stream);
  });
}

// ── POST /api/v1/uploads ──────────────────────────────────────────────────────
router.post('/', requireAuth, upload.single('file'), async (req, res) => {
  if (req.fileValidationError) {
    return res.status(400).json({ success: false, message: req.fileValidationError });
  }
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'No file received. Send a file with field name "file".' });
  }

  try {
    if (cloudinaryConfigured) {
      // ── PRODUCTION: upload to Cloudinary ────────────────────────────────────
      const result = await uploadToCloudinary(req.file.buffer, req.file.mimetype);

      const fullUrl  = result.secure_url;   // https://res.cloudinary.com/...
      const publicId = result.public_id;    // bikerapp/uuid

      console.log(`[upload] Cloudinary: ${req.user?.id || '?'} → ${fullUrl} (${Math.round(req.file.size / 1024)} KB)`);

      // Return the full URL as filename — frontend stores it directly.
      // coverPhotoUrl() detects https:// and returns it as-is (no /uploads/ prefix needed).
      return res.status(200).json({
        success:  true,
        filename: fullUrl,      // ← full Cloudinary URL stored as cover_photo / cover_photo_name
        url:      fullUrl,      // ← same
        public_id: publicId,    // ← for future deletion
      });
    } else {
      // ── LOCAL DEV: file already saved to disk by diskStorage ───────────────
      const filename = req.file.filename;
      const url      = `/uploads/${filename}`;

      console.log(`[upload] Local disk: ${req.user?.id || '?'} → ${filename} (${Math.round(req.file.size / 1024)} KB)`);

      return res.status(200).json({
        success:  true,
        filename,
        url,
      });
    }
  } catch (err) {
    console.error('[upload] Error:', err.message);
    return res.status(500).json({ success: false, message: `Upload failed: ${err.message}` });
  }
});

// ── Handle multer errors (file size, wrong field, etc.) ───────────────────────
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE')
      return res.status(400).json({ success: false, message: `File too large. Maximum size is ${Math.round(MAX_FILE_SIZE / 1024 / 1024)} MB.` });
    if (err.code === 'LIMIT_UNEXPECTED_FILE')
      return res.status(400).json({ success: false, message: 'Unexpected field. Use "file" as the field name.' });
    return res.status(400).json({ success: false, message: err.message });
  }
  if (err && err.message) return res.status(400).json({ success: false, message: err.message });
  next(err);
});

// ── DELETE /api/v1/uploads/:id ────────────────────────────────────────────────
// Works for both Cloudinary public_ids and local filenames
router.delete('/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  if (!id) return res.status(400).json({ success: false, message: 'Missing id.' });

  try {
    if (cloudinaryConfigured) {
      // id should be the Cloudinary public_id e.g. "bikerapp/uuid"
      const safeId = decodeURIComponent(id);
      await cloudinary.uploader.destroy(safeId, { resource_type: 'image' });
      console.log(`[upload] Cloudinary deleted: ${safeId}`);
      return res.json({ success: true, message: 'Image deleted.' });
    } else {
      // Local fallback — id is the filename
      const filename = id;
      if (filename.includes('/') || filename.includes('..'))
        return res.status(400).json({ success: false, message: 'Invalid filename.' });
      const filePath = path.join(uploadPath, filename);
      if (!fs.existsSync(filePath))
        return res.status(404).json({ success: false, message: 'File not found.' });
      fs.unlinkSync(filePath);
      console.log(`[upload] Local deleted: ${filename}`);
      return res.json({ success: true, message: 'File deleted.' });
    }
  } catch (err) {
    console.error('[upload] Delete error:', err.message);
    return res.status(500).json({ success: false, message: 'Could not delete image.' });
  }
});

module.exports = router;
