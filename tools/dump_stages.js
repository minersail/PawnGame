const studio = require(process.env.INK_STUDIO || '../ink-studio');
const kit = studio.load();
const fs = require('fs');
// wrap makeSculpt to capture S
let captured;
const scene = require(require('path').resolve(__dirname, '../scenes/pawn.js'))({ ...kit, makeSculpt: B => { const s = kit.makeSculpt(B); return s; }, KIT: { ...kit.KIT, sculpt: s => (captured = kit.KIT.sculpt(s)) } });
const world = scene.build(scene.seed);
const S = captured;
// SDF slice in x-y plane, z=0
const W = 300, H = 300, xs = [-2, 2], ys = [-0.6, 3.4];
const sdf = [];
for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
  const x = xs[0] + (xs[1] - xs[0]) * i / (W - 1), y = ys[1] - (ys[1] - ys[0]) * j / (H - 1);
  sdf.push(S.sdf(x, y, 0));
}
fs.writeFileSync('sdf.json', JSON.stringify({ W, H, xs, ys, sdf }));
fs.writeFileSync('splats.bin', Buffer.from(world.data.buffer, 0, world.count * 64));
console.log('count', world.count, 'cam', JSON.stringify(world.cam), 'pal', world.pal?.length);
const f = studio.render(world, { passes: ['normal', 'pigment', 'depth', 'coverage'] });
console.log('frame', f.w, f.h, Object.keys(f.passes), f.px);
const P = f.passes;
fs.writeFileSync('passes.json', JSON.stringify({ w: P.w, h: P.h, normal: Array.from(P.normal), pigment: Array.from(P.pigment), coverage: Array.from(P.coverage), rgb: Array.from(f.rgb), fw: f.w, fh: f.h }));
