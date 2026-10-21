// Ometto: the roll call of Alpenglow's genesis certificate, told by the top stone of a cairn.
// One pebble per validator in the certificate's rank map, biggest stake at the top just under him,
// lit when it signed. His face is typed in code (">_0"): asleep "-_-" before the list, waiting "o_o"
// with a blinking cursor mouth, holding his breath ">_<" during the switch, "0_0" when the
// certificate lands, "^_^" past 82% of the stake, and a wink ">_0" at the seal.
// States: preview (dry-run list) -> set (final list, countdown) -> switching -> live -> sealed;
// rehearsal replays devnet's certificate on a small cairn of 17 pebbles.
// The character is ometto.js; the cartoon stone man is in variants/ometto-cartoon/.
import { CONFIG } from "./config.js";
import { CERT_ACCOUNT, ALPENGLOW_FEATURE, FEATURE_PROGRAM, MIGRATION_OFFSET, parseCert, toCertBytes, rankList, stakeOf, base64ToBytes } from "./core/cert.js";
import { layout, Ometto } from "./ometto.js";
import * as sound from "./sound.js";

const $ = (s, r = document) => r.querySelector(s);
const SLOTS_PER_EPOCH = 432000;
const MAINNET = { listFixSlot: 459216000, switchEpoch: 1064, plannedMigration: 459648000 + MIGRATION_OFFSET, pace: 216.6, expect: 673 };
const PUBLIC_RPC = { "mainnet-beta": "https://api.mainnet-beta.solana.com", devnet: "https://api.devnet.solana.com" };
// ranks.json cannot exist before the list is fixed (slot 459,216,000), so it is only asked for after
// that slot; before it the dry run is the list. grid.json is only a fallback for when the chain is away.
const DATA = {
  rehearsal: { ranks: "/data/ranks-devnet.json", grid: "/data/grid-devnet.json" },
  mainnet: { ranks: "/data/ranks.json", dryRun: "/data/ranks-mainnet-e1062-dryrun.json", grid: "/data/grid.json" },
};
const WAKE = 82; // percent of the stake at which he wakes
// Mainnet slot from the wall clock, for when the chain cannot be asked: anchor measured 2026-10-19.
const slotFromClock = () => 458877441 + (Date.now() - Date.parse("2026-10-19T15:07:31Z")) / MAINNET.pace;
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const phone = () => matchMedia("(max-width: 900px)").matches;
const INTRO = "I'm AlpenSol. Every validator adds a stone.";

// ---------- small helpers ----------
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const int = (n) => Number(n).toLocaleString("en-US");
const short = (a) => (a && a.length > 12 ? a.slice(0, 4) + "…" + a.slice(-4) : a || "");
const pctText = (p) => (p >= 10 ? p.toFixed(1) : p >= 1 ? p.toFixed(2) : p >= 0.01 ? p.toFixed(3) : p > 0 ? "<0.01" : "0") + "%";
const explorer = (kind, id) => `https://explorer.solana.com/${kind}/${id}${S.network === "devnet" ? "?cluster=devnet" : ""}`;
const link = (href, text) => `<a href="${esc(href)}" target="_blank" rel="noopener">${esc(text)}</a>`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

function duration(ms) {
  if (!(ms > 0)) return "0 m";
  const s = Math.floor(ms / 1000), d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (d > 0) return `${d} d ${h} h ${String(m).padStart(2, "0")} m`;
  if (h > 0) return `${h} h ${String(m).padStart(2, "0")} m`;
  return `${m} m ${String(sec).padStart(2, "0")} s`;
}
const clock = (t) => new Date(t).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

