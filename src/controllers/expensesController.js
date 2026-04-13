/**
 * expensesController.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Full CRUD for expenses + summary stats.
 * Supports categories: Fuel, Food, Mechanic, Maintenance, Gear, Toll, Parking, Custom, Other
 */
'use strict';
const pool = require('../config/db');

const VALID_CATEGORIES = ['Fuel','Food','Mechanic','Maintenance','Gear','Toll','Parking','Custom','Other'];
const VALID_TYPES      = ['personal','ride'];
const VALID_PAYMENTS   = ['cash','upi','card','wallet'];

// ── GET /api/v1/expenses ──────────────────────────────────────────────────────
exports.getExpenses = async (req, res, next) => {
  try {
    const { vehicle_id, type, category, page = 1, limit = 100 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let where = 'WHERE e.user_id=$1';
    const params = [req.user.id];

    if (vehicle_id) { where += ` AND e.vehicle_id=$${params.length + 1}`;  params.push(vehicle_id); }
    if (type)       { where += ` AND e.type=$${params.length + 1}`;        params.push(type); }
    if (category)   { where += ` AND e.category=$${params.length + 1}`;    params.push(category); }

    // Count
    const totalRes = await pool.query(
      `SELECT COUNT(*) FROM expenses e ${where}`, params,
    );

    // Category summary
    const summaryRes = await pool.query(`
      SELECT category, SUM(amount) AS total, COUNT(*) AS count
      FROM expenses e ${where}
      GROUP BY category
    `, params);

    // All-time total for this user (ignoring filters)
    const allTimeRes = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) AS all_time_total FROM expenses WHERE user_id = $1`,
      [req.user.id],
    );

    // Paginated rows
    params.push(parseInt(limit), offset);
    const r = await pool.query(`
      SELECT
        e.*,
        v.name       AS vehicle_name,
        v.nickname   AS vehicle_nickname,
        ri.name      AS ride_name
      FROM expenses e
      LEFT JOIN vehicles v  ON v.id  = e.vehicle_id
      LEFT JOIN rides    ri ON ri.id = e.ride_id
      ${where}
      ORDER BY e.date DESC, e.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params);

    res.json({
      success:         true,
      total:           parseInt(totalRes.rows[0].count),
      all_time_total:  parseFloat(allTimeRes.rows[0].all_time_total),
      summary:         summaryRes.rows,
      expenses:        r.rows,
    });
  } catch (err) { next(err); }
};

// ── GET /api/v1/expenses/summary ─────────────────────────────────────────────
exports.getStats = async (req, res, next) => {
  try {
    const userId = req.user.id;

    const [monthly, byCat, byType, allTime, thisMonth] = await Promise.all([
      pool.query(`
        SELECT TO_CHAR(date,'YYYY-MM') AS month, SUM(amount) AS total, COUNT(*) AS count
        FROM expenses
        WHERE user_id=$1 AND date >= NOW() - INTERVAL '12 months'
        GROUP BY month ORDER BY month DESC
      `, [userId]),

      pool.query(`
        SELECT category, SUM(amount) AS total, COUNT(*) AS count
        FROM expenses WHERE user_id=$1
        GROUP BY category ORDER BY total DESC
      `, [userId]),

      pool.query(`
        SELECT type, SUM(amount) AS total, COUNT(*) AS count
        FROM expenses WHERE user_id=$1 GROUP BY type
      `, [userId]),

      pool.query(
        `SELECT COALESCE(SUM(amount),0) AS total FROM expenses WHERE user_id=$1`,
        [userId],
      ),

      pool.query(`
        SELECT COALESCE(SUM(amount),0) AS total FROM expenses
        WHERE user_id=$1 AND date_trunc('month',date)=date_trunc('month',NOW())
      `, [userId]),
    ]);

    res.json({
      success:           true,
      all_time_total:    parseFloat(allTime.rows[0].total),
      this_month_total:  parseFloat(thisMonth.rows[0].total),
      monthly:           monthly.rows,
      by_category:       byCat.rows,
      by_type:           byType.rows,
    });
  } catch (err) { next(err); }
};

