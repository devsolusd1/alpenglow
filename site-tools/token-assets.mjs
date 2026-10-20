#!/usr/bin/env node
// The coin's pictures, drawn by the site's own character code (omettoSVG in site/ometto.js) and
// photographed by the local Chrome in headless mode (DevTools protocol, Node's own WebSocket, no
// dependencies):
//   site/token.png                         1000 x 1000, Ometto alone: the neon stone, face ">_0", on near-black
//   site/og.png                            1200 x 630, the social preview (Ometto on a small cairn, all lit)
//   site-tools/screens/token-48.png        the token picture shown at 48 px, the way a wallet shows it
//   site-tools/screens/token-48-check.png  that 48 px copy on light and dark, square and round, and 8x
//                                          enlarged, for looking at
//
//   node site-tools/token-assets.mjs [--mood wink] [--og-mood wink] [--token-bg "#0e110f"] [--token-halo] [--og-bg "#ffffff"] [--only token|og]
//
// Defaults: the wink ">_0" (the founder's own example, and his face at the seal). The token is on the
// night page's near-black: wallets and terminals are mostly dark, where a white tile reads as a
// sticker, and on light lists the dark disc still holds the neon (compared 2026-10-20 at 48, 32 and
// 24 px, square and round). No halo on the token (--token-halo adds it): at 48 px it only blurs the
// edge, and in a round crop it touches the circle. The preview stays on the site's white.
import { spawn } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { omettoSVG, COLORS, OM } from "../site/ometto.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const SITE = resolve(HERE, "../site");
const SCREENS = resolve(HERE, "screens");
const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The site's tokens (site/style.css, day theme).
export const INK = "#111512", INK2 = "#4a524c", EDGE = "#c6cdc8", NEON = COLORS.neon, ON_NEON = COLORS.ink, DEEP = COLORS.deep;
const FONTS = `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Figtree:wght@400..800&family=JetBrains+Mono:wght@800&family=M+PLUS+Rounded+1c:wght@500;700;800&display=swap">`;

// Ometto, framed by `box` [x, y, w, h] in figure units (the page's frame is 320 wide); cairn: 0 for
// him alone, or a pebble count to stand him on a pile. The page around it loads the face's font.
export function figure({ mood = "wink", box = null, px = 1000, cairn = 0, background = null, glow = null } = {}) {
  return omettoSVG({ mood, size: px, cairn, box, square: true, background, glow, fontImport: false });
}

// A square box around him, tight enough to read at 48 px (the stone is about 89% of its width). A
// circle inscribed in it (most wallets and terminals cut the icon to a circle) keeps all of the stone,
// with a thin dark ring left around it. He sits a hair above the middle.
export const TOKEN_BOX = [OM.cx - 74, OM.cy - 72, 148, 148];

// ---------- headless Chrome ----------
export async function chrome() {
  const port = 9300 + Math.floor(Math.random() * 500);
  const prof = mkdtempSync(join(tmpdir(), "ometto-shot-"));
  const proc = spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", "--force-color-profile=srgb", `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, "about:blank"], { stdio: "ignore" });
  let target;
  for (let i = 0; i < 50 && !target; i++) {
    await sleep(200);
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page"); } catch { /* not up yet */ }
  }
  if (!target) throw new Error("Chrome did not start (set CHROME to its path)");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r));
  let id = 0;
  const pending = new Map(), errors = [];
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result || m); pending.delete(m.id); }
    if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.text);
    if (m.method === "Log.entryAdded" && m.params.entry.level === "error") errors.push(m.params.entry.text);
  });
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send("Runtime.enable"); await send("Log.enable"); await send("Page.enable");
  const evalJs = async (expr) => (await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result?.value;
  const { frameTree } = await send("Page.getFrameTree");
  return {
    errors,
    evalJs,
    // Lays `html` out at w x h and returns a PNG of exactly that size.
    async shoot(html, w, h, out) {
      await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false });
      await send("Page.navigate", { url: "about:blank" });
      await sleep(150);
      await send("Page.setDocumentContent", { frameId: frameTree.frame.id, html });
      // wait for the font stylesheet, then for the two faces the pictures use, then for the images
      await evalJs(`(async () => {
        await Promise.all([...document.querySelectorAll('link[rel=stylesheet]')].map((l) => l.sheet ? 0 : new Promise((r) => { l.onload = l.onerror = r; })));
        await Promise.all(['800 100px "M PLUS Rounded 1c"', '600 40px Figtree', '400 14px Figtree', '800 40px "JetBrains Mono"'].map((f) => document.fonts.load(f, 'Ometto $OMETTO >_0^-.xoO')));
        await document.fonts.ready;
        await Promise.all([...document.images].map((i) => i.decode().catch(() => null)));
        await new Promise((r) => setTimeout(r, 250));
      })()`);
      const shot = await send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: w, height: h, scale: 1 } });
      const png = Buffer.from(shot.data, "base64");
      if (out) writeFileSync(out, png);
      return png;
    },
    close() { ws.close(); proc.kill(); },
  };
}

const page = (body, css = "") => `<!doctype html><html><head><meta charset="utf-8">${FONTS}<style>
html, body { margin: 0; padding: 0; } body { overflow: hidden; } ${css}</style></head><body>${body}</body></html>`;

