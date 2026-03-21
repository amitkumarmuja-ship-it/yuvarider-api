/**
 * src/middleware/uploadMiddleware.js
 *
 * Multer middleware for cover photo uploads.
 * Uses only packages already in your package.json:
 *   multer  ^1.4.5-lts.1
 *   uuid    ^9.0.1
 *
 * How it works:
 *   1. POST /api/v1/uploads   { file: <image> }   multipart/form-data
 *   2. multer saves file as   uploads/<uuid>.<ext>
 *   3. Route responds with    { success, filename, url }
 *   4. Frontend stores filename as cover_photo_name in create/update payload
 *   5. Your existing ridesController saves it as cover_photo in DB
 *   6. coverPhotoUrl(cover_photo) builds the display URL correctly
 *
 * What coverPhotoUrl() in rides.ts expects:
 *   coverPhotoUrl("abc123.jpg")
 *   => BASE_URL.replace('/api/v1','') + '/uploads/' + "abc123.jpg"
 *   => "http://10.0.2.2:3000/uploads/abc123.jpg"
 *
 * So cover_photo in DB = just the filename "abc123.jpg" (no path prefix).
 * The file is physically at:  <project_root>/uploads/abc123.jpg
 * Served statically at:       GET /uploads/abc123.jpg
 */

'use strict';

const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const { v4: uuidv4 } = require('uuid');

// ── Uploads directory ─────────────────────────────────────────────────────────
const UPLOAD_DIR    = process.env.UPLOAD_DIR || 'uploads';
const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE || '5242880', 10); // 5 MB default
const uploadPath    = path.resolve(process.cwd(), UPLOAD_DIR);

// Create directory if it doesn't exist
if (!fs.existsSync(uploadPath)) {
  fs.mkdirSync(uploadPath, { recursive: true });
  console.log('[upload] Created directory:', uploadPath);
}

// ── Allowed image types ───────────────────────────────────────────────────────
const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

// ── Multer storage: UUID filename, original extension ─────────────────────────
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadPath),
  filename:    (_req,  file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    cb(null, `${uuidv4()}${ext}`);
  },
});

// ── File type filter ──────────────────────────────────────────────────────────
const fileFilter = (_req, file, cb) => {
  if (ALLOWED_MIME.has(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(
      `File type "${file.mimetype}" is not allowed. ` +
      'Please upload a JPEG, PNG, or WebP image.'
    ));
  }
};

// ── Multer instance ───────────────────────────────────────────────────────────
const uploader = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_FILE_SIZE, files: 1 },
});

// ── Exported middleware: processes one file under field name "file" ───────────
/**
 * handleUpload(req, res, next)
 *
 * On success: attaches req.uploadedFile = { filename, url, size }
 * On error:   sends JSON error response (does NOT call next(err))
 */
const handleUpload = (req, res, next) => {
  uploader.single('file')(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({
            success: false,
            message: `File too large. Maximum allowed size is ${Math.round(MAX_FILE_SIZE / 1024 / 1024)} MB.`,
          });
        }
        if (err.code === 'LIMIT_UNEXPECTED_FILE') {
          return res.status(400).json({
            success: false,
            message: 'Unexpected field name. Use "file" as the field name in your form data.',
          });
        }
        return res.status(400).json({ success: false, message: err.message });
      }
      // fileFilter rejection or other error
      return res.status(400).json({ success: false, message: err.message });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file received. Send an image with the field name "file".',
      });
    }

    // Attach clean upload info for the route handler
    req.uploadedFile = {
      filename: req.file.filename,           // "uuid.jpg"
      url:      `/uploads/${req.file.filename}`, // "/uploads/uuid.jpg"
      size:     req.file.size,
    };

    next();
  });
};

module.exports = { handleUpload, uploadPath, UPLOAD_DIR };
