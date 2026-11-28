// Endless Board: the pawn from scenes/hop.js, carrying an ivory sword, on a chessboard that never ends.
// Dark pawns drop in from every side and hop forward; a sword hit cuts them in two along the blade's path.
// Rendered by ink-studio's WebGL renderer; the player's pawn and sword are re-shaded live as they turn.
import { createRenderer } from './ink/src/webgl/renderer.mjs';
import { createSplatInstances } from './ink/src/webgl/instances.mjs';
import * as ART from './level-art.js';   // level 1 art from the art thread: frame, table, props, the brute and its hammer

const K = KIT;
const params = new URLSearchParams(location.search);
// hop.js palette (0 bg, 1-5 ivory, 6-8 dark squares, 9-11 light squares) plus 12-16 ebony for the enemy pawns
const PALETTE = [0x0b0d14, 0x3a2f2a, 0x7a634f, 0xb89c7c, 0xe2cfae, 0xfff4dc,
  0x1c2230, 0x2a3448, 0x3a4862, 0x4d5d7c, 0x6a7da0, 0x8a9cc0,
  0x120d0e, 0x241a1a, 0x3b2c29, 0x5a4540, 0x7e655b,
  0x6e2622, 0xa8443a,     // 17–18: danger-square marks
  0xc9a227, 0xf2dc6b,     // 19–20: stun orbs
  ...ART.LEVEL_PALETTE];  // 21–39: level art (walnut, maple, oak, prop reds / greens / blues, iron)
const num = (name, fallback) => { const v = params.get(name); return v !== null && v !== '' && isFinite(v) ? Number(v) : fallback; };   // ?name=value overrides, for feel testing
const SQ = 1.3;          // square size, as in hop.js
const HOP = num('hop', 0.6);       // seconds per player hop (was 1.0, as in hop.js; same curve, just quicker)
const ENEMY_HOP = num('ehop', 1.0); // seconds per enemy hop (unchanged)
const SWING = num('swing', 0.7);   // seconds per swing
// Dash and shield. Every value marked PLACEHOLDER is a stand-in until the design decides it.
const DASH = num('dash', 0.45);    // seconds per dash
const DASH_SQUARES = 2;            // a dash covers two squares, like a pawn's opening move
// A hop or dash may never land on an enemy's square (or one an enemy is hopping into); the move is refused.
// A dash passes through an enemy on its first square.
const STAMINA = num('stamina', 3);         // stamina units; a dash costs one, and with none a dash is a plain hop
const STAMINA_REFILL = num('refill', 8);   // seconds to refill one unit; a kill also refills one
const DANGER_MARKS = params.get('danger') !== '0';   // marks on each enemy's front three squares (?danger=0 hides)
const PARRY_BASE = num('parry', 0.7);   // seconds per parry, before the extra hold
const PARRY_HOLD = num('hold', 0.25);    // extra seconds the shield stays up in the braced hold (was 0; ?hold=0 restores)
const PARRY = PARRY_BASE + PARRY_HOLD;   // whole parry; the shield is up from 0.1 s to 0.42 s + PARRY_HOLD
const PARRY_TURNS = true;          // a parry turns the pawn a quarter turn toward its side, like a swing
// Cancels: a swing or parry can be cancelled into another swing or parry outside its active frames (u ranges below).
// The new move starts partway in, at the wind-up frame nearest the current pose, and cross-fades from it.
const ACTIVE = { swing: [0.25, 0.55], parry: [0.15 * PARRY_BASE / PARRY, (0.6 * PARRY_BASE + PARRY_HOLD) / PARRY] };   // the slash; the shield up (bash and hold)
const BLEND = num('blend', 0.15);           // seconds of cross-fade into a cancelling move
const CANCEL_BUFFER = num('buffer', 0.15);  // a press during active frames still cancels if the window opens within this
// PLACEHOLDER: a cancelled move's quarter turn still counts, so swing left into parry right ends facing the same way,
// and left into left turns 180°.
const STUN = num('stun', 1.0);              // seconds an enemy is stunned after its blade meets an active parry
const PASSIVE_BLOCK = params.get('passive') === '1';   // PLACEHOLDER: the resting shield does not block; only a parry does
const SHIELD_REST = { sweep: 0, y: 0.62, r: 0.44 };     // at rest: directly in front of the pawn, over the sword
const SHIELD_GUARD = { y: 0.74, r: 0.52 };               // raised and pushed out during a parry
const SHIELD_TUCK = { sweep: 1.7, y: 0.5, r: 0.34 };     // out of the blade's way during a swing (sweep is x side)
const SHIELD_BAKE = [-24, 0.6, 40];                      // baked away from the pawn so it picks up no baked shadow
const SHIELD_SCALE = num('shield', 1.5);                // shield size: 1.5× the original heater (2026-11-28), drawn and for contact
const SHIELD_R = [0.2 * SHIELD_SCALE, 0.24 * SHIELD_SCALE, 0.032];   // shield ellipsoid radii for contact (faces -z when baked)
// Enemy attacks and health. PLACEHOLDER values wait on design.
const PLAYER_HP = num('hp', 3);          // PLACEHOLDER: hit points
const ENEMY_WINDUP = num('windup', 0.5); // PLACEHOLDER: an enemy's wind-up, the tell (the player's is 0.175 s)
const ENEMY_SWING_SIDE = num('eside', 1); // an enemy swings toward the side the player is on; straight ahead it swings left (+1, PLACEHOLDER; ?eside=-1 flips it)
const ENEMY_SWING_REST = 0.8;            // PLACEHOLDER: an enemy waits this long after a swing before it may swing again
const ENEMIES_TURN = false;              // PLACEHOLDER: enemies never turn; they travel and swing along one line
const ENEMY_FRIENDLY_FIRE = false;       // PLACEHOLDER: enemy blades pass through other enemies
const TRADE_HITS = 'both';               // PLACEHOLDER: when both blades land in the same swing, both hits count
const INVULN = num('invuln', 1.0);       // PLACEHOLDER: seconds of invulnerability after the player is hit
const BLADE_R = 0.05;                    // blade half-thickness for contact tests
const CHAIN_AT = 0.9;    // a held key starts the next hop once the landing has mostly settled
// Art pixels per world unit. The art grid's height follows the zoom so squares keep the same pixel size: below about
// 20 the renderer drops splats and the board breaks up. ?art= sets the grid height directly.
const ART_DENSITY = 24;
const HAND = [0.1, 0.55, -0.32];   // sword grip at rest: in front of the pawn (pawn faces -z), blade straight up
const BLADE = [0.14, 1.36];      // blade runs from just above the grip to the tip, along the sword's local +y
// ---------- the level ----------
// A 12×12 arena framed by a low wall. Squares are [file, rank-row]: x 0..11 left to right (files a–l), z 0..11 far to
// near (ranks 12..1). Directions are board steps; [0, -1] faces away from the player's starting edge.
const BOARD = 12;
const LEVEL = {
  start: { sq: [5, 11], dir: [0, -1] },          // centre of the near edge, facing in
  pawns: [                                        // regular pawns: where they drop in and which way they walk
    { sq: [1, 2], dir: [1, 0] },
    { sq: [10, 3], dir: [-1, 0] },
    { sq: [3, 5], dir: [0, 1] },
    { sq: [8, 1], dir: [0, 1] },
    { sq: [6, 7], dir: [0, -1] },
    { sq: [10, 8], dir: [0, -1] },
    { sq: [1, 9], dir: [1, 0] }
  ],
  boss: { sq: [5, 2], dir: [0, 1] }               // the pawn brute drops in here once every pawn is down
};
const EMPTY = params.get('empty') === '1';        // tests: an empty board (no pawns drop in, and no boss)
const ENEMIES = LEVEL.pawns.length + 1;           // pool: one per pawn, and the brute last
const BOSS = ENEMIES - 1;
const inBoard = (x, z) => x >= 0 && z >= 0 && x < BOARD && z < BOARD;
const ENEMY_TURN = 0.4;          // seconds for a pawn to turn round at the edge
const STUCK_TURN = num('stuck', 2);   // a pawn blocked by another this long turns round
// The pawn brute: a bigger pawn with a warhammer, on one square. Its swing sweeps every square round it but the one
// straight behind.
const BRUTE_K = 1.35;                            // size against a pawn
const BRUTE_WINDUP = num('bwindup', 0.8);        // the tell (a pawn's is 0.5 s)
const BRUTE_SLASH = 0.45, BRUTE_RECOVER = 0.6;
const BRUTE_SWING = BRUTE_WINDUP + BRUTE_SLASH + BRUTE_RECOVER;
const BRUTE_DAMAGE = num('bdamage', 2);          // PLACEHOLDER: hit points a hammer blow takes
const BRUTE_ARC = 2.6;                           // the hammer sweeps ±149° round from the front
const HAMMER = [0.3, 1.66];                      // contact runs along the handle up through the head
const HAMMER_R = 0.13;                           // the head's half-size, for contact
const ART_MAX = num('artmax', 1024);
const GPU_BONES = params.get('bones') !== '0';   // pose rigged splats on the graphics card (?bones=0: the old CPU path)
const PERF = params.get('perf') === '1';         // ?perf=1: a frame-time readout in the corner
globalThis.PAWN_STATIC_SORT = params.get('sort') !== 'full';   // ?sort=full: the renderer's original full sort every frame             // largest art grid height (zoom-out to the whole arena needs more)
const SLOW = Number(params.get('slow')) || 1;          // ?slow=8 plays everything 8x slower, for inspection
const LIVE_LIGHT = params.get('light') !== 'baked';
// Camera: fixed to the world and orthographic. It follows the pawn but never turns with it. Jordan's picks: yaw 20°
// (the board turned on screen), pitch 35° down, and the earlier iso zoom (about 2.25 squares each way along the
// screen's short axis). ?yaw= ?pitch= (degrees) and ?zoom= (squares) override them.
const DEG = Math.PI / 180;
const ORTHO_TAN = Math.tan(19 * DEG);   // tan of half ink-studio's default 38° field of view
const CAM = { yaw: num('yaw', 20) * DEG, pitch: num('pitch', 35) * DEG, zoom: num('zoom', 2.25) };
// What a swipe straight back (away from the pawn's facing) does. PLACEHOLDER: nothing; ?behind=double makes it two
// swings back to back, turning the pawn round.
// Behind: a 180° spin slash, or a 180° block with the shield (default); ?behind=none does nothing, ?behind=double two swings
const BEHIND = ['double', 'none'].includes(params.get('behind')) ? params.get('behind') : 'turn';
const BEHIND_SIDE = { swing: -1, parry: 1 };   // PLACEHOLDER: the spin slash turns right (sword arm leading), the block left (shield arm)

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