async function getJson(url) {
  try {
    const r = await fetch(url, { cache: "no-cache" });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

// ---------- state ----------
const params = new URLSearchParams(location.search);
const view = params.get("view");
const S = {
  mode: view === "mainnet" ? "mainnet" : view === "rehearsal" ? "rehearsal" : CONFIG.rehearsal ? "rehearsal" : "mainnet",
  network: null, ranksDoc: null, ranks: [], total: 0n, gridDoc: null,
  chain: null, chainAt: 0, chainFails: 0,
  certBytes: null, cert: null, certSource: null, certNote: null,
  lit: 0, animating: false, shown: false, roll: false, woke: false, pendingSeal: false, loading: true,
  check: { state: "idle", result: null, error: null },
  record: null, open: null, selected: -1, marked: -1, focus: 0, run: 0,
  sayT: null, react: null, doze: 0,
};

// ---------- Ometto and his cairn ----------
const omettoEl = $("#ometto"), landEl = $("#land"), sunEl = $("#sun");
const ometto = new Ometto(omettoEl);
let squares = [];

// While the list is loading the cairn is drawn with the pebbles it will have (17 in rehearsal, about
// 673 on mainnet), all plain; once it is in, every validator is a pebble you can press.
function buildGrid() {
  const n = S.ranks.length;
  ometto.build(layout(n || (S.mode === "rehearsal" ? 17 : MAINNET.expect), n));
  squares = ometto.squares;
  squares.forEach((b, i) => b.setAttribute("tabindex", i === 0 ? "0" : "-1"));
  S.focus = 0;
  paintGrid();
}

function squareState(i) {
  if (S.shown && S.cert && i < S.lit) return S.cert.bits[i] ? "on" : "off";
  return phase() === "preview" ? "pre" : "wait";
}
const sqClass = (i, st) => "s" + (st === "wait" ? "" : " " + st) + (i === S.selected ? " sel" : "");
const setCls = (el, c) => { if (el.getAttribute("class") !== c) el.setAttribute("class", c); };

function paintGrid() {
  const p = phase();
  for (let i = 0; i < squares.length; i++) {
    const st = squareState(i), b = squares[i], r = S.ranks[i];
    if (!b || !r) continue;
    setCls(b, sqClass(i, st));
    const what = st === "on" ? "signed" : st === "off" ? "did not sign" : p === "preview" ? "preview" : "not answered yet";
    b.setAttribute("aria-label", `Rank ${i + 1}${r.name ? ", " + r.name : ""}, ${what}`);
  }
  renderLandLabel();
  updateCharacter();
}

// Lights the pebbles one by one in rank order: from the top of the pile down, as the alpenglow does.
// roll: the visitor asked for it ("Call the roll"): slower, and he says each name as it goes.
function lightUp({ roll = false } = {}) {
  const run = ++S.run;
  const n = S.ranks.length;
  S.shown = true; S.lit = 0; S.woke = false; S.roll = roll;
  if (reduceMotion || n === 0) {
    S.lit = n; S.animating = false; S.roll = false; S.woke = counts(n).pct >= WAKE;
    paintGrid(); afterLight(); return;
  }
  S.animating = true;
  const step = roll ? clamp(6000 / n, 6, 280) : clamp(3400 / n, 4, 180);
  const t0 = performance.now() + (roll ? 600 : 500);
  let lastHere = -1e9, lastName = -1e9;
  paintGrid();
  render();
  const frame = (t) => {
    if (run !== S.run) return;
    const target = clamp(Math.floor((t - t0) / step) + 1, 0, n);
    for (let i = S.lit; i < target; i++) {
      const on = S.cert.bits[i];
      setCls(squares[i], sqClass(i, on ? "on" : "off"));
      if (on && t - lastHere > (n <= 64 ? 0 : 160)) { lastHere = t; ometto.here(i); sound.tick(); }
    }
    if (roll && target > S.lit && t - lastName > (n <= 64 ? 0 : 150)) {
      lastName = t;
      const r = S.ranks[target - 1];
      say(r.name ? r.name : `Number ${target}`, Math.max(400, step * 2), { instant: true });
    }
    S.lit = target;
    if (!S.woke && counts(S.lit).pct >= WAKE) { S.woke = true; wake(); }
    renderSentence();
    updateCharacter();
    if (target < n) requestAnimationFrame(frame);
    else { S.animating = false; S.roll = false; paintGrid(); afterLight(); }
  };
  requestAnimationFrame(frame);
}

function afterLight() {
  if (S.sayT && S.sayT.instant) S.sayT = null; // drop the last name of a roll
  render();
  if (S.pendingSeal) sealed();
  else if (!S.woke && !reduceMotion) { ometto.sigh(); sound.sigh(); }
}

// ---------- the character ----------
// The face follows the state (a mood from FACES in ometto.js); a few events add a short reaction on top.
function react(mood, ms) { S.react = { mood, until: Date.now() + ms }; updateCharacter(); setTimeout(updateCharacter, ms + 30); }

function updateCharacter() {
  const p = phase();
  let mood, rise = 0, breath = "calm";
  if (S.shown && S.cert) {
    const k = counts(S.lit);
    rise = Math.min(1, k.pct / WAKE);
    if (p === "sealed" && !S.animating) mood = "wink";
    else if (k.pct >= WAKE) mood = "happy";
    else if (S.animating) mood = "look";
    else mood = "low";
  } else if (p === "switching") { mood = "hold"; breath = "hold"; rise = 0.1; }
  else if (p === "set") mood = Date.now() < S.doze ? "sleep" : "wait";
  else mood = "sleep"; // the preview list, or still loading: still night
  if (S.react && Date.now() < S.react.until) mood = S.react.mood;
  ometto.setMood(mood);
  ometto.setBreath(breath);
  landEl.style.setProperty("--rise", rise.toFixed(3));
  sunEl.classList.toggle("up", !!S.certBytes);
}

function wake() {
  ometto.hop();
  sound.wake();
  if (!S.roll) say("Morning. I am here.", 2600);
}

// The seal: a wink, and a little hop if it landed in the first block.
function sealed() {
  if (S.animating) { S.pendingSeal = true; return; }
  S.pendingSeal = false;
  updateCharacter();
  if (S.record.firstBlock) ometto.hop();
  sound.seal();
  say(S.record.firstBlock ? "Sealed in the first block. I will remember." : "Sealed. I will remember.", 3600);
}

// The line in the bubble: a short reaction when something just happened, else what the state is.
function baseLine() {
  const p = phase(), reh = S.mode === "rehearsal";
  if (S.shown && S.cert) {
    const k = counts(S.lit);
    if (S.animating) return k.pct >= WAKE ? "Morning. I am here." : "Oh. Light.";
    if (p === "sealed") return S.record.firstBlock ? "Sealed in the first block. I will remember." : "Sealed. I will remember.";
    return k.pct >= WAKE ? "Morning. Most of them are here." : "Not everyone woke.";
  }
  return {
    empty: S.loading ? "…" : "No roll yet. I will wait.",
    preview: "Not yet. Still night.",
    set: reh ? "Shh. A rehearsal, with devnet's stones." : "Not yet. Still night.",
    switching: "Holding my breath.",
  }[p] || "…";
}

// The line is typed in like the face: what is there backspaces away (quickly), the new line types
// in. The full line goes to a hidden live region at once, so a screen reader hears it whole.
let shownLine = null, sayTimer = 0, typeRun = 0;
const sayEl = $("#say"), sayLive = $("#say-live");
function typeLine(line, instant) {
  const run = ++typeRun;
  if (reduceMotion || instant) { sayEl.classList.remove("typing"); sayEl.textContent = line; return; }
  let cur = sayEl.textContent;
  sayEl.classList.add("typing");
  const tick = () => {
    if (run !== typeRun) return;
    const back = !line.startsWith(cur);
    if (back) cur = cur.slice(0, Math.max(0, cur.length - Math.max(1, Math.ceil(cur.length / 7))));
    else if (cur.length < line.length) cur = line.slice(0, cur.length + 1);
    else { setTimeout(() => { if (run === typeRun) sayEl.classList.remove("typing"); }, 500); return; }
    sayEl.textContent = cur;
    setTimeout(tick, back ? 16 : 24);
  };
  tick();
}
function renderVoice(force) {
  const t = S.sayT && Date.now() < S.sayT.until ? S.sayT : null;
  const line = t ? t.text : baseLine();
  if (line === shownLine && !force) return;
  shownLine = line;
  sayLive.setAttribute("aria-live", S.roll ? "off" : "polite");
  if (sayLive.textContent !== line) sayLive.textContent = line;
  typeLine(line, t && t.instant);
}
function say(text, ms = 3000, { instant = false } = {}) {
  S.sayT = { text, until: Date.now() + ms, instant };
  clearTimeout(sayTimer);
  sayTimer = setTimeout(() => renderVoice(), ms + 30);
  renderVoice(!instant);
}

// Idle life: blinks when his eyes are round, now and then a pebble settles with a small wobble, and
// while the list is set and the switch is still far off he dozes now and then ("-_-", a floating z).
function blinkLoop() {
  ometto.blink();
  setTimeout(blinkLoop, 2600 + Math.random() * 4200);
}
function dozeLoop() {
  const t = switchTarget(), now = chainSlotNow();
  const far = S.mode === "mainnet" && t && now != null && (t.slot - now) * (S.chain?.msPerSlot || MAINNET.pace) > 30 * 60000;
  if (!document.hidden && phase() === "set" && far && !(S.react && Date.now() < S.react.until)) {
    S.doze = Date.now() + 6500;
    updateCharacter();
    setTimeout(updateCharacter, 6600);
  }
  setTimeout(dozeLoop, 22000 + Math.random() * 16000);
}
function wobbleLoop() {
  if (!document.hidden && !S.animating && !reduceMotion) ometto.wobble();
  setTimeout(wobbleLoop, 3800 + Math.random() * 5200);
}

// ---------- phases ----------
function isPreviewList() {
  const d = S.ranksDoc;
  return !!d && S.mode === "mainnet" && (d.dryRun === true || d.final === false);
}

function chainSlotNow() {
  const c = S.chain;
  if (!c || !c.slot) return null;
  return c.slot + (performance.now() - S.chainAt) / (c.msPerSlot || MAINNET.pace);
}

// Estimated migration slot: from the feature account when it is set, else the plan (epoch 1064 + 5000).
function switchTarget() {
  const c = S.chain;
  if (c && c.feature && c.feature.migrationSlot) return { slot: c.feature.migrationSlot, sure: true };
  const now = chainSlotNow();
  if (c && c.feature && c.feature.state === "pending" && now != null) return { slot: (Math.floor(now / SLOTS_PER_EPOCH) + 1) * SLOTS_PER_EPOCH + MIGRATION_OFFSET, sure: false };
  if (S.network === "mainnet-beta" && (now == null || now < MAINNET.plannedMigration - MIGRATION_OFFSET)) return { slot: MAINNET.plannedMigration, sure: false };
  return null;
}

function phase() {
  if (!S.ranks.length) return "empty";
  if (S.record && S.record.sealed) return "sealed";
  if (S.shown) return "live";
  if (isPreviewList()) return "preview";
  if (S.mode === "mainnet") {
    const t = switchTarget(), now = chainSlotNow();
    if (t && now != null && now >= t.slot) return "switching";
  }
  return "set";
}

// ---------- reading the chain ----------
async function readChain() {
  const api = await getJson(`/api/cert?network=${encodeURIComponent(S.network)}`);
  if (api && api.network === S.network) return api;
  return readChainDirect(); // the function is away (a plain static preview): ask a public node
}

async function rpc(method, params) {
  const r = await fetch(PUBLIC_RPC[S.network], { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message);
  return j.result;
}

async function readChainDirect() {
  try {
    const [multi, slot, perf] = await Promise.all([
      rpc("getMultipleAccounts", [[CERT_ACCOUNT, ALPENGLOW_FEATURE], { encoding: "base64", commitment: "processed" }]),
      rpc("getSlot", [{ commitment: "processed" }]),
      rpc("getRecentPerformanceSamples", [10]).catch(() => []),
    ]);
    const [acc, feat] = multi.value;
    let cert = null;
    if (acc && acc.data[0]) { try { const b = base64ToBytes(acc.data[0]); parseCert(b); cert = { source: "account", bytes: acc.data[0] }; } catch { /* not a certificate */ } }
    let feature = { state: "unscheduled", migrationSlot: null };
    if (feat && feat.owner === FEATURE_PROGRAM) {
      const d = base64ToBytes(feat.data[0]);
      if (d[0] === 1) { let n = 0; for (let i = 8; i >= 1; i--) n = n * 256 + d[i]; feature = { state: "active", activatedAt: n, migrationSlot: n + MIGRATION_OFFSET }; }
      else feature = { state: "pending", migrationSlot: null };
    }
    const slots = perf.reduce((a, x) => a + x.numSlots, 0), secs = perf.reduce((a, x) => a + x.samplePeriodSecs, 0);
    return { network: S.network, rpc: "browser", slot, msPerSlot: slots ? (secs * 1000) / slots : null, feature, cert, record: null, account: { dataLen: acc ? base64ToBytes(acc.data[0]).length : 0 } };
  } catch { return null; }
}

function takeCert(bytes, source, note) {
  if (S.certBytes) return;
  try {
    const raw = toCertBytes(bytes);
    S.cert = parseCert(raw);
    S.certBytes = raw;
    S.certSource = source;
    S.certNote = note || null;
  } catch (e) { console.warn("certificate did not parse:", e.message); return; }
  // The certificate is here: eyes wide ("0_0"), a start, a call, then the light runs down the pile.
  S.sayT = null;
  react("gasp", 1300);
  ometto.hop();
  sound.call();
  lightUp();
  render();
}

function takeRecord(rec) {
  if (!rec) return;
  const was = S.record && S.record.sealed;
  S.record = rec;
  if (!was && rec.sealed) { paintGrid(); render(); sealed(); }
}

function applyChain(c) {
  if (c) {
    S.chain = c; S.chainAt = performance.now(); S.chainFails = 0;
    if (c.cert && c.cert.bytes && !S.certBytes) {
      const where = c.cert.source === "account" ? "the certificate account" : "getAgGenesisCert";
      takeCert(c.cert.bytes, S.network === "devnet" ? where + ", devnet" : where, c.cert.note);
    }
    if (c.record) takeRecord(c.record);
  } else S.chainFails++;
}

async function poll(run) {
  if (run !== S.pollRun) return;
  const c = await readChain();
  if (run !== S.pollRun) return;
  const before = phase();
  applyChain(c);
  // The chain is away: fall back to the grid file the tools wrote, once.
  if (!c && S.mode === "mainnet" && S.chainFails >= 2 && !S.gridTried) {
    S.gridTried = true;
    const g = await getJson(DATA.mainnet.grid);
    if (g && g.network === S.network) {
      S.gridDoc = g;
      if (g.certBase64) takeCert(g.certBase64, "grid.json", g.note);
      if (g.record && g.record.sealed) takeRecord({ ...g.record, sealTx: g.sealTx });
    }
  }
  if (phase() !== before) paintGrid();
  render();
  maybeWarm();
  setTimeout(() => poll(run), nextDelay());
}

function nextDelay() {
  if (S.chainFails > 3) return 15000;
  if (S.record && S.record.sealed) return 60000;
  if (S.certBytes) return S.network === "devnet" && !CONFIG.devnet?.mint ? 60000 : 4000;
  const t = switchTarget(), now = chainSlotNow();
  if (!t || now == null) return 15000;
  const left = (t.slot - now) * (S.chain?.msPerSlot || MAINNET.pace);
  if (left > 30 * 60000) return 30000;
  if (left > 3 * 60000) return 5000;
  return 1000;
}

// ---------- the visitor's own check ----------
let worker = null;
const workerUrl = () => new URL("./core/verify-worker.js", import.meta.url);
function verifyInWorker(cert, ranks) {
  return new Promise((resolve, reject) => {
    try {
      if (!worker) worker = new Worker(workerUrl(), { type: "module" });
    } catch (e) { reject(e); return; }
    const id = Math.random();
    const onMsg = (e) => {
      if (!e.data || e.data.id !== id) return;
      worker.removeEventListener("message", onMsg);
      worker.removeEventListener("error", onErr);
      e.data.ok ? resolve(e.data.result) : reject(new Error(e.data.error));
    };
    const onErr = (e) => { worker.removeEventListener("message", onMsg); worker.removeEventListener("error", onErr); worker = null; reject(e.error || new Error("worker failed")); };
    worker.addEventListener("message", onMsg);
    worker.addEventListener("error", onErr);
    worker.postMessage({ id, cert, ranks });
  });
}

async function runCheck() {
  if (!S.certBytes || S.check.state === "running") return;
  S.check = { state: "running", result: null, error: null };
  S.open = "check";
  ometto.lookAtElement($('[data-place="check"]'), 3000);
  S.react = { mood: "check", until: Date.now() + 60000 };
  say("Let me see.", 60000);
  render();
  const ranks = { network: S.ranksDoc.network, shredVersion: S.ranksDoc.shredVersion, gridHash: S.ranksDoc.gridHash, ranks: S.ranks };
  const t0 = performance.now();
  let result;
  try {
    result = await verifyInWorker(S.certBytes, ranks).catch(async () => {
      const { verifyGrid } = await import("./core/verify.js");
      return verifyGrid(S.certBytes, ranks);
    });
    result.wall = Math.round(performance.now() - t0);
    S.check = { state: result.verified ? "ok" : "fail", result, error: null };
  } catch (e) {
    S.check = { state: "fail", result: null, error: e.message || String(e) };
  }
  // a warmed check takes a few dozen milliseconds: let his "o_O" be seen for a moment first
  const spent = performance.now() - t0;
  if (spent < 900 && !reduceMotion) { const done = S.check; S.check = { state: "running", result: null, error: null }; await sleep(900 - spent); S.check = done; }
  // the check's own reaction lasts a moment, then the face goes back to the state's
  if (S.check.state === "ok") { react("happy", 3000); ometto.hop(); say("It holds. You checked.", 5000); }
  else { react("fail", 3600); ometto.sigh(); sound.sigh(); say("That did not add up.", 5000); }
  render();
}

// ---------- words ----------
function counts(upTo) {
  let signed = 0, stake = 0n;
  const n = Math.min(upTo, S.cert ? S.cert.bits.length : 0, S.ranks.length);
  for (let i = 0; i < n; i++) if (S.cert.bits[i]) { signed++; stake += stakeOf(S.ranks[i]); }
  const p = S.total > 0n ? Number((stake * 1000000n) / S.total) / 10000 : 0;
  return { signed, pct: p };
}

const isTest = () => (S.certNote && /fake|test/i.test(S.certNote)) || (S.record && S.record.note && /fake|test/i.test(S.record.note));
function labels() {
  const out = [];
  if (S.mode === "rehearsal") out.push("Rehearsal, devnet");
  else if (phase() === "preview") out.push("Preview");
  if (isTest()) out.push("Test data");
  return out.map((l) => `<span class="lab">${esc(l)}</span>`).join("");
}

// A label on the figure itself, so a picture of him never passes for the real morning.
function renderLandLabel() {
  const el = $("#land-lab"), n = S.ranks.length || (S.mode === "rehearsal" ? 17 : 0);
  const text = S.mode === "rehearsal" ? `Rehearsal: ${n} stones from devnet` : isTest() ? "Test data" : phase() === "preview" ? "Preview list" : "";
  el.textContent = text;
  el.hidden = !text;
}

function renderSentence() {
  const p = phase(), n = S.ranks.length, el = $("#sentence"), lab = labels();
  if (p === "empty") { el.innerHTML = S.loading ? "" : "No validator list is published yet."; return; }
  if (S.shown && S.cert) {
    const c = counts(S.lit);
    let tail = "";
    if (p === "sealed" && !S.animating) tail = ` Sealed in slot <b>${int(S.record.sealSlot)}</b>${S.record.firstBlock ? ", the first block" : ""}.`;
    el.innerHTML = `${lab}<b>${int(c.signed)}</b> of ${int(n)} stones signed, <b>${pctText(c.pct)}</b> of the stake.${tail}`;
    return;
  }
  const now = chainSlotNow();
  if (p === "preview") {
    const left = now != null ? (MAINNET.listFixSlot - now) * (S.chain?.msPerSlot || MAINNET.pace) : null;
    el.innerHTML = `${lab}<b>${int(n)}</b> stones on the preview list. ${left > 0 ? `The real roll is fixed in about <b>${duration(left)}</b><span class="est">estimate</span>` : now != null ? "The real roll is being fixed now." : ""}`;
    return;
  }
  if (S.mode === "rehearsal") {
    el.innerHTML = `${lab}<b>${int(n)}</b> stones from devnet's roll. Devnet switched already; I replay its answer.`;
    return;
  }
  if (p === "switching") { el.innerHTML = `${lab}Solana is switching. The certificate can land any second.`; return; }
  const t = switchTarget();
  if (!t) { el.innerHTML = `${lab}<b>${int(n)}</b> stones on the roll. The switch is not scheduled yet.`; return; }
  if (now == null) { el.innerHTML = `${lab}<b>${int(n)}</b> stones on the roll. First light at slot <b>${int(t.slot)}</b><span class="est">estimate</span>`; return; }
  const left = (t.slot - now) * (S.chain.msPerSlot || MAINNET.pace);
  el.innerHTML = `${lab}<b>${int(n)}</b> stones on the roll. First light in about <b>${duration(left)}</b>, around ${esc(clock(Date.now() + left))}<span class="est">estimate</span>`;
}

function renderActions() {
  const busy = S.animating;
  $("#check-btn").hidden = !S.certBytes || busy;
  $("#check-btn").textContent = S.check.state === "ok" ? "Checked: valid" : S.check.state === "running" ? "Checking…" : "Check it yourself";
  $("#check-btn").disabled = S.check.state === "running";
  $("#roll-btn").hidden = !S.certBytes || busy;
  $("#find-q").disabled = !S.ranks.length;
}

function setPlace(name, val, cls) {
  const el = $(`[data-place="${name}"]`);
  el.classList.toggle("done", cls === "done");
  el.classList.toggle("fail", cls === "fail");
  $("#v-" + name).textContent = val;
}

function renderPlaces() {
  const p = phase(), reh = S.mode === "rehearsal", n = S.ranks.length;
  setPlace("list", !n ? "" : p === "preview" ? "preview" : reh ? `${n}, devnet` : `${int(n)}, set`, n && p !== "preview" ? "done" : null);
  setPlace("answer", S.certBytes ? `${counts(S.cert.bits.length).signed} of ${S.cert.bits.length}` : p === "switching" ? "any second" : "waiting", S.certBytes ? "done" : null);
  const ch = S.check.state;
  setPlace("check", ch === "ok" ? "valid" : ch === "fail" ? "did not pass" : ch === "running" ? "checking" : S.certBytes ? "ready" : "later", ch === "ok" ? "done" : ch === "fail" ? "fail" : null);
  const r = S.record;
  setPlace("seal", r && r.sealed ? (r.firstBlock ? "first block" : "sealed") : "open", r && r.sealed ? "done" : null);
  for (const el of document.querySelectorAll("[data-place]")) el.classList.toggle("open", S.open === el.dataset.place);
}

// What he says when you press a place, and the longer text behind it.
const PLACES = {
  list: { title: "The list", line: () => "My cairn. Biggest on top." },
  answer: { title: "The answer", line: () => (S.certBytes ? "That light? One signature." : "Light comes as one signature.") },
  check: { title: "Your check", line: () => "Do not trust me. Check." },
  seal: { title: "The seal", line: () => (S.record && S.record.sealed ? "Kept for good." : "Not sealed yet.") },
  about: { title: "Who I am", line: () => INTRO },
};

function panelHtml(name) {
  const d = S.ranksDoc || {}, n = S.ranks.length, c = S.chain, reh = S.mode === "rehearsal";
  if (name === "list") {
    return `<p>Everyone Solana counts at the switch: a validator with a BLS key, stake and enough balance. Each one is a stone in my cairn, the biggest stake just under me, the smallest at the base.</p>
      <p><b>${int(n)}</b> stones on ${esc(d.network || S.network)}.${d.takenAtSlot ? ` Taken at slot ${int(d.takenAtSlot)}.` : ""}${d.gridHash ? ` Its fingerprint starts <code>${esc(d.gridHash.slice(0, 12))}</code>.` : ""}</p>
      ${isPreviewList() ? `<p>This is a preview. The list that counts is fixed at slot ${int(MAINNET.listFixSlot)}, the start of epoch 1063.</p>` : ""}
      ${reh ? `<p>Rehearsal list, built from today's devnet stakes. On mainnet my cairn is ${int(MAINNET.expect)} stones.</p>` : ""}
      ${S.ranksUrl ? `<p>${link(S.ranksUrl, "The list as a file")}</p>` : ""}`;
  }
  if (name === "answer") {
    if (S.cert) {
      const k = counts(S.cert.bits.length);
      const mismatch = S.cert.bits.length !== n ? `<p>The certificate has ${int(S.cert.bits.length)} ranks; this list has ${int(n)}.</p>` : "";
      return `<p>At the switch the validators signed one certificate together. It sits in a fixed account and stays there.</p>
        <p><b>${int(k.signed)} of ${int(S.cert.bits.length)}</b> signed, ${pctText(k.pct)} of the stake, for the block at slot ${int(S.cert.slot)}. Read from ${esc(S.certSource || "")}.</p>
        ${S.certNote && /fake|test/i.test(S.certNote) ? `<p><span class="lab">Test data</span>${esc(S.certNote)}</p>` : ""}
        <p>${link(explorer("address", CERT_ACCOUNT), "The certificate account")}</p>${mismatch}`;
    }
    const t = switchTarget(), f = c && c.feature, now = chainSlotNow();
    const sched = f ? (f.state === "active" ? "The switch is active on chain." : f.state === "pending" ? "The switch is scheduled on chain." : "The switch is not on chain yet.") : "";
    return `<p>At the switch the validators sign one certificate together. It lands in a fixed account and stays there.</p>
      <p>${t ? `First light at slot <b>${int(t.slot)}</b>${t.sure ? "" : ", an estimate"}.` : ""}${now != null ? ` Now slot ${int(Math.floor(now))}${c.msPerSlot ? `, ${c.msPerSlot.toFixed(1)} ms a slot` : ""}.` : ""} ${sched}</p>
      <p>${link(explorer("address", CERT_ACCOUNT), "The certificate account")}, empty so far.</p>`;
  }
  if (name === "check") {
    const st = S.check, r = st.result;
    let out = `<p>Your browser adds up the public keys of the lit stones and tests them against the certificate's one signature. No server says yes for you.</p>`;
    if (!S.certBytes) return out + `<p>Ready once the certificate lands.</p>`;
    if (st.state === "idle") return out + `<div class="row"><button class="pill pill-main" type="button" data-act="check">Run the check</button></div>`;
    if (st.state === "running") return out + `<div class="verdict"><span class="sq"></span><span>Checking in this browser…</span></div>`;
    if (!r) return out + `<div class="verdict bad"><span class="sq"></span><span>The check could not run: ${esc(st.error || "unknown error")}</span></div>`;
    out += r.verified
      ? `<div class="verdict ok"><span class="sq"></span><span>Valid. ${int(r.signerCount)} keys signed this exact message.</span></div>`
      : `<div class="verdict bad"><span class="sq"></span><span>Did not pass: ${esc(r.reason || "unknown")}.</span></div>`;
    const listLine = r.gridHashOk === true ? "The list matches its fingerprint." : r.gridHashOk === false ? "The list does not match its fingerprint." : "The list has no fingerprint to compare.";
    const recLine = S.record && S.record.gridHash ? (S.record.gridHash === r.gridHash ? " The coin's record holds the same fingerprint." : " The coin's record holds a different fingerprint.") : "";
    out += `<details><summary>What was checked</summary>
      <p>The message <code>${esc(r.message)}</code>, shred version ${esc(r.shredVersion ?? "")}, hashed to BLS12-381 G2 with the proof-of-possession suite.</p>
      <p>${listLine}${recLine} It took ${int(r.wall ?? r.ms)} ms here.</p></details>
      <div class="row"><button class="pill" type="button" data-act="check">Run again</button></div>`;
    return out;
  }
  if (name === "seal") {
    const r = S.record;
    let out = `<p>Anyone can copy the certificate into the coin's record, once. If that lands in the first Alpenglow block, the record says so for good.</p>`;
    if (r && r.sealed) {
      out += `<p>Sealed in slot <b>${int(r.sealSlot)}</b>, after slot ${int(r.parentSlot)}. ${r.firstBlock ? "That is the first Alpenglow block." : "Not the first block, and that is fine."}</p>
        <p>Sealed by ${link(explorer("address", r.sealer), short(r.sealer))}.${r.sealTx ? ` ${link(explorer("tx", r.sealTx), "The transaction")}.` : ""}${r.address ? ` ${link(explorer("address", r.address), "The record")}.` : ""}</p>
        ${r.note && /fake|test/i.test(r.note) ? `<p><span class="lab">Test data</span>${esc(r.note)}</p>` : ""}`;
    } else if (r && r.address) {
      out += `<p>${link(explorer("address", r.address), "The record")} ${r.exists ? "is not sealed yet." : "is not created yet."}</p>`;
    } else out += `<p>Not sealed yet. The record's address shows here once the coin exists.</p>`;
    return out;
  }
  if (name === "about") {
    return `<p>I'm AlpenSol. On mountains, people who pass a cairn on a trail or a summit add one stone to it.</p>
      <p>Here the passers are Solana's validators, on the morning Alpenglow starts. Alpenglow is the new way Solana agrees on blocks, named after the glow on summits just before sunrise. At the switch, the validators sign one certificate together.</p>
      <p>Each of them is one stone in the cairn under me, the biggest stake at the top. Lit, it signed. Dark, it did not. I am the stone on top. When ${WAKE}% of the stake has signed, I wake.</p>
      <p>Do not take my word for it. The certificate is on chain, and the check runs in your browser.</p>`;
  }
  return "";
}

const panelEl = $("#panel");
function renderPanel() {
  if (!S.open || !PLACES[S.open]) { panelEl.hidden = true; return; }
  $("#panel-title").textContent = PLACES[S.open].title;
  $("#panel-body").innerHTML = panelHtml(S.open);
  panelEl.hidden = false;
}

function openPlace(name, el) {
  if (S.open === name) { S.open = null; render(); return; }
  S.open = name;
  render();
  if (el) ometto.lookAtElement(el);
  if (ometto.mood === "sleep") react("peek", 1800); // one sleepy look
  say(PLACES[name].line(), 3600);
  if (phone()) setTimeout(() => panelEl.scrollIntoView({ block: "nearest", behavior: reduceMotion ? "auto" : "smooth" }), 60);
}

function render() {
  renderVoice();
  renderSentence();
  renderActions();
  renderPlaces();
  renderPanel();
  renderLandLabel();
  if (S.selected >= 0) renderCard();
  updateCharacter();
}

// ---------- pressing a stone: the call and the answer ----------
const card = $("#card");
function renderCard() {
  const i = S.selected, r = S.ranks[i];
  if (!r) { card.hidden = true; return; }
  const st = squareState(i);
  const state = st === "on" ? "Here. It signed." : st === "off" ? "Silent. It did not sign." : phase() === "preview" ? "On the preview list." : "Not called yet.";
  const icon = r.icon && /^(data:image\/|(?!https?:|\/\/)[\w./-]+\.(png|jpe?g|webp|gif)$)/i.test(r.icon) ? r.icon : null; // local files only, never hot-linked
  const letter = (r.name || "").trim().charAt(0).toUpperCase() || "#";
  const share = r.stakePct != null ? Number(r.stakePct) : S.total > 0n ? Number((stakeOf(r) * 1000000n) / S.total) / 10000 : 0;
  card.innerHTML = `<div class="card-head">
      <span class="avatar">${icon ? `<img src="${esc(icon)}" alt="">` : esc(letter)}</span>
      <div><p class="card-name">${r.name ? esc(r.name) : "No name given"}</p><p class="card-note">${r.name ? "name is self-declared" : "this validator published no name"}</p></div>
      <button class="round round-small card-close" type="button" data-act="close" aria-label="Close"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
    </div>
    <p class="card-state"><span class="sq ${st === "on" ? "on" : st === "off" ? "off" : ""}"></span>${state}</p>
    <p class="card-line">Stone <b>${int(i + 1)}</b> of ${int(S.ranks.length)}, <b>${pctText(share)}</b> of the stake.</p>
    <p class="card-line">Vote account <span class="addr">${esc(short(r.vote))}</span><button class="link-btn" type="button" data-act="copy" data-v="${esc(r.vote)}">copy</button><a href="${esc(explorer("address", r.vote))}" target="_blank" rel="noopener">explorer</a></p>`;
  card.hidden = false;
}

function select(i, { call = false } = {}) {
  const prev = S.selected;
  S.selected = i;
  if (squares[prev]) squares[prev].classList.remove("sel");
  if (squares[i]) squares[i].classList.add("sel");
  ometto.ring("sel", i);
  if (i < 0) { card.hidden = true; return; }
  renderCard();
  if (call) callName(i);
}

let callRun = 0;
function callName(i) {
  const run = ++callRun, r = S.ranks[i], name = r.name ? r.name : `Number ${i + 1}`;
  ometto.lookAtSquare(i, 3200);
  ometto.wobble(i);
  react("look", 800);
  sound.call();
  say(name + "?", 2400);
  const st = squareState(i), p = phase();
  setTimeout(() => {
    if (run !== callRun) return;
    if (st === "on") { react("happy", 1800); ometto.here(i); sound.here(); say(`${name}: here.`, 2600); }
    else if (st === "off") { react("low", 1800); ometto.sigh(); say("No answer.", 2400); }
    else say(p === "preview" ? "Not yet. Still stacking." : "They answer at first light.", 3000);
  }, 800);
}

// Pressing Ometto himself: a wink.
const OM_LINES = ["That's me. The top stone.", "Hi. I sit on top.", "Every stone holds me up."];
let omLine = 0;
function pressOmetto() {
  react("wink", 1700);
  ometto.hop();
  sound.here();
  say(OM_LINES[omLine++ % OM_LINES.length], 2400);
}

function focusSquare(i) {
  if (!squares.length) return;
  i = clamp(i, 0, squares.length - 1);
  if (squares[S.focus]) squares[S.focus].setAttribute("tabindex", "-1");
  S.focus = i;
  squares[i].setAttribute("tabindex", "0");
  squares[i].focus();
}

omettoEl.addEventListener("click", (e) => {
  if (e.target.closest(".om")) { pressOmetto(); return; }
  const b = e.target.closest(".s");
  if (!b) return;
  const i = Number(b.dataset.i);
  if (squares[S.focus]) squares[S.focus].setAttribute("tabindex", "-1");
  S.focus = i; b.setAttribute("tabindex", "0");
  if (S.selected === i) select(-1);
  else select(i, { call: true });
});
omettoEl.addEventListener("keydown", (e) => {
  if (e.target.closest(".om") && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); pressOmetto(); return; }
  const b = e.target.closest(".s");
  if (!b) return;
  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); b.dispatchEvent(new MouseEvent("click", { bubbles: true })); return; }
  // move from the pebble that has focus, whatever put it there
  if (squares[S.focus] !== b) { if (squares[S.focus]) squares[S.focus].setAttribute("tabindex", "-1"); S.focus = Number(b.dataset.i); b.setAttribute("tabindex", "0"); }
  const moves = { ArrowRight: () => ometto.side(S.focus, 1), ArrowLeft: () => ometto.side(S.focus, -1), ArrowDown: () => ometto.neighbour(S.focus, 1), ArrowUp: () => ometto.neighbour(S.focus, -1),
    PageDown: () => S.focus + 1, PageUp: () => S.focus - 1, Home: () => 0, End: () => squares.length - 1 };
  if (e.key in moves) {
    e.preventDefault();
    focusSquare(moves[e.key]());
    if (S.selected >= 0) select(S.focus);
  }
});
omettoEl.addEventListener("focusin", (e) => {
  const b = e.target.closest && e.target.closest(".s");
  if (b && b.matches(":focus-visible")) ometto.ring("focus", Number(b.dataset.i));
});
omettoEl.addEventListener("focusout", () => ometto.ring("focus", -1));
// The small tag on hover. Touch gets it for a moment too.
let tagTimer = 0;
omettoEl.addEventListener("pointerover", (e) => {
  const b = e.target.closest(".s");
  if (!b) return;
  const i = Number(b.dataset.i), r = S.ranks[i];
  if (!r) return;
  const st = squareState(i);
  ometto.showTag(i, `${i + 1}. ${r.name || "no name"}${st === "on" ? ", here" : st === "off" ? ", silent" : ""}`);
  if (e.pointerType !== "touch") ometto.ring("hover", i);
  clearTimeout(tagTimer);
  if (e.pointerType === "touch") tagTimer = setTimeout(() => ometto.hideTag(), 1600);
});
omettoEl.addEventListener("pointerleave", () => { ometto.hideTag(); ometto.ring("hover", -1); });

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (S.selected >= 0) { const i = S.selected; select(-1); squares[i]?.focus(); }
  else if (S.open) { S.open = null; render(); }
});

