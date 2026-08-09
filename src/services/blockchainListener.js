const { ethers } = require('ethers');
const db         = require('../db/knex');

// Import sendToUser — will be injected to avoid circular deps
let sendToUser = null;
exports.setSendToUser = (fn) => { sendToUser = fn; };

// Minimal ABI — only the events we need
const PAYMENT_PROCESSOR_ABI = [
  'event PaymentSent(address indexed from, address indexed to, uint256 amount, uint256 timestamp, uint256 txIndex)',
];

const WALLET_REGISTRY_ABI = [
  'event WalletRegistered(address indexed wallet, bytes32 indexed hashedUserId, uint256 timestamp)',
];

let provider = null;
let paymentContract = null;
let lastBlock = 0;

const getProvider = () => {
  return new ethers.JsonRpcProvider(process.env.ETHEREUM_NODE_URL);
};

// Shared handler for PaymentSent events (live subscription + catch-up poller)
const handlePaymentEvent = async (from, to, amount, timestamp, txIndex, log) => {
  const txHash = log.transactionHash;

  try {
    // Upsert transaction into DB
    await db('transactions')
      .insert({
        tx_hash:      txHash,
        from_address: from,
        to_address:   to,
        amount_wei:   amount.toString(),
        status:       'confirmed',
        block_number: log.blockNumber,
        tx_index:     Number(txIndex),
        confirmed_at: new Date(),
      })
      .onConflict('tx_hash')
      .merge({ status: 'confirmed', block_number: log.blockNumber, confirmed_at: new Date() });

    // Find users by wallet address and notify via SSE
    const [sender, receiver] = await Promise.all([
      db('users').whereRaw('LOWER(wallet_address) = ?', [from.toLowerCase()]).first(),
      db('users').whereRaw('LOWER(wallet_address) = ?', [to.toLowerCase()]).first(),
    ]);

    if (sendToUser) {
      // Notify sender — confirmed
      if (sender) {
        sendToUser(sender.id, 'payment_confirmed', {
          txHash,
          blockNumber: log.blockNumber,
          confirmedAt: new Date(),
        });
      }

      // Notify receiver — payment received
      if (receiver) {
        sendToUser(receiver.id, 'payment_received', {
          from,
          amountEth: ethers.formatEther(amount),
          txHash,
          timestamp: new Date(),
        });
      }
    }
  } catch (err) {
    console.error('Error processing PaymentSent event:', err.message);
  }
};

const setupListeners = async () => {
  try {
    provider = getProvider();

    // Test connection
    const network = await provider.getNetwork();
    console.log(`Blockchain listener connected to: ${network.name} (chainId: ${network.chainId})`);

    lastBlock = await provider.getBlockNumber();
    console.log(`Starting from block: ${lastBlock}`);

    // Only set up contract listeners if addresses are configured
    if (process.env.PAYMENT_PROCESSOR_ADDRESS) {
      paymentContract = new ethers.Contract(
        process.env.PAYMENT_PROCESSOR_ADDRESS,
        PAYMENT_PROCESSOR_ABI,
        provider
      );

      // Listen for PaymentSent events
      paymentContract.on('PaymentSent', (from, to, amount, timestamp, txIndex, event) => {
        console.log(`PaymentSent detected: ${from} -> ${to}, amount: ${ethers.formatEther(amount)} ETH`);
        handlePaymentEvent(from, to, amount, timestamp, txIndex, event.log);
      });

      console.log('PaymentProcessor event listener active');
    } else {
      console.log('PAYMENT_PROCESSOR_ADDRESS not set — skipping contract listeners');
    }

    // Handle provider errors
    provider.on('error', (err) => {
      console.error('Provider error:', err.message);
      reconnect();
    });

  } catch (err) {
    console.error('Blockchain listener setup failed:', err.message);
    reconnect();
  }
};

// Catch-up poller: scan for PaymentSent events missed while disconnected/restarting
const pollPaymentEvents = async () => {
  const address = process.env.PAYMENT_PROCESSOR_ADDRESS;
  if (!address || !provider) return;

  try {
    const iface  = new ethers.Interface(PAYMENT_PROCESSOR_ABI);
    const topic  = iface.getEvent('PaymentSent').topicHash;
    const currentBlock = await provider.getBlockNumber();
    const fromBlock    = lastBlock + 1;

    if (fromBlock > currentBlock) return;

    const logs = await provider.getLogs({ address, topics: [topic], fromBlock, toBlock: currentBlock });

    if (logs.length) {
      console.log(`PaymentSent catch-up: found ${logs.length} event(s) in blocks ${fromBlock}-${currentBlock}`);
      for (const log of logs) {
        try {
          const parsed = iface.parseLog(log);
          await handlePaymentEvent(
            parsed.args.from, parsed.args.to, parsed.args.amount,
            parsed.args.timestamp, parsed.args.txIndex, log
          );
        } catch (err) {
          console.error('Error processing polled PaymentSent event:', err.message);
        }
      }
    }

    lastBlock = currentBlock;
  } catch (err) {
    console.error('Payment event poll error:', err.message);
  }
};

