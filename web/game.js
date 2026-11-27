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
const PARRY = num('parry', 0.7);   // seconds per parry (window: 0.1–0.42 s in)
const PARRY_TURNS = true;          // a parry turns the pawn a quarter turn toward its side, like a swing
const PASSIVE_BLOCK = params.get('passive') === '1';   // PLACEHOLDER: the resting shield does not block; only a parry does
const SHIELD_REST = { sweep: 0, y: 0.62, r: 0.44 };     // at rest: directly in front of the pawn, over the sword
const SHIELD_GUARD = { y: 0.74, r: 0.52 };               // raised and pushed out during a parry
const SHIELD_TUCK = { sweep: 1.7, y: 0.5, r: 0.34 };     // out of the blade's way during a swing (sweep is x side)
const ZOOM_OUT = 1.6;              // swipe down / Z: the camera pulls back this much until the next control
const SHIELD_BAKE = [-24, 0.6, 40];                      // baked away from the pawn so it picks up no baked shadow
const SHIELD_R = [0.2, 0.24, 0.032];                     // shield ellipsoid radii (faces -z when baked)
// Enemy attacks and health. PLACEHOLDER values wait on design.
const PLAYER_HP = num('hp', 3);          // PLACEHOLDER: hit points
const ENEMY_WINDUP = num('windup', 0.5); // PLACEHOLDER: an enemy's wind-up, the tell (the player's is 0.175 s)
const ENEMY_SWING_SIDE = num('eside', 1); // PLACEHOLDER: enemies always swing left (+1), from their right; ?eside=-1 flips it
const ENEMY_SWING_REST = 0.8;            // PLACEHOLDER: an enemy waits this long after a swing before it may swing again
const ENEMIES_TURN = false;              // PLACEHOLDER: enemies never turn; they travel and swing along one line
const ENEMY_FRIENDLY_FIRE = false;       // PLACEHOLDER: enemy blades pass through other enemies
const TRADE_HITS = 'both';               // PLACEHOLDER: when both blades land in the same swing, both hits count
const INVULN = num('invuln', 1.0);       // PLACEHOLDER: seconds of invulnerability after the player is hit
const BLADE_R = 0.05;                    // blade half-thickness for contact tests
const CHAIN_AT = 0.9;    // a held key starts the next hop once the landing has mostly settled
const ART_HEIGHT = 168;  // art pixels down the screen
const HAND = [0.1, 0.55, -0.32];   // sword grip at rest: in front of the pawn (pawn faces -z), blade straight up
const BLADE = [0.14, 1.36];      // blade runs from just above the grip to the tip, along the sword's local +y
const ENEMIES = Number(params.get('enemies')) || 6;   // enemy pool size
const SPAWN_DIST = 6;            // enemies drop in this many squares away
const DESPAWN_DIST = 11;         // and vanish (inside the fog) past this
const SLOW = Number(params.get('slow')) || 1;          // ?slow=8 plays everything 8x slower, for inspection
const LIVE_LIGHT = params.get('light') !== 'baked';
// Camera: isometric by default (orthographic, ~35° down, straight behind the pawn's facing). ?cam=persp restores the
// earlier perspective view (3/4 offset, lower pitch).
const PERSP = params.get('cam') === 'persp';
const CAM = PERSP ? { projection: 'perspective', pitch: 0.38, dist: 7.5, yaw: 0.5 }
  : { projection: 'orthographic', pitch: 0.615, dist: 8.5, yaw: 0 };

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

// A sword with its grip at [hx, hy, hz], blade straight up
function sculptSword(S, [hx, hy, hz], c, tag, res) {
  const mid = (BLADE[0] + BLADE[1] - 0.1) / 2, half = (BLADE[1] - 0.1 - BLADE[0]) / 2;
  S.box([hx, hy + mid, hz], [0.046, half, 0.016], c.blade, { res, tag });                         // blade
  S.box([hx, hy + BLADE[1] - 0.05, hz], [0.028, 0.05, 0.016], c.blade, { res: res * 0.9, tag });  // tip
  S.box([hx, hy + 0.12, hz], [0.15, 0.024, 0.032], c.guard, { res, tag });                        // crossguard
  S.box([hx, hy, hz], [0.024, 0.1, 0.024], c.grip, { res, tag });                                 // grip
  S.ball([hx, hy - 0.12, hz], 0.042, c.pommel, { res, tag });                                     // pommel
}