document.addEventListener("click", async (e) => {
  const place = e.target.closest("[data-place]");
  if (place) { openPlace(place.dataset.place, place); return; }
  const a = e.target.closest("[data-act]");
  if (!a) return;
  const act = a.dataset.act;
  if (act === "close") { const i = S.selected; select(-1); squares[i]?.focus(); }
  if (act === "close-panel") { S.open = null; render(); }
  if (act === "check") runCheck();
  if (act === "next" && found.length) { foundAt = (foundAt + 1) % found.length; showFound(); }
  if (act === "copy") {
    try { await navigator.clipboard.writeText(a.dataset.v); a.textContent = "copied"; setTimeout(() => (a.textContent = "copy"), 1400); } catch { /* clipboard refused */ }
  }
});

$("#check-btn").addEventListener("click", runCheck);
$("#roll-btn").addEventListener("click", () => {
  if (!S.certBytes || S.animating) return;
  say("From the top, then.", 900);
  sound.call();
  lightUp({ roll: true });
});

// ---------- find your validator ----------
const findIn = $("#find-q"), findOut = $("#find-out");
let findTimer = 0, found = [], foundAt = 0;
function mark(i) {
  S.marked = i;
  ometto.mark(i);
}
function doFind() {
  const q = findIn.value.trim();
  if (q.length < 2 || !S.ranks.length) { found = []; mark(-1); findOut.textContent = ""; return; }
  const ql = q.toLowerCase();
  found = [];
  S.ranks.forEach((r, i) => { if (r.vote === q || r.node === q) found.push(i); });
  if (!found.length) {
    S.ranks.forEach((r, i) => {
      if ((r.name && r.name.toLowerCase().includes(ql)) || (q.length >= 5 && (r.vote.startsWith(q) || (r.node || "").startsWith(q)))) found.push(i);
    });
  }
  foundAt = 0;
  showFound();
}
function showFound() {
  if (!found.length) {
    mark(-1);
    findOut.innerHTML = `<span>No stone by that name in the cairn.</span>`;
    react("low", 1800);
    say("I do not know that one.", 2600);
    return;
  }
  const i = found[foundAt], r = S.ranks[i];
  mark(i);
  findOut.innerHTML = `<span><b>${esc(r.name || "No name")}</b>, stone ${int(i + 1)}.</span>${found.length > 1 ? `<button class="pill pill-small" type="button" data-act="next">Next, ${foundAt + 1} of ${found.length}</button>` : ""}`;
  if (S.selected !== i) select(i, { call: true });
  else callName(i);
}
findIn.addEventListener("input", () => { clearTimeout(findTimer); findTimer = setTimeout(doFind, 450); });
$("#find").addEventListener("submit", (e) => { e.preventDefault(); clearTimeout(findTimer); doFind(); });