function bakeSquare(ramp, seed) { return bakeBox([0, -0.1, 0], [SQ / 2, 0.1, SQ / 2], ramp, seed, -0.04, 0.07); }
// A box baked on its own, as an instance prototype; splats below `floor` are dropped (never seen)
function bakeBox(centre, half, ramp, seed, floor, res) {
  const B = makeBuilder(seed, PALETTE);
  const S = K.sculpt(makeSculpt(B));
  S.box(centre, half, ramp, { res });
  S.bake();
  return protoOf(B.finish({ detail: 14, dither: 0.2, radius: 4.2 }), i => w => w.data[i * 16 + 1] > floor);
}
// A baked world as a stationary instance prototype, keeping the splats `keepFn(i)(w)` says are ever seen
function protoOf(w, keepFn) {
  const keep = [];
  for (let i = 0; i < w.count; i++) if (keepFn(i)(w)) keep.push(i);
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

// The arena round the board, from the art thread: the walnut frame with rank and file inlays (its rails are the walls),
// the oak tabletop, and the board-game props round it. Baked once as its own world and drawn as one static instance;
// splats facing down are dropped, since nothing sees them.
function bakeArena() {
  const B = makeBuilder(31, PALETTE);
  const S = K.sculpt(makeSculpt(B));
  const mid = (BOARD - 1) * SQ / 2;
  ART.sculptTable(S, [mid, mid], 20); S.bake();
  const edges = ART.sculptBoardFrame(S, { n: BOARD, sq: SQ }); S.bake();
  ART.sculptTableProps(S, edges, () => S.bake());
  const w = B.finish({ detail: 14, dither: 0.2, radius: 30 });
  const nm = w.renderMetadata?.normals;
  return protoOf(w, i => w => w.data[i * 16 + 1] > ART.TABLE_Y - 0.03 && !(nm && nm[i * 3 + 1] < -0.5));
}

// The pawn from hop.js, scaled to fit a square. `fine` = the player's resolution; enemies bake a little coarser.
const PK = 0.5;
// Each enemy is baked at its own spot, away from the player and each other: solids in one bake merge,
// and a neighbour's geometry would darken the baked lighting. The rig moves them from here.
const EREST = i => [30 + 3 * i, 0, 40];
// Squares an enemy threatens, in its own frame (x right, -z ahead): a pawn's front three, the brute's seven
const threatOffsets = boss => boss
  ? [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]]
  : [[-1, -1], [0, -1], [1, -1]];
// ...as board squares, for an enemy on e.sq facing e.dir
const threatSquares = e => threatOffsets(e.boss).map(([lx, lz]) =>
  [e.sq[0] - lz * e.dir[0] - lx * e.dir[1], e.sq[1] - lz * e.dir[1] + lx * e.dir[0]]);
const STUN_BAKE = i => [30 + 3 * i, 0, 60];   // stun orbs bake on their own, away from everything
const STUN_Y = 1.78;                          // orbs circle this high, just above an enemy's head
const pawnProfile = t => PK * (t < 0.12 ? 0.95 : t < 0.2 ? 0.95 - (t - 0.12) * 2.5
  : t < 0.3 ? 0.75 - (t - 0.2) * 1.2 : 0.63 - Math.pow((t - 0.3) / 0.7, 0.6) * 0.35);
function sculptPawn(S, ramp, tag, fine, [x, y, z] = [0, 0, 0], k = 1) {
  const r = fine ? [0.035, 0.03] : [0.045, 0.04];
  S.lathe([x, y, z], 1.9 * PK * k, t => k * pawnProfile(t), ramp, { res: r[0] * k, tag });
  S.lathe([x, y + 1.85 * PK * k, z], 0.16 * PK * k, [0.52 * PK * k, 0.5 * PK * k], ramp, { res: r[1] * k, tag });
  S.ball([x, y + 2.55 * PK * k, z], 0.55 * PK * k, ramp, { res: r[1] * k, tag });
}

