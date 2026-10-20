// lib.mjs - Chamada grid tools, Node side.
// The certificate parsing, bitmap, message, grid hash and verifyGrid come from the site's own
// modules (../site/core/cert.js and ../site/core/verify.js), so the page and these tools run the
// very same code. This file adds the rank-map rules, a plain two-pairing check, and read-only RPC
// helpers. Nothing here signs or sends a transaction.
export * from '../site/core/cert.js';
export { verifyGrid, gridHash, DST, SHRED_VERSION } from '../site/core/verify.js';
import { bls12_381 as bls } from '../site/vendor/noble-curves/bls12-381.js';
import { CERT_ACCOUNT, ALPENGLOW_FEATURE, FEATURE_PROGRAM, SYSTEM_PROGRAM, b58encode, bytesToHex, hexToBytes, toCertBytes } from '../site/core/cert.js';
import { gridHash, DST } from '../site/core/verify.js';
export { bls };
export const G1P = bls.G1.Point || bls.G1.ProjectivePoint;
export const G2P = bls.G2.Point || bls.G2.ProjectivePoint;
export const VOTE_STATE_V4_TAG = 3;
export const VOTE_V4_SIZE = 3762;      // rent-exempt minimum is taken for this size while Alpenglow is inactive
export const MAX_VAT_ACCOUNTS = 2000;  // top 2000 by stake, ties at the cutoff dropped

export const GENESIS_HASHES = {
  '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d': 'mainnet-beta',
  'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG': 'devnet',
  '4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY': 'testnet',
};
export const CONFIG_PROGRAM = 'Config1111111111111111111111111111111111111';
export const VALIDATOR_INFO_KEY = 'Va1idator1nfo111111111111111111111111111111';
const V4_BLS_FLAG_OFFSET = 144; // 4 tag + 4*32 pubkeys + 2+2 bps + 8 pending rewards

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const pct = (part, total) => (BigInt(total) > 0n ? Number((BigInt(part) * 1000000n) / BigInt(total)) / 10000 : 0);
const cmpBytes = (a, b) => { for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i]; return a.length - b.length; };

// ---------- rank map ----------
const pointCache = new Map();
export function decodePubkey(blsHex) {
  let p = pointCache.get(blsHex);
  if (!p) { p = G1P.fromHex(hexToBytes(blsHex)); p.assertValidity(); pointCache.set(blsHex, p); }
  return p;
}

// agave v4.3.2: VoteAccounts::clone_and_filter_for_vat (BLS key present, stake > 0,
// lamports >= rent-exempt minimum for 3,762 bytes, top 2000 by stake with ties at the
// cutoff dropped), then BLSPubkeyToRankMap::new (key decompresses; key and node pubkey
// unique, every duplicate dropped), ranked by stake descending, ties by compressed key ascending.
// accounts: [{vote, node, stake (string|bigint), lamports, bls (hex|null)}]
export function buildRankMap(accounts, { minBalance = 0 } = {}) {
  const stakeOf = (a) => BigInt(a.stake);
  let entries = accounts.filter((a) => a.bls && stakeOf(a) > 0n && Number(a.lamports) >= minBalance);
  let cutoff = 0;
  if (entries.length > MAX_VAT_ACCOUNTS) {
    const sorted = [...entries].sort((a, b) => (stakeOf(b) > stakeOf(a) ? 1 : stakeOf(b) < stakeOf(a) ? -1 : 0));
    const floor = stakeOf(sorted[MAX_VAT_ACCOUNTS]);
    const before = entries.length;
    entries = entries.filter((a) => stakeOf(a) > floor);
    cutoff = before - entries.length;
  }
  const cands = [];
  for (const a of entries) {
    try { decodePubkey(a.bls); cands.push({ ...a, key: hexToBytes(a.bls) }); } catch { /* does not decompress */ }
  }
  const kc = new Map(), nc = new Map();
  for (const c of cands) { kc.set(c.bls, (kc.get(c.bls) || 0) + 1); nc.set(c.node, (nc.get(c.node) || 0) + 1); }
  const ranked = cands.filter((c) => kc.get(c.bls) === 1 && nc.get(c.node) === 1);
  ranked.sort((a, b) => {
    const sa = stakeOf(a), sb = stakeOf(b);
    if (sa !== sb) return sb > sa ? 1 : -1;
    return cmpBytes(a.key, b.key);
  });
  const total = ranked.reduce((s, r) => s + stakeOf(r), 0n);
  return {
    ranked: ranked.map(({ key, ...r }) => r), total,
    excluded: {
      noKeyZeroStakeOrLowBalance: accounts.length - entries.length - cutoff, beyondTop2000: cutoff,
      keyDoesNotDecompress: entries.length - cands.length, duplicateKeyOrNode: cands.length - ranked.length,
    },
  };
}

