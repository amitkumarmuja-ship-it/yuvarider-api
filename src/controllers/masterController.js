/**
 * src/controllers/masterController.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Serves master-table data (accessory categories & brands) to the frontend.
 * These endpoints are public (no auth required) or can be auth-protected.
 *
 * Routes (registered in routes/master.js):
 *   GET /api/v1/master/accessory-categories
 *   GET /api/v1/master/accessory-brands?category_id=<id>
 *   GET /api/v1/master/accessory-brands?category_name=<name>
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
// Query params: category_id=<int>  OR  category_name=<string>
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

    // Resolve category_name → id if needed
    if (!catId && category_name) {
      const catRow = await pool.query(
        `SELECT id FROM accessory_categories WHERE LOWER(name) = LOWER($1) AND is_active = TRUE`,
        [category_name],
      );
      if (!catRow.rows.length) {
        return res.json({ success: true, brands: [] });
      }
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
