const pool = require('../config/db');

// GET /api/expenses
exports.getExpenses = async (req, res, next) => {
  try {
    const { vehicle_id, type, category, page=1, limit=50 } = req.query;
    const offset = (parseInt(page)-1)*parseInt(limit);
    let where = `WHERE e.user_id=$1`;
    const params = [req.user.id];

    if (vehicle_id) { where += ` AND e.vehicle_id=$${params.length+1}`; params.push(vehicle_id); }
    if (type)       { where += ` AND e.type=$${params.length+1}`;       params.push(type); }
    if (category)   { where += ` AND e.category=$${params.length+1}`;   params.push(category); }

    const total = await pool.query(`SELECT COUNT(*) FROM expenses e ${where}`, params);
    const summary = await pool.query(`
      SELECT category, SUM(amount) AS total FROM expenses e ${where} GROUP BY category
    `, params);

    params.push(parseInt(limit), offset);
    const r = await pool.query(`
      SELECT e.*, v.name AS vehicle_name, v.nickname AS vehicle_nickname
      FROM expenses e
      LEFT JOIN vehicles v ON v.id=e.vehicle_id
      ${where}
      ORDER BY e.date DESC, e.created_at DESC
      LIMIT $${params.length-1} OFFSET $${params.length}
    `, params);

    res.json({
      success: true,
      total: parseInt(total.rows[0].count),
      summary: summary.rows,
      expenses: r.rows,
    });
  } catch (err) { next(err); }
};

// GET /api/expenses/:id
exports.getExpenseById = async (req, res, next) => {
  try {
    const r = await pool.query(`
      SELECT e.*, v.name AS vehicle_name FROM expenses e
      LEFT JOIN vehicles v ON v.id=e.vehicle_id
      WHERE e.id=$1 AND e.user_id=$2
    `, [req.params.id, req.user.id]);
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'Expense not found' });
    res.json({ success: true, expense: r.rows[0] });
  } catch (err) { next(err); }
};

// POST /api/expenses
exports.createExpense = async (req, res, next) => {
  try {
    const { vehicle_id, ride_id, category, amount, date, description, notes, type, payment_method, location } = req.body;
    if (!category || !amount || !date)
      return res.status(400).json({ success: false, message: 'category, amount and date are required' });

    const r = await pool.query(`
      INSERT INTO expenses (user_id, vehicle_id, ride_id, category, amount, date, description, notes, type, payment_method, location)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *
    `, [req.user.id, vehicle_id||null, ride_id||null, category, amount, date, description||null, notes||null, type||'personal', payment_method||'cash', location||null]);

    res.status(201).json({ success: true, expense: r.rows[0] });
  } catch (err) { next(err); }
};

// PUT /api/expenses/:id
exports.updateExpense = async (req, res, next) => {
  try {
    const { category, amount, date, description, notes, type, payment_method, location } = req.body;
    const r = await pool.query(`
      UPDATE expenses SET
        category=COALESCE($1,category), amount=COALESCE($2,amount),
        date=COALESCE($3,date), description=COALESCE($4,description),
        notes=COALESCE($5,notes), type=COALESCE($6,type),
        payment_method=COALESCE($7,payment_method), location=COALESCE($8,location),
        updated_at=NOW()
      WHERE id=$9 AND user_id=$10 RETURNING *
    `, [category, amount, date, description, notes, type, payment_method, location, req.params.id, req.user.id]);
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'Expense not found' });
    res.json({ success: true, expense: r.rows[0] });
  } catch (err) { next(err); }
};

// DELETE /api/expenses/:id
exports.deleteExpense = async (req, res, next) => {
  try {
    const r = await pool.query(`DELETE FROM expenses WHERE id=$1 AND user_id=$2 RETURNING id`, [req.params.id, req.user.id]);
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'Expense not found' });
    res.json({ success: true, message: 'Expense deleted' });
  } catch (err) { next(err); }
};

// GET /api/expenses/stats — monthly breakdown
exports.getStats = async (req, res, next) => {
  try {
    const { year } = req.query;
    const r = await pool.query(`
      SELECT
        TO_CHAR(date,'YYYY-MM') AS month,
        category,
        SUM(amount) AS total,
        COUNT(*) AS count
      FROM expenses
      WHERE user_id=$1 AND ($2::int IS NULL OR EXTRACT(YEAR FROM date)=$2)
      GROUP BY month, category
      ORDER BY month DESC
    `, [req.user.id, year||null]);
    res.json({ success: true, stats: r.rows });
  } catch (err) { next(err); }
};
