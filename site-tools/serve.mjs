#!/usr/bin/env node
// Local preview of the site: serves site/ as static files and /api/cert through the same handler
// Vercel runs. No dependencies.
//
//   node site-tools/serve.mjs [port] [--final-list] [--slot N] [--fake-cert]
//
// Test-only switches (they change only what this local server answers, never any file):
//   --final-list  answer /data/ranks.json with the mainnet dry-run list marked final; the page asks for
//                 ranks.json only after slot 459,216,000, so pair it with --slot (e.g. 459300000 shows "set")
//   --slot N      pretend mainnet is at slot N (from 459648000 the feature also reads as active;
//                 459653010 shows "switching")
//   --fake-cert   answer mainnet with a made-up 673-rank certificate (random bits, devnet's signature):
//                 the grid lights, and "check it yourself" must say it did not pass
//   --fake-seal   with --fake-cert: also answer a made-up sealed record (first block: yes)
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../site");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png",
  ".webp": "image/webp", ".jpg": "image/jpeg", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8" };
const args = process.argv.slice(2);
const flag = (k) => args.includes(k);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const port = Number(args.find((a) => /^\d+$/.test(a) && args[args.indexOf(a) - 1] !== "--slot") || process.env.PORT || 0);
const { default: certApi } = await import("../api/cert.js");
const { buildCertBytes, bytesToBase64, base64ToBytes, parseCert } = await import("../site/core/cert.js");

async function exists(f) { try { await stat(f); return true; } catch { return false; } }

async function fakeCert() {
  const grid = JSON.parse(await readFile(join(ROOT, "data/grid-devnet.json"), "utf8"));
  const sig = parseCert(base64ToBytes(grid.certBase64)).signature;
  const n = 673, bm = new Uint8Array(3 + Math.ceil(n / 8));
  bm[1] = n & 255; bm[2] = n >> 8;
  for (let i = 0; i < n; i++) if (Math.random() < (i < 120 ? 0.95 : 0.8)) bm[3 + (i >> 3)] |= 1 << (i & 7);
  return bytesToBase64(buildCertBytes(459652999, new Uint8Array(32).fill(7), sig, bm));
}
const fake = flag("--fake-cert") ? await fakeCert() : null;

function captureJson(req, edit) {
  return new Promise((done) => {
    const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { done({ status: this.statusCode, headers: this.headers, body: edit(JSON.parse(b)) }); } };
    certApi(req, res);
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const path = decodeURIComponent(url.pathname);
  if (path === "/api/cert") {
    const mainnet = (url.searchParams.get("network") || "mainnet-beta") === "mainnet-beta";
    if (!mainnet || (!fake && !opt("--slot"))) return certApi(req, res);
    const r = await captureJson(req, (j) => {
      if (opt("--slot")) { j.slot = Number(opt("--slot")); if (j.slot >= 459648000) j.feature = { state: "active", activatedAt: 459648000, migrationSlot: 459653000 }; }
      if (fake) j.cert = { source: "account", slot: "459652999", bytes: fake, note: "FAKE, local test only" };
      if (fake && flag("--fake-seal")) j.record = { address: "4cAgtFQ2rbKXNsNqzXAVF93KS8C6gAkbxx1NMfF3GHsJ", exists: true, sealed: true, firstBlock: true,
        sealSlot: 459653004, parentSlot: 459652999, sealer: "8jwG1axgu58j99bioCaHdtM6KskBxgHGHk5gRsM6eMjD", certSlot: 459652999, rankCount: 673,
        sealTx: "2GL3Kx4S6L39KF8tG3ZpiXLzQ1cAZbV2rJadiXB75bhCd1i3TjtL5qHqQhb5tuht65BQAk8fQUc4ppbDgaUX1xyU", note: "FAKE, local test only" };
      return j;
    });
    res.writeHead(r.status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    return res.end(JSON.stringify(r.body));
  }
  let file = normalize(join(ROOT, path));
  if (!file.startsWith(ROOT)) { res.statusCode = 403; return res.end(); }
  try {
    if (path === "/data/ranks.json" && flag("--final-list") && !(await exists(file))) {
      const d = JSON.parse(await readFile(join(ROOT, "data/ranks-mainnet-e1062-dryrun.json"), "utf8"));
      Object.assign(d, { dryRun: false, final: true, note: "LOCAL TEST: dry-run list marked final by serve.mjs --final-list" });
      res.writeHead(200, { "Content-Type": TYPES[".json"], "Cache-Control": "no-store" });
      return res.end(JSON.stringify(d));
    }
    if ((await stat(file)).isDirectory()) file = join(file, "index.html");
    const body = await readFile(file);
    res.setHeader("Content-Type", TYPES[extname(file)] || "application/octet-stream");
    res.setHeader("Cache-Control", "no-store");
    res.end(body);
  } catch {
    res.statusCode = 404;
    res.end("not found");
  }
});
server.listen(port, "127.0.0.1", () => {
  const on = ["--final-list", "--fake-cert", "--fake-seal"].filter(flag).concat(opt("--slot") ? [`--slot ${opt("--slot")}`] : []);
  console.log(`site on http://127.0.0.1:${server.address().port}/${on.length ? "  (test switches: " + on.join(" ") + ")" : ""}`);
});
