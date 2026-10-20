// Devnet (run through ../devnet.sh): a fresh test mint's keypair signs init with a deliberately wrong rank_count
// (18 for devnet's 17-rank certificate), a second init signed by the same mint corrects it to 17, then the seal
// runs against the real devnet genesis certificate, and the record is read back and compared with the live
// certificate account and with getBlock(seal slot).parentSlot. Simulated only (free, nothing lands): the seal
// with the wrong count (RANK_COUNT_MISMATCH), init without the mint's signature (MINT_MUST_SIGN), init after the
// seal (ALREADY_SEALED). Devnet runs Alpenglow, so this proves the program reads the runtime-written certificate
// and the SlotHashes sysvar on an Alpenglow cluster.
//   node devnet.mjs <mint key file>   (a throwaway made by devnet.sh in $CHAMADA_KEYS; payer:
//                                      $CHAMADA_KEYS/devnet-payer.json, a throwaway; secrets never printed)
// Writes the numbers to tests/devnet-result.json.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { web3, CERT, RECORD_LEN, ERR, recordAddress, gridHash, initIx, sealIx, decodeRecord, decodeCert } from "./client.mjs";

const { Connection, Keypair, PublicKey, Transaction, LAMPORTS_PER_SOL } = web3;
const here = path.dirname(fileURLToPath(import.meta.url));
const RPC = process.env.RPC_URL_DEVNET ?? "https://api.devnet.solana.com";
if (/mainnet/i.test(RPC)) throw new Error("devnet only");
const conn = new Connection(RPC, "confirmed");
const keys = process.env.CHAMADA_KEYS ?? path.join(os.homedir(), "chamada-keys");
const readKey = (file) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(file, "utf8"))));
const payer = readKey(path.join(keys, "devnet-payer.json"));
const PROGRAM = new PublicKey(JSON.parse(fs.readFileSync(path.join(here, "../program.json"), "utf8")).devnet);
const mintFile = process.argv[2] ?? (() => { throw new Error("usage: node devnet.mjs <mint key file>"); })();
const mintKp = readKey(mintFile);
const mint = mintKp.publicKey;
const genesis = await conn.getGenesisHash();
if (genesis !== "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG") throw new Error(`not devnet: genesis ${genesis}`);

let failed = 0;
const check = (ok, m) => { if (!ok) failed++; console.log(`${ok ? "PASS" : "FAIL"} ${m}`); };
const info = (m) => console.log(`INFO ${m}`);

async function send(ixs, signers = [payer]) {
  const tx = new Transaction().add(...ixs);
  tx.feePayer = payer.publicKey;
  tx.recentBlockhash = (await conn.getLatestBlockhash("confirmed")).blockhash;
  tx.sign(...signers);
  const raw = tx.serialize();
  const sig = await conn.sendRawTransaction(raw, { skipPreflight: false, preflightCommitment: "confirmed" });
  const res = await conn.confirmTransaction(sig, "confirmed");
  if (res.value.err) throw new Error(`${sig} failed: ${JSON.stringify(res.value.err)}`);
  let t = null;
  for (let i = 0; i < 20 && !t; i++) {
    t = await conn.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    if (!t) await new Promise((r) => setTimeout(r, 1000));
  }
  return { sig, size: raw.length, cu: t.meta.computeUnitsConsumed, slot: t.slot, fee: t.meta.fee, logs: t.meta.logMessages };
}
// Simulation only (signatures not checked, nothing lands): the custom error code, or null when it passes.
async function simulatedError(ixs) {
  const tx = new Transaction().add(...ixs);
  tx.feePayer = payer.publicKey;
  const sim = await conn.simulateTransaction(tx);
  return sim.value.err ? (sim.value.err?.InstructionError?.[1]?.Custom ?? JSON.stringify(sim.value.err)) : null;
}
async function expectSimFail(label, ixs, code) {
  const got = await simulatedError(ixs);
  check(got === code, `${label}: simulation refused with ${ERR[got] ?? got}${got === code ? "" : ` (expected ${ERR[code]})`}`);
}

const prog = await conn.getAccountInfo(PROGRAM);
check(prog?.executable === true, `program ${PROGRAM.toBase58()} deployed on devnet`);
const mintAcc = await conn.getAccountInfo(mint);
info(`test mint ${mint.toBase58()} (${mintAcc ? `${mintAcc.data.length} bytes, owner ${mintAcc.owner.toBase58()}` : "not found"})`);
const record = recordAddress(PROGRAM, mint);
const GRID = gridHash(JSON.parse(fs.readFileSync(path.join(here, "fixtures/ranks-devnet.min.json"), "utf8")).ranks);
if (await conn.getAccountInfo(record)) throw new Error(`record ${record.toBase58()} exists already: rerun devnet.sh, which makes a fresh mint`);

