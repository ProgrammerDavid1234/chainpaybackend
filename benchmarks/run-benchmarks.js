/**
 * Benchmark: Centralized SQLite vs Blockchain Contract Transfers
 *
 * Measures latency, throughput, and cost for both approaches.
 * Requires: local Hardhat node running at http://127.0.0.1:8545
 *           Contracts deployed (see hardhat/scripts/deploy.js)
 */
const { ethers } = require('ethers');
const path       = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const centralized = require('../src/services/baseline/centralizedTransfer');
const { baselineDb, SQLITE_FILE } = require('../src/db/knex');

const IS_SEPOLIA       = process.argv.includes('--network') && process.argv[process.argv.indexOf('--network') + 1] === 'sepolia';
const RPC_URL          = IS_SEPOLIA ? (process.env.ETHEREUM_NODE_URL || 'https://sepolia.infura.io/v3/063661ff34d344bba85ef71e498a82ce') : 'http://127.0.0.1:8545';
const CONTRACT_ADDRESS = process.env.PAYMENT_PROCESSOR_ADDRESS || '0xe7f1725E77E288F8367e1Bb143E90bb3F0512';
const PAYMENT_ABI      = ["function sendPayment(address to) external payable"];
const NUM_TRANSFERS    = IS_SEPOLIA ? 3 : 25;
const TRANSFER_AMOUNT  = IS_SEPOLIA ? '1000000000000000' : '1000000000000000000'; // 0.001 ETH on Sepolia, 1 ETH local
const SENDER_KEY       = IS_SEPOLIA ? (process.env.DEPLOYER_PRIVATE_KEY || '') : '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const SEPOLIA_GAS_PRICE = IS_SEPOLIA ? ethers.parseUnits('3', 'gwei') : 0n;

const results = {
  centralized: { latencies: [], throughput: 0, totalTime: 0, errors: 0 },
  blockchain:  { latencies: [], throughput: 0, totalTime: 0, errors: 0, gasUsed: [], gasCostETH: 0 },
};

async function setupCentralized() {
  console.log('[setup] Initializing SQLite centralized baseline...');
  await centralized.init();

  const wallets = [];
  for (let i = 0; i < 2; i++) {
    const w = await centralized.createWallet(`user${i}`);
    wallets.push(w);
  }
  console.log(`[setup] Created ${wallets.length} centralized wallets`);
  return wallets;
}

async function setupBlockchain() {
  console.log(`[setup] Connecting to blockchain (${IS_SEPOLIA ? 'Sepolia' : 'Local Hardhat'})...`);
  const provider = new ethers.JsonRpcProvider(RPC_URL);

  // On local: use Hardhat default accounts. On Sepolia: use deployer wallet.
  let sender, receiver;
  if (IS_SEPOLIA) {
    if (!SENDER_KEY) {
      throw new Error('DEPLOYER_PRIVATE_KEY not set in .env for Sepolia benchmark');
    }
    sender   = new ethers.Wallet(SENDER_KEY, provider);
    receiver = ethers.Wallet.createRandom(); // random address, no need to be funded
  } else {
    senderKey   = SENDER_KEY;
    receiverKey = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
    sender      = new ethers.Wallet(senderKey, provider);
    receiver    = new ethers.Wallet(receiverKey, provider);
  }

  console.log(`[setup] Sender   wallet: ${sender.address}`);
  console.log(`[setup] Receiver wallet: ${receiver.address}`);
  console.log(`[setup] PaymentProcessor: ${CONTRACT_ADDRESS}`);
  console.log(`[setup] Network: ${IS_SEPOLIA ? 'Sepolia' : 'Local Hardhat'}`);
  console.log(`[setup] Transfers: ${NUM_TRANSFERS} x ${ethers.formatEther(TRANSFER_AMOUNT)} ETH`);

  return { provider, sender, receiver };
}

