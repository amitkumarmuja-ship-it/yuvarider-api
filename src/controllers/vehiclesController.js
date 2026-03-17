const pool = require('../config/db');

exports.getVehicles = async (req, res, next) => {
  try {
    const r = await pool.query(`SELECT * FROM vehicles WHERE user_id=$1 ORDER BY is_primary DESC, created_at`, [req.user.id]);
    res.json({ success: true, vehicles: r.rows });
  } catch (err) { next(err); }
};

exports.getVehicleById = async (req, res, next) => {
  try {
    const r = await pool.query(`SELECT * FROM vehicles WHERE id=$1 AND user_id=$2`, [req.params.id, req.user.id]);
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'Vehicle not found' });
    res.json({ success: true, vehicle: r.rows[0] });
  } catch (err) { next(err); }
};

exports.createVehicle = async (req, res, next) => {
  try {
    const { name, nickname, brand, model, year, engine_cc, color, reg_number, fuel_type, odometer_km, image_url, is_primary } = req.body;
    if (!name) return res.status(400).json({ success: false, message: 'name is required' });

    if (is_primary) {
      await pool.query(`UPDATE vehicles SET is_primary=FALSE WHERE user_id=$1`, [req.user.id]);
    }
    const r = await pool.query(`
      INSERT INTO vehicles (user_id, name, nickname, brand, model, year, engine_cc, color, reg_number, fuel_type, odometer_km, image_url, is_primary)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *
    `, [req.user.id, name, nickname||null, brand||null, model||null, year||null, engine_cc||null, color||null, reg_number||null, fuel_type||'Petrol', odometer_km||0, image_url||null, is_primary||false]);
    res.status(201).json({ success: true, vehicle: r.rows[0] });
  } catch (err) { next(err); }
};

exports.updateVehicle = async (req, res, next) => {
  try {
    const { name, nickname, brand, model, year, engine_cc, color, reg_number, fuel_type, odometer_km, image_url, is_primary } = req.body;
    if (is_primary) {
      await pool.query(`UPDATE vehicles SET is_primary=FALSE WHERE user_id=$1`, [req.user.id]);
    }
    const r = await pool.query(`
      UPDATE vehicles SET
        name=COALESCE($1,name), nickname=COALESCE($2,nickname),
        brand=COALESCE($3,brand), model=COALESCE($4,model),
        year=COALESCE($5,year), engine_cc=COALESCE($6,engine_cc),
        color=COALESCE($7,color), reg_number=COALESCE($8,reg_number),
        fuel_type=COALESCE($9,fuel_type), odometer_km=COALESCE($10,odometer_km),
        image_url=COALESCE($11,image_url), is_primary=COALESCE($12,is_primary),
        updated_at=NOW()
      WHERE id=$13 AND user_id=$14 RETURNING *
    `, [name, nickname, brand, model, year, engine_cc, color, reg_number, fuel_type, odometer_km, image_url, is_primary, req.params.id, req.user.id]);
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'Vehicle not found' });
    res.json({ success: true, vehicle: r.rows[0] });
  } catch (err) { next(err); }
};

exports.deleteVehicle = async (req, res, next) => {
  try {
    const r = await pool.query(`DELETE FROM vehicles WHERE id=$1 AND user_id=$2 RETURNING id`, [req.params.id, req.user.id]);
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'Vehicle not found' });
    res.json({ success: true, message: 'Vehicle deleted' });
  } catch (err) { next(err); }
};