const HANDOF = e => e?.boss ? scale(HAND, BRUTE_K) : HAND;

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
  for (let i = 0; i < ENEMIES; i++) { S.lathe(add(EREST(i), [0, 0.005, 0]), 0.01, 0.42 * (i === BOSS ? BRUTE_K : 1), { r: [6, 6] }, { res: 0.06, tag: `e${i}sh` }); S.bake(); }
  // Danger marks: a small red pip on each square an enemy threatens (baked facing -z, turned by the rig): a pawn's
  // front three; the brute's seven (all but straight behind)
  for (let i = 0; i < ENEMIES; i++) {
    for (const [dx, dz] of threatOffsets(i === BOSS)) S.lathe(add(EREST(i), [dx * SQ, 0.007, dz * SQ]), 0.008, 0.1, { r: [17, 18] }, { res: 0.03, tag: `e${i}dz` });
    S.bake();
  }

  sculptPawn(S, ivory, 'pawn', true);
  S.bake();

  // Ivory sword, baked upright in front of the pawn; the rig tilts and swings it
  sculptSword(S, HAND, { blade: ivory, guard: { r: [1, 2, 3] }, grip: { r: [1, 1, 2] }, pommel: { r: [2, 3, 4] } }, 'sword', 0.018);
  S.bake();

  // Heater shield for the off hand: flat top, straight upper sides curving to a point, facing -z, baked on its own;
  // a raised inner panel in a lighter ramp leaves a darker rim round the edge. The rig carries it.
  S.extrude([heaterOutline(SHIELD_SCALE)], SHIELD_BAKE, 0.04, { r: [2, 3, 4] }, { rd: 0.01, res: 0.016, tag: 'shield' });
  S.extrude([heaterOutline(0.78 * SHIELD_SCALE)], add(SHIELD_BAKE, [0, 0.008 * SHIELD_SCALE, -0.016]), 0.024, { r: [3, 4, 5] }, { rd: 0.006, res: 0.014, tag: 'shield' });
  S.bake();

  // Enemy pool: identical dark pawns, all baked at the origin and placed by the rig
  for (let i = 0; i < ENEMIES; i++) {
    const boss = i === BOSS;
    if (boss) ART.sculptBrute(S, ebony, `e${i}`, EREST(i)); else sculptPawn(S, ebony, `e${i}`, false, EREST(i));
    S.bake();
    if (boss) ART.sculptWarhammer(S, add(EREST(i), HANDOF({ boss })), `e${i}sword`);
    else sculptSword(S, add(EREST(i), HAND), { blade: { r: [13, 14, 15] }, guard: { r: [12, 13, 14] }, grip: { r: [12, 12, 13] }, pommel: { r: [13, 14, 15] } }, `e${i}sword`, 0.022);
    S.bake();
  }
  // Stun orbs: three small yellow balls that circle above a stunned enemy's head; baked far off, carried by the rig
  for (let i = 0; i < ENEMIES; i++) {
    for (let k = 0; k < 3; k++) {
      const a = k * 2 * Math.PI / 3;
      S.ball(add(STUN_BAKE(i), [0.24 * Math.cos(a), STUN_Y * (i === BOSS ? BRUTE_K : 1), 0.24 * Math.sin(a)]), 0.055, { r: [19, 20] }, { res: 0.02, tag: `e${i}stun` });
    }
    S.bake();
  }
  for (let i = 0; i < ENEMIES; i++) rig.part(`e${i}cut`);
  rig.part('pawncut');   // the player's top half, when the last hit point goes   // the half a sword hit slices off, filled in on a hit

  const world = B.finish({
    cam: { target: [0, 0.6, 0], dist: 8, pitch: CAM.pitch, yaw: CAM.yaw, projection: 'orthographic' },
    detail: 14, dither: 0.2, radius: 11
  });
  // No fog: under an orthographic camera it forms horizontal dither bands that read as board seams. The board
  // patch is sized to the view instead, and a soft frame on the page hides its edge when zoomed out.
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