async function benchmarkCentralized(wallets) {
  console.log('\n=== Centralized SQLite Baseline Benchmark ===');
  const from = wallets[0].walletAddress;
  const to   = wallets[1].walletAddress;

  const startTime = Date.now();

  for (let i = 0; i < NUM_TRANSFERS; i++) {
    const t0 = performance.now();
    try {
      await centralized.transfer(from, to, TRANSFER_AMOUNT);
      const t1 = performance.now();
      results.centralized.latencies.push(t1 - t0);
    } catch (err) {
      results.centralized.errors++;
      console.error(`  Error on tx ${i}: ${err.message}`);
    }
  }

  results.centralized.totalTime = Date.now() - startTime;
  results.centralized.throughput = (NUM_TRANSFERS - results.centralized.errors) / (results.centralized.totalTime / 1000);
}

async function benchmarkBlockchain({ provider, sender, receiver }) {
  console.log('\n=== Blockchain Contract Benchmark ===');
  const receiverAddr = receiver.address;
  const iface        = new ethers.Interface(PAYMENT_ABI);
  const chainId      = IS_SEPOLIA ? 11155111 : 31337;

  const startTime = Date.now();

  for (let i = 0; i < NUM_TRANSFERS; i++) {
    const t0 = Date.now();
    try {
      // Fetch fresh nonce from provider each time — no ethers signer caching
      const nonceHex = await provider.send('eth_getTransactionCount', [sender.address, 'latest']);
      const nonce    = parseInt(nonceHex, 16);

      const feeData = await provider.getFeeData();
      const gasEstimate = await provider.estimateGas({
        to:       CONTRACT_ADDRESS,
        data:     iface.encodeFunctionData('sendPayment', [receiverAddr]),
        value:    TRANSFER_AMOUNT,
        from:     sender.address,
      });

      const unsignedTx = {
        to:       CONTRACT_ADDRESS,
        data:     iface.encodeFunctionData('sendPayment', [receiverAddr]),
        value:    TRANSFER_AMOUNT,
        nonce:    nonce,
        gasLimit: gasEstimate,
        gasPrice: IS_SEPOLIA ? SEPOLIA_GAS_PRICE : (feeData.gasPrice || ethers.parseUnits('1', 'gwei')),
        chainId:  chainId,
      };

      const signedTx = await sender.signTransaction(unsignedTx);
      const tx       = await provider.broadcastTransaction(signedTx);
      const rec      = await tx.wait();
      const t1       = Date.now();

      results.blockchain.latencies.push(t1 - t0);

      if (rec && rec.gasUsed) {
        const gasUsed = BigInt(rec.gasUsed.toString());
        results.blockchain.gasUsed.push(Number(gasUsed));

        const gasPrice = rec.effectiveGasPrice && rec.effectiveGasPrice > 0n
          ? BigInt(rec.effectiveGasPrice.toString())
          : (IS_SEPOLIA ? SEPOLIA_GAS_PRICE : (feeData.gasPrice || ethers.parseUnits('1', 'gwei')));
        const gasCost  = gasUsed * gasPrice;
        results.blockchain.gasCostETH += Number(ethers.formatEther(gasCost));
      }

       // On local node: small delay for nonce propagation.
       // On Sepolia: tx.wait() already waits for confirmation (~12s/block).
       if (!IS_SEPOLIA) {
         await new Promise((r) => setTimeout(r, 30));
       }
       console.log(`  tx ${i + 1}/${NUM_TRANSFERS} complete (${t1 - t0}ms`);


    } catch (err) {
      results.blockchain.errors++;
      console.error(`  Error on tx ${i}: ${err.message.slice(0, 120)}`);
    }
  }

  results.blockchain.totalTime = (Date.now() - startTime) / 1000;
  results.blockchain.throughput = (NUM_TRANSFERS - results.blockchain.errors) / results.blockchain.totalTime;
}

function formatStats(latencies) {
  if (!latencies || latencies.length === 0) return { avg: 'N/A', min: 'N/A', max: 'N/A', p50: 'N/A', p90: 'N/A', p99: 'N/A' };
  const sorted = [...latencies].sort((a, b) => a - b);
  const sum    = latencies.reduce((a, b) => a + b, 0);
  const avg    = sum / latencies.length;
  const p50    = sorted[Math.floor(sorted.length * 0.5)];
  const p90    = sorted[Math.floor(sorted.length * 0.90)];
  const p99    = sorted[Math.floor(sorted.length * 0.99)];
  const min    = sorted[0];
  const max    = sorted[sorted.length - 1];
  return {
    avg: avg.toFixed(2) + ' ms',
    min: min.toFixed(2) + ' ms',
    max: max.toFixed(2) + ' ms',
    p50: p50.toFixed(2) + ' ms',
    p90: p90.toFixed(2) + ' ms',
    p99: p99.toFixed(2) + ' ms',
  };
}

