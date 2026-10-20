// Ometto, the top stone of a cairn. "Ometto" ("little man") is what Italian climbers call a cairn:
// everyone who passes adds a stone. Here every validator in Alpenglow's genesis certificate is one
// pebble of the pile under him, in rank order from the top (just under Ometto) down to the base, so
// the light runs down the pile the way alpenglow runs down a summit.
//
// Ometto himself is one smooth neon stone with a face written in code: three monospace characters,
// like ">_0". The underscore is his mouth and blinks like a terminal cursor while he waits. When his
// mood changes the face is retyped: the old characters backspace away and the new ones type in.
//
// The geometry and the SVG markup are pure functions: omettoSVG() draws him alone (or on a small
// cairn), in Node or a browser, for the token pictures. The Ometto class wires the same markup into
// the page.

// ---------- colours ----------
// One neon, used everywhere as a fill. On white it is never used for text: small text, links and
// labels take the deep green ink instead. Exported so the tools draw with the same values.
export const COLORS = {
  neon: "#33ff77",       // Ometto, lit pebbles, main buttons, pills
  neonShade: "#1fd862",  // the one flat shadow on his stone
  ink: "#0e1310",        // his face, text on the neon
  deep: "#0b7a3b",       // deep green ink: small text, links, labels on white
  wait: "#e2e6e3",       // a pebble that has not answered yet
  pre: "#eceeed",        // a pebble on a preview list
  off: "#151a17",        // a pebble that did not sign
  ground: "#eff2ef",     // the flat ground under the pile
  white: "#ffffff",
  night: "#0e110f",      // the night page
};
export const MONO = `'JetBrains Mono', ui-monospace, 'Cascadia Mono', Menlo, Consolas, monospace`;
export const FONT_CSS = "https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@800&display=swap";

// ---------- the faces ----------
// ASCII only. z: a small floating "z"; cursor: the underscore mouth blinks like a terminal cursor.
export const FACES = {
  sleep: { face: "-_-", z: true, label: "Asleep: still night" },
  wait: { face: "o_o", cursor: true, label: "List set: waiting" },
  hold: { face: ">_<", label: "Holding my breath" },
  gasp: { face: "0_0", label: "The certificate lands" },
  look: { face: "o_o", label: "Light spreading" },
  happy: { face: "^_^", label: "Past 82%: here" },
  low: { face: "._.", label: "No answer / under 82%" },
  wink: { face: ">_0", label: "Sealed / pressed" },
  peek: { face: "-_o", label: "Woken for a look" },
  check: { face: "o_O", label: "Checking the signature" },
  fail: { face: "x_x", label: "Check failed" },
};

