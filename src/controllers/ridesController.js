const pool = require('../config/db');
require('dotenv').config();

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Given a start_date string (YYYY-MM-DD) and a 1-based day_number,
 * returns a human label like "Day 1 - Monday".
 */
function buildDayLabel(startDateStr, dayNumber) {
  try {
    const base = new Date(startDateStr);
    base.setDate(base.getDate() + dayNumber - 1);
    const weekday = base.toLocaleDateString('en-US', { weekday: 'long' });
    return `Day ${dayNumber} - ${weekday}`;
  } catch {
    return `Day ${dayNumber}`;
  }
}

/**
 * Groups a flat waypoints array (sorted by day_number, sort_order) into
 * itinerary days used by RideDetailScreen:
 *   [{ day_number, day_label, stops: [{ name, stop_time, type, ... }] }]
 */
function groupWaypointsByDay(waypoints, startDate) {
  const map = new Map();
  for (const wp of waypoints) {
    const dayNum = wp.day_number || 1;
    if (!map.has(dayNum)) map.set(dayNum, []);
    map.get(dayNum).push(wp);
  }
  const itinerary = [];
  for (const [dayNum, stops] of [...map.entries()].sort((a, b) => a[0] - b[0])) {
    itinerary.push({
      day_number: dayNum,
      day_label:  buildDayLabel(startDate, dayNum),
      stops,
    });
  }
  return itinerary;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/rides
// Query: tab (upcoming|past|my_rides), page, limit, status
// ─────────────────────────────────────────────────────────────────────────────
exports.getRides = async (req, res, next) => {
  try {
    const { tab, status, page = 1, limit = 20 } = req.query;
    const userId = req.user?.id || null;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let whereClause = 'WHERE 1=1';
    const params = [];

    if (tab === 'upcoming') {
      whereClause += ` AND r.status = 'upcoming'`;
    } else if (tab === 'past') {
      whereClause += ` AND r.status = 'completed'`;
    } else if (tab === 'my_rides') {
      if (!userId)
        return res.json({ success: true, total: 0, page: 1, limit: parseInt(limit), rides: [] });
      params.push(userId);
      whereClause += ` AND (r.created_by = $1 OR EXISTS (
        SELECT 1 FROM ride_participants rp WHERE rp.ride_id = r.id AND rp.user_id = $1
      ))`;
    } else if (status) {
      params.push(status);
      whereClause += ` AND r.status = $${params.length}`;
    }

    const countRes = await pool.query(`SELECT COUNT(*) FROM rides r ${whereClause}`, params);

    const limitIdx  = params.length + 1;
    const offsetIdx = params.length + 2;
    params.push(parseInt(limit), offset);

    let isJoinedExpr = 'FALSE';
    if (userId) {
      params.push(userId);
      isJoinedExpr = `EXISTS (
        SELECT 1 FROM ride_participants rp2
        WHERE rp2.ride_id = r.id AND rp2.user_id = $${params.length}
      )`;
    }

    const ridesRes = await pool.query(`
      SELECT
        r.id, r.name, r.description, r.source, r.destination,
        r.start_date, r.start_time, r.end_date, r.end_time,
        r.distance_km, r.duration_hrs,
        r.cover_photo, r.cover_photo_name,
        r.status, r.ride_type, r.is_paid, r.entry_fee,
        r.max_participants, r.cloned_count, r.tags, r.scenic,
        r.created_at,
        u.id         AS host_id,
        u.name       AS host_name,
        u.avatar_url AS host_avatar,
        (SELECT COUNT(*) FROM ride_participants rp
         WHERE rp.ride_id = r.id AND rp.status = 'confirmed') AS participant_count,
        ${isJoinedExpr} AS is_joined
      FROM rides r
      JOIN users u ON u.id = r.created_by
      ${whereClause}
      ORDER BY r.start_date ASC, r.created_at DESC
      LIMIT $${limitIdx} OFFSET $${offsetIdx}
    `, params);

    res.json({
      success: true,
      total:   parseInt(countRes.rows[0].count),
      page:    parseInt(page),
      limit:   parseInt(limit),
      rides:   ridesRes.rows,
    });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/rides/:id
// Returns full ride detail including grouped itinerary days for RideDetailScreen
// ─────────────────────────────────────────────────────────────────────────────
exports.getRideById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id || null;

    const rideRes = await pool.query(`
      SELECT r.*,
        u.id  AS host_id, u.name AS host_name, u.avatar_url AS host_avatar,
        lu.id   AS lead_rider_id_val, lu.name AS lead_rider_name, lu.avatar_url AS lead_rider_avatar,
        mu.id   AS marshal_id_val,    mu.name AS marshal_name,    mu.avatar_url AS marshal_avatar,
        su.id   AS sweep_id_val,      su.name AS sweep_name,      su.avatar_url AS sweep_avatar,
        (SELECT COUNT(*) FROM ride_participants rp
         WHERE rp.ride_id = r.id AND rp.status = 'confirmed') AS participant_count
      FROM rides r
      JOIN  users u  ON u.id  = r.created_by
      LEFT JOIN users lu ON lu.id = r.lead_rider_id
      LEFT JOIN users mu ON mu.id = r.marshal_id
      LEFT JOIN users su ON su.id = r.sweep_id
      WHERE r.id = $1
    `, [id]);

    if (!rideRes.rows.length)
      return res.status(404).json({ success: false, message: 'Ride not found' });

    const ride = rideRes.rows[0];

    const [waypointsRes, participantsRes, expensesRes, weatherRes, requestsRes] =
      await Promise.all([
        // Order by day_number then sort_order for correct grouping
        pool.query(
          `SELECT * FROM ride_waypoints WHERE ride_id=$1
           ORDER BY COALESCE(day_number,1) ASC, sort_order ASC`,
          [id]
        ),
        pool.query(`
          SELECT rp.role, rp.status, rp.joined_at,
                 u.id, u.name, u.avatar_url, u.phone, u.location
          FROM ride_participants rp
          JOIN users u ON u.id = rp.user_id
          WHERE rp.ride_id = $1 AND rp.status = 'confirmed'
          ORDER BY
            CASE rp.role
              WHEN 'host'       THEN 1
              WHEN 'lead_rider' THEN 2
              WHEN 'marshal'    THEN 3
              WHEN 'sweep'      THEN 4
              ELSE 5
            END, rp.joined_at
        `, [id]),
        pool.query(`
          SELECT re.*, u.name AS paid_by_name
          FROM ride_expenses re
          JOIN users u ON u.id = re.paid_by_id
          WHERE re.ride_id = $1 ORDER BY re.created_at
        `, [id]),
        pool.query(`SELECT * FROM ride_weather WHERE ride_id = $1`, [id]),
        userId
          ? pool.query(
              `SELECT status FROM ride_requests WHERE ride_id=$1 AND user_id=$2`,
              [id, userId]
            )
          : { rows: [] },
      ]);

    const totalExpenses = expensesRes.rows.reduce((s, e) => s + parseFloat(e.amount || 0), 0);

    // ── Build grouped itinerary (NEW — used by RideDetailScreen) ──────────────
    const itinerary = groupWaypointsByDay(
      waypointsRes.rows,
      ride.start_date   // e.g. "2024-12-02"
    );

    // ── Total stops count across all days ────────────────────────────────────
    const totalStops = waypointsRes.rows.length;

    res.json({
      success: true,
      ride: {
        ...ride,
        waypoints:      waypointsRes.rows,    // flat array (legacy compat)
        itinerary,                            // grouped by day (for RideDetailScreen)
        total_stops:    totalStops,
        participants:   participantsRes.rows,
        expenses:       expensesRes.rows,
        total_expenses: totalExpenses,
        weather:        weatherRes.rows,
        my_request:     requestsRes.rows[0] || null,
        is_joined:      participantsRes.rows.some(p => p.id === userId),
        is_host:        ride.created_by === userId,
      },
    });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/rides  — create ride
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
      return res.status(400).json({
        success: false,
        message: 'name, source, destination, start_date, start_time are required',
      });

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
      distance_km || null, duration_hrs || null,
      cover_photo || null, cover_photo_name || null,
      ride_type || 'Public', is_paid || false, entry_fee || 0, max_participants || 20,
      tags || [], scenic || false,
      lead_rider_id || null, marshal_id || null, sweep_id || null, group_id || null,
    ]);
    const ride = rideRes.rows[0];

    await client.query(
      `INSERT INTO ride_participants (ride_id, user_id, role, status) VALUES ($1,$2,'host','confirmed')`,
      [ride.id, req.user.id]
    );

    for (let i = 0; i < waypoints.length; i++) {
      const wp = waypoints[i];
      await client.query(
        `INSERT INTO ride_waypoints
           (ride_id, name, stop_time, type, sort_order, day_number, lat, lng)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          ride.id, wp.name, wp.stop_time || null,
          wp.type || 'stop', wp.sort_order ?? i + 1,
          wp.day_number || 1,
          wp.lat || null, wp.lng || null,
        ]
      );
    }

    await client.query(`UPDATE users SET total_rides=total_rides+1 WHERE id=$1`, [req.user.id]);

    await client.query('COMMIT');
    res.status(201).json({ success: true, ride });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally { client.release(); }
};

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/v1/rides/:id  — update ride (host only)
// ─────────────────────────────────────────────────────────────────────────────
exports.updateRide = async (req, res, next) => {
  try {
    const { id } = req.params;
    const check = await pool.query('SELECT created_by FROM rides WHERE id=$1', [id]);
    if (!check.rows.length) return res.status(404).json({ success: false, message: 'Ride not found' });
    if (check.rows[0].created_by !== req.user.id)
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
    `, [name,description,source,destination,start_date,start_time,end_date,end_time,
        distance_km,duration_hrs,cover_photo,cover_photo_name,ride_type,is_paid,entry_fee,
        max_participants,tags,scenic,status,lead_rider_id,marshal_id,sweep_id,id]);

    res.json({ success: true, ride: r.rows[0] });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/v1/rides/:id
// ─────────────────────────────────────────────────────────────────────────────
exports.deleteRide = async (req, res, next) => {
  try {
    const { id } = req.params;
    const check = await pool.query('SELECT created_by FROM rides WHERE id=$1', [id]);
    if (!check.rows.length) return res.status(404).json({ success: false, message: 'Ride not found' });
    if (check.rows[0].created_by !== req.user.id)
      return res.status(403).json({ success: false, message: 'Not authorised' });
    await pool.query('DELETE FROM rides WHERE id=$1', [id]);
    res.json({ success: true, message: 'Ride deleted' });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/rides/:id/join
// Creates a join request (pending) — host approves via respondRequest
// ─────────────────────────────────────────────────────────────────────────────
exports.joinRide = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const { message } = req.body;

    const rideRes = await pool.query('SELECT max_participants, status, created_by FROM rides WHERE id=$1', [id]);
    if (!rideRes.rows.length) return res.status(404).json({ success: false, message: 'Ride not found' });

    const ride = rideRes.rows[0];
    if (ride.created_by === userId)
      return res.status(400).json({ success: false, message: 'You are the host of this ride' });
    if (['completed','cancelled'].includes(ride.status))
      return res.status(400).json({ success: false, message: `Cannot join a ${ride.status} ride` });

    const countRes = await pool.query(
      `SELECT COUNT(*) FROM ride_participants WHERE ride_id=$1 AND status='confirmed'`, [id]
    );
    if (parseInt(countRes.rows[0].count) >= ride.max_participants)
      return res.status(400).json({ success: false, message: 'Ride is full' });

    const existing = await pool.query(
      `SELECT id, status FROM ride_requests WHERE ride_id=$1 AND user_id=$2`, [id, userId]
    );
    if (existing.rows.length)
      return res.status(409).json({
        success: false,
        message: `Join request already ${existing.rows[0].status}`,
        status:  existing.rows[0].status,
      });

    await pool.query(
      `INSERT INTO ride_requests (ride_id, user_id, message) VALUES ($1,$2,$3)`,
      [id, userId, message || null]
    );
    res.status(201).json({ success: true, message: 'Join request sent' });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/v1/rides/:id/leave  — NEW: leave a ride you've joined
// Removes the participant record and any pending/approved request
// ─────────────────────────────────────────────────────────────────────────────
exports.leaveRide = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const userId = req.user.id;

    // Cannot leave if you're the host
    const rideRes = await client.query('SELECT created_by FROM rides WHERE id=$1', [id]);
    if (!rideRes.rows.length)
      return res.status(404).json({ success: false, message: 'Ride not found' });
    if (rideRes.rows[0].created_by === userId)
      return res.status(400).json({ success: false, message: 'Host cannot leave their own ride' });

    await client.query('BEGIN');
    await client.query(
      `DELETE FROM ride_participants WHERE ride_id=$1 AND user_id=$2`, [id, userId]
    );
    await client.query(
      `DELETE FROM ride_requests WHERE ride_id=$1 AND user_id=$2`, [id, userId]
    );
    await client.query('COMMIT');

    res.json({ success: true, message: 'Left ride successfully' });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally { client.release(); }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/rides/:id/clone
// ─────────────────────────────────────────────────────────────────────────────
exports.cloneRide = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const src = await pool.query('SELECT * FROM rides WHERE id=$1', [id]);
    if (!src.rows.length) return res.status(404).json({ success: false, message: 'Ride not found' });
    const orig = src.rows[0];

    await client.query('BEGIN');
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
      req.user.id, `${orig.name} (Clone)`, orig.description, orig.source, orig.destination,
      orig.start_date, orig.start_time, orig.end_date, orig.end_time,
      orig.distance_km, orig.duration_hrs, orig.ride_type, orig.is_paid, orig.entry_fee,
      orig.max_participants, orig.tags, orig.scenic, orig.id,
    ]);
    const clonedId = newRide.rows[0].id;

    // Copy waypoints including new day_number field
    const wps = await client.query(
      `SELECT * FROM ride_waypoints WHERE ride_id=$1 ORDER BY COALESCE(day_number,1), sort_order`,
      [id]
    );
    for (const wp of wps.rows) {
      await client.query(
        `INSERT INTO ride_waypoints
           (ride_id, name, stop_time, type, sort_order, day_number, lat, lng)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [clonedId, wp.name, wp.stop_time, wp.type, wp.sort_order, wp.day_number || 1, wp.lat, wp.lng]
      );
    }

    await client.query(
      `INSERT INTO ride_participants (ride_id, user_id, role, status) VALUES ($1,$2,'host','confirmed')`,
      [clonedId, req.user.id]
    );
    await client.query(`UPDATE users SET total_rides=total_rides+1 WHERE id=$1`, [req.user.id]);

    await client.query('COMMIT');
    res.status(201).json({ success: true, ride: newRide.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally { client.release(); }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/rides/:id/participants
// ─────────────────────────────────────────────────────────────────────────────
exports.getParticipants = async (req, res, next) => {
  try {
    const r = await pool.query(`
      SELECT rp.role, rp.status, rp.joined_at,
             u.id, u.name, u.avatar_url, u.phone, u.location
      FROM ride_participants rp
      JOIN users u ON u.id = rp.user_id
      WHERE rp.ride_id = $1
      ORDER BY
        CASE rp.role
          WHEN 'host'       THEN 1 WHEN 'lead_rider' THEN 2
          WHEN 'marshal'    THEN 3 WHEN 'sweep'       THEN 4 ELSE 5
        END, rp.joined_at
    `, [req.params.id]);
    res.json({ success: true, participants: r.rows });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/rides/:id/waypoints
// ─────────────────────────────────────────────────────────────────────────────
exports.getWaypoints = async (req, res, next) => {
  try {
    const r = await pool.query(
      `SELECT * FROM ride_waypoints WHERE ride_id=$1 ORDER BY COALESCE(day_number,1), sort_order`,
      [req.params.id]
    );
    res.json({ success: true, waypoints: r.rows });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/rides/:id/requests  (host only)
// ─────────────────────────────────────────────────────────────────────────────
exports.getRequests = async (req, res, next) => {
  try {
    const rideRes = await pool.query('SELECT created_by FROM rides WHERE id=$1', [req.params.id]);
    if (!rideRes.rows.length) return res.status(404).json({ success: false, message: 'Ride not found' });
    if (rideRes.rows[0].created_by !== req.user.id)
      return res.status(403).json({ success: false, message: 'Not authorised' });

    const r = await pool.query(`
      SELECT rr.id, rr.status, rr.message, rr.created_at, rr.responded_at,
             u.id AS user_id, u.name, u.avatar_url, u.phone
      FROM ride_requests rr
      JOIN users u ON u.id = rr.user_id
      WHERE rr.ride_id = $1
      ORDER BY rr.created_at DESC
    `, [req.params.id]);
    res.json({ success: true, requests: r.rows });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/v1/rides/:id/requests/:requestId  — approve / reject
// ─────────────────────────────────────────────────────────────────────────────
exports.respondRequest = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { id, requestId } = req.params;
    const { action } = req.body;
    if (!['approve','reject'].includes(action))
      return res.status(400).json({ success: false, message: "action must be 'approve' or 'reject'" });

    const rideRes = await client.query('SELECT created_by, max_participants FROM rides WHERE id=$1', [id]);
    if (!rideRes.rows.length) return res.status(404).json({ success: false, message: 'Ride not found' });
    if (rideRes.rows[0].created_by !== req.user.id)
      return res.status(403).json({ success: false, message: 'Not authorised' });

    await client.query('BEGIN');

    const reqRes = await client.query('SELECT * FROM ride_requests WHERE id=$1 AND ride_id=$2', [requestId, id]);
    if (!reqRes.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Request not found' });
    }

    const rr = reqRes.rows[0];
    if (rr.status !== 'pending') {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: `Request already ${rr.status}` });
    }

    const newStatus = action === 'approve' ? 'approved' : 'rejected';
    await client.query(
      `UPDATE ride_requests SET status=$1, responded_at=NOW() WHERE id=$2`,
      [newStatus, requestId]
    );

    if (action === 'approve') {
      const countRes = await client.query(
        `SELECT COUNT(*) FROM ride_participants WHERE ride_id=$1 AND status='confirmed'`, [id]
      );
      if (parseInt(countRes.rows[0].count) >= rideRes.rows[0].max_participants) {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, message: 'Ride is full' });
      }
      await client.query(
        `INSERT INTO ride_participants (ride_id, user_id, role, status) VALUES ($1,$2,'member','confirmed')
         ON CONFLICT (ride_id, user_id) DO UPDATE SET status='confirmed'`,
        [id, rr.user_id]
      );
    }
    await client.query('COMMIT');
    res.json({ success: true, message: `Request ${newStatus}` });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally { client.release(); }
};

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/v1/rides/:id/status
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

    const r = await pool.query(
      `UPDATE rides SET status=$1, updated_at=NOW() WHERE id=$2 RETURNING id, status`,
      [status, id]
    );
    res.json({ success: true, message: `Ride status updated to ${status}`, ride: r.rows[0] });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/rides/:id/expenses
// ─────────────────────────────────────────────────────────────────────────────
exports.addRideExpense = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, amount, category, payment_method, location, notes } = req.body;
    if (!name || !amount)
      return res.status(400).json({ success: false, message: 'name and amount are required' });

    const participant = await pool.query(
      `SELECT id FROM ride_participants WHERE ride_id=$1 AND user_id=$2 AND status='confirmed'`,
      [id, req.user.id]
    );
    if (!participant.rows.length) {
      const host = await pool.query(`SELECT id FROM rides WHERE id=$1 AND created_by=$2`, [id, req.user.id]);
      if (!host.rows.length)
        return res.status(403).json({ success: false, message: 'Only ride participants can add expenses' });
    }

    const r = await pool.query(`
      INSERT INTO ride_expenses (ride_id, paid_by_id, name, amount, category, payment_method, location, notes)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *
    `, [id, req.user.id, name, amount, category || 'Other', payment_method || 'cash', location || null, notes || null]);

    res.status(201).json({ success: true, expense: r.rows[0] });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/rides/:id/favourite-location
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