// ---------- top bar: theme, sound, mode, coin ----------
$("#theme").addEventListener("click", () => {
  const night = document.documentElement.dataset.theme !== "night";
  document.documentElement.dataset.theme = night ? "night" : "day";
  $("#theme").setAttribute("aria-label", night ? "Day mode" : "Night mode");
  document.querySelector('meta[name="theme-color"]').content = night ? "#0e110f" : "#ffffff";
  try { localStorage.setItem("chamada-theme", night ? "night" : "day"); } catch { /* storage refused */ }
});
if (document.documentElement.dataset.theme === "night") {
  $("#theme").setAttribute("aria-label", "Day mode");
  document.querySelector('meta[name="theme-color"]').content = "#0e110f";
}
$("#sound").addEventListener("click", () => {
  const next = !sound.soundOn();
  sound.setSound(next);
  const b = $("#sound");
  b.setAttribute("aria-pressed", sound.soundOn() ? "true" : "false");
  b.setAttribute("aria-label", sound.soundOn() ? "Sound is on" : "Sound is off");
  if (sound.soundOn()) sound.here();
});

function renderTop() {
  const m = $("#mode");
  m.hidden = !(CONFIG.rehearsal || view);
  m.innerHTML = S.mode === "rehearsal" ? `Rehearsal<span class="swap">, devnet · see mainnet</span>` : `Mainnet<span class="swap">&nbsp;· see rehearsal</span>`;
  if (CONFIG.name) { $("#brand-name").textContent = CONFIG.name; document.title = CONFIG.name; }
  if (CONFIG.ticker) { const t = $("#brand-ticker"); t.textContent = "$" + String(CONFIG.ticker).replace(/^\$/, ""); t.hidden = false; }
  if (CONFIG.mint) {
    $("#coin").hidden = false;
    $(".top").classList.add("has-coin"); // on a phone the CA and Buy chips then take a row of their own
    const ca = $("#ca");
    ca.textContent = "CA " + short(CONFIG.mint);
    ca.onclick = async () => { try { await navigator.clipboard.writeText(CONFIG.mint); ca.textContent = "copied"; setTimeout(() => (ca.textContent = "CA " + short(CONFIG.mint)), 1400); } catch { /* refused */ } };
    if (CONFIG.buyUrl) { const b = $("#buy"); b.href = CONFIG.buyUrl; b.hidden = false; }
  }
  $("#foot-cert").href = explorer("address", CERT_ACCOUNT);
}
$("#mode").addEventListener("click", () => {
  const next = S.mode === "rehearsal" ? "mainnet" : "rehearsal";
  const u = new URL(location.href);
  u.searchParams.set("view", next);
  history.replaceState(null, "", u);
  start(next);
});

