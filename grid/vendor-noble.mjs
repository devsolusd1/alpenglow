#!/usr/bin/env node
// vendor-noble.mjs - copy the ESM files that bls12-381 and sha2 need from an
// installed @noble/curves 1.9.7 (+ its @noble/hashes 1.8.0) into site/vendor/,
// so the browser verifier runs with no CDN and no build step.
//
// The only change made to the copied files: bare imports such as
// '@noble/hashes/utils.js' are rewritten to relative paths
// ('../noble-hashes/utils.js'), because a browser cannot resolve bare names
// without an import map. LICENSE files are copied unchanged.
//
// Usage: node grid/vendor-noble.mjs [path/to/node_modules/@noble]
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(process.argv[2] || 'C:/Users/John/RafinhaProject/infinite-monkey/launch/node_modules/@noble');
const OUT = resolve(HERE, '../site/vendor');
const pkgs = {
  curves: { src: join(SRC, 'curves'), out: join(OUT, 'noble-curves') },
  hashes: { src: join(SRC, 'hashes'), out: join(OUT, 'noble-hashes') },
};
const ver = (p) => JSON.parse(readFileSync(join(p, 'package.json'), 'utf8')).version;
const versions = { curves: ver(pkgs.curves.src), hashes: ver(pkgs.hashes.src) };
if (versions.curves !== '1.9.7') console.warn(`warning: @noble/curves is ${versions.curves}, expected 1.9.7`);

// resolve the transitive import closure, starting at the two entry points
const queue = [['curves', 'bls12-381.js'], ['hashes', 'sha2.js']];
const seen = new Set();
const importRe = /(\bfrom\s*|\bimport\s*)(['"])([^'"]+)\2/g;
while (queue.length) {
  const [pkg, file] = queue.shift();
  const key = pkg + '/' + file;
  if (seen.has(key)) continue;
  seen.add(key);
  const srcFile = join(pkgs[pkg].src, 'esm', file);
  const lines = readFileSync(srcFile, 'utf8').split('\n');
  let inComment = false;
  const rewrite = (line) => line.replace(importRe, (m, kw, q, spec) => {
    let tPkg, tFile;
    if (spec.startsWith('@noble/hashes/')) {
      tPkg = 'hashes'; tFile = spec.slice('@noble/hashes/'.length);
      if (!tFile.endsWith('.js')) tFile += '.js';
    } else if (spec.startsWith('.')) {
      tPkg = pkg; tFile = posix.normalize(posix.join(posix.dirname(file), spec));
    } else {
      throw new Error(`${key}: unexpected import ${spec}`);
    }
    queue.push([tPkg, tFile]);
    if (spec.startsWith('.')) return m; // relative import inside the same package: unchanged
    const fromDir = posix.dirname(posix.join(pkg === 'curves' ? 'noble-curves' : 'noble-hashes', file));
    const target = posix.join('noble-hashes', tFile);
    let rel = posix.relative(fromDir, target);
    if (!rel.startsWith('.')) rel = './' + rel;
    return `${kw}${q}${rel}${q}`;
  });
  // rewrite imports only in code, never inside comments (JSDoc examples mention '@noble/curves/...')
  let code = lines.map((line) => {
    const t = line.trim();
    if (inComment) { if (t.includes('*/')) inComment = false; return line; }
    if (t.startsWith('/*')) { if (!t.includes('*/')) inComment = true; return line; }
    if (t.startsWith('//') || t.startsWith('*')) return line;
    return rewrite(line);
  }).join('\n');
  // drop the source-map comment: the .map files are not vendored
  code = code.replace(/\n\/\/# sourceMappingURL=.*\s*$/, '\n');
  const outFile = join(pkgs[pkg].out, file);
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, code);
}
for (const p of Object.values(pkgs)) {
  copyFileSync(join(p.src, 'LICENSE'), join(p.out, 'LICENSE'));
  writeFileSync(join(p.out, 'package.json'), JSON.stringify({ type: 'module', sideEffects: false }, null, 2) + '\n');
}
if (!existsSync(join(OUT, "README.txt"))) writeFileSync(join(OUT, "README.txt"),
  `Vendored, unmodified except for import paths:\n` +
  `  noble-curves  = @noble/curves ${versions.curves} esm/ (MIT, see noble-curves/LICENSE)\n` +
  `  noble-hashes  = @noble/hashes ${versions.hashes} esm/ (MIT, see noble-hashes/LICENSE)\n` +
  `Bare '@noble/hashes/x' imports were rewritten to relative '../noble-hashes/x.js'.\n` +
  `Source-map comments removed. Regenerate with: node grid/vendor-noble.mjs\n` +
  `Files: ${[...seen].sort().join(', ')}\n`);
console.log(`vendored ${seen.size} files into ${relative(process.cwd(), OUT) || OUT}: ${[...seen].sort().join(', ')}`);
