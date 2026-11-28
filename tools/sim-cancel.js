// Runs web/game.js's step and pose maths in node to check swing / parry cancels: the largest per-frame jump in the
// body's yaw and in the sword and shield channels (a snap shows up as a big jump), and the facing at the end.
// Usage: node tools/sim-cancel.js "?opts"
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
vm.runInContext(`const location = { search: ${JSON.stringify(query)} }; const document = { getElementById: () => (${el.toString()})() };
const flash = () => {}; const showHp = () => {}; const showStamina = () => {}; const banner = {}; ` + src + `
this.run = function (first, second, at) {
  state.phi = 0; state.sq = [0, 0]; state.act = null; state.nextSpawn = 1e9; queued = { kind: first[0], side: first[1] };
  let prev = null, jump = { yaw: 0 }, cancelled = false, kinds = [];
  for (let t = 0; t < 2.5; t += 1 / 60) {
    if (!cancelled && t >= at && second) { queued = { kind: second[0], side: second[1] }; cancelled = true; }
    step(t);
    const p = pose(t);
    if (state.act && kinds[kinds.length - 1] !== state.act.kind + state.act.side) kinds.push(state.act.kind + state.act.side);
    if (prev) {
      jump.yaw = Math.max(jump.yaw, Math.abs(p.phi - prev.phi));
      for (const n of CHANNELS) jump[n] = Math.max(jump[n] || 0, Math.abs(p.c[n] - prev.c[n]));
    }
    prev = p;
  }
  const r = {}; for (const k in jump) r[k] = +jump[k].toFixed(3);
  return { kinds: kinds.join(' > '), facing: +(state.phi / (Math.PI / 2)).toFixed(2), maxJump: r };
};`, ctx);
const cases = [
  ['swing left alone', ['swing', 1], null, 0],
  ['parry right alone', ['parry', -1], null, 0],
  ['swing left, parry right in wind-up (0.1 s)', ['swing', 1], ['parry', -1], 0.1],
  ['swing left, parry left in wind-up (0.1 s)', ['swing', 1], ['parry', 1], 0.1],
  ['swing left, parry right mid-slash (0.25 s): buffered', ['swing', 1], ['parry', -1], 0.25],
  ['swing left, parry right in recovery (0.45 s)', ['swing', 1], ['parry', -1], 0.45],
  ['parry left, swing right in cock (0.05 s)', ['parry', 1], ['swing', -1], 0.05],
  ['parry left, swing right mid-hold (0.25 s): too late, waits', ['parry', 1], ['swing', -1], 0.25],
  ['parry left, swing right in turn (0.5 s)', ['parry', 1], ['swing', -1], 0.5],
];
for (const [label, a, b, at] of cases) console.log(label.padEnd(58), JSON.stringify(ctx.run(a, b, at)));
