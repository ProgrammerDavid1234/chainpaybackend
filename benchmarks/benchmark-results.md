# Benchmark: Centralized SQLite vs Blockchain Contract Transfers

## Methodology

- **Tool:** Custom Node.js benchmark script (benchmarks/run-benchmarks.js)
- **Centralized Layer:** SQLite (local file: `/home/olonadeoluwanifemi/Desktop/chainpaybackend/data/chainpay-baseline.sqlite3`)
- **Blockchain Layer:** Hardhat local node with deployed `PaymentProcessor.sol`
- **Transfers:** 25 transfers of 1.0 ETH each
- **Date:** 2026-08-09T09:25:49.497Z
- **Note:** The Hardhat local node operates entirely in-memory with free gas,
  so blockchain latencies here are lower-bound estimates. On Sepolia or mainnet,
  add ~12s block time plus network RPC latency.

## Results Summary

| Metric | Centralized (SQLite) | Blockchain (Smart Contract) |
|---|---|---|
| Successful transfers | 25/25 | 25/25 |
| Throughput (tx/sec) | 3.89 | 8.09 |
| Avg latency | 257.22 ms | 93.16 ms |
| Min latency | 212.54 ms | 54.00 ms |
| Max latency | 368.81 ms | 229.00 ms |
| p50 latency | 247.96 ms | 89.00 ms |
| p90 latency | 279.47 ms | 138.00 ms |
| p99 latency | 368.81 ms | 229.00 ms |
| Gas cost per tx | 0 | 41866 gas |
| ETH cost per tx | 0 | 0.000000 ETH* |
| Total time | 6.433s | 3.090s |

*Free (Hardhat local node).

## Detailed Latency Distribution

| Statistic | Centralized (ms) | Blockchain (ms) |
|---|---|---|
| Min | 212.54 ms | 54.00 ms |
| p50 | 247.96 ms | 89.00 ms |
| p90 | 279.47 ms | 138.00 ms |
| p99 | 368.81 ms | 229.00 ms |
| Max | 368.81 ms | 229.00 ms |
| Avg | 257.22 ms | 93.16 ms |

## Analysis

### Throughput
On Hardhat local node, Blockchain achieves **2.1x** higher throughput
(8.09 tx/s vs
3.89 tx/s).

> **Important:** On a live Sepolia/mainnet, blockchain throughput would drop significantly due to block confirmation times (~12s) and network RPC latency. The centralized approach would dominate in raw throughput in that scenario.

### Latency
On Hardhat local node, blockchain transfers are faster
(3.09s vs
6.433s total).

### Cost
- **Centralized:** Zero marginal cost per transaction (no gas fees)
- **Blockchain:** ~41866 gas per transaction (Free (Hardhat local node))

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

On the local Hardhat test environment, Blockchain is **2.1x** faster
with avg latency of **93.16 ms** vs
257.22 ms. However, the blockchain approach provides
trustless settlement, censorship resistance, and on-chain auditability — key properties for a
decentralized payment system that cannot be replicated with a centralized database alone.