// ---------- start ----------
let introduced = false;
async function start(mode) {
  S.mode = mode;
  S.network = mode === "rehearsal" ? "devnet" : CONFIG.network || "mainnet-beta";
  Object.assign(S, { ranksDoc: null, ranks: [], total: 0n, gridDoc: null, chain: null, chainFails: 0, certBytes: null, cert: null, certSource: null, certNote: null,
    lit: 0, animating: false, shown: false, roll: false, woke: false, pendingSeal: false, loading: true,
    check: { state: "idle", result: null, error: null }, record: null, selected: -1, marked: -1, ranksUrl: null, sayT: null, react: null, doze: 0 });
  S.run++;
  S.pollRun = (S.pollRun || 0) + 1;
  S.gridTried = false;
  S.warmed = false;
  card.hidden = true;
  found = []; findOut.textContent = "";
  renderTop();
  buildGrid();
  if (!introduced) { introduced = true; sayEl.textContent = ""; say(INTRO, 3800); }
  render();
  const pollRun = S.pollRun;
  const chainP = readChain();
  let files;
  if (mode === "rehearsal") files = [DATA.rehearsal.ranks];
  else {
    const c = await Promise.race([chainP, sleep(2500).then(() => null)]);
    const slot = c && c.slot ? c.slot : slotFromClock();
    files = slot >= MAINNET.listFixSlot ? [DATA.mainnet.ranks, DATA.mainnet.dryRun] : [DATA.mainnet.dryRun];
  }
  for (const url of files) {
    const d = await getJson(url);
    if (d && Array.isArray(d.ranks) && d.ranks.length && (!d.network || d.network === S.network)) { S.ranksDoc = d; S.ranksUrl = url; break; }
  }
  if (pollRun !== S.pollRun) return;
  S.loading = false;
  if (S.ranksDoc) {
    S.ranks = rankList(S.ranksDoc);
    S.total = S.ranks.reduce((s, r) => s + stakeOf(r), 0n);
  }
  if (mode === "rehearsal") {
    S.gridDoc = await getJson(DATA.rehearsal.grid);
    if (S.gridDoc && S.gridDoc.network !== S.network) S.gridDoc = null;
  }
  buildGrid();
  render();
  if (mode === "rehearsal") {
    // Sleep on the set roll for a moment, then replay devnet's answer: from the chain if it answers, else from the file.
    await sleep(2400);
    if (pollRun !== S.pollRun) return;
    const c = await chainP;
    if (pollRun !== S.pollRun) return;
    applyChain(c);
    if (!S.certBytes && S.gridDoc && S.gridDoc.certBase64) takeCert(S.gridDoc.certBase64, "grid-devnet.json");
    if (!S.record && S.gridDoc && S.gridDoc.record && S.gridDoc.record.sealed) takeRecord({ ...S.gridDoc.record, sealTx: S.gridDoc.sealTx });
  } else {
    const c = await chainP;
    if (pollRun !== S.pollRun) return;
    applyChain(c);
  }
  paintGrid();
  render();
  maybeWarm();
  setTimeout(() => poll(pollRun), nextDelay());
}

// Decodes the list's keys in the worker ahead of time (about 1 ms a key), so a check right after
// the certificate lands takes a few dozen milliseconds. Only near the switch or once it is in.
function maybeWarm() {
  if (S.warmed || !S.ranks.length || isPreviewList()) return;
  const t = switchTarget(), now = chainSlotNow();
  const near = S.certBytes || (t && now != null && (t.slot - now) * (S.chain?.msPerSlot || MAINNET.pace) < 20 * 60000);
  if (!near) return;
  S.warmed = true;
  try {
    if (!worker) worker = new Worker(workerUrl(), { type: "module" });
    worker.postMessage({ warm: S.ranks.map((r) => r.bls) });
  } catch { /* the check will decode them itself */ }
}

let lastPhase = null;
setInterval(() => {
  if (S.animating || document.hidden) return;
  const p = phase();
  if (p !== lastPhase) { lastPhase = p; paintGrid(); render(); return; }
  if (p === "set" || p === "preview" || p === "switching") { renderSentence(); if (S.open === "answer") renderPanel(); }
}, 1000);
blinkLoop();
setTimeout(dozeLoop, 15000);
setTimeout(wobbleLoop, 3000);
start(S.mode);
