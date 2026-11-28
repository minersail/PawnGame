// Level 1 art: the arena's wooden frame, the tabletop and its board-game props, and the pawn brute with its warhammer.
// Sculpt-only: these functions add ink-studio SDF solids to a sculpt toolkit S (K.sculpt(makeSculpt(B))) and know
// nothing about game state. Colours are palette indices into PALETTE + LEVEL_PALETTE (appended after index 20).
//
// Coordinates follow game.js: y up, board square tops at y = 0, square size SQ, the pawn faces -z, and the fixed camera
// looks from +z (yaw 20°, pitch 35°), so the +z rail is the near side.

// Appended to game.js's PALETTE (which ends at index 20), so these are indices 21 onward.
export const LEVEL_PALETTE = [
  0x22140e, 0x3d2516, 0x5e3b22,   // 21–23 walnut: the board frame
  0xd8b77a,                       // 24    maple inlay: rank and file markings, frame lip
  0x4a3220, 0x6c4a2e, 0x8f6a42,   // 25–27 oak: the tabletop
  0x5c1a1a, 0x93302a, 0xc8503f,   // 28–30 red: checkers, hotel, Stratego piece, box lid
  0x1f4a2a, 0x2f7040, 0x52a05a,   // 31–33 green: houses
  0x1a2650, 0x2b4384, 0x4a6cc0,   // 34–36 blue: the box lid's field
  0x2c2f36, 0x4a4f5a, 0x7a808c    // 37–39 iron: the warhammer head
];
export const L = {   // ramps by name
  walnut: { r: [21, 22, 23] }, inlay: { r: [23, 24, 24] }, oak: { r: [25, 26, 27] },
  red: { r: [28, 29, 30] }, green: { r: [31, 32, 33] }, blue: { r: [34, 35, 36] }, iron: { r: [37, 38, 39] },
  ivory: { r: [2, 3, 4, 5] }, ebony: { r: [12, 13, 14, 15] }, gold: { r: [19, 20] }, pip: { r: [12, 13] }
};

export const TABLE_Y = -0.2;    // the tabletop: the board squares (0.2 thick) rest on it
const RAIL = 0.72, RAIL_TOP = 0.16;   // frame rail width and height above the board

// 3×5 pixel glyphs for the rank and file markings: files A–L, ranks 1–12
const GLYPH = {
  A: ['.#.', '#.#', '###', '#.#', '#.#'], B: ['##.', '#.#', '##.', '#.#', '##.'], C: ['.##', '#..', '#..', '#..', '.##'],
  D: ['##.', '#.#', '#.#', '#.#', '##.'], E: ['###', '#..', '##.', '#..', '###'], F: ['###', '#..', '##.', '#..', '#..'],
  G: ['.##', '#..', '#.#', '#.#', '.##'], H: ['#.#', '#.#', '###', '#.#', '#.#'], I: ['###', '.#.', '.#.', '.#.', '###'],
  J: ['..#', '..#', '..#', '#.#', '.#.'], K: ['#.#', '#.#', '##.', '#.#', '#.#'], L: ['#..', '#..', '#..', '#..', '###'],
  0: ['###', '#.#', '#.#', '#.#', '###'], 1: ['.#.', '##.', '.#.', '.#.', '###'], 2: ['##.', '..#', '.#.', '#..', '###'],
  3: ['##.', '..#', '.#.', '..#', '##.'], 4: ['#.#', '#.#', '###', '..#', '..#'], 5: ['###', '#..', '##.', '..#', '##.'],
  6: ['.##', '#..', '###', '#.#', '###'], 7: ['###', '..#', '.#.', '.#.', '.#.'], 8: ['###', '#.#', '###', '#.#', '###'],
  9: ['###', '#.#', '###', '..#', '##.']
};
// Lay a string flat on a surface at height y, centred on (cx, cz), reading along +x with its top toward -z
// (so it reads upright from the fixed camera). Each lit pixel is a thin raised inlay tile; runs merge into one box.
function inlayText(S, text, [cx, y, cz], px, mat, res) {
  const chars = [...String(text)], w = chars.length * 4 - 1;   // 3 px per glyph plus 1 px spacing
  chars.forEach((ch, k) => {
    const rows = GLYPH[ch]; if (!rows) return;
    rows.forEach((row, r) => {
      for (let c = 0; c < 3;) {
        if (row[c] !== '#') { c++; continue; }
        let e = c; while (e + 1 < 3 && row[e + 1] === '#') e++;
        const x0 = cx + (k * 4 + c - w / 2) * px, x1 = cx + (k * 4 + e + 1 - w / 2) * px;
        const z = cz + (r - 2) * px;
        S.box([(x0 + x1) / 2, y + 0.008, z], [(x1 - x0) / 2, 0.012, px / 2], mat, { res });
        c = e + 1;
      }
    });
  });
}

