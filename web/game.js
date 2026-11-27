// Endless Board: the pawn from scenes/hop.js, carrying an ivory sword, on a chessboard that never ends.
// Dark pawns drop in from every side and hop forward; a sword hit cuts them in two along the blade's path.
// Rendered by ink-studio's WebGL renderer; the player's pawn and sword are re-shaded live as they turn.
import { createRenderer } from './ink/src/webgl/renderer.mjs';
import { createSplatInstances } from './ink/src/webgl/instances.mjs';

const K = KIT;
const params = new URLSearchParams(location.search);
// hop.js palette (0 bg, 1-5 ivory, 6-8 dark squares, 9-11 light squares) plus 12-16 ebony for the enemy pawns
const PALETTE = [0x0b0d14, 0x3a2f2a, 0x7a634f, 0xb89c7c, 0xe2cfae, 0xfff4dc,
  0x1c2230, 0x2a3448, 0x3a4862, 0x4d5d7c, 0x6a7da0, 0x8a9cc0,
  0x120d0e, 0x241a1a, 0x3b2c29, 0x5a4540, 0x7e655b];
const num = (name, fallback) => Number(params.get(name)) || fallback;   // ?name=value overrides, for feel testing
const SQ = 1.3;          // square size, as in hop.js
const WINDOW = num('w', 14); // squares kept around the pawn (even)
const HOP = num('hop', 1.0);       // seconds per hop, as in hop.js
const SWING = num('swing', 0.7);   // seconds per swing
// Dash and shield. Every value marked PLACEHOLDER is a stand-in until the design decides it.
const DASH = num('dash', 0.45);    // seconds per dash
const DASH_SQUARES = 2;            // a dash covers two squares, like a pawn's opening move
const DASH_BLOCKED = 'cancel';     // PLACEHOLDER: an enemy on either square cancels the dash (it does not stop short)
const BLOCK = num('block', 0.6);   // PLACEHOLDER: a block is a fixed-length move, not held
const BLOCK_TURNS = false;         // PLACEHOLDER: blocking does not change the pawn's facing
const SHIELD_REST = { sweep: 1.45, y: 0.5, r: 0.34 };   // off hand at rest: on the pawn's left side
const SHIELD_GUARD = { y: 0.78, r: 0.5 };                // raised to guard a front diagonal
const SHIELD_BAKE = [-24, 0.6, 40];                      // baked away from the pawn so it picks up no baked shadow
const CHAIN_AT = 0.9;    // a held key starts the next hop once the landing has mostly settled
const ART_HEIGHT = 168;  // art pixels down the screen
const HAND = [0.1, 0.55, -0.32];   // sword grip at rest: in front of the pawn (pawn faces -z), blade straight up
const BLADE = [0.14, 1.36];      // blade runs from just above the grip to the tip, along the sword's local +y
const ENEMIES = Number(params.get('enemies')) || 6;   // enemy pool size
const SPAWN_DIST = 6;            // enemies drop in this many squares away
const DESPAWN_DIST = 11;         // and vanish (inside the fog) past this
const SLOW = Number(params.get('slow')) || 1;          // ?slow=8 plays everything 8x slower, for inspection
const LIVE_LIGHT = params.get('light') !== 'baked';

const canvas = document.getElementById('view');
const status = document.getElementById('status');
const coords = document.getElementById('coords');
const taken = document.getElementById('taken');

// ---------- small vector helpers ----------

