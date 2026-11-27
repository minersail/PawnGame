// Endless Board: the pawn from scenes/hop.js, now carrying a sword, on a chessboard that never ends.
// Rendered by ink-studio's WebGL renderer; lighting on the pawn and sword is re-shaded live as they turn.
import { createRenderer } from './ink/src/webgl/renderer.mjs';
import { createSplatInstances } from './ink/src/webgl/instances.mjs';

const K = KIT;
// hop.js palette (0 bg, 1-5 ivory, 6-8 dark squares, 9-11 light squares) plus 12-15 steel and 16-18 brass/leather
const PALETTE = [0x0b0d14, 0x3a2f2a, 0x7a634f, 0xb89c7c, 0xe2cfae, 0xfff4dc,
  0x1c2230, 0x2a3448, 0x3a4862, 0x4d5d7c, 0x6a7da0, 0x8a9cc0,
  0x2b2f3a, 0x5c6374, 0x9ba4b6, 0xdfe5ef,
  0x4a2f1c, 0x8a5a2e, 0xc8954c];
const SQ = 1.3;          // square size, as in hop.js
const WINDOW = Number(new URLSearchParams(location.search).get('w')) || 14; // squares kept around the pawn (even)
const HOP = 1.0;         // seconds per hop, as in hop.js
const SWING = 0.7;       // seconds per swing
const CHAIN_AT = 0.9;    // a held key starts the next hop once the landing has mostly settled
const ART_HEIGHT = 168;  // art pixels down the screen
const HAND = [0.3, 0.6, -0.06]; // sword grip, in the pawn's rest coordinates (pawn faces -z)

const canvas = document.getElementById('view');
const status = document.getElementById('status');
const coords = document.getElementById('coords');

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

function bakePawn() {
  const B = makeBuilder(11, PALETTE);
  const S = K.sculpt(makeSculpt(B));
  const rig = K.rig(B, S);
  const capture = K.light.capture(B, S);   // remember each splat's ramp and normal, for live lighting
  const ivory = { r: [1, 2, 3, 4, 5] }, steel = { r: [12, 13, 14, 15] };
  const brass = { r: [16, 17, 18] }, leather = { r: [16, 16, 17] };

  // Fake blob shadow: a thin dark disc just above the board, its own rig part
  S.lathe([0, 0.005, 0], 0.01, 0.42, { r: [6, 6] }, { res: 0.05, tag: 'shadow' });
  S.bake();

  // Pawn (all parts share one rig tag), scaled down to fit a square
  const k = 0.5;
  const profile = t => k * (t < 0.12 ? 0.95 : t < 0.2 ? 0.95 - (t - 0.12) * 2.5
    : t < 0.3 ? 0.75 - (t - 0.2) * 1.2 : 0.63 - Math.pow((t - 0.3) / 0.7, 0.6) * 0.35);
  S.lathe([0, 0, 0], 1.9 * k, profile, ivory, { res: 0.035, tag: 'pawn' });
  S.lathe([0, 1.85 * k, 0], 0.16 * k, [0.52 * k, 0.5 * k], ivory, { res: 0.03, tag: 'pawn' });
  S.ball([0, 2.55 * k, 0], 0.55 * k, ivory, { res: 0.03, tag: 'pawn' });
  S.bake();

  // Sword, baked upright in the pawn's hand; the rig tilts and swings it
  const [hx, hy, hz] = HAND;
  S.box([hx, hy + 0.52, hz], [0.016, 0.38, 0.042], steel, { res: 0.018, tag: 'sword' });        // blade
  S.box([hx, hy + 0.93, hz], [0.016, 0.04, 0.026], steel, { res: 0.016, tag: 'sword' });        // tip
  S.box([hx, hy + 0.12, hz], [0.03, 0.022, 0.14], brass, { res: 0.018, tag: 'sword' });         // crossguard
  S.box([hx, hy, hz], [0.024, 0.1, 0.024], leather, { res: 0.018, tag: 'sword' });              // grip
  S.ball([hx, hy - 0.12, hz], 0.04, brass, { res: 0.018, tag: 'sword' });                       // pommel
  S.bake();

  const world = B.finish({
    cam: { target: [0, 0.6, 0], dist: 7.5, pitch: 0.38, yaw: 0.5 },
    detail: 14, dither: 0.2, radius: 11
  });
  // Fade distant squares into the background so the board's edge is never seen.
  world.fog = { c: 0, start: 0.42, max: 1 };
  const sun = { dir: S.sun, amb: S.amb, sky: S.sky, k: S.sunK, parts: ['pawn', 'sword'], keep: Infinity };
  return { world, rig, capture, sun };
}

