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
  state.phi = 0; state.sq = [0, 0]; state.act = null; state.nextSpawn = 1e9; queued = { kind: first[0], side: first[1], q: first[2] };
  let prev = null, jump = { yaw: 0 }, cancelled = false, kinds = [];
  for (let t = 0; t < 2.5; t += 1 / 60) {
    if (!cancelled && t >= at && second) { queued = { kind: second[0], side: second[1], q: second[2] }; cancelled = true; }
    step(t);
    const p = pose(t);
    const id = state.act && state.act.kind + state.act.side + (state.act.q === 2 ? '(180)' : '');
    if (id && kinds[kinds.length - 1] !== id) kinds.push(id);
    if (prev) {
      jump.yaw = Math.max(jump.yaw, Math.abs(p.phi - prev.phi));
      for (const n of CHANNELS) jump[n] = Math.max(jump[n] || 0, Math.abs(p.c[n] - prev.c[n]));
    }
    prev = p;
  }
  const r = {}; for (const k in jump) r[k] = +jump[k].toFixed(3);
  return { kinds: kinds.join(' > '), facing: +(state.phi / (Math.PI / 2)).toFixed(2), maxJump: r };
};
// An enemy on square (ex, ez) facing the player swings at t = 0; the player presses a move at pressAt. Returns
// 'P' parried, 'h' hit, 'k' killed it first, '-' nothing.
this.duel = function (ex, ez, move, pressAt) {
  state.hp = 99; state.hurtAt = -Infinity; state.dead = null; state.phi = 0; state.sq = [0, 0]; state.act = null; state.nextSpawn = 1e9; queued = null;
  const e = enemies[0]; Object.assign(e, { mode: 'swing', sq: [ex, ez], dir: ez ? [0, -Math.sign(ez)] : [-Math.sign(ex), 0], t0: 0, side: ENEMY_SWING_SIDE, struck: false, blocked: false, stunUntil: 0, rows: [] });
  let prev = null;
  for (let t = 0; t < 1.6; t += 1 / 60) {
    if (!queued && !state.act && t >= pressAt && t < pressAt + 0.02) queued = { kind: move[0], side: move[1], q: move[2] };
    step(t); const p = pose(t);
    if (prev && (p.slashing || prev.slashing))
      for (let k = 1; k <= 10; k++) {
        const tm = prev.now + (t - prev.now) * k / 10, pp = pose(tm), ep = enemyPose(e, tm);
        if (pp.slashing && BLADE_TS.some(bt => touchesPawn(ep, bladePoint(pp, bt)))) return 'k';
      }
    checkEnemyHits(prev ? prev.now : t, t, null, null);
    if (e.struck || e.blocked) return e.blocked ? 'P' : 'h';
    prev = p;
  }
  return '-';
};
// An idle enemy on (ex, ez) facing dir, the player standing still: which side does it swing, and does it land?
this.ambush = function (ex, ez, dir) {
  state.hp = 99; state.hurtAt = -Infinity; state.dead = null; state.phi = 0; state.sq = [0, 0]; state.act = null; state.nextSpawn = 1e9; queued = null;
  const e = enemies[0]; Object.assign(e, { mode: 'idle', sq: [ex, ez], dir, t0: 0, wait: 1e9, rested: 0, stunUntil: 0, struck: false, blocked: false });
  for (let t = 0, prev = 0; t < 1.6; prev = t, t += 1 / 60) { step(t); checkEnemyHits(prev, t, null, null); if (e.struck) break; }
  return { side: e.side, hit: e.struck };
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
  ['spin slash alone (180)', ['swing', -1, 2], null, 0],
  ['180 block alone', ['parry', 1, 2], null, 0],
  ['swing left, cancel into spin in wind-up', ['swing', 1], ['swing', -1, 2], 0.1],
  ['spin, cancel into 180 block in recovery', ['swing', -1, 2], ['parry', 1, 2], 0.45],
];
for (const [label, a, b, at] of cases) console.log(label.padEnd(58), JSON.stringify(ctx.run(a, b, at)));
// 180 block and spin slash against an enemy straight behind and on each back diagonal (press times 0..0.6 s)
for (const [name, move] of [['180 block', ['parry', 1, 2]], ['spin slash', ['swing', -1, 2]], ['quarter parry left (ahead)', ['parry', 1]], ['quarter swing left (ahead)', ['swing', 1]]]) {
  for (const [ex, ez, where] of name.includes('ahead') ? [[0, -1, 'ahead'], [-1, -1, 'front-left'], [1, -1, 'front-right']] : [[0, 1, 'behind'], [-1, 1, 'back-left'], [1, 1, 'back-right']]) {
    let row = '';
    for (let at = 0; at <= 0.6; at += 0.025) row += ctx.duel(ex, ez, move, at);
    console.log((name + ' vs ' + where).padEnd(34), row);
  }
}
// Enemies pick their swing side from where the player is
for (const [label, ex, ez, dir] of [['player ahead of it', 0, -1, [0, 1]], ['player on its front-left', -1, -1, [0, 1]], ['player on its front-right', 1, -1, [0, 1]]])
  console.log(('enemy swing, ' + label).padEnd(34), JSON.stringify(ctx.ambush(ex, ez, dir)));
