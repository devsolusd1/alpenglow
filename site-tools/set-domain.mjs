#!/usr/bin/env node
// Writes the site's own address into the two static files that need it absolute, from one constant:
// siteUrl in site/config.js. No build step, so this is run once by hand after setting it.
//
//   node site-tools/set-domain.mjs           (reads siteUrl from site/config.js)
//
// siteUrl "https://<domain>":
//   site/index.html     og:image and twitter:image become https://<domain>/og.png; og:url is added
//   site/metadata.json  image and properties.files[0].uri become https://<domain>/token.png;
//                       website and external_url become https://<domain>/
// siteUrl null: the same places go back to root-relative paths (/og.png, /token.png), which work on any
// host for browsers; og:url, website and external_url are removed. Running it twice changes nothing.
//
// It does not touch launch/token.json: uri and image there stay the founder's to set (to
// https://<domain>/metadata.json and https://<domain>/token.png), and the launch script refuses unless
// the served metadata.json names that same image.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIG } from "../site/config.js";

const SITE = resolve(dirname(fileURLToPath(import.meta.url)), "../site");
const raw = CONFIG.siteUrl;
if (raw != null && !/^https:\/\/[a-z0-9.-]+\.[a-z]{2,}(:\d+)?\/?$/i.test(raw)) {
  console.error(`site/config.js siteUrl must be null or "https://<domain>" (no path), not ${JSON.stringify(raw)}`);
  process.exit(2);
}
const base = raw ? raw.replace(/\/$/, "") : "";

// index.html
const htmlPath = resolve(SITE, "index.html");
let html = readFileSync(htmlPath, "utf8");
const before = html;
for (const tag of ['property="og:image"', 'name="twitter:image"']) {
  const re = new RegExp(`(<meta ${tag} content=")[^"]*(">)`);
  if (!re.test(html)) { console.error(`index.html has no <meta ${tag} content="..."> to set`); process.exit(1); }
  html = html.replace(re, `$1${base}/og.png$2`);
}
html = html.replace(/\n<meta property="og:url" content="[^"]*">/, "");
if (base) html = html.replace(/(<meta property="og:type" content="website">)/, `$1\n<meta property="og:url" content="${base}/">`);
if (html !== before) writeFileSync(htmlPath, html);

// metadata.json (keys kept in the order the earlier coins used)
const metaPath = resolve(SITE, "metadata.json");
const M = JSON.parse(readFileSync(metaPath, "utf8"));
const image = `${base}/token.png`;
const MANAGED = ["name", "symbol", "description", "image", "external_url", "website", "extensions", "properties"];
const out = { name: M.name, symbol: M.symbol, description: M.description, image };
if (base) { out.external_url = `${base}/`; out.website = `${base}/`; }
for (const [k, v] of Object.entries(M)) if (!MANAGED.includes(k)) out[k] = v; // twitter and the like, once added by hand
const ext = { ...(M.extensions || {}) };
if (base) ext.website = `${base}/`; else delete ext.website;
if (Object.keys(ext).length) out.extensions = ext;
out.properties = { ...(M.properties || {}), category: "image", files: [{ uri: image, type: "image/png" }] };
const json = JSON.stringify(out, null, 2).replace(/"files": \[\s*\{\s*"uri": ("[^"]*"),\s*"type": ("[^"]*")\s*\}\s*\]/, '"files": [{ "uri": $1, "type": $2 }]');
writeFileSync(metaPath, json + "\n");

console.log(base ? `share images now at ${base}/og.png and ${base}/token.png; og:url and website ${base}/` : "siteUrl is null: share images left root-relative (/og.png, /token.png)");
console.log(`next, in launch/token.json: uri ${base || "https://<domain>"}/metadata.json, image ${base || "https://<domain>"}/token.png`);
