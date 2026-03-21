/**
 * src/routes/uploads.js  — FIXED (self-contained, no external auth dependency)
 *
 * POST /api/v1/uploads
 *   - Verifies JWT inline (reads JWT_SECRET from process.env)
 *   - Accepts multipart/form-data with field name "file"
 *   - Returns { success, filename, url, path, size }
 *
 * DELETE /api/v1/uploads/:filename
 *   - Deletes an uploaded file (optional cleanup)
 */

'use strict';

const express  = require('express');
const multer   = require('multer');
const path     = require('path');
const fs       = require('fs');
const jwt      = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const router = express.Router();

// ── Uploads directory ─────────────────────────────────────────────────────────
const UPLOAD_DIR    = process.env.UPLOAD_DIR || 'uploads';
const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE, 10) || 5 * 1024 * 1024;
const uploadPath    = path.resolve(process.cwd(), UPLOAD_DIR);

if (!fs.existsSync(uploadPath)) {
  fs.mkdirSync(uploadPath, { recursive: true });
}

// ── Multer config ─────────────────────────────────────────────────────────────
const ALLOWED = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadPath),
  filename:    (_req, file,  cb) => {
    const ext  = path.extname(file.originalname).toLowerCase() || '.jpg';
    cb(null, `${uuidv4()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits:     { fileSize: MAX_FILE_SIZE, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED.includes(file.mimetype)) return cb(null, true);
    cb(new Error(`Invalid file type "${file.mimetype}". Allowed: jpeg, png, webp.`));
  },
});

// ── Inline JWT auth middleware ─────────────────────────────────────────────────
// This avoids any dependency on your project's internal auth middleware path.
function verifyToken(req, res, next) {
  const authHeader = req.headers['authorization'] || req.headers['Authorization'] || '';
  const token      = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ success: false, message: 'No token provided.' });
  }

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    console.error('[uploads] JWT_SECRET is not set in .env');
    return res.status(500).json({ success: false, message: 'Server misconfiguration.' });
  }

  try {
    const decoded = jwt.verify(token, secret);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Invalid or expired token.' });
  }
}

// ── POST /api/v1/uploads ──────────────────────────────────────────────────────
router.post('/', verifyToken, (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({
            success: false,
            message: `File too large. Maximum size is ${Math.round(MAX_FILE_SIZE / 1024 / 1024)} MB.`,
          });
        }
        if (err.code === 'LIMIT_UNEXPECTED_FILE') {
          return res.status(400).json({
            success: false,
            message: 'Unexpected field. Use "file" as the field name.',
          });
        }
        return res.status(400).json({ success: false, message: err.message });
      }
      // fileFilter rejection
      return res.status(400).json({ success: false, message: err.message });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file received. Send a file with field name "file".',
      });
    }

    const { filename, size } = req.file;

    console.log(`[uploads] ${req.user?.id || 'user'} uploaded: ${filename} (${Math.round(size / 1024)} KB)`);

    return res.status(200).json({
      success:  true,
      filename,                          // "uuid.jpg"   → store as cover_photo_name
      url:      `/uploads/${filename}`,  // "/uploads/uuid.jpg"
      path:     `${UPLOAD_DIR}/${filename}`, // "uploads/uuid.jpg"
      size,
    });
  });
});

// ── DELETE /api/v1/uploads/:filename ─────────────────────────────────────────
router.delete('/:filename', verifyToken, (req, res) => {
  const { filename } = req.params;

  // Prevent path traversal
  if (!filename || filename.includes('/') || filename.includes('..') || filename.includes('\\')) {
    return res.status(400).json({ success: false, message: 'Invalid filename.' });
  }

  const filePath = path.join(uploadPath, filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ success: false, message: 'File not found.' });
  }

  try {
    fs.unlinkSync(filePath);
    return res.json({ success: true, message: 'File deleted.' });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Could not delete file.' });
  }
});

module.exports = router;