// Signed distance to the pawn's shape, in its own frame (base centre at the origin): the same lathe and
// ball the bake sculpts. Used for contact tests, so blades meet the real silhouette rather than a cylinder.
function pawnSDF([x, y, z]) {
  const r = Math.hypot(x, z), H = 1.9 * PK;
  const t = Math.min(1, Math.max(0, y / H));
  let d = Math.max(r - pawnProfile(t), -y, y - H);
  const cy = 1.85 * PK, ch = 0.16 * PK;
  d = Math.min(d, Math.max(r - 0.52 * PK, Math.abs(y - cy - ch / 2) - ch / 2));
  return Math.min(d, Math.hypot(x, y - 2.55 * PK, z) - 0.55 * PK);
}
// Heater shield outline in the shield's own x/y (centred, about 0.4 wide by 0.5 tall at k = 1): a flat top, straight
// sides for the upper third, then two arcs that meet in a point at the bottom
function heaterOutline(k) {
  const w = 0.2 * k, top = 0.22 * k, shoulder = 0.06 * k, tip = -0.28 * k, pts = [[-w, top], [w, top]];
  // each side is an arc from the shoulder (x = ±w) down to the tip (x = 0), centred level with the shoulder on the far side
  const R = ((shoulder - tip) ** 2 + w * w) / (2 * w), cx = w - R;   // circle through (w, shoulder) and (0, tip), centred level with the shoulder
  const a0 = 0, a1 = -Math.acos((0 - cx) / R);
  for (let i = 0; i <= 10; i++) { const a = a0 + (a1 - a0) * i / 10; pts.push([cx + R * Math.cos(a), shoulder + R * Math.sin(a)]); }
  for (let i = 9; i >= 0; i--) { const a = a0 + (a1 - a0) * i / 10; pts.push([-(cx + R * Math.cos(a)), shoulder + R * Math.sin(a)]); }
  return pts;
}

