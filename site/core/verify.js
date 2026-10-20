// Chamada verifier: checks Alpenglow's genesis certificate against the rank list, in the visitor's
// browser or in Node (grid/lib.mjs re-exports everything here, so the site and the tools run the
// same code). ES module, no build step; @noble/curves 1.9.7 and @noble/hashes 1.8.0 vendored.
//
//   verifyGrid(certBytesOrJson, ranks[, { shredVersion }])
//     -> { verified, signed, signerCount, signedStakePct, message, reason, certSlot, blockId,
//          bitCount, rankCount, shredVersion, gridHash, gridHashOk, ms (total), timings: {aggregate,
//          signature, hashToCurve, pairings} }
//
// certBytesOrJson: raw account bytes, base64/hex text, JSON text or object (getAccountInfo,
//   getAgGenesisCert, the /api/cert answer, grid.json's certBase64), or a sealed 648-byte record.
// ranks: ranks.json (or its ranks array), rank 0 first; each entry needs vote, stake and bls (hex).
//
// The check: e(sum of the signers' BLS keys, H(m)) == e(g1, sigma), m = 0x06 | cert slot u64 LE |
// block_id | shred version u16 LE (43 bytes), H = hash to G2 with DST ..._POP_. "message" in the
// result is m in hex; "reason" is null when verified, else says in words why not.
//
// Rank map (agave v4.3.2 clone_and_filter_for_vat + BLSPubkeyToRankMap): BLS key present, stake > 0,
// lamports >= rent-exempt minimum for 3,762 bytes; top 2000 by stake (ties at the cutoff dropped);
// key decompresses; key and node unique; stake descending, ties by compressed key ascending.
import { bls12_381 as bls } from "../vendor/noble-curves/bls12-381.js";
import { sha256 } from "../vendor/noble-hashes/sha2.js";
import {
  CERT_ACCOUNT, ALPENGLOW_FEATURE, toCertBytes, parseCert, genesisMessage, rankList, stakeOf,
  hexToBytes, bytesToHex, b58encode, pubkeyBytes, buildCertBytes,
} from "./cert.js";

export * from "./cert.js";

export const FEATURE_ID = ALPENGLOW_FEATURE;
export const DST = "BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_POP_";
export const SHRED_VERSION = { "mainnet-beta": 50093, mainnet: 50093, devnet: 7016 };
export const VOTE_STATE_V4_TAG = 3;
export const VOTE_V4_SIZE = 3762;
export const MAX_ALPENGLOW_VOTE_ACCOUNTS = 2000;

const G1 = bls.G1.Point || bls.G1.ProjectivePoint;
const G2 = bls.G2.Point || bls.G2.ProjectivePoint;
export { bls, G1, G2 };

const keyCache = new Map();
export function g1Key(hex) {
  let p = keyCache.get(hex);
  if (!p) { p = G1.fromHex(hexToBytes(hex)); p.assertValidity(); keyCache.set(hex, p); }
  return p;
}

const big = (v) => (typeof v === "bigint" ? v : typeof v === "number" ? BigInt(Math.round(v)) : BigInt(String(v)));
// share in percent with 4 decimals, from integer lamports
export const pct = (part, total) => { const t = big(total); return t > 0n ? Number((big(part) * 1000000n) / t) / 10000 : 0; };

const cmpBytes = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; };

export function buildRankMap(accounts, { minBalance = 0 } = {}) {
  let entries = accounts.filter((a) => a.bls && big(a.stake) > 0n && Number(a.lamports) >= minBalance);
  const afterBasic = entries.length;
  if (entries.length > MAX_ALPENGLOW_VOTE_ACCOUNTS) {
    const sorted = [...entries].sort((a, b) => { const x = big(a.stake), y = big(b.stake); return y > x ? 1 : y < x ? -1 : 0; });
    const floor = big(sorted[MAX_ALPENGLOW_VOTE_ACCOUNTS].stake);
    entries = entries.filter((a) => big(a.stake) > floor);
  }
  const afterTop = entries.length;
  const cands = [];
  for (const a of entries) {
    let key;
    try { key = hexToBytes(a.bls); g1Key(a.bls); } catch { continue; }
    cands.push({ ...a, key });
  }
  const kc = {}, nc = {};
  for (const c of cands) { kc[c.bls] = (kc[c.bls] || 0) + 1; nc[c.node] = (nc[c.node] || 0) + 1; }
  const ranked = cands.filter((c) => kc[c.bls] === 1 && nc[c.node] === 1);
  ranked.sort((a, b) => { const x = big(a.stake), y = big(b.stake); return x !== y ? (y > x ? 1 : -1) : cmpBytes(a.key, b.key); });
  for (const r of ranked) delete r.key;
  const total = ranked.reduce((s, r) => s + big(r.stake), 0n);
  return { ranked, total, excluded: {
    noKeyZeroStakeOrLowBalance: accounts.length - afterBasic, beyondTop2000: afterBasic - afterTop,
    keyDoesNotDecompress: afterTop - cands.length, duplicateKeyOrNode: cands.length - ranked.length } };
}

