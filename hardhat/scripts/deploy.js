const fs = require('fs');
const path = require('path');
const { ethers } = require('hardhat');

async function main() {
  console.log('=== ChainPay Contract Deployment ===\n');

  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Balance:  ${ethers.formatEther(balance)} ETH\n`);

  // ── Deploy WalletRegistry ──────────────────────────────────────────────
  const WalletRegistry = await ethers.getContractFactory('WalletRegistry');
  console.log('Deploying WalletRegistry...');
  const walletRegistry = await WalletRegistry.deploy();
  await walletRegistry.waitForDeployment();
  const walletRegistryAddr = await walletRegistry.getAddress();
  console.log(`WalletRegistry deployed to: ${walletRegistryAddr}\n`);

  // ── Deploy PaymentProcessor ────────────────────────────────────────────
  const PaymentProcessor = await ethers.getContractFactory('PaymentProcessor');
  console.log('Deploying PaymentProcessor...');
  const paymentProcessor = await PaymentProcessor.deploy();
  await paymentProcessor.waitForDeployment();
  const paymentProcessorAddr = await paymentProcessor.getAddress();
  console.log(`PaymentProcessor deployed to: ${paymentProcessorAddr}\n`);

  // ── Save to .env ───────────────────────────────────────────────────────
  const envPath  = path.resolve(__dirname, '../../.env');
  const existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';

  const updates = [
    { key: 'PAYMENT_PROCESSOR_ADDRESS', value: paymentProcessorAddr },
    { key: 'WALLET_REGISTRY_ADDRESS',   value: walletRegistryAddr },
  ];

  let updated = existing;
  for (const { key, value } of updates) {
    const re = new RegExp(`^${key}=.*`, 'm');
    const line = `${key}=${value}`;
    updated = re.test(updated) ? updated.replace(re, line) : updated + `\n${line}`;
  }
  fs.writeFileSync(envPath, updated);
  console.log('Addresses written to .env');
  console.log(`  PAYMENT_PROCESSOR_ADDRESS=${paymentProcessorAddr}`);
  console.log(`  WALLET_REGISTRY_ADDRESS=${walletRegistryAddr}`);
  console.log('\n=== Deployment complete ===');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
