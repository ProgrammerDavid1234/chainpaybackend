# Benchmark: Centralized SQLite vs Blockchain Contract Transfers

## Methodology

- **Tool:** Custom Node.js benchmark script (benchmarks/run-benchmarks.js)
- **Centralized Layer:** SQLite (local file: `/home/olonadeoluwanifemi/Desktop/chainpaybackend/data/chainpay-baseline.sqlite3`)
- **Blockchain Layer:** Sepolia testnet with deployed `PaymentProcessor.sol`
- **Transfers:** 3 transfers of 0.001 ETH each
- **Date:** 2026-08-09T10:26:27.406Z
- **Note:** On Sepolia, each transaction waits for real block confirmation (~12s). Gas costs are real and deducted from the sender.

## Results Summary

| Metric | Centralized (SQLite) | Blockchain (Smart Contract) |
|---|---|---|
| Successful transfers | 3/3 | 3/3 |
| Throughput (tx/sec) | 3.94 | 0.09 |
| Avg latency | 252.36 ms | 10877.00 ms |
| Min latency | 220.04 ms | 8442.00 ms |
| Max latency | 280.17 ms | 12105.00 ms |
| p50 latency | 256.86 ms | 12084.00 ms |
| p90 latency | 280.17 ms | 12105.00 ms |
| p99 latency | 280.17 ms | 12105.00 ms |
| Gas cost per tx | 0 | 49515 gas |
| ETH cost per tx | 0 | 0.000446 ETH* |
| Total time | 0.761s | 32.632s |

*Real gas costs incurred on Sepolia.

## Detailed Latency Distribution

| Statistic | Centralized (ms) | Blockchain (ms) |
|---|---|---|
| Min | 220.04 ms | 8442.00 ms |
| p50 | 256.86 ms | 12084.00 ms |
| p90 | 280.17 ms | 12105.00 ms |
| p99 | 280.17 ms | 12105.00 ms |
| Max | 280.17 ms | 12105.00 ms |
| Avg | 252.36 ms | 10877.00 ms |

## Analysis

### Throughput
On Sepolia testnet, Centralized achieves **42.9x** higher throughput
(3.94 tx/s vs
0.09 tx/s).

> **Note:** On mainnet, blockchain throughput would be even lower (~1 tx every 12s), making the centralized approach dramatically faster.

### Latency
On Sepolia testnet, centralized transfers are faster
(0.761s vs
32.632s total).

### Cost
- **Centralized:** Zero marginal cost per transaction (no gas fees)
- **Blockchain:** ~49515 gas per transaction (Real gas costs incurred on Sepolia.)

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

On Sepolia, Centralized is **42.9x** faster
with avg latency of **252.36 ms** vs
10877.00 ms. However, the blockchain approach provides
trustless settlement, censorship resistance, and on-chain auditability — key properties for a
decentralized payment system that cannot be replicated with a centralized database alone.
