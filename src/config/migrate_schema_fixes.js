/**
 * src/config/migrate_schema_fixes.js
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE-TIME migration to fix 2 schema bugs found during the Shop/Expense audit.
 *
 * Run ONCE on your live database after deploying the updated API:
 *
 *   node src/config/migrate_schema_fixes.js
 *
 * Both fixes are fully idempotent — safe to run multiple times.
 *
 * ─── FIX 1: accessories.image_urls column ────────────────────────────────────
 * The accessories table in migrate.js was missing the image_urls TEXT[] column.
 * accessoriesController.js reads, writes, and uses array_append/array_remove on
 * it in EVERY query. Without this column the accessory photo upload endpoints
 * (POST/DELETE /accessories/:id/images) throw "column does not exist".
 *
 * ─── FIX 2: expenses.category CHECK constraint ────────────────────────────────
 * The DB constraint only allowed: Fuel, Food, Maintenance, Toll, Parking, Other
 * But the controller (VALID_CATEGORIES) and the React Native app both also send:
 *   • Mechanic  — the most common expense category for riders
 *   • Gear      — gear purchases
 *   • Custom    — user-defined expenses
 * Saving any of those three returned a PostgreSQL constraint violation (500 error)
 * even though the controller-level validation already accepted them.
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

require('dotenv').config();
const pool = require('./db');

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('[migrate_schema_fixes] Starting...\n');

    // ── FIX 1: Add image_urls column to accessories ───────────────────────────
    console.log('[fix 1] Checking accessories.image_urls column...');
    await client.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_name  = 'accessories'
            AND column_name = 'image_urls'
        ) THEN
          ALTER TABLE accessories
            ADD COLUMN image_urls TEXT[] DEFAULT '{}';
          RAISE NOTICE 'accessories.image_urls column ADDED';
        ELSE
          RAISE NOTICE 'accessories.image_urls already exists — skipping';
        END IF;
      END $$;
    `);
    console.log('[fix 1] ✓ accessories.image_urls is in place\n');

    // ── FIX 2: Update expenses.category CHECK constraint ─────────────────────
    console.log('[fix 2] Checking expenses.category CHECK constraint...');
    await client.query(`
      DO $$ BEGIN
        -- Check if the named constraint already includes Mechanic (already updated)
        IF EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname    = 'expenses_category_check'
            AND conrelid   = 'expenses'::regclass
            AND pg_get_constraintdef(oid) LIKE '%Mechanic%'
        ) THEN
          RAISE NOTICE 'expenses.category CHECK already includes Mechanic — skipping';

        ELSIF EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname  = 'expenses_category_check'
            AND conrelid = 'expenses'::regclass
        ) THEN
          -- Named constraint exists but is the old restrictive version — replace it
          ALTER TABLE expenses DROP CONSTRAINT expenses_category_check;
          ALTER TABLE expenses
            ADD CONSTRAINT expenses_category_check
            CHECK (category IN (
              'Fuel', 'Food', 'Mechanic', 'Maintenance',
              'Gear', 'Toll', 'Parking', 'Custom', 'Other'
            ));
          RAISE NOTICE 'expenses.category CHECK UPDATED (old constraint replaced)';

        ELSE
          -- No named constraint at all (e.g. was defined inline without a name)
          -- Drop any anonymous check constraints on the category column first
          DECLARE
            r RECORD;
          BEGIN
            FOR r IN
              SELECT c.conname
              FROM pg_constraint c
              JOIN pg_attribute a
                ON a.attnum   = ANY(c.conkey)
               AND a.attrelid = c.conrelid
              WHERE c.conrelid = 'expenses'::regclass
                AND c.contype  = 'c'
                AND a.attname  = 'category'
            LOOP
              EXECUTE 'ALTER TABLE expenses DROP CONSTRAINT ' || quote_ident(r.conname);
              RAISE NOTICE 'Dropped old anonymous constraint: %', r.conname;
            END LOOP;
          END;

          ALTER TABLE expenses
            ADD CONSTRAINT expenses_category_check
            CHECK (category IN (
              'Fuel', 'Food', 'Mechanic', 'Maintenance',
              'Gear', 'Toll', 'Parking', 'Custom', 'Other'
            ));
          RAISE NOTICE 'expenses.category CHECK ADDED fresh';
        END IF;
      END $$;
    `);
    console.log('[fix 2] ✓ expenses.category CHECK constraint is up to date\n');

    console.log('[migrate_schema_fixes] All fixes applied successfully ✓');
    console.log('\nCategories now accepted by DB:');
    console.log('  Fuel | Food | Mechanic | Maintenance | Gear | Toll | Parking | Custom | Other\n');

  } catch (err) {
    console.error('[migrate_schema_fixes] FAILED:', err.message);
    console.error(err.stack);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
    process.exit(0);
  }
}

migrate();
