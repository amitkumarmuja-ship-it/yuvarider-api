const pool = require('../config/db');
require('dotenv').config();

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/rides  — list rides with filters
// Query: status, tab (upcoming|past|my_rides), page, limit
// ─────────────────────────────────────────────────────────────────────────────
exports.getRides = async (req, res, next) => {
  try {
    const { tab, status, page = 1, limit = 20 } = req.query;
    const userId = req.user?.id;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let whereClause = 'WHERE 1=1';
    const params = [];

    if (tab === 'upcoming') {
      whereClause += ` AND r.status='upcoming'`;
    } else if (tab === 'past') {
      whereClause += ` AND r.status='completed'`;
    } else if (tab === 'my_rides' && userId) {
      whereClause += ` AND (r.created_by=$${params.length + 1} OR EXISTS (
        SELECT 1 FROM ride_participants rp WHERE rp.ride_id=r.id AND rp.user_id=$${params.length + 1}
      ))`;
      params.push(userId);
    } else if (status) {
      whereClause += ` AND r.status=$${params.length + 1}`;
      params.push(status);
    }

    const countRes = await pool.query(
      `SELECT COUNT(*) FROM rides r ${whereClause}`, params
    );

    params.push(parseInt(limit), offset);
    const ridesRes = await pool.query(`
      SELECT
        r.id, r.name, r.description, r.source, r.destination,
        r.start_date, r.start_time, r.end_date, r.end_time,
        r.distance_km, r.duration_hrs, r.cover_photo, r.cover_photo_name,
        r.status, r.ride_type, r.is_paid, r.entry_fee,
        r.max_participants, r.cloned_count, r.tags, r.scenic,
        r.created_at,
        u.id   AS host_id,
        u.name AS host_name,
        u.avatar_url AS host_avatar,
        (SELECT COUNT(*) FROM ride_participants rp
         WHERE rp.ride_id=r.id AND rp.status='confirmed') AS participant_count,
        CASE WHEN ${ userId ? `EXISTS (SELECT 1 FROM ride_participants rp2
          WHERE rp2.ride_id=r.id AND rp2.user_id='${userId}')` : 'FALSE'}
          THEN TRUE ELSE FALSE END AS is_joined
      FROM rides r
      JOIN users u ON u.id = r.created_by
      ${whereClause}
      ORDER BY r.start_date ASC, r.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params);

    res.json({
      success: true,
      total: parseInt(countRes.rows[0].count),
      page: parseInt(page),
      limit: parseInt(limit),
      rides: ridesRes.rows,
    });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/rides/:id  — single ride with waypoints, participants, expenses, weather
// ─────────────────────────────────────────────────────────────────────────────
exports.getRideById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;

    const rideRes = await pool.query(`
      SELECT
        r.*,
        u.id AS host_id, u.name AS host_name, u.avatar_url AS host_avatar,
        lu.name AS lead_rider_name,
        mu.name AS marshal_name,
        su.name AS sweep_name,
        (SELECT COUNT(*) FROM ride_participants rp
         WHERE rp.ride_id=r.id AND rp.status='confirmed') AS participant_count
      FROM rides r
      JOIN  users u  ON u.id  = r.created_by
      LEFT JOIN users lu ON lu.id = r.lead_rider_id
      LEFT JOIN users mu ON mu.id = r.marshal_id
      LEFT JOIN users su ON su.id = r.sweep_id
      WHERE r.id=$1
    `, [id]);

    if (!rideRes.rows.length)
      return res.status(404).json({ success: false, message: 'Ride not found' });

    const ride = rideRes.rows[0];

    const [waypointsRes, participantsRes, expensesRes, weatherRes, requestsRes] = await Promise.all([
      pool.query(`SELECT * FROM ride_waypoints WHERE ride_id=$1 ORDER BY sort_order`, [id]),
      pool.query(`
        SELECT rp.role, rp.status, rp.joined_at,
               u.id, u.name, u.avatar_url, u.phone
        FROM ride_participants rp
        JOIN users u ON u.id=rp.user_id
        WHERE rp.ride_id=$1 AND rp.status='confirmed'
      `, [id]),
      pool.query(`
        SELECT re.*, u.name AS paid_by_name
        FROM ride_expenses re
        JOIN users u ON u.id=re.paid_by_id
        WHERE re.ride_id=$1 ORDER BY re.created_at
      `, [id]),
      pool.query(`SELECT * FROM ride_weather WHERE ride_id=$1`, [id]),
      userId ? pool.query(`
        SELECT status FROM ride_requests WHERE ride_id=$1 AND user_id=$2
      `, [id, userId]) : { rows: [] },
    ]);

    const totalExpenses = expensesRes.rows.reduce((s, e) => s + parseFloat(e.amount || 0), 0);

    res.json({
      success: true,
      ride: {
        ...ride,
        waypoints:     waypointsRes.rows,
        participants:  participantsRes.rows,
        expenses:      expensesRes.rows,
        total_expenses: totalExpenses,
        weather:       weatherRes.rows,
        my_request:    requestsRes.rows[0] || null,
        is_joined:     participantsRes.rows.some(p => p.id === userId),
        is_host:       ride.created_by === userId,
      },
    });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/rides  — create ride
// ─────────────────────────────────────────────────────────────────────────────
exports.createRide = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const {
      name, description, source, destination,
      start_date, start_time, end_date, end_time,
      distance_km, duration_hrs, cover_photo, cover_photo_name,
      ride_type, is_paid, entry_fee, max_participants,
      tags, scenic, lead_rider_id, marshal_id, sweep_id,
      waypoints = [], group_id,
    } = req.body;

    if (!name || !source || !destination || !start_date || !start_time)
      return res.status(400).json({ success: false, message: 'name, source, destination, start_date, start_time are required' });

    await client.query('BEGIN');

    const rideRes = await client.query(`
      INSERT INTO rides (
        created_by, name, description, source, destination,
        start_date, start_time, end_date, end_time,
        distance_km, duration_hrs, cover_photo, cover_photo_name,
        ride_type, is_paid, entry_fee, max_participants,
        tags, scenic, lead_rider_id, marshal_id, sweep_id, group_id
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
      RETURNING *
    `, [
      req.user.id, name, description || null, source, destination,
      start_date, start_time, end_date || null, end_time || null,
      distance_km || null, duration_hrs || null, cover_photo || null, cover_photo_name || null,
      ride_type || 'Public', is_paid || false, entry_fee || 0, max_participants || 20,
      tags || [], scenic || false,
      lead_rider_id || null, marshal_id || null, sweep_id || null, group_id || null,
    ]);
    const ride = rideRes.rows[0];

    // Add host as participant
    await client.query(
      `INSERT INTO ride_participants (ride_id, user_id, role) VALUES ($1,$2,'host')`,
      [ride.id, req.user.id]
    );

    // Add waypoints
    for (let i = 0; i < waypoints.length; i++) {
      const wp = waypoints[i];
      await client.query(
        `INSERT INTO ride_waypoints (ride_id, name, stop_time, type, sort_order, lat, lng)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [ride.id, wp.name, wp.stop_time || null, wp.type || 'stop', i + 1, wp.lat || null, wp.lng || null]
      );
    }

    // Update user stats
    await client.query(`UPDATE users SET total_rides=total_rides+1 WHERE id=$1`, [req.user.id]);

    await client.query('COMMIT');
    res.status(201).json({ success: true, ride });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/rides/:id  — update ride
// ─────────────────────────────────────────────────────────────────────────────
exports.updateRide = async (req, res, next) => {
  try {
    const { id } = req.params;
    const ride = await pool.query('SELECT created_by FROM rides WHERE id=$1', [id]);
    if (!ride.rows.length) return res.status(404).json({ success: false, message: 'Ride not found' });
    if (ride.rows[0].created_by !== req.user.id)
      return res.status(403).json({ success: false, message: 'Not authorised' });

    const {
      name, description, source, destination,
      start_date, start_time, end_date, end_time,
      distance_km, duration_hrs, cover_photo, cover_photo_name,
      ride_type, is_paid, entry_fee, max_participants,
      tags, scenic, status, lead_rider_id, marshal_id, sweep_id,
    } = req.body;

    const r = await pool.query(`
      UPDATE rides SET
        name=COALESCE($1,name), description=COALESCE($2,description),
        source=COALESCE($3,source), destination=COALESCE($4,destination),
        start_date=COALESCE($5,start_date), start_time=COALESCE($6,start_time),
        end_date=COALESCE($7,end_date), end_time=COALESCE($8,end_time),
        distance_km=COALESCE($9,distance_km), duration_hrs=COALESCE($10,duration_hrs),
        cover_photo=COALESCE($11,cover_photo), cover_photo_name=COALESCE($12,cover_photo_name),
        ride_type=COALESCE($13,ride_type), is_paid=COALESCE($14,is_paid),
        entry_fee=COALESCE($15,entry_fee), max_participants=COALESCE($16,max_participants),
        tags=COALESCE($17,tags), scenic=COALESCE($18,scenic), status=COALESCE($19,status),
        lead_rider_id=COALESCE($20,lead_rider_id),
        marshal_id=COALESCE($21,marshal_id), sweep_id=COALESCE($22,sweep_id),
        updated_at=NOW()
      WHERE id=$23 RETURNING *
    `, [name, description, source, destination, start_date, start_time, end_date, end_time,
        distance_km, duration_hrs, cover_photo, cover_photo_name, ride_type, is_paid, entry_fee,
        max_participants, tags, scenic, status, lead_rider_id, marshal_id, sweep_id, id]);

    res.json({ success: true, ride: r.rows[0] });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/rides/:id
// ─────────────────────────────────────────────────────────────────────────────
exports.deleteRide = async (req, res, next) => {
  try {
    const { id } = req.params;
    const ride = await pool.query('SELECT created_by FROM rides WHERE id=$1', [id]);
    if (!ride.rows.length) return res.status(404).json({ success: false, message: 'Ride not found' });
    if (ride.rows[0].created_by !== req.user.id)
      return res.status(403).json({ success: false, message: 'Not authorised' });
    await pool.query('DELETE FROM rides WHERE id=$1', [id]);
    res.json({ success: true, message: 'Ride deleted' });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/rides/:id/join  — join request
// ─────────────────────────────────────────────────────────────────────────────
exports.joinRide = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const { message } = req.body;

    const rideRes = await pool.query('SELECT max_participants FROM rides WHERE id=$1', [id]);
    if (!rideRes.rows.length) return res.status(404).json({ success: false, message: 'Ride not found' });

    const countRes = await pool.query(
      `SELECT COUNT(*) FROM ride_participants WHERE ride_id=$1 AND status='confirmed'`, [id]
    );
    if (parseInt(countRes.rows[0].count) >= rideRes.rows[0].max_participants)
      return res.status(400).json({ success: false, message: 'Ride is full' });

    await pool.query(
      `INSERT INTO ride_requests (ride_id, user_id, message)
       VALUES ($1,$2,$3) ON CONFLICT (ride_id, user_id) DO NOTHING`,
      [id, userId, message || null]
    );
    res.status(201).json({ success: true, message: 'Join request sent' });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/rides/:id/clone  — clone a ride
// ─────────────────────────────────────────────────────────────────────────────
exports.cloneRide = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const source = await pool.query('SELECT * FROM rides WHERE id=$1', [id]);
    if (!source.rows.length) return res.status(404).json({ success: false, message: 'Ride not found' });
    const orig = source.rows[0];

    await client.query('BEGIN');

    // Increment original cloned count
    await client.query(`UPDATE rides SET cloned_count=cloned_count+1 WHERE id=$1`, [id]);

    const newRide = await client.query(`
      INSERT INTO rides (
        created_by, name, description, source, destination,
        start_date, start_time, end_date, end_time,
        distance_km, duration_hrs, ride_type, is_paid, entry_fee,
        max_participants, tags, scenic, parent_ride_id
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
      RETURNING *
    `, [
      req.user.id, orig.name + ' (Clone)', orig.description, orig.source, orig.destination,
      orig.start_date, orig.start_time, orig.end_date, orig.end_time,
      orig.distance_km, orig.duration_hrs, orig.ride_type, orig.is_paid, orig.entry_fee,
      orig.max_participants, orig.tags, orig.scenic, orig.id,
    ]);

    // Copy waypoints
    const wps = await client.query(`SELECT * FROM ride_waypoints WHERE ride_id=$1 ORDER BY sort_order`, [id]);
    for (const wp of wps.rows) {
      await client.query(
        `INSERT INTO ride_waypoints (ride_id, name, stop_time, type, sort_order, lat, lng)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [newRide.rows[0].id, wp.name, wp.stop_time, wp.type, wp.sort_order, wp.lat, wp.lng]
      );
    }

    // Add cloner as host participant
    await client.query(
      `INSERT INTO ride_participants (ride_id, user_id, role) VALUES ($1,$2,'host')`,
      [newRide.rows[0].id, req.user.id]
    );

    await client.query('COMMIT');
    res.status(201).json({ success: true, ride: newRide.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/rides/:id/participants
// ─────────────────────────────────────────────────────────────────────────────
exports.getParticipants = async (req, res, next) => {
  try {
    const r = await pool.query(`
      SELECT rp.role, rp.status, rp.joined_at,
             u.id, u.name, u.avatar_url, u.phone, u.location
      FROM ride_participants rp
      JOIN users u ON u.id=rp.user_id
      WHERE rp.ride_id=$1
      ORDER BY rp.joined_at
    `, [req.params.id]);
    res.json({ success: true, participants: r.rows });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/rides/:id/requests  — join requests (host only)
// ─────────────────────────────────────────────────────────────────────────────
exports.getRequests = async (req, res, next) => {
  try {
    const rideRes = await pool.query('SELECT created_by FROM rides WHERE id=$1', [req.params.id]);
    if (!rideRes.rows.length) return res.status(404).json({ success: false, message: 'Ride not found' });
    if (rideRes.rows[0].created_by !== req.user.id)
      return res.status(403).json({ success: false, message: 'Not authorised' });

    const r = await pool.query(`
      SELECT rr.id, rr.status, rr.message, rr.created_at,
             u.id AS user_id, u.name, u.avatar_url, u.phone
      FROM ride_requests rr
      JOIN users u ON u.id=rr.user_id
      WHERE rr.ride_id=$1
      ORDER BY rr.created_at DESC
    `, [req.params.id]);
    res.json({ success: true, requests: r.rows });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/rides/:id/requests/:requestId  — approve/reject
// ─────────────────────────────────────────────────────────────────────────────
exports.respondRequest = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { id, requestId } = req.params;
    const { action } = req.body; // 'approve' | 'reject'
    if (!['approve', 'reject'].includes(action))
      return res.status(400).json({ success: false, message: 'action must be approve or reject' });

    const rideRes = await client.query('SELECT created_by FROM rides WHERE id=$1', [id]);
    if (!rideRes.rows.length) return res.status(404).json({ success: false, message: 'Ride not found' });
    if (rideRes.rows[0].created_by !== req.user.id)
      return res.status(403).json({ success: false, message: 'Not authorised' });

    await client.query('BEGIN');
    const reqRes = await client.query('SELECT * FROM ride_requests WHERE id=$1', [requestId]);
    if (!reqRes.rows.length) return res.status(404).json({ success: false, message: 'Request not found' });
    const rr = reqRes.rows[0];

    const newStatus = action === 'approve' ? 'approved' : 'rejected';
    await client.query(
      `UPDATE ride_requests SET status=$1, responded_at=NOW() WHERE id=$2`,
      [newStatus, requestId]
    );

    if (action === 'approve') {
      await client.query(
        `INSERT INTO ride_participants (ride_id, user_id, role, status)
         VALUES ($1,$2,'member','confirmed')
         ON CONFLICT (ride_id, user_id) DO UPDATE SET status='confirmed'`,
        [id, rr.user_id]
      );
    }
    await client.query('COMMIT');
    res.json({ success: true, message: `Request ${newStatus}` });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/rides/:id/expenses  — add expense to ride
// ─────────────────────────────────────────────────────────────────────────────
exports.addRideExpense = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, amount, category, payment_method, location, notes } = req.body;
    if (!name || !amount)
      return res.status(400).json({ success: false, message: 'name and amount are required' });

    const r = await pool.query(`
      INSERT INTO ride_expenses (ride_id, paid_by_id, name, amount, category, payment_method, location, notes)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *
    `, [id, req.user.id, name, amount, category || 'Other', payment_method || 'cash', location || null, notes || null]);

    res.status(201).json({ success: true, expense: r.rows[0] });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/rides/:id/favourite-location  — save location during active ride
// ─────────────────────────────────────────────────────────────────────────────
exports.addFavouriteLocation = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, lat, lng } = req.body;
    if (!name) return res.status(400).json({ success: false, message: 'name is required' });

    const r = await pool.query(
      `INSERT INTO favourite_locations (user_id, ride_id, name, lat, lng) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [req.user.id, id, name, lat || null, lng || null]
    );
    res.status(201).json({ success: true, location: r.rows[0] });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/rides/:id/waypoints
// ─────────────────────────────────────────────────────────────────────────────
exports.getWaypoints = async (req, res, next) => {
  try {
    const r = await pool.query(
      `SELECT * FROM ride_waypoints WHERE ride_id=$1 ORDER BY sort_order`,
      [req.params.id]
    );
    res.json({ success: true, waypoints: r.rows });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/rides/:id/status  — change ride status (host only)
// ─────────────────────────────────────────────────────────────────────────────
exports.updateStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const valid = ['upcoming','active','completed','cancelled'];
    if (!valid.includes(status))
      return res.status(400).json({ success: false, message: `status must be one of: ${valid.join(',')}` });

    const rideRes = await pool.query('SELECT created_by FROM rides WHERE id=$1', [id]);
    if (!rideRes.rows.length) return res.status(404).json({ success: false, message: 'Ride not found' });
    if (rideRes.rows[0].created_by !== req.user.id)
      return res.status(403).json({ success: false, message: 'Not authorised' });

    await pool.query(`UPDATE rides SET status=$1, updated_at=NOW() WHERE id=$2`, [status, id]);
    res.json({ success: true, message: `Ride status updated to ${status}` });
  } catch (err) { next(err); }
};
