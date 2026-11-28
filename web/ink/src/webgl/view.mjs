import { cameraLens } from './camera-lens.mjs';
import { cameraImpulses } from './camera-impulses.mjs';
const snapshots = new WeakMap();

export function captureCamera(world, frame, width, height) {
  if (!Number.isSafeInteger(width) || width < 1 || !Number.isSafeInteger(height) || height < 1)
    throw new RangeError('Camera capture requires positive integer dimensions');
  const camera = makeCamera(world, frame, width, height);
  const pose = Object.freeze(Object.fromEntries(Object.entries(cameraPose(camera))
    .map(([key, value]) => [key, Object.freeze(value)])));
  const snapshot = Object.freeze({ pose, ortho:camera.ortho,
    yaw:Math.atan2(pose.back[0],pose.back[2]), pitch:Math.asin(Math.max(-1,Math.min(1,pose.back[1]))) });
  snapshots.set(snapshot,{camera,height});
  return snapshot;
}

export function captureStreamingCamera(world, frame, width, height) {
  const snapshot = captureCamera(world, frame, width, height);
  const { camera } = snapshots.get(snapshot);
  const { eye, back } = snapshot.pose;
  return { snapshot, camera: { ...snapshot.pose, ortho: camera.ortho, tangent: camera.tangent, aspect: camera.aspect,
    near: camera.clipNear, far: camera.clipFar, pixelHeight: height, observer: eye.map((v, i) => v - back[i] * camera.setback) } };
}

export function makeCamera(world, frame, width, height) {
  if (frame.cameraSnapshot !== undefined) {
    const locked = snapshots.get(frame.cameraSnapshot);
    if (!locked) throw new TypeError('Use a camera snapshot from captureCamera');
    const {camera} = locked, aspect = width/height, scale = locked.height/height;
    if (aspect === camera.aspect && scale === 1) return camera;
    const projection = camera.projection.slice();
    projection[0] *= camera.aspect/aspect;
    return { ...camera,aspect,projection,footprint:camera.footprint*scale,shadowFootprint:camera.shadowFootprint*scale };
  }
  const staging = frame.cameraStaging ?? world.look?.cameraStaging;
  const sample = cameraLens.frame(world, frame, width, height, { orbit: staging?.orbit, impulse: cameraImpulses.frame });
  const { dist, distance, aspect, radius, ortho, tangent: tanFov, clipNear, clipFar: far, setback } = sample;
  const view = cameraLens.artView(sample, height, world.look?.stable, frame.stable);
  const eye = view === sample.view ? sample.pose.eye : cameraLens.fromView(view).eye;
  const viewHeight = dist * tanFov, near = .4, scale = 1 / tanFov;
  const projection = ortho
    ? new Float32Array([1 / (viewHeight * aspect), 0, 0, 0, 0, 1 / viewHeight, 0, 0,
      0, 0, -2 / (far - near), 0, 0, 0, -(far + near) / (far - near), 1])
    : new Float32Array([scale / aspect, 0, 0, 0, 0, scale, 0, 0, 0, 0,
      (far + near) / (near - far), -1, 0, 0, 2 * far * near / (near - far), 0]);
  const depthCenter = ortho ? distance : dist;
  return {
    view: Float32Array.from(view), projection, eye, aspect, ortho, radius, distance,
    lens: sample.lens, composition: frame.composition ?? sample.base.composition ?? [.5,.5], setback,
    tangent: ortho ? viewHeight : tanFov,
    footprint: dist * 2 * tanFov / height,
    shadowFootprint: 2 * viewHeight / height,
    clipNear,
    clipFar: far,
    depthRange: [depthCenter - radius, depthCenter + radius],
    ...(sample.motion && { cameraImpulse: sample.motion })
  };
}

export function cameraPose({ eye, view }) {
  return { eye: eye.slice(), right: [view[0], view[4], view[8]],
    up: [view[1], view[5], view[9]], back: [view[2], view[6], view[10]] };
}

export function withCameraPose(camera, pose, reflected = false) {
  // Validate a proper camera pose, then restore the handedness of the mirror.
  const checked = cameraLens.pose(reflected ? { ...pose, right: pose.right.map(x => -x) } : pose);
  const view = new Float32Array(cameraLens.matrix(checked));
  if (reflected) for (const column of [0, 4, 8, 12]) view[column] = -view[column];
  return { ...camera, eye: checked.eye, view };
}

