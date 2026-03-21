/**
 * src/routes/uploadRoutes.js
 *
 * POST /api/v1/uploads   — upload a cover photo
 * DELETE /api/v1/uploads/:filename — delete a previously uploaded file
 *
 * Auth: JWT verified inline using process.env.JWT_SECRET
 *       (no dependency on your existing middleware/auth.js path)
 *
 * ── Request (POST) ────────────────────────────────────────────────────────────
 * Headers:  Authorization: Bearer <jwt_token>
 * Body:     multipart/form-data   field name: "file"   image file
 *
 * ── Response (POST 200) ───────────────────────────────────────────────────────
 * {
 *   success:  true,
 *   filename: "550e8400-e29b-41d4-a716-446655440000.jpg",  ← store as cover_photo_name
 *   url:      "/uploads/550e8400-...jpg"
 * }
 *
 * ── How the frontend uses this ────────────────────────────────────────────────
 * 1. Upload: POST /api/v1/uploads  → get { filename }
 * 2. Create/update ride: send { cover_photo_name: filename }
 * 3. Your ridesController saves cover_photo_name to DB
 * 4. coverPhotoUrl(cover_photo) in rides.ts builds:
 *      BASE_URL.replace('/api/v1','') + '/uploads/' + filename
 *      → "http://10.0.2.2:3000/uploads/uuid.jpg"
 * 5. Express static at /uploads serves the file → image displays ✓
 *
 * ── What you need in your existing server.js ─────────────────────────────────
 * See the comment block at the bottom of this file.
 */

'use strict';

const express = require('express');
const router  = express.Router();
const path    = require('path');
const fs      = require('fs');
const jwt     = require('jsonwebtoken');
const { handleUpload, uploadPath } = require('../middleware/uploadMiddleware');

// ── Inline JWT auth (avoids any dependency on your auth middleware path) ───────
function requireAuth(req, res, next) {
  const header = req.headers['authorization'] || req.headers['Authorization'] || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7).trim() : null;

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Authorization header missing. Include: Authorization: Bearer <token>',
    });
  }

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    console.error('[uploadRoutes] JWT_SECRET not set in .env');
    return res.status(500).json({ success: false, message: 'Server misconfiguration.' });
  }

  try {
    req.user = jwt.verify(token, secret);
    next();
  } catch (err) {
    return res.status(401).json({
      success: false,
      message: err.name === 'TokenExpiredError'
        ? 'Token expired. Please log in again.'
        : 'Invalid token.',
    });
  }
}

// ── POST /api/v1/uploads ──────────────────────────────────────────────────────
router.post('/', requireAuth, handleUpload, (req, res) => {
  const { filename, url, size } = req.uploadedFile;

  console.log(
    `[upload] User ${req.user?.id || '?'} uploaded: ${filename}` +
    ` (${Math.round(size / 1024)} KB)`
  );

  return res.status(200).json({
    success:  true,
    filename,   // ← this is what the frontend stores as cover_photo_name
    url,        // ← "/uploads/uuid.jpg"  (relative)
  });
});

// ── DELETE /api/v1/uploads/:filename ─────────────────────────────────────────
// Optional: lets the frontend clean up old photos when user changes cover
router.delete('/:filename', requireAuth, (req, res) => {
  const { filename } = req.params;

  // Guard against path traversal attacks
  if (!filename || /[/\\.]\./.test(filename) || filename.includes('/')) {
    return res.status(400).json({ success: false, message: 'Invalid filename.' });
  }

  const filePath = path.join(uploadPath, filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ success: false, message: 'File not found.' });
  }

  try {
    fs.unlinkSync(filePath);
    console.log(`[upload] Deleted: ${filename}`);
    return res.json({ success: true, message: 'File deleted.' });
  } catch {
    return res.status(500).json({ success: false, message: 'Could not delete file.' });
  }
});

module.exports = router;

/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  ADD THESE 3 THINGS TO YOUR EXISTING src/server.js                     ║
 * ╠══════════════════════════════════════════════════════════════════════════╣
 * ║                                                                          ║
 * ║  STEP 1 — After your other require() lines:                             ║
 * ║                                                                          ║
 * ║    const path = require('path');   // may already exist                 ║
 * ║    const fs   = require('fs');     // may already exist                 ║
 * ║                                                                          ║
 * ║    // Serve uploaded images as static files                             ║
 * ║    // GET http://localhost:3000/uploads/<filename>                       ║
 * ║    const uploadDir = path.resolve(process.cwd(),                        ║
 * ║                        process.env.UPLOAD_DIR || 'uploads');            ║
 * ║    if (!fs.existsSync(uploadDir))                                       ║
 * ║      fs.mkdirSync(uploadDir, { recursive: true });                      ║
 * ║    app.use('/uploads', express.static(uploadDir));                      ║
 * ║                                                                          ║
 * ║  STEP 2 — Require the route:                                            ║
 * ║                                                                          ║
 * ║    const uploadRoutes = require('./routes/uploadRoutes');               ║
 * ║                                                                          ║
 * ║  STEP 3 — Mount the route (with your other app.use() calls):           ║
 * ║                                                                          ║
 * ║    app.use('/api/v1/uploads', uploadRoutes);                            ║
 * ║                                                                          ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * That's it. Your existing routes (rides, groups, auth, etc.) stay unchanged.
 *
 * ── ridesController: make sure cover_photo_name is saved ─────────────────────
 * In createRide and updateRide, when you receive cover_photo_name from req.body,
 * make sure your INSERT/UPDATE query saves it. Example:
 *
 *   const { cover_photo_name } = req.body;
 *
 *   // In INSERT:
 *   cover_photo_name || null,     // rides.cover_photo_name column
 *
 *   // In UPDATE (dynamic SET):
 *   if (cover_photo_name !== undefined) {
 *     sets.push(`cover_photo_name = $${p++}`);
 *     vals.push(cover_photo_name || null);
 *     sets.push(`cover_photo = $${p++}`);
 *     vals.push(cover_photo_name || null);  // cover_photo also = filename
 *   }
 *
 * NOTE: coverPhotoUrl() in the frontend appends the value to "/uploads/".
 * So store just the filename (e.g. "abc.jpg"), NOT "uploads/abc.jpg".
 */
