const pool = require('../config/db');

/**
 * isUploadedFilename — true for real server-uploaded files like "uuid.jpg".
 * Used to decide whether a value can be used to build a /uploads/<file> URL.
 * Preset display names like "Mountain Pass" or "Beach Drive" return false.
 */
function isUploadedFilename(val) {
  if (!val || typeof val !== 'string') return false;
  return val.includes('.') && !val.includes(' ');
}

/**
 * sanitizeCoverPhotoName — returns any non-empty string as-is.
 * cover_photo_name stores whatever the user chose: uploaded filename OR preset name.
 * It is the human-readable / display identifier. Always save it if provided.
 */
function sanitizeCoverPhotoName(val) {
  return (val && typeof val === 'string' && val.trim()) ? val.trim() : null;
}
require('dotenv').config();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseDateSafe(dateStr) {
  if (!dateStr) return null;
  try {
    const datePart = String(dateStr).split('T')[0];
    const parts = datePart.split('-').map(Number);
    if (parts.length < 3 || parts.some(isNaN)) return null;
    const [y, m, d] = parts;
    if (y < 2000 || m < 1 || m > 12 || d < 1 || d > 31) return null;
    return new Date(y, m - 1, d);
  } catch { return null; }
}

function buildDayLabel(startDateStr, dayNumber) {
  const WEEKDAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  try {
    const base = parseDateSafe(startDateStr);
    if (!base) return `Day ${dayNumber}`;
    base.setDate(base.getDate() + dayNumber - 1);
    return `Day ${dayNumber} - ${WEEKDAYS[base.getDay()]}`;
  } catch { return `Day ${dayNumber}`; }
}

function groupWaypointsByDay(waypoints, startDate) {
  const map = new Map();
  for (const wp of waypoints) {
    const dayNum = wp.day_number || 1;
    if (!map.has(dayNum)) map.set(dayNum, []);
    map.get(dayNum).push(wp);
  }
  const itinerary = [];
  for (const [dayNum, stops] of [...map.entries()].sort((a, b) => a[0] - b[0])) {
    itinerary.push({ day_number: dayNum, day_label: buildDayLabel(startDate, dayNum), stops });
  }
  return itinerary;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/rides
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
      if (!userId) return res.json({ success: true, total: 0, page: 1, limit: parseInt(limit), rides: [] });
      params.push(userId);
      whereClause += ` AND (r.created_by = $1 OR EXISTS (
        SELECT 1 FROM ride_participants rp WHERE rp.ride_id = r.id AND rp.user_id = $1
      ))`;
    } else if (status) {
      params.push(status);
      whereClause += ` AND r.status = $${params.length}`;
    }

    const countRes = await pool.query(`SELECT COUNT(*) FROM rides r ${whereClause}`, params);
    const limitIdx = params.length + 1;
    const offsetIdx = params.length + 2;
    params.push(parseInt(limit), offset);

    let isJoinedExpr = 'FALSE';
    if (userId) {
      params.push(userId);
      isJoinedExpr = `EXISTS (SELECT 1 FROM ride_participants rp2 WHERE rp2.ride_id = r.id AND rp2.user_id = $${params.length})`;
    }

    const ridesRes = await pool.query(`
      SELECT r.id, r.name, r.description, r.source, r.destination,
        r.start_date, r.start_time, r.end_date, r.end_time,
        r.distance_km, r.duration_hrs, r.cover_photo, r.cover_photo_name,
        r.status, r.ride_type, r.is_paid, r.entry_fee,
        r.max_participants, r.cloned_count, r.tags, r.scenic, r.created_at,
        u.id AS host_id, u.name AS host_name, u.avatar_url AS host_avatar,
        (SELECT COUNT(*) FROM ride_participants rp WHERE rp.ride_id = r.id AND rp.status = 'confirmed') AS participant_count,
        ${isJoinedExpr} AS is_joined
      FROM rides r
      JOIN users u ON u.id = r.created_by
      ${whereClause}
      ORDER BY r.start_date ASC, r.created_at DESC
      LIMIT $${limitIdx} OFFSET $${offsetIdx}
    `, params);

    res.json({ success: true, total: parseInt(countRes.rows[0].count), page: parseInt(page), limit: parseInt(limit), rides: ridesRes.rows });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/rides/:id