function generateMarkdown() {
  const cStats = formatStats(results.centralized.latencies);
  const bStats = formatStats(results.blockchain.latencies);
  const cSuccessful = NUM_TRANSFERS - results.centralized.errors;
  const bSuccessful = NUM_TRANSFERS - results.blockchain.errors;
  const avgGas      = results.blockchain.gasUsed.length > 0
    ? (results.blockchain.gasUsed.reduce((a, b) => a + b, 0) / results.blockchain.gasUsed.length).toFixed(0)
    : 'N/A';

  const cThroughput = results.centralized.throughput;
  const bThroughput = results.blockchain.throughput;
  const fasterLabel = cThroughput > bThroughput ? 'Centralized' : 'Blockchain';
  const slowerLabel = cThroughput > bThroughput ? 'Blockchain' : 'Centralized';
  const throughputRatio = cThroughput > bThroughput
    ? cThroughput / bThroughput
    : bThroughput / cThroughput;
  const latencyRatio = results.blockchain.totalTime / results.centralized.totalTime;
  const fasterLatency = results.centralized.totalTime < results.blockchain.totalTime ? 'centralized' : 'blockchain';

  const NETWORK_LABEL = IS_SEPOLIA ? 'Sepolia testnet' : 'Hardhat local node';
  const GAS_NOTE      = IS_SEPOLIA ? 'Real gas costs incurred on Sepolia' : 'Free (Hardhat local node)';

  return `# Benchmark: Centralized SQLite vs Blockchain Contract Transfers

## Methodology

- **Tool:** Custom Node.js benchmark script (benchmarks/run-benchmarks.js)
- **Centralized Layer:** SQLite (local file: \`${SQLITE_FILE}\`)
- **Blockchain Layer:** ${NETWORK_LABEL} with deployed \`PaymentProcessor.sol\`
- **Transfers:** ${NUM_TRANSFERS} transfers of ${ethers.formatEther(TRANSFER_AMOUNT)} ETH each
- **Date:** ${new Date().toISOString()}
${IS_SEPOLIA ? '- **Note:** On Sepolia, each transaction waits for real block confirmation (~12s). Gas costs are real and deducted from the sender.' : '- **Note:** The Hardhat local node operates entirely in-memory with free gas, so blockchain latencies here are lower-bound estimates. On Sepolia or mainnet, add ~12s block time plus network RPC latency.'}

## Results Summary

| Metric | Centralized (SQLite) | Blockchain (Smart Contract) |
|---|---|---|
| Successful transfers | ${cSuccessful}/${NUM_TRANSFERS} | ${bSuccessful}/${NUM_TRANSFERS} |
| Throughput (tx/sec) | ${results.centralized.throughput.toFixed(2)} | ${results.blockchain.throughput.toFixed(2)} |
| Avg latency | ${cStats.avg} | ${bStats.avg} |
| Min latency | ${cStats.min} | ${bStats.min} |
| Max latency | ${cStats.max} | ${bStats.max} |
| p50 latency | ${cStats.p50} | ${bStats.p50} |
| p90 latency | ${cStats.p90} | ${bStats.p90} |
| p99 latency | ${cStats.p99} | ${bStats.p99} |
| Gas cost per tx | 0 | ${avgGas} gas |
| ETH cost per tx | 0 | ${results.blockchain.gasCostETH.toFixed(6)} ETH* |
| Total time | ${(results.centralized.totalTime / 1000).toFixed(3)}s | ${results.blockchain.totalTime.toFixed(3)}s |

*${GAS_NOTE}.

## Detailed Latency Distribution

| Statistic | Centralized (ms) | Blockchain (ms) |
|---|---|---|
| Min | ${cStats.min} | ${bStats.min} |
| p50 | ${cStats.p50} | ${bStats.p50} |
| p90 | ${cStats.p90} | ${bStats.p90} |
| p99 | ${cStats.p99} | ${bStats.p99} |
| Max | ${cStats.max} | ${bStats.max} |
| Avg | ${cStats.avg} | ${bStats.avg} |

## Analysis

### Throughput
On ${NETWORK_LABEL}, ${fasterLabel} achieves **${throughputRatio.toFixed(1)}x** higher throughput
(${fasterLabel === 'Centralized' ? results.centralized.throughput.toFixed(2) : results.blockchain.throughput.toFixed(2)} tx/s vs
${fasterLabel === 'Centralized' ? results.blockchain.throughput.toFixed(2) : results.centralized.throughput.toFixed(2)} tx/s).
${!IS_SEPOLIA ? '> **Important:** On a live Sepolia/mainnet, blockchain throughput would drop significantly due to block confirmation times (~12s) and network RPC latency. The centralized approach would dominate in raw throughput in that scenario.' : '> **Note:** On mainnet, blockchain throughput would be even lower (~1 tx every 12s), making the centralized approach dramatically faster.'}

### Latency
On ${NETWORK_LABEL}, ${fasterLatency} transfers are faster
(${(results.centralized.totalTime < results.blockchain.totalTime ? results.centralized.totalTime : results.blockchain.totalTime) / 1000}s vs
${(results.centralized.totalTime >= results.blockchain.totalTime ? results.centralized.totalTime : results.blockchain.totalTime) / 1000}s total).

### Cost
- **Centralized:** Zero marginal cost per transaction (no gas fees)
- **Blockchain:** ~${avgGas} gas per transaction (${GAS_NOTE})

### Trade-offs

| Aspect | Centralized | Blockchain |
|---|---|---|
| Trust | Requires trusting the service operator | Trustless (on-chain verification) |
| Speed (local) | Milliseconds | Milliseconds |
| Speed (mainnet) | Milliseconds | Seconds (block confirmation) |
| Cost | Free | Gas fees per transaction |
| Censorship resistance | No | Yes |
| Auditability | Backend-only | Public on-chain |
| Failure modes | Database failures | Network congestion, gas price spikes |

## Conclusion

On ${IS_SEPOLIA ? 'Sepolia' : 'the local Hardhat test environment'}, ${fasterLabel} is **${throughputRatio.toFixed(1)}x** faster
with avg latency of **${fasterLabel === 'Centralized' ? cStats.avg : bStats.avg}** vs
${fasterLabel === 'Centralized' ? bStats.avg : cStats.avg}. However, the blockchain approach provides
trustless settlement, censorship resistance, and on-chain auditability — key properties for a
decentralized payment system that cannot be replicated with a centralized database alone.
`;
}

