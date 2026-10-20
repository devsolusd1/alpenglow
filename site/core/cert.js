// Reading the Alpenglow genesis certificate and the Chamada record, without dependencies.
// Used by the page, by core/verify.js and by api/cert.js (Node 18+ has atob, btoa and TextEncoder).
//
// Certificate account (agave v4.3.2), written once by the runtime at the switch:
//   u64 LE cert slot | 32-byte block_id | 192-byte BLS aggregate signature (uncompressed G2)
//   | u64 LE bitmap length | bitmap
// Bitmap (solana-signer-store): version byte 0 (Base2) | u16 LE bit count | raw bits, Lsb0.
//
// Record account (Chamada program, PDA ["chamada", mint]), 648 bytes:
//   [0..8] "CHAMADA1" | [8..40] mint | [40..72] authority | [72..74] rank_count u16
//   | [74..106] grid_hash | [106] sealed | [107] first_block | [108..116] seal_slot u64
//   | [116..124] parent_slot u64 | [124..156] sealer | [156..158] signer_count u16
//   | [158..166] cert_slot u64 | [166..198] block_id | [198..390] signature
//   | [390..392] bitmap_len u16 | [392..648] bitmap

export const CERT_ACCOUNT = "42Ym56TQ7AKFThRv5nyoSABq5ZPgE2TLKo8BALZEtoU1";
export const ALPENGLOW_FEATURE = "A1pengvuM6JEcyNuTnMqepBKhwHE3N6PmUrdATGawhJS";
export const FEATURE_PROGRAM = "Feature111111111111111111111111111111111111";
export const SYSTEM_PROGRAM = "11111111111111111111111111111111";
export const MIGRATION_OFFSET = 5000;
export const RECORD_SIZE = 648;
export const CERT_HEADER = 8 + 32 + 192 + 8;

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function b58encode(bytes) {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let s = "";
  while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; }
  for (const b of bytes) { if (b === 0) s = "1" + s; else break; }
  return s;
}

export function b58decode(str) {
  let n = 0n;
  for (const c of str) {
    const i = B58.indexOf(c);
    if (i < 0) throw new Error("not base58");
    n = n * 58n + BigInt(i);
  }
  const out = [];
  while (n > 0n) { out.unshift(Number(n & 255n)); n >>= 8n; }
  for (const c of str) { if (c === "1") out.unshift(0); else break; }
  return Uint8Array.from(out);
}

export function pubkeyBytes(str) {
  const b = b58decode(str);
  if (b.length !== 32) throw new Error("not a 32-byte address: " + str);
  return b;
}

export const isAddress = (s) => typeof s === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s) && (() => { try { return pubkeyBytes(s).length === 32; } catch { return false; } })();