function placedDepth(row, i, project) {
  const src = row.asset.data, a = row.matrix, at = row.at;
  const x = src[i], y = src[i+1], z = src[i+2], f = Math.fround;
  return f(project(f(a[0]*x + a[1]*y + a[2]*z + at[0]),
    f(a[3]*x + a[4]*y + a[5]*z + at[1]), f(a[6]*x + a[7]*y + a[8]*z + at[2])));
}

function depthBounds(row, view) {
  const a = row.matrix, at = row.at, { sortLo, sortHi } = row.asset;
  const x = view[2]*a[0] + view[6]*a[3] + view[10]*a[6];
  const y = view[2]*a[1] + view[6]*a[4] + view[10]*a[7];
  const z = view[2]*a[2] + view[6]*a[5] + view[10]*a[8];
  const mid = view[2]*at[0] + view[6]*at[1] + view[10]*at[2] + view[14];
  const largest = sortHi.reduce((sum,n,i)=>sum+Math.max(Math.abs(n),Math.abs(sortLo[i])),0);
  // Bound rounding in the three packed world coordinates and final sort depth.
  const slack = 1e-6 * (1+Math.abs(mid)+Math.abs(at[0])+Math.abs(at[1])+Math.abs(at[2])+largest*row.authored.scale);
  return [mid + Math.min(x*sortLo[0],x*sortHi[0]) + Math.min(y*sortLo[1],y*sortHi[1]) + Math.min(z*sortLo[2],z*sortHi[2]) - slack,
    mid + Math.max(x*sortLo[0],x*sortHi[0]) + Math.max(y*sortLo[1],y*sortHi[1]) + Math.max(z*sortLo[2],z*sortHi[2]) + slack];
}

// PawnGame patch: under a camera that never turns (orthographic, a fixed view direction), stationary instances keep
// their depth order however the camera slides; only a constant is added to every depth. So the instances are sorted
// once per view direction and placement revision, and each frame only the world's own splats are sorted and merged in.
// world.sortSkip (a Uint8Array, one per world splat) leaves splats out of the order entirely, so they are not drawn.
function createStaticOrder() {
  let key = null, depth = null, order = null, refs = null, rowOf = null, visible = null;
  return {
    prepare(placements, m2, m6, m10) {
      let versions = placements.length + ':' + m2.toFixed(6) + ',' + m6.toFixed(6) + ',' + m10.toFixed(6);
      for (const row of placements) versions += ',' + (row.version ?? 0) + (row.authored.visible ? '' : 'h');
      if (versions === key) return;
      key = versions;
      let total = 0;
      for (const row of placements) total += row.asset.count;
      const d = new Float32Array(total), g = new Int32Array(total), r = new Int32Array(total), w = new Int32Array(total);
      const project = (x, y, z) => m2 * x + m6 * y + m10 * z;
      let n = 0;
      for (const row of placements) {
        for (let o = 0, k = 0; o < row.asset.data.length && k < row.asset.count; o += 16, k++, n++) {
          d[n] = placedDepth(row, o, project); g[n] = row.start + k; r[n] = row.index + 1; w[n] = row.index;
        }
      }
      const idx = Array.from({ length: total }, (_, i) => i).sort((a, b) => d[a] - d[b]);
      depth = new Float32Array(total); order = new Int32Array(total); refs = new Int32Array(total); rowOf = new Int32Array(total);
      idx.forEach((i, j) => { depth[j] = d[i]; order[j] = g[i]; refs[j] = r[i]; rowOf[j] = w[i]; });
      visible = new Uint8Array(placements.length);
    },
    get depth() { return depth; }, get order() { return order; }, get refs() { return refs; }, get rowOf() { return rowOf; },
    get visible() { return visible; }
  };
}

