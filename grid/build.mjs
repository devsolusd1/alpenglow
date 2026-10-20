#!/usr/bin/env node
// build.mjs - read Alpenglow's genesis certificate, prove it against ranks.json with the
// BLS pairing check, and write grid.json for the site. Read-only RPC calls only.
//
// Usage:
//   node grid/build.mjs <rpc> --ranks <ranks.json> --out <grid.json>
//        [--wait] [--interval ms] [--timeout s] [--cert file] [--record <record PDA>] [--note text]
//
//   --wait     poll the certificate account at processed commitment, plus getAgGenesisCert
//              (finalized, lags) as a second source, until data appears
//   --cert     read the certificate from a file instead (raw bytes, base64, or RPC JSON)
//   --record   the coin's record PDA: fills sealTx and firstBlock once it is sealed
//
// Exit codes: 0 verified, 1 not verified (grid.json still written, verified:false),
// 3 no certificate yet, 2 usage or RPC error.
import { readFileSync, writeFileSync } from 'node:fs';
import {
  makeRpc, detectNetwork, readCertAccount, readCertRpc, readFeature, verifyGrid, toCertBytes, bytesToBase64,
  gridHash, parseArgs, sleep, parseRecord, CERT_ACCOUNT,
} from './lib.mjs';

const { pos, o } = parseArgs(process.argv.slice(2));
const url = pos[0];
if (!url || !o.ranks || !o.out) {
  console.error('usage: node grid/build.mjs <rpc> --ranks <ranks.json> --out <grid.json> [--wait] [--interval ms] [--timeout s] [--cert file] [--record pda]');
  process.exit(2);
}
const rpc = makeRpc(url, { quietErrors: true });
const ranks = JSON.parse(readFileSync(o.ranks, 'utf8'));
const stamp = () => new Date().toISOString().slice(11, 23);

// the rank list must hash to what it claims (the program stores this hash at init)
const gh = gridHash(ranks);
if (gh !== ranks.gridHash) { console.error(`ranks file gridHash ${ranks.gridHash} does not match its contents (${gh})`); process.exit(2); }
if (ranks.dryRun) console.log('note: this ranks file is a DRY RUN, not the final list');

let network = ranks.network;
if (!o.cert) {
  const live = await detectNetwork(rpc);
  if (live !== ranks.network) { console.error(`RPC is ${live}, ranks file is ${ranks.network}`); process.exit(2); }
  network = live;
}

async function getCert() {
  if (o.cert) {
    const raw = readFileSync(o.cert);
    const txt = raw.toString('utf8').trim();
    const isText = /^[\s\x20-\x7e]*$/.test(raw.toString('latin1'));
    return { bytes: toCertBytes(isText ? txt : Uint8Array.from(raw)), source: `file ${o.cert}` };
  }
  const [acc, viaRpc] = await Promise.all([
    readCertAccount(rpc, 'processed').catch((e) => ({ bytes: null, state: 'error ' + e.message })),
    useRpcMethod ? readCertRpc(rpc).catch((e) => ({ bytes: null, error: e.message })) : Promise.resolve({ bytes: null }),
  ]);
  if (viaRpc.unsupported) { useRpcMethod = false; console.log(`${stamp()} getAgGenesisCert not supported by this RPC; polling the account only`); }
  if (acc.bytes) return { bytes: acc.bytes, source: `account ${CERT_ACCOUNT} (processed, slot ${acc.slot})` };
  if (viaRpc.bytes) return { bytes: viaRpc.bytes, source: 'getAgGenesisCert (finalized)' };
  return { bytes: null, state: acc.state };
}
let useRpcMethod = true;

