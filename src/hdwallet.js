import { APIClient } from './api.js';
import { 
  generateMnemonic, 
  validateMnemonic, 
  normalizeMnemonic 
} from './bip39.js';
import { 
  seedFromMnemonic, 
  derivePathSeed, 
  createWallet as cryptoCreateWallet, 
  generateSigningPayload, 
  signTransactionInput, 
  mineProofOfWork, 
  computeTransactionIdBytes 
} from './crypto.js';
import { validateAddress } from './bech32m.js';
import { bytesToHex } from './utils.js';

export const MIN_UTXO_MATURITY_SECONDS = 600;
export const MAX_TX_INPUTS = 64;
export const MAX_TX_OUTPUTS = 256;

export class SikkaHDWallet {
  constructor({ mnemonic, passphrase = "", nodeURL = 'https://1.sikkalabs.com', gapLimit = 10 } = {}) {
    if (mnemonic) {
      const normalized = normalizeMnemonic(mnemonic);
      if (!validateMnemonic(normalized)) {
        throw new Error("Invalid BIP-39 mnemonic phrase");
      }
      this.mnemonic = normalized;
    } else {
      this.mnemonic = generateMnemonic(256);
    }

    this.passphrase = passphrase;
    this.gapLimit = gapLimit;
    this.api = new APIClient(nodeURL);

    this.masterSeed = seedFromMnemonic(this.mnemonic, this.passphrase);
    this.masterSeedHex = bytesToHex(this.masterSeed);

    this.addressCache = new Map();
    this.pathCache = new Map();
  }

  async getWalletForPath(account = 0, branch = 0, index = 0) {
    const key = `${account}:${branch}:${index}`;
    if (this.pathCache.has(key)) {
      return this.pathCache.get(key);
    }

    const childSeed = derivePathSeed(this.masterSeed, account, branch, index);
    const childSeedHex = bytesToHex(childSeed);
    const wallet = await cryptoCreateWallet(childSeedHex);

    const walletObj = {
      ...wallet,
      account,
      branch,
      index
    };

    this.pathCache.set(key, walletObj);
    this.addressCache.set(wallet.address, walletObj);
    return walletObj;
  }

  async getReceiveAddress(index = 0) {
    const wallet = await this.getWalletForPath(0, 0, index);
    return wallet.address;
  }

  async getChangeAddress(index = 0) {
    const wallet = await this.getWalletForPath(0, 1, index);
    return wallet.address;
  }

  // Shorthand aliases
  async receiveAddress(index = 0) {
    return await this.getReceiveAddress(index);
  }

  async changeAddress(index = 0) {
    return await this.getChangeAddress(index);
  }

  async scanAddresses() {
    const allUtxos = [];
    const usedAddresses = [];
    let nextReceiveIndex = 0;
    let nextChangeIndex = 0;

    const now = Math.floor(Date.now() / 1000);

    // Scan Receive Addresses (Branch 0)
    let consecutiveUnusedReceive = 0;
    for (let index = 0; consecutiveUnusedReceive < this.gapLimit; index++) {
      const wallet = await this.getWalletForPath(0, 0, index);
      let info;
      try {
        info = await this.api.getAddressInfo(wallet.address);
      } catch (err) {
        info = { balance: 0, utxo_count: 0, unspentOutputs: [] };
      }

      const hasActivity = (info.utxo_count > 0) || (BigInt(info.balance || 0) > 0n) || (info.unspentOutputs && info.unspentOutputs.length > 0);

      if (hasActivity) {
        consecutiveUnusedReceive = 0;
        nextReceiveIndex = index + 1;
        usedAddresses.push({
          address: wallet.address,
          branch: 0,
          index,
          balance: info.balance,
          utxo_count: info.utxo_count
        });

        if (info.unspentOutputs) {
          for (const utxo of info.unspentOutputs) {
            if (utxo.created_at && (now < Number(utxo.created_at) + MIN_UTXO_MATURITY_SECONDS)) {
              continue; // Skip immature UTXO (< 10 min old)
            }
            allUtxos.push({
              ...utxo,
              address: wallet.address,
              walletObj: wallet
            });
          }
        }
      } else {
        consecutiveUnusedReceive++;
      }
    }

    // Scan Change Addresses (Branch 1)
    let consecutiveUnusedChange = 0;
    for (let index = 0; consecutiveUnusedChange < this.gapLimit; index++) {
      const wallet = await this.getWalletForPath(0, 1, index);
      let info;
      try {
        info = await this.api.getAddressInfo(wallet.address);
      } catch (err) {
        info = { balance: 0, utxo_count: 0, unspentOutputs: [] };
      }

      const hasActivity = (info.utxo_count > 0) || (BigInt(info.balance || 0) > 0n) || (info.unspentOutputs && info.unspentOutputs.length > 0);

      if (hasActivity) {
        consecutiveUnusedChange = 0;
        nextChangeIndex = index + 1;
        usedAddresses.push({
          address: wallet.address,
          branch: 1,
          index,
          balance: info.balance,
          utxo_count: info.utxo_count
        });

        if (info.unspentOutputs) {
          for (const utxo of info.unspentOutputs) {
            if (utxo.created_at && (now < Number(utxo.created_at) + MIN_UTXO_MATURITY_SECONDS)) {
              continue; // Skip immature UTXO (< 10 min old)
            }
            allUtxos.push({
              ...utxo,
              address: wallet.address,
              walletObj: wallet
            });
          }
        }
      } else {
        consecutiveUnusedChange++;
      }
    }

    return {
      utxos: allUtxos,
      usedAddresses,
      nextReceiveIndex,
      nextChangeIndex
    };
  }