async function main() {
  console.log('=== ChainPay Benchmark: Centralized SQLite vs Blockchain Contracts ===\n');

  const centralizedWallets = await setupCentralized();
  const blockchainSetup    = await setupBlockchain();

  await benchmarkCentralized(centralizedWallets);
  await benchmarkBlockchain(blockchainSetup);

  const cBal = await centralized.getBalance(centralizedWallets[0].walletAddress);
  const bBal = await blockchainSetup.provider.getBalance(blockchainSetup.receiver.address);

  console.log('\n=== Results ===');
  console.log(`Centralized: ${results.centralized.totalTime / 1000}s, ${results.centralized.throughput.toFixed(2)} tx/s, ${results.centralized.errors} errors`);
  console.log(`Blockchain:  ${results.blockchain.totalTime.toFixed(3)}s, ${results.blockchain.throughput.toFixed(2)} tx/s, ${results.blockchain.errors} errors`);
  console.log(`Avg gas/tx:  ${results.blockchain.gasUsed.length > 0 ? (results.blockchain.gasUsed.reduce((a,b)=>a+b,0)/results.blockchain.gasUsed.length).toFixed(0) : 'N/A'}`);
  console.log(`Total ETH spent on gas: ${results.blockchain.gasCostETH.toFixed(6)} ETH`);
  console.log(`Receiver balance (contract): ${ethers.formatEther(bBal)} ETH`);

  const markdown = generateMarkdown();
  const fs = require('fs');
const outputPath = path.resolve(__dirname, IS_SEPOLIA ? 'benchmark-results-sepolia.md' : 'benchmark-results.md');
  fs.writeFileSync(outputPath, markdown);
  console.log(`\nBenchmark results saved to: ${outputPath}`);

  await baselineDb.destroy();
}

main().catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
