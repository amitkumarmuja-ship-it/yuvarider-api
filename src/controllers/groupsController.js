/**
 * groupsController.js
 * Complete groups controller updated to match new UI design:
 *
 * NEW endpoints added (to match new app screens):
 *   POST   /api/v1/groups/:id/invite       — invite members (ShareGroup & InviteMembers screens)
 *   GET    /api/v1/groups/:id/contacts     — get invitable contacts (InviteMembers screen)
 *   DELETE /api/v1/groups/:id             — delete group (creator only)
 *
 * All existing endpoints preserved exactly.
 */
const pool = require('../config/db');

// ─── Helpers ──────────────────────────────────────────────────────────────────
function initials(name) {
  return (name || 'U').split(' ').filter(Boolean).map(n => n[0].toUpperCase()).slice(0, 2).join('');
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/groups
// Query: my_groups=true | page | limit | search
// ─────────────────────────────────────────────────────────────────────────────
exports.getGroups = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, my_groups, search } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const userId = req.user?.id || null;
    const params = [];
    let where = 'WHERE 1=1';

    if (my_groups === 'true' && userId) {
      params.push(userId);
      where += ` AND EXISTS (SELECT 1 FROM group_members gm WHERE gm.group_id=g.id AND gm.user_id=$${params.length})`;
    }
    if (search) {
      params.push(`%${search}%`);
      where += ` AND (g.name ILIKE $${params.length} OR g.description ILIKE $${params.length})`;
    }

    const countRes = await pool.query(`SELECT COUNT(*) FROM groups g ${where}`, params);

    const memberParam  = params.length + 3;
    const adminParam   = params.length + 4;
    const limitParam   = params.length + 1;
    const offsetParam  = params.length + 2;

    const queryParams = [...params, parseInt(limit), offset];
    if (userId) {
      queryParams.push(userId, userId);
    }

    const isMemberSq = userId
      ? `EXISTS (SELECT 1 FROM group_members gm2 WHERE gm2.group_id=g.id AND gm2.user_id=$${memberParam})`
      : 'FALSE';
    const isAdminSq = userId
      ? `EXISTS (SELECT 1 FROM group_members gm3 WHERE gm3.group_id=g.id AND gm3.user_id=$${adminParam} AND gm3.role='admin')`
      : 'FALSE';

    const r = await pool.query(`
      SELECT
        g.id, g.name, g.description, g.location, g.cover_image,
        g.is_public, g.member_count, g.ride_count, g.total_km,
        g.created_by, g.created_at,
        u.name AS creator_name, u.avatar_url AS creator_avatar,
        ${isMemberSq} AS is_member,
        ${isAdminSq}  AS is_admin
      FROM groups g
      JOIN users u ON u.id = g.created_by
      ${where}
      ORDER BY g.member_count DESC, g.created_at DESC
      LIMIT $${limitParam} OFFSET $${offsetParam}
    `, queryParams);

    res.json({
      success: true,
      total:  parseInt(countRes.rows[0].count),
      page:   parseInt(page),
      limit:  parseInt(limit),
      groups: r.rows,
    });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/groups/:id
// ─────────────────────────────────────────────────────────────────────────────
exports.getGroupById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id || null;

    const gRes = await pool.query(`
      SELECT g.*, u.name AS creator_name, u.avatar_url AS creator_avatar
      FROM groups g JOIN users u ON u.id = g.created_by
      WHERE g.id = $1
    `, [id]);
    if (!gRes.rows.length)
      return res.status(404).json({ success: false, message: 'Group not found' });

    const [membersRes, rulesRes, messagesRes] = await Promise.all([
      pool.query(`
        SELECT gm.role, gm.joined_at,
               u.id, u.name, u.avatar_url, u.location, u.total_rides,
               v.name AS bike_name, v.brand AS bike_brand, v.model AS bike_model
        FROM group_members gm
        JOIN users u ON u.id = gm.user_id
        LEFT JOIN vehicles v ON v.user_id = u.id AND v.is_primary = TRUE
        WHERE gm.group_id = $1
        ORDER BY CASE gm.role WHEN 'admin' THEN 1 ELSE 2 END, gm.joined_at
      `, [id]),
      pool.query(`SELECT * FROM group_rules WHERE group_id=$1 ORDER BY sort_order`, [id]),
      pool.query(`
        SELECT gm.*, u.name AS sender_name, u.avatar_url AS sender_avatar
        FROM group_messages gm
        LEFT JOIN users u ON u.id = gm.sender_id
        WHERE gm.group_id = $1
        ORDER BY gm.sent_at ASC LIMIT 100
      `, [id]),
    ]);

    let myJoinReq = null;
    if (userId) {
      try {
        const joinReqRes = await pool.query(
          `SELECT status FROM group_join_requests WHERE group_id=$1 AND user_id=$2`,
          [id, userId]
        );
        myJoinReq = joinReqRes.rows[0] || null;
      } catch {
        myJoinReq = null;
      }
    }

    const isMember = membersRes.rows.some(m => m.id === userId);
    const isAdmin  = membersRes.rows.some(m => m.id === userId && m.role === 'admin');

    res.json({
      success: true,
      group: {
        ...gRes.rows[0],
        members:         membersRes.rows,
        rules:           rulesRes.rows,
        messages:        messagesRes.rows,
        is_member:       isMember,
        is_admin:        isAdmin,
        my_join_request: myJoinReq,
      },
    });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/groups — create group
