// Runs web/game.js's pose and contact math in node, without rendering, to check parry timing in seconds rather
// than minutes of software WebGL. An enemy straight ahead swings at t = 0, and the player parries at each press time.
// Usage: node tools/sim-parry.js "?arc=1.4&eside=1" 1      (URL options, then parry side: 1 left, -1 right)
// Output: P = always parried, p = parried at some frame phases, . = hit. Rows are for 60 fps and 20 fps.
const fs = require('fs'), vm = require('vm');
const root = require('path').resolve(__dirname, '..'), query = process.argv[2] || '';
const ctx = { console, Math, URLSearchParams, Infinity, isFinite, Float32Array, Int32Array, Uint8Array, Array, Object, Number, Set, Map, JSON, setTimeout: () => 0, clearTimeout: () => 0 };
ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(`var KIT = { M: {
  rot([x, y, z], a) { const l = Math.hypot(x, y, z) || 1; x /= l; y /= l; z /= l; const c = Math.cos(a), s = Math.sin(a), t = 1 - c;
    return [t*x*x + c, t*x*y - s*z, t*x*z + s*y, t*x*y + s*z, t*y*y + c, t*y*z - s*x, t*x*z - s*y, t*y*z + s*x, t*z*z + c]; },
  mul(A, B) { const o = []; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) o.push(A[i*3]*B[j] + A[i*3+1]*B[3+j] + A[i*3+2]*B[6+j]); return o; } } };`, ctx);
let src = fs.readFileSync(root + '/web/game.js', 'utf8');
src = src.replace(/^import .*$/mg, '');
src = src.slice(0, src.indexOf('// ---------- HUD ----------'));
const el = () => ({ textContent: '', hidden: true, addEventListener() {}, classList: { add() {}, remove() {} } });
const prelude = `const location = { search: ${JSON.stringify(query)} }; const document = { getElementById: () => (${el.toString()})() };
const flash = () => {}; const showHp = () => {}; const banner = {}; `;
vm.runInContext(prelude + src + `
this.simFrames = function (pressAt, side, dt, phase) {
  state.hp = 99; state.hurtAt = -Infinity; state.dead = null; state.phi = 0; state.sq = [0, 0]; state.act = null;
  const e = enemies[0]; Object.assign(e, { mode: 'swing', sq: [0, -1], dir: [0, 1], t0: 0, side: ENEMY_SWING_SIDE, struck: false, blocked: false });
  for (let t = phase, prev = phase; t < 1.3; prev = t, t += dt) {
    if (!state.act && t >= pressAt) state.act = { kind: 'parry', side, t0: t };
    checkEnemyHits(prev, t, null, null);
    if (e.struck || e.blocked) return e.blocked ? 'P' : 'h';
  }
  return '-';
};
this.sim = function (pressAt, side, key) {
  state.hp = 99; state.hurtAt = -Infinity; state.dead = null; state.phi = 0; state.sq = [0, 0]; state.act = null;
  const e = enemies[0]; Object.assign(e, { mode: 'swing', sq: [0, -1], dir: [0, 1], t0: 0, side: ENEMY_SWING_SIDE, struck: false, blocked: false });
  for (let t = 0, prev = 0; t < 1.3; prev = t, t += 1 / 60) {
    if (!state.act && t >= pressAt) state.act = { kind: 'parry', side, t0: pressAt };
    checkEnemyHits(prev, t, null, null);
    if (e.struck || e.blocked) return e.blocked ? 'parried' : 'hit@' + t.toFixed(2);
  }
  return 'miss';
};`, ctx);
module.exports = ctx;
if (require.main === module) {
  const side = Number(process.argv[3] || 1);
  const out = [];
  for (let p = 0.0; p <= 0.6; p += 0.05) out.push(p.toFixed(2) + ':' + ctx.sim(p, side));
  console.log(query, 'side', side, out.join(' '));
  for (const dt of [1 / 60, 0.05]) {
    let row = '';
    for (let p = 0.0; p <= 0.6; p += 0.025) { let ok = 0, n = 0; for (let ph = 0; ph < dt; ph += dt / 8) { n++; if (ctx.simFrames(p, side, dt, ph) === 'P') ok++; } row += ok === n ? 'P' : ok ? 'p' : '.'; }
    console.log('  dt', dt.toFixed(3), 'press 0..0.6 by 0.025:', row);
  }
}
