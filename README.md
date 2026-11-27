# PawnGame: prototype handoff

Exploration notes from a chat session, handed off so a Claude Code session can pick up from here. The goal so far has been to understand Gaussian-splat-style art and test whether a pixel-art splat look works for a small game where the player is a chess pawn. Nothing here is a game yet. It's two working scenes, renders, and notes on the engine.

## Engine: ink-studio

Everything renders with [siliconjungle/shapeshift-labs-ink-studio](https://github.com/siliconjungle/shapeshift-labs-ink-studio), tested at commit `8e4b878`. It's a large (~660k lines) JavaScript toolkit with no runtime dependencies. It's marked `private` and at v0.1.0, so treat it as a personal toolkit, not a stable library. Requires Node 18 or later. Tested on Node 22.

How it works:

1. **Sculpt with SDFs.** Shapes such as `S.ball`, `S.box`, `S.lathe` (turned profile) and `S.tube` are signed distance fields, combined with blends and carving (`neg: true`).
2. **Bake.** `S.bake()` scatters points over the combined surface, snaps them onto it, and turns each into a flat Gaussian splat. Each splat is lit (sun, marched shadow, AO, lamps) and **snapped to a palette ramp at bake time**. There is no continuous-lighting stage.
3. **Render.** Splats are drawn onto a tiny art-pixel grid (the pawn is about 129×89) and upscaled. Renderers: CPU (Node/CLI), WebGL 2 (`webgl.mjs`), and a WebGPU path.

Nothing is trained or captured from photos. The SDF is the model and splats are just the drawing primitive. The repo also has `gaussian-train` (fit splats from images) and PLY/SPZ import, which we haven't used.

World data is a `Float32Array` with 16 floats per splat:

```
[x, y, z, density]  [c00, c01, c02, packedRGB]  [c11, c12, c22, kind]  [phase, speed, range, extra]
```

The `c*` values are the symmetric 3×3 covariance. **Watch out:** `packedRGB` decodes as `r = v & 255, g = (v >> 8) & 255, b = (v >> 16) & 255`, which is the reverse of the usual 0xRRGGBB.

## Setup

```sh
git clone https://github.com/siliconjungle/shapeshift-labs-ink-studio ../ink-studio
(cd ../ink-studio && node scripts/build.js node)
node ../ink-studio/cli/ink-studio.js render scenes/pawn.js --colored --out out/pawn.png
node ../ink-studio/cli/ink-studio.js turn scenes/pawn.js --n 4 --out out/turn.png
node ../ink-studio/cli/ink-studio.js clip scenes/hop.js --from 0 --to 3 --fps 20 --out out/hop.png   # animated PNG
```

To convert the clip to GIF/MP4 with ffmpeg, read it with `-f apng -i hop.png`, then scale with `flags=neighbor` to keep the pixels sharp.

## Files

| Path | What it is |
| --- | --- |
| `scenes/pawn.js` | Static pawn: lathe base and stem, collar disc, ball head, on a small ground patch. Five-step ivory palette. |
| `scenes/hop.js` | Pawn hopping forward one square per second on a 3×4 checkerboard, with crouch, stretch, arc, landing squash and a fake shadow. |
| `renders/pawn.png`, `renders/pawn-turnaround.png` | Static render and a 4-angle turntable. |
| `renders/hop.gif`, `renders/hop.mp4`, `renders/hop.apng.png`, `renders/hop-contact-sheet.png` | 3-second hop clip (60 frames at 20 fps). |
| `renders/pipeline-stages.png` | Six-panel breakdown: SDF slice, splat centres, raw Gaussians, normals, lit and palette-snapped smooth splats, final pixels. |
| `tools/dump_stages.js`, `tools/draw_stages.py` | Produce the pipeline image. Run `INK_STUDIO=/path/to/ink-studio node tools/dump_stages.js`, then `python3 tools/draw_stages.py` in the same directory. Needs numpy and matplotlib. Panels 2–5 use my own Python splat projection, not the library renderer. |

## How the hop animation works

- **Bake order matters.** The board is baked first, then a shadow disc, then the pawn. Otherwise the pawn's baked shadow would be painted onto the board permanently.
- **Rig parts.** `K.rig(B, S)` assigns splats to a part by the `tag` on their shape. Untagged shapes go to `still`, which never moves. Here the three pawn shapes share `tag: 'pawn'`, and the disc is `tag: 'shadow'`.
- **Per frame.** In `stage.add({ pre(dt, t) { ... } })`, call `rig.set(part, A, pivot, position)` with a 3×3 matrix `A`, then `rig.apply()`. Each splat in the part gets `p' = A(p - pivot) + position`, and its shape gets `Σ' = A Σ Aᵀ`. That makes non-uniform scale work for squash and stretch.
- **Math helpers.** `K.M.rot(axis, angle)` and `K.M.mul(A, B)`.
- **Hierarchy.** `rig.child(name, parent, A, pivot)` attaches a part to a parent (see `examples/lantern-catch.js` in ink-studio). `K.rig` only does rigid parts plus scale. For smooth bending, use `K.puppet`.

## Findings and gotchas

- **Contact shadows are too slow on the CPU.** `look.contactShadows` raised one frame from about 0.4 s to about 138 s, which is why `hop.js` uses a scaled dark disc instead. The full 60-frame clip renders in about 14 s without it.
- **Lighting is baked into each splat's color.** When the pawn tilts, its shading tilts with it. Options in ink-studio: bake static scenery first, use `sun.shadows` proxy shadows for rigs, or turn on `relighting` in `B.finish()`, which re-shades from up to 32 lights without re-baking. See `docs/live-sun.md`.
- **Collision.** `S.sdf(x, y, z)` stays available after the bake, giving exact distance-field queries for gameplay or physics. XPBD cloth and rope already use it.
- **Re-baking is load-time only.** Real-time animation must move existing splats. Morphing the SDF means re-baking, which is too slow per frame.
- **Small visual issue.** The neck-to-collar join on the pawn is lumpy because the shapes aren't smooth-blended. A finer `res` or a smooth blend would fix it.
- **Not yet tested:** browser (WebGL) frame rate, input handling, and game logic.

## Possible next steps

1. Get the pawn rendering in the browser with `createRenderer` from `webgl.mjs`. See the README section "Browser renderer".
2. Drive `rig.set` from keyboard input: one hop per keypress, snapping to squares.
3. Tag the head separately and use `rig.child` for follow-through wobble on landing.
4. Try `relighting` so the shading stays fixed to the sun while the pawn tilts.
5. Measure WebGL frame rate against splat count.

## Endless Board (browser)

`web/` holds a playable page: the pawn from `scenes/hop.js` on a chessboard that never ends, with the same hop animation, driven by the keyboard or an on-screen pad.

- **Controls.** W A S D or the arrow keys hop one square relative to the camera. Holding a key chains hops. Q and E turn the camera a quarter turn. Drag to orbit, scroll to zoom. On touch screens a pad appears.
- **Rendering.** It uses ink-studio's own bake and WebGL renderer in the browser (`dist/ink-studio.bake.js` plus `src/webgl/`). Nothing is re-implemented.
- **Endless board.** One light and one dark square are baked once and shared with `createSplatInstances`. A 14×14 patch of copies is kept centred on the pawn; copies that fall off one side are moved to the other. The patch is even-sized, so a recycled square keeps its colour. Fog hides the patch edge. Render coordinates are rebased by an even number of squares when the pawn walks far, so precision never degrades.
- **Animation.** `hopPose(u)` is the per-hop curve from `hop.js`. The lean axis is `up × direction`, so it works in all four directions. A held key starts the next hop at 90% of the current one.

To run it locally:

```sh
(cd ../ink-studio && node scripts/build.js)
INK_STUDIO=../ink-studio node tools/vendor-ink.js   # copies the 60 files the page needs into web/ink/
cd web && python3 -m http.server 8080               # open http://localhost:8080
```

`web/ink/` holds a copy of the ink-studio files (MIT licence in `web/ink/LICENSE`); re-run `tools/vendor-ink.js` after updating ink-studio. Add `?w=16` to the URL to try a different patch size.