// The raised walnut frame round an n×n board whose squares are centred on x0 + i·sq, z0 + j·sq (i, j in 0..n-1).
// It stands on the tabletop, rises RAIL_TOP above the squares, has a maple lip along its inner edge, and carries
// files A.. along the near (+z) rail and ranks 1.. along the left (-x) rail, rank 1 nearest the camera.
// The rails are the arena's walls: inside edge at the board edge, RAIL wide.
export function sculptBoardFrame(S, { n = 12, sq = 1.3, x0 = 0, z0 = 0 } = {}) {
  const lo = [x0 - sq / 2, z0 - sq / 2], hi = [x0 + (n - 0.5) * sq, z0 + (n - 0.5) * sq];
  const cx = (lo[0] + hi[0]) / 2, cz = (lo[1] + hi[1]) / 2, half = (hi[0] - lo[0]) / 2;
  const h = (RAIL_TOP - TABLE_Y) / 2, cy = (RAIL_TOP + TABLE_Y) / 2;
  const res = 0.1;
  // four rails (the near and far ones run the full width, covering the corners)
  S.box([cx, cy, hi[1] + RAIL / 2], [half + RAIL, h, RAIL / 2], L.walnut, { res });
  S.box([cx, cy, lo[1] - RAIL / 2], [half + RAIL, h, RAIL / 2], L.walnut, { res });
  S.box([hi[0] + RAIL / 2, cy, cz], [RAIL / 2, h, half], L.walnut, { res });
  S.box([lo[0] - RAIL / 2, cy, cz], [RAIL / 2, h, half], L.walnut, { res });
  // maple lip along the inner edge
  const lip = 0.05, ly = RAIL_TOP + 0.004;
  S.box([cx, ly, hi[1] + lip * 1.5], [half + lip * 2.5, 0.012, lip / 2], L.inlay, { res: 0.07 });
  S.box([cx, ly, lo[1] - lip * 1.5], [half + lip * 2.5, 0.012, lip / 2], L.inlay, { res: 0.07 });
  S.box([hi[0] + lip * 1.5, ly, cz], [lip / 2, 0.012, half + lip * 2.5], L.inlay, { res: 0.07 });
  S.box([lo[0] - lip * 1.5, ly, cz], [lip / 2, 0.012, half + lip * 2.5], L.inlay, { res: 0.07 });
  // rank and file markings
  const px = 0.085;
  for (let i = 0; i < n; i++) {
    inlayText(S, 'ABCDEFGHIJKL'[i], [x0 + i * sq, RAIL_TOP, hi[1] + RAIL * 0.55], px, L.inlay, 0.045);
    inlayText(S, String(i + 1), [lo[0] - RAIL * 0.55, RAIL_TOP, z0 + (n - 1 - i) * sq], px, L.inlay, 0.045);
  }
  return { lo, hi };   // the playing area's edges, for walls
}

// The tabletop: a big oak slab under everything, top face only (nothing sees its sides or underside)
// It's laid as planks running along x, alternating two shades, with a dark seam between them.
export function sculptTable(S, [cx, cz], half = 18, plank = 2.2) {
  const n = Math.ceil(2 * half / plank), shades = [L.oak, { r: [25, 26, 26] }];
  for (let k = 0; k < n; k++) {
    const z = cz - half + (k + 0.5) * plank;
    S.box([cx, TABLE_Y - 0.1, z], [half, 0.1, plank / 2 - 0.03], shades[k % 2], { res: 0.3 });
  }
}

