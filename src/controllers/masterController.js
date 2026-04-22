/**
 * src/controllers/masterController.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Serves master-table data to the frontend.
 *
 * ORIGINAL endpoints (accessory categories & brands — unchanged):
 *   GET /api/v1/master/accessory-categories
 *   GET /api/v1/master/accessory-brands?category_id=<id>
 *   GET /api/v1/master/accessory-brands?category_name=<n>
 *
 * NEW endpoints (marketplace form options — from marketplace_options table):
 *   GET /api/v1/master/marketplace-options
 *       Returns ALL active options grouped by group_key.
 *       Response: { success, options: { vehicle_type: [...], fuel_type: [...], ... } }
 *
 *   GET /api/v1/master/marketplace-options/:group
 *       Returns options for a SINGLE group.
 *       Response: { success, group, options: [...] }
 *
 * Each option object shape:
 *   { id, group_key, value, label, emoji, icon, sort_order }
 * ─────────────────────────────────────────────────────────────────────────────
 */
'use strict';
const pool = require('../config/db');

// ── GET /api/v1/master/accessory-categories ───────────────────────────────────
exports.getAccessoryCategories = async (req, res, next) => {
  try {
    const result = await pool.query(`
      SELECT id, name, emoji, sort_order
      FROM   accessory_categories
      WHERE  is_active = TRUE
      ORDER  BY sort_order ASC, name ASC
    `);
    res.json({ success: true, categories: result.rows });
  } catch (err) { next(err); }
};

// ── GET /api/v1/master/accessory-brands ───────────────────────────────────────
exports.getAccessoryBrands = async (req, res, next) => {
  try {
    const { category_id, category_name } = req.query;

    if (!category_id && !category_name) {
      return res.status(400).json({
        success: false,
        message: 'Provide category_id or category_name query param.',
      });
    }

    let catId = category_id;

    if (!catId && category_name) {
      const catRow = await pool.query(
        `SELECT id FROM accessory_categories WHERE LOWER(name) = LOWER($1) AND is_active = TRUE`,
        [category_name],
      );
      if (!catRow.rows.length) return res.json({ success: true, brands: [] });
      catId = catRow.rows[0].id;
    }

    const result = await pool.query(`
      SELECT ab.id, ab.name, ab.sort_order
      FROM   accessory_brands ab
      WHERE  ab.category_id = $1
        AND  ab.is_active = TRUE
      ORDER  BY ab.sort_order ASC, ab.name ASC
    `, [catId]);

    res.json({ success: true, brands: result.rows });
  } catch (err) { next(err); }
};

// ── GET /api/v1/master/marketplace-options ────────────────────────────────────
// Returns ALL active marketplace options grouped by group_key.
// The frontend fetches this ONCE on screen load and stores in state.
// Example response:
// {
//   "success": true,
//   "options": {
//     "vehicle_type":     [ { value:"bike", label:"Bike / Scooter", emoji:"🏍️" }, ... ],
//     "listing_category": [ { value:"sell_bike", label:"Sell Bike", emoji:"🏍️" }, ... ],
//     "fuel_type":        [ { value:"Petrol", label:"Petrol", emoji:"⛽" }, ... ],
//     ...
//   }
// }
exports.getMarketplaceOptions = async (req, res, next) => {
  try {
    const result = await pool.query(`
      SELECT id, group_key, value, label, emoji, icon, sort_order
      FROM   marketplace_options
      WHERE  is_active = TRUE
      ORDER  BY group_key ASC, sort_order ASC, label ASC
    `);

    // Group rows by group_key into an object map
    const grouped = {};
    for (const row of result.rows) {
      if (!grouped[row.group_key]) grouped[row.group_key] = [];
      grouped[row.group_key].push({
        id:         row.id,
        group_key:  row.group_key,
        value:      row.value,
        label:      row.label,
        emoji:      row.emoji || null,
        icon:       row.icon  || null,
        sort_order: row.sort_order,
      });
    }

    res.json({ success: true, options: grouped });
  } catch (err) { next(err); }
};

// ── GET /api/v1/master/marketplace-options/:group ─────────────────────────────
// Returns options for a SINGLE group_key.
// Useful when you only need one list (e.g. fuel_type filter).
exports.getMarketplaceOptionsByGroup = async (req, res, next) => {
  try {
    const { group } = req.params;
    if (!group || typeof group !== 'string') {
      return res.status(400).json({ success: false, message: 'group param is required' });
    }

    const result = await pool.query(`
      SELECT id, group_key, value, label, emoji, icon, sort_order
      FROM   marketplace_options
      WHERE  group_key = $1
        AND  is_active = TRUE
      ORDER  BY sort_order ASC, label ASC
    `, [group.toLowerCase()]);

    res.json({
      success: true,
      group,
      options: result.rows.map(r => ({
        id:         r.id,
        group_key:  r.group_key,
        value:      r.value,
        label:      r.label,
        emoji:      r.emoji || null,
        icon:       r.icon  || null,
        sort_order: r.sort_order,
      })),
    });
  } catch (err) { next(err); }
};
