// Chamada against a local solana-test-validator (run through ../test.sh, which starts the validator twice).
//   node local.mjs cert    the validator holds the real devnet certificate at 42Ym56... and the same bytes
//                          at a second address: init (signed by the mint), a second init that rewrites the
//                          record before the seal, seal, every field against the certificate, and the
//                          refusals (init without the mint's signature, init after the seal, second seal,
//                          wrong address, rank_count mismatch, ...)
//   node local.mjs empty   the validator holds 42Ym56... as mainnet has it today (0.1 SOL, no data):
//                          seal must fail with CERT_NOT_WRITTEN
// Every key is a throwaway made in memory. Output lines start with PASS, FAIL or INFO; exit code 1 on any FAIL.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { web3, CERT, SLOT_HASHES, RECORD_LEN, CODE, ERR, recordAddress, gridHash, initIx, sealIx, decodeRecord, decodeCert, errorOf } from "./client.mjs";

const { Connection, Keypair, PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL, SYSVAR_CLOCK_PUBKEY } = web3;
const here = path.dirname(fileURLToPath(import.meta.url));
const RPC = process.env.RPC_URL_LOCAL ?? "http://127.0.0.1:8899";
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(RPC)) throw new Error("this test only talks to a local validator");
const PROGRAM = new PublicKey(process.env.CHAMADA_PROGRAM ?? JSON.parse(fs.readFileSync(path.join(here, "../program.json"), "utf8")).devnet);
const COPY = new PublicKey("US517G5965aydkZ46HS38QLi7UQiSojurfbQfKCELFx");
const mode = process.argv[2] ?? "cert";
const conn = new Connection(RPC, "confirmed");

let failed = 0;
const pass = (m) => console.log(`PASS ${m}`);
const fail = (m) => { failed++; console.log(`FAIL ${m}`); };
const check = (ok, m) => (ok ? pass(m) : fail(m));
const info = (m) => console.log(`INFO ${m}`);

const payer = Keypair.generate();
await conn.confirmTransaction(await conn.requestAirdrop(payer.publicKey, 100 * LAMPORTS_PER_SOL), "confirmed");

async function send(ixs, signers = [payer]) {
  const tx = new Transaction().add(...ixs);
  tx.feePayer = payer.publicKey;
  tx.recentBlockhash = (await conn.getLatestBlockhash("confirmed")).blockhash;
  tx.sign(...signers);
  const raw = tx.serialize();
  const sig = await conn.sendRawTransaction(raw, { skipPreflight: true });
  const res = await conn.confirmTransaction(sig, "confirmed");
  const t = await conn.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
  if (res.value.err) {
    const e = new Error(`transaction failed: ${JSON.stringify(res.value.err)}`);
    e.logs = t?.meta?.logMessages ?? [];
    throw e;
  }
  return { sig, size: raw.length, cu: t.meta.computeUnitsConsumed, slot: t.slot, logs: t.meta.logMessages };
}

async function expectFail(label, ixs, want, signers) {
  try {
    await send(ixs, signers);
    fail(`${label}: succeeded, expected ${typeof want === "number" ? ERR[want] : want}`);
  } catch (e) {
    const got = errorOf(e);
    check(got.code === want, `${label}: refused with ${got.name}${got.code === want ? "" : ` (expected ${typeof want === "number" ? ERR[want] : want}); ${got.text.slice(0, 400)}`}`);
  }
}

const devnetRanks = JSON.parse(fs.readFileSync(path.join(here, "fixtures/ranks-devnet.min.json"), "utf8")).ranks;
const GRID = gridHash(devnetRanks);
const site = path.join(here, "../../site/data/ranks-devnet.json");
if (fs.existsSync(site)) {
  const s = JSON.parse(fs.readFileSync(site, "utf8"));
  check(s.gridHash === GRID.toString("hex") && gridHash(s.ranks).equals(GRID), `grid_hash of the 17 devnet ranks ${GRID.toString("hex")} matches site/data/ranks-devnet.json`);
} else info(`grid_hash of the 17 devnet ranks ${GRID.toString("hex")} (site/data/ranks-devnet.json not found)`);

check(PublicKey.findProgramAddressSync([Buffer.from("carlgration")], new PublicKey("A1pengvuM6JEcyNuTnMqepBKhwHE3N6PmUrdATGawhJS"))[0].equals(CERT),
  "42Ym56... is the PDA of \"carlgration\" under the Alpenglow feature id");