// ---------- pairing (plain form: two separate pairings) ----------
export function hashMessage(msg) {
  let h = bls.G2.hashToCurve(msg, { DST });
  if (G2P.fromAffine && !(h instanceof G2P)) h = G2P.fromAffine(h.toAffine());
  return h;
}
// e(aggregate pubkey, H(m)) == e(g1, sigma)
export function pairingCheck(aggPk, msg, sigPoint) {
  return bls.fields.Fp12.eql(bls.pairing(aggPk, hashMessage(msg)), bls.pairing(G1P.BASE, sigPoint));
}

// ---------- RPC ----------
let rpcId = 0;
export function makeRpc(url, { quietErrors = false } = {}) {
  return async function rpc(method, params = [], { retries = 5, allowError = false } = {}) {
    for (let attempt = 0; ; attempt++) {
      try {
        const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }) });
        if ((r.status === 429 || r.status >= 500) && attempt < retries) { await sleep(1200 * (attempt + 1)); continue; }
        const j = await r.json();
        if (j.error) {
          if (allowError) return { error: j.error };
          throw Object.assign(new Error(`${method}: ${JSON.stringify(j.error)}`), { rpcError: j.error, noRetry: true });
        }
        return j.result;
      } catch (e) {
        if (e.noRetry || attempt >= retries) throw e;
        if (!quietErrors) console.error(`  ${method} retry ${attempt + 1}: ${e.message}`);
        await sleep(1000 * (attempt + 1));
      }
    }
  };
}

export async function detectNetwork(rpc) {
  const gh = await rpc('getGenesisHash');
  return GENESIS_HASHES[gh] || `unknown:${gh}`;
}

// ---------- rank-map inputs ----------
export async function fetchInputs(rpc) {
  const [va, nodes, minBal, epochInfo] = await Promise.all([
    rpc('getVoteAccounts', [{ commitment: 'confirmed', keepUnstakedDelinquents: false }]),
    rpc('getClusterNodes'),
    rpc('getMinimumBalanceForRentExemption', [VOTE_V4_SIZE]),
    rpc('getEpochInfo', [{ commitment: 'confirmed' }]),
  ]);
  const all = [...va.current.map((v) => ({ ...v, delinquent: false })), ...va.delinquent.map((v) => ({ ...v, delinquent: true }))];
  const accounts = [];
  let minContextSlot = 0;
  for (let i = 0; i < all.length; i += 100) {
    const chunk = all.slice(i, i + 100);
    const res = await rpc('getMultipleAccounts', [chunk.map((v) => v.votePubkey),
      { encoding: 'base64', commitment: 'confirmed', dataSlice: { offset: 0, length: 193 } }]);
    minContextSlot = Math.max(minContextSlot, res.context.slot);
    res.value.forEach((acc, j) => {
      const v = chunk[j];
      const d = acc ? Buffer.from(acc.data[0], 'base64') : Buffer.alloc(0);
      const tag = d.length >= 4 ? d.readUInt32LE(0) : -1;
      let bls = null, node = v.nodePubkey;
      if (tag === VOTE_STATE_V4_TAG && d.length >= 193) {
        node = b58encode(d.subarray(4, 36));
        if (d[V4_BLS_FLAG_OFFSET] === 1) bls = bytesToHex(d.subarray(145, 193));
      }
      accounts.push({ vote: v.votePubkey, node, stake: String(v.activatedStake), lamports: acc ? acc.lamports : 0,
        versionTag: tag, bls, delinquent: v.delinquent });
    });
  }
  const sv = {};
  for (const n of nodes) if (n.shredVersion != null) sv[n.shredVersion] = (sv[n.shredVersion] || 0) + 1;
  const shredVersions = Object.entries(sv).sort((a, b) => b[1] - a[1]).map(([k, c]) => ({ shredVersion: +k, nodes: c }));
  return { takenAt: new Date().toISOString(), epoch: epochInfo.epoch, slot: epochInfo.absoluteSlot,
    accountsReadAtSlot: minContextSlot, minVoteBalance: minBal, shredVersions, accounts };
}

// ---------- validator-info (Config program), self-declared and untrusted ----------
const cleanText = (s, max) => (typeof s === 'string'
  ? s.normalize('NFC').replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, '').trim().slice(0, max) || null
  : null);
