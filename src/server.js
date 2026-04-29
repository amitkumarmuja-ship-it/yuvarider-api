/**
 * src/server.js
 * ─────────────────────────────────────────────────────────────────────────────
 * BikerApp Express API server.
 * Mounts all existing routes + the new /api/v1/uploads endpoint.
 */

'use strict';

require('dotenv').config();

// Initialise Cloudinary early so status is logged at startup
require('./config/cloudinary');

const express = require('express');
const cors    = require('cors');
const helmet  = require('helmet');
const morgan  = require('morgan');
const path    = require('path');
const fs      = require('fs');
const pool    = require('./config/db');

const app = express();

// ── AUTO-MIGRATION: fix any VARCHAR columns that need to store Cloudinary URLs ─
// Runs silently at every startup — safe to run multiple times (idempotent).
// This prevents the "value too long for type character varying(100)" error
// when Cloudinary URLs (~120+ chars) are saved to cover_photo_name.
async function runAutoMigrations() {
  const client = await pool.connect();
  try {
    // 1. Widen cover_photo_name in rides table (VARCHAR(100) → TEXT)
    await client.query(`
      DO $$ BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'rides'
            AND column_name = 'cover_photo_name'
            AND data_type = 'character varying'
        ) THEN
          ALTER TABLE rides ALTER COLUMN cover_photo_name TYPE TEXT;
          RAISE NOTICE '[auto-migrate] rides.cover_photo_name changed to TEXT';
        END IF;
      END $$;
    `);

    // 2. Widen cover_photo in rides table (in case it's VARCHAR somewhere)
    await client.query(`
      DO $$ BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'rides'
            AND column_name = 'cover_photo'
            AND data_type = 'character varying'
        ) THEN
          ALTER TABLE rides ALTER COLUMN cover_photo TYPE TEXT;
          RAISE NOTICE '[auto-migrate] rides.cover_photo changed to TEXT';
        END IF;
      END $$;
    `);

    // 3. Widen cover_image in groups table
    await client.query(`
      DO $$ BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'groups'
            AND column_name = 'cover_image'
            AND data_type = 'character varying'
        ) THEN
          ALTER TABLE groups ALTER COLUMN cover_image TYPE TEXT;
          RAISE NOTICE '[auto-migrate] groups.cover_image changed to TEXT';
        END IF;
      END $$;
    `);

    // 4. Clear stale local UUID filenames from cover_photo
    //    (files lost from Render's ephemeral disk — not Cloudinary URLs, not preset names)
    await client.query(`
      UPDATE rides
      SET cover_photo = NULL
      WHERE cover_photo IS NOT NULL
        AND cover_photo NOT LIKE 'http://%'
        AND cover_photo NOT LIKE 'https://%'
        AND cover_photo LIKE '%.%'
        AND cover_photo NOT LIKE '% %'
    `);


    // 5. Add image_urls column to accessories if missing
    //    accessoriesController.js reads/writes image_urls in every query and
    //    uses array_append / array_remove on it — the column must exist.
    await client.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'accessories'
            AND column_name = 'image_urls'
        ) THEN
          ALTER TABLE accessories ADD COLUMN image_urls TEXT[] DEFAULT '{}';
          RAISE NOTICE '[auto-migrate] accessories.image_urls column added';
        END IF;
      END $$;
    `);

    // 6. Expand expenses.category CHECK to include Mechanic, Gear, Custom
    //    Old constraint: ('Fuel','Food','Maintenance','Toll','Parking','Other')
    //    New constraint: adds Mechanic, Gear, Custom so the app can save them.
    //    Uses a named constraint so it can be dropped + re-added idempotently.
    await client.query(`
      DO $$ BEGIN
        IF EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'expenses_category_check'
            AND conrelid = 'expenses'::regclass
        ) THEN
          -- Drop old constraint only if it lacks Mechanic (i.e. not yet updated)
          IF (SELECT pg_get_constraintdef(oid) FROM pg_constraint
              WHERE conname = 'expenses_category_check'
                AND conrelid = 'expenses'::regclass)
             NOT LIKE '%Mechanic%'
          THEN
            ALTER TABLE expenses DROP CONSTRAINT expenses_category_check;
            ALTER TABLE expenses
              ADD CONSTRAINT expenses_category_check
              CHECK (category IN (
                'Fuel','Food','Mechanic','Maintenance',
                'Gear','Toll','Parking','Custom','Other'
              ));
            RAISE NOTICE '[auto-migrate] expenses.category CHECK updated';
          END IF;
        ELSE
          -- No named constraint yet — add it fresh
          ALTER TABLE expenses
            ADD CONSTRAINT expenses_category_check
            CHECK (category IN (
              'Fuel','Food','Mechanic','Maintenance',
              'Gear','Toll','Parking','Custom','Other'
            ));
          RAISE NOTICE '[auto-migrate] expenses.category CHECK added';
        END IF;
      END $$;
    `);

    // ── marketplace_purchase_requests table ─────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS marketplace_purchase_requests (
        id          SERIAL       PRIMARY KEY,
        listing_id  UUID         NOT NULL REFERENCES marketplace_listings(id) ON DELETE CASCADE,
        buyer_id    UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        message     TEXT,
        status      VARCHAR(20)  NOT NULL DEFAULT 'pending'
                                 CHECK (status IN ('pending','accepted','rejected')),
        created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        UNIQUE (listing_id, buyer_id)
      );
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_mpr_listing_id ON marketplace_purchase_requests(listing_id);
      CREATE INDEX IF NOT EXISTS idx_mpr_buyer_id   ON marketplace_purchase_requests(buyer_id);
      CREATE INDEX IF NOT EXISTS idx_mpr_status     ON marketplace_purchase_requests(status);
    `);

    // ── marketplace_purchases (accepted sale history) ────────────────────────
    // First create the table without request_id (safe if already exists)
    await client.query(`
      CREATE TABLE IF NOT EXISTS marketplace_purchases (
        id                SERIAL       PRIMARY KEY,
        listing_id        UUID         NOT NULL,
        buyer_id          UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        seller_id         UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        price_at_purchase NUMERIC      NOT NULL,
        title_at_purchase TEXT         NOT NULL,
        purchased_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        UNIQUE(listing_id, buyer_id)
      );
    `);
    // Then add request_id column if it doesn't already exist (handles existing tables)
    await client.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='marketplace_purchases' AND column_name='request_id'
        ) THEN
          ALTER TABLE marketplace_purchases
            ADD COLUMN request_id INT REFERENCES marketplace_purchase_requests(id);
          RAISE NOTICE '[auto-migrate] marketplace_purchases.request_id column added';
        END IF;
      END $$;
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_mp_buyer_id  ON marketplace_purchases(buyer_id);
      CREATE INDEX IF NOT EXISTS idx_mp_seller_id ON marketplace_purchases(seller_id);
    `);

    // ── Add pending_requests column to marketplace_listings if missing ────────
    await client.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='marketplace_listings' AND column_name='view_count'
        ) THEN
          ALTER TABLE marketplace_listings ADD COLUMN view_count INT DEFAULT 0;
        END IF;
      END $$;
    `);

    console.log('[auto-migrate] ✓ DB column migrations applied');
  } catch (err) {
    // Non-fatal — log and continue so the server still starts
    console.error('[auto-migrate] Warning:', err.message);
  } finally {
    client.release();
  }
}

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
// STATIC FILE SERVING FOR UPLOADED IMAGES (local dev fallback)
// In production, images are served by Cloudinary CDN — this is only for local dev.
// ─────────────────────────────────────────────────────────────────────────────
const uploadDir = path.resolve(process.cwd(), process.env.UPLOAD_DIR || 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

app.use('/uploads', (req, res, next) => {
  res.set('Access-Control-Allow-Origin',  '*');
  res.set('Cross-Origin-Resource-Policy', 'cross-origin');
  next();
}, express.static(uploadDir));

// ── Helper to require a route trying multiple naming conventions ───────────────
function requireRoute(routeName) {
  const candidates = [
    `./routes/${routeName}Routes`,
    `./routes/${routeName}Route`,
    `./routes/${routeName}`,
    `./routes/${routeName}Router`,
  ];
  for (const candidate of candidates) {
    try { return require(candidate); } catch { /* try next */ }
  }
  console.warn(`[server] WARNING: Could not find route file for "${routeName}".`);
  const r = require('express').Router();
  r.all('*', (req, res) =>
    res.status(404).json({ success: false, message: `Route module "${routeName}" not found.` })
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
app.use('/api/v1/master',      require('./routes/master'));   // ← ADD THIS

// ── Upload route ──────────────────────────────────────────────────────────────
app.use('/api/v1/uploads', require('./routes/uploadRoutes'));

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (req, res) =>
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
);

// ── 404 handler ───────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ success: false, message: `Not found: ${req.method} ${req.path}` });
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

// Run DB migrations before starting to accept requests
runAutoMigrations().then(() => {
  app.listen(PORT, () => {
    console.log(`[server] Listening on http://localhost:${PORT}`);
    console.log(`[server] Upload endpoint:  POST   http://localhost:${PORT}/api/v1/uploads`);
    console.log(`[server] Static images:    GET    http://localhost:${PORT}/uploads/<filename>`);
    console.log(`[server] Environment:      ${process.env.NODE_ENV || 'development'}`);
  });
});

module.exports = app;
