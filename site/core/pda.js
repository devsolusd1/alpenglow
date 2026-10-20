// Program derived addresses without @solana/web3.js: sha256 plus an ed25519 "is it on the curve" test
// done with BigInt (what curve25519-dalek's CompressedEdwardsY::decompress decides).
import { sha256 } from "../vendor/noble-hashes/sha2.js";
import { pubkeyBytes, b58encode } from "./cert.js";

const P = 2n ** 255n - 19n;
const modpow = (b, e) => {
  let r = 1n; b %= P;
  while (e > 0n) { if (e & 1n) r = (r * b) % P; b = (b * b) % P; e >>= 1n; }
  return r;
};
const D = ((P - 121665n) * modpow(121666n, P - 2n)) % P;

export function isOnCurve(bytes) {
  let y = 0n;
  for (let i = 31; i >= 0; i--) y = (y << 8n) | BigInt(i === 31 ? bytes[i] & 0x7f : bytes[i]);
  y %= P;
  const y2 = (y * y) % P;
  const u = (y2 - 1n + P) % P;
  const v = (D * y2 + 1n) % P;
  const x2 = (u * modpow(v, P - 2n)) % P;
  return x2 === 0n || modpow(x2, (P - 1n) / 2n) === 1n;
}

const enc = new TextEncoder();
const MARKER = enc.encode("ProgramDerivedAddress");

export function findProgramAddress(seeds, programId) {
  const pid = typeof programId === "string" ? pubkeyBytes(programId) : programId;
  const parts = seeds.map((s) => (typeof s === "string" ? enc.encode(s) : s));
  for (let bump = 255; bump >= 0; bump--) {
    const h = sha256.create();
    for (const p of parts) h.update(p);
    h.update(Uint8Array.of(bump));
    h.update(pid);
    h.update(MARKER);
    const out = h.digest();
    if (!isOnCurve(out)) return { address: b58encode(out), bump };
  }
  throw new Error("no viable bump");
}

// The coin's record: seeds ["chamada", mint] under the Chamada program.
export const recordAddress = (programId, mint) => findProgramAddress(["chamada", pubkeyBytes(mint)], programId).address;
