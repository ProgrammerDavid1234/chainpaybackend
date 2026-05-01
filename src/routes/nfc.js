const router = require('express').Router();
const auth   = require('../middleware/auth');
const ctrl   = require('../controllers/nfcController');

router.post('/request',              auth, ctrl.createRequest);
router.get('/request/:requestId',    auth, ctrl.getRequest);
router.post('/confirm',              auth, ctrl.confirmRequest);
router.delete('/request/:requestId', auth, ctrl.cancelRequest);

module.exports = router;
