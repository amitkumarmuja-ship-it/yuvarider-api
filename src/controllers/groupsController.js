const pool = require('../config/db');

// GET /api/groups
exports.getGroups = async (req, res, next) => {
  try {
    const { page=1, limit=20, my_groups } = req.query;
    const offset = (parseInt(page)-1) * parseInt(limit);
    const userId = req.user?.id;

    let where = 'WHERE 1=1';
    const params = [];
    if (my_groups === 'true' && userId) {
      where += ` AND EXISTS (SELECT 1 FROM group_members gm WHERE gm.group_id=g.id AND gm.user_id=$${params.length+1})`;
      params.push(userId);
    }

    const total = await pool.query(`SELECT COUNT(*) FROM groups g ${where}`, params);
    params.push(parseInt(limit), offset);

    const r = await pool.query(`
      SELECT g.*,
        u.name AS creator_name,
        CASE WHEN ${ userId ? `EXISTS (SELECT 1 FROM group_members gm WHERE gm.group_id=g.id AND gm.user_id='${userId}')` : 'FALSE'} THEN TRUE ELSE FALSE END AS is_member,
        CASE WHEN ${ userId ? `EXISTS (SELECT 1 FROM group_members gm WHERE gm.group_id=g.id AND gm.user_id='${userId}' AND gm.role='admin')` : 'FALSE'} THEN TRUE ELSE FALSE END AS is_admin
      FROM groups g
      JOIN users u ON u.id=g.created_by
      ${where}
      ORDER BY g.member_count DESC
      LIMIT $${params.length-1} OFFSET $${params.length}
    `, params);

    res.json({ success: true, total: parseInt(total.rows[0].count), groups: r.rows });
  } catch (err) { next(err); }
};

// GET /api/groups/:id
exports.getGroupById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;

    const gRes = await pool.query(`
      SELECT g.*, u.name AS creator_name, u.avatar_url AS creator_avatar
      FROM groups g JOIN users u ON u.id=g.created_by WHERE g.id=$1
    `, [id]);
    if (!gRes.rows.length) return res.status(404).json({ success: false, message: 'Group not found' });

    const [membersRes, rulesRes, messagesRes] = await Promise.all([
      pool.query(`
        SELECT gm.role, gm.joined_at, u.id, u.name, u.avatar_url, u.location
        FROM group_members gm JOIN users u ON u.id=gm.user_id
        WHERE gm.group_id=$1 ORDER BY gm.role DESC, gm.joined_at
      `, [id]),
      pool.query(`SELECT * FROM group_rules WHERE group_id=$1 ORDER BY sort_order`, [id]),
      pool.query(`
        SELECT gm.*, u.name AS sender_name, u.avatar_url AS sender_avatar
        FROM group_messages gm LEFT JOIN users u ON u.id=gm.sender_id
        WHERE gm.group_id=$1 ORDER BY gm.sent_at ASC LIMIT 100
      `, [id]),
    ]);

    res.json({
      success: true,
      group: {
        ...gRes.rows[0],
        members:  membersRes.rows,
        rules:    rulesRes.rows,
        messages: messagesRes.rows,
        is_member: membersRes.rows.some(m => m.id === userId),
        is_admin:  membersRes.rows.some(m => m.id === userId && m.role === 'admin'),
      },
    });
  } catch (err) { next(err); }
};

