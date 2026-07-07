import { APIClient } from './api.js';
import { createWallet as cryptoCreateWallet, computeTxIDRaw, txPowHash, minePoW, signingPayload, signInput } from './crypto.js';
import { validateAddress } from './bech32m.js';

export async function createWallet(seedHex) {
  return await cryptoCreateWallet(seedHex);
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
    const info = await this.api.getAddressInfo(targetAddress);
    return info.balance;
  }

  async pow(tx, minBits) {
    return await minePoW(tx, minBits);
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
    const info = await this.api.getAddressInfo(senderAddr);
    
    const balance = BigInt(info.balance);
    if (balance === 0n || !info.utxos || info.utxos.length === 0) {
      throw new Error("Insufficient balance (no utxos)");
    }
    
    const selected = [];
    let inputTotal = 0n;
    for (const u of info.utxos) {
      selected.push(u);
      inputTotal += BigInt(u.value);
      if (inputTotal >= amount) break;
    }
    
    if (inputTotal < amount) {
      throw new Error("Insufficient balance to cover send amount");
    }
    
    const tips = await this.api.getTips();
    
    const outputs = [{ address: recipientAddr, value: Number(amount) }];
    const change = inputTotal - amount;
    if (change > 0n) {
      outputs.push({ address: senderAddr, value: Number(change) });
    }
    
    const inputs = selected.map(u => ({ txid: u.txid, index: u.index }));
    
    const tx = {
      parents: tips,
      inputs: inputs,
      outputs: outputs,
      timestamp: Math.floor(Date.now() / 1000)
    };
    
    // Sign inputs
    for (let i = 0; i < selected.length; i++) {
      const payload = signingPayload(tx, i, selected[i]);
      const sig = await signInput(this.wallet.privateKey, payload);
      tx.inputs[i].witness = {
        type: "threshold",
        threshold: {
          threshold: 1,
          public_keys: [this.wallet.pubKeyHex],
          signatures: [sig]
        }
      };
    }
    
    // Get PoW Quote
    const quote = await this.api.getPowQuote(tx);
    tx.parent_pow_hashes = quote.parent_pow_hashes;
    
    // Mine PoW
    await this.pow(tx, quote.required_bits);
    
    // Compute TX ID
    const txIDRaw = computeTxIDRaw(tx);
    tx.id = Array.from(txIDRaw).map(b => b.toString(16).padStart(2, '0')).join('');
    
    // Submit TX
    const txID = await this.api.submitTx(tx);
    return { txID, sentAmount: amount };
  }
}
