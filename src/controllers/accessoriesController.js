const pool = require('../config/db');

exports.getAccessories = async (req, res, next) => {
  try {
    const { type } = req.query;
    let where = `WHERE a.user_id=$1`;
    const params = [req.user.id];
    if (type) { where += ` AND a.type=$${params.length+1}`; params.push(type); }

    const r = await pool.query(`
      SELECT a.*, v.name AS vehicle_name FROM accessories a
      LEFT JOIN vehicles v ON v.id=a.vehicle_id
      ${where} ORDER BY a.created_at DESC
    `, params);
    res.json({ success: true, accessories: r.rows });
  } catch (err) { next(err); }
};

exports.getAccessoryById = async (req, res, next) => {
  try {
    const r = await pool.query(`SELECT * FROM accessories WHERE id=$1 AND user_id=$2`, [req.params.id, req.user.id]);
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'Accessory not found' });
    res.json({ success: true, accessory: r.rows[0] });
  } catch (err) { next(err); }
};

exports.createAccessory = async (req, res, next) => {
  try {
    const { vehicle_id, name, brand, type, price, purchase_date, size, color, store, emoji, bike_name, image_url, notes } = req.body;
    if (!name) return res.status(400).json({ success: false, message: 'name is required' });
    const r = await pool.query(`
      INSERT INTO accessories (user_id, vehicle_id, name, brand, type, price, purchase_date, size, color, store, emoji, bike_name, image_url, notes)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *
    `, [req.user.id, vehicle_id||null, name, brand||null, type||'Other', price||null, purchase_date||null, size||null, color||null, store||null, emoji||'🏍️', bike_name||null, image_url||null, notes||null]);
    res.status(201).json({ success: true, accessory: r.rows[0] });
  } catch (err) { next(err); }
};

exports.updateAccessory = async (req, res, next) => {
  try {
    const { vehicle_id, name, brand, type, price, purchase_date, size, color, store, emoji, bike_name, image_url, notes } = req.body;
    const r = await pool.query(`
      UPDATE accessories SET
        vehicle_id=COALESCE($1,vehicle_id), name=COALESCE($2,name),
        brand=COALESCE($3,brand), type=COALESCE($4,type),
        price=COALESCE($5,price), purchase_date=COALESCE($6,purchase_date),
        size=COALESCE($7,size), color=COALESCE($8,color),
        store=COALESCE($9,store), emoji=COALESCE($10,emoji),
        bike_name=COALESCE($11,bike_name), image_url=COALESCE($12,image_url),
        notes=COALESCE($13,notes), updated_at=NOW()
      WHERE id=$14 AND user_id=$15 RETURNING *
    `, [vehicle_id, name, brand, type, price, purchase_date, size, color, store, emoji, bike_name, image_url, notes, req.params.id, req.user.id]);
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'Accessory not found' });
    res.json({ success: true, accessory: r.rows[0] });
  } catch (err) { next(err); }
};

exports.deleteAccessory = async (req, res, next) => {
  try {
    const r = await pool.query(`DELETE FROM accessories WHERE id=$1 AND user_id=$2 RETURNING id`, [req.params.id, req.user.id]);
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'Accessory not found' });
    res.json({ success: true, message: 'Accessory deleted' });
  } catch (err) { next(err); }
};
