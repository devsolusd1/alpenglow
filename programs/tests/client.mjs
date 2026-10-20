// Chamada client helpers for the tests (and anyone else): instruction builders, the record decoder,
// grid_hash, and error names. web3.js 1.x is loaded from the Infinite Monkey launch folder's node_modules
// (read only); SDK_MODULES=<path to a package.json> points elsewhere.
import { createRequire } from "node:module";
import crypto from "node:crypto";

const require = createRequire(process.env.SDK_MODULES ?? "/mnt/c/Users/John/RafinhaProject/infinite-monkey/launch/package.json");
export const web3 = require("@solana/web3.js");
const { PublicKey, SystemProgram, TransactionInstruction } = web3;

export const CERT = new PublicKey("42Ym56TQ7AKFThRv5nyoSABq5ZPgE2TLKo8BALZEtoU1");
export const ALPENGLOW_FEATURE = new PublicKey("A1pengvuM6JEcyNuTnMqepBKhwHE3N6PmUrdATGawhJS");
export const SLOT_HASHES = new PublicKey("SysvarS1otHashes111111111111111111111111111");
export const RECORD_LEN = 648;

export const ERR = {
  1: "ALREADY_INITIALIZED", 2: "WRONG_RECORD_ADDRESS", 3: "RANK_COUNT_TOO_LARGE", 4: "NOT_A_RECORD",
  5: "ALREADY_SEALED", 6: "WRONG_CERT_ADDRESS", 7: "CERT_WRONG_OWNER", 8: "CERT_NOT_WRITTEN",
  9: "CERT_INCONSISTENT", 10: "BITMAP_TOO_LONG", 11: "BITMAP_VERSION", 12: "RANK_COUNT_MISMATCH",
  13: "WRONG_SLOT_HASHES", 14: "WRONG_SYSTEM_PROGRAM", 15: "NOT_WRITABLE", 16: "WRONG_INIT_AUTHORITY",
  17: "MINT_MUST_SIGN",
};
export const CODE = Object.fromEntries(Object.entries(ERR).map(([k, v]) => [v, Number(k)]));

export const recordAddress = (programId, mint) =>
  PublicKey.findProgramAddressSync([Buffer.from("chamada"), new PublicKey(mint).toBuffer()], programId)[0];

/** sha256 over the ordered rank list, each entry 32-byte vote pubkey || 48-byte compressed BLS key, rank 0 first. */
export function gridHash(ranks) {
  const sorted = [...ranks].sort((a, b) => a.rank - b.rank);
  sorted.forEach((r, i) => { if (r.rank !== i) throw new Error(`rank ${i} missing`); });
  const h = crypto.createHash("sha256");
  for (const r of sorted) {
    const bls = Buffer.from(r.bls, "hex");
    if (bls.length !== 48) throw new Error(`rank ${r.rank}: BLS key is ${bls.length} bytes`);
    h.update(new PublicKey(r.vote).toBuffer());
    h.update(bls);
  }
  return h.digest();
}

/** init: data [0] || rank_count u16 LE || grid_hash [32]. The mint is a signer (its keypair signs the transaction);
 *  until the seal, init can be sent again to rewrite rank_count, grid_hash and authority. */
export function initIx({ programId, authority, mint, rankCount, gridHash: gh, record, systemProgram = SystemProgram.programId, mintSigns = true }) {
  const data = Buffer.alloc(35);
  data[0] = 0;
  data.writeUInt16LE(rankCount, 1);
  Buffer.from(gh).copy(data, 3);
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: record ?? recordAddress(programId, mint), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(mint), isSigner: mintSigns, isWritable: false },
      { pubkey: systemProgram, isSigner: false, isWritable: false },
    ],
    data,
  });
}

/** seal: data [1]. */
export function sealIx({ programId, sealer, record, cert = CERT, slotHashes = SLOT_HASHES, sealerSigns = true }) {
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: sealer, isSigner: sealerSigns, isWritable: false },
      { pubkey: record, isSigner: false, isWritable: true },
      { pubkey: cert, isSigner: false, isWritable: false },
      { pubkey: slotHashes, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([1]),
  });
}

export function decodeRecord(d) {
  d = Buffer.from(d);
  if (d.length !== RECORD_LEN) throw new Error(`record is ${d.length} bytes`);
  const bitmapLen = d.readUInt16LE(390);
  return {
    discriminator: d.subarray(0, 8).toString("latin1"),
    mint: new PublicKey(d.subarray(8, 40)).toBase58(),
    authority: new PublicKey(d.subarray(40, 72)).toBase58(),
    rankCount: d.readUInt16LE(72),
    gridHash: d.subarray(74, 106).toString("hex"),
    sealed: d[106],
    firstBlock: d[107],
    sealSlot: d.readBigUInt64LE(108),
    parentSlot: d.readBigUInt64LE(116),
    sealer: new PublicKey(d.subarray(124, 156)).toBase58(),
    signerCount: d.readUInt16LE(156),
    certSlot: d.readBigUInt64LE(158),
    blockId: d.subarray(166, 198),
    signature: d.subarray(198, 390),
    bitmapLen,
    bitmap: d.subarray(392, 392 + bitmapLen),
    padding: d.subarray(392 + Math.min(bitmapLen, 256), 648),
    /** the certificate account's bytes, rebuilt from the record's copy */
    certBytes() {
      const len = Buffer.alloc(8);
      len.writeBigUInt64LE(BigInt(bitmapLen));
      return Buffer.concat([d.subarray(158, 390), len, d.subarray(392, 392 + bitmapLen)]);
    },
  };
}

/** The certificate's fields straight from its account bytes (no checks). */
export function decodeCert(c) {
  c = Buffer.from(c);
  const bitmapLen = Number(c.readBigUInt64LE(232));
  const bitmap = c.subarray(240, 240 + bitmapLen);
  const bits = bitmap.readUInt16LE(1);
  let signers = 0;
  for (let i = 0; i < bits; i++) signers += (bitmap[3 + (i >> 3)] >> (i & 7)) & 1;
  return { slot: c.readBigUInt64LE(0), blockId: c.subarray(8, 40), signature: c.subarray(40, 232), bitmapLen, bitmap, bits, signers };
}

/** The custom error code in a failed send/simulate, or a builtin error's text. */
export function errorOf(e) {
  const text = [e?.message ?? String(e), ...(e?.logs ?? e?.transactionLogs ?? [])].join("\n");
  const m = text.match(/custom program error: 0x([0-9a-f]+)/i);
  if (m) return { code: parseInt(m[1], 16), name: ERR[parseInt(m[1], 16)] ?? "?", text };
  if (/missing required signature/i.test(text)) return { code: "MissingRequiredSignature", name: "MissingRequiredSignature", text };
  return { code: null, name: "other", text };
}