// The 180° spin slash, u in [0, 1]: the body twists away, then spins half round toward `side` while the blade
// sweeps a wide arc round the back (from about 35° off the front on that side to 100° past straight behind), so it
// covers the square behind and both back diagonals. It ends facing behind.
function spinPose(u, side) {
  const base = swingPose(u, -side);   // borrow the swing's reach and squash
  const reach = base.reach, sy = base.sy;
  // lean: the arm stays fully out through the whole spin, so the blade still reaches the far back diagonal
  let lean = u < 0.25 ? base.lean : u < 0.55 ? 0.7 + 0.85 * Math.sin(Math.PI * Math.min(1, (u - 0.25) / 0.3 * 2.5) / 2) : base.lean;
  let turn, world, slashing = false;
  if (u < 0.25) {                    // wind up: body coils toward the side, blade held back at the front
    const w = ease(u / 0.25);
    turn = side * 0.9 * w; world = side * 0.1 * w;
  } else if (u < 0.55) {             // spin: the blade whips round the side and across the back; the body follows to 180°
    const a = (u - 0.25) / 0.3, e = easeOut(a);
    world = side * (0.1 + (Math.PI + ARC - 0.1) * e);
    turn = side * (0.9 + (Math.PI - 0.9) * e);
    slashing = Math.abs(world) > 0.6;
  } else {                           // recover: blade back up in front of the body, which settles facing behind
    const a = (u - 0.55) / 0.45, r = 1 - ease(a);
    turn = side * (Math.PI + 0.06 * Math.exp(-5 * a) * Math.sin(a * 12));
    world = turn + side * ARC * r;
  }
  return { sweep: world - turn, lean, turn, sy, reach, slashing };
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
const PARRY_ARC = num('arc', 1.4);
const PARRY_180_EXTRA = num('arc180', 0.7);   // how far past a quarter the 180° block pre-turns (radians)    // how far round the bash carries the shield, in radians from the front (about 80°)
function parryPose(u, side) {
  {  // stretch the hold by PARRY_HOLD seconds: map u on the whole parry back onto the base curve below
    const B = PARRY_BASE, t = u * PARRY;
    const tb = t < 0.36 * B ? t : t < 0.6 * B + PARRY_HOLD ? 0.36 * B + (t - 0.36 * B) * (0.24 * B) / (0.24 * B + PARRY_HOLD) : t - PARRY_HOLD;
    u = Math.min(1, tb / B);
  }
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
// The brute's hammer swing, t in seconds: a long, trembling wind-up with the hammer hauled back behind the far
// shoulder, then one heavy sweep round the front from 149° on one side to 149° on the other (every square round it but
// the one straight behind), and a slow recovery. Returns null once it is over.
function bruteSwingPose(t, side) {
  if (t >= BRUTE_SWING) return null;
  let world, turn, lean, sy, slashing = false;
  if (t < BRUTE_WINDUP) {
    const w = ease(t / BRUTE_WINDUP);
    world = -side * BRUTE_ARC * w; turn = -side * 0.45 * w; lean = 0.3 + 0.95 * w; sy = 1 - 0.12 * w;
    lean += 0.1 * Math.sin(t * 40) * w;              // the tell: the hammer shakes as it comes up
  } else if (t < BRUTE_WINDUP + BRUTE_SLASH) {
    const a = (t - BRUTE_WINDUP) / BRUTE_SLASH, e = Math.pow(a, 1.4);   // heavy: it builds speed through the sweep
    world = side * BRUTE_ARC * (2 * e - 1); turn = side * 0.45 * (2 * e - 1); lean = 1.25; sy = 0.9 + 0.12 * Math.sin(Math.PI * a);
    slashing = true;
  } else {
    const a = ease((t - BRUTE_WINDUP - BRUTE_SLASH) / BRUTE_RECOVER);
    world = side * BRUTE_ARC * (1 - a); turn = side * 0.45 * (1 - a); lean = 1.25 * (1 - a); sy = 1;
  }
  return { sweep: world - turn, turn, lean, sy, reach: 0, slashing };
}
const phiOf = dir => Math.atan2(-dir[0], -dir[1]);   // facing angle for a square direction

// ---------- game state ----------

const state = {
  sq: [0, 0],        // pawn square, absolute (x, z) indices
  origin: [0, 0],    // render origin square; kept near the pawn so coordinates stay small
  phi: 0,            // facing: the pawn looks along facingVec(phi); quarter turns only
  act: null,         // { kind: 'hop' | 'dash', dir, t0 } or { kind: 'swing' | 'parry', side, t0 }
  zoomScale: 1, zoomOut: false, camZoom: 1,   // wheel zoom; the button / Z / pinch zoom-out; the eased value in use
  target: [0, 0.6, 0],
  taken: 0,
  nextSpawn: 1.5,
  hp: PLAYER_HP,
  stamina: STAMINA, staminaAt: null,   // units left; when the next unit refills (null when full)
  hurtAt: -Infinity,  // when the player was last hit
  dead: null          // the cut, once the last hit point is gone
};
window.__endless = state; // for tests
const held = new Map();   // held direction keys -> screen direction (0 up, 1 left, 2 down, 3 right)
let queued = null;         // { kind: 'dir', sdir, dash, shield } or { kind, side }, waiting for the current action
let followUp = null;       // a second move to run straight after (two swings for BEHIND = 'double')

// Screen direction (0 up, 1 left, 2 down, 3 right) -> the board direction nearest to it as seen on screen
function boardDir(sdir) {
  const [x, z] = facingVec(CAM.yaw + sdir * Math.PI / 2);
  return Math.abs(x) > Math.abs(z) ? [Math.sign(x), 0] : [0, Math.sign(z)];
}
const facingDir = phi => { const [x, z] = facingVec(phi); return [Math.round(x), Math.round(z)]; };
const same = (a, b) => a[0] === b[0] && a[1] === b[1];
// The one legal move toward a screen direction: forward hops or dashes, a side swings or parries that way
function moveToward({ sdir, dash, shield }) {
  const d = boardDir(sdir);
  if (same(d, facingDir(state.phi))) return { kind: dash ? 'dash' : 'hop' };
  if (same(d, facingDir(state.phi + Math.PI / 2))) return { kind: shield ? 'parry' : 'swing', side: 1 };
  if (same(d, facingDir(state.phi - Math.PI / 2))) return { kind: shield ? 'parry' : 'swing', side: -1 };
  if (BEHIND === 'turn') { const kind = shield ? 'parry' : 'swing'; return { kind, side: BEHIND_SIDE[kind], q: 2 }; }
  if (BEHIND === 'double') { followUp = { kind: 'swing', side: 1 }; return { kind: 'swing', side: 1 }; }
  return null;
}

// Enemies: { i, mode: 'off' | 'drop' | 'idle' | 'hop' | 'swing' | 'dying', sq, dir, t0, wait, cut, struck, blocked }
const enemies = Array.from({ length: ENEMIES }, (_, i) => ({ i, boss: i === BOSS, mode: 'off', sq: [0, 0], dir: [0, -1], t0: 0, wait: 0, dirty: true }));
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

// Squares enemies stand on or are hopping into
function enemySquares(except) {
  const o = new Set();
  for (const e of enemies) {
    if (e.mode === 'off' || e.mode === 'dying' || e === except) continue;
    o.add(sqKey(...e.sq));
    if (e.mode === 'hop') o.add(sqKey(e.sq[0] + e.dir[0], e.sq[1] + e.dir[1]));
  }
  return o;
}

// Stamina: discrete units. Spending one starts the refill clock; each refill restarts it until the bar is full.
function spendStamina(now) {
  state.stamina--;
  if (state.staminaAt === null) state.staminaAt = now + STAMINA_REFILL;
  showStamina();
}
function gainStamina(now) {
  state.stamina = Math.min(STAMINA, state.stamina + 1);
  state.staminaAt = state.stamina < STAMINA ? now + STAMINA_REFILL : null;
  showStamina();
}

// Start (or restart) the level: the player back on its start square, every pawn dropping in where the level says
function startLevel(now) {
  Object.assign(state, { sq: LEVEL.start.sq.slice(), phi: phiOf(LEVEL.start.dir), act: null, dead: null, hp: PLAYER_HP,
    hurtAt: -Infinity, stamina: STAMINA, staminaAt: null, taken: 0, phase: EMPTY ? 'empty' : 'pawns', restore: true });
  queued = null; followUp = null;
  for (const e of enemies) {
    if (e.mode !== 'off' || e.cut) { e.dirty = true; if (e.cut) e.restore = true; }
    Object.assign(e, { mode: 'off', stunUntil: 0, rested: 0, stuckSince: null });
  }
  if (!EMPTY) LEVEL.pawns.forEach((d, i) => Object.assign(enemies[i], { mode: 'drop', sq: d.sq.slice(), dir: d.dir.slice(), t0: now, wait: rand(0.6, 2.5), dirty: true }));
  taken.textContent = 0; showHp(); showStamina(); banner.hidden = true;
}
// Every pawn down: the brute drops in on its square, or the nearest free one
function bringBoss(now) {
  const taken = occupied(), want = LEVEL.boss.sq;
  let sq = want;
  for (let r = 0; r < BOARD && taken.has(sqKey(...sq)); r++)
    sq = [...Array((2 * r + 1) ** 2).keys()].map(k => [want[0] + (k % (2 * r + 1)) - r, want[1] + Math.floor(k / (2 * r + 1)) - r])
      .find(q => inBoard(...q) && !taken.has(sqKey(...q))) ?? sq;
  Object.assign(enemies[BOSS], { mode: 'drop', sq, dir: LEVEL.boss.dir.slice(), t0: now, wait: rand(1, 2), stunUntil: 0, rested: 0, stuckSince: null, dirty: true });
  state.phase = 'boss';
  flash('The brute');
}

// Is the player on the square ahead of this enemy or either front diagonal? (Counts where the player is
// moving to, as well as where it stands.)
function playerSquares() {
  const mine = [sqKey(...state.sq)], a = state.act;
  if (a?.dir) for (let k = 1; k <= (a.kind === 'dash' ? DASH_SQUARES : 1); k++) mine.push(sqKey(state.sq[0] + k * a.dir[0], state.sq[1] + k * a.dir[1]));
  return mine;
}
function playerInFront(e) {
  const threat = threatSquares(e).map(q => sqKey(...q));
  return playerSquares().some(m => threat.includes(m));
}
// Which way an enemy swings: toward the front diagonal the player is on (a left swing covers front, left diagonal and
// left), or ENEMY_SWING_SIDE when the player is straight ahead. Where the player stands counts before where it is going.
function enemySwingSide(e) {
  const threat = threatSquares(e), keys = threat.map(q => sqKey(...q));
  for (const m of playerSquares()) {
    const q = threat[keys.indexOf(m)];
    if (!q) continue;
    const lateral = (q[0] - e.sq[0]) * e.dir[1] - (q[1] - e.sq[1]) * e.dir[0];   // > 0: on its left
    return lateral > 0 ? 1 : lateral < 0 ? -1 : ENEMY_SWING_SIDE;
  }
  return ENEMY_SWING_SIDE;
}

const swingLength = e => e.boss ? BRUTE_SWING : ENEMY_SWING;
function stepEnemies(now) {
  for (const e of enemies) {
    if (e.mode === 'drop' && now - e.t0 >= 0.75) { e.mode = 'idle'; e.t0 = now; }
    if (e.mode === 'hop' && now - e.t0 >= ENEMY_HOP) {
      e.sq = [e.sq[0] + e.dir[0], e.sq[1] + e.dir[1]];
      e.mode = 'idle'; e.t0 = now; e.wait = rand(0.4, 2.8);
    }
    if (e.mode === 'turn' && now - e.t0 >= ENEMY_TURN) { e.mode = 'idle'; e.t0 = now; e.wait = rand(0.4, 1.6); }
    if (e.mode === 'swing' && now - e.t0 >= swingLength(e)) { e.mode = 'idle'; e.t0 = now; e.wait = rand(0.4, 2.8); e.rested = now + ENEMY_SWING_REST; }
    // On a square, it swings once the player stands on a square it threatens; once committed it plays out
    if (e.mode === 'idle' && now < (e.stunUntil ?? 0)) continue;   // stunned: no moves, no swings
    if ((e.mode === 'idle') && !state.dead && now >= (e.rested ?? 0) && playerInFront(e)) {
      Object.assign(e, { mode: 'swing', t0: now, side: enemySwingSide(e), struck: false, blocked: false });
      continue;
    }
    if (e.mode === 'idle' && now - e.t0 >= e.wait) {
      const nx = e.sq[0] + e.dir[0], nz = e.sq[1] + e.dir[1], next = sqKey(nx, nz);
      const byEnemy = enemySquares(e).has(next);
      e.stuckSince = byEnemy ? e.stuckSince ?? now : null;
      // at the edge, or stuck behind another piece too long: turn round and walk back
      if (!inBoard(nx, nz) || (byEnemy && now - e.stuckSince >= STUCK_TURN)) {
        Object.assign(e, { mode: 'turn', t0: now, turnFrom: phiOf(e.dir), dir: [-e.dir[0], -e.dir[1]], stuckSince: null });
      } else if (!occupied().has(next)) { e.mode = 'hop'; e.t0 = now; }
      else { e.t0 = now; e.wait = rand(0.3, 1.2); }
    }
    if (e.mode === 'dying' && now - e.t0 >= 1.6) { e.mode = 'off'; e.dirty = true; e.restore = true; }
  }
  // Every pawn down brings the brute; the brute down wins the level
  if (state.phase === 'pawns' && enemies.every(e => e.boss || e.mode === 'off')) bringBoss(now);
  if (state.phase === 'boss' && enemies[BOSS].mode === 'off' && !state.dead) {
    state.phase = 'won';
    bannerTitle.textContent = 'Board cleared'; banner.hidden = false;
  }
}

// Cancel a swing or parry into another, outside its active frames. Directions are read against the facing before
// the move (in its wind-up) or after it (in its recovery, once the body has visibly turned).
function cancelInto(now) {
  const a = state.act;
  if (!a || !(a.kind === 'swing' || a.kind === 'parry') || !queued || state.dead) return;
  const u = actU(a, now), [s0, s1] = ACTIVE[a.kind];
  if (u >= s0 && u < s1) return;                       // active frames can't be cancelled
  if (now - queued.at > CANCEL_BUFFER) return;         // pressed too early: it runs after the move instead
  let next = queued;
  if (next.kind === 'dir') {
    const phi0 = state.phi;
    state.phi += u >= s1 ? a.side * (a.q || 1) * Math.PI / 2 : 0;
    next = moveToward(next);
    state.phi = phi0; followUp = null;
  }
  if (!next || !(next.kind === 'swing' || next.kind === 'parry')) return;   // hops and dashes wait for the move to end
  const from = sideChannels(a, now), yaw = state.phi + from.turn;
  state.phi += a.side * (a.q || 1) * Math.PI / 2;      // the cancelled move's turn still counts
  // enter the new move at the wind-up frame nearest the current pose (sword and shield channels)
  let u0 = 0, best = Infinity;
  for (let i = 0; i <= 12; i++) {
    const t = 0.9 * ACTIVE[next.kind][0] * i / 12, c = moveChannels(next.kind, t, next.side, next.q);
    const d = CHANNELS.reduce((sum, n) => sum + (c[n] - from[n]) ** 2, 0);
    if (d < best) { best = d; u0 = t; }
  }
  const debt = yaw - (state.phi + moveChannels(next.kind, u0, next.side, next.q).turn);
  state.act = { kind: next.kind, side: next.side, q: next.q || 1, t0: now - u0 * DURATION[next.kind], u0, tb: now, from, debt };
  queued = null;
}

// A held direction key that points the way the pawn faces keeps it hopping
const heldForward = () => [...held.values()].some(sdir => same(boardDir(sdir), facingDir(state.phi)));

function step(now) {
  if (state.restartPending || !state.phase) { state.restartPending = false; startLevel(now); }
  if (state.staminaAt !== null && now >= state.staminaAt) gainStamina(now);
  const a = state.act;
  if (a) {
    const u = (now - a.t0) / DURATION[a.kind];
    const chain = a.kind === 'hop' && u >= CHAIN_AT && (heldForward() || queued);
    if (u >= 1 || chain) {
      if (a.kind === 'hop') { state.sq[0] += a.dir[0]; state.sq[1] += a.dir[1]; }
      else if (a.kind === 'dash') { state.sq[0] += DASH_SQUARES * a.dir[0]; state.sq[1] += DASH_SQUARES * a.dir[1]; }
      else if (a.kind === 'swing' || (a.kind === 'parry' && PARRY_TURNS)) state.phi += a.side * (a.q || 1) * Math.PI / 2;
      state.act = null;
    }
  }
  if (state.dead) { state.act = null; queued = null; followUp = null; }
  if (queued && queued.at === undefined) queued.at = now;
  cancelInto(now);
  if (!state.act && !state.dead) {
    let next = followUp ?? queued ?? (heldForward() ? { kind: 'hop' } : null);
    if (followUp) followUp = null; else queued = null;
    if (next?.kind === 'dir') next = moveToward(next);
    if (next?.kind === 'hop' || next?.kind === 'dash') {
      const [fx, fz] = facingVec(state.phi), dir = [Math.round(fx), Math.round(fz)];
      if (next.kind === 'dash' && state.stamina < 1) next = { kind: 'hop' };   // out of stamina: a plain hop
      // Never land on an enemy: its square, or the square it is hopping into, refuses the move. A dash passes over
      // its first square, enemy or not.
      const n = next.kind === 'dash' ? DASH_SQUARES : 1;
      const land = sqKey(state.sq[0] + n * dir[0], state.sq[1] + n * dir[1]);
      if (inBoard(state.sq[0] + n * dir[0], state.sq[1] + n * dir[1]) && !enemySquares().has(land)) {   // the wall stops it
        state.act = { kind: next.kind, dir, t0: now };
        if (next.kind === 'dash') spendStamina(now);
      }
    } else if (next) state.act = { kind: next.kind, side: next.side, q: next.q || 1, t0: now };
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

// Side moves (swing, parry) as named channels, so one can blend into another. `turn` is the body's yaw on top of
// state.phi; the sword and shield channels are relative to the body.
const CHANNELS = ['sy', 'sweep', 'lean', 'reach', 'shSweep', 'shFace', 'shY', 'shR', 'shTilt'];
const REST_CH = { turn: 0, sy: 1, sweep: 0, lean: 0, reach: 0, shSweep: SHIELD_REST.sweep, shFace: 0, shY: SHIELD_REST.y, shR: SHIELD_REST.r, shTilt: 0 };
function moveChannels(kind, u, side, q = 1) {
  if (kind === 'swing') {
    const s = (q === 2 ? spinPose : swingPose)(u, side);
    // tuck the shield round to the side the swing ends on, out of the blade's arc, then bring it back in front
    const tuck = u < 0.2 ? ease(u / 0.2) : u < 0.75 ? 1 : 1 - ease((u - 0.75) / 0.25);
    return { turn: s.turn, sy: s.sy, sweep: s.sweep, lean: s.lean, reach: s.reach,
      shSweep: SHIELD_REST.sweep + (side * SHIELD_TUCK.sweep - SHIELD_REST.sweep) * tuck, shFace: 0,
      shY: SHIELD_REST.y + (SHIELD_TUCK.y - SHIELD_REST.y) * tuck, shR: SHIELD_REST.r + (SHIELD_TUCK.r - SHIELD_REST.r) * tuck, shTilt: 0,
      slashing: s.slashing, parrying: false };
  }
  const b = parryPose(u, side);
  if (q === 2) {   // 180° block: the body pre-turns past a quarter during the cock, so the bash and hold sit round the
    // back (covering the square behind and both back diagonals); the extra comes back off in the final turn
    const pre = side * (Math.PI / 2 + PARRY_180_EXTRA) * ease(Math.min(1, u / 0.15))
      - side * PARRY_180_EXTRA * (u < 0.6 ? 0 : ease((u - 0.6) / 0.4));
    b.turn += pre;
  }
  return { turn: b.turn, sy: b.sy, sweep: b.sword.sweep, lean: b.sword.lean, reach: 0,
    shSweep: b.shield.sweep, shFace: b.shield.face, shY: b.shield.y, shR: b.shield.r, shTilt: b.shield.tilt,
    slashing: false, parrying: b.parrying };
}
const actU = (a, now) => Math.min(1, Math.max(a.u0 ?? 0, (now - a.t0) / DURATION[a.kind]));
// The channels of the current side move at `now`, cross-faded from where a cancelled move left off. This is the
// cross-fade K.machine does (smoothstep over BLEND seconds from a snapshot), written as a function of the game clock
// so contact sub-steps can sample any instant. The body's turn blends over the rest of the move instead, so a
// cancelled quarter turn unwinds smoothly. Hit and block timing (slashing, parrying) come from the clock alone.
function sideChannels(a, now) {
  const u = actU(a, now), c = moveChannels(a.kind, u, a.side, a.q);
  if (a.from) {
    const k = ease(Math.min(1, Math.max(0, (now - a.tb) / BLEND)));
    for (const n of CHANNELS) c[n] = a.from[n] + (c[n] - a.from[n]) * k;
    c.turn += a.debt * (1 - ease(Math.min(1, Math.max(0, (u - a.u0) / (1 - a.u0)))));
  }
  return c;
}

// Player pose, including where the sword is
function pose(now) {
  let [x, z] = toRender(state.sq);
  let y = 0, phi = state.phi, A = rotY(phi);
  let c = { ...REST_CH }, slashing = false, parrying = false, u = 0, side = 0;
  const a = state.act;
  if (a?.kind === 'hop' || a?.kind === 'dash') {
    const dash = a.kind === 'dash';
    const h = (dash ? dashPose : hopPose)(Math.min(1, (now - a.t0) / DURATION[a.kind]));
    const d = (dash ? DASH_SQUARES : 1) * SQ * h.along;
    x += a.dir[0] * d; z += a.dir[1] * d; y = h.y;
    A = K.M.mul(hopMatrix(h, a.dir), rotY(phi));
    if (dash) { c.lean = -0.5 * Math.min(1, Math.max(0, -h.tilt / 0.4)); c.shR += 0.04; }   // sword and shield swept back by the rush
  } else if (a?.kind === 'swing' || a?.kind === 'parry') {
    u = actU(a, now); side = a.side;
    c = sideChannels(a, now);
    ({ slashing, parrying } = c);
    phi += c.turn;
    A = K.M.mul(scaleY(c.sy), rotY(phi));
  }
  const hurt = now - state.hurtAt;   // flinch when hit: a sharp squash that rings out
  if (hurt >= 0 && hurt < 0.45) A = K.M.mul(scaleY(1 - 0.16 * Math.exp(-7 * hurt) * Math.cos(hurt * 28)), A);
  return build({ x, y, z, A, phi, c, slashing, parrying, u, side, now });
}
// Sword and shield matrices from the channels
function build(p) {
  const c = p.c;
  // Sword: carried round the pawn's axis by `sweep`, tilted outward by `lean`, held further out by `reach`
  p.grip = mv(rotY(c.sweep), [HAND[0], HAND[1], HAND[2] - c.reach]);
  p.swordA = K.M.mul(rotY(c.sweep), K.M.rot([1, 0, 0], -c.lean));
  // Shield: carried round the pawn's axis, its face pointing outward along `sweep`; face is an extra turn on its own axis
  p.shieldAt = mv(rotY(c.shSweep), [0, c.shY, -c.shR]);
  p.shieldA = K.M.mul(rotY(c.shSweep + c.shFace), K.M.rot([1, 0, 0], c.shTilt));
  return p;
}
// Render-only follow-through: springs on the sword's tilt and the shield's face hide what seams a cancel leaves.
// Contact always uses the unsprung pose.
const FOLLOW = num('follow', 900);   // spring stiffness; ?follow=0 turns it off
let springs = null;
function followThrough(p, dt) {
  if (!FOLLOW || !K.spring) return p;
  const keys = ['lean', 'shFace', 'shTilt'];
  springs ??= keys.map(k => K.spring(p.c[k], FOLLOW, 0.55));
  const c = { ...p.c };
  keys.forEach((k, i) => { c[k] = springs[i].step(p.c[k], dt); if (typeof c[k] !== 'number') c[k] = springs[i].x; });
  return build({ ...p, c });
}

// World-space point t along the blade, for a pose (the player's or an enemy's)
function bladePoint(p, t) {
  return add([p.x, p.y, p.z], mv(p.A, add(p.grip, mv(p.swordA, [0, t, 0]))));
}

// Enemy pose: position, matrix (about its bake spot) and its sword
function enemyPose(e, now) {
  let [x, z] = toRender(e.sq), y = 0;
  let phi0 = phiOf(e.dir);
  const u = now - e.t0;
  if (e.mode === 'turn') phi0 = e.turnFrom + Math.PI * ease(Math.min(1, u / ENEMY_TURN));   // turning round
  let A = rotY(phi0), sweep = 0, lean = 0, reach = 0, slashing = false;
  if (e.mode === 'drop') {           // falls in from above, lands with the hop's squash
    if (u < 0.4) { const f = u / 0.4; y = 4 * (1 - f * f); }
    else { const h = hopPose(0.7 + 0.3 * Math.min(1, (u - 0.4) / 0.35)); A = K.M.mul(scaleY(h.sy), A); }
  } else if (e.mode === 'hop') {
    const h = hopPose(Math.min(1, u / ENEMY_HOP));
    x += e.dir[0] * SQ * h.along; z += e.dir[1] * SQ * h.along; y = h.y;
    A = K.M.mul(hopMatrix(h, e.dir), A);
  } else if (e.mode === 'swing') {
    const s = e.boss ? bruteSwingPose(u, e.side) : enemySwingPose(u, e.side);
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
  const hand = HANDOF(e);
  const grip = mv(rotY(sweep), [hand[0], hand[1], hand[2] - reach]);
  const swordA = K.M.mul(rotY(sweep), K.M.rot([1, 0, 0], -lean));
  return { x, y, z, A, grip, swordA, slashing, phi: phi0, now, sdf: e.boss ? ART.bruteSDF : pawnSDF,
    weapon: e.boss ? HAMMER_TS : BLADE_TS, weaponR: e.boss ? HAMMER_R : BLADE_R };
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
const touchesPawn = (p, q, r = BLADE_R) => (p.sdf || pawnSDF)(toLocal(p, q)) < r;
const touchesShield = (p, q, r = BLADE_R) => shieldSDF(mv(inv3(p.shieldA), sub(toLocal(p, q), p.shieldAt))) < r;
const BLADE_TS = []; for (let t = 0.2; t <= BLADE[1] + 1e-6; t += 0.08) BLADE_TS.push(t);
const HAMMER_TS = []; for (let t = HAMMER[0]; t <= HAMMER[1] + 1e-6; t += 0.08) HAMMER_TS.push(t);
// Sub-steps between frames (one per 4 ms, at least 4), so a fast blade can't skip through a piece or a shield at
// low frame rates
const stepsFor = dt => Math.min(40, Math.max(4, Math.ceil(dt / 0.004)));

// The player's blade against each enemy's shape
function checkHits(prev, cur, stage, rig) {
  if (state.dead || (!cur.slashing && !prev?.slashing)) return;
  for (const e of enemies) {
    if (!['idle', 'hop', 'drop', 'swing', 'turn'].includes(e.mode)) continue;
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
      const p = pose(tm), pts = ep.weapon.map(t => [t, bladePoint(ep, t)]);
      if ((p.parrying || PASSIVE_BLOCK) && pts.some(([, b]) => touchesShield(p, b, ep.weaponR))) {
        e.blocked = true; e.blockedAt = tm; flash('Parried');
        if (p.parrying) e.stunUntil = tm + STUN;   // PLACEHOLDER: a block by the resting shield (?passive=1) doesn't stun
        break;
      }
      const hit = pts.find(([, b]) => touchesPawn(p, b, ep.weaponR));
      if (!hit) continue;
      e.struck = true;
      if (tm - state.hurtAt < INVULN) break;
      state.hurtAt = tm; state.hp -= e.boss ? BRUTE_DAMAGE : 1;
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
  if (state.stamina < STAMINA) gainStamina(now);   // a kill refills one unit
}

function killPlayer(e, ep, p, t, stage, now) {
  state.dead = cutPiece({ blade: tm => enemyPose(e, tm), t, now, rows: state.pawnRows, rest: [0, 0, 0], pos: [p.x, 0, p.z],
    cutPart: 'pawncut', stage, rig: state.rig, phi: p.phi });
  state.act = null;
  bannerTitle.textContent = 'Cut down'; banner.hidden = false;
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
const bannerTitle = document.getElementById('banner-title');
function showHp() { hpEl.textContent = '■'.repeat(Math.max(0, state.hp)) + '□'.repeat(Math.max(0, PLAYER_HP - state.hp)); }
let flashTimer = 0;
function flash(text) {
  flashEl.textContent = text; flashEl.hidden = false;
  clearTimeout(flashTimer); flashTimer = setTimeout(() => { flashEl.hidden = true; }, 600);
}
const stEl = document.getElementById('stamina');
function showStamina() { stEl.textContent = '◆'.repeat(Math.max(0, state.stamina)) + '◇'.repeat(Math.max(0, STAMINA - state.stamina)); }
showHp(); showStamina();
// Restart the whole level: R or the button, after being cut down or clearing the board (R also works mid-level)
function restart() { state.restartPending = true; }
document.getElementById('restart').addEventListener('click', restart);

// ---------- input ----------

// Any control brings the camera back from the zoomed-out view
const press = (kind, side = 0) => { state.zoomOut = false; queued = { kind, side }; };
const pressDir = (sdir, dash, shield) => { state.zoomOut = false; queued = { kind: 'dir', sdir, dash, shield }; };
const zoomOut = () => { state.zoomOut = true; };

// Keyboard: W A S D or the arrows are screen directions. F toggles sword / shield mode, and holding Shift uses the
// other mode for one move;
// hold Space while pressing forward to dash, or tap Space alone to dash the way the pawn faces. Z zooms out.
const SDIR = { KeyW: 0, ArrowUp: 0, KeyA: 1, ArrowLeft: 1, KeyS: 2, ArrowDown: 2, KeyD: 3, ArrowRight: 3 };
let spaceHeld = false, spaceUsed = false;
addEventListener('keydown', e => {
  if (e.code === 'KeyR' && !e.repeat) { restart(); return; }
  if (e.code === 'KeyZ' && !e.repeat) { if (state.zoomOut) state.zoomOut = false; else zoomOut(); return; }
  if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) { spaceHeld = true; spaceUsed = false; } return; }
  const sdir = SDIR[e.code];
  if (sdir === undefined) return;
  e.preventDefault();
  if (e.repeat) return;
  held.set(e.code, sdir);
  if (spaceHeld) spaceUsed = true;
  pressDir(sdir, spaceHeld, e.shiftKey);   // Shift + a side parries; a side alone swings
});
addEventListener('keyup', e => {
  held.delete(e.code);
  if (e.code === 'Space') { if (spaceHeld && !spaceUsed) press('dash'); spaceHeld = false; }
});
addEventListener('blur', () => { held.clear(); spaceHeld = false; });

// Touch: swipe the way you want to go or face; a long swipe ahead dashes. A sideways swipe that starts on the left
// half of the screen parries that way; one that starts on the right half swings. The zoom-out button pulls the
// camera back until the next move.
const SWIPE_MIN = 24;                                       // px: shorter is a tap
const swipeLong = () => Math.max(150, num('dashswipe', 0.35) * Math.min(innerWidth, innerHeight));   // px for a dash (was 90 px or a fifth)
const zoomBtn = document.getElementById('zoom');
// shield: true parries (a swipe from the left half), false swings
function swipe(dx, dy, shield = false) {
  const len = Math.hypot(dx, dy);
  if (len < SWIPE_MIN) return false;
  const sdir = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 1 : 3) : (dy < 0 ? 0 : 2);
  pressDir(sdir, len >= swipeLong(), shield);
  return true;
}
window.__swipe = swipe; // for tests
zoomBtn.addEventListener('click', () => { if (state.zoomOut) state.zoomOut = false; else zoomOut(); });

const touches = new Map();   // pointerId -> { x, y, x0, y0 }
let pinch = null;            // starting distance between two fingers
canvas.addEventListener('pointerdown', e => {
  if (e.pointerType === 'mouse') return;
  try { canvas.setPointerCapture(e.pointerId); } catch {}
  touches.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY });
  if (touches.size === 2) { const [a, b] = [...touches.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); }
});
canvas.addEventListener('pointermove', e => {
  const t = touches.get(e.pointerId);
  if (!t) return;
  t.x = e.clientX; t.y = e.clientY;
  if (pinch && touches.size === 2) {
    const [a, b] = [...touches.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
    if (d < 0.7 * pinch) zoomOut();
    else if (d > 1.3 * pinch) state.zoomOut = false;
  }
});
const lift = e => {
  const t = touches.get(e.pointerId);
  if (!t) return;
  touches.delete(e.pointerId);
  if (pinch) { if (!touches.size) pinch = null; return; }   // fingers of a pinch don't swipe
  if (e.type === 'pointerup') swipe(t.x - t.x0, t.y - t.y0, t.x0 < innerWidth / 2);   // left half parries
};
canvas.addEventListener('pointerup', lift);
canvas.addEventListener('pointercancel', lift);
canvas.addEventListener('dblclick', () => { state.zoomScale = 1; });
canvas.addEventListener('wheel', e => {
  state.zoomScale = Math.min(2, Math.max(0.6, state.zoomScale * Math.exp(e.deltaY * 0.001)));
  e.preventDefault();
}, { passive: false });

// ---------- run ----------

// Half the view's height in world units, for the camera's zoom (squares each way on the short axis)
function viewHalfHeight(width, height) {
  const half = CAM.zoom * SQ, aspect = width / height;
  return aspect >= 1 ? half : half / aspect;
}
// The zoom that fits the whole arena and its frame on screen, from the fixed camera's yaw and pitch
function arenaZoom(aspect, half0) {
  const L = BOARD * SQ / 2 + 0.95,   // the board and its frame rails
     c = Math.abs(Math.cos(CAM.yaw)), sn = Math.abs(Math.sin(CAM.yaw));
  const across = L * (c + sn), up = L * (c + sn) * Math.sin(CAM.pitch) + 0.8 * Math.cos(CAM.pitch);
  return 1.04 * Math.max(up, across / aspect) / half0;
}
function artSize() {
  const aspect = Math.max(0.5, Math.min(2.6, innerWidth / Math.max(1, innerHeight)));
  // view half-height in world units, including scroll zoom and zoom-out; rounded to 8 px so easing resizes rarely
  const half = (aspect >= 1 ? CAM.zoom * SQ : CAM.zoom * SQ / aspect) * (state.camZoom ?? 1);
  const height = num('art', 8 * Math.round(Math.min(ART_MAX, Math.max(168, 2 * half * ART_DENSITY)) / 8));
  return { width: Math.round(height * aspect), height };
}

// ?perf=1: frame time, and where the JavaScript part of it goes, averaged over the last second. Whatever is left of the
// frame interval after the JavaScript is the graphics card (and the browser) at work.
function createPerf() {
  const el = document.createElement('pre');
  el.style.cssText = 'position:fixed;left:8px;top:50%;margin:0;padding:6px 8px;background:#000a;color:#cfe;font:11px/1.35 monospace;z-index:9;pointer-events:none';
  document.body.appendChild(el);
  let n = 0, sum = [0, 0, 0, 0], t0 = performance.now(), size = '';
  return {
    add(interval, game, pose, render, w, h) {
      n++; sum[0] += interval; sum[1] += game; sum[2] += pose; sum[3] += render; size = w + '×' + h;
      if (performance.now() - t0 < 1000) return;
      const f = k => (sum[k] / n).toFixed(1).padStart(5);
      const js = (sum[1] + sum[2] + sum[3]) / n;
      el.textContent = `fps    ${(1000 / (sum[0] / n)).toFixed(0)}\nframe ${f(0)} ms\n game ${f(1)}\n pose ${f(2)}\n render${f(3)} (incl. sort)\n other${Math.max(0, sum[0] / n - js).toFixed(1).padStart(5)} (GPU, browser)\nart ${size}  bones ${GPU_BONES ? 'GPU' : 'CPU'}  sort ${globalThis.PAWN_STATIC_SORT ? 'cached' : 'full'}`;
      n = 0; sum = [0, 0, 0, 0]; t0 = performance.now();
    }
  };
}

function start() {
  const t0 = performance.now();
  const light = bakeSquare({ r: [9, 10, 11] }, 21);
  const dark = bakeSquare({ r: [6, 7, 8] }, 22);
  const { world, rig, capture, sun } = bakeWorld();

  // The arena: 12 × 12 squares in the art thread's frame on its tabletop, all drawn as instances
  const arena = bakeArena();
  state.window = BOARD;
  const placements = [{ id: 'arena', prototype: 'arena', position: [0, 0, 0] }];
  for (let i = 0; i < BOARD; i++)
    for (let j = 0; j < BOARD; j++) placements.push({ id: `sq-${i}-${j}`, prototype: (i + j) & 1 ? 'dark' : 'light', position: [i * SQ, 0, j * SQ] });
  const board = createSplatInstances({ light, dark, arena }, placements);

  const stage = K.stage(world);
  rig.bind(stage);
  for (const e of enemies) e.rows = Int32Array.from(rig.list[rig.part(`e${e.i}`)]);   // this enemy's splats
  state.pawnRows = Int32Array.from(rig.list[rig.part('pawn')]);
  state.rig = rig;

  // ---- performance ----
  // GPU bones (K.bones): every rigged splat stays in its rest pose on the graphics card, and each frame only the rig's
  // matrices (12 numbers a part, rig.M) go up; the card turns and moves each splat by its part's matrix as it draws.
  // The rig then never moves those splats on the CPU (rig.free). ?bones=0 keeps the old CPU path, for comparison.
  const D = world.data, N = world.count, changed = new Set();
  const markRow = i => changed.add(i >> 9);
  if (GPU_BONES) {
    const ids = [], bids = [];
    for (let i = 0; i < N; i++) if (rig.bid[i]) { ids.push(i); bids.push(rig.bid[i]); }
    const tagged = K.bones.tag(world, Int32Array.from(ids), Uint16Array.from(bids));
    for (const i of tagged.boned) rig.free[i] = 1;
    stage.bones = rig.M; stage.boned = tagged.boned;   // world.anim is the stage: the renderer reads its bones from here
    console.log('GPU bones:', tagged.boned.length, 'splats on', rig.M.length / 12, 'parts;', tagged.cpu.length, 'left on the CPU');
  }
  // Hidden parts (parked enemies, unseen pips and orbs, the cut half before a cut) are left out of the sort and the
  // draw altogether: world.sortSkip, read by the patched sorter in ink/src/webgl/view.mjs.
  const skip = world.sortSkip = new Uint8Array(N), hiddenPart = new Uint8Array(rig.M.length / 12);
  const HIDDEN = [uniform(0.001), [0, 0, 0], [0, -60, 0]];
  const setPart = rig.set;
  rig.set = (b, A, o, q) => {
    const id = typeof b === 'string' ? rig.part(b) : b, hide = A === HIDDEN[0] ? 1 : 0;
    if (id && hiddenPart[id] !== hide) { hiddenPart[id] = hide; for (const i of rig.list[id]) skip[i] = hide; }
    setPart(b, A, o, q);
  };
  // A cut moves splats to another part: on the card their bone number changes too
  const assignPart = rig.assign;
  rig.assign = (name, indices) => {
    assignPart(name, indices);
    for (const i of indices) { if (GPU_BONES) D[i * 16 + 12] = rig.bid[i]; skip[i] = hiddenPart[rig.bid[i]]; markRow(i); }
    return rig;
  };
  for (let b = 1; b < hiddenPart.length; b++) hiddenPart[b] = 0;

  let p = pose(0);
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
        const body = `e${e.i}`, cut = `e${e.i}cut`, shadow = `e${e.i}sh`, sword = `e${e.i}sword`, marks = `e${e.i}dz`, orbs = `e${e.i}stun`;
        const stunned = p.now < (e.stunUntil ?? 0) && e.mode !== 'off' && e.mode !== 'dying';
        // Danger marks follow the enemy across the board, once it has landed and until it dies
        if (DANGER_MARKS && !stunned && (e.mode === 'idle' || e.mode === 'hop' || e.mode === 'swing')) {
          let [mx, mz] = toRender(e.sq);
          if (e.mode === 'hop') { const k = hopPose(Math.min(1, (p.now - e.t0) / ENEMY_HOP)).along * SQ; mx += e.dir[0] * k; mz += e.dir[1] * k; }
          rig.set(marks, rotY(phiOf(e.dir)), EREST(e.i), [mx, 0, mz]);
        } else rig.set(marks, ...HIDDEN);
        if (stunned) {
          const [ox, oz] = toRender(e.sq), bob = 0.04 * Math.sin(p.now * 9);
          rig.set(orbs, rotY(p.now * 5), STUN_BAKE(e.i), [ox, bob, oz]);
        } else rig.set(orbs, ...HIDDEN);
        const swordAt = add(EREST(e.i), HANDOF(e));
        if (e.restore) {   // put a sliced enemy back together for its next life
          if (e.cut?.split) rig.assign(body, e.rows);
          e.cut = null; e.restore = false;
        }
        if (e.mode === 'off') {
          if (e.dirty) { for (const n of [body, cut, shadow, sword, marks]) rig.set(n, ...HIDDEN); e.dirty = false; }
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

  // Rows of the world that changed this frame and must go up to the card: with GPU bones, only what the live lighting
  // re-shades and what a cut retags (the stage marks those in stage.rows); without, everything
  const allRows = Array.from({ length: Math.ceil(world.count / 512) }, (_, i) => i);
  const changedRows = () => {
    if (!GPU_BONES) return allRows;
    const rows = stage.rows;
    for (let r = 0; r < rows.length; r++) if (rows[r]) { changed.add(r); rows[r] = 0; }
    const out = [...changed].sort((a, b) => a - b); changed.clear();
    return out;
  };
  const perf = PERF ? createPerf() : null;
  let last = performance.now(), prev = null;
  function frame(ms) {
    // window.__clock (seconds), when a test sets it, replaces the real clock so frames can be inspected one by one
    const now = window.__clock ?? ms / 1000 / SLOW, dt = window.__clock !== undefined ? 1 / 60 : Math.min(0.1, (ms - last) / 1000 / SLOW);
    const interval = ms - last;
    last = ms;
    const tGame = performance.now();
    step(now);
    p = pose(now);
    checkHits(prev, p, stage, rig);
    checkEnemyHits(prev ? prev.now : now, now, stage, rig);
    prev = p;
    p = followThrough(p, dt);   // what is drawn; contact used the unsprung pose
    window.__frames = (window.__frames || 0) + 1;

    // Fixed camera: follows the pawn's position, never its turns
    // (zoomed out, it frames the whole arena instead)
    const mid = (BOARD - 1) * SQ / 2;
    const goal = state.zoomOut ? [mid, 0.6, mid] : [p.x, 0.6, p.z];
    const follow = 1 - Math.exp(-dt * 4);
    for (const i of [0, 1, 2]) state.target[i] += (goal[i] - state.target[i]) * follow;
    // zooming out is limited so the art grid (max ART_MAX px) keeps at least 20 art pixels per world unit
    const aspect = Math.max(0.5, Math.min(2.6, innerWidth / Math.max(1, innerHeight)));
    const half0 = aspect >= 1 ? CAM.zoom * SQ : CAM.zoom * SQ / aspect;
    const goalZoom = Math.min(ART_MAX / (2 * half0 * 20), state.zoomOut ? arenaZoom(aspect, half0) : state.zoomScale);
    state.camZoom += (goalZoom - state.camZoom) * (1 - Math.exp(-dt * 5));

    const tPose = performance.now();
    world.anim.update(dt, now);
    const tRender = performance.now();
    const { width, height } = artSize();
    renderer.render(world, {
      width, height, time: now, instances: board, changedRows: changedRows(),
      // the orthographic view's half-height is dist × tan(fov / 2), with ink-studio's default 38° field of view
      camera: { target: state.target, dist: viewHalfHeight(width, height) * state.camZoom / ORTHO_TAN, yaw: CAM.yaw, pitch: CAM.pitch, projection: 'orthographic' }
    });
    coords.textContent = 'abcdefghijkl'[state.sq[0]] + (BOARD - state.sq[1]);   // chess notation: files a–l, ranks 1–12
    const zl = state.zoomOut ? 'Zoom in' : 'Zoom out';
    if (zoomBtn.textContent !== zl) zoomBtn.textContent = zl;
    if (perf) perf.add(interval, tPose - tGame, tRender - tPose, performance.now() - tRender, width, height);
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
