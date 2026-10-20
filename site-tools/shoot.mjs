#!/usr/bin/env node
// Headless check of the page with the local Chrome, through the DevTools protocol (Node's own
// WebSocket, no dependencies): loads a URL at a given width, waits in real time, then reports console
// errors and sideways scroll and saves a full-page screenshot.
//
//   node site-tools/shoot.mjs <url> <width> <out.png> [--wait ms] [--night] [--click selector]
import { spawn } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [url, width, out] = process.argv.slice(2);
const opt = (k) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : undefined; };
const wait = Number(opt("--wait") || 6000);
const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const port = 9300 + Math.floor(Math.random() * 500);
const prof = mkdtempSync(join(tmpdir(), "rollcall-shot-"));
const proc = spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let target;
for (let i = 0; i < 50 && !target; i++) {
  await sleep(200);
  try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page"); } catch { /* not up yet */ }
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 0;
const pending = new Map();
const errors = [];
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result || m); pending.delete(m.id); }
  if (m.method === "Runtime.consoleAPICalled" && (m.params.type === "error" || m.params.type === "warning")) errors.push(m.params.type + ": " + m.params.args.map((a) => a.value ?? a.description).join(" "));
  if (m.method === "Runtime.exceptionThrown") errors.push("exception: " + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
  if (m.method === "Log.entryAdded" && m.params.entry.level === "error") errors.push("log: " + m.params.entry.text + " " + (m.params.entry.url || ""));
});
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJs = async (expr) => (await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result?.value;

const w = Number(width);
await send("Runtime.enable"); await send("Log.enable"); await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: w, height: w < 600 ? 812 : 900, deviceScaleFactor: 1, mobile: w < 600 });
if (process.argv.includes("--night")) await send("Page.addScriptToEvaluateOnNewDocument", { source: "try{localStorage.setItem('chamada-theme','night')}catch(e){}" });
await send("Page.navigate", { url });
await sleep(wait);
const click = opt("--click");
if (click) { await evalJs(`document.querySelector(${JSON.stringify(click)})?.click()`); await sleep(Number(opt("--after") || 2500)); }
const info = await evalJs(`({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight,
  headline: document.querySelector('#headline')?.textContent, figure: document.querySelector('#figure')?.innerText.replace(/\\n/g, ' / '),
  wide: [...document.querySelectorAll('body *')].filter(e => e.getBoundingClientRect().right > innerWidth + 0.5).slice(0, 5).map(e => e.tagName + '.' + e.className) })`);
const h = Math.min(info.height, 4000);
await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: w < 600 });
await sleep(400);
const shot = await send("Page.captureScreenshot", { format: "png" });
writeFileSync(out, Buffer.from(shot.data, "base64"));
console.log(JSON.stringify({ url, ...info, sideways: info.scrollWidth > info.width, errors }, null, 1));
ws.close();
proc.kill();
process.exit(0);
