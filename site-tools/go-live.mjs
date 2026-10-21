#!/usr/bin/env node
// After the token exists: points the site at the live coin. Sets four values in site/config.js from
// launch/launched.mainnet-beta.json (written by launch step 2) and programs/program.json:
//   mint       the coin's address (the CA chip on the page shows and copies it)
//   programId  the Chamada program on mainnet (the page and /api/cert read the coin's record with it)
//   buyUrl     where "Buy" goes: Jupiter's page for the mint (https://jup.ag/tokens/<mint>, the same
//              link the founder's live $MONKEY site uses for "Trade"; Jupiter routes Meteora DBC pools)
//   rehearsal  false: the page shows mainnet, not the devnet replay
// It never commits or pushes: the lead does that, and Vercel redeploys.
//
//   node site-tools/go-live.mjs --dry      # prints what would change, writes nothing
//   node site-tools/go-live.mjs            # writes site/config.js
// Options (tests): --launched <file>, --program-json <file>, --buy-url <url>
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CONFIG_JS = resolve(HERE, "../site/config.js");
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const DRY = args.includes("--dry");
const LAUNCHED = opt("--launched") ?? resolve(HERE, "../launch/launched.mainnet-beta.json");
const PROGRAM_JSON = opt("--program-json") ?? resolve(HERE, "../programs/program.json");
const isAddress = (s) => typeof s === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
const fail = (why) => { console.error(`REFUSED: ${why}. site/config.js was not changed.`); process.exit(1); };

let launched, programs;
try { launched = JSON.parse(readFileSync(LAUNCHED, "utf8")); } catch { fail(`no readable launch record at ${LAUNCHED}: the token step has not landed yet (run launch.mjs, it writes the file)`); }
try { programs = JSON.parse(readFileSync(PROGRAM_JSON, "utf8")); } catch { fail(`${PROGRAM_JSON} cannot be read`); }
if (launched.cluster !== "mainnet-beta") fail(`the launch record is for ${launched.cluster}, not mainnet-beta`);
if (!isAddress(launched.mint)) fail("the launch record has no mint address");
if (!isAddress(programs.mainnet)) fail("programs/program.json has no mainnet program id yet (deploy-program.mjs writes it)");
const mint = launched.mint, programId = programs.mainnet;
const buyUrl = opt("--buy-url") ?? `https://jup.ag/tokens/${mint}`;
if (!/^https:\/\/[^\s"]+$/.test(buyUrl)) fail("--buy-url must be an https address");

// Only the top-level lines (two spaces in) are changed; the devnet block below them keeps its own.
const want = { mint: JSON.stringify(mint), programId: JSON.stringify(programId), rehearsal: "false", buyUrl: JSON.stringify(buyUrl) };
const before = readFileSync(CONFIG_JS, "utf8");
let text = before;
const changes = [];
for (const [key, value] of Object.entries(want)) {
  const re = new RegExp(`^(  ${key}: )(null|true|false|"[^"\\n]*")(,.*)$`, "m");
  const m = text.match(re);
  if (!m) fail(`site/config.js has no "  ${key}: ...," line where it was expected`);
  if (m[2] !== value) changes.push(`${key}: ${m[2]} -> ${value}`);
  text = text.replace(re, `$1${value}$3`);
}

console.log(`launch record  ${LAUNCHED}\n  CA ${mint}, pool ${launched.pool ?? "?"}\nprogram        ${programId} (programs/program.json)`);
if (!changes.length) { console.log("\nsite/config.js already has these values: nothing to change."); process.exit(0); }
console.log(`\nsite/config.js${DRY ? " would change (--dry: nothing written)" : ""}:\n${changes.map((c) => `  ${c}`).join("\n")}`);
if (DRY) process.exit(0);

writeFileSync(CONFIG_JS, text);
// Read back as the page will: the module must load and hold exactly these values.
const { CONFIG } = await import(`${pathToFileURL(CONFIG_JS).href}?t=${Date.now()}`);
const ok = CONFIG.mint === mint && CONFIG.programId === programId && CONFIG.rehearsal === false && CONFIG.buyUrl === buyUrl && CONFIG.devnet?.programId;
if (!ok) { writeFileSync(CONFIG_JS, before); fail("the written file did not read back as expected; the old one was put back"); }
console.log("\nWritten and read back. Not committed or pushed: commit site/config.js and push; Vercel then redeploys.");