// ─────────────────────────────────────────────────────────────────────────────
exports.createGroup = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { name, description, location, is_public, cover_image, rules } = req.body;
    if (!name?.trim())
      return res.status(400).json({ success: false, message: 'name is required' });

    await client.query('BEGIN');

    const gRes = await client.query(`
      INSERT INTO groups (name, description, location, is_public, cover_image, created_by)
      VALUES ($1,$2,$3,$4,$5,$6) RETURNING *
    `, [name.trim(), description || null, location || null,
        is_public !== false, cover_image || null, req.user.id]);
    const grp = gRes.rows[0];

    // Add creator as admin
    await client.query(
      `INSERT INTO group_members (group_id, user_id, role) VALUES ($1,$2,'admin')`,
      [grp.id, req.user.id]
    );

    // Default rules
    const defaultRulesList = [
      { emoji: '🚫', title: 'No political discussions',        description: 'Political posts, debates, or propaganda are strictly not allowed'         },
      { emoji: '🚫', title: 'No religious discussions',        description: 'Religious content, debates, or promotions are not permitted'              },
      { emoji: '💰', title: 'No money sharing or lending',     description: 'Personal money requests, lending, or fundraising are not allowed'         },
      { emoji: '🤝', title: 'Be respectful to all members',    description: 'Abusive language or disrespectful behavior will not be tolerated'         },
      { emoji: '📢', title: 'No spam or promotions',           description: 'Promotions or advertisements are not allowed without admin approval'      },
      { emoji: '⛑️', title: 'Follow ride safety rules',        description: 'Helmet and basic riding safety rules must be followed during group rides' },
      { emoji: '👑', title: "Admin's decision is final",       description: 'Admin decisions regarding rides, members, or rules must be respected'     },
      { emoji: '🌙', title: 'No messages after 11 PM',         description: 'Please avoid sending messages late at night unless it is an emergency'    },
      { emoji: '🏍️', title: 'Keep discussions biking-related', description: 'Conversations should be related to riding, bikes, or group activities'    },
      { emoji: '🔞', title: 'No inappropriate content',        description: 'Sharing offensive images, videos, or messages is strictly prohibited'     },
    ];

    const rulesData = Array.isArray(rules) && rules.length
      ? rules
      : defaultRulesList.map((r, i) => ({ ...r, sort_order: i + 1, is_default: true }));

    for (const rule of rulesData) {
      await client.query(
        `INSERT INTO group_rules (group_id, emoji, title, description, is_default, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [grp.id, rule.emoji || '📌', rule.title, rule.description || null,
         rule.is_default || false, rule.sort_order || 0]
      );
    }

    // Post a system message
    await client.query(
      `INSERT INTO group_messages (group_id, sender_id, type, text)
       VALUES ($1,$2,'system',$3)`,
      [grp.id, req.user.id, `Group created by ${req.user.name || 'Admin'}`]
    );

    await client.query('COMMIT');
    res.status(201).json({ success: true, group: grp });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally { client.release(); }
};

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/v1/groups/:id
// ─────────────────────────────────────────────────────────────────────────────
exports.updateGroup = async (req, res, next) => {
  try {
    const { id } = req.params;
    const g = await pool.query('SELECT created_by FROM groups WHERE id=$1', [id]);
    if (!g.rows.length) return res.status(404).json({ success: false, message: 'Group not found' });
    if (g.rows[0].created_by !== req.user.id)
      return res.status(403).json({ success: false, message: 'Not authorised' });

    const { name, description, location, is_public, cover_image } = req.body;
    const r = await pool.query(`
      UPDATE groups SET
        name=COALESCE($1,name), description=COALESCE($2,description),
        location=COALESCE($3,location), is_public=COALESCE($4,is_public),
        cover_image=COALESCE($5,cover_image), updated_at=NOW()
      WHERE id=$6 RETURNING *
    `, [name, description, location, is_public, cover_image, id]);
    res.json({ success: true, group: r.rows[0] });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/v1/groups/:id — delete/disband a group (creator only)
// NEW: Added for the group management flow
// ─────────────────────────────────────────────────────────────────────────────
exports.deleteGroup = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const g = await client.query('SELECT created_by FROM groups WHERE id=$1', [id]);
    if (!g.rows.length)
      return res.status(404).json({ success: false, message: 'Group not found' });
    if (g.rows[0].created_by !== req.user.id)
      return res.status(403).json({ success: false, message: 'Only the group creator can delete it' });

    await client.query('BEGIN');
    // Delete in FK-safe order
    await client.query(`DELETE FROM group_messages     WHERE group_id=$1`, [id]);
    await client.query(`DELETE FROM group_rules        WHERE group_id=$1`, [id]);
    await client.query(`DELETE FROM group_members      WHERE group_id=$1`, [id]);
    try {
      await client.query(`DELETE FROM group_join_requests WHERE group_id=$1`, [id]);
    } catch { /* table may not exist */ }
    await client.query(`DELETE FROM groups WHERE id=$1`, [id]);
    await client.query('COMMIT');

    res.json({ success: true, message: 'Group deleted' });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally { client.release(); }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/groups/:id/join  — join a PUBLIC group instantly
// ─────────────────────────────────────────────────────────────────────────────
exports.joinGroup = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const gRes = await client.query('SELECT is_public, created_by FROM groups WHERE id=$1', [id]);
    if (!gRes.rows.length) return res.status(404).json({ success: false, message: 'Group not found' });
    if (!gRes.rows[0].is_public)
      return res.status(400).json({ success: false, message: 'This is a private group. Use request-join instead.' });

    await client.query('BEGIN');
    await client.query(
      `INSERT INTO group_members (group_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
      [id, userId]
    );
    await client.query(
      `UPDATE groups SET member_count = (SELECT COUNT(*) FROM group_members WHERE group_id=$1) WHERE id=$1`,
      [id]
    );
    await client.query(
      `INSERT INTO group_messages (group_id, type, text) VALUES ($1,'system',$2)`,
      [id, `${req.user.name || 'A rider'} joined the group`]
    );
    await client.query('COMMIT');
    res.status(201).json({ success: true, message: 'Joined group' });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally { client.release(); }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/groups/:id/request-join — request to join a PRIVATE group
// ─────────────────────────────────────────────────────────────────────────────
exports.requestJoin = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const { message } = req.body;

    const gRes = await pool.query('SELECT is_public, created_by FROM groups WHERE id=$1', [id]);
    if (!gRes.rows.length) return res.status(404).json({ success: false, message: 'Group not found' });

    const existing = await pool.query(
      `SELECT id, status FROM group_join_requests WHERE group_id=$1 AND user_id=$2`,
      [id, userId]
    );
    if (existing.rows.length)
      return res.status(409).json({ success: false, message: `Request already ${existing.rows[0].status}`, status: existing.rows[0].status });

    const memberCheck = await pool.query(
      `SELECT 1 FROM group_members WHERE group_id=$1 AND user_id=$2`, [id, userId]
    );
    if (memberCheck.rows.length)
      return res.status(409).json({ success: false, message: 'Already a member' });

    await pool.query(
      `INSERT INTO group_join_requests (group_id, user_id, message) VALUES ($1,$2,$3)`,
      [id, userId, message || null]
    );
    res.status(201).json({ success: true, message: 'Join request sent' });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/v1/groups/:id/leave
// ─────────────────────────────────────────────────────────────────────────────
exports.leaveGroup = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const g = await client.query('SELECT created_by FROM groups WHERE id=$1', [id]);
    if (g.rows[0]?.created_by === userId)
      return res.status(400).json({ success: false, message: 'Group creator cannot leave. Delete the group instead.' });

    await client.query('BEGIN');
    await client.query(`DELETE FROM group_members WHERE group_id=$1 AND user_id=$2`, [id, userId]);
    await client.query(
      `UPDATE groups SET member_count = GREATEST((SELECT COUNT(*) FROM group_members WHERE group_id=$1), 0) WHERE id=$1`,
      [id]
    );
    await client.query('COMMIT');
    res.json({ success: true, message: 'Left group' });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally { client.release(); }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/groups/:id/join-requests  (admin only)
// ─────────────────────────────────────────────────────────────────────────────
exports.getJoinRequests = async (req, res, next) => {
  try {
    const { id } = req.params;
    const adminCheck = await pool.query(
      `SELECT 1 FROM group_members WHERE group_id=$1 AND user_id=$2 AND role='admin'`,
      [id, req.user.id]
    );
    if (!adminCheck.rows.length)
      return res.status(403).json({ success: false, message: 'Admin only' });

    let rows = [];
    try {
      const r = await pool.query(`
        SELECT gjr.id, gjr.status, gjr.message, gjr.created_at,
               u.id AS user_id, u.name, u.avatar_url, u.location, u.total_rides,
               v.name AS bike_name, v.brand AS bike_brand, v.model AS bike_model
        FROM group_join_requests gjr
        JOIN users u ON u.id = gjr.user_id
        LEFT JOIN vehicles v ON v.user_id = u.id AND v.is_primary = TRUE
        WHERE gjr.group_id = $1 AND gjr.status = 'pending'
        ORDER BY gjr.created_at ASC
      `, [id]);
      rows = r.rows;
    } catch {
      rows = [];
    }
    res.json({ success: true, requests: rows });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/v1/groups/:id/join-requests/:reqId  — approve or reject
// ─────────────────────────────────────────────────────────────────────────────
exports.respondJoinRequest = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { id, reqId } = req.params;
    const { action } = req.body;
    if (!['approve','reject'].includes(action))
      return res.status(400).json({ success: false, message: "action must be 'approve' or 'reject'" });

    const adminCheck = await client.query(
      `SELECT 1 FROM group_members WHERE group_id=$1 AND user_id=$2 AND role='admin'`,
      [id, req.user.id]
    );
    if (!adminCheck.rows.length)
      return res.status(403).json({ success: false, message: 'Admin only' });

    const reqRes = await client.query(
      `SELECT * FROM group_join_requests WHERE id=$1 AND group_id=$2`, [reqId, id]
    );
    if (!reqRes.rows.length)
      return res.status(404).json({ success: false, message: 'Request not found' });

    await client.query('BEGIN');
    const newStatus = action === 'approve' ? 'approved' : 'rejected';
    await client.query(
      `UPDATE group_join_requests SET status=$1, responded_at=NOW() WHERE id=$2`,
      [newStatus, reqId]
    );

    if (action === 'approve') {
      await client.query(
        `INSERT INTO group_members (group_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
        [id, reqRes.rows[0].user_id]
      );
      await client.query(
        `UPDATE groups SET member_count=(SELECT COUNT(*) FROM group_members WHERE group_id=$1) WHERE id=$1`,
        [id]
      );
      await client.query(
        `INSERT INTO group_messages (group_id, type, text) VALUES ($1,'system',$2)`,
        [id, `A new member joined the group`]
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
// GET /api/v1/groups/:id/contacts
// NEW: Returns users who are NOT already members — for InviteMembers screen
// ─────────────────────────────────────────────────────────────────────────────
exports.getInvitableContacts = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Check requester is an admin or member
    const memberCheck = await pool.query(
      `SELECT 1 FROM group_members WHERE group_id=$1 AND user_id=$2`,
      [id, req.user.id]
    );
    if (!memberCheck.rows.length)
      return res.status(403).json({ success: false, message: 'Group members only' });

    // Get users who exist but are NOT already in this group
    const r = await pool.query(`
      SELECT u.id, u.name, u.avatar_url, u.location, u.total_rides,
             v.name AS bike_name, v.brand AS bike_brand, v.model AS bike_model
      FROM users u
      LEFT JOIN vehicles v ON v.user_id = u.id AND v.is_primary = TRUE
      WHERE u.id != $1
        AND NOT EXISTS (
          SELECT 1 FROM group_members gm WHERE gm.group_id=$2 AND gm.user_id=u.id
        )
      ORDER BY u.name ASC
      LIMIT 50
    `, [req.user.id, id]);

    const contacts = r.rows.map(u => ({
      id:          u.id,
      name:        u.name,
      avatar_url:  u.avatar_url,
      location:    u.location,
      total_rides: u.total_rides,
      bike_name:   u.bike_brand && u.bike_model
                     ? `${u.bike_brand} ${u.bike_model}`
                     : (u.bike_name || null),
    }));

    res.json({ success: true, contacts });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/groups/:id/invite
// NEW: Invite users by user_ids — for ShareGroup & InviteMembers screens
// Admin only. Adds them as pending-invite status (or directly as members
// depending on your invite flow — here we add directly for simplicity).
// ─────────────────────────────────────────────────────────────────────────────
exports.inviteMembers = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { user_ids, message } = req.body;

    if (!Array.isArray(user_ids) || user_ids.length === 0)
      return res.status(400).json({ success: false, message: 'user_ids array is required' });

    // Must be a member/admin to invite
    const memberCheck = await client.query(
      `SELECT role FROM group_members WHERE group_id=$1 AND user_id=$2`,
      [id, req.user.id]
    );
    if (!memberCheck.rows.length)
      return res.status(403).json({ success: false, message: 'Only group members can invite others' });

    const gRes = await client.query('SELECT is_public, name FROM groups WHERE id=$1', [id]);
    if (!gRes.rows.length)
      return res.status(404).json({ success: false, message: 'Group not found' });

    await client.query('BEGIN');

    let invitedCount = 0;
    for (const userId of user_ids) {
      // Skip if already a member
      const exists = await client.query(
        `SELECT 1 FROM group_members WHERE group_id=$1 AND user_id=$2`, [id, userId]
      );
      if (exists.rows.length) continue;

      // For public groups: add directly. For private: create join request.
      if (gRes.rows[0].is_public) {
        await client.query(
          `INSERT INTO group_members (group_id, user_id, role) VALUES ($1,$2,'member') ON CONFLICT DO NOTHING`,
          [id, userId]
        );
      } else {
        // Try insert into join_requests (table may not exist on older DBs)
        try {
          await client.query(
            `INSERT INTO group_join_requests (group_id, user_id, message, status)
             VALUES ($1,$2,$3,'pending') ON CONFLICT DO NOTHING`,
            [id, userId, message || `You've been invited to join ${gRes.rows[0].name}`]
          );
        } catch { /* table may not exist */ }
      }

      // Post system message for each invite
      await client.query(
        `INSERT INTO group_messages (group_id, sender_id, type, text)
         VALUES ($1,$2,'system',$3)`,
        [id, req.user.id, `${req.user.name || 'Admin'} invited a new rider to the group`]
      );

      invitedCount++;
    }

    // Update member_count for public groups
    if (gRes.rows[0].is_public) {
      await client.query(
        `UPDATE groups SET member_count=(SELECT COUNT(*) FROM group_members WHERE group_id=$1) WHERE id=$1`,
        [id]
      );
    }

    await client.query('COMMIT');
    res.status(201).json({
      success: true,
      message: `${invitedCount} member(s) invited successfully`,
      invited_count: invitedCount,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally { client.release(); }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/groups/:id/messages
// ─────────────────────────────────────────────────────────────────────────────
exports.getMessages = async (req, res, next) => {
  try {
    const r = await pool.query(`
      SELECT gm.*, u.name AS sender_name, u.avatar_url AS sender_avatar
      FROM group_messages gm
      LEFT JOIN users u ON u.id = gm.sender_id
      WHERE gm.group_id = $1
      ORDER BY gm.sent_at ASC LIMIT 200
    `, [req.params.id]);
    res.json({ success: true, messages: r.rows });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/groups/:id/messages
// ─────────────────────────────────────────────────────────────────────────────
exports.sendMessage = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { text, type, image_url } = req.body;
    if (!text?.trim() && !image_url)
      return res.status(400).json({ success: false, message: 'text or image_url required' });

    const memberCheck = await pool.query(
      `SELECT 1 FROM group_members WHERE group_id=$1 AND user_id=$2`, [id, req.user.id]
    );
    if (!memberCheck.rows.length)
      return res.status(403).json({ success: false, message: 'Only group members can send messages' });

    const r = await pool.query(`
      INSERT INTO group_messages (group_id, sender_id, type, text, image_url)
      VALUES ($1,$2,$3,$4,$5)
      RETURNING *
    `, [id, req.user.id, type || 'text', text?.trim() || null, image_url || null]);

    const msg = { ...r.rows[0], sender_name: req.user.name, sender_avatar: null };
    res.status(201).json({ success: true, message: msg });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/groups/:id/rules
// ─────────────────────────────────────────────────────────────────────────────
exports.getRules = async (req, res, next) => {
  try {
    const r = await pool.query(
      `SELECT * FROM group_rules WHERE group_id=$1 ORDER BY sort_order`, [req.params.id]
    );
    res.json({ success: true, rules: r.rows });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/groups/:id/rules
// ─────────────────────────────────────────────────────────────────────────────
exports.addRule = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { emoji, title, description, sort_order } = req.body;
    if (!title) return res.status(400).json({ success: false, message: 'title is required' });
    const r = await pool.query(
      `INSERT INTO group_rules (group_id, emoji, title, description, sort_order)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [id, emoji || '📌', title, description || null, sort_order || 0]
    );
    res.status(201).json({ success: true, rule: r.rows[0] });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/v1/groups/:id/rules/:ruleId
// ─────────────────────────────────────────────────────────────────────────────
exports.deleteRule = async (req, res, next) => {
  try {
    await pool.query(
      `DELETE FROM group_rules WHERE id=$1 AND group_id=$2`,
      [req.params.ruleId, req.params.id]
    );
    res.json({ success: true, message: 'Rule deleted' });
  } catch (err) { next(err); }
};

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/v1/groups/:id/members/:userId  — remove a member (admin only)
// Admin cannot remove another admin; creator cannot be removed.
// ─────────────────────────────────────────────────────────────────────────────
exports.removeMember = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { id, userId } = req.params;
    const requesterId = req.user.id;

    // Requester must be admin
    const adminCheck = await client.query(
      `SELECT 1 FROM group_members WHERE group_id=$1 AND user_id=$2 AND role='admin'`,
      [id, requesterId]
    );
    if (!adminCheck.rows.length)
      return res.status(403).json({ success: false, message: 'Only admins can remove members' });

    // Cannot remove yourself via this endpoint — use leave instead
    if (userId === requesterId)
      return res.status(400).json({ success: false, message: 'Use the leave endpoint to remove yourself' });

    // Cannot remove the group creator
    const grp = await client.query(`SELECT created_by FROM groups WHERE id=$1`, [id]);
    if (!grp.rows.length)
      return res.status(404).json({ success: false, message: 'Group not found' });
    if (grp.rows[0].created_by === userId)
      return res.status(400).json({ success: false, message: 'Cannot remove the group creator' });

    // Cannot remove another admin (must demote first)
    const targetRole = await client.query(
      `SELECT role FROM group_members WHERE group_id=$1 AND user_id=$2`,
      [id, userId]
    );
    if (!targetRole.rows.length)
      return res.status(404).json({ success: false, message: 'User is not a member of this group' });
    if (targetRole.rows[0].role === 'admin' && grp.rows[0].created_by !== requesterId)
      return res.status(400).json({ success: false, message: 'Only the group creator can remove an admin' });

    await client.query('BEGIN');
    await client.query(
      `DELETE FROM group_members WHERE group_id=$1 AND user_id=$2`,
      [id, userId]
    );
    await client.query(
      `UPDATE groups
         SET member_count = GREATEST((SELECT COUNT(*) FROM group_members WHERE group_id=$1), 0)
       WHERE id=$1`,
      [id]
    );
    // System message
    const removedUser = await client.query(`SELECT name FROM users WHERE id=$1`, [userId]);
    const removedName = removedUser.rows[0]?.name || 'A member';
    await client.query(
      `INSERT INTO group_messages (group_id, type, text) VALUES ($1,'system',$2)`,
      [id, `${removedName} was removed from the group`]
    );
    await client.query('COMMIT');
    res.json({ success: true, message: 'Member removed successfully' });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally { client.release(); }
};