// Approximate signed distance to the shield ellipsoid, in its own frame (centre at the origin)
function shieldSDF(p) {
  const k = Math.hypot(p[0] / SHIELD_R[0], p[1] / SHIELD_R[1], p[2] / SHIELD_R[2]);
  return (k - 1) * Math.min(...SHIELD_R);
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
  sculptSword(S, HAND, { blade: ivory, guard: { r: [1, 2, 3] }, grip: { r: [1, 1, 2] }, pommel: { r: [2, 3, 4] } }, 'sword', 0.018);
  S.bake();

  // Heater shield for the off hand: flat top, straight upper sides curving to a point, facing -z, baked on its own;
  // a raised inner panel in a lighter ramp leaves a darker rim round the edge. The rig carries it.
  S.extrude([heaterOutline(1)], SHIELD_BAKE, 0.04, { r: [2, 3, 4] }, { rd: 0.01, res: 0.016, tag: 'shield' });
  S.extrude([heaterOutline(0.78)], add(SHIELD_BAKE, [0, 0.008, -0.016]), 0.024, { r: [3, 4, 5] }, { rd: 0.006, res: 0.014, tag: 'shield' });
  S.bake();

  // Enemy pool: identical dark pawns, all baked at the origin and placed by the rig
  for (let i = 0; i < ENEMIES; i++) {
    sculptPawn(S, ebony, `e${i}`, false, EREST(i)); S.bake();
    sculptSword(S, add(EREST(i), HAND), { blade: { r: [13, 14, 15] }, guard: { r: [12, 13, 14] }, grip: { r: [12, 12, 13] }, pommel: { r: [13, 14, 15] } }, `e${i}sword`, 0.022);
    S.bake();
  }
  for (let i = 0; i < ENEMIES; i++) rig.part(`e${i}cut`);
  rig.part('pawncut');   // the player's top half, when the last hit point goes   // the half a sword hit slices off, filled in on a hit

  const world = B.finish({
    cam: { target: [0, 0.6, 0], dist: CAM.dist, pitch: CAM.pitch, yaw: CAM.yaw, projection: CAM.projection },
    detail: 14, dither: 0.2, radius: 11
  });
  // Fade distant squares into the background so the board's edge is never seen. Perspective only: with the
  // orthographic camera fog depth varies only with screen height, so each palette step became a horizontal dither
  // band that read as board seams; the iso view never reaches the patch edge (about ±7.3 of 9.1 at full zoom-out).
  if (PERSP) world.fog = { c: 0, start: 0.42, max: 1 };
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

// One parry with u in [0, 1]; side +1 parries left, -1 right. A wide bash, like swinging a door open: the shield
// cocks back across the body, then sweeps out in a wide arc round the front to that side, its flat face leading the
// way (it turns further than the arc, like a door on its hinge), and holds there braced (the parry window). Then the
// body follows a quarter turn, so the pawn ends facing that way with the shield back in front. `parrying` marks the
// window, when the shield turns blades aside.
const PARRY_ARC = num('arc', 1.4);    // how far round the bash carries the shield, in radians from the front (about 80°)
function parryPose(u, side) {
  let world, turn, up, face, out, parrying = false;
  if (u < 0.15) {                    // cock: shield pulled back across the body, face angled away, the body coils
    const a = ease(u / 0.15);
    world = -side * 0.55 * a; turn = -side * 0.12 * a; up = a; face = -side * 0.35 * a; out = -0.06 * a;
  } else if (u < 0.36) {             // bash: a wide arc out round the front, the face swinging ahead like a door
    const a = easeOut((u - 0.15) / 0.21);
    world = side * (-0.55 + (PARRY_ARC + 0.55) * a);
    turn = side * (-0.12 + 0.42 * a);
    face = side * (-0.35 + 0.8 * Math.sin(Math.PI * Math.min(1, a * 1.15)) + 0.6 * a);
    up = 1; out = -0.06 + 0.16 * Math.sin(Math.PI * a) + 0.06 * a; parrying = true;
  } else if (u < 0.6) {              // hold it swung open, braced, with a small settle back from the overshoot
    const a = (u - 0.36) / 0.24;
    world = side * (PARRY_ARC - 0.1 * ease(a)); turn = side * (0.3 + 0.06 * a);
    face = side * 0.25 * (1 - 0.4 * ease(a)); up = 1; out = 0; parrying = true;
  } else {                           // turn: body follows a quarter turn and the shield swings back in front
    const a = ease((u - 0.6) / 0.4);
    const w0 = PARRY_ARC - 0.1;
    world = side * (w0 + (Math.PI / 2 - w0) * a);
    turn = side * (0.36 + (Math.PI / 2 - 0.36) * a); up = 1 - a; face = side * 0.15 * (1 - a); out = 0;
  }
  const k = Math.sin(Math.PI * u);
  return {
    turn, parrying, sy: 1 - 0.06 * up,
    shield: { sweep: world - turn, face, y: SHIELD_REST.y + (SHIELD_GUARD.y - SHIELD_REST.y) * up,
      r: SHIELD_REST.r + (SHIELD_GUARD.r - SHIELD_REST.r) * up + out, tilt: -0.2 * up },
    sword: { sweep: -side * 0.45 * k, lean: -0.35 * k }   // the sword drops back out of the shield's way
  };
}

// An enemy's swing: the player's swing with a longer wind-up (the tell), and the body turns back to its line
// at the end instead of keeping the quarter turn. Returns null once the swing is over.
const ENEMY_SWING = ENEMY_WINDUP + 0.75 * SWING;
function enemySwingPose(t, side) {
  if (t >= ENEMY_SWING) return null;
  const u = t < ENEMY_WINDUP ? 0.25 * t / ENEMY_WINDUP : 0.25 + 0.75 * (t - ENEMY_WINDUP) / (0.75 * SWING);
  const s = swingPose(u, side);
  if (!ENEMIES_TURN && u >= 0.55) {                   // recover: unwind the turn so it faces its line again
    const r = 1 - ease((u - 0.55) / 0.45);
    s.turn = side * (Math.PI / 2) * r;
  }
  if (t < ENEMY_WINDUP) {            // the tell: the blade trembles as it draws back, and the body coils lower
    const w = t / ENEMY_WINDUP;
    s.lean += 0.12 * Math.sin(t * 45) * w; s.sy -= 0.06 * w;
  }
  return s;
}
const phiOf = dir => Math.atan2(-dir[0], -dir[1]);   // facing angle for a square direction

// ---------- game state ----------

const state = {
  sq: [0, 0],        // pawn square, absolute (x, z) indices
  origin: [0, 0],    // render origin square; kept near the pawn so coordinates stay small
  phi: 0,            // facing: the pawn looks along facingVec(phi); quarter turns only
  act: null,         // { kind: 'hop' | 'dash', dir, t0 } or { kind: 'swing' | 'parry', side, t0 }
  orbit: 0, pitch: CAM.pitch, dist: CAM.dist, yaw: CAM.yaw, zoomOut: false, camDist: CAM.dist,
  target: [0, 0.6, 0],
  taken: 0,
  nextSpawn: 1.5,
  hp: PLAYER_HP,
  hurtAt: -Infinity,  // when the player was last hit
  dead: null          // the cut, once the last hit point is gone
};
window.__endless = state; // for tests
const held = new Set();   // sources holding "forward"
let queued = null;         // { kind, side } waiting for the current action to finish

// Enemies: { i, mode: 'off' | 'drop' | 'idle' | 'hop' | 'swing' | 'dying', sq, dir, t0, wait, cut, struck, blocked }
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

// Is the player on the square ahead of this enemy or either front diagonal? (Counts where the player is
// moving to, as well as where it stands.)
function playerInFront(e) {
  const [dx, dz] = e.dir, ahead = [e.sq[0] + dx, e.sq[1] + dz];
  const front = [ahead, [ahead[0] + dz, ahead[1] - dx], [ahead[0] - dz, ahead[1] + dx]].map(q => sqKey(...q));
  const mine = [sqKey(...state.sq)];
  const a = state.act;
  if (a?.dir) for (let k = 1; k <= (a.kind === 'dash' ? DASH_SQUARES : 1); k++) mine.push(sqKey(state.sq[0] + k * a.dir[0], state.sq[1] + k * a.dir[1]));
  return mine.some(m => front.includes(m));
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
    if (e.mode === 'swing' && now - e.t0 >= ENEMY_SWING) { e.mode = 'idle'; e.t0 = now; e.wait = rand(0.4, 2.8); e.rested = now + ENEMY_SWING_REST; }
    // On a square, it swings once the player stands on one of its front three squares; once committed it plays out
    if ((e.mode === 'idle') && !state.dead && now >= (e.rested ?? 0) && playerInFront(e)) {
      Object.assign(e, { mode: 'swing', t0: now, side: ENEMY_SWING_SIDE, struck: false, blocked: false });
      continue;
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
  if (state.restartPending) {
    state.restartPending = false;
    state.restore = true; state.dead = null; state.hp = PLAYER_HP; state.hurtAt = -Infinity;
    state.taken = 0; taken.textContent = 0; state.nextSpawn = now + 1.5;
    for (const e of enemies) if (e.mode !== 'off') { e.mode = 'off'; e.dirty = true; if (e.cut) e.restore = true; }
    showHp(); banner.hidden = true;
  }
  const a = state.act;
  if (a) {
    const u = (now - a.t0) / DURATION[a.kind];
    const chain = a.kind === 'hop' && u >= CHAIN_AT && (held.size || queued);
    if (u >= 1 || chain) {
      if (a.kind === 'hop') { state.sq[0] += a.dir[0]; state.sq[1] += a.dir[1]; }
      else if (a.kind === 'dash') { state.sq[0] += DASH_SQUARES * a.dir[0]; state.sq[1] += DASH_SQUARES * a.dir[1]; }
      else if (a.kind === 'swing' || (a.kind === 'parry' && PARRY_TURNS)) state.phi += a.side * Math.PI / 2;
      state.act = null;
    }
  }
  if (state.dead) { state.act = null; queued = null; }
  if (!state.act && !state.dead) {
    const next = queued ?? (held.size ? { kind: 'hop' } : null);
    queued = null;
    if (next?.kind === 'hop' || next?.kind === 'dash') {
      const [fx, fz] = facingVec(state.phi), dir = [Math.round(fx), Math.round(fz)];
      // An enemy standing on a square the move passes through blocks it
      const n = next.kind === 'dash' ? DASH_SQUARES : 1;
      const stands = k => enemies.some(e => (e.mode === 'idle' || e.mode === 'drop' || e.mode === 'swing') && e.sq[0] === state.sq[0] + k * dir[0] && e.sq[1] === state.sq[1] + k * dir[1]);
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
      for (const c of [...enemies.map(e => e.cut), state.dead]) if (c) { c.g[i ? 2 : 0] -= shift * SQ; c.pos[i ? 2 : 0] -= shift * SQ; }
    }
  }
}

const DURATION = { hop: HOP, dash: DASH, swing: SWING, parry: PARRY };
const toRender = sq => [(sq[0] - state.origin[0]) * SQ, (sq[1] - state.origin[1]) * SQ];

// Player pose, including where the sword is
function pose(now) {
  let [x, z] = toRender(state.sq);
  let y = 0, phi = state.phi, A = rotY(phi);
  let sweep = 0, lean = 0, reach = 0, slashing = false, parrying = false, u = 0, side = 0;
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
    // tuck the shield round to the side the swing ends on, out of the blade's arc, then bring it back in front
    const tuck = u < 0.2 ? ease(u / 0.2) : u < 0.75 ? 1 : 1 - ease((u - 0.75) / 0.25);
    sh.sweep += (side * SHIELD_TUCK.sweep - sh.sweep) * tuck;
    sh.y += (SHIELD_TUCK.y - sh.y) * tuck; sh.r += (SHIELD_TUCK.r - sh.r) * tuck;
  } else if (a?.kind === 'parry') {
    u = Math.min(1, (now - a.t0) / PARRY); side = a.side;
    const b = parryPose(u, a.side);
    phi += b.turn;
    A = K.M.mul(scaleY(b.sy), rotY(phi));
    sh = b.shield; sweep = b.sword.sweep; lean = b.sword.lean; parrying = b.parrying;
  }
  const hurt = now - state.hurtAt;   // flinch when hit: a sharp squash that rings out
  if (hurt >= 0 && hurt < 0.45) A = K.M.mul(scaleY(1 - 0.16 * Math.exp(-7 * hurt) * Math.cos(hurt * 28)), A);
  // Sword: carried round the pawn's axis by `sweep`, tilted outward by `lean`, held further out by `reach`
  const grip = mv(rotY(sweep), [HAND[0], HAND[1], HAND[2] - reach]);
  const swordA = K.M.mul(rotY(sweep), K.M.rot([1, 0, 0], -lean));
  // Shield: carried round the pawn's axis, its face pointing outward along `sweep`
  const shieldAt = mv(rotY(sh.sweep), [0, sh.y, -sh.r]);
  const shieldA = K.M.mul(rotY(sh.sweep + (sh.face || 0)), K.M.rot([1, 0, 0], sh.tilt));   // face: extra turn of the shield on its own axis
  return { x, y, z, A, phi, grip, swordA, shieldAt, shieldA, slashing, parrying, u, side, now };
}

// World-space point t along the blade, for a pose (the player's or an enemy's)
function bladePoint(p, t) {
  return add([p.x, p.y, p.z], mv(p.A, add(p.grip, mv(p.swordA, [0, t, 0]))));
}

// Enemy pose: position, matrix (about its bake spot) and its sword
function enemyPose(e, now) {
  let [x, z] = toRender(e.sq), y = 0;
  const phi0 = phiOf(e.dir);
  let A = rotY(phi0), sweep = 0, lean = 0, reach = 0, slashing = false;
  const u = now - e.t0;
  if (e.mode === 'drop') {           // falls in from above, lands with the hop's squash
    if (u < 0.4) { const f = u / 0.4; y = 4 * (1 - f * f); }
    else { const h = hopPose(0.7 + 0.3 * Math.min(1, (u - 0.4) / 0.35)); A = K.M.mul(scaleY(h.sy), A); }
  } else if (e.mode === 'hop') {
    const h = hopPose(Math.min(1, u / HOP));
    x += e.dir[0] * SQ * h.along; z += e.dir[1] * SQ * h.along; y = h.y;
    A = K.M.mul(hopMatrix(h, e.dir), A);
  } else if (e.mode === 'swing') {
    const s = enemySwingPose(u, e.side);
    if (s) {
      A = K.M.mul(scaleY(s.sy), rotY(phi0 + s.turn));
      ({ sweep, lean, reach } = s);
      slashing = s.slashing && !e.blocked;
      if (e.blocked) {               // parried: the blade springs up and away and the body staggers back
        const k = Math.min(1, (now - e.blockedAt) / 0.45), jolt = Math.sin(Math.PI * k);
        lean *= 1 - 0.7 * jolt;
        A = K.M.mul(K.M.rot([e.dir[1], 0, -e.dir[0]], 0.4 * jolt), A);
        x -= e.dir[0] * 0.18 * jolt; z -= e.dir[1] * 0.18 * jolt;
      }
    }
  }
  const grip = mv(rotY(sweep), [HAND[0], HAND[1], HAND[2] - reach]);
  const swordA = K.M.mul(rotY(sweep), K.M.rot([1, 0, 0], -lean));
  return { x, y, z, A, grip, swordA, slashing, phi: phi0, now };
}

// ---------- contact ----------

function inv3(M) {
  const [a, b, c, d, e, f, g, h, i] = M;
  const A = e * i - f * h, B = f * g - d * i, C = d * h - e * g, det = a * A + b * B + c * C;
  return [A / det, (c * h - b * i) / det, (b * f - c * e) / det,
    B / det, (a * i - c * g) / det, (c * d - a * f) / det,
    C / det, (b * g - a * h) / det, (a * e - b * d) / det];
}
// A world point in a piece's own frame (base centre at the origin, before its pose)
const toLocal = (p, q) => mv(inv3(p.A), sub(q, [p.x, p.y, p.z]));
const touchesPawn = (p, q) => pawnSDF(toLocal(p, q)) < BLADE_R;
const touchesShield = (p, q) => shieldSDF(mv(inv3(p.shieldA), sub(toLocal(p, q), p.shieldAt))) < BLADE_R;
const BLADE_TS = []; for (let t = 0.2; t <= BLADE[1] + 1e-6; t += 0.08) BLADE_TS.push(t);
// Sub-steps between frames (one per 4 ms, at least 4), so a fast blade can't skip through a piece or a shield at
// low frame rates
const stepsFor = dt => Math.min(40, Math.max(4, Math.ceil(dt / 0.004)));

// The player's blade against each enemy's shape
function checkHits(prev, cur, stage, rig) {
  if (state.dead || (!cur.slashing && !prev?.slashing)) return;
  for (const e of enemies) {
    if (!['idle', 'hop', 'drop', 'swing'].includes(e.mode)) continue;
    const STEPS = prev ? stepsFor(cur.now - prev.now) : 1;
    for (let s = 1; s <= STEPS && e.mode !== 'dying'; s++) {
      const tm = !prev ? cur.now : prev.now + (cur.now - prev.now) * s / STEPS;
      const p = s === STEPS || !prev ? cur : pose(tm), ep = enemyPose(e, tm);
      const t = BLADE_TS.find(t => touchesPawn(ep, bladePoint(p, t)));
      if (t !== undefined) killEnemy(e, ep, p, t, stage, rig, tm);
    }
  }
}

// Each swinging enemy's blade against the player's shield, then the player's shape
function checkEnemyHits(prevNow, now, stage, rig) {
  if (state.dead) return;
  for (const e of enemies) {
    if (e.mode !== 'swing' || e.struck || e.blocked) continue;
    const STEPS = stepsFor(now - prevNow);
    for (let s = 1; s <= STEPS; s++) {
      const tm = prevNow + (now - prevNow) * s / STEPS;
      const ep = enemyPose(e, tm);
      if (!ep.slashing) continue;
      const p = pose(tm), pts = BLADE_TS.map(t => [t, bladePoint(ep, t)]);
      if ((p.parrying || PASSIVE_BLOCK) && pts.some(([, b]) => touchesShield(p, b))) { e.blocked = true; e.blockedAt = tm; flash('Parried'); break; }
      const hit = pts.find(([, b]) => touchesPawn(p, b));
      if (!hit) continue;
      e.struck = true;
      if (tm - state.hurtAt < INVULN) break;
      state.hurtAt = tm; state.hp--;
      showHp();
      if (state.hp <= 0) killPlayer(e, ep, p, hit[0], stage, tm);
      else flash('Hit');
      break;
    }
  }
}

// Cut a piece in two along a blade's path: the plane holds the blade and the direction it is sweeping.
// `blade(t)` is the blade's pose at time t; `rows` are the piece's splats; `rest` its bake spot.
function cutPiece({ blade, t, now, rows, rest, pos, cutPart, stage, rig, phi }) {
  const p = blade(now), g = bladePoint(p, t);
  const d = norm(sub(bladePoint(p, BLADE[1]), bladePoint(p, BLADE[0])));
  const v = norm(sub(bladePoint(blade(now + 0.01), t), g));
  let n = norm(cross(d, v));
  if (Math.hypot(...n) < 0.5 || !isFinite(n[0])) n = [0, 1, 0];
  if (n[1] < 0) n = scale(n, -1);
  // Freeze the piece where it stands, upright, and sort its splats by side of the plane
  const base = stage.base, top = [];
  for (const i of rows) {
    const w = [base[i * 16] - rest[0] + pos[0], base[i * 16 + 1] - rest[1], base[i * 16 + 2] - rest[2] + pos[2]];
    if (dot(sub(w, g), n) > 0) top.push(i);
  }
  const split = top.length > 0 && top.length < rows.length;
  if (split) rig.assign(cutPart, top);
  // Height where the plane crosses the piece's axis: the top half hinges about that point
  const h = Math.min(1.4, Math.max(0.15, g[1] - (n[0] * (pos[0] - g[0]) + n[2] * (pos[2] - g[2])) / n[1]));
  let slide = norm([v[0], 0, v[2]]);
  if (!isFinite(slide[0]) || Math.hypot(...slide) < 0.5) slide = [1, 0, 0];
  return { g, n, h, slide, pos, split, phi, t0: now };
}

function killEnemy(e, ep, p, t, stage, rig, now) {
  e.cut = cutPiece({ blade: tm => pose(tm), t, now, rows: e.rows, rest: EREST(e.i), pos: [ep.x, 0, ep.z],
    cutPart: `e${e.i}cut`, stage, rig, phi: ep.phi });
  e.mode = 'dying'; e.t0 = now; e.dirty = true;
  state.taken++;
  taken.textContent = state.taken;
}

function killPlayer(e, ep, p, t, stage, now) {
  state.dead = cutPiece({ blade: tm => enemyPose(e, tm), t, now, rows: state.pawnRows, rest: [0, 0, 0], pos: [p.x, 0, p.z],
    cutPart: 'pawncut', stage, rig: state.rig, phi: p.phi });
  state.act = null;
  banner.hidden = false;
}

// Death: the top half slides off along the cut and topples to the board; the base wobbles.
// Enemies then shrink away; the player's pieces stay where they fell.
function dyingPoses(c, u, rest, stays) {
  const hinge = add(rest, [0, c.h, 0]);
  const fall = Math.min(1, Math.max(0, (u - 0.06) / 0.7));
  const slideD = 0.55 * easeOut(Math.min(1, u / 0.45));
  const tip = 1.45 * fall * fall;                                   // topples over, accelerating
  const axis = norm(cross([0, 1, 0], c.slide));
  const drop = -c.h * 0.85 * Math.pow(fall, 2.2) + 0.12 * Math.sin(Math.PI * Math.min(1, u / 0.3));
  const shrink = stays || u < 1.05 ? 1 : Math.max(0.001, 1 - ease((u - 1.05) / 0.5));
  const topA = K.M.mul(uniform(shrink), K.M.rot(axis, tip));
  const topP = add(add(c.pos, [0, c.h, 0]), add(scale(c.slide, slideD), [0, drop, 0]));
  const wob = 1 - 0.12 * Math.exp(-5 * u) * Math.cos(u * 18);
  const baseA = K.M.mul(K.M.mul(uniform(shrink), scaleY(wob)), rotY(c.phi));
  return { topA, topP, baseA, basePos: c.pos, hinge, shrink, rest };
}

// ---------- HUD ----------

const hpEl = document.getElementById('hp'), banner = document.getElementById('banner'), flashEl = document.getElementById('flash');
function showHp() { hpEl.textContent = '■'.repeat(Math.max(0, state.hp)) + '□'.repeat(Math.max(0, PLAYER_HP - state.hp)); }
let flashTimer = 0;
function flash(text) {
  flashEl.textContent = text; flashEl.hidden = false;
  clearTimeout(flashTimer); flashTimer = setTimeout(() => { flashEl.hidden = true; }, 600);
}
showHp();
// Restart after death (PLACEHOLDER): R or the button puts the pawn back together where it fell and clears the board
function restart() { if (state.dead) state.restartPending = true; }
document.getElementById('restart').addEventListener('click', restart);

// ---------- input ----------

// Any control brings the camera back from the zoomed-out view
const press = (kind, side = 0) => { state.zoomOut = false; queued = { kind, side }; };
const zoomOut = () => { state.zoomOut = true; };

// Keyboard. Hold S or Shift to turn A / D into parries (Q / E parry directly); Space or Shift + W dashes.
const mods = new Set();
addEventListener('keydown', e => {
  if (e.code === 'KeyR' && !e.repeat) { restart(); return; }
  if (e.code === 'KeyS' || e.code === 'ArrowDown') { mods.add(e.code); e.preventDefault(); return; }
  if (e.repeat && !['KeyW', 'ArrowUp'].includes(e.code)) return;
  const guard = e.shiftKey || mods.size > 0;
  const act = {
    KeyW: e.shiftKey ? ['dash'] : ['hop'], ArrowUp: e.shiftKey ? ['dash'] : ['hop'], Space: ['dash'],
    KeyA: [guard ? 'parry' : 'swing', 1], ArrowLeft: [guard ? 'parry' : 'swing', 1],
    KeyD: [guard ? 'parry' : 'swing', -1], ArrowRight: [guard ? 'parry' : 'swing', -1],
    KeyQ: ['parry', 1], KeyE: ['parry', -1], KeyZ: ['zoom']
  }[e.code];
  if (!act || (e.repeat && act[0] !== 'hop')) return;
  e.preventDefault();
  if (act[0] === 'zoom') return zoomOut();
  if (act[0] === 'hop') { state.zoomOut = false; held.add(e.code); return; }   // held: keep hopping
  press(...act);
});
addEventListener('keyup', e => { held.delete(e.code); mods.delete(e.code); });
addEventListener('blur', () => { held.clear(); mods.clear(); });

// Touch: swipes on the board. Up hops (a long swipe dashes), left / right swings (or parries while the Shield
// button is held), down zooms out until the next control.
const SWIPE_MIN = 24;                                       // px: shorter is a tap, ignored
const swipeLong = () => Math.max(90, 0.2 * innerHeight);    // PLACEHOLDER: px past which a swipe up is a dash
const shieldBtn = document.getElementById('shield');
let shieldHeld = false;
shieldBtn.addEventListener('pointerdown', e => { e.preventDefault(); shieldHeld = true; shieldBtn.setPointerCapture?.(e.pointerId); shieldBtn.classList.add('on'); });
for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture'])
  shieldBtn.addEventListener(ev, () => { shieldHeld = false; shieldBtn.classList.remove('on'); });
const swipes = new Map();
function swipe(dx, dy) {
  const len = Math.hypot(dx, dy);
  if (len < SWIPE_MIN) return;
  if (Math.abs(dy) >= Math.abs(dx)) {
    if (dy < 0) press(-dy >= swipeLong() ? 'dash' : 'hop');
    else zoomOut();
  } else press(shieldHeld ? 'parry' : 'swing', dx < 0 ? 1 : -1);
}
window.__swipe = swipe; // for tests

// Drag on the board to orbit the camera around the pawn; it stays where you leave it
let drag = null;
canvas.addEventListener('pointerdown', e => {
  canvas.setPointerCapture(e.pointerId);
  if (e.pointerType === 'mouse') drag = { x: e.clientX, y: e.clientY, orbit: state.orbit, pitch: state.pitch };
  else swipes.set(e.pointerId, { x: e.clientX, y: e.clientY });
});
canvas.addEventListener('pointerup', e => {
  const s = swipes.get(e.pointerId);
  if (s) { swipes.delete(e.pointerId); swipe(e.clientX - s.x, e.clientY - s.y); }
});
canvas.addEventListener('pointercancel', e => swipes.delete(e.pointerId));
canvas.addEventListener('pointermove', e => {
  if (!drag) return;
  const k = 4 / Math.max(innerWidth, 1);
  state.orbit = drag.orbit - (e.clientX - drag.x) * k;
  state.pitch = Math.min(PERSP ? 0.9 : 1.2, Math.max(PERSP ? 0.18 : 0.3, drag.pitch + (e.clientY - drag.y) * k));
});
const endDrag = () => { drag = null; };
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('dblclick', () => { state.orbit = 0; state.pitch = CAM.pitch; state.dist = CAM.dist; });
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
  state.pawnRows = Int32Array.from(rig.list[rig.part('pawn')]);
  state.rig = rig;

  let p = pose(0);
  const HIDDEN = [uniform(0.001), [0, 0, 0], [0, -60, 0]];
  stage.add({
    pre() {
      if (state.restore) { if (state.restoreSplit) rig.assign('pawn', state.pawnRows); state.restore = false; state.restoreSplit = false; }
      if (state.dead) {
        state.restoreSplit = state.dead.split;
        const d = dyingPoses(state.dead, p.now - state.dead.t0, [0, 0, 0], true);
        rig.set('pawn', d.baseA, d.rest, d.basePos);
        rig.set('pawncut', d.topA, d.hinge, d.topP);
        const r = pose(-1);   // sword and shield fall still in their rest grip
        rig.child('sword', 'pawn', r.swordA, HAND, r.grip);
        rig.child('shield', 'pawn', r.shieldA, SHIELD_BAKE, r.shieldAt);
      } else {
        rig.set('pawn', p.A, [0, 0, 0], [p.x, p.y, p.z]);
        rig.set('pawncut', ...HIDDEN);
        rig.child('sword', 'pawn', p.swordA, HAND, p.grip);
        rig.child('shield', 'pawn', p.shieldA, SHIELD_BAKE, p.shieldAt);
      }
      const sh = 1 - 0.45 * Math.min(1, p.y / 0.8);
      rig.set('shadow', [sh, 0, 0, 0, 1, 0, 0, 0, sh], [0, 0, 0], [p.x, 0, p.z]);
      for (const e of enemies) {
        const body = `e${e.i}`, cut = `e${e.i}cut`, shadow = `e${e.i}sh`, sword = `e${e.i}sword`;
        const swordAt = add(EREST(e.i), HAND);
        if (e.restore) {   // put a sliced enemy back together for its next life
          if (e.cut?.split) rig.assign(body, e.rows);
          e.cut = null; e.restore = false;
        }
        if (e.mode === 'off') {
          if (e.dirty) { for (const n of [body, cut, shadow, sword]) rig.set(n, ...HIDDEN); e.dirty = false; }
          continue;
        }
        if (e.mode === 'dying') {
          const d = dyingPoses(e.cut, p.now - e.t0, EREST(e.i), false);
          rig.set(body, d.baseA, d.rest, d.basePos);
          rig.set(cut, d.topA, d.hinge, d.topP);
          rig.child(sword, body, I3, swordAt, swordAt);
          rig.set(shadow, uniform(Math.max(0.001, 0.9 * d.shrink)), d.rest, d.basePos);
          continue;
        }
        const ep = enemyPose(e, p.now);
        rig.set(body, ep.A, EREST(e.i), [ep.x, ep.y, ep.z]);
        rig.child(sword, body, ep.swordA, swordAt, add(EREST(e.i), ep.grip));   // child positions are in the parent's bake frame
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
    checkHits(prev, p, stage, rig);
    checkEnemyHits(prev ? prev.now : now, now, stage, rig);
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

    // Third-person camera: behind the pawn's facing (CAM.yaw offset), easing round as it turns
    const goalYaw = p.phi + CAM.yaw + state.orbit;
    state.yaw += (goalYaw - state.yaw) * (1 - Math.exp(-dt * 6));
    const [fx, fz] = facingVec(p.phi);
    const goal = [p.x + fx * 0.6, 0.6, p.z + fz * 0.6];
    const follow = 1 - Math.exp(-dt * 4);
    const goalDist = state.zoomOut ? Math.min(13.5, state.dist * ZOOM_OUT) : state.dist;
    state.camDist += (goalDist - state.camDist) * (1 - Math.exp(-dt * 5));
    for (const i of [0, 1, 2]) state.target[i] += (goal[i] - state.target[i]) * follow;

    world.anim.update(dt, now);
    const { width, height } = artSize();
    renderer.render(world, {
      width, height, time: now, instances: board, changedRows: allRows,
      camera: { target: state.target, dist: state.camDist * Math.max(1, Math.sqrt(0.9 * height / width)), yaw: state.yaw, pitch: state.pitch, projection: CAM.projection }
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