// ---------- animation ----------

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

// One swing with u in [0, 1]. side +1 swings left, -1 swings right.
// sweep: sword angle about the pawn's vertical axis; lean: blade tilt toward the front; turn: pawn's added yaw.
const SWEEP = { 1: { wind: -0.8, end: 2.2 }, [-1]: { wind: 1.7, end: -1.2 } };
function swingPose(u, side) {
  const { wind, end } = SWEEP[side];
  let sweep, lean, turn, sy;
  if (u < 0.25) {                    // wind up: draw the blade back, twist the other way, crouch
    const w = ease(u / 0.25);
    sweep = wind * w; lean = 0.6 + 0.3 * w; turn = -side * 0.15 * w; sy = 1 - 0.08 * w;
  } else if (u < 0.55) {             // slash: fast sweep, the body follows round a quarter turn
    const a = (u - 0.25) / 0.3, e = easeOut(a);
    sweep = wind + (end - wind) * e; lean = 0.9 + 0.55 * Math.sin(Math.PI * a);
    turn = side * (-0.15 + (Math.PI / 2 + 0.15) * e); sy = 0.92 + 0.16 * Math.sin(Math.PI * a);
  } else {                           // recover: blade back to rest, body settles with a small wobble
    const a = (u - 0.55) / 0.45, r = 1 - ease(a);
    sweep = end * r; lean = 0.6 + 0.3 * r;
    turn = side * (Math.PI / 2 + 0.06 * Math.exp(-5 * a) * Math.sin(a * 12));
    sy = 1 - 0.06 * Math.exp(-6 * a) * Math.cos(a * 10);
  }
  return { sweep, lean, turn, sy };
}

// ---------- game state ----------

const state = {
  sq: [0, 0],        // pawn square, absolute (x, z) indices
  origin: [0, 0],    // render origin square; kept near the pawn so coordinates stay small
  phi: 0,            // facing: the pawn looks along facingVec(phi); quarter turns only
  act: null,         // { kind: 'hop', dir, t0 } or { kind: 'swing', side, t0 }
  orbit: 0, pitch: 0.38, dist: 7.5, yaw: 0.5,
  target: [0, 0.6, 0]
};
window.__endless = state; // for tests
const held = new Set();   // sources holding "forward"
let queued = null;         // a swing (+1 / -1) or 'hop' waiting for the current action to finish

function step(now) {
  const a = state.act;
  if (a) {
    const u = (now - a.t0) / (a.kind === 'hop' ? HOP : SWING);
    const chain = a.kind === 'hop' && u >= CHAIN_AT && (held.size || queued);
    if (u >= 1 || chain) {
      if (a.kind === 'hop') { state.sq[0] += a.dir[0]; state.sq[1] += a.dir[1]; }
      else state.phi += a.side * Math.PI / 2;
      state.act = null;
    }
  }
  if (!state.act) {
    const next = queued ?? (held.size ? 'hop' : null);
    queued = null;
    if (next === 'hop') {
      const [fx, fz] = facingVec(state.phi);
      state.act = { kind: 'hop', dir: [Math.round(fx), Math.round(fz)], t0: now };
    } else if (next) state.act = { kind: 'swing', side: next, t0: now };
  }
  // Rebase so render coordinates stay small however far the pawn walks.
  // Shifts are even, so every square keeps its colour and nothing visibly moves.
  for (const i of [0, 1]) {
    const off = state.sq[i] - state.origin[i];
    if (Math.abs(off) > 32) {
      const shift = off - (off & 1);
      state.origin[i] += shift;
      state.target[i ? 2 : 0] -= shift * SQ;
    }
  }
}