// ---------- the pictures ----------
export function tokenHtml({ mood, bg, halo = false }) {
  return page(figure({ mood, box: TOKEN_BOX, px: 1000, background: bg, glow: halo }), `body { width: 1000px; height: 1000px; background: ${bg}; } svg { display: block; }`);
}

export function ogHtml({ mood, bg }) {
  // him on the right, on a small cairn (17 pebbles, all lit); the name and one line on the left
  const fig = figure({ mood, cairn: 17, box: [12, 0, 296, 312], px: 520 });
  return page(`<main>
  <section class="words">
    <h1>Ometto</h1>
    <p class="line">Every validator adds a stone.</p>
    <p class="pills"><span class="pill">$OMETTO</span><span class="pill quiet">Solana, Alpenglow</span></p>
  </section>
  <div class="fig">${fig}</div>
</main>`, `
body { width: 1200px; height: 630px; background: ${bg}; color: ${INK}; font-family: Figtree, system-ui, sans-serif; }
main { position: relative; width: 1200px; height: 630px; }
.words { position: absolute; left: 92px; top: 0; bottom: 0; width: 600px; display: flex; flex-direction: column; justify-content: center; }
h1 { margin: 0; font-family: "M PLUS Rounded 1c", Figtree, sans-serif; font-weight: 800; font-size: 132px; line-height: 1; letter-spacing: -0.02em; }
.line { margin: 26px 0 0; font-size: 42px; line-height: 1.2; font-weight: 600; color: ${INK2}; max-width: 15ch; text-wrap: balance; }
.pills { margin: 40px 0 0; display: flex; gap: 14px; }
.pill { display: inline-flex; align-items: center; height: 52px; padding: 0 24px; border-radius: 999px; border: 2.5px solid ${ON_NEON};
  box-shadow: 0 3px 0 ${ON_NEON}; background: ${NEON}; color: ${ON_NEON}; font-family: "JetBrains Mono", monospace; font-weight: 800; font-size: 25px; }
.pill.quiet { background: #fff; color: ${INK2}; border-color: ${EDGE}; box-shadow: 0 3px 0 ${EDGE}; font-family: Figtree, sans-serif; font-weight: 600; font-size: 26px; }
.fig { position: absolute; right: 64px; top: 40px; width: 520px; height: 548px; }
.fig svg { display: block; }`);
}

// The token picture as a wallet shows it: 48 px, scaled down by the browser from the 1000 px file.
const imgTag = (png, size, round, extra = "") => `<img src="data:image/png;base64,${png.toString("base64")}" width="${size}" height="${size}" style="display:block;${round ? "border-radius:50%;" : ""}${extra}">`;
export function smallHtml(png) {
  return page(imgTag(png, 48, false), `body { width: 48px; height: 48px; }`);
}
export function checkHtml(png48, png) {
  const cell = (bg, round, label) => `<div class="c" style="background:${bg}">${imgTag(png, 48, round)}<span style="color:${bg === "#ffffff" ? INK2 : "#a8b2aa"}">${label}</span></div>`;
  return page(`<div class="row">${cell("#ffffff", false, "48, square")}${cell("#ffffff", true, "48, round")}${cell("#0e110f", true, "48, round, dark")}${cell("#0e110f", false, "48, square, dark")}</div>
<div class="big">${imgTag(png48, 384, false, "image-rendering:pixelated;")}<span>the 48 px file, enlarged 8x</span></div>`, `
body { width: 760px; height: 560px; background: #fff; font: 14px Figtree, sans-serif; }
.row { display: flex; } .c { width: 190px; height: 120px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; }
.big { display: flex; align-items: flex-end; gap: 18px; padding: 20px 24px; color: ${INK2}; }`);
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  const mood = opt("--mood", "wink"), ogMood = opt("--og-mood", mood), only = opt("--only", null);
  const tokenBg = opt("--token-bg", "#0e110f"), ogBg = opt("--og-bg", "#ffffff"), halo = args.includes("--token-halo");
  const C = await chrome();
  try {
    if (!only || only === "token") {
      const png = await C.shoot(tokenHtml({ mood, bg: tokenBg, halo }), 1000, 1000, join(SITE, "token.png"));
      const png48 = await C.shoot(smallHtml(png), 48, 48, join(SCREENS, "token-48.png"));
      await C.shoot(checkHtml(png48, png), 760, 560, join(SCREENS, "token-48-check.png"));
      console.log(`site/token.png ${png.length} bytes; site-tools/screens/token-48.png ${png48.length} bytes; site-tools/screens/token-48-check.png`);
    }
    if (!only || only === "og") {
      const png = await C.shoot(ogHtml({ mood: ogMood, bg: ogBg }), 1200, 630, join(SITE, "og.png"));
      const fonts = await C.evalJs(`[...new Set([...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family.replace(/"/g, '')))]`);
      console.log(`site/og.png ${png.length} bytes; fonts used: ${fonts.join(", ") || "NONE (the text fell back to a system font)"}`);
    }
    if (C.errors.length) console.log("errors:", C.errors);
  } finally { C.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
