// Builds the local-validator fixtures from the devnet certificate (fixtures/cert-devnet.rpc.json, a
// getAccountInfo response for 42Ym56TQ7AKFThRv5nyoSABq5ZPgE2TLKo8BALZEtoU1 taken 2026-10-19; or a fresher
// `solana account --output json` dump passed as the first argument). Writes into fixtures/:
//   cert-devnet.bin             the 246 raw bytes (the host tests include them)
//   cert-devnet-account.json    the real certificate, for solana-test-validator --account 42Ym56... <file>
//   cert-empty-account.json     the address as mainnet has it today: 0.1 SOL, System owner, no data
//   cert-copy-account.json      the same bytes at another address (the wrong-address test)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(here, "fixtures");
const CERT = "42Ym56TQ7AKFThRv5nyoSABq5ZPgE2TLKo8BALZEtoU1";
const SYSTEM = "11111111111111111111111111111111";
// any valid address that is not the certificate's: 32 bytes of 7 in base58
export const COPY_ADDRESS = "US517G5965aydkZ46HS38QLi7UQiSojurfbQfKCELFx";

const src = JSON.parse(fs.readFileSync(process.argv[2] ?? path.join(dir, "cert-devnet.rpc.json"), "utf8"));
const acct = src.result?.value ?? src.account ?? src;
const data = Buffer.from(acct.data[0], "base64");
if (data.length < 243) throw new Error(`certificate has ${data.length} bytes`);
fs.writeFileSync(path.join(dir, "cert-devnet.bin"), data);

const account = (pubkey, lamports, bytes) => ({
  pubkey,
  account: { lamports, data: [bytes.toString("base64"), "base64"], owner: SYSTEM, executable: false, rentEpoch: 0, space: bytes.length },
});
fs.writeFileSync(path.join(dir, "cert-devnet-account.json"), JSON.stringify(account(CERT, acct.lamports, data), null, 1));
fs.writeFileSync(path.join(dir, "cert-empty-account.json"), JSON.stringify(account(CERT, 100_000_000, Buffer.alloc(0)), null, 1));
fs.writeFileSync(path.join(dir, "cert-copy-account.json"), JSON.stringify(account(COPY_ADDRESS, acct.lamports, data), null, 1));
console.log(`fixtures: certificate ${data.length} bytes, slot ${data.readBigUInt64LE(0)}`);