// POST /api/groups
exports.createGroup = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { name, description, location, is_public, rules } = req.body;
    if (!name) return res.status(400).json({ success: false, message: 'name is required' });

    await client.query('BEGIN');

    const gRes = await client.query(`
      INSERT INTO groups (name, description, location, is_public, created_by)
      VALUES ($1,$2,$3,$4,$5) RETURNING *
    `, [name, description||null, location||null, is_public!==false, req.user.id]);
    const grp = gRes.rows[0];

    // Add creator as admin member
    await client.query(
      `INSERT INTO group_members (group_id, user_id, role) VALUES ($1,$2,'admin')`,
      [grp.id, req.user.id]
    );

    // Insert default or custom rules
    const defaultRules = [
      ['No political discussions','Political posts, debates, or propaganda are strictly not allowed'],
      ['No religious discussions','Religious content, debates, or promotions are not permitted'],
      ['No money sharing or lending','Personal money requests, lending, or fundraising are not allowed'],
      ['Be respectful to all members','Abusive language or disrespectful behavior will not be tolerated'],
      ['No spam or promotions','Promotions or advertisements are not allowed without admin approval'],
      ['Follow ride safety rules','Helmet and basic riding safety rules must be followed'],
      ["Admin decision is final",'Admin decisions regarding rides, members, or rules must be respected'],
      ['No messages after 11 PM','Please avoid sending messages late at night unless emergency'],
      ['Keep discussions biking-related','Conversations should be related to riding, bikes, or group activities'],
      ['No inappropriate content','Sharing offensive images or messages is strictly prohibited'],
    ];

    const rulesData = Array.isArray(rules) && rules.length ? rules : defaultRules.map((r,i) => ({ title:r[0], description:r[1], sort_order:i+1, is_default:true }));
    for (const rule of rulesData) {
      await client.query(
        `INSERT INTO group_rules (group_id, emoji, title, description, is_default, sort_order) VALUES ($1,$2,$3,$4,$5,$6)`,
        [grp.id, rule.emoji||'📌', rule.title, rule.description||null, rule.is_default||false, rule.sort_order||0]
      );
    }

    await client.query('COMMIT');
    res.status(201).json({ success: true, group: grp });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally { client.release(); }
};

// PUT /api/groups/:id
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

// POST /api/groups/:id/join
exports.joinGroup = async (req, res, next) => {
  try {
    const { id } = req.params;
    await pool.query(
      `INSERT INTO group_members (group_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
      [id, req.user.id]
    );
    await pool.query(`UPDATE groups SET member_count=member_count+1 WHERE id=$1`, [id]);
    res.status(201).json({ success: true, message: 'Joined group' });
  } catch (err) { next(err); }
};

// DELETE /api/groups/:id/leave
exports.leaveGroup = async (req, res, next) => {
  try {
    const { id } = req.params;
    await pool.query(`DELETE FROM group_members WHERE group_id=$1 AND user_id=$2`, [id, req.user.id]);
    await pool.query(`UPDATE groups SET member_count=GREATEST(member_count-1,0) WHERE id=$1`, [id]);
    res.json({ success: true, message: 'Left group' });
  } catch (err) { next(err); }
};

// GET /api/groups/:id/messages
exports.getMessages = async (req, res, next) => {
  try {
    const r = await pool.query(`
      SELECT gm.*, u.name AS sender_name, u.avatar_url AS sender_avatar
      FROM group_messages gm LEFT JOIN users u ON u.id=gm.sender_id
      WHERE gm.group_id=$1 ORDER BY gm.sent_at ASC LIMIT 200
    `, [req.params.id]);
    res.json({ success: true, messages: r.rows });
  } catch (err) { next(err); }
};

// POST /api/groups/:id/messages
exports.sendMessage = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { text, type, image_url } = req.body;
    if (!text && !image_url)
      return res.status(400).json({ success: false, message: 'text or image_url required' });

    const r = await pool.query(`
      INSERT INTO group_messages (group_id, sender_id, type, text, image_url)
      VALUES ($1,$2,$3,$4,$5) RETURNING *
    `, [id, req.user.id, type||'text', text||null, image_url||null]);
    res.status(201).json({ success: true, message: r.rows[0] });
  } catch (err) { next(err); }
};

// GET /api/groups/:id/rules
exports.getRules = async (req, res, next) => {
  try {
    const r = await pool.query(
      `SELECT * FROM group_rules WHERE group_id=$1 ORDER BY sort_order`,
      [req.params.id]
    );
    res.json({ success: true, rules: r.rows });
  } catch (err) { next(err); }
};

// POST /api/groups/:id/rules
exports.addRule = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { emoji, title, description, sort_order } = req.body;
    if (!title) return res.status(400).json({ success: false, message: 'title is required' });
    const r = await pool.query(
      `INSERT INTO group_rules (group_id, emoji, title, description, sort_order) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [id, emoji||'📌', title, description||null, sort_order||0]
    );
    res.status(201).json({ success: true, rule: r.rows[0] });
  } catch (err) { next(err); }
};

// DELETE /api/groups/:id/rules/:ruleId
exports.deleteRule = async (req, res, next) => {
  try {
    await pool.query(`DELETE FROM group_rules WHERE id=$1 AND group_id=$2`, [req.params.ruleId, req.params.id]);
    res.json({ success: true, message: 'Rule deleted' });
  } catch (err) { next(err); }
};
