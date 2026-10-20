#!/usr/bin/env node
// Ometto alone, as a standalone SVG, from the same code the site draws him with (omettoSVG in
// site/ometto.js). For the token pictures.
//
//   node site-tools/ometto-alone.mjs <out.svg> [--mood wink|happy|wait|sleep|... or three characters like ">_0"]
//        [--size 1024] [--background "#ffffff" | none] [--glow] [--cairn 0|17|673] [--portrait] [--no-font-import]
//
// --cairn 0 (default) is Ometto alone, the neon stone with his face; a count stands him on a cairn
// of that many pebbles, all lit. The face is text in JetBrains Mono: the file @imports it from Google
// Fonts so it shows right when opened alone (--no-font-import leaves that out; a viewer without the
// font falls back to its own monospace).
import { writeFileSync } from "node:fs";
import { omettoSVG, FACES } from "../site/ometto.js";

const args = process.argv.slice(2);
const out = args[0];
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
if (!out || out.startsWith("--")) {
  console.error(`usage: node site-tools/ometto-alone.mjs <out.svg> [--mood ${Object.keys(FACES).join("|")}] [--size 1024] [--background #ffffff|none] [--glow] [--cairn 0] [--portrait] [--no-font-import]`);
  process.exit(2);
}
const bg = opt("--background", "#ffffff");
const svg = omettoSVG({
  mood: opt("--mood", "wink"),
  size: Number(opt("--size", 1024)),
  background: bg === "none" ? null : bg,
  glow: args.includes("--glow") ? true : null,
  cairn: Number(opt("--cairn", 0)),
  square: !args.includes("--portrait"),
  fontImport: !args.includes("--no-font-import"),
});
writeFileSync(out, svg);
console.log(`${out}: ${svg.length} bytes`);
