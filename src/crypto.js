import { sha3_256 } from '@noble/hashes/sha3.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { encodeBech32m } from './bech32m.js';
import mldsa from 'mldsa-wasm';
import { hexToBytes, bytesToHex, stringToBytes, concatBytes } from './utils.js';
import { mnemonicToSeedSync, normalizeMnemonic } from './bip39.js';

const SIGNING_DOMAIN = "sikka:v2:txinput";
const ADDRESS_VERSION = 1;
const ADDRESS_HRP = "sikka";
const DEFAULT_MNEMONIC_INFO = "sikka:mldsa87:bip39:v1";
const DEFAULT_HD_INFO_PREFIX = "sikka:mldsa87:hd:v1";

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

  const privKeyHex = bytesToHex(seedBytes);

  return { privateKey, privKeyHex, pubKeyHex, address };
}

export async function createBrainWallet(passphrase) {
  const hash = sha3_256(stringToBytes(passphrase));
  const seedHex = bytesToHex(hash);
  return await createWallet(seedHex);
}

export function seedFromMnemonic(mnemonic, passphrase = "") {
  const bip39Seed = mnemonicToSeedSync(mnemonic, passphrase);
  const infoBytes = stringToBytes(DEFAULT_MNEMONIC_INFO);
  return hkdf(sha3_256, bip39Seed, undefined, infoBytes, 32);
}

export function derivePathSeed(masterSeed, account = 0, branch = 0, index = 0) {
  let masterSeedBytes;
  if (typeof masterSeed === 'string') {
    masterSeedBytes = hexToBytes(masterSeed.trim());
  } else if (masterSeed instanceof Uint8Array) {
    masterSeedBytes = masterSeed;
  } else {
    throw new Error('Master seed must be a hex string or Uint8Array');
  }

  if (masterSeedBytes.length !== 32) {
    throw new Error(`Master seed must be 32 bytes, got ${masterSeedBytes.length}`);
  }

  const prefixBytes = stringToBytes(DEFAULT_HD_INFO_PREFIX);
  const pathBuf = new Uint8Array(12);
  const view = new DataView(pathBuf.buffer);
  view.setUint32(0, account, false);
  view.setUint32(4, branch, false);
  view.setUint32(8, index, false);
  const infoBytes = concatBytes(prefixBytes, pathBuf);

  return hkdf(sha3_256, masterSeedBytes, undefined, infoBytes, 32);
}

export async function createWalletFromMnemonic(mnemonic, passphrase = "") {
  const seedBytes = seedFromMnemonic(mnemonic, passphrase);
  const masterSeedHex = bytesToHex(seedBytes);
  const wallet = await createWallet(masterSeedHex);
  return {
    ...wallet,
    masterSeedHex,
    mnemonic: normalizeMnemonic(mnemonic)
  };
}

export async function createWalletFromPath(masterSeed, account = 0, branch = 0, index = 0) {
  const childSeedBytes = derivePathSeed(masterSeed, account, branch, index);
  const childSeedHex = bytesToHex(childSeedBytes);
  const wallet = await createWallet(childSeedHex);
  return {
    ...wallet,
    pathSeedHex: childSeedHex
  };
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
