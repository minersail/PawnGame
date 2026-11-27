// Infinite board: the pawn from scenes/hop.js, driven by keyboard / touch, rendered by ink-studio's WebGL renderer.
import { createRenderer } from './ink/src/webgl/renderer.mjs';
import { createSplatInstances } from './ink/src/webgl/instances.mjs';

const K = KIT;
// Same palette as scenes/hop.js: 0 bg, 1-5 ivory ramp, 6-8 dark squares, 9-11 light squares
const PALETTE = [0x0b0d14, 0x3a2f2a, 0x7a634f, 0xb89c7c, 0xe2cfae, 0xfff4dc,
  0x1c2230, 0x2a3448, 0x3a4862, 0x4d5d7c, 0x6a7da0, 0x8a9cc0];
const SQ = 1.3;          // square size, as in hop.js
const WINDOW = Number(new URLSearchParams(location.search).get('w')) || 14;       // squares kept around the pawn (even, so recycled squares keep their colour)
const HOP = 1.0;         // seconds per hop, as in hop.js
const CHAIN_AT = 0.9;    // a held key starts the next hop once the landing has mostly settled
const ART_HEIGHT = 168;  // art pixels down the screen

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
  const normals = w.renderMetadata?.normals;
  const proto = { data, count: keep.length };
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
  const ivory = { r: [1, 2, 3, 4, 5] };

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

  const world = B.finish({
    cam: { target: [0, 0.6, 0], dist: 7.5, pitch: 0.38, yaw: 0.5 },
    detail: 14, dither: 0.2, radius: 11
  });
  // Fade distant squares into the background so the board's edge is never seen.
  world.fog = { c: 0, start: 0.42, max: 1 };
  return { world, rig };
}

// ---------- hop animation (scenes/hop.js, one hop of u in [0, 1]) ----------

const ease = x => x * x * (3 - 2 * x);
const scaleY = sy => { const sx = 1 / Math.sqrt(sy); return [sx, 0, 0, 0, sy, 0, 0, 0, sx]; };

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

// ---------- game state ----------

const state = {
  sq: [0, 0],        // pawn square, absolute (x, z) indices
  origin: [0, 0],    // render origin square; kept near the pawn so coordinates stay small
  hop: null,         // { dir: [dx, dz], t0 }
  hops: 0,
  yaw: 0.5, yawGoal: 0.5, pitch: 0.38, dist: 7.5,
  target: [0, 0.6, 0]
};
const held = new Map();   // key -> direction name, most recent last
let tapped = null;         // a one-shot direction from a tap

function forward() {
  // Camera looks along (-sin yaw, -cos yaw); snap that to the nearest board axis.
  const fx = -Math.sin(state.yaw), fz = -Math.cos(state.yaw);
  return Math.abs(fx) > Math.abs(fz) ? [Math.sign(fx), 0] : [0, Math.sign(fz)];
}
function dirFor(name) {
  const [fx, fz] = forward();
  return { up: [fx, fz], down: [-fx, -fz], left: [fz, -fx], right: [-fz, fx] }[name];
}
function wanted() {
  if (tapped) return tapped;
  const names = [...held.values()];
  return names.length ? names[names.length - 1] : null;
}

function step(now) {
  if (state.hop) {
    const u = (now - state.hop.t0) / HOP;
    const next = wanted();
    if (u >= 1 || (u >= CHAIN_AT && next)) {
      state.sq[0] += state.hop.dir[0];
      state.sq[1] += state.hop.dir[1];
      state.hop = null;
      state.hops++;
    }
  }
  if (!state.hop) {
    const name = wanted();
    if (name) {
      state.hop = { dir: dirFor(name), t0: now };
      tapped = null;
    }
  }
  // Rebase so render coordinates stay small however far the pawn walks.
  // Shifts are even, so every square keeps its colour and nothing visibly moves.
  for (const a of [0, 1]) {
    const off = state.sq[a] - state.origin[a];
    if (Math.abs(off) > 32) {
      const shift = off - (off & 1);
      state.origin[a] += shift;
      state.target[a ? 2 : 0] -= shift * SQ;
    }
  }
}

function pawnPose(now) {
  const bx = (state.sq[0] - state.origin[0]) * SQ, bz = (state.sq[1] - state.origin[1]) * SQ;
  if (!state.hop) return { x: bx, z: bz, y: 0, A: [1, 0, 0, 0, 1, 0, 0, 0, 1] };
  const u = Math.min(1, (now - state.hop.t0) / HOP);
  const { along, y, sy, tilt } = hopPose(u);
  const [dx, dz] = state.hop.dir;
  // hop.js leans about -x when hopping along -z; in general the axis is up × direction
  const A = K.M.mul(K.M.rot([dz, 0, -dx], tilt), scaleY(sy));
  return { x: bx + dx * SQ * along, z: bz + dz * SQ * along, y, A };
}

