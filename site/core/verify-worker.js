// Runs verifyGrid off the main thread so the grid keeps moving while the pairing is computed.
// {warm: [bls hex...]} decodes the keys ahead of time; {id, cert, ranks, opts} runs the check.
import { verifyGrid, g1Key } from "./verify.js";

self.onmessage = async (e) => {
  const { id, cert, ranks, opts, warm } = e.data || {};
  if (warm) {
    for (const k of warm) { try { g1Key(k); } catch { /* the check will report it */ } }
    return;
  }
  try {
    self.postMessage({ id, ok: true, result: await verifyGrid(cert, ranks, opts) });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String((err && err.message) || err) });
  }
};
