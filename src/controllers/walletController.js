// ── GET /wallet/address ─────────────────────────────────────────────────────
exports.getWalletAddress = async (req, res) => {
  try {
    const user = await db('users')
      .where({ id: req.user.sub })
      .select('wallet_address')
      .first();

    if (!user || !user.wallet_address) {
      return res.status(404).json({
        error: 'No wallet address found for this user',
        code: 'WALLET_NOT_FOUND',
      });
    }

    return res.status(200).json({
      walletAddress: user.wallet_address,
    });
  } catch (err) {
    console.error('Get wallet address error:', err.message);
    return res.status(500).json({ error: 'Something went wrong', code: 'INTERNAL_ERROR' });
  }
};
const db     = require('../db/knex');
const { ethers } = require('ethers');
const crypto = require('crypto');

// ── GET /wallet/nonce ─────────────────────────────────────────────────────────
exports.getNonce = async (req, res) => {
  try {
    const nonce = crypto.randomBytes(32).toString('hex');
    await db('users')
      .where({ id: req.user.sub })
      .update({ wallet_nonce: nonce });

    return res.status(200).json({ nonce });
  } catch (err) {
    console.error('Get nonce error:', err.message);
    return res.status(500).json({ error: 'Something went wrong', code: 'INTERNAL_ERROR' });
  }
};

// ── POST /wallet/ ─────────────────────────────────────────────────────────────
exports.register = async (req, res) => {
  const { signature, message, walletAddress } = req.body;

  // Validate inputs
  if (!signature || !message || !walletAddress) {
    return res.status(400).json({
      error: 'signature, message and walletAddress are required',
      code: 'VALIDATION_ERROR',
    });
  }

  if (!ethers.isAddress(walletAddress)) {
    return res.status(400).json({
      error: 'Invalid Ethereum address',
      code: 'INVALID_ADDRESS',
    });
  }

  try {
    const user = await db('users')
      .where({ id: req.user.sub })
      .select('wallet_nonce', 'wallet_address', 'id')
      .first();

    // Check wallet not already registered
    if (user.wallet_address) {
      return res.status(409).json({
        error: 'Wallet already registered',
        code: 'WALLET_EXISTS',
        walletAddress: user.wallet_address,
      });
    }

    // Verify nonce exists
    if (!user.wallet_nonce) {
      return res.status(400).json({
        error: 'No nonce found. Request a new one.',
        code: 'NONCE_MISSING',
      });
    }

    // Verify message contains the correct nonce
    const expectedMessage = `Link wallet to ChainPay account: ${user.wallet_nonce}`;
    if (message !== expectedMessage) {
      return res.status(400).json({
        error: 'Message does not match expected nonce',
        code: 'MESSAGE_INVALID',
      });
    }

    // ── STRICT SIGNATURE VERIFICATION ────────────────────────────────────────
    // Recover the address that signed the message
    let recoveredAddress;
    try {
      recoveredAddress = ethers.verifyMessage(message, signature);
    } catch (verifyErr) {
      return res.status(400).json({
        error: 'Invalid signature format',
        code: 'SIGNATURE_INVALID',
      });
    }

    // The recovered address MUST match the claimed wallet address
    if (recoveredAddress.toLowerCase() !== walletAddress.toLowerCase()) {
      return res.status(400).json({
        error: 'Signature does not match wallet address. You must sign with the private key of this wallet.',
        code: 'SIGNATURE_MISMATCH',
        claimed:   walletAddress,
        recovered: recoveredAddress,
      });
    }
    // ─────────────────────────────────────────────────────────────────────────

    // Save wallet address and clear nonce
    await db('users')
      .where({ id: req.user.sub })
      .update({
        wallet_address:       walletAddress,
        wallet_registered_at: new Date(),
        wallet_nonce:         null, // invalidate nonce after use
        updated_at:           new Date(),
      });

    console.log(`✅ Wallet linked: ${walletAddress} → user ${req.user.sub}`);

    return res.status(201).json({
      walletAddress,
      registeredAt: new Date(),
      message: 'Wallet linked successfully',
    });

  } catch (err) {
    console.error('Wallet register error:', err.message);
    return res.status(500).json({ error: 'Something went wrong', code: 'INTERNAL_ERROR' });
  }
};

// ── GET /wallet/status ────────────────────────────────────────────────────────
exports.status = async (req, res) => {
  try {
    const user = await db('users')
      .where({ id: req.user.sub })
      .select('wallet_address', 'wallet_registered_at')
      .first();

    return res.status(200).json({
      registered:    !!user.wallet_address,
      walletAddress: user.wallet_address || null,
      registeredAt:  user.wallet_registered_at || null,
    });
  } catch (err) {
    console.error('Wallet status error:', err.message);
    return res.status(500).json({ error: 'Something went wrong', code: 'INTERNAL_ERROR' });
  }
};

// ── GET /wallet/balance ───────────────────────────────────────────────────────
exports.balance = async (req, res) => {
  try {
    const user = await db('users')
      .where({ id: req.user.sub })
      .select('wallet_address')
      .first();

    if (!user.wallet_address) {
      return res.status(400).json({
        error: 'No wallet linked to this account',
        code: 'WALLET_NOT_FOUND',
      });
    }

    const provider   = new ethers.JsonRpcProvider(process.env.ETHEREUM_NODE_URL);
    const balanceWei = await provider.getBalance(user.wallet_address);
    const balanceEth = ethers.formatEther(balanceWei);

    // Fetch live ETH price
    let ethPriceUSD = 3000;
    try {
      const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd');
      const d = await r.json();
      ethPriceUSD = d.ethereum.usd;
    } catch (_) {}

    return res.status(200).json({
      walletAddress: user.wallet_address,
      balanceEth:    parseFloat(balanceEth).toFixed(6),
      balanceWei:    balanceWei.toString(),
      balanceUSD:    (parseFloat(balanceEth) * ethPriceUSD).toFixed(2),
      ethPriceUSD,
    });
  } catch (err) {
    console.error('Balance error:', err.message);
    return res.status(500).json({ error: 'Something went wrong', code: 'INTERNAL_ERROR' });
  }
};

// ── GET /wallet/gas-estimate ──────────────────────────────────────────────────
exports.gasEstimate = async (req, res) => {
  const { to, amount } = req.query;

  if (!to || !amount || !ethers.isAddress(to)) {
    return res.status(400).json({
      error: 'Valid to address and amount required',
      code: 'VALIDATION_ERROR',
    });
  }

  try {
    const provider = new ethers.JsonRpcProvider(process.env.ETHEREUM_NODE_URL);
    const feeData  = await provider.getFeeData();
    const gasUnits = await provider.estimateGas({
      to,
      value: ethers.parseEther(amount),
    });

    const gasCostWei = gasUnits * feeData.gasPrice;
    const gasCostEth = ethers.formatEther(gasCostWei);

    let ethPriceUSD = 3000;
    try {
      const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd');
      const d = await r.json();
      ethPriceUSD = d.ethereum.usd;
    } catch (_) {}

    const gasCostUSD = (parseFloat(gasCostEth) * ethPriceUSD).toFixed(4);

    return res.status(200).json({
      gasEstimateEth: parseFloat(gasCostEth).toFixed(8),
      gasEstimateUSD: gasCostUSD,
      gasPrice:       feeData.gasPrice.toString(),
      gasUnits:       gasUnits.toString(),
    });
  } catch (err) {
    console.error('Gas estimate error:', err.message);
    return res.status(500).json({ error: 'Could not estimate gas', code: 'BLOCKCHAIN_UNAVAILABLE' });
  }
};