  async getNewUnusedAddress() {
    const scan = await this.scanAddresses();
    const wallet = await this.getWalletForPath(0, 0, scan.nextReceiveIndex);
    return wallet.address;
  }

  async getUsedAddresses() {
    const scan = await this.scanAddresses();
    return scan.usedAddresses;
  }

  // Shorthand aliases
  async newAddress() {
    return await this.getNewUnusedAddress();
  }

  async unusedAddress() {
    return await this.getNewUnusedAddress();
  }

  async usedAddresses() {
    return await this.getUsedAddresses();
  }

  async balance() {
    const scan = await this.scanAddresses();
    let total = 0n;
    for (const utxo of scan.utxos) {
      total += BigInt(utxo.value);
    }
    return total;
  }

  async send(amount, recipientAddr) {
    amount = BigInt(amount);
    if (amount <= 0n) {
      throw new Error("Amount must be greater than 0");
    }

    validateAddress(recipientAddr);

    const scan = await this.scanAddresses();
    if (!scan.utxos || scan.utxos.length === 0) {
      throw new Error("Insufficient mature balance across HD wallet (no spendable outputs found)");
    }

    const selectedUtxos = [];
    let inputTotal = 0n;
    for (const utxo of scan.utxos) {
      selectedUtxos.push(utxo);
      inputTotal += BigInt(utxo.value);
      if (inputTotal >= amount) break;
    }

    if (inputTotal < amount) {
      throw new Error(`Insufficient balance across HD wallet. Have ${inputTotal}, need ${amount}`);
    }

    if (selectedUtxos.length > MAX_TX_INPUTS) {
      throw new Error(`Transaction exceeds maximum inputs limit of ${MAX_TX_INPUTS} (selected ${selectedUtxos.length})`);
    }

    const latestTips = await this.api.getLatestTransactionTips();

    const transactionOutputs = [{ address: recipientAddr, value: Number(amount) }];
    const changeAmount = inputTotal - amount;
    let changeWallet = null;

    if (changeAmount > 0n) {
      changeWallet = await this.getWalletForPath(0, 1, scan.nextChangeIndex);
      transactionOutputs.push({
        address: changeWallet.address,
        value: Number(changeAmount)
      });
    }

    if (transactionOutputs.length > MAX_TX_OUTPUTS) {
      throw new Error(`Transaction exceeds maximum outputs limit of ${MAX_TX_OUTPUTS}`);
    }

    const transactionInputs = selectedUtxos.map(utxo => ({
      txid: utxo.txid,
      index: utxo.index
    }));

    const transaction = {
      parents: latestTips,
      inputs: transactionInputs,
      outputs: transactionOutputs,
      timestamp: Math.floor(Date.now() / 1000)
    };

    // Sign each input with its specific child private key
    for (let i = 0; i < selectedUtxos.length; i++) {
      const utxo = selectedUtxos[i];
      const payloadToSign = generateSigningPayload(transaction, i, utxo);
      const signatureHex = await signTransactionInput(utxo.walletObj.privateKey, payloadToSign);
      
      transaction.inputs[i].witness = {
        type: "threshold",
        threshold: {
          threshold: 1,
          public_keys: [utxo.walletObj.pubKeyHex],
          signatures: [signatureHex]
        }
      };
    }

    // Get Proof of Work Quote & Mine
    const powQuote = await this.api.getProofOfWorkQuote(transaction);
    transaction.parent_pow_hashes = powQuote.parent_pow_hashes;
    await mineProofOfWork(transaction, powQuote.required_bits);

    // Compute Transaction ID & Submit
    const transactionIdBytes = computeTransactionIdBytes(transaction);
    transaction.id = Array.from(transactionIdBytes)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    const txID = await this.api.submitTransaction(transaction);
    return {
      txID,
      sentAmount: amount,
      changeAddress: changeWallet ? changeWallet.address : null
    };
  }
}

export async function createHDWallet(options = {}) {
  const wallet = new SikkaHDWallet(options);
  return wallet;
}

export const hdWallet = createHDWallet;
