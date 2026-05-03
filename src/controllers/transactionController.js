const db     = require('../db/knex');
const { ethers } = require('ethers');

// GET /transactions
exports.list = async (req, res) => {
  const { filter = 'all', page = 1, limit = 20 } = req.query;
  const offset = (page - 1) * limit;

  try {
    const user = await db('users').where({ id: req.user.sub }).select('wallet_address').first();
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

    return res.status(200).json({
      transactions: formatted,
      total:        parseInt(total.count),
      page:         parseInt(page),
      limit:        parseInt(limit),
      pages:        Math.ceil(total.count / limit),
    });
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

    // If not in DB, check the blockchain directly
    if (!tx) {
      try {
        const provider = new ethers.JsonRpcProvider(process.env.ETHEREUM_NODE_URL);
        const receipt  = await provider.getTransactionReceipt(txHash);
        const txData   = await provider.getTransaction(txHash);

        if (!receipt || !txData) {
          return res.status(404).json({ error: 'Transaction not found', code: 'NOT_FOUND' });
        }

        // Write it to DB
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

    // Compute the hash the same way the smart contract does
    const appLayerHash = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ['address', 'address', 'uint256'],
        [tx.from_address, tx.to_address, tx.amount_wei]
      )
    );

    const onChainHash  = tx.metadata_hash || null;
    const match        = onChainHash ? appLayerHash === onChainHash : null;

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

  // Accept either a wallet address (`to`) or a display name (`toName`)
  if ((!to && !toName) || !amount) {
    return res.status(400).json({ error: 'Recipient (to or toName) and amount are required', code: 'VALIDATION_ERROR' });
  }

  let toAddress = to || null;

  // Resolve by name if toName was provided, or if `to` is not a valid address
  const needsLookup = toName || (to && !ethers.isAddress(to));
  if (needsLookup) {
    const lookupName = toName || to;
    const recipient = await db('users').whereRaw('LOWER(name) = ?', [lookupName.toLowerCase()]).select('wallet_address').first();
    if (!recipient || !recipient.wallet_address) {
      return res.status(404).json({ error: 'Recipient not found or has no wallet', code: 'RECIPIENT_NOT_FOUND' });
    }
    toAddress = recipient.wallet_address;
  }
};

// POST /transactions/broadcast
exports.broadcast = async (req, res) => {
  const { signedTx } = req.body;

  if (!signedTx || !signedTx.startsWith('0x')) {
    return res.status(400).json({ error: 'Valid signed transaction required', code: 'VALIDATION_ERROR' });
  }

  try {
    const provider = new ethers.JsonRpcProvider(process.env.ETHEREUM_NODE_URL);
    
    // Broadcast the signed transaction
    const txResponse = await provider.broadcastTransaction(signedTx);
    
    return res.status(200).json({
      txHash: txResponse.hash,
      note: 'Transaction broadcasted successfully. It will be confirmed soon.',
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
// POST /transactions/record  — called by browser after MetaMask signs
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
      status: 'pending',
      etherscanUrl: (process.env.ETHERSCAN_BASE_URL || 'https://sepolia.etherscan.io/tx/') + txHash,
    });
  } catch (err) {
    console.error('Record error:', err.message);
    return res.status(500).json({ error: 'Something went wrong', code: 'INTERNAL_ERROR' });
  }
};
