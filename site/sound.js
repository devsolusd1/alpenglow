// Ometto's sounds, synthesized (WebAudio, no files). Off until the visitor turns it on.
// The call is a low two-note horn across the valley; a stone's "here" is the click of one stone set on another.
let ctx = null, on = false, lastTick = 0, noise = null;

export function setSound(v) {
  on = !!v;
  if (!on) return;
  try {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === "suspended") ctx.resume();
  } catch { on = false; }
}
export const soundOn = () => on;

function horn(freq, t, dur, level = 0.07) {
  const o = ctx.createOscillator(), o2 = ctx.createOscillator(), lp = ctx.createBiquadFilter(), g = ctx.createGain();
  o.type = "sawtooth";
  o.frequency.setValueAtTime(freq * 0.96, t);
  o.frequency.linearRampToValueAtTime(freq, t + 0.08);
  o2.type = "sine";
  o2.frequency.setValueAtTime(freq / 2, t);
  lp.type = "lowpass";
  lp.frequency.setValueAtTime(500, t);
  lp.frequency.linearRampToValueAtTime(1100, t + 0.12);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(level, t + 0.09);
  g.gain.setValueAtTime(level, t + dur * 0.6);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(lp); o2.connect(lp); lp.connect(g); g.connect(ctx.destination);
  o.start(t); o2.start(t); o.stop(t + dur + 0.05); o2.stop(t + dur + 0.05);
}

// A stone set on a stone: a short band of noise and a small knock under it.
function clack(t, pitch = 1, level = 0.09) {
  if (!noise) {
    noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.08), ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 3;
  }
  const src = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), g = ctx.createGain();
  src.buffer = noise;
  bp.type = "bandpass";
  bp.frequency.setValueAtTime(1900 * pitch, t);
  bp.Q.value = 6;
  g.gain.setValueAtTime(level, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
  src.connect(bp); bp.connect(g); g.connect(ctx.destination);
  src.start(t);
  const o = ctx.createOscillator(), g2 = ctx.createGain();
  o.type = "sine";
  o.frequency.setValueAtTime(260 * pitch, t);
  o.frequency.exponentialRampToValueAtTime(120 * pitch, t + 0.06);
  g2.gain.setValueAtTime(level * 0.6, t);
  g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
  o.connect(g2); g2.connect(ctx.destination);
  o.start(t); o.stop(t + 0.1);
}

const ready = () => on && ctx && ctx.state !== "closed";
export function call() { if (!ready()) return; const t = ctx.currentTime + 0.02; horn(196, t, 0.3); horn(261.6, t + 0.26, 0.5); }
export function here() { if (!ready()) return; const t = ctx.currentTime + 0.01; clack(t, 1); clack(t + 0.09, 1.25, 0.06); }
export function tick() {
  if (!ready()) return;
  const now = performance.now();
  if (now - lastTick < 120) return;
  lastTick = now;
  clack(ctx.currentTime + 0.005, 0.8 + Math.random() * 0.6, 0.035);
}
export function wake() { if (!ready()) return; const t = ctx.currentTime + 0.02; horn(196, t, 0.3); horn(261.6, t + 0.26, 0.3); horn(329.6, t + 0.52, 0.7); }
export function seal() { if (!ready()) return; const t = ctx.currentTime + 0.02; horn(130.8, t, 1.1, 0.05); horn(196, t + 0.05, 1.05, 0.05); clack(t + 0.35, 0.9, 0.08); }
export function sigh() {
  if (!ready()) return;
  const t = ctx.currentTime + 0.02, o = ctx.createOscillator(), g = ctx.createGain();
  o.type = "triangle";
  o.frequency.setValueAtTime(330, t);
  o.frequency.exponentialRampToValueAtTime(196, t + 0.5);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.03, t + 0.08);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
  o.connect(g); g.connect(ctx.destination);
  o.start(t); o.stop(t + 0.6);
}