// ---------- board-game props, oversized next to the pawns (a player pawn is about 1.3 tall) ----------

// A checker: a short cylinder with a ridged rim and a sunk centre ring
function checker(S, [x, y, z], mat, r = 0.62, h = 0.2) {
  S.lathe([x, y, z], h, t => r * (t < 0.15 || t > 0.85 ? 0.96 : 1), mat, { res: 0.075 });
  S.lathe([x, y + h, z], 0.012, [r * 0.62, r * 0.62], mat, { res: 0.06 });
}
// A stack of checkers, red and black alternating (or one colour), with a lean like a kid stacked it
export function sculptCheckerStack(S, [x, z], count = 5, { red = true, black = true } = {}) {
  for (let k = 0; k < count; k++) {
    const mat = red && black ? (k % 2 ? L.red : L.ebony) : red ? L.red : L.ebony;
    checker(S, [x + 0.04 * Math.sin(k * 1.7), TABLE_Y + k * 0.205, z + 0.04 * Math.cos(k * 2.3)], mat);
  }
}
// A Monopoly house: a box with a gabled roof (ridge along x), facing +z
export function sculptHouse(S, [x, z], mat = L.green, s = 0.55) {
  S.box([x, TABLE_Y + s * 0.45, z], [s * 0.5, s * 0.45, s * 0.42], mat, { res: 0.04 });
  S.extrude([[[-s * 0.56, 0], [s * 0.56, 0], [0, s * 0.42]]], [x, TABLE_Y + s * 0.9, z], s * 0.84, mat, { res: 0.04 });
}
// A Monopoly hotel: longer and taller, red, ridge along x
export function sculptHotel(S, [x, z], s = 0.62) {
  S.box([x, TABLE_Y + s * 0.55, z], [s * 0.9, s * 0.55, s * 0.45], L.red, { res: 0.045 });
  S.extrude([[[-s * 0.96, 0], [s * 0.96, 0], [0, s * 0.42]]], [x, TABLE_Y + s * 1.1, z], s * 0.9, L.red, { res: 0.045 });
}
// A die resting on the table, top face showing `top` pips (1–6); the +z face shows 2 and the +x face 3
export function sculptDie(S, [x, z], s = 0.9, top = 5) {
  const h = s / 2, c = [x, TABLE_Y + h, z];
  S.box(c, [h, h, h], L.ivory, { res: 0.045, rd: 0.12 * s });
  const pip = s * 0.085, q = s * 0.26;
  const layouts = { 1: [[0, 0]], 2: [[-1, -1], [1, 1]], 3: [[-1, -1], [0, 0], [1, 1]], 4: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
    5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]], 6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]] };
  for (const [u, v] of layouts[top]) S.ball([x + u * q, TABLE_Y + s - pip * 0.35, z + v * q], pip, L.pip, { res: 0.02 });
  for (const [u, v] of layouts[2]) S.ball([x + u * q, TABLE_Y + h + v * q, z + h - pip * 0.35], pip, L.pip, { res: 0.02 });
  for (const [u, v] of layouts[3]) S.ball([x + h - pip * 0.35, TABLE_Y + h + v * q, z + u * q], pip, L.pip, { res: 0.02 });
}
// An Othello disc: black underside, white top (or flipped)
export function sculptOthello(S, [x, z], whiteUp = true, r = 0.5) {
  S.lathe([x, TABLE_Y, z], 0.07, [r, r], whiteUp ? L.ebony : L.ivory, { res: 0.045 });
  S.lathe([x, TABLE_Y + 0.07, z], 0.07, [r, r * 0.97], whiteUp ? L.ivory : L.ebony, { res: 0.045 });
}
// A Stratego piece: an upright red block with a sloped back, its gold rank emblem on the front (+z)
export function sculptStratego(S, [x, z], s = 0.9) {
  const w = s * 0.42, d = s * 0.3;
  // side profile in (z, y): front face upright, back sloping in, extruded across x
  S.extrude([[[d, 0], [d, s * 1.05], [d * 0.3, s * 1.15], [-d, s * 0.95], [-d, 0]]], [x, TABLE_Y, z], w * 2, L.red,
    { res: 0.04, rd: 0.03, ax: [[0, 0, 1], [0, 1, 0], [1, 0, 0]] });
  S.ball([x, TABLE_Y + s * 0.72, z + d + 0.005], [s * 0.15, s * 0.15, 0.03], L.gold, { res: 0.02 });
}
// The game box lid, propped up behind the board: a shallow tray leaning back at `lean` radians, red rim, blue field,
// gold band. Its bottom edge rests on the table along x at depth z.
export function sculptBoxLid(S, [x, z], { w = 6, h = 3.8, lean = 0.32 } = {}) {
  const c = Math.cos(lean), s = Math.sin(lean);
  const up = [0, c, -s], out = [0, s, c];   // the lid's own up (along its face) and face normal, leaning away from +z
  const at = (u, v, d) => [x + u, TABLE_Y + up[1] * v + out[1] * d, z + up[2] * v + out[2] * d];
  const ax = [[1, 0, 0], up, out];
  const rect = (a, b) => [[-a, -b], [a, -b], [a, b], [-a, b]];
  S.extrude([rect(w / 2, h / 2)], at(0, h / 2, 0), 0.16, L.red, { res: 0.17, ax });                        // rim / back
  S.extrude([rect(w / 2 - 0.25, h / 2 - 0.25)], at(0, h / 2, 0.06), 0.06, L.blue, { res: 0.16, ax });      // field
  S.extrude([rect(w / 2 - 0.25, 0.12)], at(0, h * 0.68, 0.1), 0.03, L.gold, { res: 0.05, ax });            // gold band
  S.extrude([rect(w / 2 - 0.25, 0.05)], at(0, h * 0.32, 0.1), 0.03, L.gold, { res: 0.05, ax });
  // a big ivory pawn emblem in the middle of the field
  S.extrude([[[-0.5, 0], [0.5, 0], [0.32, 0.2], [0.16, 0.9], [0.32, 1.0], [0.3, 1.1], [0.0, 1.55], [-0.3, 1.1], [-0.32, 1.0], [-0.16, 0.9], [-0.32, 0.2]]],
    at(0, h * 0.3, 0.1), 0.03, L.ivory, { res: 0.035, ax });
}

