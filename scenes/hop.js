module.exports = ({ makeBuilder, makeSculpt, KIT: K }) => ({
  id: 'pawn-hop',
  name: 'Pawn hop',
  seed: 11,
  build(seed) {
    // 0 bg, 1-5 ivory ramp, 6-8 dark squares, 9-11 light squares
    const palette = [0x0b0d14, 0x3a2f2a, 0x7a634f, 0xb89c7c, 0xe2cfae, 0xfff4dc,
      0x1c2230, 0x2a3448, 0x3a4862, 0x4d5d7c, 0x6a7da0, 0x8a9cc0];
    const B = makeBuilder(seed, palette);
    const S = K.sculpt(makeSculpt(B));
    const rig = K.rig(B, S);
    const ivory = { r: [1, 2, 3, 4, 5] };
    const dark = { r: [6, 7, 8] }, light = { r: [9, 10, 11] };
    const SQ = 1.3; // square size

    // Static board first, so the pawn leaves no baked shadow on it
    for (let i = -1; i <= 1; i++)
      for (let j = -1; j <= 2; j++)
        S.box([i * SQ, -0.1, -j * SQ], [SQ / 2, 0.1, SQ / 2], (i + j) & 1 ? dark : light, { res: 0.07, tag: 'board' });
    S.bake();

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
      cam: { target: [0, 0.6, -1.0], dist: 7.5, pitch: 0.38, yaw: 0.75 },
      detail: 14, dither: 0.2, radius: 4.2
    });

    // One hop per second, moving one square away from the camera (-z) each hop
    const ease = x => x * x * (3 - 2 * x);
    const scaleY = (sy) => { const sx = 1 / Math.sqrt(sy); return [sx, 0, 0, 0, sy, 0, 0, 0, sx]; };
    const stage = K.stage(world);
    rig.bind(stage);
    stage.add({
      pre(_dt, t) {
        const n = Math.floor(t), u = t - n;
        let z = -n * SQ, y = 0, sy = 1, tilt = 0;
        if (u < 0.22) {                    // anticipation: crouch
          sy = 1 - 0.22 * Math.sin((u / 0.22) * Math.PI / 2);
          tilt = 0.12 * (u / 0.22);
        } else if (u < 0.7) {              // airborne arc
          const a = (u - 0.22) / 0.48;
          z -= SQ * ease(a);
          y = 0.8 * 4 * a * (1 - a);
          sy = 1 + 0.18 * Math.sin(a * Math.PI) * (a < 0.5 ? 1 : 0.4);
          tilt = 0.12 - 0.3 * a;           // lean forward, then back to land
        } else {                           // land, squash, settle
          const a = (u - 0.7) / 0.3;
          z -= SQ;
          sy = 1 - 0.25 * Math.exp(-6 * a) * Math.cos(a * 9);
          tilt = -0.18 * Math.exp(-6 * a);
        }
        const A = K.M.mul(K.M.rot([1, 0, 0], -tilt), scaleY(sy));
        rig.set('pawn', A, [0, 0, 0], [0, y, z + 1.3]);
        const sh = 1 - 0.45 * Math.min(1, y / 0.8);
        rig.set('shadow', [sh, 0, 0, 0, 1, 0, 0, 0, sh], [0, 0, 0], [0, 0, z + 1.3]);
        rig.apply();
      }
    });
    return world;
  }
});
