const pool   = require('../config/db');
const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
require('dotenv').config();

function makeToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, name: user.name },
    process.env.JWT_SECRET || 'secret',
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

// POST /api/auth/register
exports.register = async (req, res, next) => {
  try {
    const { name, email, password, phone, location, bio } = req.body;
    if (!name || !email || !password)
      return res.status(400).json({ success: false, message: 'name, email and password are required' });

    const exists = await pool.query('SELECT id FROM users WHERE email=$1', [email]);
    if (exists.rows.length > 0)
      return res.status(409).json({ success: false, message: 'Email already registered' });

    const hash = await bcrypt.hash(password, 10);
    const r = await pool.query(
      `INSERT INTO users (name, email, password_hash, phone, location, bio)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, name, email, phone, location, bio, created_at`,
      [name, email, hash, phone || null, location || null, bio || null]
    );
    const user = r.rows[0];
    res.status(201).json({ success: true, token: makeToken(user), user });
  } catch (err) { next(err); }
};

// POST /api/auth/login
exports.login = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ success: false, message: 'Email and password required' });

    const r = await pool.query('SELECT * FROM users WHERE email=$1', [email]);
   
    
    const user = r.rows[0];
    //  console.log(bcrypt.compare(password, user.password_hash));
    // console.log(password);
    // console.log(user.password_hash);
    // const hash = await bcrypt.hash(password, 10);
    // console.log(hash);
    
    if (!user || !(await bcrypt.compare(password, user.password_hash)))
      return res.status(401).json({ success: false, message: 'Invalid credentials' });

    const { password_hash, ...safe } = user;
    res.json({ success: true, token: makeToken(user), user: safe });
  } catch (err) { next(err); }
};

// GET /api/auth/me
exports.me = async (req, res, next) => {
  try {
    const r = await pool.query(
      `SELECT id, name, email, phone, avatar_url, bio, location, total_rides, total_km, created_at
       FROM users WHERE id=$1`, [req.user.id]
    );
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'User not found' });
    res.json({ success: true, user: r.rows[0] });
  } catch (err) { next(err); }
};

// PUT /api/auth/me
exports.updateMe = async (req, res, next) => {
  try {
    const { name, phone, bio, location, avatar_url } = req.body;
    const r = await pool.query(
      `UPDATE users SET name=COALESCE($1,name), phone=COALESCE($2,phone),
        bio=COALESCE($3,bio), location=COALESCE($4,location),
        avatar_url=COALESCE($5,avatar_url), updated_at=NOW()
       WHERE id=$6
       RETURNING id, name, email, phone, avatar_url, bio, location, total_rides, total_km`,
      [name, phone, bio, location, avatar_url, req.user.id]
    );
    res.json({ success: true, user: r.rows[0] });
  } catch (err) { next(err); }
};
