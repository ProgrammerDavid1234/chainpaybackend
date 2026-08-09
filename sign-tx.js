const { ethers } = require("ethers");

// Transaction data
const txData = {
  from: "0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
  to: "0x4e9b4e1061b60f0f5a2920e8756898ac11ef8b1e",
  value: "1000000000000000000",
  gasLimit: "21000",
  gasPrice: "1461149",
  nonce: 0,
  chainId: 11155111
};

// Replace with your private key
const privateKey = "YOUR_PRIVATE_KEY";

// Connect to the network (e.g., Sepolia testnet)
const provider = new ethers.JsonRpcProvider("https://sepolia.infura.io/v3/YOUR_INFURA_PROJECT_ID");
const wallet = new ethers.Wallet(privateKey, provider);

async function sendTx() {
  const tx = await wallet.sendTransaction(txData);
  console.log("Transaction hash:", tx.hash);
  await tx.wait();
  console.log("Transaction confirmed!");
}

sendTx().catch(console.error);