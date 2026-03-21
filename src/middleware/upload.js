/**
 * src/middleware/upload.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Multer middleware for handling cover photo uploads.
 *
 * Storage:  local disk  →  <project_root>/uploads/<uuid>.<ext>
 * Endpoint: POST /api/v1/uploads
 * Field:    "file"  (multipart/form-data)
 * Response: { success: true, filename: "abc123.jpg", url: "/uploads/abc123.jpg" }
 *
 * The filename is stored in:
 *   rides.cover_photo_name  (VARCHAR 100)
 *   rides.cover_photo       (TEXT — full relative path e.g. "uploads/abc123.jpg")
 *   groups.cover_image      (TEXT — full relative path)
 *
 * Static files are served from Express at /uploads/* so the full public URL is:
 *   http://host:3000/uploads/<filename>
 * Which matches what coverPhotoUrl() in the frontend rides.ts constructs.
 */

const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const { v4: uuidv4 } = require('uuid');

// ── Ensure uploads directory exists ──────────────────────────────────────────
const UPLOAD_DIR = process.env.UPLOAD_DIR || 'uploads';
const uploadPath = path.resolve(process.cwd(), UPLOAD_DIR);

if (!fs.existsSync(uploadPath)) {
  fs.mkdirSync(uploadPath, { recursive: true });
  console.log(`[upload] Created uploads directory: ${uploadPath}`);
}

// ── Allowed MIME types ────────────────────────────────────────────────────────
const ALLOWED_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
];

// ── Multer storage config ─────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    // Generate a UUID filename to avoid collisions and hide original names
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    const safeName = `${uuidv4()}${ext}`;
    cb(null, safeName);
  },
});

// ── File filter ───────────────────────────────────────────────────────────────
const fileFilter = (req, file, cb) => {
  if (ALLOWED_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(
      new Error(
        `Invalid file type: ${file.mimetype}. ` +
        `Allowed types: jpeg, png, webp.`
      ),
      false
    );
  }
};

// ── Multer instance ───────────────────────────────────────────────────────────
const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE, 10) || 5 * 1024 * 1024; // 5 MB default

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files:    1,
  },
});

// ── Single-file upload middleware (field name: "file") ────────────────────────
const uploadSingle = upload.single('file');

// ── Wrapped middleware with proper error handling ─────────────────────────────
/**
 * handleUpload — Express middleware that processes a single file upload.
 * Attaches req.uploadedFile = { filename, url, path } on success.
 * Calls next(err) on failure so the global error handler can respond with JSON.
 */
const handleUpload = (req, res, next) => {
  uploadSingle(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        // Multer-specific errors
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({
            success: false,
            message: `File too large. Maximum size is ${Math.round(MAX_FILE_SIZE / 1024 / 1024)} MB.`,
          });
        }
        if (err.code === 'LIMIT_UNEXPECTED_FILE') {
          return res.status(400).json({
            success: false,
            message: 'Unexpected field name. Use "file" as the field name.',
          });
        }
        return res.status(400).json({ success: false, message: err.message });
      }

      // Custom fileFilter errors
      if (err.message && err.message.includes('Invalid file type')) {
        return res.status(400).json({ success: false, message: err.message });
      }

      // Unknown error
      return res.status(500).json({ success: false, message: 'Upload failed.' });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file received. Make sure to send a file with field name "file".',
      });
    }

    // Attach upload info to request for the route handler
    req.uploadedFile = {
      filename:     req.file.filename,
      originalName: req.file.originalname,
      mimeType:     req.file.mimetype,
      sizeBytes:    req.file.size,
      path:         `${UPLOAD_DIR}/${req.file.filename}`,
      url:          `/uploads/${req.file.filename}`,
    };

    next();
  });
};

module.exports = { handleUpload, uploadPath, UPLOAD_DIR };