// Reconnect with exponential backoff
let reconnectDelay = 1000;
const reconnect = () => {
  console.log(`Reconnecting in ${reconnectDelay / 1000}s...`);
  setTimeout(async () => {
    try {
      if (paymentContract) {
        paymentContract.removeAllListeners();
      }
      await setupListeners();
      reconnectDelay = 1000; // reset on success
    } catch (err) {
      reconnectDelay = Math.min(reconnectDelay * 2, 30000);
      reconnect();
    }
  }, reconnectDelay);
};

// ── Direct ETH transfer recorder ──────────────────────────────────────────────
// Records EVERY transaction involving a registered user wallet (EOA-to-EOA or
// contract call), so tx hashes are stored in the DB even when PAYMENT_PROCESSOR
// is not configured and payments go straight to the recipient.
let lastScanBlock  = 0;
let knownWallets   = new Set();
let lastRefresh    = 0;

const refreshKnownWallets = async () => {
  const rows = await db('users').whereNotNull('wallet_address').select('wallet_address');
  const set  = new Set();
  for (const r of rows) set.add(String(r.wallet_address).toLowerCase());
  knownWallets = set;
  lastRefresh   = Date.now();
};

const recordTransfer = async (tx, receipt) => {
  const status = receipt.status === 1 ? 'confirmed' : 'failed';
  try {
    await db('transactions')
      .insert({
        tx_hash:      tx.hash,
        from_address: tx.from,
        to_address:   tx.to || null,
        amount_wei:   tx.value.toString(),
        status,
        block_number: receipt.blockNumber,
        confirmed_at: new Date(),
      })
      .onConflict('tx_hash')
      .merge({ status, block_number: receipt.blockNumber, confirmed_at: new Date() });
    console.log(`Transfer recorded: ${tx.hash.slice(0,12)} -> ${status}`);
  } catch (err) {
    console.error('Direct transfer record error:', err.message);
  }
};

const pollBlockTransfers = async () => {
  if (!provider) return;
  try {
    if (!lastScanBlock) lastScanBlock = await provider.getBlockNumber();
    await refreshKnownWallets();

    const current = await provider.getBlockNumber();
    if (current <= lastScanBlock) return;

    for (let n = lastScanBlock + 1; n <= current; n++) {
      const block = await provider.getBlock(n, true);
      if (!block || !block.transactions) continue;
      for (const tx of block.transactions) {
        const from = (tx.from || '').toLowerCase();
        const to   = (tx.to || '').toLowerCase();
        const involved = (from && knownWallets.has(from)) || (to && knownWallets.has(to));
        if (!involved) continue;
        try {
          const receipt = await provider.getTransactionReceipt(tx.hash);
          if (receipt) await recordTransfer(tx, receipt);
        } catch (err) {
          console.error('Transfer receipt fetch error:', tx.hash, err.message);
        }
      }
    }
    lastScanBlock = current;
  } catch (err) {
    console.error('Block transfer scan error:', err.message);
  }
};

// Poll pending transactions every 30 seconds and confirm them
const pollPendingTransactions = async () => {
  try {
    const provider = getProvider();
    const pending = await db('transactions').where({ status: 'pending' });
    
    for (const tx of pending) {
      try {
        const receipt = await provider.getTransactionReceipt(tx.tx_hash);
        if (receipt) {
          const status = receipt.status === 1 ? 'confirmed' : 'failed';
          await db('transactions')
            .where({ tx_hash: tx.tx_hash })
            .update({
              status,
              block_number: receipt.blockNumber,
              confirmed_at: new Date(),
              updated_at:   new Date(),
            });
          console.log(`TX ${tx.tx_hash.slice(0,12)} -> ${status}`);

          // Notify users via SSE
          if (sendToUser) {
            const [sender, receiver] = await Promise.all([
              db('users').whereRaw('LOWER(wallet_address) = ?', [tx.from_address.toLowerCase()]).first(),
              db('users').whereRaw('LOWER(wallet_address) = ?', [tx.to_address.toLowerCase()]).first(),
            ]);
            if (sender) sendToUser(sender.id, 'payment_confirmed', { txHash: tx.tx_hash, status });
            if (receiver) sendToUser(receiver.id, 'payment_received', { txHash: tx.tx_hash, status, amountEth: ethers.formatEther(tx.amount_wei) });
          }
        }
      } catch (err) {
        console.error('Poll tx error:', tx.tx_hash, err.message);
      }
    }
  } catch (err) {
    console.error('Poll pending error:', err.message);
  }
};

exports.start = async () => {
  await setupListeners();
  // Poll every 30 seconds
  setInterval(pollPendingTransactions, 30000);
  setInterval(pollPaymentEvents, 30000);
  setInterval(pollBlockTransfers, 30000);
  // Also run immediately
  setTimeout(pollPendingTransactions, 5000);
  setTimeout(pollPaymentEvents, 10000);
  setTimeout(pollBlockTransfers, 10000);
};