// FIX: Build a complete participants array that includes host + role-assigned
//      users from rides.lead_rider_id / marshal_id / sweep_id, even if they
//      are not yet in the ride_participants table.
// ─────────────────────────────────────────────────────────────────────────────
exports.getRideById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id || null;

    const rideRes = await pool.query(`
      SELECT r.*,
        u.id  AS host_id,   u.name AS host_name,   u.avatar_url AS host_avatar,
        lu.id AS lead_rider_id_val, lu.name AS lead_rider_name, lu.avatar_url AS lead_rider_avatar,
        mu.id AS marshal_id_val,    mu.name AS marshal_name,    mu.avatar_url AS marshal_avatar,
        su.id AS sweep_id_val,      su.name AS sweep_name,      su.avatar_url AS sweep_avatar,
        (SELECT COUNT(*) FROM ride_participants rp
         WHERE rp.ride_id = r.id AND rp.status = 'confirmed') AS participant_count
      FROM rides r
      JOIN  users u  ON u.id = r.created_by
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
        pool.query(
          `SELECT * FROM ride_waypoints WHERE ride_id=$1 ORDER BY COALESCE(day_number,1) ASC, sort_order ASC`,
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
              WHEN 'host'       THEN 1 WHEN 'lead_rider' THEN 2
              WHEN 'marshal'    THEN 3 WHEN 'sweep'       THEN 4 ELSE 5
            END, rp.joined_at
        `, [id]),
        pool.query(`
          SELECT re.*, u.name AS paid_by_name
          FROM ride_expenses re JOIN users u ON u.id = re.paid_by_id
          WHERE re.ride_id = $1 ORDER BY re.created_at
        `, [id]),
        pool.query(`SELECT * FROM ride_weather WHERE ride_id = $1`, [id]),
        userId
          ? pool.query(`SELECT status FROM ride_requests WHERE ride_id=$1 AND user_id=$2`, [id, userId])
          : { rows: [] },
      ]);

    // ── MERGE role-assigned users into participants array ─────────────────────
    // ride_participants may only contain the host (e.g. for newly created rides).
    // Lead rider, marshal, sweep are stored in rides.lead_rider_id etc.
    // We merge them so RideDetailScreen always has a complete list.
    const participantMap = new Map();

    // First, add everyone already in ride_participants
    for (const p of participantsRes.rows) {
      participantMap.set(p.id, p);
    }

    // Then, add/upsert lead_rider from rides table if not already present
    if (ride.lead_rider_id_val && ride.lead_rider_name) {
      if (!participantMap.has(ride.lead_rider_id_val)) {
        participantMap.set(ride.lead_rider_id_val, {
          id:         ride.lead_rider_id_val,
          name:       ride.lead_rider_name,
          avatar_url: ride.lead_rider_avatar || null,
          role:       'lead_rider',
          status:     'confirmed',
          joined_at:  ride.created_at,
          phone:      null,
          location:   null,
        });
      } else {
        // Already in table but might have wrong role — update role
        const existing = participantMap.get(ride.lead_rider_id_val);
        if (existing.role === 'member') {
          participantMap.set(ride.lead_rider_id_val, { ...existing, role: 'lead_rider' });
        }
      }
    }

    // Marshal
    if (ride.marshal_id_val && ride.marshal_name) {
      if (!participantMap.has(ride.marshal_id_val)) {
        participantMap.set(ride.marshal_id_val, {
          id:         ride.marshal_id_val,
          name:       ride.marshal_name,
          avatar_url: ride.marshal_avatar || null,
          role:       'marshal',
          status:     'confirmed',
          joined_at:  ride.created_at,
          phone:      null,
          location:   null,
        });
      } else {
        const existing = participantMap.get(ride.marshal_id_val);
        if (existing.role === 'member') {
          participantMap.set(ride.marshal_id_val, { ...existing, role: 'marshal' });
        }
      }
    }

    // Sweep
    if (ride.sweep_id_val && ride.sweep_name) {
      if (!participantMap.has(ride.sweep_id_val)) {
        participantMap.set(ride.sweep_id_val, {
          id:         ride.sweep_id_val,
          name:       ride.sweep_name,
          avatar_url: ride.sweep_avatar || null,
          role:       'sweep',
          status:     'confirmed',
          joined_at:  ride.created_at,
          phone:      null,
          location:   null,
        });
      } else {
        const existing = participantMap.get(ride.sweep_id_val);
        if (existing.role === 'member') {
          participantMap.set(ride.sweep_id_val, { ...existing, role: 'sweep' });
        }
      }
    }

    // Sort merged list: host → lead_rider → marshal → sweep → member
    const ROLE_ORDER = { host: 1, lead_rider: 2, marshal: 3, sweep: 4, member: 5 };
    const mergedParticipants = [...participantMap.values()].sort((a, b) => {
      return (ROLE_ORDER[a.role] || 5) - (ROLE_ORDER[b.role] || 5);
    });

    const totalExpenses = expensesRes.rows.reduce((s, e) => s + parseFloat(e.amount || 0), 0);
    const itinerary = groupWaypointsByDay(waypointsRes.rows, ride.start_date);
    const totalStops = waypointsRes.rows.length;

    res.json({
      success: true,
      ride: {
        ...ride,
        waypoints:      waypointsRes.rows,
        itinerary,
        total_stops:    totalStops,
        participants:   mergedParticipants,   // ← NOW includes all roles
        expenses:       expensesRes.rows,
        total_expenses: totalExpenses,
        weather:        weatherRes.rows,
        my_request:     requestsRes.rows[0] || null,
        is_joined:      mergedParticipants.some(p => p.id === userId && p.role !== 'host'),
        is_host:        ride.created_by === userId,
      },
    });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/rides — create ride
