# ⚡ Sikka JavaScript & Browser SDK (`sikka-sdk`)

A lightweight, zero-dependency, post-quantum JavaScript SDK for the **Sikka** blockchain network. Built for modern Web browsers and Node.js environments.

Provides full wallet management, 24-word BIP-39 mnemonic seed phrases, Hierarchical Deterministic (HD) address derivation, NIST ML-DSA-87 signatures, and automated Proof-of-Work (PoW) transaction mining.

---

## 🌟 Key Features

- **🛡️ Quantum-Resistant Cryptography**: Built-in support for **NIST ML-DSA-87** (Module-Lattice-Based Digital Signature Algorithm, FIPS 204) via WebAssembly (`mldsa-wasm`).
- **🔑 Complete Wallet Suite**: 
  - 12–24 word BIP-39 seed phrase generation & validation.
  - Hierarchical Deterministic (HD) path derivation (`account / branch / index`).
  - Raw 32-byte hex seed restoration.
  - Deterministic brain wallet creation.
- **⚡ Automatic Proof-of-Work (PoW)**: Automatically fetches difficulty quotes from the node, mines SHA3-256 PoW nonces locally, and broadcasts transactions seamlessly.
- **🌐 100% Browser & Node.js Compatible**: Uses standard Web Cryptography, `Uint8Array`, `DataView`, and native `fetch`. Zero legacy Node.js dependencies (no `Buffer` or `crypto` module required).
- **🕸️ DAG Network Integration**: Automatic UTXO selection, DAG parent tip resolution, and transaction submission.

---

## 📦 Installation

Install directly via `npm`, `yarn`, `pnpm`, or `bun`:

```bash
npm install sikkalabs/sikka-sdk
```

---

## 🚀 Quick Start (In 4 Simple Steps)

### Step 1: Create an All-in-One HD Wallet
```javascript
import { createHDWallet } from 'sikka-sdk';

// 1. Create HD wallet (Generates a 24-word seed phrase if none provided)
const wallet = await createHDWallet({
  mnemonic: "optional 24 word mnemonic...", 
  passphrase: "optional-passphrase",
  nodeURL: "https://1.sikkalabs.com"
});

console.log("24-Word Seed Phrase:", wallet.mnemonic);

// 2. Get receive addresses and check total balance across all HD addresses
const receiveAddr = await wallet.getReceiveAddress();     // Default [0/0/0]
const newAddr     = await wallet.getNewUnusedAddress();   // Next clean receive address
const totalBal   = await wallet.balance();               // Aggregated balance across receive & change

// 3. Send Sikka (Auto-selects UTXOs, routes change to fresh address, signs & mines PoW)
const { txID, sentAmount, changeAddress } = await wallet.send(500000n, "sikka1...");
```

### Step 2: Initialize the Client
```javascript
import { SikkaClient } from 'sikka-sdk';

const client = new SikkaClient({
  nodeURL: 'https://1.sikkalabs.com', // Default public node
  wallet: wallet
});
```

### Step 3: Check Your Balance
```javascript
// Amount is returned in "chillar" (1 Sikka = 1,000,000 chillar)
const balance = await client.balance();
console.log(`Current Balance: ${balance} chillar`);
```

### Step 4: Send Sikka (Automated PoW Mining & Signing)
```javascript
try {
  const recipientAddress = "sikka1pxarypt7u0aaxr870s0fp286kth009867syxmx25jcctley5zv9mqve907y";
  const amountToSend = 500000n; // 0.5 Sikka in chillar

  console.log("Mining Proof-of-Work and sending transaction...");
  const { txID, sentAmount } = await client.send(amountToSend, recipientAddress);
  
  console.log(`Successfully sent ${sentAmount} chillar! TxID: ${txID}`);
} catch (error) {
  console.error("Transaction failed:", error.message);
}
```

---

## 📖 Deep Dive: Wallet Management

### 1. Generating & Restoring 24-Word Seed Phrases (BIP-39)

The Sikka protocol uses BIP-39 mnemonic phrases (12 to 24 words) combined with `HKDF-SHA3-256` key derivation.

```javascript
import { 
  generateMnemonic, 
  validateMnemonic, 
  createWalletFromMnemonic 
} from 'sikka-sdk';

// Generate 256-bit entropy (24 words)
const mnemonic = generateMnemonic(256);

// Validate an incoming mnemonic phrase string
if (validateMnemonic(mnemonic)) {
  // Create wallet from mnemonic with optional extra passphrase
  const wallet = await createWalletFromMnemonic(mnemonic, "optional-user-passphrase");

  console.log("Address:", wallet.address);         // e.g. sikka1...
  console.log("Public Key:", wallet.pubKeyHex);    // 2592 bytes hex
  console.log("Private Seed:", wallet.privKeyHex); // 32 bytes hex
}
```

---

### 2. Hierarchical Deterministic (HD) Child Wallets

Derive multiple deterministic child wallets from a single master seed using Sikka's HD derivation rule (`account / branch / index`):

- **Branch `0`**: External / Receive addresses
- **Branch `1`**: Internal / Change addresses