function pose(now) {
  let x = (state.sq[0] - state.origin[0]) * SQ, z = (state.sq[1] - state.origin[1]) * SQ;
  let y = 0, phi = state.phi, A = rotY(phi);
  let sweep = 0, lean = 0.6;
  const a = state.act;
  if (a?.kind === 'hop') {
    const h = hopPose(Math.min(1, (now - a.t0) / HOP));
    const [dx, dz] = a.dir;
    x += dx * SQ * h.along; z += dz * SQ * h.along; y = h.y;
    // hop.js leans about -x when hopping along -z; in general the axis is up × direction
    A = K.M.mul(K.M.rot([dz, 0, -dx], h.tilt), K.M.mul(scaleY(h.sy), rotY(phi)));
  } else if (a?.kind === 'swing') {
    const s = swingPose(Math.min(1, (now - a.t0) / SWING), a.side);
    phi += s.turn;
    A = K.M.mul(scaleY(s.sy), rotY(phi));
    sweep = s.sweep; lean = s.lean;
  }
  return { x, y, z, A, phi, sweep, lean };
}

// ---------- input ----------

const press = side => { queued = side; };
addEventListener('keydown', e => {
  if (e.code === 'KeyW' || e.code === 'ArrowUp') { held.add(e.code); e.preventDefault(); return; }
  if (e.repeat) return;
  if (['KeyA', 'ArrowLeft', 'KeyQ'].includes(e.code)) { press(1); e.preventDefault(); }
  if (['KeyD', 'ArrowRight', 'KeyE'].includes(e.code)) { press(-1); e.preventDefault(); }
});
addEventListener('keyup', e => held.delete(e.code));
addEventListener('blur', () => held.clear());

const fwd = document.getElementById('pad-up');
fwd.addEventListener('pointerdown', e => {
  e.preventDefault();
  fwd.setPointerCapture?.(e.pointerId);
  if (!state.act) queued = 'hop';
  held.add('pad');
});
for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) fwd.addEventListener(ev, () => held.delete('pad'));
for (const btn of document.querySelectorAll('[data-swing]'))
  btn.addEventListener('pointerdown', e => { e.preventDefault(); press(Number(btn.dataset.swing)); });

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

const SLOW = Number(new URLSearchParams(location.search).get('slow')) || 1; // ?slow=8 plays everything 8x slower, for inspection
const LIVE_LIGHT = new URLSearchParams(location.search).get('light') !== 'baked';

function start() {
  const t0 = performance.now();
  const light = bakeSquare({ r: [9, 10, 11] }, 21);
  const dark = bakeSquare({ r: [6, 7, 8] }, 22);
  const { world, rig, capture, sun } = bakePawn();

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
  let p = pose(0);
  stage.add({
    pre() {
      rig.set('pawn', p.A, [0, 0, 0], [p.x, p.y, p.z]);
      // Sword: tilt the blade forward by `lean`, carry the grip round the pawn's axis by `sweep`
      const [hx, hy, hz] = HAND, c = Math.cos(p.sweep), s = Math.sin(p.sweep);
      const grip = [c * hx + s * hz, hy, -s * hx + c * hz];
      rig.child('sword', 'pawn', K.M.mul(rotY(p.sweep), K.M.rot([1, 0, 0], -p.lean)), HAND, grip);
      const sh = 1 - 0.45 * Math.min(1, p.y / 0.8);
      rig.set('shadow', [sh, 0, 0, 0, 1, 0, 0, 0, sh], [0, 0, 0], [p.x, 0, p.z]);
      rig.apply();
    }
  });
  // Live lighting: every frame the pawn and sword splats are re-shaded from their turned normals
  // against the fixed sun, stepping along their own palette ramps (the baked shading is the rest pose).
  if (LIVE_LIGHT) stage.add(K.light.system(stage, capture, [], { sun }));

  const renderer = createRenderer(canvas, { toolkit: { KIT, PixelLook } });
  status.hidden = true;
  console.log('baked in', Math.round(performance.now() - t0), 'ms;', world.count, 'pawn+sword splats,', light.count + dark.count, 'per square pair; live light', LIVE_LIGHT);

  // The pawn, sword and shadow are re-posed every frame: mark all of their rows changed
  const allRows = Array.from({ length: Math.ceil(world.count / 512) }, (_, i) => i);
  let last = performance.now();
  function frame(ms) {
    // window.__clock (seconds), when a test sets it, replaces the real clock so frames can be inspected one by one
    const now = window.__clock ?? ms / 1000 / SLOW, dt = window.__clock !== undefined ? 1 / 60 : Math.min(0.1, (ms - last) / 1000 / SLOW);
    last = ms;
    step(now);
    p = pose(now);
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
