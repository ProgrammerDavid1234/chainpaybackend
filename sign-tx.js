const ethers = require('ethers');

// Replace with your actual private key from the faucet (without 0x prefix)
const privateKey = 'B7a0412F84C8293a209Ae383c010261188888888'; // e.g., 'abcd1234...'

const provider = new ethers.JsonRpcProvider('https://rpc.sepolia.org');
const wallet = new ethers.Wallet(privateKey, provider);

const txData = {
  to: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
  value: '100000000000000000',
  gasLimit: '21000',
  gasPrice: '3172037',
  nonce: 0,
  chainId: 11155111
};

async function signTx() {
  try {
    const signedTx = await wallet.signTransaction(txData);
    console.log('Signed transaction:');
    console.log(signedTx);
    console.log('\nUse this hex string in the broadcast endpoint.');
  } catch (error) {
    console.error('Error:', error.message);
  }
}


signTx();