```javascript
import { 
  seedFromMnemonic, 
  createWalletFromPath 
} from 'sikka-sdk';

// 1. Derive 32-byte master seed from mnemonic
const masterSeed = seedFromMnemonic(mnemonic, "optional-passphrase");

// 2. Derive Receive Address 0 (account=0, branch=0, index=0)
const receive0 = await createWalletFromPath(masterSeed, 0, 0, 0);
console.log("Receive Address #0:", receive0.address);

// 3. Derive Receive Address 1 (account=0, branch=0, index=1)
const receive1 = await createWalletFromPath(masterSeed, 0, 0, 1);
console.log("Receive Address #1:", receive1.address);

// 4. Derive Change Address 0 (account=0, branch=1, index=0)
const change0 = await createWalletFromPath(masterSeed, 0, 1, 0);
console.log("Change Address #0:", change0.address);
```

---

### 3. Hex Seed Restoration & Brain Wallets

```javascript
import { createWallet, createBrainWallet } from 'sikka-sdk';

// Restore directly from a 32-byte (64 hex characters) seed
const restoredWallet = await createWallet("c279e8a75d507117...");

// Create a deterministic brain wallet from any arbitrary passphrase
const brainWallet = await createBrainWallet("username:secret-phrase-123");
console.log("Brain Wallet Address:", brainWallet.address);
```

---

## 🔬 Sikka Cryptography & Architecture Explained

### Post-Quantum Signatures (ML-DSA-87)
Sikka replaces legacy ECDSA/Ed25519 signatures with **ML-DSA-87** (NIST FIPS 204), protecting funds against quantum computer attacks.
- **Public Key Size**: 2,592 bytes
- **Signature Size**: 4,627 bytes

### Bech32m Address Format
A Sikka address is a Bech32m commitment to a 1-of-1 threshold policy:
$$\text{Address Payload} = \text{SHA3-256}( \texttt{0x01} \parallel \text{UTF8Bytes("mldsa87:1:[pubKeyHex]")} )$$
Formatted as Bech32m with prefix `sikka` and version `1` (e.g., `sikka1...`).

### How Proof-of-Work (PoW) Works
Transactions require client-side Proof-of-Work to prevent network spam:
1. `client.send(...)` fetches a PoW quote from the node (`/v1/tx/pow-quote`) returning target `required_bits` and DAG parent hashes.
2. The SDK mines a `pow_nonce` locally in JavaScript until:
   $$\text{LeadingZeroBits}(\text{SHA3-256}(\text{txID} \parallel \text{parentPow0} \parallel \text{parentPow1} \parallel \text{nonce})) \ge \text{required\_bits}$$
3. The signed transaction with PoW headers is broadcast to `/v1/tx/submit`.

---

## 💡 Web Application Performance (Web Workers)

When integrating `sikka-sdk` into Web Browser UIs (React, Vue, Svelte, Vanilla JS), heavy PoW mining can be offloaded to a **Web Worker** so the main UI thread never freezes.

```javascript
// worker.js
import { SikkaClient, createWalletFromMnemonic } from 'sikka-sdk';

self.onmessage = async (e) => {
  const { mnemonic, recipient, amount } = e.data;
  const wallet = await createWalletFromMnemonic(mnemonic);
  const client = new SikkaClient({ wallet });

  const result = await client.send(amount, recipient);
  self.postMessage({ success: true, result });
};
```

---

## 🛠️ API Reference

### Core Functions & Shorthand Aliases

| Function / Shorthand | Alternative Name | Return Type | Description |
| :--- | :--- | :--- | :--- |
| `createHDWallet(options)` | `hdWallet(options)` | `Promise<SikkaHDWallet>` | Creates an all-in-one smart HD wallet. |
| `generateMnemonic(bits)` | `newMnemonic(bits)` | `string` | Generates 12–24 word BIP-39 mnemonic (default `256`). |
| `validateMnemonic(mnemonic)` | `isValidMnemonic(mnemonic)` | `boolean` | Checks word count, wordlist, and SHA-256 checksum. |
| `createWalletFromMnemonic()` | `fromMnemonic()` / `walletFromMnemonic()` | `Promise<Wallet>` | Derives ML-DSA-87 wallet from a 24-word seed phrase. |
| `createWalletFromPath()` | `fromPath()` / `walletFromPath()` | `Promise<Wallet>` | Derives HD child wallet for specified path. |
| `createWallet(seedHex?)` | `wallet(seedHex?)` | `Promise<Wallet>` | Creates a wallet from a 32-byte hex seed or random entropy. |
| `createBrainWallet(passphrase)` | `brainWallet(passphrase)` | `Promise<Wallet>` | Creates a wallet deterministically from any string. |
| `sikkaToChillar(sikka)` | `toChillar(sikka)` / `fromSikka(sikka)` | `bigint` | Converts Sikka amount to chillar (`1 Sikka = 10,000,000,000 chillar`). |
| `chillarToSikka(chillar)` | `toSikka(chillar)` / `fromChillar(chillar)` | `string \| number` | Converts chillar amount to Sikka formatted string or float. |
| `validateAddress(address)` | `isValidAddress(address)` | `string` | Validates a `sikka1...` Bech32m address string. |

### `SikkaClient` Class

```javascript
const client = new SikkaClient({ nodeURL: 'https://1.sikkalabs.com', wallet });
```

- **`async balance(address?: string)`**: Queries balance in chillar for wallet or specified address.
- **`async send(amount: bigint | number, recipientAddress: string)`**: Executes UTXO selection, requests PoW quote, mines PoW, signs inputs, and submits transaction. Returns `{ txID, sentAmount }`.
- **`async pow(transaction, minimumBits)`**: Mines Proof-of-Work nonce directly on a transaction object.

---

## 📜 License

ISC License. Built by [Sikka Labs](https://github.com/sikkalabs).