const prog = await conn.getAccountInfo(PROGRAM);
check(prog?.executable === true, `program ${PROGRAM.toBase58()} loaded`);

// A fresh mint keypair signs its own init (the program refuses init without the mint's signature).
async function newRecord(rankCount, grid = GRID) {
  const mintKp = Keypair.generate();
  const mint = mintKp.publicKey;
  const record = recordAddress(PROGRAM, mint);
  const r = await send([initIx({ programId: PROGRAM, authority: payer.publicKey, mint, rankCount, gridHash: grid })], [payer, mintKp]);
  return { mintKp, mint, record, ...r };
}
const reinit = (rec, rankCount, grid, authority = payer) =>
  send([initIx({ programId: PROGRAM, authority: authority.publicKey, mint: rec.mint, rankCount, gridHash: grid })], authority === payer ? [payer, rec.mintKp] : [payer, authority, rec.mintKp]);
const rawRecord = async (rec) => (await conn.getAccountInfo(rec.record)).data;

if (mode === "cert") {
  const certAcc = await conn.getAccountInfo(CERT);
  const cert = decodeCert(certAcc.data);
  info(`certificate at 42Ym56...: ${certAcc.data.length} bytes, slot ${cert.slot}, ${cert.signers}/${cert.bits} signed`);

  // init
  const A = await newRecord(17);
  info(`init: ${A.cu} CU, transaction ${A.size} bytes (two signers: payer and mint)`);
  const recRent = await conn.getMinimumBalanceForRentExemption(RECORD_LEN);
  const accA = await conn.getAccountInfo(A.record);
  check(accA.owner.equals(PROGRAM) && accA.data.length === RECORD_LEN && accA.lamports === recRent,
    `record created: ${RECORD_LEN} bytes, owner the program, ${accA.lamports} lamports (rent minimum ${recRent} = ${recRent / LAMPORTS_PER_SOL} SOL)`);
  let r = decodeRecord(accA.data);
  check(r.discriminator === "CHAMADA1" && r.mint === A.mint.toBase58() && r.authority === payer.publicKey.toBase58() && r.rankCount === 17 &&
    r.gridHash === GRID.toString("hex") && r.sealed === 0 && accA.data.subarray(106).every((b) => b === 0), "init fields: tag, mint, authority, rank_count 17, grid_hash; the rest zero");

  // the mint must sign: a new record, and a repeated init of an existing one
  const unsigned = Keypair.generate().publicKey;
  await expectFail("init where the mint does not sign", [initIx({ programId: PROGRAM, authority: payer.publicKey, mint: unsigned, rankCount: 17, gridHash: GRID, mintSigns: false })], CODE.MINT_MUST_SIGN);
  check(!(await conn.getAccountInfo(recordAddress(PROGRAM, unsigned))), "no record was made for the mint that did not sign");
  await expectFail("second init of A's mint where the mint does not sign", [initIx({ programId: PROGRAM, authority: payer.publicKey, mint: A.mint, rankCount: 0, gridHash: Buffer.alloc(32), mintSigns: false })], CODE.MINT_MUST_SIGN);

  // a second init of the same mint, before the seal, rewrites rank_count, grid_hash and authority
  const auth2 = Keypair.generate();
  await send([SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: auth2.publicKey, lamports: 10_000_000 })]);
  const grid2 = Buffer.alloc(32, 0x5a);
  const R1 = await reinit(A, 18, grid2, auth2);
  info(`second init (rewrite): ${R1.cu} CU, transaction ${R1.size} bytes (three signers: payer, new authority, mint)`);
  let accA2 = await conn.getAccountInfo(A.record);
  r = decodeRecord(accA2.data);
  check(r.rankCount === 18 && r.gridHash === grid2.toString("hex") && r.authority === auth2.publicKey.toBase58() && r.mint === A.mint.toBase58() &&
    r.discriminator === "CHAMADA1" && r.sealed === 0 && accA2.lamports === recRent && accA2.data.subarray(106).every((b) => b === 0),
    "second init of the same mint (mint signs) succeeds: rank_count 18, the new grid_hash and authority; tag, mint, rent and the rest unchanged");
  const R2 = await reinit(A, 17, GRID);
  r = decodeRecord(await rawRecord(A));
  check(r.rankCount === 17 && r.gridHash === GRID.toString("hex") && r.authority === payer.publicKey.toBase58() && r.sealed === 0,
    `third init puts rank_count 17, grid_hash and the authority back (${R2.cu} CU)`);

  // another mint cannot touch A's record, nor init at a PDA that is not its own
  const otherKp = Keypair.generate();
  const other = otherKp.publicKey;
  await expectFail("init of A's record signed by another mint", [initIx({ programId: PROGRAM, authority: payer.publicKey, mint: other, rankCount: 0, gridHash: GRID, record: A.record })], CODE.WRONG_RECORD_ADDRESS, [payer, otherKp]);
  check(decodeRecord(await rawRecord(A)).rankCount === 17, "A's record is unchanged");
  await expectFail("init at another mint's PDA", [initIx({ programId: PROGRAM, authority: payer.publicKey, mint: other, rankCount: 17, gridHash: GRID, record: recordAddress(PROGRAM, Keypair.generate().publicKey) })], CODE.WRONG_RECORD_ADDRESS, [payer, otherKp]);
  await expectFail("init with rank_count 2025", [initIx({ programId: PROGRAM, authority: payer.publicKey, mint: other, rankCount: 2025, gridHash: GRID })], CODE.RANK_COUNT_TOO_LARGE, [payer, otherKp]);
  await expectFail("init with a wrong system program", [initIx({ programId: PROGRAM, authority: payer.publicKey, mint: other, rankCount: 17, gridHash: GRID, systemProgram: SYSVAR_CLOCK_PUBKEY })], CODE.WRONG_SYSTEM_PROGRAM, [payer, otherKp]);

  // a record address someone funded first still initialises (allocate + assign path)
  const preKp = Keypair.generate();
  const pre = preKp.publicKey;
  const preRecord = recordAddress(PROGRAM, pre);
  await send([SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: preRecord, lamports: 1_000_000 })]);
  const P = await send([initIx({ programId: PROGRAM, authority: payer.publicKey, mint: pre, rankCount: 17, gridHash: GRID })], [payer, preKp]);
  const accP = await conn.getAccountInfo(preRecord);
  check(accP.owner.equals(PROGRAM) && accP.data.length === RECORD_LEN && accP.lamports === recRent, `init on a prefunded record address works (${P.cu} CU, topped up to ${accP.lamports})`);

  // refusals before the good seal
  await expectFail("seal with the certificate's bytes at another address", [sealIx({ programId: PROGRAM, sealer: payer.publicKey, record: A.record, cert: COPY })], CODE.WRONG_CERT_ADDRESS);
  await expectFail("seal with Clock in place of SlotHashes", [sealIx({ programId: PROGRAM, sealer: payer.publicKey, record: A.record, slotHashes: SYSVAR_CLOCK_PUBKEY })], CODE.WRONG_SLOT_HASHES);
  await expectFail("seal with a System account as the record", [sealIx({ programId: PROGRAM, sealer: payer.publicKey, record: other })], CODE.NOT_A_RECORD);
  const ghost = Keypair.generate();
  await expectFail("seal where the sealer does not sign", [sealIx({ programId: PROGRAM, sealer: ghost.publicKey, record: A.record, sealerSigns: false })], "MissingRequiredSignature");
  const B = await newRecord(18);
  await expectFail("seal with rank_count 18 against 17 bits", [sealIx({ programId: PROGRAM, sealer: payer.publicKey, record: B.record })], CODE.RANK_COUNT_MISMATCH);
  const B2 = await newRecord(673);
  await expectFail("seal with rank_count 673 (mainnet size) against 17 bits", [sealIx({ programId: PROGRAM, sealer: payer.publicKey, record: B2.record })], CODE.RANK_COUNT_MISMATCH);

  // the seal, by a sealer that is not the authority
  const sealer = Keypair.generate();
  const S = await send([sealIx({ programId: PROGRAM, sealer: sealer.publicKey, record: A.record })], [payer, sealer]);
  info(`seal: ${S.cu} CU, transaction ${S.size} bytes (two signers: fee payer and sealer)`);
  const line = S.logs.find((l) => l.includes("chamada sealed:"));
  info(`log: ${line}`);
  r = decodeRecord((await conn.getAccountInfo(A.record)).data);
  const block = await conn.getBlock(S.slot, { commitment: "confirmed", maxSupportedTransactionVersion: 0, transactionDetails: "none", rewards: false });
  check(r.sealed === 1, "sealed = 1");
  check(r.certSlot === cert.slot, `cert_slot ${r.certSlot}`);
  check(r.blockId.equals(cert.blockId), `block_id ${new PublicKey(r.blockId).toBase58()}`);
  check(r.signature.equals(cert.signature), "signature: the 192 bytes");
  check(r.bitmapLen === cert.bitmapLen && r.bitmap.equals(cert.bitmap), `bitmap: ${r.bitmapLen} bytes (${r.bitmap.toString("hex")})`);
  check(r.padding.every((b) => b === 0), "bitmap area zero padded to 256 bytes");
  check(r.certBytes().equals(certAcc.data), "the record's copy rebuilds the certificate account byte for byte");
  check(r.signerCount === 11 && r.signerCount === cert.signers, `signer_count ${r.signerCount}`);
  check(r.sealer === sealer.publicKey.toBase58(), "sealer = the signing sealer");
  check(r.sealSlot === BigInt(S.slot), `seal_slot ${r.sealSlot} = the transaction's slot`);
  check(r.parentSlot === BigInt(block.parentSlot), `parent_slot ${r.parentSlot} = getBlock(${S.slot}).parentSlot (newest SlotHashes entry)`);
  check(r.firstBlock === 0 && r.firstBlock === Number(r.parentSlot === r.certSlot), "first_block 0 (parent is not the certificate's slot), and the seal did not revert");
  check(r.rankCount === 17 && r.gridHash === GRID.toString("hex") && r.mint === A.mint.toBase58() && r.authority === payer.publicKey.toBase58(), "init fields unchanged");
  check(line === `Program log: chamada sealed: cert slot ${cert.slot}, 11/17 signed, parent ${r.parentSlot}, first block no`, "one log line with the seal's numbers");

  await expectFail("second seal of the same record", [sealIx({ programId: PROGRAM, sealer: payer.publicKey, record: A.record })], CODE.ALREADY_SEALED);

  // after the seal, init is refused even when the mint signs, and the record does not change
  const sealedBytes = await rawRecord(A);
  await expectFail("init after the seal (the mint signs)", [initIx({ programId: PROGRAM, authority: payer.publicKey, mint: A.mint, rankCount: 0, gridHash: Buffer.alloc(32) })], CODE.ALREADY_SEALED, [payer, A.mintKp]);
  check((await rawRecord(A)).equals(sealedBytes), "the sealed record is unchanged");

  // the off-by-one case: B was made with rank_count 18 and its seal failed; the mint inits it again with 17,
  // then the seal passes
  const RB = await reinit(B, 17, GRID);
  const SB = await send([sealIx({ programId: PROGRAM, sealer: payer.publicKey, record: B.record })]);
  const rb = decodeRecord(await rawRecord(B));
  check(rb.sealed === 1 && rb.rankCount === 17 && rb.signerCount === 11 && rb.certBytes().equals(certAcc.data),
    `a record made with the wrong rank_count (18) is corrected by a second init (${RB.cu} CU) and then seals (${SB.cu} CU)`);

  // test mode: rank_count 0 takes any bit count
  const C = await newRecord(0, Buffer.alloc(32));
  const SC = await send([sealIx({ programId: PROGRAM, sealer: payer.publicKey, record: C.record })]);
  const rc = decodeRecord((await conn.getAccountInfo(C.record)).data);
  check(rc.sealed === 1 && rc.signerCount === 11 && rc.rankCount === 0 && rc.certBytes().equals(certAcc.data), `rank_count 0 (test mode) seals the 17-bit certificate (${SC.cu} CU, ${SC.size} bytes, one signer)`);
} else if (mode === "empty") {
  const certAcc = await conn.getAccountInfo(CERT);
  check(certAcc && certAcc.owner.equals(SystemProgram.programId) && certAcc.data.length === 0 && certAcc.lamports === 100_000_000,
    `42Ym56... as mainnet has it today: ${certAcc?.lamports} lamports, ${certAcc?.data.length} bytes, System owner`);
  const A = await newRecord(17);
  await expectFail("seal against the empty certificate account (rank_count 17)", [sealIx({ programId: PROGRAM, sealer: payer.publicKey, record: A.record })], CODE.CERT_NOT_WRITTEN);
  const C = await newRecord(0);
  await expectFail("seal against the empty certificate account (rank_count 0)", [sealIx({ programId: PROGRAM, sealer: payer.publicKey, record: C.record })], CODE.CERT_NOT_WRITTEN);
  const r = decodeRecord((await conn.getAccountInfo(A.record)).data);
  check(r.sealed === 0, "the record stays unsealed, so a later seal can still work");
} else throw new Error(`unknown mode ${mode}`);

console.log(failed ? `${failed} FAILED` : `all passed (${mode})`);
process.exit(failed ? 1 : 0);