// FIX: After creating the ride, INSERT lead_rider/marshal/sweep into
//      ride_participants so they show up correctly in getRideById.
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
      distance_km || null, duration_hrs || null,
      // cover_photo      = real uploaded filename only (uuid.jpg) — used to build /uploads/ URL.
      // cover_photo_name = any name the user chose: uploaded uuid.jpg OR preset like "Mountain Pass".
      //                    This is what the frontend reads back to pre-fill the cover photo picker.
      (isUploadedFilename(cover_photo) ? cover_photo : isUploadedFilename(cover_photo_name) ? cover_photo_name : null),
      sanitizeCoverPhotoName(cover_photo_name) || sanitizeCoverPhotoName(cover_photo) || null,
      ride_type || 'Public', is_paid || false, entry_fee || 0, max_participants || 20,
      tags || [], scenic || false,
      lead_rider_id || null, marshal_id || null, sweep_id || null, group_id || null,
    ]);
    const ride = rideRes.rows[0];

    // Insert host
    await client.query(
      `INSERT INTO ride_participants (ride_id, user_id, role, status) VALUES ($1,$2,'host','confirmed')`,
      [ride.id, req.user.id]
    );

    // FIX: Insert lead_rider, marshal, sweep into ride_participants
    // Use ON CONFLICT to handle case where they are the same as host
    const roleInserts = [
      lead_rider_id ? [ride.id, lead_rider_id, 'lead_rider'] : null,
      marshal_id    ? [ride.id, marshal_id,    'marshal'   ] : null,
      sweep_id      ? [ride.id, sweep_id,      'sweep'     ] : null,
    ].filter(Boolean);

    for (const [rideId, uid, role] of roleInserts) {
      if (uid !== req.user.id) { // Don't re-insert if they're also the host
        await client.query(
          `INSERT INTO ride_participants (ride_id, user_id, role, status)
           VALUES ($1,$2,$3,'confirmed')
           ON CONFLICT (ride_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
          [rideId, uid, role]
        );
      }
    }

    // Insert waypoints with day_number
    for (let i = 0; i < waypoints.length; i++) {
      const wp = waypoints[i];
      await client.query(
        `INSERT INTO ride_waypoints (ride_id, name, stop_time, type, sort_order, day_number, lat, lng)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [ride.id, wp.name, wp.stop_time || null, wp.type || 'stop',
         wp.sort_order ?? i + 1, wp.day_number || 1, wp.lat || null, wp.lng || null]
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
// PUT /api/v1/rides/:id — update ride
// FIX: Also upsert role participants when roles change
// ─────────────────────────────────────────────────────────────────────────────
exports.updateRide = async (req, res, next) => {
  const client = await pool.connect();
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

    await client.query('BEGIN');

    // cover_photo      = real uploaded uuid.jpg only  — used to build /uploads/<file> URL.
    //                    Set only when the value looks like an uploaded file.
    // cover_photo_name = any display name the user chose: uuid.jpg OR a preset like "Mountain Pass".
    //                    Always saved if provided so the picker is pre-filled on next edit.
    // Both use COALESCE($N, column) so omitting them (undefined→null) keeps the existing DB value.
    const newCoverPhoto = isUploadedFilename(cover_photo_name) ? cover_photo_name
                        : isUploadedFilename(cover_photo)      ? cover_photo
                        : undefined;                           // keep existing

    const newCoverPhotoName = sanitizeCoverPhotoName(cover_photo_name)
                           || sanitizeCoverPhotoName(cover_photo)
                           || undefined;                       // keep existing

    const r = await client.query(`
      UPDATE rides SET
        name=COALESCE($1,name), description=COALESCE($2,description),
        source=COALESCE($3,source), destination=COALESCE($4,destination),
        start_date=COALESCE($5,start_date), start_time=COALESCE($6,start_time),
        end_date=COALESCE($7,end_date), end_time=COALESCE($8,end_time),
        distance_km=COALESCE($9,distance_km), duration_hrs=COALESCE($10,duration_hrs),
        cover_photo=COALESCE($11,cover_photo),
        cover_photo_name=COALESCE($12,cover_photo_name),
        ride_type=COALESCE($13,ride_type), is_paid=COALESCE($14,is_paid),
        entry_fee=COALESCE($15,entry_fee), max_participants=COALESCE($16,max_participants),
        tags=COALESCE($17,tags), scenic=COALESCE($18,scenic), status=COALESCE($19,status),
        lead_rider_id=COALESCE($20,lead_rider_id),
        marshal_id=COALESCE($21,marshal_id), sweep_id=COALESCE($22,sweep_id),
        updated_at=NOW()
      WHERE id=$23 RETURNING *
    `, [name, description, source, destination, start_date, start_time, end_date, end_time,
        distance_km, duration_hrs,
        newCoverPhoto     || null,
        newCoverPhotoName || null,
        ride_type, is_paid, entry_fee,
        max_participants, tags, scenic, status,
        lead_rider_id, marshal_id, sweep_id, id]);

    // FIX: Upsert role participants when roles change
    const roleUpdates = [
      lead_rider_id ? [id, lead_rider_id, 'lead_rider'] : null,
      marshal_id    ? [id, marshal_id,    'marshal'   ] : null,
      sweep_id      ? [id, sweep_id,      'sweep'     ] : null,
    ].filter(Boolean);

    for (const [rideId, uid, role] of roleUpdates) {
      if (uid !== req.user.id) {
        await client.query(
          `INSERT INTO ride_participants (ride_id, user_id, role, status)
           VALUES ($1,$2,$3,'confirmed')
           ON CONFLICT (ride_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
          [rideId, uid, role]
        );
      }
    }

    await client.query('COMMIT');
    res.json({ success: true, ride: r.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally { client.release(); }
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
// ─────────────────────────────────────────────────────────────────────────────
exports.joinRide = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const { message } = req.body;

    const rideRes = await pool.query('SELECT max_participants, status, created_by FROM rides WHERE id=$1', [id]);
    if (!rideRes.rows.length) return res.status(404).json({ success: false, message: 'Ride not found' });

    const ride = rideRes.rows[0];
    if (ride.created_by === userId) return res.status(400).json({ success: false, message: 'You are the host of this ride' });
    if (['completed','cancelled'].includes(ride.status)) return res.status(400).json({ success: false, message: `Cannot join a ${ride.status} ride` });

    const countRes = await pool.query(`SELECT COUNT(*) FROM ride_participants WHERE ride_id=$1 AND status='confirmed'`, [id]);
    if (parseInt(countRes.rows[0].count) >= ride.max_participants) return res.status(400).json({ success: false, message: 'Ride is full' });

    const existing = await pool.query(`SELECT id, status FROM ride_requests WHERE ride_id=$1 AND user_id=$2`, [id, userId]);
    if (existing.rows.length) return res.status(409).json({ success: false, message: `Join request already ${existing.rows[0].status}`, status: existing.rows[0].status });

    await pool.query(`INSERT INTO ride_requests (ride_id, user_id, message) VALUES ($1,$2,$3)`, [id, userId, message || null]);
    res.status(201).json({ success: true, message: 'Join request sent' });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/v1/rides/:id/leave
// ─────────────────────────────────────────────────────────────────────────────
exports.leaveRide = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const rideRes = await client.query('SELECT created_by FROM rides WHERE id=$1', [id]);
    if (!rideRes.rows.length) return res.status(404).json({ success: false, message: 'Ride not found' });
    if (rideRes.rows[0].created_by === userId) return res.status(400).json({ success: false, message: 'Host cannot leave their own ride' });
    await client.query('BEGIN');
    await client.query(`DELETE FROM ride_participants WHERE ride_id=$1 AND user_id=$2`, [id, userId]);
    await client.query(`DELETE FROM ride_requests     WHERE ride_id=$1 AND user_id=$2`, [id, userId]);
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
      INSERT INTO rides (created_by, name, description, source, destination,
        start_date, start_time, end_date, end_time, distance_km, duration_hrs,
        ride_type, is_paid, entry_fee, max_participants, tags, scenic, parent_ride_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
      RETURNING *
    `, [req.user.id, `${orig.name} (Clone)`, orig.description, orig.source, orig.destination,
        orig.start_date, orig.start_time, orig.end_date, orig.end_time,
        orig.distance_km, orig.duration_hrs, orig.ride_type, orig.is_paid, orig.entry_fee,
        orig.max_participants, orig.tags, orig.scenic, orig.id]);
    const clonedId = newRide.rows[0].id;

    const wps = await client.query(
      `SELECT * FROM ride_waypoints WHERE ride_id=$1 ORDER BY COALESCE(day_number,1), sort_order`, [id]
    );
    for (const wp of wps.rows) {
      await client.query(
        `INSERT INTO ride_waypoints (ride_id, name, stop_time, type, sort_order, day_number, lat, lng)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [clonedId, wp.name, wp.stop_time, wp.type, wp.sort_order, wp.day_number || 1, wp.lat, wp.lng]
      );
    }

    await client.query(`INSERT INTO ride_participants (ride_id, user_id, role, status) VALUES ($1,$2,'host','confirmed')`, [clonedId, req.user.id]);
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
      SELECT rp.role, rp.status, rp.joined_at, u.id, u.name, u.avatar_url, u.phone, u.location
      FROM ride_participants rp
      JOIN users u ON u.id = rp.user_id
      WHERE rp.ride_id = $1
      ORDER BY CASE rp.role WHEN 'host' THEN 1 WHEN 'lead_rider' THEN 2 WHEN 'marshal' THEN 3 WHEN 'sweep' THEN 4 ELSE 5 END, rp.joined_at
    `, [req.params.id]);
    res.json({ success: true, participants: r.rows });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/rides/:id/waypoints
// ─────────────────────────────────────────────────────────────────────────────
exports.getWaypoints = async (req, res, next) => {
  try {
    const r = await pool.query(`SELECT * FROM ride_waypoints WHERE ride_id=$1 ORDER BY COALESCE(day_number,1), sort_order`, [req.params.id]);
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
    if (rideRes.rows[0].created_by !== req.user.id) return res.status(403).json({ success: false, message: 'Not authorised' });
    const r = await pool.query(`
      SELECT rr.id, rr.status, rr.message, rr.created_at, rr.responded_at,
             u.id AS user_id, u.name, u.avatar_url, u.phone
      FROM ride_requests rr JOIN users u ON u.id = rr.user_id
      WHERE rr.ride_id = $1 ORDER BY rr.created_at DESC
    `, [req.params.id]);
    res.json({ success: true, requests: r.rows });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/v1/rides/:id/requests/:requestId — approve / reject
// ─────────────────────────────────────────────────────────────────────────────
exports.respondRequest = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { id, requestId } = req.params;
    const { action } = req.body;
    if (!['approve','reject'].includes(action)) return res.status(400).json({ success: false, message: "action must be 'approve' or 'reject'" });
    const rideRes = await client.query('SELECT created_by, max_participants FROM rides WHERE id=$1', [id]);
    if (!rideRes.rows.length) return res.status(404).json({ success: false, message: 'Ride not found' });
    if (rideRes.rows[0].created_by !== req.user.id) return res.status(403).json({ success: false, message: 'Not authorised' });
    await client.query('BEGIN');
    const reqRes = await client.query('SELECT * FROM ride_requests WHERE id=$1 AND ride_id=$2', [requestId, id]);
    if (!reqRes.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, message: 'Request not found' }); }
    const rr = reqRes.rows[0];
    if (rr.status !== 'pending') { await client.query('ROLLBACK'); return res.status(400).json({ success: false, message: `Request already ${rr.status}` }); }
    const newStatus = action === 'approve' ? 'approved' : 'rejected';
    await client.query(`UPDATE ride_requests SET status=$1, responded_at=NOW() WHERE id=$2`, [newStatus, requestId]);
    if (action === 'approve') {
      const countRes = await client.query(`SELECT COUNT(*) FROM ride_participants WHERE ride_id=$1 AND status='confirmed'`, [id]);
      if (parseInt(countRes.rows[0].count) >= rideRes.rows[0].max_participants) { await client.query('ROLLBACK'); return res.status(400).json({ success: false, message: 'Ride is full' }); }
      await client.query(
        `INSERT INTO ride_participants (ride_id, user_id, role, status) VALUES ($1,$2,'member','confirmed') ON CONFLICT (ride_id, user_id) DO UPDATE SET status='confirmed'`,
        [id, rr.user_id]
      );
    }
    await client.query('COMMIT');
    res.json({ success: true, message: `Request ${newStatus}` });
  } catch (err) { await client.query('ROLLBACK'); next(err); } finally { client.release(); }
};

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/v1/rides/:id/status
// ─────────────────────────────────────────────────────────────────────────────
exports.updateStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const valid = ['upcoming','active','completed','cancelled'];
    if (!valid.includes(status)) return res.status(400).json({ success: false, message: `status must be one of: ${valid.join(',')}` });
    const rideRes = await pool.query('SELECT created_by FROM rides WHERE id=$1', [id]);
    if (!rideRes.rows.length) return res.status(404).json({ success: false, message: 'Ride not found' });
    if (rideRes.rows[0].created_by !== req.user.id) return res.status(403).json({ success: false, message: 'Not authorised' });
    const r = await pool.query(`UPDATE rides SET status=$1, updated_at=NOW() WHERE id=$2 RETURNING id, status`, [status, id]);
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
    if (!name || !amount) return res.status(400).json({ success: false, message: 'name and amount are required' });
    const participant = await pool.query(`SELECT id FROM ride_participants WHERE ride_id=$1 AND user_id=$2 AND status='confirmed'`, [id, req.user.id]);
    if (!participant.rows.length) {
      const host = await pool.query(`SELECT id FROM rides WHERE id=$1 AND created_by=$2`, [id, req.user.id]);
      if (!host.rows.length) return res.status(403).json({ success: false, message: 'Only ride participants can add expenses' });
    }
    const r = await pool.query(
      `INSERT INTO ride_expenses (ride_id, paid_by_id, name, amount, category, payment_method, location, notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [id, req.user.id, name, amount, category || 'Other', payment_method || 'cash', location || null, notes || null]
    );
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
    const r = await pool.query(`INSERT INTO favourite_locations (user_id, ride_id, name, lat, lng) VALUES ($1,$2,$3,$4,$5) RETURNING *`, [req.user.id, id, name, lat || null, lng || null]);
    res.status(201).json({ success: true, location: r.rows[0] });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/auth/users/search
// FIXED: Returns ALL active users when q is empty so the modal can show a
//         full rider list immediately on open (no typing required).
//         When q is provided, filters by name or email (case-insensitive).
//         Also returns primary vehicle info for display in the picker.
// ─────────────────────────────────────────────────────────────────────────────
exports.searchUsers = async (req, res, next) => {
  try {
    const { q = '', limit = 50 } = req.query;
    const trimmed = String(q).trim();
    const lim = Math.min(parseInt(limit) || 50, 100);

    let r;
    if (!trimmed) {
      // No query → return ALL active users except self, sorted by total_rides desc
      r = await pool.query(`
        SELECT
          u.id, u.name, u.email, u.avatar_url, u.location, u.total_rides, u.bio,
          v.name AS bike_name, v.brand AS bike_brand, v.model AS bike_model
        FROM users u
        LEFT JOIN vehicles v ON v.user_id = u.id AND v.is_primary = TRUE
        WHERE u.id != $1 AND u.is_active = TRUE
        ORDER BY u.total_rides DESC, u.name ASC
        LIMIT $2
      `, [req.user.id, lim]);
    } else {
      // Has query → filter by name or email
      const pattern = `%${trimmed}%`;
      r = await pool.query(`
        SELECT
          u.id, u.name, u.email, u.avatar_url, u.location, u.total_rides, u.bio,
          v.name AS bike_name, v.brand AS bike_brand, v.model AS bike_model
        FROM users u
        LEFT JOIN vehicles v ON v.user_id = u.id AND v.is_primary = TRUE
        WHERE (u.name ILIKE $1 OR u.email ILIKE $1)
          AND u.id != $2 AND u.is_active = TRUE
        ORDER BY u.total_rides DESC, u.name ASC
        LIMIT $3
      `, [pattern, req.user.id, lim]);
    }
    res.json({ success: true, users: r.rows });
  } catch (err) { next(err); }
};
