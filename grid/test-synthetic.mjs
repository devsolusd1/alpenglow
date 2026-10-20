#!/usr/bin/env node
// test-synthetic.mjs - prove site/core/verify.js on a mainnet-sized grid and time it.
// Makes N random BLS key pairs (min-pk: pubkeys G1, signatures G2), signs a fake 43-byte
// genesis message with a random subset, aggregates, packs the result in the certificate
// account layout, and runs verifyGrid on it (cold: no keys decoded yet; then warm).
// Also checks that a flipped bitmap bit, a wrong shred version and a swapped key fail.
//
// Usage: node grid/test-synthetic.mjs [--n 673] [--p 0.8] [--stakes site/data/ranks-mainnet-e1062-dryrun.json]
import { readFileSync, existsSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { webcrypto } from 'node:crypto';
import { verifyGrid } from '../site/core/verify.js';
import { bls, G1P, G2P, DST, genesisMessage, buildCertBytes, bytesToHex, b58encode, gridHash, pairingCheck, parseArgs } from './lib.mjs';

const { o } = parseArgs(process.argv.slice(2));
const N = Number(o.n || 673), P = Number(o.p || 0.8), SHRED = 50093;
const stakesFile = o.stakes || new URL('../site/data/ranks-mainnet-e1062-dryrun.json', import.meta.url);
const rnd = (n) => webcrypto.getRandomValues(new Uint8Array(n));
const Fr = bls.fields.Fr;
const ms = (t) => (performance.now() - t).toFixed(0) + ' ms';

// stakes: the real epoch-1062 distribution when available, else a made-up descending one
let stakes = Array.from({ length: N }, (_, i) => BigInt(1e15) - BigInt(i) * 1000000n);
try {
  if (existsSync(stakesFile)) {
    const real = JSON.parse(readFileSync(stakesFile, 'utf8')).ranks.map((r) => BigInt(r.stake));
    if (real.length >= N) stakes = real.slice(0, N);
  }
} catch { /* keep made-up stakes */ }

let t = performance.now();
const keys = [];
for (let i = 0; i < N; i++) {
  let sk = 0n; for (const b of rnd(48)) sk = (sk << 8n) | BigInt(b);
  sk = (sk % (Fr.ORDER - 1n)) + 1n;
  const pk = G1P.BASE.multiply(sk);
  keys.push({ sk, pk, bls: bytesToHex(pk.toBytes(true)) });
}
// rank order as agave sorts it: stake descending, ties by compressed key ascending
const ranks = keys.map((k, i) => ({ vote: b58encode(rnd(32)), node: b58encode(rnd(32)), stake: stakes[i].toString(), bls: k.bls, _k: k }));
ranks.sort((a, b) => (BigInt(b.stake) > BigInt(a.stake) ? 1 : BigInt(b.stake) < BigInt(a.stake) ? -1 : a.bls < b.bls ? -1 : 1));
ranks.forEach((r, i) => { r.rank = i; });
console.log(`generated ${N} key pairs in ${ms(t)}`);

const slot = 459653001n + BigInt(rnd(1)[0]);
const blockId = rnd(32);
const msg = genesisMessage(slot, blockId, SHRED);
const signedFlags = ranks.map(() => rnd(1)[0] / 256 < P);
t = performance.now();
let Hm = bls.G2.hashToCurve(msg, { DST });
if (G2P.fromAffine && !(Hm instanceof G2P)) Hm = G2P.fromAffine(Hm.toAffine());
let aggSig = G2P.ZERO;
for (let i = 0; i < N; i++) if (signedFlags[i]) aggSig = aggSig.add(Hm.multiply(ranks[i]._k.sk));
const signerCount = signedFlags.filter(Boolean).length;
console.log(`signed with ${signerCount} of ${N} keys and aggregated in ${ms(t)}`);

// certificate account bytes: slot | block_id | sig (uncompressed G2) | len | bitmap
const raw = new Uint8Array(Math.ceil(N / 8));
signedFlags.forEach((s, i) => { if (s) raw[i >> 3] |= 1 << (i & 7); });
const bitmap = new Uint8Array(3 + raw.length);
bitmap[0] = 0; bitmap[1] = N & 0xff; bitmap[2] = N >> 8; bitmap.set(raw, 3);
const sigBytes = aggSig.toBytes(false);
const cert = buildCertBytes(slot, blockId, sigBytes, bitmap);
const ranksFile = { network: 'mainnet-beta', shredVersion: SHRED, rankCount: N, ranks: ranks.map(({ _k, ...r }) => r) };
ranksFile.gridHash = gridHash(ranksFile.ranks);
console.log(`certificate ${cert.length} bytes (bitmap ${bitmap.length}), signature G2 ${sigBytes.length} bytes`);

const results = [];
const check = (name, cond) => { results.push([name, cond]); console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); };
const fmt = (m) => (typeof m === 'number' ? `${Math.round(m)} ms` : Object.entries(m).filter(([, v]) => v != null).map(([k, v]) => `${k} ${Math.round(v)}`).join(', ') + ' ms');

