const router = require('express').Router();
const ctrl   = require('../controllers/vehiclesController');
const auth   = require('../middleware/auth');

router.get ('/',       auth, ctrl.getVehicles);
router.get ('/:id',    auth, ctrl.getVehicleById);
router.post('/',       auth, ctrl.createVehicle);
router.put ('/:id',    auth, ctrl.updateVehicle);
router.delete('/:id',  auth, ctrl.deleteVehicle);

module.exports = router;