export function hexToBytes(h) {
  const s = h.startsWith("0x") ? h.slice(2) : h;
  if (s.length % 2 || /[^0-9a-fA-F]/.test(s)) throw new Error("not hex");
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export const bytesToHex = (u) => Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");

export function base64ToBytes(s) {
  const bin = atob(s.replace(/\s+/g, ""));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToBase64(u) {
  let bin = "";
  for (let i = 0; i < u.length; i += 0x8000) bin += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function u64le(u, o) {
  let n = 0n;
  for (let i = 7; i >= 0; i--) n = (n << 8n) | BigInt(u[o + i]);
  return n;
}
const u16le = (u, o) => u[o] | (u[o + 1] << 8);

function writeU64(out, o, v) {
  let n = BigInt(v);
  for (let i = 0; i < 8; i++) { out[o + i] = Number(n & 255n); n >>= 8n; }
}

// The 43-byte message every validator signed: 0x06 | slot u64 LE | block_id | shred_version u16 LE.
export function genesisMessage(slot, blockId, shredVersion) {
  const m = new Uint8Array(43);
  m[0] = 6;
  writeU64(m, 1, slot);
  m.set(blockId, 9);
  m[41] = shredVersion & 0xff;
  m[42] = (shredVersion >> 8) & 0xff;
  return m;
}

export function decodeBitmap(bm) {
  if (bm.length < 3) throw new Error("bitmap too short");
  if (bm[0] !== 0) throw new Error("bitmap version " + bm[0] + " is not Base2");
  const nbits = u16le(bm, 1);
  const raw = bm.subarray(3);
  if (raw.length !== Math.ceil(nbits / 8)) throw new Error("bitmap length does not match its bit count");
  const bits = new Array(nbits);
  for (let i = 0; i < nbits; i++) bits[i] = ((raw[i >> 3] >> (i & 7)) & 1) === 1;
  return { version: 0, nbits, bits };
}

export function parseCert(data) {
  if (!data || data.length < CERT_HEADER + 3) throw new Error("certificate too short (" + (data ? data.length : 0) + " bytes)");
  const slot = u64le(data, 0);
  const blockId = data.slice(8, 40);
  const signature = data.slice(40, 232);
  const bmLen = Number(u64le(data, 232));
  // The runtime writes the account exactly; the program also accepts trailing bytes, so do we.
  if (CERT_HEADER + bmLen > data.length) throw new Error("certificate is shorter than its bitmap length says");
  const bitmap = data.slice(CERT_HEADER, CERT_HEADER + bmLen);
  return { slot, blockId, signature, bitmap, ...decodeBitmap(bitmap) };
}

export function buildCertBytes(slot, blockId, signature, bitmap) {
  const out = new Uint8Array(CERT_HEADER + bitmap.length);
  writeU64(out, 0, slot);
  out.set(blockId, 8);
  out.set(signature, 40);
  writeU64(out, 232, bitmap.length);
  out.set(bitmap, CERT_HEADER);
  return out;
}

export function parseRecord(d) {
  if (!d || d.length < RECORD_SIZE) throw new Error("record too short");
  const tag = String.fromCharCode(...d.subarray(0, 8));
  if (tag !== "CHAMADA1") throw new Error("not a Chamada record");
  const bitmapLen = u16le(d, 390);
  const rec = {
    mint: b58encode(d.subarray(8, 40)),
    authority: b58encode(d.subarray(40, 72)),
    rankCount: u16le(d, 72),
    gridHash: bytesToHex(d.subarray(74, 106)),
    sealed: d[106] === 1,
    firstBlock: d[107] === 1,
    sealSlot: Number(u64le(d, 108)),
    parentSlot: Number(u64le(d, 116)),
    sealer: b58encode(d.subarray(124, 156)),
    signerCount: u16le(d, 156),
    certSlot: Number(u64le(d, 158)),
    blockId: b58encode(d.subarray(166, 198)),
    bitmapLen,
  };
  if (rec.sealed && bitmapLen > 0 && bitmapLen <= 256) {
    rec.certBytes = buildCertBytes(u64le(d, 158), d.slice(166, 198), d.slice(198, 390), d.slice(392, 392 + bitmapLen));
  }
  return rec;
}

const isByteArray = (a) => Array.isArray(a) && a.every((x) => Number.isInteger(x) && x >= 0 && x < 256);

// Accepts what the site meets: raw bytes, base64 or hex text, a getAccountInfo answer, a
// getAgGenesisCert answer, the /api/cert answer, or a sealed Chamada record. Returns certificate bytes.
export function toCertBytes(input) {
  if (input == null) throw new Error("no certificate");
  if (input instanceof Uint8Array) return fromRaw(input);
  if (input instanceof ArrayBuffer) return fromRaw(new Uint8Array(input));
  if (isByteArray(input)) return fromRaw(Uint8Array.from(input));
  if (typeof input === "string") {
    const s = input.trim();
    if (s.startsWith("{") || s === "null") return toCertBytes(JSON.parse(s));
    if (/^(0x)?[0-9a-fA-F]+$/.test(s) && s.length % 2 === 0 && s.length >= 2 * (CERT_HEADER + 3)) return fromRaw(hexToBytes(s));
    return fromRaw(base64ToBytes(s));
  }
  if (typeof input === "object") {
    if ("result" in input && input.result !== undefined) return toCertBytes(input.result);
    if (input.value !== undefined) return toCertBytes(input.value);
    if (input.cert) return toCertBytes(input.cert);
    if (Array.isArray(input.data) && typeof input.data[0] === "string") return toCertBytes(input.data[0]);
    for (const k of ["bytes", "data", "account", "base64"]) if (typeof input[k] === "string" && input[k]) return toCertBytes(input[k]);
    if (input.block && input.signature) { // getAgGenesisCert
      const blockId = toBytes(input.block.blockId ?? input.block.block_id);
      const sig = toBytes(input.signature.signature);
      const bitmap = toBytes(input.signature.bitmap);
      return buildCertBytes(input.block.slot, blockId, sig, bitmap);
    }
  }
  throw new Error("unrecognised certificate input");
}

function toBytes(v) {
  if (v instanceof Uint8Array) return v;
  if (Array.isArray(v)) return Uint8Array.from(v);
  if (typeof v === "string") return /^[0-9a-fA-F]+$/.test(v) && v.length % 2 === 0 ? hexToBytes(v) : b58decode(v);
  throw new Error("unrecognised byte field");
}

function fromRaw(u) {
  if (u.length >= RECORD_SIZE && String.fromCharCode(...u.subarray(0, 8)) === "CHAMADA1") {
    const rec = parseRecord(u);
    if (!rec.certBytes) throw new Error("the record is not sealed yet");
    return rec.certBytes;
  }
  return u;
}

// Ordered rank list from ranks.json (the object or its array).
export function rankList(ranks) {
  const list = Array.isArray(ranks) ? ranks : ranks && Array.isArray(ranks.ranks) ? ranks.ranks : null;
  if (!list) throw new Error("no rank list");
  return [...list].sort((a, b) => a.rank - b.rank);
}

export function stakeOf(r) {
  const s = r.stake;
  if (typeof s === "bigint") return s;
  if (typeof s === "number") return BigInt(Math.round(s));
  if (typeof s === "string" && /^\d+$/.test(s)) return BigInt(s);
  return 0n;
}