t = performance.now();
const cold = await verifyGrid(cert, ranksFile);
const coldMs = performance.now() - t;
check(`verifyGrid cold (${signerCount} signer keys decoded): verified=${cold.verified}, ${coldMs.toFixed(0)} ms [${fmt(cold.ms)}]`, cold.verified === true);
check(`signerCount ${cold.signerCount} and signed[] match`, cold.signerCount === signerCount && cold.signed.every((s, i) => s === signedFlags[i]));
const times = [];
for (let k = 0; k < 3; k++) { t = performance.now(); const w = await verifyGrid(cert, ranksFile); times.push(performance.now() - t); if (!w.verified) check('warm run verified', false); }
console.log(`      warm runs (keys cached): ${times.map((x) => x.toFixed(0)).join(', ')} ms`);

// the plain two-pairing form, timed in parts (fresh keys decoded from hex)
t = performance.now();
const pts = ranksFile.ranks.map((r) => { const p = G1P.fromHex(r.bls); p.assertValidity(); return p; });
const tDecodeAll = performance.now() - t;
t = performance.now();
let agg = G1P.ZERO; for (let i = 0; i < N; i++) if (signedFlags[i]) agg = agg.add(pts[i]);
const tAgg = performance.now() - t;
t = performance.now();
const sigPoint = G2P.fromHex(sigBytes); sigPoint.assertValidity();
const ok2 = pairingCheck(agg, msg, sigPoint);
const tPair = performance.now() - t;
check(`two separate pairings agree: ${ok2} (decode all ${N} keys ${tDecodeAll.toFixed(0)} ms, add ${tAgg.toFixed(1)} ms, sig + hash + 2 pairings ${tPair.toFixed(0)} ms)`, ok2 === true);

// negatives
const flipped = Uint8Array.from(cert); const j = signedFlags.indexOf(false); flipped[240 + 3 + (j >> 3)] ^= 1 << (j & 7);
check(`one extra bit (rank ${j}) set -> not verified`, (await verifyGrid(flipped, ranksFile)).verified === false);
check('wrong shred version -> not verified', (await verifyGrid(cert, { ...ranksFile, shredVersion: SHRED + 1 })).verified === false);
const swapped = ranksFile.ranks.map((r) => ({ ...r })); const a = signedFlags.indexOf(true), b = signedFlags.indexOf(false);
[swapped[a].bls, swapped[b].bls] = [swapped[b].bls, swapped[a].bls];
check('two keys swapped in the list -> not verified', (await verifyGrid(cert, { ...ranksFile, ranks: swapped })).verified === false);
// getAgGenesisCert-shaped input
const json = { block: { slot: Number(slot), blockId: Array.from(blockId) }, signature: { signature: Array.from(sigBytes), bitmap: Array.from(bitmap) } };
check('getAgGenesisCert JSON input -> verified', (await verifyGrid({ jsonrpc: '2.0', id: 1, result: json }, ranksFile)).verified === true);

const failed = results.filter(([, c]) => !c).length;
console.log(`\n${failed ? 'FAILED ' + failed : 'ALL PASS'}: ${N} ranks, ${signerCount} signers, cold verifyGrid ${coldMs.toFixed(0)} ms in Node ${process.version}`);
process.exit(failed ? 1 : 0);
