#!/usr/bin/env node
// snapshot.mjs - build ranks.json: the ordered list of validators (rank map) whose squares
// make up the grid, with validator-info names and icons. Prints rankCount and gridHash for
// the program's init instruction. Read-only RPC calls only.
//
// Usage:
//   node grid/snapshot.mjs <rpc> --out <ranks.json> [--names] [--exclude v1,v2] [--note "text"]
//        [--dry-run] [--from inputs.json] [--save-inputs inputs.json] [--diff old-ranks.json]
//
// MAINNET: the certificate's rank set is fixed at the first slot of epoch 1063
// (slot 459,216,000). Run this during epoch 1063, soon after that slot, and rerun with
// --diff to compare. It refuses to write a non-dry-run mainnet file outside epoch 1063.
import { readFileSync, writeFileSync } from 'node:fs';
import { makeRpc, detectNetwork, fetchInputs, fetchValidatorInfo, buildRanksFile, initData, parseArgs } from './lib.mjs';

const { pos, o } = parseArgs(process.argv.slice(2));
const url = pos[0];
if (!url || !o.out) {
  console.error('usage: node grid/snapshot.mjs <rpc> --out <ranks.json> [--names] [--exclude a,b] [--note text] [--dry-run] [--from inputs.json] [--save-inputs f] [--diff old.json]');
  process.exit(2);
}
const MAINNET_EPOCH = 1063;
const rpc = makeRpc(url);

const network = o.network || await detectNetwork(rpc);
const inputs = o.from ? JSON.parse(readFileSync(o.from, 'utf8')) : await fetchInputs(rpc);
if (o['save-inputs']) writeFileSync(o['save-inputs'], JSON.stringify(inputs, null, 1));
const dryRun = !!o['dry-run'];
if (network === 'mainnet-beta' && !dryRun && inputs.epoch !== MAINNET_EPOCH) {
  console.error(`mainnet inputs are from epoch ${inputs.epoch}; the certificate's rank set is fixed at the start of epoch ${MAINNET_EPOCH}. Pass --dry-run to write a practice file.`);
  process.exit(2);
}
let names = null;
if (o.names) {
  const t = Date.now();
  names = await fetchValidatorInfo(rpc).catch((e) => { console.error('validator-info failed:', e.message); return null; });
  if (names) console.log(`validator-info: ${Object.keys(names).length} identities (${Date.now() - t} ms)`);
}
const exclude = typeof o.exclude === 'string' ? o.exclude.split(',').map((s) => s.trim()).filter(Boolean) : [];
const extra = dryRun ? { dryRun: true, final: false } : { final: network === 'mainnet-beta' };
const file = buildRanksFile(inputs, { network, names, exclude, note: typeof o.note === 'string' ? o.note : null, extra });
writeFileSync(o.out, JSON.stringify(file, null, 1) + '\n');

const named = file.ranks.filter((r) => r.name).length, iconed = file.ranks.filter((r) => r.icon).length;
console.log(`network ${network}, epoch ${file.epoch}, taken at slot ${file.takenAtSlot} (accounts read at slot ${file.accountsReadAtSlot}), shred version ${file.shredVersion}`);
console.log(`excluded: ${JSON.stringify(file.excluded)}${exclude.length ? `, by hand: ${exclude.length}` : ''}`);
if (names) console.log(`names on ${named} of ${file.rankCount} squares, icons on ${iconed}`);
console.log(`rankCount ${file.rankCount}`);
console.log(`gridHash  ${file.gridHash}`);
console.log(`init data ${initData(file)}`);
console.log(`wrote ${o.out}${dryRun ? '  (DRY RUN, not the final list)' : ''}`);

if (o.diff) {
  const old = JSON.parse(readFileSync(o.diff, 'utf8'));
  const a = new Map(old.ranks.map((r) => [r.vote, r])), b = new Map(file.ranks.map((r) => [r.vote, r]));
  const added = file.ranks.filter((r) => !a.has(r.vote)), removed = old.ranks.filter((r) => !b.has(r.vote));
  const moved = file.ranks.filter((r) => a.has(r.vote) && a.get(r.vote).rank !== r.rank);
  const restaked = file.ranks.filter((r) => a.has(r.vote) && a.get(r.vote).stake !== r.stake);
  console.log(`\ndiff against ${o.diff} (epoch ${old.epoch}, slot ${old.takenAtSlot}):`);
  console.log(`  rankCount ${old.rankCount} -> ${file.rankCount}, gridHash ${old.gridHash === file.gridHash ? 'SAME' : 'CHANGED'}`);
  console.log(`  added ${added.length}, removed ${removed.length}, moved rank ${moved.length}, stake changed ${restaked.length}`);
  for (const r of added.slice(0, 20)) console.log(`  + rank ${r.rank} ${r.vote} ${r.name ?? ''}`);
  for (const r of removed.slice(0, 20)) console.log(`  - rank ${r.rank} ${r.vote} ${r.name ?? ''}`);
  if (old.gridHash !== file.gridHash) process.exitCode = 4;
}