const mv = (M, v) => [M[0] * v[0] + M[1] * v[1] + M[2] * v[2], M[3] * v[0] + M[4] * v[1] + M[5] * v[2], M[6] * v[0] + M[7] * v[1] + M[8] * v[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => scale(a, 1 / (Math.hypot(...a) || 1));
const I3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const uniform = s => [s, 0, 0, 0, s, 0, 0, 0, s];
const rand = (a, b) => a + Math.random() * (b - a);

// ---------- bake ----------

function bakeSquare(ramp, seed) {
  const B = makeBuilder(seed, PALETTE);
  const S = K.sculpt(makeSculpt(B));
  S.box([0, -0.1, 0], [SQ / 2, 0.1, SQ / 2], ramp, { res: 0.07 });
  S.bake();
  const w = B.finish({ detail: 14, dither: 0.2, radius: 4.2 });
  // The board is never seen from below: keep the top face and the top of the sides.
  const keep = [];
  for (let i = 0; i < w.count; i++) if (w.data[i * 16 + 1] > -0.04) keep.push(i);
  const data = new Float32Array(keep.length * 16);
  keep.forEach((src, dst) => data.set(w.data.subarray(src * 16, src * 16 + 16), dst * 16));
  const proto = { data, count: keep.length };
  const normals = w.renderMetadata?.normals;
  if (normals) {
    const n = new Float32Array(keep.length * 3);
    keep.forEach((src, dst) => n.set(normals.subarray(src * 3, src * 3 + 3), dst * 3));
    proto.renderMetadata = { normals: n };
  }
  return proto;
}

// The pawn from hop.js, scaled to fit a square. `fine` = the player's resolution; enemies bake a little coarser.
const PK = 0.5;
// Each enemy is baked at its own spot, away from the player and each other: solids in one bake merge,
// and a neighbour's geometry would darken the baked lighting. The rig moves them from here.
const EREST = i => [30 + 3 * i, 0, 40];
const pawnProfile = t => PK * (t < 0.12 ? 0.95 : t < 0.2 ? 0.95 - (t - 0.12) * 2.5
  : t < 0.3 ? 0.75 - (t - 0.2) * 1.2 : 0.63 - Math.pow((t - 0.3) / 0.7, 0.6) * 0.35);
function sculptPawn(S, ramp, tag, fine, [x, y, z] = [0, 0, 0]) {
  const r = fine ? [0.035, 0.03] : [0.045, 0.04];
  S.lathe([x, y, z], 1.9 * PK, pawnProfile, ramp, { res: r[0], tag });
  S.lathe([x, y + 1.85 * PK, z], 0.16 * PK, [0.52 * PK, 0.5 * PK], ramp, { res: r[1], tag });
  S.ball([x, y + 2.55 * PK, z], 0.55 * PK, ramp, { res: r[1], tag });
}

function bakeWorld() {
  const B = makeBuilder(11, PALETTE);
  const S = K.sculpt(makeSculpt(B));
  const rig = K.rig(B, S);
  const capture = K.light.capture(B, S);   // remember each splat's ramp and normal, for live lighting
  const ivory = { r: [1, 2, 3, 4, 5] }, ebony = { r: [12, 13, 14, 15, 16] };

  // Blob shadows first (thin dark discs just above the board), so nothing bakes a shadow onto them
  S.lathe([0, 0.005, 0], 0.01, 0.42, { r: [6, 6] }, { res: 0.05, tag: 'shadow' });
  S.bake();
  for (let i = 0; i < ENEMIES; i++) { S.lathe(add(EREST(i), [0, 0.005, 0]), 0.01, 0.42, { r: [6, 6] }, { res: 0.06, tag: `e${i}sh` }); S.bake(); }

  sculptPawn(S, ivory, 'pawn', true);
  S.bake();

  // Ivory sword, baked upright in front of the pawn; the rig tilts and swings it
  const [hx, hy, hz] = HAND;
  const mid = (BLADE[0] + BLADE[1] - 0.1) / 2, half = (BLADE[1] - 0.1 - BLADE[0]) / 2;
  S.box([hx, hy + mid, hz], [0.046, half, 0.016], ivory, { res: 0.018, tag: 'sword' });               // blade
  S.box([hx, hy + BLADE[1] - 0.05, hz], [0.028, 0.05, 0.016], ivory, { res: 0.016, tag: 'sword' });   // tip
  S.box([hx, hy + 0.12, hz], [0.15, 0.024, 0.032], { r: [1, 2, 3] }, { res: 0.018, tag: 'sword' });   // crossguard
  S.box([hx, hy, hz], [0.024, 0.1, 0.024], { r: [1, 1, 2] }, { res: 0.018, tag: 'sword' });           // grip
  S.ball([hx, hy - 0.12, hz], 0.042, { r: [2, 3, 4] }, { res: 0.018, tag: 'sword' });                 // pommel
  S.bake();

  // Round shield for the off hand: a thin ellipsoid facing -z with a boss, baked on its own; the rig carries it
  S.ball(SHIELD_BAKE, [0.2, 0.24, 0.032], { r: [2, 3, 4] }, { res: 0.018, tag: 'shield' });
  S.ball(add(SHIELD_BAKE, [0, 0, -0.03]), 0.055, { r: [3, 4, 5] }, { res: 0.016, tag: 'shield' });
  S.bake();

  // Enemy pool: identical dark pawns, all baked at the origin and placed by the rig
  for (let i = 0; i < ENEMIES; i++) { sculptPawn(S, ebony, `e${i}`, false, EREST(i)); S.bake(); }
  for (let i = 0; i < ENEMIES; i++) rig.part(`e${i}cut`);   // the half a sword hit slices off, filled in on a hit

  const world = B.finish({
    cam: { target: [0, 0.6, 0], dist: 7.5, pitch: 0.38, yaw: 0.5 },
    detail: 14, dither: 0.2, radius: 11
  });
  // Fade distant squares into the background so the board's edge is never seen.
  world.fog = { c: 0, start: 0.42, max: 1 };
  const sun = { dir: S.sun, amb: S.amb, sky: S.sky, k: S.sunK, parts: ['pawn', 'sword', 'shield'], keep: Infinity };
  return { world, rig, capture, sun };
}

// ---------- animation curves ----------

const ease = x => x * x * (3 - 2 * x);
const easeOut = x => 1 - Math.pow(1 - x, 3);
const scaleY = sy => { const sx = 1 / Math.sqrt(sy); return [sx, 0, 0, 0, sy, 0, 0, 0, sx]; };
const rotY = a => K.M.rot([0, 1, 0], a);
const facingVec = phi => [-Math.sin(phi), -Math.cos(phi)];   // rotY(phi) applied to -z

// The hop curve from scenes/hop.js, for one hop with u in [0, 1]
function hopPose(u) {
  let along = 0, y = 0, sy = 1, tilt = 0;
  if (u < 0.22) {                    // anticipation: crouch
    sy = 1 - 0.22 * Math.sin((u / 0.22) * Math.PI / 2);
    tilt = 0.12 * (u / 0.22);
  } else if (u < 0.7) {              // airborne arc
    const a = (u - 0.22) / 0.48;
    along = ease(a);
    y = 0.8 * 4 * a * (1 - a);
    sy = 1 + 0.18 * Math.sin(a * Math.PI) * (a < 0.5 ? 1 : 0.4);
    tilt = 0.12 - 0.3 * a;           // lean forward, then back to land
  } else {                           // land, squash, settle
    const a = (u - 0.7) / 0.3;
    along = 1;
    sy = 1 - 0.25 * Math.exp(-6 * a) * Math.cos(a * 9);
    tilt = -0.18 * Math.exp(-6 * a);
  }
  return { along, y, sy, tilt };
}
const hopMatrix = (h, dir) => K.M.mul(K.M.rot([dir[1], 0, -dir[0]], h.tilt), scaleY(h.sy));

// One swing with u in [0, 1]; side +1 swings left, -1 right.
// The blade's world angle (body turn + sweep) runs from 100° on one side of the starting facing to 100° on the
// other, so it covers both front diagonals, then the body finishes a quarter turn toward the swing.
const ARC = 1.75;
function swingPose(u, side) {
  let sweep, lean, turn, sy, reach = 0, slashing = false;
  const start = -ARC * side + 0.15 * side, end = ARC * side - side * Math.PI / 2;   // sweep, relative to the body
  if (u < 0.25) {                    // wind up: draw the blade across to the far side, twist away, crouch
    const w = ease(u / 0.25);
    sweep = start * w; lean = 0.7 * w; turn = -side * 0.15 * w; sy = 1 - 0.08 * w;
  } else if (u < 0.55) {             // slash: arm extends, blade swings flat round the front; body follows a quarter turn
    const a = (u - 0.25) / 0.3, e = easeOut(a);
    sweep = start + (end - start) * e; lean = 0.7 + 0.85 * Math.sin(Math.PI * Math.min(1, a * 1.6) / 2) - 0.3 * Math.max(0, a - 0.7);
    turn = side * (-0.15 + (Math.PI / 2 + 0.15) * e); sy = 0.92 + 0.16 * Math.sin(Math.PI * a);
    reach = 0.22 * Math.sin(Math.PI * a); slashing = true;
  } else {                           // recover: blade back up in front, body settles with a small wobble
    const a = (u - 0.55) / 0.45, r = 1 - ease(a);
    sweep = end * r; lean = 1.46 * r;
    turn = side * (Math.PI / 2 + 0.06 * Math.exp(-5 * a) * Math.sin(a * 12));
    sy = 1 - 0.06 * Math.exp(-6 * a) * Math.cos(a * 10);
  }
  return { sweep, lean, turn, sy, reach, slashing };
}

// One dash with u in [0, 1]: a short crouch, a fast low skim over two squares with a hard forward lean, a braking skid.
// `along` runs 0..1 over the whole dash distance.
function dashPose(u) {
  let along = 0, y = 0, sy = 1, tilt = 0;
  if (u < 0.15) {                    // coil
    const a = u / 0.15;
    sy = 1 - 0.16 * Math.sin(a * Math.PI / 2); tilt = 0.1 * a;   // (positive tilt leans back, as in hopPose)
  } else if (u < 0.72) {             // skim: low and fast, leaning into it
    const a = (u - 0.15) / 0.57;
    along = 1 - Math.pow(1 - a, 2.2);
    y = 0.16 * Math.sin(Math.PI * a);
    sy = 0.86 + 0.1 * Math.sin(Math.PI * a);
    tilt = 0.1 * (1 - a) - 0.42 * Math.sin(Math.PI * Math.min(1, a * 1.25));
  } else {                           // brake: the lean snaps back past upright, then settles
    const a = (u - 0.72) / 0.28;
    along = 1;
    sy = 1 - 0.18 * Math.exp(-5 * a) * Math.cos(a * 9);
    tilt = 0.28 * Math.sin(Math.PI * Math.min(1, a * 1.5)) * Math.exp(-2 * a);
  }
  return { along, y, sy, tilt };
}

// One block with u in [0, 1]; side +1 guards the front-left diagonal, -1 the front-right.
// The shield comes up and out to that diagonal, holds, and drops back to the pawn's side.
function blockPose(u, side) {
  const up = u < 0.25 ? easeOut(u / 0.25) : u < 0.7 ? 1 : 1 - ease((u - 0.7) / 0.3);
  const turn = side * 0.22 * up;                                  // the body twists a little toward the guard
  const goal = side * Math.PI / 4 - turn;                         // shield sweep, relative to the body
  const jolt = u > 0.2 && u < 0.45 ? 0.04 * Math.sin(Math.PI * (u - 0.2) / 0.25) : 0;   // braces as it lands
  return {
    turn, sy: 1 - 0.07 * up - jolt,
    shield: { sweep: SHIELD_REST.sweep + (goal - SHIELD_REST.sweep) * up,
      y: SHIELD_REST.y + (SHIELD_GUARD.y - SHIELD_REST.y) * up, r: SHIELD_REST.r + (SHIELD_GUARD.r - SHIELD_REST.r) * up,
      tilt: -0.18 * up },
    // the sword drops back and out of the way while the shield is up
    sword: { sweep: -side * 0.5 * up, lean: -0.35 * up }
  };
}

// ---------- game state ----------

const state = {
  sq: [0, 0],        // pawn square, absolute (x, z) indices
  origin: [0, 0],    // render origin square; kept near the pawn so coordinates stay small
  phi: 0,            // facing: the pawn looks along facingVec(phi); quarter turns only
  act: null,         // { kind: 'hop' | 'dash', dir, t0 } or { kind: 'swing' | 'block', side, t0 }
  orbit: 0, pitch: 0.38, dist: 7.5, yaw: 0.5,
  target: [0, 0.6, 0],
  taken: 0,
  nextSpawn: 1.5
};
window.__endless = state; // for tests
const held = new Set();   // sources holding "forward"
let queued = null;         // { kind, side } waiting for the current action to finish

// Enemies: { i, mode: 'off' | 'drop' | 'idle' | 'hop' | 'dying', sq, dir, t0, wait, cut }
const enemies = Array.from({ length: ENEMIES }, (_, i) => ({ i, mode: 'off', sq: [0, 0], dir: [0, -1], t0: 0, wait: 0, dirty: true }));
window.__enemies = enemies; // for tests
const sqKey = (x, z) => x + ',' + z;

function occupied() {
  const o = new Set([sqKey(...state.sq)]);
  if (state.act?.kind === 'hop') o.add(sqKey(state.sq[0] + state.act.dir[0], state.sq[1] + state.act.dir[1]));
  if (state.act?.kind === 'dash')
    for (let k = 1; k <= DASH_SQUARES; k++) o.add(sqKey(state.sq[0] + k * state.act.dir[0], state.sq[1] + k * state.act.dir[1]));
  for (const e of enemies) {
    if (e.mode === 'off' || e.mode === 'dying') continue;
    o.add(sqKey(...e.sq));
    if (e.mode === 'hop') o.add(sqKey(e.sq[0] + e.dir[0], e.sq[1] + e.dir[1]));
  }
  return o;
}

function spawn(now) {
  const e = enemies.find(e => e.mode === 'off');
  if (!e) return;
  const taken = occupied();
  for (let tries = 0; tries < 12; tries++) {
    // From a random side, a few squares across, facing in toward the player's rows
    const out = [[1, 0], [-1, 0], [0, 1], [0, -1]][Math.floor(Math.random() * 4)];
    const across = Math.round(rand(-3, 3));
    const sq = [state.sq[0] + out[0] * SPAWN_DIST + out[1] * across, state.sq[1] + out[1] * SPAWN_DIST + out[0] * across];
    if (taken.has(sqKey(...sq))) continue;
    Object.assign(e, { mode: 'drop', sq, dir: [-out[0], -out[1]], t0: now, wait: rand(0.6, 2.5), dirty: true });
    return;
  }
}

function stepEnemies(now) {
  if (now >= state.nextSpawn) {
    if (enemies.filter(e => e.mode !== 'off').length < ENEMIES - 1) spawn(now);
    state.nextSpawn = now + rand(1.2, 3.2);
  }
  for (const e of enemies) {
    const far = Math.max(Math.abs(e.sq[0] - state.sq[0]), Math.abs(e.sq[1] - state.sq[1])) > DESPAWN_DIST;
    if (e.mode !== 'off' && e.mode !== 'dying' && far) { e.mode = 'off'; e.dirty = true; continue; }
    if (e.mode === 'drop' && now - e.t0 >= 0.75) { e.mode = 'idle'; e.t0 = now; }
    if (e.mode === 'hop' && now - e.t0 >= HOP) {
      e.sq = [e.sq[0] + e.dir[0], e.sq[1] + e.dir[1]];
      e.mode = 'idle'; e.t0 = now; e.wait = rand(0.4, 2.8);
    }
    if (e.mode === 'idle' && now - e.t0 >= e.wait) {
      const next = sqKey(e.sq[0] + e.dir[0], e.sq[1] + e.dir[1]);
      if (!occupied().has(next)) { e.mode = 'hop'; e.t0 = now; }
      else { e.t0 = now; e.wait = rand(0.3, 1.2); }
    }
    if (e.mode === 'dying' && now - e.t0 >= 1.6) { e.mode = 'off'; e.dirty = true; e.restore = true; }
  }
}

function step(now) {
  const a = state.act;
  if (a) {
    const u = (now - a.t0) / DURATION[a.kind];
    const chain = a.kind === 'hop' && u >= CHAIN_AT && (held.size || queued);
    if (u >= 1 || chain) {
      if (a.kind === 'hop') { state.sq[0] += a.dir[0]; state.sq[1] += a.dir[1]; }
      else if (a.kind === 'dash') { state.sq[0] += DASH_SQUARES * a.dir[0]; state.sq[1] += DASH_SQUARES * a.dir[1]; }
      else if (a.kind === 'swing' || (a.kind === 'block' && BLOCK_TURNS)) state.phi += a.side * Math.PI / 2;
      state.act = null;
    }
  }
  if (!state.act) {
    const next = queued ?? (held.size ? { kind: 'hop' } : null);
    queued = null;
    if (next?.kind === 'hop' || next?.kind === 'dash') {
      const [fx, fz] = facingVec(state.phi), dir = [Math.round(fx), Math.round(fz)];
      // An enemy standing on a square the move passes through blocks it
      const n = next.kind === 'dash' ? DASH_SQUARES : 1;
      const stands = k => enemies.some(e => (e.mode === 'idle' || e.mode === 'drop') && e.sq[0] === state.sq[0] + k * dir[0] && e.sq[1] === state.sq[1] + k * dir[1]);
      let blocked = false;
      for (let k = 1; k <= n; k++) blocked ||= stands(k);
      if (!blocked) state.act = { kind: next.kind, dir, t0: now };
    } else if (next) state.act = { kind: next.kind, side: next.side, t0: now };
  }
  stepEnemies(now);
  // Rebase so render coordinates stay small however far the pawn walks.
  // Shifts are even, so every square keeps its colour and nothing visibly moves.
  for (const i of [0, 1]) {
    const off = state.sq[i] - state.origin[i];
    if (Math.abs(off) > 32) {
      const shift = off - (off & 1);
      state.origin[i] += shift;
      state.target[i ? 2 : 0] -= shift * SQ;
      for (const e of enemies) if (e.cut) { e.cut.g[i ? 2 : 0] -= shift * SQ; e.cut.pos[i ? 2 : 0] -= shift * SQ; }
    }
  }
}

const DURATION = { hop: HOP, dash: DASH, swing: SWING, block: BLOCK };
const toRender = sq => [(sq[0] - state.origin[0]) * SQ, (sq[1] - state.origin[1]) * SQ];

// Player pose, including where the sword is
function pose(now) {
  let [x, z] = toRender(state.sq);
  let y = 0, phi = state.phi, A = rotY(phi);
  let sweep = 0, lean = 0, reach = 0, slashing = false, u = 0, side = 0;
  let sh = { ...SHIELD_REST, tilt: 0 };
  const a = state.act;
  if (a?.kind === 'hop' || a?.kind === 'dash') {
    const dash = a.kind === 'dash';
    const h = (dash ? dashPose : hopPose)(Math.min(1, (now - a.t0) / DURATION[a.kind]));
    const d = (dash ? DASH_SQUARES : 1) * SQ * h.along;
    x += a.dir[0] * d; z += a.dir[1] * d; y = h.y;
    A = K.M.mul(hopMatrix(h, a.dir), rotY(phi));
    if (dash) { lean = -0.5 * Math.min(1, Math.max(0, -h.tilt / 0.4)); sh.r += 0.04; }   // sword and shield swept back by the rush
  } else if (a?.kind === 'swing') {
    u = Math.min(1, (now - a.t0) / SWING); side = a.side;
    const s = swingPose(u, a.side);
    phi += s.turn;
    A = K.M.mul(scaleY(s.sy), rotY(phi));
    ({ sweep, lean, reach, slashing } = s);
    // tuck the shield round behind the left side so the blade's arc clears it
    const tuck = Math.sin(Math.PI * Math.min(1, u * 1.15));
    sh.sweep += 0.9 * tuck; sh.r -= 0.04 * tuck;
  } else if (a?.kind === 'block') {
    u = Math.min(1, (now - a.t0) / BLOCK); side = a.side;
    const b = blockPose(u, a.side);
    phi += b.turn;
    A = K.M.mul(scaleY(b.sy), rotY(phi));
    sh = b.shield; sweep = b.sword.sweep; lean = b.sword.lean;
  }
  // Sword: carried round the pawn's axis by `sweep`, tilted outward by `lean`, held further out by `reach`
  const grip = mv(rotY(sweep), [HAND[0], HAND[1], HAND[2] - reach]);
  const swordA = K.M.mul(rotY(sweep), K.M.rot([1, 0, 0], -lean));
  // Shield: carried round the pawn's axis, its face pointing outward along `sweep`
  const shieldAt = mv(rotY(sh.sweep), [0, sh.y, -sh.r]);
  const shieldA = K.M.mul(rotY(sh.sweep), K.M.rot([1, 0, 0], sh.tilt));
  return { x, y, z, A, phi, grip, swordA, shieldAt, shieldA, slashing, u, side };
}

// World-space point t along the blade, for a pose
function bladePoint(p, t) {
  return add([p.x, p.y, p.z], mv(p.A, add(p.grip, mv(p.swordA, [0, t, 0]))));
}

// Enemy pose: position and matrix
function enemyPose(e, now) {
  let [x, z] = toRender(e.sq), y = 0, A = I3;
  const u = now - e.t0;
  if (e.mode === 'drop') {           // falls in from above, lands with the hop's squash
    if (u < 0.4) { const f = u / 0.4; y = 4 * (1 - f * f); }
    else { const h = hopPose(0.7 + 0.3 * Math.min(1, (u - 0.4) / 0.35)); A = scaleY(h.sy); }
  } else if (e.mode === 'hop') {
    const h = hopPose(Math.min(1, u / HOP));
    x += e.dir[0] * SQ * h.along; z += e.dir[1] * SQ * h.along; y = h.y;
    A = hopMatrix(h, e.dir);
  }
  return { x, y, z, A };
}

// ---------- hits ----------

function checkHits(prev, cur, stage, rig) {
  if (!cur.slashing && !prev?.slashing) return;
  const steps = 4, hitR = 0.34;
  for (const e of enemies) {
    if (e.mode !== 'idle' && e.mode !== 'hop' && e.mode !== 'drop') continue;
    const ep = enemyPose(e, cur.now);
    for (let s = 1; s <= steps && e.mode !== 'dying'; s++) {
      const p = s === steps || !prev ? cur : lerpPose(prev, cur, s / steps);
      for (let t = 0.35; t <= BLADE[1]; t += 0.12) {
        const b = bladePoint(p, t);
        if (Math.hypot(b[0] - ep.x, b[2] - ep.z) < hitR && b[1] > ep.y + 0.05 && b[1] < ep.y + 1.5) {
          slice(e, ep, p, t, stage, rig, cur.now);
          break;
        }
      }
    }
  }
}
// Between two frames, re-evaluate the swing at an intermediate time so fast blades can't skip an enemy
function lerpPose(prev, cur, f) {
  return pose(prev.now + (cur.now - prev.now) * f);
}

// Cut an enemy in two along the blade's path: the plane holds the blade and the direction it is sweeping.
function slice(e, ep, p, t, stage, rig, now) {
  const g = bladePoint(p, t);
  const d = norm(sub(bladePoint(p, BLADE[1]), bladePoint(p, BLADE[0])));
  const ahead = pose(now + 0.01);
  const v = norm(sub(bladePoint(ahead, t), g));
  let n = norm(cross(d, v));
  if (Math.hypot(...n) < 0.5 || !isFinite(n[0])) n = [0, 1, 0];
  if (n[1] < 0) n = scale(n, -1);
  // Freeze the enemy where it stands, upright, and sort its splats by side of the plane
  const pos = [ep.x, 0, ep.z];
  const part = rig.part(`e${e.i}`), cutPart = `e${e.i}cut`;
  const base = stage.base, top = [], rest = EREST(e.i);
  for (const i of e.rows) {
    const w = [base[i * 16] - rest[0] + pos[0], base[i * 16 + 1], base[i * 16 + 2] - rest[2] + pos[2]];
    if (dot(sub(w, g), n) > 0) top.push(i);
  }
  if (top.length && top.length < e.rows.length) rig.assign(cutPart, top);
  // Height where the plane crosses the enemy's axis: the top half hinges about that point
  const h = Math.min(1.4, Math.max(0.15, g[1] - (n[0] * (pos[0] - g[0]) + n[2] * (pos[2] - g[2])) / n[1]));
  const slide = norm([v[0], 0, v[2]]);
  e.mode = 'dying'; e.t0 = now; e.dirty = true;
  e.cut = { g, n, h, slide, pos, part, split: top.length > 0 && top.length < e.rows.length };
  state.taken++;
  taken.textContent = state.taken;
}

// Death: the top half slides off along the cut and topples to the board; the base wobbles; then both shrink away
function dyingPoses(e, now) {
  const c = e.cut, u = now - e.t0;
  const hinge = add(EREST(e.i), [0, c.h, 0]);
  const fall = Math.min(1, Math.max(0, (u - 0.06) / 0.7));
  const slideD = 0.55 * easeOut(Math.min(1, u / 0.45));
  const tip = 1.45 * fall * fall;                                   // topples over, accelerating
  const axis = norm(cross([0, 1, 0], c.slide));
  const drop = -c.h * 0.85 * Math.pow(fall, 2.2) + 0.12 * Math.sin(Math.PI * Math.min(1, u / 0.3));
  const shrink = u < 1.05 ? 1 : Math.max(0.001, 1 - ease((u - 1.05) / 0.5));
  const topA = K.M.mul(uniform(shrink), K.M.rot(axis, tip));
  const topP = add(add(c.pos, [0, c.h, 0]), add(scale(c.slide, slideD), [0, drop, 0]));
  const wob = 1 - 0.12 * Math.exp(-5 * u) * Math.cos(u * 18);
  const baseA = K.M.mul(uniform(shrink), scaleY(wob));
  return { topA, topP, baseA, basePos: c.pos, hinge, shrink, rest: EREST(e.i) };
}

// ---------- input ----------

const press = (kind, side = 0) => { queued = { kind, side }; };
// PLACEHOLDER bindings for the new moves: Space / Shift dash, Z / C block left / right
const KEYS = {
  KeyA: ['swing', 1], ArrowLeft: ['swing', 1], KeyQ: ['swing', 1],
  KeyD: ['swing', -1], ArrowRight: ['swing', -1], KeyE: ['swing', -1],
  Space: ['dash'], ShiftLeft: ['dash'], ShiftRight: ['dash'],
  KeyZ: ['block', 1], KeyC: ['block', -1]
};
addEventListener('keydown', e => {
  if (e.code === 'KeyW' || e.code === 'ArrowUp') { held.add(e.code); e.preventDefault(); return; }
  if (e.repeat || !KEYS[e.code]) return;
  press(...KEYS[e.code]); e.preventDefault();
});
addEventListener('keyup', e => held.delete(e.code));
addEventListener('blur', () => held.clear());

const fwd = document.getElementById('pad-up');
fwd.addEventListener('pointerdown', e => {
  e.preventDefault();
  fwd.setPointerCapture?.(e.pointerId);
  if (!state.act) queued = { kind: 'hop' };
  held.add('pad');
});
for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) fwd.addEventListener(ev, () => held.delete('pad'));
for (const btn of document.querySelectorAll('[data-move]'))
  btn.addEventListener('pointerdown', e => { e.preventDefault(); press(btn.dataset.move, Number(btn.dataset.side || 0)); });

// Drag on the board to orbit the camera around the pawn; it stays where you leave it
let drag = null;
canvas.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, orbit: state.orbit, pitch: state.pitch }; canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener('pointermove', e => {
  if (!drag) return;
  const k = 4 / Math.max(innerWidth, 1);
  state.orbit = drag.orbit - (e.clientX - drag.x) * k;
  state.pitch = Math.min(0.9, Math.max(0.18, drag.pitch + (e.clientY - drag.y) * k));
});
const endDrag = () => { drag = null; };
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('dblclick', () => { state.orbit = 0; state.pitch = 0.38; });
canvas.addEventListener('wheel', e => {
  state.dist = Math.min(12, Math.max(4.5, state.dist * Math.exp(e.deltaY * 0.001)));
  e.preventDefault();
}, { passive: false });