// sha256 over the ordered rank list: 32-byte vote pubkey || 48-byte compressed BLS key, rank 0 first.
export function gridHash(ranks) {
  const h = sha256.create();
  for (const r of rankList(ranks)) { h.update(pubkeyBytes(r.vote)); h.update(hexToBytes(r.bls)); }
  return bytesToHex(h.digest());
}

// getAgGenesisCert answer {block:{slot, blockId}, signature:{signature, bitmap}} -> account-layout bytes
export function certJsonToBytes(j) {
  const v = j && j.result !== undefined ? j.result : j;
  if (!v || !v.block || !v.signature) throw new Error("not a getAgGenesisCert answer");
  return buildCertBytes(v.block.slot, Uint8Array.from(v.block.blockId), Uint8Array.from(v.signature.signature), Uint8Array.from(v.signature.bitmap));
}

const now = () => (globalThis.performance ? performance.now() : Date.now());

export async function verifyGrid(certBytesOrJson, ranks, opts = {}) {
  const t0 = now();
  const ms = { aggregate: null, signature: null, hashToCurve: null, pairings: null };
  const list = rankList(ranks);
  const doc = Array.isArray(ranks) ? {} : ranks || {};
  const shredVersion = opts.shredVersion ?? doc.shredVersion ?? SHRED_VERSION[doc.network] ?? null;
  const cert = parseCert(toCertBytes(certBytesOrJson));
  const message = genesisMessage(cert.slot, cert.blockId, shredVersion ?? 0);
  const out = {
    verified: false,
    signed: cert.bits.slice(),
    signerCount: cert.bits.filter(Boolean).length,
    signedStakePct: 0,
    message: bytesToHex(message),
    reason: null,
    certSlot: cert.slot.toString(),
    blockId: b58encode(cert.blockId),
    bitCount: cert.nbits,
    rankCount: list.length,
    shredVersion,
    dst: DST,
    gridHash: null,
    gridHashOk: null,
    ms: 0,
    timings: ms,
  };
  try { out.gridHash = gridHash(list); out.gridHashOk = doc.gridHash ? String(doc.gridHash).toLowerCase() === out.gridHash : null; } catch { /* left out */ }
  const total = list.reduce((s, r) => s + stakeOf(r), 0n);
  let signedStake = 0n;
  for (let i = 0; i < Math.min(list.length, cert.nbits); i++) if (cert.bits[i]) signedStake += stakeOf(list[i]);
  out.signedStakePct = pct(signedStake, total);

  const done = (reason) => { out.reason = reason; out.ms = Math.round(now() - t0); return out; };
  if (shredVersion == null) return done("no shred version for this network");
  if (cert.nbits !== list.length) return done(`the certificate has ${cert.nbits} ranks, the list has ${list.length}`);
  if (out.signerCount === 0) return done("nobody signed");

  let t = now(), agg = G1.ZERO;
  try {
    for (let i = 0; i < list.length; i++) if (cert.bits[i]) agg = agg.add(g1Key(list[i].bls));
  } catch (e) { return done("a BLS key in the list does not decode: " + e.message); }
  ms.aggregate = now() - t;
  t = now();
  let sig;
  try { sig = G2.fromHex(cert.signature); sig.assertValidity(); } catch { return done("the signature is not a valid G2 point"); }
  ms.signature = now() - t;
  await new Promise((r) => setTimeout(r, 0)); // lets a progress line paint before the heavy part
  t = now();
  let Hm = bls.G2.hashToCurve(message, { DST });
  if (G2.fromAffine && !(Hm instanceof G2)) Hm = G2.fromAffine(Hm.toAffine());
  ms.hashToCurve = now() - t;
  t = now();
  const e = bls.pairingBatch([{ g1: agg.negate(), g2: Hm }, { g1: G1.BASE, g2: sig }]);
  out.verified = bls.fields.Fp12.eql(e, bls.fields.Fp12.ONE);
  ms.pairings = now() - t;
  return done(out.verified ? null : "the pairing does not hold for this list and message");
}