// ---------- input ----------

const KEYS = {
  ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
  ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right'
};
addEventListener('keydown', e => {
  if (KEYS[e.code]) {
    held.delete(e.code);
    held.set(e.code, KEYS[e.code]);
    e.preventDefault();
  } else if (e.code === 'KeyQ' || e.code === 'KeyE') {
    turn(e.code === 'KeyQ' ? -1 : 1);
    e.preventDefault();
  }
});
addEventListener('keyup', e => held.delete(e.code));
addEventListener('blur', () => held.clear());

function turn(sign) {
  // Snap to the next quarter turn, keeping the 3/4 offset
  const base = 0.5, q = Math.PI / 2;
  const n = Math.round((state.yawGoal - base) / q) + sign;
  state.yawGoal = base + n * q;
}

for (const btn of document.querySelectorAll('[data-dir]')) {
  const name = btn.dataset.dir;
  const id = 'pad-' + name;
  btn.addEventListener('pointerdown', e => {
    e.preventDefault();
    btn.setPointerCapture?.(e.pointerId);
    tapped = name;
    held.set(id, name);
  });
  const release = () => held.delete(id);
  btn.addEventListener('pointerup', release);
  btn.addEventListener('pointercancel', release);
  btn.addEventListener('lostpointercapture', release);
}
for (const btn of document.querySelectorAll('[data-turn]'))
  btn.addEventListener('click', () => turn(Number(btn.dataset.turn)));

// Drag on the board to orbit the camera
let drag = null;
canvas.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, yaw: state.yawGoal, pitch: state.pitch }; canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener('pointermove', e => {
  if (!drag) return;
  const k = 4 / Math.max(innerWidth, 1);
  state.yawGoal = drag.yaw - (e.clientX - drag.x) * k;
  state.pitch = Math.min(0.9, Math.max(0.18, drag.pitch + (e.clientY - drag.y) * k));
});
const endDrag = () => { drag = null; };
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
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
  const { world, rig } = bakePawn();

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
  let pose = pawnPose(0);
  stage.add({
    pre() {
      rig.set('pawn', pose.A, [0, 0, 0], [pose.x, pose.y, pose.z]);
      const sh = 1 - 0.45 * Math.min(1, pose.y / 0.8);
      rig.set('shadow', [sh, 0, 0, 0, 1, 0, 0, 0, sh], [0, 0, 0], [pose.x, 0, pose.z]);
      rig.apply();
    }
  });

  const renderer = createRenderer(canvas, { toolkit: { KIT, PixelLook } });
  status.hidden = true;
  console.log('baked in', Math.round(performance.now() - t0), 'ms;', world.count, 'pawn splats,', light.count + dark.count, 'per square pair');

  let last = performance.now();
  function frame(ms) {
    const now = ms / 1000, dt = Math.min(0.1, (ms - last) / 1000);
    last = ms;
    step(now);
    pose = pawnPose(now);

    // Keep a WINDOW × WINDOW patch of squares centred on the pawn
    const cx = Math.round(pose.x / SQ), cz = Math.round(pose.z / SQ), moved = [];
    for (const s of slots) {
      const x = s.i + WINDOW * Math.round((cx - s.i) / WINDOW);
      const z = s.j + WINDOW * Math.round((cz - s.j) / WINDOW);
      if (x !== s.x || z !== s.z) {
        s.x = x; s.z = z;
        moved.push({ id: s.id, position: [x * SQ, 0, z * SQ] });
      }
    }
    if (moved.length) board.updateTransforms(moved);

    // Third-person camera: ease the aim toward a point just ahead of the pawn
    state.yaw += (state.yawGoal - state.yaw) * (1 - Math.exp(-dt * 8));
    const [fx, fz] = [-Math.sin(state.yaw), -Math.cos(state.yaw)];
    const goal = [pose.x + fx * 0.6, 0.6, pose.z + fz * 0.6];
    const follow = 1 - Math.exp(-dt * 4);
    for (const a of [0, 1, 2]) state.target[a] += (goal[a] - state.target[a]) * follow;

    world.anim.update(dt, now);
    const { width, height } = artSize();
    renderer.render(world, {
      width, height, time: now, instances: board,
      camera: { target: state.target, dist: state.dist, yaw: state.yaw, pitch: state.pitch }
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