// ---------- small maths ----------
const f1 = (x) => String(Math.round(x * 10) / 10);
function rng(seed) {
  let a = (seed * 2654435761) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Points around a stone: a superellipse (sq 2 = ellipse, higher = squarer) with a slow, seeded
// wobble in its radius, rotated.
function stonePoints({ cx, cy, rx, ry, rot = 0, sq = 2.4, seed = 1, wob = 0.05 }, K = 40) {
  const R = rng(seed * 7919 + 13);
  const a = [0.4 + R() * 0.8, 0.2 + R() * 0.6, 0.1 + R() * 0.4], p = [R() * 6.283, R() * 6.283, R() * 6.283];
  const c = Math.cos((rot * Math.PI) / 180), s = Math.sin((rot * Math.PI) / 180), e = 2 / sq;
  const pts = [];
  for (let k = 0; k < K; k++) {
    const t = (k / K) * Math.PI * 2, ct = Math.cos(t), st = Math.sin(t);
    const m = 1 + (wob * (a[0] * Math.sin(2 * t + p[0]) + a[1] * Math.sin(3 * t + p[1]) + a[2] * Math.sin(5 * t + p[2]))) / 1.4;
    const x = rx * m * Math.sign(ct) * Math.abs(ct) ** e, y = ry * m * Math.sign(st) * Math.abs(st) ** e;
    pts.push([cx + x * c - y * s, cy + x * s + y * c]);
  }
  return pts;
}

// A smooth closed path through the points (Catmull-Rom as cubic Beziers).
function smooth(pts, dx = 0, dy = 0) {
  const n = pts.length, P = (i) => pts[(i + n) % n];
  let d = `M${f1(pts[0][0] + dx)} ${f1(pts[0][1] + dy)}`;
  for (let i = 0; i < n; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    d += `C${f1(p1[0] + (p2[0] - p0[0]) / 6 + dx)} ${f1(p1[1] + (p2[1] - p0[1]) / 6 + dy)} ${f1(p2[0] - (p3[0] - p1[0]) / 6 + dx)} ${f1(p2[1] - (p3[1] - p1[1]) / 6 + dy)} ${f1(p2[0] + dx)} ${f1(p2[1] + dy)}`;
  }
  return d + "Z";
}

// A lighter path for the many small pebbles: quadratic curves through the midpoints.
function pebblePath(pts) {
  const n = pts.length, mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  let m = mid(pts[n - 1], pts[0]), d = `M${f1(m[0])} ${f1(m[1])}`;
  for (let i = 0; i < n; i++) { m = mid(pts[i], pts[(i + 1) % n]); d += `Q${f1(pts[i][0])} ${f1(pts[i][1])} ${f1(m[0])} ${f1(m[1])}`; }
  return d + "Z";
}

function bbox(pts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return { x0, y0, x1, y1 };
}

// ---------- Ometto, the top stone ----------
export const VIEW_W = 320;
export const OM = { cx: 160, cy: 58, rx: 64, ry: 46, rot: -2.5, sq: 2.45, seed: 11, wob: 0.045 };
const FS = 45;                 // the face's font size, in figure units
const CW = FS * 0.6;           // one monospace cell (JetBrains Mono advances 600/1000 em)
const FACE_X = (k) => OM.cx + (k - 1) * CW;
const FACE_Y = OM.cy + FS * 0.3;   // baseline: centres "o", "0", "^" and "_" together on the stone
export const PIVOT = { x: OM.cx, y: OM.cy + OM.ry - 2 };  // his tilt, hop and squish: from where he sits

const omPts = () => stonePoints(OM, 56);
const haloPts = (grow) => stonePoints({ ...OM, rx: OM.rx + grow, ry: OM.ry + grow }, 56);
// the one flat shadow: the stone minus itself moved up and a little left, so a crescent along the
// bottom-right edge
const around = (pts) => { const b = bbox(pts); return `M${f1(b.x0 - 12)} ${f1(b.y0 - 12)}H${f1(b.x1 + 12)}V${f1(b.y1 + 12)}H${f1(b.x0 - 12)}Z`; };

// ---------- the cairn ----------
// Two shapes of pile: "many" (mainnet, hundreds of pebbles) and "few" (the rehearsal's 17, larger).
// The pile is laid in courses, like a real cairn: rows from the top down, each a little wider, the
// stones a little bigger toward the base. Everything is seeded, so nothing changes between loads.
const PROFILES = {
  many: { y0: 103, y1: 386, top: 56, base: 156, exp: 0.74, grow: [0.85, 0.4], lumpy: 0.07, jit: 0.46, h: 400 },
  few: { y0: 101, y1: 290, top: 54, base: 126, exp: 0.9, grow: [0.9, 0.25], lumpy: 0.05, jit: 0.4, h: 306 },
};

function cairnRows(N, P) {
  const H = P.y1 - P.y0, hw = (t) => P.top + (P.base - P.top) * t ** P.exp;
  let avg = 0;
  for (let k = 0; k < 64; k++) avg += 2 * hw((k + 0.5) / 64);
  avg /= 64;
  const R = Math.max(1, Math.round(Math.sqrt((H * N) / (0.74 * avg))));
  // rows get taller toward the base (bigger stones at the bottom, as a real cairn is built)
  const grow = (k) => P.grow[0] + P.grow[1] * ((k + 0.5) / R);
  let gs = 0;
  for (let k = 0; k < R; k++) gs += grow(k);
  const rows = [];
  let y = P.y0;
  for (let k = 0; k < R; k++) {
    const t = (k + 0.5) / R, J = rng(k * 613 + 29), h = (H * grow(k)) / gs;
    rows.push({ k, t, y: y + h / 2, h, W: 2 * hw(t) * (1 + (J() - 0.5) * P.lumpy) });
    y += h;
  }
  // how many pebbles in each row: its width over its height, rounded so the total is exactly N
  // (largest remainder), at least one a row
  const want = rows.map((r) => r.W / r.h), sum = want.reduce((a, b) => a + b, 0);
  const raw = want.map((x) => (x * N) / sum);
  const c = raw.map((x) => Math.max(1, Math.floor(x)));
  let left = N - c.reduce((a, b) => a + b, 0);
  const order = raw.map((x, i) => [x - Math.floor(x), i]).sort((a, b) => b[0] - a[0]);
  for (let j = 0; left > 0; j = (j + 1) % order.length) { c[order[j][1]]++; left--; }
  for (let j = rows.length - 1; left < 0; j = (j - 1 + rows.length) % rows.length) if (c[j] > 1) { c[j]--; left++; }
  rows.forEach((r, k) => (r.count = c[k]));
  return { rows };
}

// layout(count, live): `count` pebbles, the first `live` of them validators (pressable, in rank
// order); the rest are plain pebbles (only while the list is loading).
export function layout(count, live = count) {
  live = Math.min(live, count);
  const mode = count > 40 ? "many" : "few", P = PROFILES[mode];
  const { rows } = cairnRows(Math.max(1, count), P);
  const gap = mode === "many" ? 1.3 : 2.6;
  const spots = [];
  for (const r of rows) {
    const J = rng(r.k * 7919 + 3), w = [];
    for (let j = 0; j < r.count; j++) w.push(1 - P.jit / 2 + P.jit * J());
    const ws = w.reduce((a, b) => a + b, 0);
    let x = VIEW_W / 2 - r.W / 2;
    for (let j = 0; j < r.count; j++) {
      const pw = (w[j] / ws) * r.W;
      spots.push({ x: x + pw / 2, y: r.y + (J() - 0.5) * r.h * 0.1, pw, h: r.h, row: r.k });
      x += pw;
    }
  }
  // rank order: from the top row down, and in a row from the middle out, so the light runs down
  spots.sort((a, b) => a.row - b.row || Math.abs(a.x - VIEW_W / 2) - Math.abs(b.x - VIEW_W / 2) || a.x - b.x);
  const stones = spots.slice(0, count).map((s, i) => {
    const R = rng(i * 31 + 101);
    const rx = Math.max(1.5, s.pw / 2 - gap / 2);
    const ry = Math.max(1.5, (s.h / 2) * (0.84 + 0.12 * R()) - gap / 2);
    const spec = { cx: s.x, cy: s.y, rx, ry, rot: (R() - 0.5) * 9, sq: 2.3 + R() * 1.4, seed: i + 1, wob: mode === "many" ? 0.1 : 0.07 };
    return { ...spec, i, row: s.row, live: i < live, pts: stonePoints(spec, mode === "many" ? 9 : 22) };
  });
  return { mode, count: stones.length, live, stones, view: { w: VIEW_W, h: P.h }, base: { y: P.y1, hw: P.base } };
}

// ---------- markup ----------
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const luma = (hex) => {
  const h = String(hex).replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(h)) return 1;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const faceOf = (mood) => (typeof mood === "string" && FACES[mood] ? FACES[mood] : { face: String(mood || "o_o").slice(0, 3) });

// Ometto alone, as SVG elements in figure units. pal: inline colours (for a picture); glow: the flat
// night halo; face: the three characters; z: the floating z's.
export function omettoMarkup({ pal = null, glow = false, face = "o_o", z = false, interactive = false } = {}) {
  const pts = omPts(), d = smooth(pts);
  const A = (cls, fill) => (pal ? ` fill="${fill}"` : ` class="${cls}"`);
  const text = (k, ch) => `<text class="fc fc${k}" x="${f1(FACE_X(k))}" y="${f1(FACE_Y)}" text-anchor="middle"` +
    (pal ? ` fill="${pal.ink}" font-family="${MONO}" font-weight="800" font-size="${FS}"` : "") + `>${esc(ch || "")}</text>`;
  const halo = glow || !pal ? `<path${A("om-halo", pal?.neon)}${pal ? ` fill-opacity="0.16"` : ""} d="${smooth(haloPts(11))}"/>` : "";
  const zz = z || !pal
    ? `<g class="om-z"${pal ? ` fill="${pal.zInk}" font-family="${MONO}" font-weight="800"` : ""}>` +
      `<text class="z z1" x="${f1(OM.cx + OM.rx * 0.86)}" y="${f1(OM.cy - OM.ry * 0.62)}"${pal ? ` font-size="15"` : ""}>z</text>` +
      `<text class="z z2" x="${f1(OM.cx + OM.rx * 0.86 + 12)}" y="${f1(OM.cy - OM.ry * 0.62 - 15)}"${pal ? ` font-size="11"` : ""}>z</text></g>`
    : "";
  const btn = interactive ? ` role="button" tabindex="0" aria-label="Alpen, the top stone"` : "";
  return `<g class="om"${btn}><g class="om-tilt"><g class="om-hop"><g class="om-bob">` + halo +
    `<clipPath id="om-clip"><path d="${d}"/></clipPath>` +
    `<path${A("om-stone", pal?.neon)} d="${d}"/>` +
    `<path${A("om-shade", pal?.neonShade)} fill-rule="evenodd" clip-path="url(#om-clip)" d="${around(pts)}${smooth(pts, -4, -6.5)}"/>` +
    `<g class="om-face">${[0, 1, 2].map((k) => text(k, face[k])).join("")}` +
    (pal ? "" : `<rect class="om-caret" x="0" y="${f1(FACE_Y - FS * 0.74)}" width="3.6" height="${f1(FS * 0.86)}" rx="1"/>`) + `</g>` +
    zz + `</g></g></g></g>`;
}

// The pile: one pebble per stone of the layout. states: per stone "on" | "off" | "wait" | "pre".
export function cairnMarkup(shape, { pal = null, states = null, interactive = false } = {}) {
  const fill = (s) => {
    if (!pal) return "";
    const st = states ? states[s.i] || "wait" : "wait";
    return ` fill="${!s.live ? pal.wait : st === "on" ? pal.neon : st === "off" ? pal.off : st === "pre" ? pal.pre : pal.wait}"`;
  };
  const btn = (s) => (interactive && s.live ? ` tabindex="-1" role="button" data-i="${s.i}"` : "");
  const peb = shape.stones.map((s) => `<g class="${s.live ? "s" : "rk"}"${btn(s)}><path class="peb"${fill(s)} d="${pebblePath(s.pts)}"/></g>`).join("");
  const g = shape.base;
  return `<ellipse${pal ? ` fill="${pal.ground}"` : ` class="ground"`} cx="${VIEW_W / 2}" cy="${f1(g.y + 3)}" rx="${f1(Math.min(VIEW_W / 2 - 1, g.hw + 14))}" ry="${f1(shape.mode === "many" ? 7 : 8)}"/>` +
    `<g class="cairn">${peb}</g>`;
}

// Ometto alone (or on a small cairn), as a standalone SVG string: for the token pictures and the face sheet.
//   mood:       a FACES name ("wink", "happy", ...) or three characters (">_0")
//   size:       pixel width of the picture (square unless square: false)
//   background: a colour or null (transparent); glow: the flat neon halo (for a dark background)
//   cairn:      0 for Ometto alone, or a pebble count to stand him on a pile (bits: which are lit; default all)
//   fontImport: add an @import of the face's font, so the file shows JetBrains Mono when opened alone
export function omettoSVG({ mood = "wink", size = 1024, background = "#ffffff", glow = null, cairn = 0, bits = null, square = true, box = null, palette = {}, fontImport = true } = {}) {
  const dark = !!background && luma(background) < 0.25;
  const pal = { ...COLORS, zInk: dark ? COLORS.neon : COLORS.deep, ...palette };
  if (dark && !palette.ground) pal.ground = "#171b18";
  if (dark && !palette.wait) pal.wait = "#2c332e";
  const F = faceOf(mood);
  let body = "", vb;
  if (cairn > 0) {
    const shape = layout(cairn);
    const states = shape.stones.map((s, i) => (bits ? (bits[i] ? "on" : "off") : "on"));
    body = cairnMarkup(shape, { pal, states });
    vb = box || (square ? [VIEW_W / 2 - shape.view.h / 2, 0, shape.view.h, shape.view.h] : [0, 0, VIEW_W, shape.view.h]);
  } else {
    vb = box || (square ? [OM.cx - 92, OM.cy - 92, 184, 184] : [OM.cx - 92, OM.cy - 70, 184, 140]);
  }
  body += omettoMarkup({ pal, glow: glow ?? !!dark, face: F.face, z: !!F.z });
  const [w, h] = [size, Math.round((size * vb[3]) / vb[2])];
  const bg = background ? `<rect x="${f1(vb[0])}" y="${f1(vb[1])}" width="${f1(vb[2])}" height="${f1(vb[3])}" fill="${background}"/>` : "";
  const font = fontImport ? `<style>@import url('${FONT_CSS}');</style>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb.map(f1).join(" ")}" width="${w}" height="${h}">${font}${bg}${body}</svg>`;
}

// ---------- the living figure on the page ----------
const NS = "http://www.w3.org/2000/svg";
const reduceMotion = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export class Ometto {
  constructor(root) {
    this.root = root;
    this.squares = [];
    this.mood = "sleep";
    this.target = FACES.sleep.face;
    this.shown = FACES.sleep.face;
    this.typing = false;
    this.lookTimer = 0;
  }

  build(shape) {
    this.shape = shape;
    const root = this.root, V = shape.view;
    root.classList.toggle("few", shape.mode === "few");
    root.classList.toggle("many", shape.mode === "many");
    root.style.setProperty("--ar", `${V.w} / ${V.h}`);
    root.innerHTML = `<svg class="fig-svg" viewBox="0 0 ${V.w} ${V.h}" role="group" aria-label="Alpen on his cairn. One pebble per validator, biggest stake at the top">` +
      cairnMarkup(shape, { interactive: true }) + omettoMarkup({ face: this.shown, interactive: true }) + `</svg>` +
      `<div class="marks" aria-hidden="true"><span class="tag" hidden></span></div>`;
    this.svg = root.firstElementChild;
    this.om = this.svg.querySelector(".om");
    this.tilt = this.svg.querySelector(".om-tilt");
    this.hopper = this.svg.querySelector(".om-hop");
    this.bob = this.svg.querySelector(".om-bob");
    this.faceEl = this.svg.querySelector(".om-face");
    this.cells = [...this.svg.querySelectorAll(".fc")];
    this.caret = this.svg.querySelector(".om-caret");
    this.cairn = this.svg.querySelector(".cairn");
    this.marks = root.querySelector(".marks");
    this.tag = root.querySelector(".tag");
    this.squares = [];
    for (const g of this.svg.querySelectorAll(".s")) this.squares[Number(g.dataset.i)] = g;
    this.pos = shape.stones.slice(0, shape.live).map((s) => ({ x: s.cx, y: s.cy, row: s.row }));
    this.byRow = new Map();
    this.pos.forEach((p, i) => { if (!this.byRow.has(p.row)) this.byRow.set(p.row, []); this.byRow.get(p.row).push(i); });
    for (const list of this.byRow.values()) list.sort((a, b) => this.pos[a].x - this.pos[b].x);
    this.rings = {};
    this.typing = false;
    this.shown = this.target;
    this.paint();
    this.setMood(this.mood, true);
  }

  // A mood from FACES (or three characters): the face is retyped, the z's and the cursor follow.
  setMood(m, force) {
    if (m === this.mood && !force) return;
    this.mood = m;
    const F = faceOf(m);
    if (this.om) {
      this.om.classList.toggle("asleep", !!F.z);
      this.om.classList.toggle("cursor", !!F.cursor);
    }
    this.type(F.face);
  }

  type(str) {
    if (str === this.target && !this.typing) { this.paint(); return; }
    this.target = str;
    if (reduceMotion || !this.cells) { this.shown = str; this.paint(); return; }
    if (!this.typing) this.step();
  }

  // One keystroke: backspace until what is shown is the start of the new face, then type the rest.
  step() {
    const t = this.target, s = this.shown;
    if (s === t) { this.typing = false; this.paint(); return; }
    this.typing = true;
    const back = !t.startsWith(s);
    this.shown = back ? s.slice(0, -1) : t.slice(0, s.length + 1);
    this.paint();
    clearTimeout(this.typeTimer);
    this.typeTimer = setTimeout(() => this.step(), back ? 46 : 70);
  }

  paint(eyes) {
    if (!this.cells || !this.cells.length) return;
    const s = this.shown;
    this.cells.forEach((c, k) => { const ch = eyes && k !== 1 && s[k] ? eyes : s[k] || ""; if (c.textContent !== ch) c.textContent = ch; });
    if (this.om) this.om.classList.toggle("typing", this.typing);
    if (this.caret) this.caret.setAttribute("x", f1(FACE_X(Math.min(s.length, 2)) + (s.length > 2 ? CW / 2 : -CW / 2) + 0.6));
  }

  // A blink: two round eyes close to "-" for a moment (no retyping).
  blink() {
    if (this.typing || reduceMotion) return;
    const s = this.shown;
    if (s.length < 3 || !/[oO0]/.test(s[0]) || !/[oO0]/.test(s[2])) return; // both eyes round: not the wink
    this.paint("-");
    setTimeout(() => { if (!this.typing && this.shown === s) this.paint(); }, 140);
  }

  setBreath(kind) {
    if (!this.bob) return;
    this.bob.classList.toggle("bobbing", kind === "calm" && !reduceMotion);
    this.bob.classList.toggle("hold", kind === "hold");
  }

  restart(node, cls, ms) {
    if (reduceMotion || !node) return;
    node.classList.remove(cls);
    void node.getBoundingClientRect();
    node.classList.add(cls);
    clearTimeout(node["_t" + cls]);
    node["_t" + cls] = setTimeout(() => node.classList.remove(cls), ms);
  }
  hop() { this.restart(this.hopper, "hop", 760); }
  sigh() { this.restart(this.hopper, "sigh", 1100); }
  // one pebble settles with a small wobble
  wobble(i) {
    const list = this.svg ? [...this.svg.querySelectorAll(".s, .rk")] : [];
    const g = i != null ? this.squares[i] : list[Math.floor(Math.random() * list.length)];
    this.restart(g, "wob", 800);
  }

  // A tilt toward a point (figure units), and the face slides a little that way. Only on a press.
  look(x, y, ms = 2800) {
    if (!this.tilt) return;
    const dx = x - PIVOT.x, dy = y - OM.cy, d = Math.hypot(dx, dy) || 1;
    const ang = Math.max(-1, Math.min(1, dx / (VIEW_W * 0.42))) * 8;
    this.tilt.style.transform = `rotate(${ang.toFixed(2)}deg)`;
    this.faceEl.style.transform = `translate(${((dx / d) * 4).toFixed(2)}px, ${((dy / d) * 3).toFixed(2)}px)`;
    clearTimeout(this.lookTimer);
    this.lookTimer = setTimeout(() => this.lookAhead(), ms);
  }
  lookAhead() {
    clearTimeout(this.lookTimer);
    if (!this.tilt) return;
    this.tilt.style.transform = this.faceEl.style.transform = "";
  }
  lookAtSquare(i, ms) { const p = this.pos[i]; if (p) this.look(p.x, p.y, ms); }
  lookAtElement(node, ms) {
    const a = this.svg.getBoundingClientRect(), b = node.getBoundingClientRect();
    if (!a.width) return;
    const V = this.shape.view;
    this.look(((b.left + b.width / 2 - a.left) / a.width) * V.w, ((b.top + b.height / 2 - a.top) / a.height) * V.h, ms);
  }

  // Where a pebble is on screen, in percent of the figure's box.
  at(i) {
    const g = this.squares[i] && this.squares[i].querySelector(".peb");
    if (!g) return null;
    const a = this.root.getBoundingClientRect(), b = g.getBoundingClientRect();
    if (!a.width) return null;
    return { x: ((b.left + b.width / 2 - a.left) / a.width) * 100, y: ((b.top - a.top) / a.height) * 100 };
  }

  here(i, text = "here") {
    const p = this.at(i);
    if (!p) return;
    const s = document.createElement("span");
    s.className = "here";
    s.textContent = text;
    s.style.left = p.x + "%";
    s.style.top = p.y + "%";
    this.marks.appendChild(s);
    setTimeout(() => s.remove(), 1500);
  }

  showTag(i, text) {
    const p = this.at(i);
    if (!p) return;
    const t = this.tag;
    t.textContent = text;
    t.hidden = false;
    const w = this.root.clientWidth, half = t.offsetWidth / 2 + 2;
    t.style.left = Math.max(half, Math.min(w - half, (p.x / 100) * w)) + "px";
    t.style.top = p.y + "%";
  }
  hideTag() { if (this.tag) this.tag.hidden = true; }

  // A ring drawn over a pebble: hover, sel (selected), focus.
  ring(kind, i) {
    let r = this.rings[kind];
    const g = i >= 0 ? this.squares[i] : null;
    if (!g) { if (r) r.remove(); return; }
    if (!r) {
      r = document.createElementNS(NS, "g");
      r.setAttribute("class", "ring ring-" + kind);
      r.setAttribute("aria-hidden", "true");
      r.append(document.createElementNS(NS, "path"), document.createElementNS(NS, "path"));
      r.firstChild.setAttribute("class", "halo");
      r.lastChild.setAttribute("class", "line");
      this.rings[kind] = r;
    }
    const d = g.querySelector(".peb").getAttribute("d");
    r.firstChild.setAttribute("d", d);
    r.lastChild.setAttribute("d", d);
    this.cairn.appendChild(r);
  }
  // the found validator: a ring that keeps pulsing outward
  mark(i) {
    let m = this.rings.mark;
    const s = this.shape && this.shape.stones[i], g = this.squares[i];
    if (!g || !s) { if (m) m.remove(); return; }
    if (!m) { m = document.createElementNS(NS, "circle"); m.setAttribute("class", "mark-ring"); this.rings.mark = m; }
    m.setAttribute("cx", f1(s.cx));
    m.setAttribute("cy", f1(s.cy));
    m.setAttribute("r", f1(Math.max(s.rx, s.ry) + 3));
    this.cairn.appendChild(m);
  }

  // The pebble above or below (dir = 1 down, -1 up), nearest in x; or beside it in its row (side).
  neighbour(i, dir) {
    const p = this.pos[i];
    if (!p) return i;
    const rows = [...this.byRow.keys()].sort((a, b) => a - b), k = rows.indexOf(p.row) + dir;
    if (k < 0 || k >= rows.length) return i;
    let best = -1;
    for (const j of this.byRow.get(rows[k])) if (best < 0 || Math.abs(this.pos[j].x - p.x) < Math.abs(this.pos[best].x - p.x)) best = j;
    return best < 0 ? i : best;
  }
  side(i, dir) {
    const p = this.pos[i];
    if (!p) return i;
    const row = this.byRow.get(p.row), k = row.indexOf(i) + dir;
    return k >= 0 && k < row.length ? row[k] : i;
  }
}
