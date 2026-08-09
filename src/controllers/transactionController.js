const db     = require('../db/knex');
const { ethers } = require('ethers');
const cache  = require('../middleware/cache');

const PAYMENT_PROCESSOR_ABI = [
  "function sendPayment(address to) external payable",
  "event PaymentSent(address indexed from, address indexed to, uint256 amount, uint256 timestamp, uint256 txIndex)",
];
const PAYMENT_PROCESSOR_ADDRESS = process.env.PAYMENT_PROCESSOR_ADDRESS;

// GET /transactions
exports.list = async (req, res) => {
  const { filter = 'all', page = 1, limit = 20 } = req.query;
  const offset = (page - 1) * limit;
  const userId = req.user.sub;

  const cacheKey = cache.keys.transactions(userId, filter, page);
  const cached   = cache.get(cacheKey);
  if (cached) return res.status(200).json(cached);

  try {
    const user = await db('users').where({ id: userId }).select('wallet_address').first();
    if (!user.wallet_address) {
      return res.status(200).json({ transactions: [], total: 0, page: 1, limit: 20 });
    }

    const wallet = user.wallet_address.toLowerCase();
    let query    = db('transactions');

    if (filter === 'sent') {
      query = query.whereRaw('LOWER(from_address) = ?', [wallet]);
    } else if (filter === 'received') {
      query = query.whereRaw('LOWER(to_address) = ?', [wallet]);
    } else if (filter === 'pending') {
      query = query.where({ status: 'pending' })
        .andWhere(function () {
          this.whereRaw('LOWER(from_address) = ?', [wallet])
              .orWhereRaw('LOWER(to_address) = ?', [wallet]);
        });
    } else {
      query = query.where(function () {
        this.whereRaw('LOWER(from_address) = ?', [wallet])
            .orWhereRaw('LOWER(to_address) = ?', [wallet]);
      });
    }

    const total        = await query.clone().count('id as count').first();
    const transactions = await query
      .orderBy('created_at', 'desc')
      .limit(limit)
      .offset(offset);

    const formatted = transactions.map((tx) => ({
      txHash:       tx.tx_hash,
      from:         tx.from_address,
      to:           tx.to_address,
      amountWei:    tx.amount_wei,
      amountEth:    ethers.formatEther(tx.amount_wei),
      status:       tx.status,
      blockNumber:  tx.block_number,
      timestamp:    tx.created_at,
      confirmedAt:  tx.confirmed_at,
      direction:    tx.from_address.toLowerCase() === wallet ? 'sent' : 'received',
      etherscanUrl: `${process.env.ETHERSCAN_BASE_URL}${tx.tx_hash}`,
    }));

    const payload = {
      transactions: formatted,
      total:        parseInt(total.count),
      page:         parseInt(page),
      limit:        parseInt(limit),
      pages:        Math.ceil(total.count / limit),
    };

    cache.set(cacheKey, payload, cache.CACHE_TTL.TRANSACTIONS);
    return res.status(200).json(payload);
  } catch (err) {
    console.error('List transactions error:', err.message);
    return res.status(500).json({ error: 'Something went wrong', code: 'INTERNAL_ERROR' });
  }
};

// GET /transactions/:txHash
exports.getOne = async (req, res) => {
  const { txHash } = req.params;

  try {
    let tx = await db('transactions').where({ tx_hash: txHash }).first();

    if (!tx) {
      try {
        const provider = new ethers.JsonRpcProvider(process.env.ETHEREUM_NODE_URL);
        const receipt  = await provider.getTransactionReceipt(txHash);
        const txData   = await provider.getTransaction(txHash);

        if (!receipt || !txData) {
          return res.status(404).json({ error: 'Transaction not found', code: 'NOT_FOUND' });
        }

        await db('transactions').insert({
          tx_hash:      txHash,
          from_address: txData.from,
          to_address:   txData.to,
          amount_wei:   txData.value.toString(),
          status:       receipt.status === 1 ? 'confirmed' : 'failed',
          block_number: receipt.blockNumber,
          confirmed_at: new Date(),
        });

        tx = await db('transactions').where({ tx_hash: txHash }).first();
      } catch (_) {
        return res.status(404).json({ error: 'Transaction not found', code: 'NOT_FOUND' });
      }
    }

    return res.status(200).json({
      txHash:       tx.tx_hash,
      from:         tx.from_address,
      to:           tx.to_address,
      amountEth:    ethers.formatEther(tx.amount_wei),
      amountWei:    tx.amount_wei,
      status:       tx.status,
      blockNumber:  tx.block_number,
      timestamp:    tx.created_at,
      confirmedAt:  tx.confirmed_at,
      revertReason: tx.revert_reason || null,
      etherscanUrl: `${process.env.ETHERSCAN_BASE_URL}${tx.tx_hash}`,
    });
  } catch (err) {
    console.error('Get transaction error:', err.message);
    return res.status(500).json({ error: 'Something went wrong', code: 'INTERNAL_ERROR' });
  }
};