// The props round a board whose playing area spans lo..hi (from sculptBoardFrame), placed in the ring between the
// frame and the table's edge. Each prop is baked on its own pass so solids don't merge; call between S.bake()s.
export function sculptTableProps(S, { lo, hi }, bake) {
  const out = RAIL + 0.9;
  const L0 = lo[0] - out, R0 = hi[0] + out, N0 = hi[1] + out, F0 = lo[1] - out, mx = (lo[0] + hi[0]) / 2;
  sculptBoxLid(S, [mx - 1.5, F0 - 0.6]); bake();
  sculptCheckerStack(S, [L0 - 0.4, F0 + 3.5], 6); bake();
  sculptCheckerStack(S, [L0 - 1.8, F0 + 4.6], 3, { black: false }); bake();
  checker(S, [L0 - 0.9, TABLE_Y, F0 + 6.2], L.ebony); bake();
  sculptHotel(S, [R0 + 0.6, hi[1] - 4.5]); bake();
  sculptHouse(S, [R0 + 0.4, hi[1] - 2.6]); bake();
  sculptHouse(S, [R0 + 1.6, hi[1] - 2.0]); bake();
  sculptHouse(S, [R0 + 0.5, lo[1] + 3.2]); bake();
  sculptDie(S, [R0 + 0.9, lo[1] + 6.0], 1.0, 5); bake();
  sculptDie(S, [L0 - 0.2, hi[1] - 1.5], 1.0, 3); bake();
  sculptOthello(S, [mx - 3.2, N0 + 0.3], true); bake();
  sculptOthello(S, [mx - 2.1, N0 + 0.9], false); bake();
  sculptOthello(S, [mx + 4.4, N0 + 0.5], true); bake();
  sculptStratego(S, [R0 + 0.2, hi[1] + 0.4]); bake();
}

