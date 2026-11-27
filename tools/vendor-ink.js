// Copies the ink-studio files the browser page needs into web/ink/.
// Run after building ink-studio:  INK_STUDIO=../ink-studio node tools/vendor-ink.js
const fs = require('node:fs'), path = require('node:path');
const ink = path.resolve(process.env.INK_STUDIO || path.join(__dirname, '../../ink-studio'));
const out = path.join(__dirname, '../web/ink');
fs.rmSync(out, { recursive: true, force: true });
const seen = new Set();
const importRe = /(?:import|export)[^"';]*?from\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;
function walk(file) {
  file = path.resolve(file);
  if (seen.has(file)) return;
  seen.add(file);
  for (const m of fs.readFileSync(file, 'utf8').matchAll(importRe)) {
    const spec = m[1] || m[2];
    if (spec.startsWith('.')) walk(path.join(path.dirname(file), spec));
  }
}
walk(path.join(ink, 'src/webgl/renderer.mjs'));
walk(path.join(ink, 'src/webgl/instances.mjs'));
seen.add(path.join(ink, 'dist/ink-studio.bake.js'));
for (const file of seen) {
  const dest = path.join(out, path.relative(ink, file));
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(file, dest);
}
console.log('copied', seen.size, 'files to', path.relative(process.cwd(), out));