export function createDepthSorter() {
  const counts = new Uint32Array(65536);
  let depth, keys, order, worldOrder;
  const statics = createStaticOrder();
  return function sort(world, view, time, instances, placements, stabilize, rainClocks = [time,time], rainWind = [0,0], eye, rasterRows) {
    const { count, data } = world;
    const ortho = !(eye && world.gaussianSort === 'cameraDistance');
    if (instances && placements && ortho && !stabilize && !rasterRows && globalThis.PAWN_STATIC_SORT !== false)
      return mergedSort(world, view, time, instances, placements, rainClocks, rainWind);
    const stride = instances ? 2 : 1;
    const total = count + (instances?.reduce((sum,row) => sum + row.asset.count, 0) ?? 0);
    if (!depth || depth.length < total) {
      const capacity = Math.max(total, Math.ceil((depth?.length ?? 0) * 1.25));
      depth = new Float32Array(capacity);
      keys = new Uint16Array(capacity);
    }
    if (!order || order.length < total * stride) order = new Int32Array(depth.length * stride);
    const m2 = view[2], m6 = view[6], m10 = view[10], m14 = view[14];
    const project = eye && world.gaussianSort === 'cameraDistance' ?
      (x,y,z) => -((x-eye[0])**2 + (y-eye[1])**2 + (z-eye[2])**2) :
      (x,y,z) => m2*x + m6*y + m10*z + m14;
    for (let i = 0, o = 0; i < count; i++, o += 16)
      depth[i] = project(data[o], data[o + 1], data[o + 2]);
    for (const i of world.moving ?? []) {
      if (i >= count) continue;
      const o = i * 16, kind = data[o + 11] % 16;
      const phase = data[o + 12], speed = data[o + 13], range = data[o + 14];
      let x = data[o], y = data[o + 1], z = data[o + 2];
      if (kind === 2 || kind === 3) {
        const clock = kind === 2 ? rainClocks[(Math.round(data[o + 11]) & 8192) ? 1 : 0] : time;
        const f = clock * speed / range + phase;
        const flight = (f - Math.floor(f)) * range;
        y += kind === 2 ? -flight : flight;
        if (kind === 2) {
          x += rainWind[0] * flight / Math.max(speed, .00001);
          z += rainWind[1] * flight / Math.max(speed, .00001);
        }
      } else if (kind === 5) {
        const theta = time * speed, c = Math.cos(theta), s = Math.sin(theta);
        const nx = c * x + s * z;
        z = -s * x + c * z;
        x = nx;
      } else y += Math.sin(time * speed + phase) * range;
      depth[i] = project(x, y, z);
    }
    const bones = world.anim?.bones;
    if (bones) for (const i of world.anim.boned ?? []) {
      if (i >= count) continue;
      const o = i * 16, x = data[o], y = data[o + 1], z = data[o + 2];
      const weight = data[o + 14], primary = data[o + 12] * 12, secondary = data[o + 13] * 12;
      const axis = (b, a) => bones[b + a * 3] * x + bones[b + a * 3 + 1] * y +
        bones[b + a * 3 + 2] * z + bones[b + 9 + a];
      const position = a => {
        const p = axis(primary, a);
        return weight > 0 ? p + (axis(secondary, a) - p) * weight : p;
      };
      depth[i] = project(position(0), position(1), position(2));
    }
    let nextInstance = count;
    for (const row of instances ?? [])
      for (let o = 0; o < row.asset.data.length; o += 16) depth[nextInstance++] = placedDepth(row,o,project);
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < total; i++) {
      const z = depth[i];
      if (z < min) min = z;
      if (z > max) max = z;
    }
    // Keep the same quantization as the fully expanded world. Most culled
    // placements cannot change the extrema and need only an AABB test.
    if (placements && instances.length < placements.length) {
      let visibleIndex = 0;
      for (const row of placements) {
        if (row === instances[visibleIndex]) { visibleIndex++; continue; }
        const [lo,hi] = depthBounds(row,view);
        if (lo >= min && hi <= max) continue;
        for (let o = 0; o < row.asset.data.length; o += 16) {
          const z=placedDepth(row,o,project);
          if (z < min) min = z;
          if (z > max) max = z;
        }
      }
    }
    for (const i of world.back ?? []) if (i < count) depth[i] = min;
    if (stabilize) {
      const sorted = order.subarray(0, count);
      for (let i = 0; i < count; i++) sorted[i] = i;
      sorted.sort((a, b) => depth[a] - depth[b]);
      return stabilize(sorted, depth);
    }
    const scale = 65535 / (max - min || 1);
    counts.fill(0);
    // Keep even hidden rows in the depth range so that the quantized tie order
    // of visible rows matches the draw that discards those rows in the shader.
    for (let i = 0; i < total; i++) {
      if (rasterRows && rasterRows[i * 16 + 3] <= 0) continue;
      counts[keys[i] = (depth[i] - min) * scale | 0]++;
    }
    let next = 0;
    for (let bucket = 0; bucket < counts.length; bucket++) {
      const size = counts[bucket];
      counts[bucket] = next;
      next += size;
    }
    if (!instances) {
      for (let i = 0; i < count; i++) {
        if (rasterRows && rasterRows[i * 16 + 3] <= 0) continue;
        order[counts[keys[i]]++] = i;
      }
    } else {
      for (let i = 0; i < count; i++) {
        const j = counts[keys[i]]++ * 2;
        order[j] = i; order[j+1] = 0;
      }
      let i = count;
      for (const row of instances) {
        const start = count + row.start, ref = row.index + 1;
        for (let n = 0; n < row.asset.count; n++, i++) {
          const j = counts[keys[i]]++ * 2;
          order[j] = start + n; order[j+1] = ref;
        }
      }
    }
    return order.length === next * stride ? order : order.subarray(0,next * stride);
  };

  // The world's splats sorted on their own (counting sort, as above), merged with the cached instance order
  function mergedSort(world, view, time, instances, placements, rainClocks, rainWind) {
    const { count, data } = world, skip = world.sortSkip;
    const m2 = view[2], m6 = view[6], m10 = view[10], m14 = view[14];
    statics.prepare(placements, m2, m6, m10);
    const sDepth = statics.depth, sOrder = statics.order, sRefs = statics.refs, sRow = statics.rowOf, vis = statics.visible;
    vis.fill(0);
    for (const row of instances) vis[row.index] = 1;
    if (!depth || depth.length < count) { depth = new Float32Array(Math.max(count, 1)); keys = new Uint16Array(depth.length); }
    if (!worldOrder || worldOrder.length < count) worldOrder = new Int32Array(Math.max(count, 1));
    const project = (x, y, z) => m2 * x + m6 * y + m10 * z + m14;
    for (let i = 0, o = 0; i < count; i++, o += 16) depth[i] = project(data[o], data[o + 1], data[o + 2]);
    for (const i of world.moving ?? []) {
      if (i >= count) continue;
      const o = i * 16, kind = data[o + 11] % 16;
      const phase = data[o + 12], speed = data[o + 13], range = data[o + 14];
      let x = data[o], y = data[o + 1], z = data[o + 2];
      if (kind === 2 || kind === 3) {
        const clock = kind === 2 ? rainClocks[(Math.round(data[o + 11]) & 8192) ? 1 : 0] : time;
        const f = clock * speed / range + phase, flight = (f - Math.floor(f)) * range;
        y += kind === 2 ? -flight : flight;
        if (kind === 2) { x += rainWind[0] * flight / Math.max(speed, .00001); z += rainWind[1] * flight / Math.max(speed, .00001); }
      } else if (kind === 5) {
        const theta = time * speed, c = Math.cos(theta), s = Math.sin(theta), nx = c * x + s * z;
        z = -s * x + c * z; x = nx;
      } else y += Math.sin(time * speed + phase) * range;
      depth[i] = project(x, y, z);
    }
    const bones = world.anim?.bones;
    if (bones) for (const i of world.anim.boned ?? []) {
      if (i >= count) continue;
      const o = i * 16, x = data[o], y = data[o + 1], z = data[o + 2], b = data[o + 12] * 12;
      depth[i] = project(bones[b] * x + bones[b + 1] * y + bones[b + 2] * z + bones[b + 9],
        bones[b + 3] * x + bones[b + 4] * y + bones[b + 5] * z + bones[b + 10],
        bones[b + 6] * x + bones[b + 7] * y + bones[b + 8] * z + bones[b + 11]);
    }
    let min = Infinity, max = -Infinity, live = 0;
    for (let i = 0; i < count; i++) {
      if (skip && skip[i]) continue;
      const z = depth[i]; live++;
      if (z < min) min = z;
      if (z > max) max = z;
    }
    for (const i of world.back ?? []) if (i < count) depth[i] = min;
    const scale = 65535 / (max - min || 1);
    counts.fill(0);
    for (let i = 0; i < count; i++) { if (skip && skip[i]) continue; counts[keys[i] = (depth[i] - min) * scale | 0]++; }
    let next = 0;
    for (let bucket = 0; bucket < counts.length; bucket++) { const size = counts[bucket]; counts[bucket] = next; next += size; }
    for (let i = 0; i < count; i++) { if (skip && skip[i]) continue; worldOrder[counts[keys[i]]++] = i; }
    const total = live + sOrder.length;
    if (!order || order.length < total * 2) order = new Int32Array(Math.ceil(total * 1.25) * 2);
    let a = 0, s = 0, j = 0;
    while (a < live || s < sOrder.length) {
      if (s < sOrder.length && !vis[sRow[s]]) { s++; continue; }
      if (s >= sOrder.length || (a < live && depth[worldOrder[a]] <= sDepth[s] + m14)) {
        order[j++] = worldOrder[a++]; order[j++] = 0;
      } else {
        order[j++] = count + sOrder[s]; order[j++] = sRefs[s]; s++;
      }
    }
    return order.subarray(0, j);
  }
}
