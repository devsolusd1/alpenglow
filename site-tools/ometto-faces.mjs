#!/usr/bin/env node
// The face sheet: Ometto alone in each mood, with its label and the three characters, drawn by the
// site's own omettoSVG and photographed by headless Chrome (through token-assets.mjs's helper).
//
//   node site-tools/ometto-faces.mjs [out.png]     (default site-tools/screens/ometto-faces.png)
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chrome } from "./token-assets.mjs";
import { omettoSVG, FACES, COLORS } from "../site/ometto.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const out = process.argv[2] || join(HERE, "screens", "ometto-faces.png");
const FONTS = `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Figtree:wght@400..800&family=JetBrains+Mono:wght@800&display=swap">`;
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const cell = (k, dark) => `<figure class="${dark ? "dark" : ""}">${omettoSVG({ mood: k, size: 220, background: dark ? COLORS.night : null, fontImport: false })}
  <figcaption><code>${esc(FACES[k].face)}</code><span>${esc(FACES[k].label)}${dark ? ", night" : ""}</span></figcaption></figure>`;
const cells = Object.keys(FACES).map((k) => cell(k)).join("") + cell("wink", true);
const W = 1280, H = 640;
const html = `<!doctype html><html><head><meta charset="utf-8">${FONTS}<style>
html, body { margin: 0; } body { width: ${W}px; height: ${H}px; background: #fff; color: #111512; font: 15px/1.3 Figtree, sans-serif; overflow: hidden; }
h1 { margin: 0; padding: 30px 40px 6px; font-size: 22px; font-weight: 800; } p.sub { margin: 0; padding: 0 40px 10px; color: #4a524c; }
main { display: grid; grid-template-columns: repeat(6, 1fr); gap: 10px 8px; padding: 10px 28px; }
figure { margin: 0; display: flex; flex-direction: column; align-items: center; border-radius: 22px; padding: 6px 0 14px; }
figure svg { display: block; width: 180px; height: 180px; }
figure.dark { background: ${COLORS.night}; color: #edf3ee; }
figcaption { display: flex; flex-direction: column; align-items: center; gap: 3px; text-align: center; }
code { font: 800 18px/1 "JetBrains Mono", monospace; }
figcaption span { color: #4a524c; font-size: 14px; } figure.dark figcaption span { color: #a8b2aa; }
</style></head><body><h1>Ometto's faces</h1><p class="sub">Typed in JetBrains Mono, near-black on neon ${COLORS.neon}. Each is tied to a real state on the page.</p><main>${cells}</main></body></html>`;
const C = await chrome();
try {
  await C.shoot(html, W, H, out);
  console.log(out, C.errors.length ? C.errors : "");
} finally { C.close(); }