let found = await getCert();
if (!found.bytes) {
  const feat = await readFeature(rpc);
  console.log(`${stamp()} no certificate yet (account: ${found.state}); Alpenglow feature ${feat.scheduled ? (feat.activatedAt != null ? `activated at slot ${feat.activatedAt}, migration slot ${feat.activatedAt + 5000}` : 'scheduled, not yet active') : `not scheduled${feat.prefunded ? ' (account only prefunded)' : ''}`}`);
  if (!o.wait) process.exit(3);
  const interval = Number(o.interval || 1000), deadline = o.timeout ? Date.now() + Number(o.timeout) * 1000 : Infinity;
  let n = 0;
  while (!found.bytes) {
    if (Date.now() > deadline) { console.log(`${stamp()} timed out`); process.exit(3); }
    await sleep(interval);
    found = await getCert();
    if (++n % 60 === 0) console.log(`${stamp()} still waiting (${found.state})`);
  }
}
const seenAt = new Date().toISOString();
console.log(`${stamp()} certificate found via ${found.source}, ${found.bytes.length} bytes`);

const fmtMs = (m) => (typeof m === 'number' ? `${Math.round(m)} ms` : m && typeof m === 'object' ? Object.entries(m).filter(([, v]) => v != null).map(([k, v]) => `${k} ${Math.round(v)} ms`).join(', ') : '?');
let r;
try { r = await verifyGrid(found.bytes, ranks); }
catch (e) { r = { verified: false, reason: 'certificate does not parse: ' + e.message, signed: [], signerCount: 0, signedStakePct: 0, certSlot: null, blockId: null, message: null, rankCount: null, ms: 0 }; }
console.log(`${stamp()} cert slot ${r.certSlot}, block ${r.blockId}, ${r.signerCount} of ${r.bitCount ?? r.rankCount} ranks signed (${r.signedStakePct}% of the list's stake)`);
console.log(`${stamp()} message ${r.message}`);
console.log(`${stamp()} ${r.verified ? 'VERIFIED' : 'NOT VERIFIED: ' + r.reason}  (verifyGrid ${fmtMs(r.ms)})`);

// optional: the coin's record, for sealTx and firstBlock
let sealTx = null, firstBlock = null, record = null;
if (o.record && !o.cert) {
  try {
    const a = await rpc('getAccountInfo', [o.record, { encoding: 'base64', commitment: 'confirmed' }]);
    const d = a?.value ? Uint8Array.from(Buffer.from(a.value.data[0], 'base64')) : null;
    if (d && d.length === 648 && Buffer.from(d.subarray(0, 8)).toString('latin1') === 'CHAMADA1') {
      const { certBytes, ...rec } = parseRecord(d);
      record = rec;
      if (record.sealed) {
        firstBlock = record.firstBlock;
        if (String(record.certSlot) !== String(r.certSlot)) console.log(`warning: record holds cert slot ${record.certSlot}, chain has ${r.certSlot}`);
        const sigs = await rpc('getSignaturesForAddress', [o.record, { limit: 1000, commitment: 'confirmed' }]);
        const hit = sigs.find((s) => s.slot === record.sealSlot && !s.err);
        sealTx = hit ? hit.signature : null;
      }
      console.log(`record ${o.record}: ${record.sealed ? `sealed at slot ${record.sealSlot} (parent ${record.parentSlot}), firstBlock ${record.firstBlock}, tx ${sealTx ?? 'not found'}` : 'not sealed yet'}`);
    } else console.log(`record ${o.record}: not a Chamada record (${d ? d.length + ' bytes' : 'missing'})`);
  } catch (e) { console.log(`record read failed: ${e.message}`); }
}

const grid = {
  network, certSlot: r.certSlot == null ? null : String(r.certSlot), blockId: r.blockId, signerCount: r.signerCount, rankCount: ranks.rankCount,
  signedStakePct: r.signedStakePct, signed: r.signed, verified: r.verified, sealTx, firstBlock,
  ...(typeof o.note === 'string' ? { note: o.note } : ranks.note ? { note: ranks.note } : {}),
  ...(ranks.dryRun ? { dryRun: true } : {}),
  reason: r.reason, shredVersion: r.shredVersion, message: r.message, gridHash: ranks.gridHash, ranksEpoch: ranks.epoch,
  certSource: found.source, seenAt, certBase64: bytesToBase64(found.bytes), record,
};
writeFileSync(o.out, JSON.stringify(grid, null, 1) + '\n');
console.log(`wrote ${o.out}`);
process.exit(r.verified ? 0 : 1);
