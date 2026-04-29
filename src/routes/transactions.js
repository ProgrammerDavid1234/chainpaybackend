const router = require('express').Router();
const auth   = require('../middleware/auth');
const ctrl   = require('../controllers/transactionController');

router.get('/',              auth, ctrl.list);
router.post('/send',         auth, ctrl.send);
router.post('/broadcast',    auth, ctrl.broadcast);
router.get('/received',      auth, ctrl.received);
router.get('/pending',       auth, ctrl.pending);
router.get('/:txHash',       auth, ctrl.getOne);
router.get('/:txHash/verify', auth, ctrl.verify);

module.exports = router;