const cleanUrl = (s) => {
  if (typeof s !== 'string' || s.length > 400) return null;
  try { const u = new URL(s.trim()); return u.protocol === 'https:' ? u.href : null; } catch { return null; }
};
export async function fetchValidatorInfo(rpc) {
  const res = await rpc('getProgramAccounts', [CONFIG_PROGRAM, { encoding: 'base64',
    filters: [{ memcmp: { offset: 1, bytes: VALIDATOR_INFO_KEY } }] }]);
  const byIdentity = {};
  for (const { account } of res) {
    const d = Buffer.from(account.data[0], 'base64');
    try {
      if (d[0] !== 2 || d[66] !== 1) continue; // two config keys; the identity key must have signed
      const identity = b58encode(d.subarray(34, 66));
      const len = Number(d.readBigUInt64LE(67));
      const info = JSON.parse(d.subarray(75, 75 + len).toString('utf8'));
      byIdentity[identity] = { name: cleanText(info.name, 64), icon: cleanUrl(info.iconUrl), website: cleanUrl(info.website) };
    } catch { /* malformed entry */ }
  }
  return byIdentity;
}

// ---------- ranks.json ----------
export function buildRanksFile(inputs, { network, names = null, exclude = [], note = null, extra = {} } = {}) {
  const ex = new Set(exclude);
  const accounts = inputs.accounts.filter((a) => !ex.has(a.vote));
  const rm = buildRankMap(accounts, { minBalance: inputs.minVoteBalance });
  const ranks = rm.ranked.map((r, i) => ({
    rank: i, vote: r.vote, node: r.node, stake: String(r.stake), stakePct: pct(r.stake, rm.total), bls: r.bls,
    name: names?.[r.node]?.name ?? null, icon: names?.[r.node]?.icon ?? null,
  }));
  const file = {
    network, epoch: inputs.epoch, rankCount: ranks.length, gridHash: gridHash(ranks),
    shredVersion: inputs.shredVersions[0]?.shredVersion ?? null, takenAtSlot: inputs.slot,
    ...(note ? { note } : {}),
    ...extra,
    takenAt: inputs.takenAt, accountsReadAtSlot: inputs.accountsReadAtSlot, minVoteBalance: inputs.minVoteBalance,
    totalStake: rm.total.toString(), excluded: rm.excluded, excludedByHand: [...ex],
    namesIncluded: !!names, rules: 'agave v4.3.2 clone_and_filter_for_vat + BLSPubkeyToRankMap; stake = getVoteAccounts activatedStake; gridHash = sha256(vote32 || bls48 for rank 0..n-1)',
    ranks,
  };
  return file;
}

// init instruction data for the program: [0] || rank_count u16 LE || grid_hash [32]
export function initData(ranksFile) {
  const b = Buffer.alloc(35);
  b[0] = 0; b.writeUInt16LE(ranksFile.rankCount, 1);
  Buffer.from(ranksFile.gridHash, 'hex').copy(b, 3);
  return b.toString('hex');
}

// ---------- certificate sources ----------
// account at the given commitment: data bytes, or null while it has none (it is prefunded on mainnet)
export async function readCertAccount(rpc, commitment = 'processed') {
  const a = await rpc('getAccountInfo', [CERT_ACCOUNT, { encoding: 'base64', commitment }]);
  const v = a?.value;
  if (!v) return { bytes: null, slot: a?.context?.slot, state: 'missing' };
  const bytes = Uint8Array.from(Buffer.from(v.data[0], 'base64'));
  if (!bytes.length) return { bytes: null, slot: a.context.slot, state: `exists, no data (${v.lamports} lamports)` };
  if (v.owner !== SYSTEM_PROGRAM) return { bytes: null, slot: a.context.slot, state: `unexpected owner ${v.owner}` };
  return { bytes, slot: a.context.slot, state: 'data' };
}
// getAgGenesisCert (finalized bank, lags): bytes or null; unsupported:true if the node lacks the method
export async function readCertRpc(rpc) {
  const r = await rpc('getAgGenesisCert', [], { allowError: true, retries: 2 });
  if (r && r.error) return { bytes: null, unsupported: r.error.code === -32601, error: r.error };
  if (r == null) return { bytes: null };
  return { bytes: toCertBytes(r) };
}
export async function readFeature(rpc) {
  const f = await rpc('getAccountInfo', [ALPENGLOW_FEATURE, { encoding: 'base64' }]).catch(() => null);
  // scheduled = owned by the Feature program; a System-owned account with no data is only prefunded
  if (!f?.value || f.value.owner !== FEATURE_PROGRAM) return { exists: false, scheduled: false, prefunded: !!f?.value };
  const d = Buffer.from(f.value.data[0], 'base64');
  return { exists: true, scheduled: true, activatedAt: d[0] === 1 ? Number(d.readBigUInt64LE(1)) : null };
}

// ---------- tiny argv helper ----------
export function parseArgs(argv) {
  const pos = [], o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) o[k] = argv[++i]; else o[k] = true;
    } else pos.push(a);
  }
  return { pos, o };
}
