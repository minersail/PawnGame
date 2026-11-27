module.exports = ({ makeBuilder, makeSculpt, KIT: K }) => ({
  id: 'chess-pawn',
  name: 'Chess pawn',
  seed: 11,
  build(seed) {
    // 0 bg, 1-5 ivory ramp (dark to light), 6-8 board
    const palette = [0x0b0d14, 0x3a2f2a, 0x7a634f, 0xb89c7c, 0xe2cfae, 0xfff4dc, 0x1c2230, 0x34405a, 0x5b6c8c];
    const B = makeBuilder(seed, palette);
    const S = K.sculpt(makeSculpt(B));
    const ivory = { r: [1, 2, 3, 4, 5] };

    S.ground({ r: [6, 7, 8] }, { rad: 3.2, res: 0.12 });

    // Base and stem as one turned profile, t runs 0 (bottom) to 1 (top)
    const profile = t => {
      if (t < 0.12) return 0.95;                         // foot
      if (t < 0.2) return 0.95 - (t - 0.12) * 2.5;       // bevel
      if (t < 0.3) return 0.75 - (t - 0.2) * 1.2;        // upper base
      return 0.63 - Math.pow((t - 0.3) / 0.7, 0.6) * 0.35; // tapering stem
    };
    S.lathe([0, 0, 0], 1.9, profile, ivory, { res: 0.06 });

    // Collar and head
    S.lathe([0, 1.85, 0], 0.16, [0.52, 0.5], ivory, { res: 0.05 });
    S.ball([0, 2.55, 0], 0.55, ivory, { res: 0.05 });
    S.bake();

    return B.finish({
      cam: { target: [0, 1.3, 0], dist: 9, pitch: 0.28, yaw: 0.6 },
      detail: 14,
      dither: 0.25,
      radius: 3.5
    });
  }
});