const initFor = (rankCount, extra = {}) => initIx({ programId: PROGRAM, authority: payer.publicKey, mint, rankCount, gridHash: GRID, ...extra });
await expectSimFail("init where the mint does not sign", [initFor(17, { mintSigns: false })], 17);
const I = await send([initFor(18)], [payer, mintKp]);
info(`init (rank_count 18, wrong on purpose) ${I.sig}: ${I.cu} CU, ${I.size} bytes, slot ${I.slot}`);
await expectSimFail("seal with rank_count 18 against the 17-bit certificate", [sealIx({ programId: PROGRAM, sealer: payer.publicKey, record })], 12);
const I2 = await send([initFor(17)], [payer, mintKp]);
info(`second init (rank_count 17, the correction) ${I2.sig}: ${I2.cu} CU, ${I2.size} bytes, slot ${I2.slot}`);
const before = decodeRecord((await conn.getAccountInfo(record)).data);
check(before.rankCount === 17 && before.sealed === 0 && before.gridHash === GRID.toString("hex"), "the second init rewrote rank_count to 17; not sealed");

const S = await send([sealIx({ programId: PROGRAM, sealer: payer.publicKey, record })]);
info(`seal ${S.sig}: ${S.cu} CU, ${S.size} bytes, slot ${S.slot}`);
const line = S.logs.find((l) => l.includes("chamada sealed:"));
info(`log: ${line}`);

const [recAcc, certAcc] = await Promise.all([conn.getAccountInfo(record), conn.getAccountInfo(CERT)]);
const r = decodeRecord(recAcc.data);
const cert = decodeCert(certAcc.data);
const block = await conn.getBlock(S.slot, { commitment: "confirmed", maxSupportedTransactionVersion: 0, transactionDetails: "none", rewards: false });
const rent = await conn.getMinimumBalanceForRentExemption(RECORD_LEN);
check(recAcc.owner.equals(PROGRAM) && recAcc.data.length === RECORD_LEN, `record ${record.toBase58()}: ${RECORD_LEN} bytes, ${recAcc.lamports} lamports (rent minimum ${rent})`);
check(r.sealed === 1 && r.rankCount === 17 && r.mint === mint.toBase58() && r.gridHash === GRID.toString("hex"), "sealed = 1, rank_count 17, mint, grid_hash");
check(r.certBytes().equals(certAcc.data), `the record's copy equals the live certificate account (${certAcc.data.length} bytes, slot ${cert.slot})`);
check(r.signerCount === cert.signers && r.signerCount === 11, `signer_count ${r.signerCount}/${cert.bits}`);
check(r.sealSlot === BigInt(S.slot), `seal_slot ${r.sealSlot} = the transaction's slot`);
check(r.parentSlot === BigInt(block.parentSlot), `parent_slot ${r.parentSlot} = getBlock(${S.slot}).parentSlot ${block.parentSlot} (SlotHashes read on Alpenglow devnet)`);
check(r.firstBlock === 0, "first_block 0 (devnet's first Alpenglow block is long past) and no revert");
check(r.sealer === payer.publicKey.toBase58(), "sealer");
await expectSimFail("init after the seal (the mint signs)", [initFor(0)], 5);

const out = {
  network: "devnet", program: PROGRAM.toBase58(), mint: mint.toBase58(), record: record.toBase58(), recordLamports: recAcc.lamports, recordRent: rent,
  init: { sig: I.sig, cu: I.cu, size: I.size, slot: I.slot, fee: I.fee, rankCount: 18 },
  reinit: { sig: I2.sig, cu: I2.cu, size: I2.size, slot: I2.slot, fee: I2.fee, rankCount: 17 },
  seal: { sig: S.sig, cu: S.cu, size: S.size, slot: S.slot, fee: S.fee, log: line },
  sealSlot: String(r.sealSlot), parentSlot: String(r.parentSlot), blockParentSlot: block.parentSlot, firstBlock: r.firstBlock,
  certSlot: String(r.certSlot), signerCount: r.signerCount, bits: cert.bits, passed: failed === 0, at: new Date().toISOString(),
};
fs.writeFileSync(path.join(here, "devnet-result.json"), JSON.stringify(out, null, 1));
info(`payer balance now ${(await conn.getBalance(payer.publicKey)) / LAMPORTS_PER_SOL} SOL`);
console.log(failed ? `${failed} FAILED` : "devnet: all passed");
process.exit(failed ? 1 : 0);