// GET /transactions/:txHash/verify
exports.verify = async (req, res) => {
  const { txHash } = req.params;

  try {
    const tx = await db('transactions').where({ tx_hash: txHash }).first();
    if (!tx) {
      return res.status(404).json({ error: 'Transaction not found', code: 'NOT_FOUND' });
    }

    const appLayerHash = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ['address', 'address', 'uint256'],
        [tx.from_address, tx.to_address, tx.amount_wei]
      )
    );

    const onChainHash = tx.metadata_hash || null;
    const match       = onChainHash ? appLayerHash === onChainHash : null;

    return res.status(200).json({
      verified:      true,
      appLayerHash,
      onChainHash,
      match,
      note: !onChainHash ? 'On-chain hash not yet recorded for this transaction' : null,
    });
  } catch (err) {
    console.error('Verify error:', err.message);
    return res.status(500).json({ error: 'Blockchain query failed', code: 'BLOCKCHAIN_UNAVAILABLE' });
  }
};

// POST /transactions/send
exports.send = async (req, res) => {
  const { to, toName, amount } = req.body;

  if ((!to && !toName) || !amount) {
    return res.status(400).json({ error: 'Recipient (to or toName) and amount are required', code: 'VALIDATION_ERROR' });
  }

  let toAddress = to || null;

  // Resolve recipient by name if toName provided or `to` is not a valid address
  const needsLookup = toName || (to && !ethers.isAddress(to));
  if (needsLookup) {
    const lookupName = toName || to;
    try {
      const recipient = await db('users')
        .whereRaw('LOWER(name) = ?', [lookupName.toLowerCase()])
        .select('wallet_address')
        .first();
      if (!recipient || !recipient.wallet_address) {
        return res.status(404).json({ error: 'Recipient not found or has no wallet', code: 'RECIPIENT_NOT_FOUND' });
      }
      toAddress = recipient.wallet_address;
    } catch (err) {
      console.error('Recipient lookup error:', err.message);
      return res.status(500).json({ error: 'Something went wrong', code: 'INTERNAL_ERROR' });
    }
  }

  try {
    const user = await db('users').where({ id: req.user.sub }).select('wallet_address').first();
    if (!user.wallet_address) {
      return res.status(400).json({ error: 'No wallet linked', code: 'WALLET_NOT_FOUND' });
    }

    const provider = new ethers.JsonRpcProvider(process.env.ETHEREUM_NODE_URL);
    const from     = user.wallet_address;
    const value    = ethers.parseEther(String(amount));

    // Compute metadata hash for on-chain verification
    const metadataHash = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ['address', 'address', 'uint256'],
        [from, toAddress, value.toString()]
      )
    );

    let txData;

    if (PAYMENT_PROCESSOR_ADDRESS) {
      // Contract-based payment: call PaymentProcessor.sendPayment(to)
      const iface     = new ethers.Interface(PAYMENT_PROCESSOR_ABI);
      const data      = iface.encodeFunctionData('sendPayment', [toAddress]);
      const gasEstimate = await provider.estimateGas({ from, to: PAYMENT_PROCESSOR_ADDRESS, data, value });
      const [nonce, feeData, network] = await Promise.all([
        provider.getTransactionCount(from),
        provider.getFeeData(),
        provider.getNetwork(),
      ]);

      txData = {
        from,
        to:       PAYMENT_PROCESSOR_ADDRESS,
        data,
        value:    value.toString(),
        gasLimit: gasEstimate.toString(),
        gasPrice: feeData.gasPrice ? feeData.gasPrice.toString() : '0',
        nonce:    nonce.toString(),
        chainId:  network.chainId.toString(),
      };
    } else {
      // Fallback: direct wallet-to-wallet transfer
      const [nonce, gasEstimate, feeData, network] = await Promise.all([
        provider.getTransactionCount(from),
        provider.estimateGas({ from, to: toAddress, value }),
        provider.getFeeData(),
        provider.getNetwork(),
      ]);

      txData = {
        from,
        to:       toAddress,
        value:    value.toString(),
        gasLimit: gasEstimate.toString(),
        gasPrice: feeData.gasPrice ? feeData.gasPrice.toString() : '0',
        nonce:    nonce.toString(),
        chainId:  network.chainId.toString(),
      };
    }

    // Invalidate cached balance + tx list so next fetch is fresh
    cache.invalidateUser(req.user.sub);

    return res.status(200).json({
      txData,
      metadataHash,
      usesContract: !!PAYMENT_PROCESSOR_ADDRESS,
      note: 'Sign this transaction data with your wallet and broadcast it.',
    });
  } catch (err) {
    console.error('Send preparation error:', err.message);
    return res.status(500).json({ error: 'Transaction preparation failed', code: 'BLOCKCHAIN_ERROR' });
  }
};

