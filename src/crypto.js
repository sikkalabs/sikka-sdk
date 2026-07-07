import { sha3_256 } from '@noble/hashes/sha3';
import { encodeBech32m } from './bech32m.js';
import mldsa from 'mldsa-wasm';
import { hexToBytes, bytesToHex, stringToBytes, concatBytes } from './utils.js';

const SIGNING_DOMAIN = "sikka:v2:txinput";
const ADDRESS_VERSION = 1;
const ADDRESS_HRP = "sikka";

export async function createWallet(seedHex) {
  let raw;
  if (seedHex) {
    raw = hexToBytes(seedHex.trim());
    if (raw.length !== 32) {
      throw new Error(`Expected 32-byte seed (64 hex chars), got ${raw.length} bytes`);
    }
  } else {
    raw = new Uint8Array(32);
    crypto.getRandomValues(raw);
  }

  const privateKey = await mldsa.importKey(
    "raw-seed",
    raw,
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
  // We'll just return the seed as privkey hex since that's enough to recreate it.
  const privKeyHex = bytesToHex(raw);

  return { privateKey, privKeyHex, pubKeyHex, address };
}

export function computeTxIDRaw(tx) {
  const bufs = [];
  bufs.push(new Uint8Array([0x02])); // tx version

  const numParents = new Uint8Array(4);
  new DataView(numParents.buffer).setUint32(0, tx.parents.length, false);
  bufs.push(numParents);
  for (const p of tx.parents) {
    bufs.push(hexToBytes(p));
  }

  const numInputs = new Uint8Array(4);
  new DataView(numInputs.buffer).setUint32(0, tx.inputs.length, false);
  bufs.push(numInputs);
  for (const input of tx.inputs) {
    bufs.push(hexToBytes(input.txid));
    const idxBuf = new Uint8Array(4);
    new DataView(idxBuf.buffer).setUint32(0, input.index, false);
    bufs.push(idxBuf);
  }

  const numOutputs = new Uint8Array(4);
  new DataView(numOutputs.buffer).setUint32(0, tx.outputs.length, false);
  bufs.push(numOutputs);
  for (const output of tx.outputs) {
    const addrBuf = stringToBytes(output.address);
    const addrLenBuf = new Uint8Array(2);
    new DataView(addrLenBuf.buffer).setUint16(0, addrBuf.length, false);
    bufs.push(addrLenBuf);
    bufs.push(addrBuf);

    const valBuf = new Uint8Array(8);
    new DataView(valBuf.buffer).setBigUint64(0, BigInt(output.value), false);
    bufs.push(valBuf);
  }

  const tsBuf = new Uint8Array(8);
  new DataView(tsBuf.buffer).setBigUint64(0, BigInt(tx.timestamp), false);
  bufs.push(tsBuf);

  const serialized = concatBytes(...bufs);
  return sha3_256(serialized);
}

export function txPowHash(tx) {
  const txIDBytes = computeTxIDRaw(tx);

  let p0 = new Uint8Array(32);
  let p1 = new Uint8Array(32);

  if (tx.parent_pow_hashes && tx.parent_pow_hashes.length >= 1) {
    p0 = hexToBytes(tx.parent_pow_hashes[0]);
  }
  if (tx.parent_pow_hashes && tx.parent_pow_hashes.length >= 2) {
    p1 = hexToBytes(tx.parent_pow_hashes[1]);
  }

  const nonceBuf = new Uint8Array(8);
  new DataView(nonceBuf.buffer).setBigUint64(0, BigInt(tx.pow_nonce), false);

  const buf = concatBytes(txIDBytes, p0, p1, nonceBuf);
  return sha3_256(buf);
}

export function leadingZeroBits(buf) {
  let count = 0;
  for (const byte of buf) {
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

export async function minePoW(tx, minBits) {
  for (let nonce = 0n; ; nonce++) {
    tx.pow_nonce = Number(nonce);
    const hash = txPowHash(tx);
    const bits = leadingZeroBits(hash);
    if (bits >= minBits) {
      tx.pow_bits = bits;
      return;
    }
  }
}

export function signingPayload(tx, inputIndex, utxo) {
  const txID = computeTxIDRaw(tx);
  const addrBytes = stringToBytes(utxo.address);
  const spentTxID = hexToBytes(utxo.txid);

  const bufs = [];
  bufs.push(stringToBytes(SIGNING_DOMAIN));
  bufs.push(txID);

  const inIdxBuf = new Uint8Array(8);
  new DataView(inIdxBuf.buffer).setBigUint64(0, BigInt(inputIndex), false);
  bufs.push(inIdxBuf);

  bufs.push(spentTxID);

  const utxoIdxBuf = new Uint8Array(8);
  new DataView(utxoIdxBuf.buffer).setBigUint64(0, BigInt(utxo.index), false);
  bufs.push(utxoIdxBuf);

  const valBuf = new Uint8Array(8);
  new DataView(valBuf.buffer).setBigUint64(0, BigInt(utxo.value), false);
  bufs.push(valBuf);

  const addrLenBuf = new Uint8Array(2);
  new DataView(addrLenBuf.buffer).setUint16(0, addrBytes.length, false);
  bufs.push(addrLenBuf);

  bufs.push(addrBytes);

  return concatBytes(...bufs);
}

export async function signInput(privateKey, payload) {
  const signatureBytes = new Uint8Array(await mldsa.sign({ name: "ML-DSA-87" }, privateKey, payload));
  return bytesToHex(signatureBytes);
}
