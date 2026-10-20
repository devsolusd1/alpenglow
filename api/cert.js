// GET /api/cert[?network=devnet]
// Where Solana stands on the roll call: the genesis certificate account (processed commitment, the
// fastest view), getAgGenesisCert (finalized, lags), the Alpenglow feature, the current slot and
// pace, and the coin's record if the program and mint are set in site/config.js.
// RPC: process.env.RPC_URL (devnet: RPC_URL_DEVNET), falling back to the public RPC. Answers are
// kept for 1 second in this instance and at the edge. No npm dependencies. Read-only.
import { CONFIG } from "../site/config.js";
import {
  CERT_ACCOUNT, ALPENGLOW_FEATURE, FEATURE_PROGRAM, SYSTEM_PROGRAM, MIGRATION_OFFSET,
  base64ToBytes, bytesToBase64, b58encode, parseCert, parseRecord, toCertBytes, isAddress,
} from "../site/core/cert.js";
import { recordAddress } from "../site/core/pda.js";

const PUBLIC_RPC = { "mainnet-beta": "https://api.mainnet-beta.solana.com", devnet: "https://api.devnet.solana.com" };
const ENV_RPC = { "mainnet-beta": "RPC_URL", devnet: "RPC_URL_DEVNET" };
const CACHE_MS = 1000;
const EDGE = "public, s-maxage=1, stale-while-revalidate=1";

const answers = new Map();   // network -> { at, body } | { pending }
const paces = new Map();     // network -> { at, msPerSlot }
const sealTxs = new Map();   // record address -> { sig, lastLook }
const noAgCert = new Set();  // RPC urls without getAgGenesisCert

let rpcId = 0;
async function rpc(url, method, params = [], timeout = 3500) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
    signal: AbortSignal.timeout(timeout),
  });
  if (!r.ok) throw new Error(`${method}: HTTP ${r.status}`);
  const j = await r.json();
  if (j.error) throw Object.assign(new Error(`${method}: ${j.error.message || JSON.stringify(j.error)}`), { code: j.error.code });
  return j.result;
}

function target(network) {
  const c = network === "devnet" ? CONFIG.devnet || {} : CONFIG;
  if (!isAddress(c.programId) || !isAddress(c.mint)) return null;
  return { programId: c.programId, mint: c.mint, address: recordAddress(c.programId, c.mint) };
}

async function pace(url, network) {
  const p = paces.get(network);
  if (p && Date.now() - p.at < 60000) return p.msPerSlot;
  try {
    const s = await rpc(url, "getRecentPerformanceSamples", [30]);
    const slots = s.reduce((a, x) => a + x.numSlots, 0), secs = s.reduce((a, x) => a + x.samplePeriodSecs, 0);
    const msPerSlot = slots > 0 ? Math.round((secs * 1000 * 100) / slots) / 100 : null;
    paces.set(network, { at: Date.now(), msPerSlot });
    return msPerSlot;
  } catch { return p ? p.msPerSlot : null; }
}

async function agCert(url) {
  if (noAgCert.has(url)) return { supported: false, bytes: null };
  try {
    const r = await rpc(url, "getAgGenesisCert", [], 2500);
    return { supported: true, bytes: r ? toCertBytes(r) : null };
  } catch (e) {
    if (e.code === -32601) noAgCert.add(url);
    return { supported: e.code !== -32601, bytes: null };
  }
}

async function sealTx(url, address, sealSlot) {
  const known = sealTxs.get(address);
  if (known && known.sig) return known.sig;
  if (known && Date.now() - known.lastLook < 10000) return null;
  sealTxs.set(address, { sig: null, lastLook: Date.now() });
  try {
    const sigs = await rpc(url, "getSignaturesForAddress", [address, { limit: 1000, commitment: "confirmed" }]);
    const hit = sigs.find((s) => s.slot === sealSlot && !s.err);
    if (hit) sealTxs.set(address, { sig: hit.signature, lastLook: Date.now() });
    return hit ? hit.signature : null;
  } catch { return null; }
}

function certView(bytes, source) {
  const c = parseCert(bytes);
  return { source, slot: c.slot.toString(), blockId: b58encode(c.blockId), bitCount: c.nbits,
    signerCount: c.bits.filter(Boolean).length, bytes: bytesToBase64(bytes) };
}

