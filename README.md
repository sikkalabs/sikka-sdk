# Sikka JS SDK

A lightweight, browser-compatible JavaScript SDK for interacting with the Sikka node, creating wallets (BIP-39 mnemonics, HD child wallets, seed restoration, brain wallets), and sending transactions with built-in Proof-of-Work (PoW).

## Installation

To install the SDK directly from GitHub, run:

```bash
npm install sikkalabs/sikka-sdk
```

## Usage

### 1. Create & Manage Wallets

The Sikka SDK supports full wallet management compatible with the Sikka Go node specification:

#### A. Generate & Restore from 24-Word BIP-39 Seed Mnemonic

```javascript
import { 
  generateMnemonic, 
  validateMnemonic, 
  createWalletFromMnemonic,
  createWalletFromPath,
  seedFromMnemonic,
  createWallet, 
  createBrainWallet, 
  SikkaClient 
} from 'sikka-sdk';

// 1. Generate a new 24-word BIP-39 mnemonic (256 bits entropy)
const mnemonic = generateMnemonic(256);
console.log("Mnemonic:", mnemonic);

// 2. Validate mnemonic
if (validateMnemonic(mnemonic)) {
  console.log("Mnemonic is valid!");
}

// 3. Create wallet from mnemonic (with optional passphrase)
const wallet = await createWalletFromMnemonic(mnemonic, "optional-passphrase");
console.log("Address:", wallet.address);
console.log("Public Key:", wallet.pubKeyHex);
console.log("Private Key / Seed Hex:", wallet.privKeyHex);
```

#### B. Hierarchical Deterministic (HD) Child Wallets

Derive deterministic child addresses following Sikka's HD derivation (`account / branch / index`):

```javascript
// 1. Derive master 32-byte ML-DSA-87 seed from mnemonic
const masterSeed = seedFromMnemonic(mnemonic, "optional-passphrase");

// 2. Derive HD child wallet for account 0, external branch (0), index 0
const receiveWallet0 = await createWalletFromPath(masterSeed, 0, 0, 0);
console.log("Receive Address 0:", receiveWallet0.address);

// 3. Derive HD child wallet for account 0, internal/change branch (1), index 0
const changeWallet0 = await createWalletFromPath(masterSeed, 0, 1, 0);
console.log("Change Address 0:", changeWallet0.address);
```

#### C. Other Wallet Creation Options

```javascript
// Create a new random wallet
const randomWallet = await createWallet();

// Restore from an existing 32-byte (64 hex characters) seed
const restoredWallet = await createWallet("YOUR_32_BYTE_HEX_SEED_HERE");

// Create a brain wallet deterministically from any string
const brainWallet = await createBrainWallet("user123:passphrase");
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

Sending transactions automatically fetches the current PoW quote from the node, mines the required PoW locally in JavaScript, signs the transaction with ML-DSA-87, and submits it to the node.

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

- **Full Wallet Suite:** Complete support for 12–24 word BIP-39 mnemonics, HD child wallet derivation (`account/branch/index`), raw seed restoration, and brain wallets.
- **Protocol Compatible:** Fully aligned with Sikka node cryptographic specs (`bip39-hkdf-sha3-256-mldsa87-v1` and `bip39-hd-hkdf-sha3-256-mldsa87-v1`).
- **Browser & Node.js Compatible:** Uses standard `Uint8Array`, `DataView`, `@noble/hashes`, and Web Cryptography. No Node.js `Buffer` or legacy dependencies.
- **Post-Quantum Signatures:** Built-in support for NIST ML-DSA-87 signatures via `mldsa-wasm`.
- **Automatic PoW:** Automatically mines the required Proof-of-Work for transactions before submission.
