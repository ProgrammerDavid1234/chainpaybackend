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

const WALLET_REGISTRY_ABI = [
  "function registerWallet(bytes32 hashedUserId) external",
  "event WalletRegistered(address indexed wallet, bytes32 indexed hashedUserId, uint256 timestamp)",
];
const WALLET_REGISTRY_ADDRESS = process.env.WALLET_REGISTRY_ADDRESS;

// ── GET /wallet/transactions ────────────────────────────────────────────────
exports.getTransactions = async (req, res) => {
  const { filter = 'all', page = 1, limit = 20 } = req.query;
  const safePage = Math.max(1, parseInt(page, 10) || 1);
  const safeLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const offset = (safePage - 1) * safeLimit;

  try {
    const user = await db('users')
      .where({ id: req.user.sub })
      .select('wallet_address')
      .first();

    if (!user?.wallet_address) {
      return res.status(200).json({
        transactions: [],
        total: 0,
        page: safePage,
        limit: safeLimit,
        pages: 0,
      });
    }

    const wallet = user.wallet_address.toLowerCase();
    let query = db('transactions');

    if (filter === 'sent') {
      query = query.whereRaw('LOWER(from_address) = ?', [wallet]);
    } else if (filter === 'received') {
      query = query.whereRaw('LOWER(to_address) = ?', [wallet]);
    } else {
      query = query.where(function () {
        this.whereRaw('LOWER(from_address) = ?', [wallet])
          .orWhereRaw('LOWER(to_address) = ?', [wallet]);
      });
    }

    const totalRow = await query.clone().count('id as count').first();
    const transactions = await query
      .orderBy('created_at', 'desc')
      .limit(safeLimit)
      .offset(offset);

    const formatted = transactions.map((tx) => ({
      txHash: tx.tx_hash,
      from: tx.from_address,
      to: tx.to_address,
      amountWei: tx.amount_wei,
      amountEth: ethers.formatEther(tx.amount_wei),
      status: tx.status,
      blockNumber: tx.block_number,
      timestamp: tx.created_at,
      confirmedAt: tx.confirmed_at,
      direction: tx.from_address?.toLowerCase() === wallet ? 'sent' : 'received',
      etherscanUrl: `${process.env.ETHERSCAN_BASE_URL}${tx.tx_hash}`,
    }));

    return res.status(200).json({
      transactions: formatted,
      total: parseInt(totalRow.count, 10),
      page: safePage,
      limit: safeLimit,
      pages: totalRow.count > 0 ? Math.ceil(totalRow.count / safeLimit) : 0,
    });
  } catch (err) {
    console.error('Wallet transactions error:', err.message);
    return res.status(500).json({ error: 'Something went wrong', code: 'INTERNAL_ERROR' });
  }
};

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

    console.log(`Wallet linked: ${walletAddress} -> user ${req.user.sub}`);

    // Prepare on-chain registration transaction via WalletRegistry contract
    let onChainTx = null;
    if (WALLET_REGISTRY_ADDRESS) {
      try {
        const provider    = new ethers.JsonRpcProvider(process.env.ETHEREUM_NODE_URL);
        const hashedUserId = ethers.keccak256(ethers.toUtf8Bytes(String(req.user.sub)));
        const iface        = new ethers.Interface(WALLET_REGISTRY_ABI);
        const data         = iface.encodeFunctionData('registerWallet', [hashedUserId]);

        const [nonce, gasEstimate, feeData, network] = await Promise.all([
          provider.getTransactionCount(walletAddress),
          provider.estimateGas({ from: walletAddress, to: WALLET_REGISTRY_ADDRESS, data }),
          provider.getFeeData(),
          provider.getNetwork(),
        ]);

        onChainTx = {
          from:     walletAddress,
          to:       WALLET_REGISTRY_ADDRESS,
          data,
          value:    '0',
          gasLimit: gasEstimate.toString(),
          gasPrice: feeData.gasPrice ? feeData.gasPrice.toString() : '0',
          nonce:    nonce.toString(),
          chainId:  network.chainId.toString(),
        };
      } catch (txErr) {
        console.error('On-chain registration tx prep failed:', txErr.message);
      }
    }

    return res.status(201).json({
      walletAddress,
      registeredAt: new Date(),
      message: 'Wallet linked successfully',
      onChainTx: onChainTx ? {
        txData: onChainTx,
        note: 'Sign and broadcast this transaction to register your wallet on-chain via WalletRegistry contract.',
      } : null,
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