async function read(network, url, source) {
  const rec = target(network);
  const keys = [CERT_ACCOUNT, ALPENGLOW_FEATURE, ...(rec ? [rec.address] : [])];
  const [multi, slot, ag, msPerSlot] = await Promise.all([
    rpc(url, "getMultipleAccounts", [keys, { encoding: "base64", commitment: "processed" }]),
    rpc(url, "getSlot", [{ commitment: "processed" }]),
    agCert(url),
    pace(url, network),
  ]);
  const [certAcc, featAcc, recAcc] = multi.value;

  const account = certAcc
    ? { exists: true, lamports: certAcc.lamports, owner: certAcc.owner, dataLen: base64ToBytes(certAcc.data[0]).length }
    : { exists: false, lamports: 0, owner: null, dataLen: 0 };
  let cert = null, certError = null;
  if (certAcc && account.dataLen > 0) {
    try {
      if (certAcc.owner !== SYSTEM_PROGRAM) throw new Error("unexpected owner " + certAcc.owner);
      cert = certView(base64ToBytes(certAcc.data[0]), "account");
    } catch (e) { certError = e.message; }
  }
  if (!cert && ag.bytes) { try { cert = certView(ag.bytes, "getAgGenesisCert"); } catch (e) { certError = certError || e.message; } }

  // Feature account: Option<u64> activated_at under the Feature program; anything else means "not scheduled".
  let feature = { state: "unscheduled", activatedAt: null, migrationSlot: null };
  if (featAcc && featAcc.owner === FEATURE_PROGRAM) {
    const d = base64ToBytes(featAcc.data[0]);
    if (d.length >= 9 && d[0] === 1) {
      let n = 0n; for (let i = 8; i >= 1; i--) n = (n << 8n) | BigInt(d[i]);
      feature = { state: "active", activatedAt: Number(n), migrationSlot: Number(n) + MIGRATION_OFFSET };
    } else if (d.length >= 1) feature = { state: "pending", activatedAt: null, migrationSlot: null };
  }

  let record = null;
  if (rec) {
    record = { address: rec.address, programId: rec.programId, mint: rec.mint, exists: false };
    if (recAcc && recAcc.owner === rec.programId) {
      try {
        const r = parseRecord(base64ToBytes(recAcc.data[0]));
        delete r.certBytes;
        record = { ...record, exists: true, ...r, sealTx: r.sealed ? await sealTx(url, rec.address, r.sealSlot) : null };
      } catch (e) { record.error = e.message; }
    }
  }

  return {
    network, rpc: source, at: Date.now(), slot, contextSlot: multi.context?.slot ?? null, msPerSlot,
    feature, certAccount: CERT_ACCOUNT, account, cert, certError, finalized: ag.supported ? !!ag.bytes : null, record,
  };
}

async function look(network) {
  const own = process.env[ENV_RPC[network]]?.trim();
  if (own) {
    try { return await read(network, own, "env"); } catch (e) { console.error(`cert: ${ENV_RPC[network]} failed, trying the public RPC:`, e.message); }
  }
  return read(network, PUBLIC_RPC[network], "public");
}

function answer(network) {
  const a = answers.get(network);
  if (a && a.body && Date.now() - a.at < CACHE_MS) return Promise.resolve(a.body);
  if (a && a.pending) return a.pending;
  const pending = look(network).then(
    (body) => { answers.set(network, { at: Date.now(), body }); return body; },
    (err) => { answers.delete(network); throw err; },
  );
  answers.set(network, { ...(a || {}), pending });
  return pending;
}

function send(res, status, body, cache) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", cache);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, { error: "GET only" }, "no-store");
  const q = new URL(req.url, "http://x").searchParams;
  const network = q.get("network") || CONFIG.network;
  if (!PUBLIC_RPC[network]) return send(res, 400, { error: "network must be mainnet-beta or devnet" }, "no-store");
  try {
    send(res, 200, await answer(network), EDGE);
  } catch (err) {
    send(res, 503, { error: String(err && err.message ? err.message : err) }, "no-store");
  }
}