// ---------- the pawn brute ----------

// A bigger, burlier pawn: 1.35× the regular pawn's height, a wider foot and a thick stem, a heavy iron-banded collar
// and a squat head. Same build as sculptPawn in game.js (base centre at [x, y, z]).
export const BK = 0.5 * 1.35;
export const bruteProfile = t => BK * (t < 0.12 ? 1.08 : t < 0.2 ? 1.08 - (t - 0.12) * 2.6
  : t < 0.3 ? 0.87 - (t - 0.2) * 1.1 : 0.76 - Math.pow((t - 0.3) / 0.7, 0.7) * 0.3);
export function sculptBrute(S, ramp, tag, [x, y, z] = [0, 0, 0]) {
  const res = [0.05, 0.045];
  S.lathe([x, y, z], 1.85 * BK, bruteProfile, ramp, { res: res[0], tag });
  S.lathe([x, y + 1.78 * BK, z], 0.2 * BK, [0.62 * BK, 0.6 * BK], L.iron, { res: res[1], tag });    // iron collar band
  S.ball([x, y + 2.45 * BK, z], [0.6 * BK, 0.54 * BK, 0.6 * BK], ramp, { res: res[1], tag });       // squat head
  S.box([x, y + 2.5 * BK, z - 0.48 * BK], [0.36 * BK, 0.05 * BK, 0.1 * BK], ramp, { res: 0.03, tag }); // heavy brow
}
// Signed distance to the brute's shape, base centre at the origin (for contact tests, like pawnSDF)
export function bruteSDF([x, y, z]) {
  const r = Math.hypot(x, z), H = 1.85 * BK, t = Math.min(1, Math.max(0, y / H));
  let d = Math.max(r - bruteProfile(t), -y, y - H);
  d = Math.min(d, Math.max(r - 0.62 * BK, Math.abs(y - 1.88 * BK) - 0.1 * BK));
  const q = [x / (0.6 * BK), (y - 2.45 * BK) / (0.54 * BK), z / (0.6 * BK)];
  return Math.min(d, (Math.hypot(...q) - 1) * 0.54 * BK);
}

// A warhammer with its grip at [hx, hy, hz], haft straight up along +y; the head's striking face points -z (forward,
// like the sword's blade edge) and a back spike points +z. HAMMER gives the extents for contact tests.
export const HAMMER = { haft: [-0.2, 1.6], head: [1.28, 1.7], face: 0.42, spike: 0.42 };
export function sculptWarhammer(S, [hx, hy, hz], tag, res = 0.028) {
  const hmid = (HAMMER.head[0] + HAMMER.head[1]) / 2, hh = (HAMMER.head[1] - HAMMER.head[0]) / 2;
  S.box([hx, hy + (HAMMER.haft[0] + HAMMER.haft[1]) / 2, hz], [0.045, (HAMMER.haft[1] - HAMMER.haft[0]) / 2, 0.045], L.oak, { res, tag });  // haft
  S.box([hx, hy + 0.02, hz], [0.045, 0.16, 0.045], L.walnut, { res, tag });                                  // leather grip wrap
  S.ball([hx, hy + HAMMER.haft[0] - 0.03, hz], 0.06, L.iron, { res, tag });                                  // pommel
  S.box([hx, hy + hmid, hz - 0.04], [0.24, hh, HAMMER.face * 0.62], L.iron, { res, tag, rd: 0.025 });           // head block
  S.box([hx, hy + hmid, hz - HAMMER.face * 0.62 - 0.07], [0.28, hh + 0.04, 0.07], L.iron, { res, tag, rd: 0.02 }); // striking face, flared
  S.extrude([[[-0.14, 0], [0.14, 0], [0, HAMMER.spike - 0.1]]], [hx, hy + hmid, hz + HAMMER.face * 0.62 - 0.08], 0.12, L.iron,
    { res, tag, ax: [[0, 1, 0], [0, 0, 1], [1, 0, 0]] });                                                    // back spike
  S.box([hx, hy + HAMMER.haft[1] + 0.04, hz], [0.03, 0.06, 0.03], L.iron, { res, tag });                     // top cap
}
