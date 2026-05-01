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
      paymentContract.on('PaymentSent', async (from, to, amount, timestamp, txIndex, event) => {
        console.log(`PaymentSent detected: ${from} -> ${to}, amount: ${ethers.formatEther(amount)} ETH`);

        const txHash = event.log.transactionHash;

        try {
          // Upsert transaction into DB
          await db('transactions')
            .insert({
              tx_hash:      txHash,
              from_address: from,
              to_address:   to,
              amount_wei:   amount.toString(),
              status:       'confirmed',
              block_number: event.log.blockNumber,
              tx_index:     Number(txIndex),
              confirmed_at: new Date(),
            })
            .onConflict('tx_hash')
            .merge({ status: 'confirmed', block_number: event.log.blockNumber, confirmed_at: new Date() });

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
                blockNumber: event.log.blockNumber,
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
  // Also run immediately
  setTimeout(pollPendingTransactions, 5000);
};