// ---------- run ----------

function artSize() {
  const aspect = Math.max(0.5, Math.min(2.6, innerWidth / Math.max(1, innerHeight)));
  return { width: Math.round(ART_HEIGHT * aspect), height: ART_HEIGHT };
}

function start() {
  const t0 = performance.now();
  const light = bakeSquare({ r: [9, 10, 11] }, 21);
  const dark = bakeSquare({ r: [6, 7, 8] }, 22);
  const { world, rig, capture, sun } = bakeWorld();

  const placements = [], slots = [];
  for (let i = 0; i < WINDOW; i++)
    for (let j = 0; j < WINDOW; j++) {
      const id = `sq-${i}-${j}`;
      placements.push({ id, prototype: (i + j) & 1 ? 'dark' : 'light', position: [i * SQ, 0, j * SQ] });
      slots.push({ id, i, j, x: i, z: j });
    }
  const board = createSplatInstances({ light, dark }, placements);

  const stage = K.stage(world);
  rig.bind(stage);
  for (const e of enemies) e.rows = Int32Array.from(rig.list[rig.part(`e${e.i}`)]);   // this enemy's splats

  let p = pose(0);
  const HIDDEN = [uniform(0.001), [0, 0, 0], [0, -60, 0]];
  stage.add({
    pre() {
      rig.set('pawn', p.A, [0, 0, 0], [p.x, p.y, p.z]);
      rig.child('sword', 'pawn', p.swordA, HAND, p.grip);
      rig.child('shield', 'pawn', p.shieldA, SHIELD_BAKE, p.shieldAt);
      const sh = 1 - 0.45 * Math.min(1, p.y / 0.8);
      rig.set('shadow', [sh, 0, 0, 0, 1, 0, 0, 0, sh], [0, 0, 0], [p.x, 0, p.z]);
      for (const e of enemies) {
        const body = `e${e.i}`, cut = `e${e.i}cut`, shadow = `e${e.i}sh`;
        if (e.restore) {   // put a sliced enemy back together for its next life
          if (e.cut?.split) rig.assign(body, e.rows);
          e.cut = null; e.restore = false;
        }
        if (e.mode === 'off') {
          if (e.dirty) { for (const n of [body, cut, shadow]) rig.set(n, ...HIDDEN); e.dirty = false; }
          continue;
        }
        if (e.mode === 'dying') {
          const d = dyingPoses(e, p.now);
          rig.set(body, d.baseA, d.rest, d.basePos);
          rig.set(cut, d.topA, d.hinge, d.topP);
          rig.set(shadow, uniform(Math.max(0.001, 0.9 * d.shrink)), d.rest, d.basePos);
          continue;
        }
        const ep = enemyPose(e, p.now);
        rig.set(body, ep.A, EREST(e.i), [ep.x, ep.y, ep.z]);
        rig.set(cut, ...HIDDEN);
        const s = 1 - 0.6 * Math.min(1, ep.y / 2);
        rig.set(shadow, [s, 0, 0, 0, 1, 0, 0, 0, s], EREST(e.i), [ep.x, 0, ep.z]);
      }
      rig.apply();
    }
  });
  // Live lighting: every frame the pawn and sword splats are re-shaded from their turned normals
  // against the fixed sun, stepping along their own palette ramps (the baked shading is the rest pose).
  if (LIVE_LIGHT) stage.add(K.light.system(stage, capture, [], { sun }));

  const renderer = createRenderer(canvas, { toolkit: { KIT, PixelLook } });
  status.hidden = true;
  console.log('baked in', Math.round(performance.now() - t0), 'ms;', world.count, 'splats in the world,', light.count + dark.count, 'per square pair; live light', LIVE_LIGHT);

  // Everything in the base world is re-posed every frame: mark all of its rows changed
  const allRows = Array.from({ length: Math.ceil(world.count / 512) }, (_, i) => i);
  let last = performance.now(), prev = null;
  function frame(ms) {
    // window.__clock (seconds), when a test sets it, replaces the real clock so frames can be inspected one by one
    const now = window.__clock ?? ms / 1000 / SLOW, dt = window.__clock !== undefined ? 1 / 60 : Math.min(0.1, (ms - last) / 1000 / SLOW);
    last = ms;
    step(now);
    p = pose(now);
    p.now = now;
    checkHits(prev, p, stage, rig);
    prev = p;
    window.__frames = (window.__frames || 0) + 1;

    // Keep a WINDOW × WINDOW patch of squares centred on the pawn
    const cx = Math.round(p.x / SQ), cz = Math.round(p.z / SQ), moved = [];
    for (const sl of slots) {
      const x = sl.i + WINDOW * Math.round((cx - sl.i) / WINDOW);
      const z = sl.j + WINDOW * Math.round((cz - sl.j) / WINDOW);
      if (x !== sl.x || z !== sl.z) {
        sl.x = x; sl.z = z;
        moved.push({ id: sl.id, position: [x * SQ, 0, z * SQ] });
      }
    }
    if (moved.length) board.updateTransforms(moved);

    // Third-person camera: behind the pawn's facing (3/4 offset), easing round as it turns
    const goalYaw = p.phi + 0.5 + state.orbit;
    state.yaw += (goalYaw - state.yaw) * (1 - Math.exp(-dt * 6));
    const [fx, fz] = facingVec(p.phi);
    const goal = [p.x + fx * 0.6, 0.6, p.z + fz * 0.6];
    const follow = 1 - Math.exp(-dt * 4);
    for (const i of [0, 1, 2]) state.target[i] += (goal[i] - state.target[i]) * follow;

    world.anim.update(dt, now);
    const { width, height } = artSize();
    renderer.render(world, {
      width, height, time: now, instances: board, changedRows: allRows,
      camera: { target: state.target, dist: state.dist * Math.max(1, Math.sqrt(0.9 * height / width)), yaw: state.yaw, pitch: state.pitch }
    });
    coords.textContent = `${state.sq[0]}, ${-state.sq[1]}`;
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

// Let the loading message paint before the bake blocks the thread
requestAnimationFrame(() => setTimeout(() => {
  try { start(); }
  catch (err) {
    console.error(err);
    status.hidden = false;
    status.textContent = 'The board could not start: ' + err.message;
  }
}, 30));
