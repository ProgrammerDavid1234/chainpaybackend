const router = require('express').Router();
const auth   = require('../middleware/auth');
const ctrl   = require('../controllers/walletController');
router.get('/nonce',        auth, ctrl.getNonce);
router.post('/',            auth, ctrl.register);
router.get('/status',       auth, ctrl.status);
router.get('/balance',      auth, ctrl.balance);
router.get('/gas-estimate', auth, ctrl.gasEstimate);

// GET /wallet/address - Get the authenticated user's wallet address
router.get('/address', auth, ctrl.getWalletAddress);
module.exports = router;
