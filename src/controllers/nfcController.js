const db     = require('../db/knex');
const ethers = require('ethers');

// POST /api/v1/nfc/request  — receiver calls this to get an NFC payload
exports.createRequest = async (req, res) => {
  const { amountEth } = req.body;
  if (!amountEth || isNaN(parseFloat(amountEth)) || parseFloat(amountEth) < 0.0001)
    return res.status(400).json({ error: 'Valid amountEth required', code: 'VALIDATION_ERROR' });

  try {
    const user = await db('users').where({ id: req.user.sub }).select('id','wallet_address').first();
    if (!user?.wallet_address)
      return res.status(400).json({ error: 'No wallet linked', code: 'WALLET_NOT_FOUND' });

    const [request] = await db('nfc_requests').insert({
      from_user_id: req.user.sub,
      to_address:   user.wallet_address,
      amount_eth:   parseFloat(amountEth).toString(),
      status:       'pending',
    }).returning('*');

    return res.status(201).json({
      requestId:  request.id,
      toAddress:  request.to_address,
      amountEth:  request.amount_eth,
      status:     request.status,
      nfcPayload: `chainpay://nfc?requestId=${request.id}&to=${request.to_address}&amount=${request.amount_eth}`,
    });
  } catch (err) {
    console.error('NFC create error:', err.message);
    return res.status(500).json({ error: 'Failed to create NFC request', code: 'INTERNAL_ERROR' });
  }
};

// GET /api/v1/nfc/request/:requestId  — sender fetches details after reading NFC tag
exports.getRequest = async (req, res) => {
  try {
    const request = await db('nfc_requests').where({ id: req.params.requestId }).first();
    if (!request)
      return res.status(404).json({ error: 'Request not found', code: 'NOT_FOUND' });

    return res.status(200).json({
      requestId: request.id,
      toAddress: request.to_address,
      amountEth: request.amount_eth,
      status:    request.status,
      txHash:    request.tx_hash || null,
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to get request', code: 'INTERNAL_ERROR' });
  }
};

// POST /api/v1/nfc/confirm  — sender calls this after MetaMask signs
exports.confirmRequest = async (req, res) => {
  const { requestId, txHash, fromAddress } = req.body;
  if (!requestId || !txHash || !fromAddress)
    return res.status(400).json({ error: 'requestId, txHash and fromAddress required', code: 'VALIDATION_ERROR' });
  if (!ethers.isAddress(fromAddress))
    return res.status(400).json({ error: 'Invalid fromAddress', code: 'VALIDATION_ERROR' });

  try {
    const request = await db('nfc_requests').where({ id: requestId }).first();
    if (!request)
      return res.status(404).json({ error: 'NFC request not found', code: 'NOT_FOUND' });
    if (request.status === 'completed')
      return res.status(409).json({ error: 'Already completed', code: 'ALREADY_COMPLETED' });

    await db('nfc_requests').where({ id: requestId })
      .update({ status: 'completed', tx_hash: txHash, updated_at: new Date() });

    const amountWei = ethers.parseEther(request.amount_eth).toString();
    await db('transactions').insert({
      tx_hash:      txHash,
      from_address: fromAddress.toLowerCase(),
      to_address:   request.to_address.toLowerCase(),
      amount_wei:   amountWei,
      status:       'pending',
      created_at:   new Date(),
      updated_at:   new Date(),
    }).onConflict('tx_hash').ignore();

    // Notify receiver via SSE
    try {
      const { sendToUser } = require('../routes/events');
      const receiver = await db('users')
        .whereRaw('LOWER(wallet_address) = ?', [request.to_address.toLowerCase()])
        .first();
      if (receiver && sendToUser)
        sendToUser(receiver.id, 'nfc_payment_received', { txHash, fromAddress, amountEth: request.amount_eth });
    } catch (_) {}

    return res.status(200).json({
      txHash,
      fromAddress,
      toAddress:    request.to_address,
      amountEth:    request.amount_eth,
      status:       'pending',
      etherscanUrl: `https://sepolia.etherscan.io/tx/${txHash}`,
    });
  } catch (err) {
    console.error('NFC confirm error:', err.message);
    return res.status(500).json({ error: 'Failed to confirm payment', code: 'INTERNAL_ERROR' });
  }
};

// DELETE /api/v1/nfc/request/:requestId  — cancel
exports.cancelRequest = async (req, res) => {
  try {
    await db('nfc_requests')
      .where({ id: req.params.requestId, from_user_id: req.user.sub })
      .update({ status: 'cancelled', updated_at: new Date() });
    return res.status(200).json({ message: 'Cancelled' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to cancel', code: 'INTERNAL_ERROR' });
  }
};
