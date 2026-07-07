import { createBrainWallet, SikkaClient } from './src/index.js';

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runTest() {
  console.log("========================================");
  console.log("Sikka SDK Integration Test");
  console.log("========================================");
  
  console.log("\n1. Creating wallet...");
  // Using a random passphrase to ensure a fresh wallet for every test run
  const passphrase = "test-wallet-" + Date.now();
  const wallet = await createBrainWallet(passphrase);
  
  console.log("   Wallet created successfully!");
  console.log("   Address:    ", wallet.address);
  console.log("   Public Key: ", wallet.pubKeyHex);
  
  // Use default node URL (https://1.sikkalabs.com)
  const client = new SikkaClient({ wallet });
  
  console.log("\n2. Waiting for funds...");
  console.log(`   Please send some Sikka to: ${wallet.address}`);
  console.log("   Polling balance every 5 seconds...");
  
  let balance = 0;
  while (true) {
    try {
      balance = await client.balance(wallet.address);
      if (balance > 0) {
        console.log(`\n   Funds received! Current balance: ${balance}`);
        break;
      }
      process.stdout.write(".");
    } catch (err) {
      console.error("\n   Error checking balance:", err.message);
    }
    await sleep(5000); // Check every 5 seconds
  }
  
  console.log("\n3. Sending funds back to the same address...");
  console.log("   (This consolidates UTXOs and tests the send & PoW functionality)");
  try {
    console.log(`   Sending ${balance} to ${wallet.address}...`);
    console.log("   Computing Proof of Work (this may take a few moments)...");
    
    const result = await client.send(balance, wallet.address);
    
    console.log("\n========================================");
    console.log("Test Completed Successfully!");
    console.log("========================================");
    console.log("Transaction ID:", result.txID);
    console.log("Sent Amount:   ", result.sentAmount.toString());
  } catch (err) {
    console.error("\n   Failed to send transaction:", err.message);
  }
}

runTest().catch(console.error);
