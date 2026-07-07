# Sikka JS SDK

A lightweight, browser-compatible JavaScript SDK for interacting with the Sikka node, creating wallets, and sending transactions with built-in Proof-of-Work (PoW).

## Installation

```bash
npm install sikka-sdk
```

## Usage

### 1. Create a Wallet

You can create a new wallet, restore an existing one from a 32-byte hex seed, or create a brain wallet from any arbitrary string (like `username:nonce`).

```javascript
import { createWallet, createBrainWallet, SikkaClient } from 'sikka-sdk';

// Create a new random wallet
const wallet = await createWallet();
console.log("Address:", wallet.address);
console.log("Private Key:", wallet.privKeyHex);

// Restore an existing wallet from a 32-byte (64 character) hex seed
const restoredWallet = await createWallet("YOUR_32_BYTE_HEX_SEED_HERE");

// Create a brain wallet deterministically from ANY string
const brainWallet = await createBrainWallet("user123:nonce1"); 
console.log("Brain Wallet Address:", brainWallet.address);
```

### 2. Initialize the Client

Initialize the client with your Sikka node URL and wallet. The default node is `https://1.sikkalabs.com`.

```javascript
const client = new SikkaClient({
  nodeURL: 'https://1.sikkalabs.com',
  wallet: wallet
});
```

### 3. Check Balance

```javascript
const balance = await client.balance();
console.log(`Balance: ${balance} chillar`);

// You can also check the balance of any other address
const otherBalance = await client.balance("sikka1...");
```

### 4. Send Transactions (with automatic PoW)

Sending transactions will automatically fetch the current PoW quote from the node, mine the required PoW locally in JavaScript, sign the transaction, and submit it to the node.

```javascript
try {
  // Amount is in chillar
  const amountToSend = 500000n;
  const recipient = "sikka1...";
  
  const { txID, sentAmount } = await client.send(amountToSend, recipient);
  console.log(`Successfully sent ${sentAmount} chillar! TxID: ${txID}`);
} catch (error) {
  console.error("Failed to send transaction:", error);
}
```

## Features
- **Browser & Node.js Compatible:** Uses standard `Uint8Array`, `DataView`, and `fetch`. No Node.js `Buffer` or `crypto` module dependencies.
- **ML-DSA Signatures:** Built-in support for ML-DSA-87 signatures via `mldsa-wasm`.
- **Automatic PoW:** Automatically mines the required Proof-of-Work for your transactions before submission.
