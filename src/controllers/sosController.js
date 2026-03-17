const pool = require('../config/db');

// POST /api/sos  — trigger SOS
exports.triggerSOS = async (req, res, next) => {
  try {
    const { ride_id, lat, lng, message } = req.body;
    const r = await pool.query(`
      INSERT INTO sos_alerts (user_id, ride_id, lat, lng, message)
      VALUES ($1,$2,$3,$4,$5) RETURNING *
    `, [req.user.id, ride_id||null, lat||null, lng||null, message||'SOS - Emergency! Need help!']);
    res.status(201).json({ success: true, alert: r.rows[0] });
  } catch (err) { next(err); }
};

// PUT /api/sos/:id/resolve
exports.resolveSOS = async (req, res, next) => {
  try {
    const r = await pool.query(
      `UPDATE sos_alerts SET status='resolved', resolved_at=NOW() WHERE id=$1 AND user_id=$2 RETURNING *`,
      [req.params.id, req.user.id]
    );
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'SOS alert not found' });
    res.json({ success: true, alert: r.rows[0] });
  } catch (err) { next(err); }
};

// GET /api/sos/my — my SOS history
exports.myAlerts = async (req, res, next) => {
  try {
    const r = await pool.query(
      `SELECT * FROM sos_alerts WHERE user_id=$1 ORDER BY created_at DESC LIMIT 20`,
      [req.user.id]
    );
    res.json({ success: true, alerts: r.rows });
  } catch (err) { next(err); }
};
