import { APIClient } from './api.js';
import { 
  createWallet as cryptoCreateWallet, 
  createBrainWallet as cryptoCreateBrainWallet, 
  computeTransactionIdBytes, 
  mineProofOfWork, 
  generateSigningPayload, 
  signTransactionInput 
} from './crypto.js';
import { validateAddress } from './bech32m.js';

export async function createWallet(seedHex) {
  return await cryptoCreateWallet(seedHex);
}

export async function createBrainWallet(passphrase) {
  return await cryptoCreateBrainWallet(passphrase);
}

export class SikkaClient {
  constructor({ nodeURL = 'https://1.sikkalabs.com', wallet } = {}) {
    this.api = new APIClient(nodeURL);
    this.wallet = wallet;
  }

  async balance(address) {
    const targetAddress = address || (this.wallet && this.wallet.address);
    if (!targetAddress) {
      throw new Error("Address is required to get balance");
    }
    const addressInfo = await this.api.getAddressInfo(targetAddress);
    return addressInfo.balance;
  }

  async pow(transaction, minimumBits) {
    return await mineProofOfWork(transaction, minimumBits);
  }

  async send(amount, recipientAddr) {
    if (!this.wallet) {
      throw new Error("Wallet must be set in SikkaClient to send transactions");
    }
    
    amount = BigInt(amount);
    if (amount <= 0n) {
      throw new Error("Amount must be greater than 0");
    }
    
    const senderAddr = this.wallet.address;
    const addressInfo = await this.api.getAddressInfo(senderAddr);
    
    const currentBalance = BigInt(addressInfo.balance);
    if (currentBalance === 0n || !addressInfo.unspentOutputs || addressInfo.unspentOutputs.length === 0) {
      throw new Error("Insufficient balance (no unspent outputs found)");
    }
    
    const selectedUtxos = [];
    let inputTotal = 0n;
    for (const utxo of addressInfo.unspentOutputs) {
      selectedUtxos.push(utxo);
      inputTotal += BigInt(utxo.value);
      if (inputTotal >= amount) break;
    }
    
    if (inputTotal < amount) {
      throw new Error("Insufficient balance to cover the exact send amount");
    }
    
    const latestTips = await this.api.getLatestTransactionTips();
    
    const transactionOutputs = [{ address: recipientAddr, value: Number(amount) }];
    const changeAmount = inputTotal - amount;
    if (changeAmount > 0n) {
      transactionOutputs.push({ address: senderAddr, value: Number(changeAmount) });
    }
    
    const transactionInputs = selectedUtxos.map(utxo => ({ txid: utxo.txid, index: utxo.index }));
    
    const transaction = {
      parents: latestTips,
      inputs: transactionInputs,
      outputs: transactionOutputs,
      timestamp: Math.floor(Date.now() / 1000)
    };
    
    // Sign inputs
    for (let i = 0; i < selectedUtxos.length; i++) {
      const payloadToSign = generateSigningPayload(transaction, i, selectedUtxos[i]);
      const signatureHex = await signTransactionInput(this.wallet.privateKey, payloadToSign);
      transaction.inputs[i].witness = {
        type: "threshold",
        threshold: {
          threshold: 1,
          public_keys: [this.wallet.pubKeyHex],
          signatures: [signatureHex]
        }
      };
    }
    
    // Get Proof of Work Quote
    const powQuote = await this.api.getProofOfWorkQuote(transaction);
    transaction.parent_pow_hashes = powQuote.parent_pow_hashes;
    
    // Mine Proof of Work
    await this.pow(transaction, powQuote.required_bits);
    
    // Compute final Transaction ID
    const transactionIdBytes = computeTransactionIdBytes(transaction);
    transaction.id = Array.from(transactionIdBytes)
      .map(byte => byte.toString(16).padStart(2, '0'))
      .join('');
    
    // Submit Transaction to Network
    const finalTxID = await this.api.submitTransaction(transaction);
    return { txID: finalTxID, sentAmount: amount };
  }
}