// POST /transactions/broadcast
exports.broadcast = async (req, res) => {
  const { signedTx, metadataHash, to, from, amountWei } = req.body;

  if (!signedTx || !signedTx.startsWith('0x')) {
    return res.status(400).json({ error: 'Valid signed transaction required', code: 'VALIDATION_ERROR' });
  }

  try {
    const provider    = new ethers.JsonRpcProvider(process.env.ETHEREUM_NODE_URL);
    const txResponse  = await provider.broadcastTransaction(signedTx);

    // Pre-record the transaction if metadata is provided
    if (metadataHash && to && from) {
      await db('transactions').insert({
        tx_hash:      txResponse.hash,
        from_address: from,
        to_address:   to,
        amount_wei:   amountWei || '0',
        status:       'pending',
        metadata_hash: metadataHash,
        created_at:   new Date(),
        updated_at:   new Date(),
      }).onConflict('tx_hash').ignore();
    }

    return res.status(200).json({
      txHash: txResponse.hash,
      note:   'Transaction broadcasted successfully. It will be confirmed soon.',
    });
  } catch (err) {
    console.error('Broadcast error:', err.message);
    return res.status(500).json({ error: 'Transaction broadcast failed', code: 'BLOCKCHAIN_ERROR' });
  }
};

// GET /transactions/received
exports.received = async (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  const offset = (page - 1) * limit;

  try {
    const user = await db('users').where({ id: req.user.sub }).select('wallet_address').first();
    if (!user.wallet_address) {
      return res.status(200).json({ transactions: [], total: 0, page: 1, limit: 20 });
    }

    const wallet = user.wallet_address.toLowerCase();
    const query  = db('transactions')
      .whereRaw('LOWER(to_address) = ?', [wallet])
      .andWhere('status', 'confirmed');

    const total        = await query.clone().count('id as count').first();
    const transactions = await query
      .orderBy('created_at', 'desc')
      .limit(limit)
      .offset(offset);

    const formatted = transactions.map((tx) => ({
      txHash:       tx.tx_hash,
      from:         tx.from_address,
      to:           tx.to_address,
      amountWei:    tx.amount_wei,
      amountEth:    ethers.formatEther(tx.amount_wei),
      status:       tx.status,
      blockNumber:  tx.block_number,
      timestamp:    tx.created_at,
      confirmedAt:  tx.confirmed_at,
      direction:    'received',
      etherscanUrl: `${process.env.ETHERSCAN_BASE_URL}${tx.tx_hash}`,
    }));

    return res.status(200).json({
      transactions: formatted,
      total:        parseInt(total.count),
      page:         parseInt(page),
      limit:        parseInt(limit),
      pages:        Math.ceil(total.count / limit),
    });
  } catch (err) {
    console.error('List received transactions error:', err.message);
    return res.status(500).json({ error: 'Something went wrong', code: 'INTERNAL_ERROR' });
  }
};

// GET /transactions/pending
exports.pending = async (req, res) => {
  try {
    const user = await db('users').where({ id: req.user.sub }).select('wallet_address').first();
    if (!user.wallet_address) {
      return res.status(200).json({ pending: [] });
    }

    const wallet  = user.wallet_address.toLowerCase();
    const pending = await db('transactions')
      .where({ status: 'pending' })
      .andWhere(function () {
        this.whereRaw('LOWER(from_address) = ?', [wallet])
            .orWhereRaw('LOWER(to_address) = ?', [wallet]);
      })
      .orderBy('created_at', 'desc');

    return res.status(200).json({ pending });
  } catch (err) {
    console.error('Pending error:', err.message);
    return res.status(500).json({ error: 'Something went wrong', code: 'INTERNAL_ERROR' });
  }
};

// POST /transactions/record
exports.record = async (req, res) => {
  const { txHash, from, to, amountEth, amountWei } = req.body;

  if (!txHash || !from || !to) {
    return res.status(400).json({ error: 'txHash, from and to required', code: 'VALIDATION_ERROR' });
  }

  try {
    await db('transactions').insert({
      tx_hash:      txHash,
      from_address: from,
      to_address:   to,
      amount_wei:   amountWei || '0',
      status:       'pending',
      created_at:   new Date(),
      updated_at:   new Date(),
    }).onConflict('tx_hash').ignore();

    return res.status(201).json({
      txHash,
      status:       'pending',
      etherscanUrl: (process.env.ETHERSCAN_BASE_URL || 'https://sepolia.etherscan.io/tx/') + txHash,
    });
  } catch (err) {
    console.error('Record error:', err.message);
    return res.status(500).json({ error: 'Something went wrong', code: 'INTERNAL_ERROR' });
  }
};
