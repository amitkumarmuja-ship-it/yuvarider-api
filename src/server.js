/**
 * src/server.js
 * ─────────────────────────────────────────────────────────────────────────────
 * BikerApp Express API server.
 * Mounts all existing routes + the new /api/v1/uploads endpoint.
 *
 * Route file naming: tries common patterns automatically so this works
 * regardless of whether your files are named authRoutes.js or auth.js etc.
 */

'use strict';

require('dotenv').config();

const express = require('express');
const cors    = require('cors');
const helmet  = require('helmet');
const morgan  = require('morgan');
const path    = require('path');
const fs      = require('fs');

const app = express();

// ── Security ──────────────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy:      false,
  crossOriginResourcePolicy:  { policy: 'cross-origin' },
}));

// ── CORS — allow all origins (React Native emulator + physical device) ────────
app.use(cors({
  origin:         '*',
  methods:        ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// ── Request logging ───────────────────────────────────────────────────────────
app.use(morgan('dev'));

// ── Body parsers ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ─────────────────────────────────────────────────────────────────────────────
// STATIC FILE SERVING FOR UPLOADED IMAGES
//
// Serves:  GET http://localhost:3000/uploads/<filename>
//
// This matches what coverPhotoUrl() in the RN app builds:
//   BASE_URL.replace('/api/v1','') + '/uploads/' + filename
//   = 'http://10.0.2.2:3000/uploads/uuid.jpg'  ✓
// ─────────────────────────────────────────────────────────────────────────────
const uploadDir = path.resolve(process.cwd(), process.env.UPLOAD_DIR || 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
  console.log('[server] Created uploads directory:', uploadDir);
}

app.use('/uploads', (req, res, next) => {
  // Allow React Native (Android emulator uses 10.0.2.2, not localhost)
  res.set('Access-Control-Allow-Origin',  '*');
  res.set('Cross-Origin-Resource-Policy', 'cross-origin');
  next();
}, express.static(uploadDir));

// ── Helper to require a route trying multiple naming conventions ───────────────
function requireRoute(routeName) {
  // Try common naming patterns used in Express projects
  const candidates = [
    `./routes/${routeName}Routes`,   // e.g. authRoutes.js
    `./routes/${routeName}Route`,    // e.g. authRoute.js
    `./routes/${routeName}`,         // e.g. auth.js
    `./routes/${routeName}Router`,   // e.g. authRouter.js
  ];
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch {
      // try next pattern
    }
  }
  // None found — return a placeholder that 404s gracefully
  console.warn(`[server] WARNING: Could not find route file for "${routeName}". Checked:`, candidates);
  const r = require('express').Router();
  r.all('*', (req, res) =>
    res.status(404).json({ success: false, message: `Route module "${routeName}" not found on server.` })
  );
  return r;
}

// ── API Routes — /api/v1/* ─────────────────────────────────────────────────────
app.use('/api/v1/auth',        requireRoute('auth'));
app.use('/api/v1/rides',       requireRoute('rides'));
app.use('/api/v1/groups',      requireRoute('groups'));
app.use('/api/v1/expenses',    requireRoute('expenses'));
app.use('/api/v1/vehicles',    requireRoute('vehicles'));
app.use('/api/v1/accessories', requireRoute('accessories'));
app.use('/api/v1/marketplace', requireRoute('marketplace'));
app.use('/api/v1/sos',         requireRoute('sos'));

// ── Upload route (NEW) ────────────────────────────────────────────────────────
app.use('/api/v1/uploads', require('./routes/uploadRoutes'));

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (req, res) =>
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
);

// ── 404 handler ───────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Not found: ${req.method} ${req.path}`,
  });
});

// ── Global error handler ──────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[server error]', err.message || err);
  res.status(err.status || err.statusCode || 500).json({
    success: false,
    message: err.message || 'Internal server error',
  });
});

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT, 10) || 3000;
app.listen(PORT, () => {
  console.log(`[server] Listening on http://localhost:${PORT}`);
  console.log(`[server] Upload endpoint:  POST   http://localhost:${PORT}/api/v1/uploads`);
  console.log(`[server] Static images:    GET    http://localhost:${PORT}/uploads/<filename>`);
  console.log(`[server] Environment:      ${process.env.NODE_ENV || 'development'}`);
});

module.exports = app;
