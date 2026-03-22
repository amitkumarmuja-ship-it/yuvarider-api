/**
 * migrate_cover_photo.js
 *
 * ONE-TIME migration to fix the cover_photo_name column on your production DB.
 * Run this ONCE after deploying the updated API:
 *
 *   node src/config/migrate_cover_photo.js
 *
 * What it does:
 *   1. Changes cover_photo_name from VARCHAR(100) to TEXT
 *      (Cloudinary URLs are ~120+ chars, VARCHAR(100) silently truncated them)
 *   2. Clears any stale cover_photo values that are local UUIDs
 *      (files that no longer exist on Render's ephemeral disk)
 *
 * Safe to run multiple times — checks before altering.
 */
'use strict';

require('dotenv').config();
const pool = require('./db');

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('[migrate] Starting cover_photo migration...');

    // Step 1: Widen cover_photo_name to TEXT
    await client.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'rides'
            AND column_name = 'cover_photo_name'
            AND data_type = 'character varying'
        ) THEN
          ALTER TABLE rides ALTER COLUMN cover_photo_name TYPE TEXT;
          RAISE NOTICE 'cover_photo_name changed to TEXT';
        ELSE
          RAISE NOTICE 'cover_photo_name is already TEXT — skipping';
        END IF;
      END $$;
    `);
    console.log('[migrate] ✓ cover_photo_name is now TEXT');

    // Step 2: Clear stale local UUID filenames from cover_photo
    // (files that look like local uploads: uuid.jpg — no http prefix)
    // These files are gone from Render's ephemeral disk.
    const result = await client.query(`
      UPDATE rides
      SET cover_photo = NULL
      WHERE cover_photo IS NOT NULL
        AND cover_photo NOT LIKE 'http://%'
        AND cover_photo NOT LIKE 'https://%'
    `);
    console.log(`[migrate] ✓ Cleared ${result.rowCount} stale local cover_photo values`);

    // Step 3: Same cleanup for cover_photo_name where it's a local UUID filename
    // (not a Cloudinary URL and not a preset name like "Mountain Pass")
    const result2 = await client.query(`
      UPDATE rides
      SET cover_photo_name = NULL
      WHERE cover_photo_name IS NOT NULL
        AND cover_photo_name NOT LIKE 'http://%'
        AND cover_photo_name NOT LIKE 'https://%'
        AND cover_photo_name NOT LIKE '% %'
        AND cover_photo_name LIKE '%.%'
    `);
    console.log(`[migrate] ✓ Cleared ${result2.rowCount} stale local cover_photo_name values`);

    console.log('[migrate] Migration complete ✓');
  } catch (err) {
    console.error('[migrate] Error:', err.message);
    process.exit(1);
  } finally {
    client.release();
    process.exit(0);
  }
}

migrate();