// ── GET /api/v1/expenses/:id ──────────────────────────────────────────────────
exports.getExpenseById = async (req, res, next) => {
  try {
    const r = await pool.query(`
      SELECT e.*, v.name AS vehicle_name, v.nickname AS vehicle_nickname
      FROM expenses e
      LEFT JOIN vehicles v ON v.id = e.vehicle_id
      WHERE e.id=$1 AND e.user_id=$2
    `, [req.params.id, req.user.id]);

    if (!r.rows.length)
      return res.status(404).json({ success: false, message: 'Expense not found' });

    res.json({ success: true, expense: r.rows[0] });
  } catch (err) { next(err); }
};

// ── POST /api/v1/expenses ─────────────────────────────────────────────────────
exports.createExpense = async (req, res, next) => {
  try {
    const {
      vehicle_id, ride_id, category, amount, date,
      description, notes, type, payment_method, location,
    } = req.body;

    // Validation
    if (!category || !amount || !date)
      return res.status(400).json({ success: false, message: 'category, amount and date are required' });

    if (!VALID_CATEGORIES.includes(category))
      return res.status(400).json({
        success: false,
        message: `Invalid category. Must be one of: ${VALID_CATEGORIES.join(', ')}`,
      });

    if (type && !VALID_TYPES.includes(type))
      return res.status(400).json({
        success: false,
        message: `Invalid type. Must be one of: ${VALID_TYPES.join(', ')}`,
      });

    if (payment_method && !VALID_PAYMENTS.includes(payment_method))
      return res.status(400).json({
        success: false,
        message: `Invalid payment_method. Must be one of: ${VALID_PAYMENTS.join(', ')}`,
      });

    const r = await pool.query(`
      INSERT INTO expenses
        (user_id, vehicle_id, ride_id, category, amount, date,
         description, notes, type, payment_method, location)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      RETURNING *
    `, [
      req.user.id,
      vehicle_id     || null,
      ride_id        || null,
      category,
      parseFloat(amount),
      date,
      description    || null,
      notes          || null,
      type           || 'personal',
      payment_method || 'cash',
      location       || null,
    ]);

    res.status(201).json({ success: true, expense: r.rows[0] });
  } catch (err) { next(err); }
};

// ── PUT /api/v1/expenses/:id ──────────────────────────────────────────────────
exports.updateExpense = async (req, res, next) => {
  try {
    const {
      category, amount, date, description, notes,
      type, payment_method, location, vehicle_id,
    } = req.body;

    if (category && !VALID_CATEGORIES.includes(category))
      return res.status(400).json({
        success: false,
        message: `Invalid category. Must be one of: ${VALID_CATEGORIES.join(', ')}`,
      });

    const r = await pool.query(`
      UPDATE expenses SET
        category       = COALESCE($1,  category),
        amount         = COALESCE($2,  amount),
        date           = COALESCE($3,  date),
        description    = COALESCE($4,  description),
        notes          = COALESCE($5,  notes),
        type           = COALESCE($6,  type),
        payment_method = COALESCE($7,  payment_method),
        location       = COALESCE($8,  location),
        vehicle_id     = COALESCE($9,  vehicle_id),
        updated_at     = NOW()
      WHERE id=$10 AND user_id=$11
      RETURNING *
    `, [
      category || null,
      amount    ? parseFloat(amount) : null,
      date      || null,
      description !== undefined ? description : null,
      notes       !== undefined ? notes       : null,
      type        || null,
      payment_method || null,
      location    || null,
      vehicle_id  || null,
      req.params.id,
      req.user.id,
    ]);

    if (!r.rows.length)
      return res.status(404).json({ success: false, message: 'Expense not found' });

    res.json({ success: true, expense: r.rows[0] });
  } catch (err) { next(err); }
};

// ── DELETE /api/v1/expenses/:id ───────────────────────────────────────────────
exports.deleteExpense = async (req, res, next) => {
  try {
    const r = await pool.query(
      `DELETE FROM expenses WHERE id=$1 AND user_id=$2 RETURNING id`,
      [req.params.id, req.user.id],
    );
    if (!r.rows.length)
      return res.status(404).json({ success: false, message: 'Expense not found' });

    res.json({ success: true, message: 'Expense deleted' });
  } catch (err) { next(err); }
};
