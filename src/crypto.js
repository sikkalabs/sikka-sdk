import { sha3_256 } from '@noble/hashes/sha3.js';
import { encodeBech32m } from './bech32m.js';
import mldsa from 'mldsa-wasm';
import { hexToBytes, bytesToHex, stringToBytes, concatBytes } from './utils.js';

const SIGNING_DOMAIN = "sikka:v2:txinput";
const ADDRESS_VERSION = 1;
const ADDRESS_HRP = "sikka";

export async function createWallet(seedHex) {
  let seedBytes;
  
  if (seedHex) {
    seedBytes = hexToBytes(seedHex.trim());
    if (seedBytes.length !== 32) {
      throw new Error(`Expected 32-byte seed (64 hex chars), got ${seedBytes.length} bytes`);
    }
  } else {
    seedBytes = new Uint8Array(32);
    crypto.getRandomValues(seedBytes);
  }

  const privateKey = await mldsa.importKey(
    "raw-seed",
    seedBytes,
    { name: "ML-DSA-87" },
    false,
    ["sign"]
  );

  const publicKey = await mldsa.getPublicKey(privateKey, ["verify"]);
  const pubKeyBytes = new Uint8Array(await mldsa.exportKey("raw-public", publicKey));
  const pubKeyHex = bytesToHex(pubKeyBytes);

  const descriptorBytes = stringToBytes(`mldsa87:1:[${pubKeyHex}]`);
  const versionByte = new Uint8Array([ADDRESS_VERSION]);
  const payloadToHash = concatBytes(versionByte, descriptorBytes);
  const payloadHash = sha3_256(payloadToHash);

  const address = encodeBech32m(ADDRESS_HRP, ADDRESS_VERSION, payloadHash);

  // We return the privateKey handle, the hex, pubkey hex, and address.
  // Note: the private key export format depends on mldsa-wasm. 
  // We'll just return the seed as privKeyHex since that's enough to recreate it.
  const privKeyHex = bytesToHex(seedBytes);

  return { privateKey, privKeyHex, pubKeyHex, address };
}

export async function createBrainWallet(passphrase) {
  const hash = sha3_256(stringToBytes(passphrase));
  const seedHex = bytesToHex(hash);
  return await createWallet(seedHex);
}

export function computeTransactionIdBytes(transaction) {
  const buffers = [];
  buffers.push(new Uint8Array([0x02])); // transaction version

  const numParents = new Uint8Array(4);
  new DataView(numParents.buffer).setUint32(0, transaction.parents.length, false);
  buffers.push(numParents);
  for (const parent of transaction.parents) {
    buffers.push(hexToBytes(parent));
  }

  const numInputs = new Uint8Array(4);
  new DataView(numInputs.buffer).setUint32(0, transaction.inputs.length, false);
  buffers.push(numInputs);
  for (const input of transaction.inputs) {
    buffers.push(hexToBytes(input.txid));
    const indexBuf = new Uint8Array(4);
    new DataView(indexBuf.buffer).setUint32(0, input.index, false);
    buffers.push(indexBuf);
  }

  const numOutputs = new Uint8Array(4);
  new DataView(numOutputs.buffer).setUint32(0, transaction.outputs.length, false);
  buffers.push(numOutputs);
  for (const output of transaction.outputs) {
    const addressBytes = stringToBytes(output.address);
    const addressLenBuf = new Uint8Array(2);
    new DataView(addressLenBuf.buffer).setUint16(0, addressBytes.length, false);
    buffers.push(addressLenBuf);
    buffers.push(addressBytes);

    const valueBuf = new Uint8Array(8);
    new DataView(valueBuf.buffer).setBigUint64(0, BigInt(output.value), false);
    buffers.push(valueBuf);
  }

  const timestampBuf = new Uint8Array(8);
  new DataView(timestampBuf.buffer).setBigUint64(0, BigInt(transaction.timestamp), false);
  buffers.push(timestampBuf);

  const serializedData = concatBytes(...buffers);
  return sha3_256(serializedData);
}

export function calculateProofOfWorkHash(transaction) {
  const transactionIdBytes = computeTransactionIdBytes(transaction);

  let parentPowHash0 = new Uint8Array(32);
  let parentPowHash1 = new Uint8Array(32);

  if (transaction.parent_pow_hashes && transaction.parent_pow_hashes.length >= 1) {
    parentPowHash0 = hexToBytes(transaction.parent_pow_hashes[0]);
  }
  if (transaction.parent_pow_hashes && transaction.parent_pow_hashes.length >= 2) {
    parentPowHash1 = hexToBytes(transaction.parent_pow_hashes[1]);
  }

  const nonceBuf = new Uint8Array(8);
  new DataView(nonceBuf.buffer).setBigUint64(0, BigInt(transaction.pow_nonce), false);

  const dataToHash = concatBytes(transactionIdBytes, parentPowHash0, parentPowHash1, nonceBuf);
  return sha3_256(dataToHash);
}

export function countLeadingZeroBits(buffer) {
  let count = 0;
  for (const byte of buffer) {
    if (byte === 0) {
      count += 8;
      continue;
    }
    for (let bit = 7; bit >= 0; bit--) {
      if ((byte & (1 << bit)) !== 0) {
        return count;
      }
      count++;
    }
    break;
  }
  return count;
}

export async function mineProofOfWork(transaction, minimumBits) {
  for (let nonce = 0n; ; nonce++) {
    transaction.pow_nonce = Number(nonce);
    const hash = calculateProofOfWorkHash(transaction);
    const leadingBits = countLeadingZeroBits(hash);
    
    if (leadingBits >= minimumBits) {
      transaction.pow_bits = leadingBits;
      return;
    }
  }
}

export function generateSigningPayload(transaction, inputIndex, unspentOutput) {
  const transactionIdBytes = computeTransactionIdBytes(transaction);
  const addressBytes = stringToBytes(unspentOutput.address);
  const spentTransactionId = hexToBytes(unspentOutput.txid);

  const buffers = [];
  buffers.push(stringToBytes(SIGNING_DOMAIN));
  buffers.push(transactionIdBytes);

  const inputIndexBuf = new Uint8Array(8);
  new DataView(inputIndexBuf.buffer).setBigUint64(0, BigInt(inputIndex), false);
  buffers.push(inputIndexBuf);

  buffers.push(spentTransactionId);

  const utxoIndexBuf = new Uint8Array(8);
  new DataView(utxoIndexBuf.buffer).setBigUint64(0, BigInt(unspentOutput.index), false);
  buffers.push(utxoIndexBuf);

  const valueBuf = new Uint8Array(8);
  new DataView(valueBuf.buffer).setBigUint64(0, BigInt(unspentOutput.value), false);
  buffers.push(valueBuf);

  const addressLenBuf = new Uint8Array(2);
  new DataView(addressLenBuf.buffer).setUint16(0, addressBytes.length, false);
  buffers.push(addressLenBuf);

  buffers.push(addressBytes);

  return concatBytes(...buffers);
}

export async function signTransactionInput(privateKey, payloadToSign) {
  const signatureBytes = new Uint8Array(await mldsa.sign({ name: "ML-DSA-87" }, privateKey, payloadToSign));
  return bytesToHex(signatureBytes);
}
