// Turns raw TRELLIS.2 .glb output (assets_src/models) into web-ready LOD chains in public/models.
//   level 0   : the full-detail mesh, meshopt-compressed with WebP PBR textures
//   LODs 1+   : vertex clustering with the base colour baked into vertex colours, no textures. TRELLIS foliage is
//               thousands of loose shells, which edge-collapse cannot reduce; clustering can, and stays tiny.
// usage: GT_MODULES=/dir/with/node_modules node tools/build_models.mjs [id ...] [--force]
//   needs @gltf-transform/cli (which brings @gltf-transform/core and sharp); GT_MODULES defaults to this repo.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const GT = process.env.GT_MODULES || ROOT;
const require = createRequire(join(GT, 'package.json'));
const { NodeIO, Document } = require('@gltf-transform/core');
const sharp = require('sharp');
const BIN = join(GT, 'node_modules/.bin/gltf-transform');
const SRC = process.env.SRC || join(ROOT, 'assets_src/models'), OUT = join(ROOT, 'public/models');

// Texture budget (VRAM is the limit on the GPU, not download size): only level 0 carries a texture, the base colour.
// Scenery is dielectric with constant roughness. Cars get per-vertex roughness/metalness (see smoothSurface).
const tex = (size, smooth = null) => ({ mode: 'tex', size, smooth }), vc = (tris) => ({ mode: 'vc', tris });
const CHAINS = {
  car: [tex(2048, [5, 16]), vc(14000)],   // smooth: [position passes, normal passes]
  tree: [tex(1024), vc(22000), vc(3200), vc(300)],
  grass: [tex(1024), vc(6000), vc(800)],
  bush: [tex(1024), vc(7000), vc(900)],
  build: [tex(2048), vc(24000), vc(2600)],
  prop: [tex(1024), vc(7000), vc(800)],
};
const KIND = (id) =>
  /^car_/.test(id) ? 'car'
    : /^(sakura|cedar|zelkova|pine|bamboo)/.test(id) ? 'tree'
      : /^(grass|fern|nanohana)/.test(id) ? 'grass'
        : /^(azalea|shrub)/.test(id) ? 'bush'
          : /^(farmhouse|kura|lighthouse|fishing_boat)/.test(id) ? 'build' : 'prop';

const io = new NodeIO();
const srgb2lin = new Float32Array(256).map((_, i) => { const c = i / 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); });

// Locate the four wheels of a TRELLIS car (length along z, y up) so the game can spin and steer them.
// Seen from the side, the lowest geometry at each corner is the bottom arc of the tyre. For every corner the lower
// envelope y(z) of the outer body slab is traced away from the contact patch, and a circle tangent to the ground is
// fitted to it: each envelope point at height h and offset d from the axle gives R = (d^2 + h^2) / 2h, and the axle
// position is the one where those estimates agree best. The two sides of an axle are then averaged.
// Returns a per-vertex id: 0 = body, 1..4 = FL, FR, RL, RR (left = +x), or null when a wheel cannot be found.
function findWheels(pos) {
  const n = pos.length / 3, min = [1e9, 1e9, 1e9], max = [-1e9, -1e9, -1e9];
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) { const v = pos[i * 3 + c]; if (v < min[c]) min[c] = v; if (v > max[c]) max[c] = v; }
  const L = max[2] - min[2], halfW = Math.max(max[0], -min[0]), zMid = (min[2] + max[2]) / 2, BIN = 0.003 * L;
  const fits = [], fail = (why) => { console.log('  wheels  not found, ' + why); return null; };
  for (const end of [1, -1]) for (const side of [1, -1]) {
    const env = new Map(), ys = [];
    for (let i = 0; i < n; i++) {
      const x = pos[i * 3] * side, y = pos[i * 3 + 1], z = pos[i * 3 + 2];
      // between the car's middle and its overhang: keeps low splitters and diffusers out of the envelope
      if (x < 0.6 * halfW || (z - zMid) * end < 0.1 * L || (z - zMid) * end > 0.44 * L) continue;
      const k = Math.round(z / BIN);
      if (!(env.get(k) <= y)) env.set(k, y);
      ys.push(y);
    }
    if (ys.length < 500) return fail('empty corner');
    ys.sort((a, b) => a - b);
    const g0 = ys[Math.floor(ys.length * 0.002)];                       // this corner's ground level
    const touch = [...env].filter(([, y]) => y < g0 + 0.004 * L).map(([k]) => k).sort((a, b) => a - b);
    if (!touch.length) return fail('no contact patch');
    const k0 = touch[touch.length >> 1];
    // How far up the tyre the clean arc reaches differs per car (sills, arches), so try several heights and keep
    // the best-supported fit.
    const tryCap = (cap) => {
    const pts = [];
    for (const dir of [1, -1]) {
      let prev = 0;
      for (let k = k0 + dir; Math.abs(k - k0) < 45; k += dir) {
        const y = env.get(k); if (y === undefined) break;
        const h = y - g0;
        if (h > cap * L || h < prev - 0.004 * L) break;                   // high enough, or dropped back onto the body
        prev = Math.max(prev, h);
        if (h > 0.007 * L) pts.push([k * BIN, h]);
      }
    }
    if (pts.length < 10) return null;
    // Least-squares circle through the arc (z^2 + h^2 + A z + B h + C = 0), refitted once without outliers.
    // The centre height is free: generated tyres are often slightly flattened or sunk at the contact patch.
    const fit = (P) => {
      const m = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], r = [0, 0, 0];
      for (const [z, h] of P) { const v = [z, h, 1], q = -(z * z + h * h); for (let i = 0; i < 3; i++) { r[i] += v[i] * q; for (let j = 0; j < 3; j++) m[i][j] += v[i] * v[j]; } }
      const det = (a) => a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1]) - a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0]) + a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0]);
      const D = det(m), sol = [0, 1, 2].map((c) => det(m.map((row, i) => row.map((v, j) => (j === c ? r[i] : v)))) / D);
      const zc = -sol[0] / 2, hc = -sol[1] / 2, R = Math.sqrt(Math.max(0, zc * zc + hc * hc - sol[2]));
      return { zc, hc, R, err: P.map(([z, h]) => Math.abs(Math.hypot(z - zc, h - hc) - R)) };
    };
    let f = fit(pts);
    const tol = Math.max(0.0015 * L, 2.5 * [...f.err].sort((a, b) => a - b)[f.err.length >> 1]);
    const kept = pts.filter((_, i) => f.err[i] <= tol);
    if (kept.length >= 8) f = fit(kept);
    const cost = f.err.reduce((a, b) => a + b, 0) / f.err.length / f.R;
    if (!(f.R > 0.06 * L && f.R < 0.096 * L) || cost > 0.02) return null;
    return { cost, R: f.R, zc: f.zc, yc: g0 + f.hc, end, side, pts: kept.length, q: kept.length / (cost + 0.004) };
    };
    const c = [0.07, 0.055, 0.042, 0.032].map(tryCap).filter(Boolean).sort((a, b) => b.q - a.q)[0];
    fits.push(c || { end, side, q: 0 });
  }
  // Left and right wheels of an axle are mirror images: where the two fits disagree, trust the better-supported one.
  for (const k of [0, 2]) {
    const a = fits[k], b = fits[k + 1];
    if (!a.q && !b.q) return fail(`${k ? 'rear' : 'front'} axle: no circle fits the tyre outline`);
    if (!a.q || !b.q || Math.abs(a.R - b.R) > 0.05 * (a.R + b.R) / 2) {
      const good = a.q >= b.q ? a : b;
      fits[k] = { ...good, side: a.side }; fits[k + 1] = { ...good, side: b.side };
    }
  }
  const ids = new Uint8Array(n), report = [];
  fits.forEach((f, k) => {
    const o = fits[k ^ 1], R = (f.R + o.R) / 2, zc = (f.zc + o.zc) / 2, yc = (f.yc + o.yc) / 2, xs = [];   // k ^ 1 = same axle, other side
    for (let i = 0; i < n; i++) {
      const y = pos[i * 3 + 1];
      if (pos[i * 3] * f.side > 0.45 * halfW && y < yc && Math.abs(Math.hypot(pos[i * 3 + 2] - zc, y - yc) - R) < 0.004 * L) xs.push(pos[i * 3] * f.side);
    }
    xs.sort((a, b) => a - b);
    const xi = (xs.length ? xs[Math.floor(xs.length * 0.03)] : 0.7 * halfW) - 0.004 * L, rr = R * 1.035;
    let count = 0;
    for (let i = 0; i < n; i++) if (pos[i * 3] * f.side >= xi && Math.hypot(pos[i * 3 + 2] - zc, pos[i * 3 + 1] - yc) < rr) { ids[i] = k + 1; count++; }
    report.push(`${k + 1}: R=${(f.R / L).toFixed(3)}L z=${(f.zc / L).toFixed(3)}L fit=${f.cost.toFixed(3)}/${f.pts}pt verts=${count}`);
  });
  console.log('  wheels  ' + report.join('  |  '));
  return ids;
}

// Glossy car paint shows every flaw of a generated mesh. Three things are faired here, all in mesh space:
//  - positions: a few Taubin passes (shrink then inflate, so volume is kept) take out centimetre-scale lumps;
//  - normals: a crease-preserving blur, so reflections flow across panels but edges stay crisp;
//  - roughness/metalness: TRELLIS's UV atlas is thousands of tiny charts, so any texture filtering (mipmaps, resizing)
//    bleeds unrelated texels together and the paint turns blotchy. Instead the map is sampled once per vertex, blurred
//    along the surface, and stored in TEXCOORD_1 = (roughness, (wheelId + 0.9 * metalness) / 5); the map itself is
//    dropped. wheelId (see findWheels) rides along in the same attribute and is decoded once at load time.
function smoothSurface(doc, prim, iters, normalIters, mr) {
  const posA = prim.getAttribute('POSITION'), pos = posA.getArray(), idx = prim.getIndices().getArray(), n = pos.length / 3;
  const wheelIds = findWheels(pos) || new Uint8Array(n);
  const weld = new Int32Array(n), ids = new Map(), first = [];
  for (let i = 0; i < n; i++) {
    const key = `${Math.round(pos[i * 3] * 1e5)},${Math.round(pos[i * 3 + 1] * 1e5)},${Math.round(pos[i * 3 + 2] * 1e5)}`;
    let w = ids.get(key);
    if (w === undefined) { w = first.length; ids.set(key, w); first.push(i); }
    weld[i] = w;
  }
  const W = first.length, P = new Float64Array(W * 3), nb = Array.from({ length: W }, () => new Set());
  for (let w = 0; w < W; w++) for (let c = 0; c < 3; c++) P[w * 3 + c] = pos[first[w] * 3 + c];
  for (let t = 0; t < idx.length; t += 3) {
    const a = weld[idx[t]], b = weld[idx[t + 1]], c = weld[idx[t + 2]];
    if (a !== b) { nb[a].add(b); nb[b].add(a); } if (b !== c) { nb[b].add(c); nb[c].add(b); } if (a !== c) { nb[a].add(c); nb[c].add(a); }
  }
  const adj = nb.map((s) => Int32Array.from(s)), Q = new Float64Array(W * 3);
  const relax = (A, k) => {
    for (let w = 0; w < W; w++) {
      const a = adj[w], o = w * 3;
      if (!a.length) { Q[o] = A[o]; Q[o + 1] = A[o + 1]; Q[o + 2] = A[o + 2]; continue; }
      let x = 0, y = 0, z = 0;
      for (let j = 0; j < a.length; j++) { const q = a[j] * 3; x += A[q]; y += A[q + 1]; z += A[q + 2]; }
      Q[o] = A[o] + k * (x / a.length - A[o]); Q[o + 1] = A[o + 1] + k * (y / a.length - A[o + 1]); Q[o + 2] = A[o + 2] + k * (z / a.length - A[o + 2]);
    }
    A.set(Q);
  };
  for (let it = 0; it < iters; it++) { relax(P, 0.5); relax(P, -0.53); }
  // Start from TRELLIS's own normals (averaged over each welded vertex) and run a crease-preserving blur: a
  // neighbour only contributes if it is within ~45 degrees, so panel edges, lamps and wheel spokes stay crisp.
  const srcN = prim.getAttribute('NORMAL').getArray(), N = new Float64Array(W * 3);
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) N[weld[i] * 3 + c] += srcN[i * 3 + c];
  const unit = (A) => { for (let w = 0; w < W; w++) { const o = w * 3, l = Math.hypot(A[o], A[o + 1], A[o + 2]) || 1; A[o] /= l; A[o + 1] /= l; A[o + 2] /= l; } };
  unit(N);
  for (let it = 0; it < normalIters; it++) {
    for (let w = 0; w < W; w++) {
      const a = adj[w], o = w * 3;
      let x = N[o], y = N[o + 1], z = N[o + 2];
      for (let j = 0; j < a.length; j++) {
        const q = a[j] * 3, d = N[o] * N[q] + N[o + 1] * N[q + 1] + N[o + 2] * N[q + 2];
        if (d > 0.7) { x += N[q] * d; y += N[q + 1] * d; z += N[q + 2] * d; }
      }
      Q[o] = x; Q[o + 1] = y; Q[o + 2] = z;
    }
    N.set(Q); unit(N);
  }
  if (mr) {
    const uv = prim.getAttribute('TEXCOORD_0').getArray(), R = new Float64Array(W * 2), cnt = new Float64Array(W);
    for (let i = 0; i < n; i++) {
      const u = uv[i * 2] - Math.floor(uv[i * 2]), v = uv[i * 2 + 1] - Math.floor(uv[i * 2 + 1]);
      const o = (Math.min(mr.height - 1, Math.floor(v * mr.height)) * mr.width + Math.min(mr.width - 1, Math.floor(u * mr.width))) * mr.channels;
      R[weld[i] * 2] += mr.data[o + 1] / 255; R[weld[i] * 2 + 1] += mr.data[o + 2] / 255; cnt[weld[i]]++;   // glTF: G = roughness, B = metalness
    }
    for (let w = 0; w < W; w++) { R[w * 2] /= cnt[w]; R[w * 2 + 1] /= cnt[w]; }
    const T = new Float64Array(W * 2);
    for (let it = 0; it < 14; it++) {
      for (let w = 0; w < W; w++) {
        const a = adj[w]; let r = R[w * 2], m = R[w * 2 + 1], k = 1;
        // only blend with neighbours of the same material, so paint / glass / rubber boundaries stay sharp
        for (let j = 0; j < a.length; j++) { const q = a[j] * 2; if (Math.abs(R[q] - R[w * 2]) < 0.22 && Math.abs(R[q + 1] - R[w * 2 + 1]) < 0.3) { r += R[q]; m += R[q + 1]; k++; } }
        T[w * 2] = r / k; T[w * 2 + 1] = m / k;
      }
      R.set(T);
    }
    const out = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) { out[i * 2] = R[weld[i] * 2]; out[i * 2 + 1] = (wheelIds[i] + 0.9 * Math.min(1, R[weld[i] * 2 + 1])) / 5; }
    prim.setAttribute('TEXCOORD_1', doc.createAccessor().setType('VEC2').setArray(out).setBuffer(doc.getRoot().listBuffers()[0]));
  }
  const outP = new Float32Array(n * 3), outN = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) { outP[i * 3 + c] = P[weld[i] * 3 + c]; outN[i * 3 + c] = N[weld[i] * 3 + c]; }
  posA.setArray(outP);
  prim.getAttribute('NORMAL').setArray(outN);
}

// Read the single TRELLIS mesh: positions, normals and the base colour sampled at every vertex.
async function readSource(file) {
  const doc = await io.read(file), prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
  const pos = prim.getAttribute('POSITION').getArray(), nrm = prim.getAttribute('NORMAL')?.getArray(), uv = prim.getAttribute('TEXCOORD_0')?.getArray();
  const idx = prim.getIndices().getArray(), n = pos.length / 3, col = new Float32Array(n * 3).fill(0.5);
  const img = prim.getMaterial()?.getBaseColorTexture()?.getImage();
  if (img && uv) {
    const { data, info } = await sharp(Buffer.from(img)).resize(1024, 1024, { fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    for (let i = 0; i < n; i++) {
      const u = uv[i * 2] - Math.floor(uv[i * 2]), v = uv[i * 2 + 1] - Math.floor(uv[i * 2 + 1]);
      const o = (Math.min(info.height - 1, Math.floor(v * info.height)) * info.width + Math.min(info.width - 1, Math.floor(u * info.width))) * 3;
      col[i * 3] = srgb2lin[data[o]]; col[i * 3 + 1] = srgb2lin[data[o + 1]]; col[i * 3 + 2] = srgb2lin[data[o + 2]];
    }
  }
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const i of idx) for (let c = 0; c < 3; c++) { const v = pos[i * 3 + c]; if (v < min[c]) min[c] = v; if (v > max[c]) max[c] = v; }
  return { pos, nrm, col, idx, n, min, max };
}

// Vertex clustering on a uniform grid with `res` cells along the longest axis.
function cluster(src, res) {
  const { pos, nrm, col, idx, n, min, max } = src;
  const ext = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]), k = res / ext, R = res + 2;
  const cellOf = new Int32Array(n), ids = new Map();
  const acc = [];
  for (let i = 0; i < n; i++) {
    const key = (Math.floor((pos[i * 3] - min[0]) * k) * R + Math.floor((pos[i * 3 + 1] - min[1]) * k)) * R + Math.floor((pos[i * 3 + 2] - min[2]) * k);
    let id = ids.get(key);
    if (id === undefined) { id = acc.length / 10; ids.set(key, id); for (let c = 0; c < 10; c++) acc.push(0); }
    cellOf[i] = id;
    const o = id * 10;
    for (let c = 0; c < 3; c++) { acc[o + c] += pos[i * 3 + c]; acc[o + 3 + c] += nrm ? nrm[i * 3 + c] : 0; acc[o + 6 + c] += col[i * 3 + c]; }
    acc[o + 9]++;
  }
  const tris = [], seen = new Set(), V = acc.length / 10;
  for (let t = 0; t < idx.length; t += 3) {
    const a = cellOf[idx[t]], b = cellOf[idx[t + 1]], c = cellOf[idx[t + 2]];
    if (a === b || b === c || a === c) continue;
    const lo = Math.min(a, b, c), hi = Math.max(a, b, c), key = (lo * V + (a + b + c - lo - hi)) * V + hi;
    if (seen.has(key)) continue;
    seen.add(key); tris.push(a, b, c);
  }
  return { acc, tris, V };
}

async function writeClustered(src, target, out) {
  let lo = 3, hi = 400, best = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1, c = cluster(src, mid);
    if (c.tris.length / 3 <= target) { best = c; lo = mid + 1; } else hi = mid - 1;
  }
  best = best || cluster(src, 3);
  // compact to referenced vertices
  const remap = new Int32Array(best.V).fill(-1), P = [], N = [], C = [], I = new Uint32Array(best.tris.length);
  best.tris.forEach((v, i) => {
    if (remap[v] < 0) {
      remap[v] = P.length / 3;
      const o = v * 10, w = best.acc[o + 9];
      P.push(best.acc[o] / w, best.acc[o + 1] / w, best.acc[o + 2] / w);
      const l = Math.hypot(best.acc[o + 3], best.acc[o + 4], best.acc[o + 5]) || 1;
      N.push(best.acc[o + 3] / l, best.acc[o + 4] / l, best.acc[o + 5] / l);
      C.push(best.acc[o + 6] / w, best.acc[o + 7] / w, best.acc[o + 8] / w);
    }
    I[i] = remap[v];
  });
  const doc = new Document(), buf = doc.createBuffer();
  const acc = (type, arr) => doc.createAccessor().setType(type).setArray(arr).setBuffer(buf);
  const mat = doc.createMaterial('vc').setRoughnessFactor(0.95).setMetallicFactor(0).setDoubleSided(true);
  const prim = doc.createPrimitive().setAttribute('POSITION', acc('VEC3', new Float32Array(P))).setAttribute('NORMAL', acc('VEC3', new Float32Array(N)))
    .setAttribute('COLOR_0', acc('VEC3', new Float32Array(C))).setIndices(acc('SCALAR', I)).setMaterial(mat);
  doc.createScene().addChild(doc.createNode('lod').setMesh(doc.createMesh('lod').addPrimitive(prim)));
  const tmp = out + '.tmp.glb';
  await io.write(tmp, doc);
  execFileSync(BIN, ['optimize', tmp, out, '--compress', 'meshopt', '--simplify', 'false', '--palette', 'false', '--instance', 'false'], { stdio: ['ignore', 'ignore', 'inherit'] });
  rmSync(tmp);
  return I.length / 3;
}

const args = process.argv.slice(2), force = args.includes('--force'), only = args.filter((a) => !a.startsWith('--'));
mkdirSync(OUT, { recursive: true });
const index = {};
for (const f of readdirSync(SRC).filter((n) => n.endsWith('.glb')).sort()) {
  const id = f.slice(0, -4), kind = KIND(id), chain = CHAINS[kind], file = join(SRC, f);
  index[id] = { kind, lods: chain.length };
  if (only.length && !only.includes(id)) continue;
  let src = null;
  for (let n = 0; n < chain.length; n++) {
    const lvl = chain[n], out = join(OUT, `${id}.${n}.glb`);
    if (!force && existsSync(out) && statSync(out).mtimeMs > statSync(file).mtimeMs) continue;
    let tris = '';
    if (lvl.mode === 'tex') {
      const doc = await io.read(file), tmp = out + '.tmp.glb';
      for (const m of doc.getRoot().listMaterials()) {
        const t = m.getMetallicRoughnessTexture();
        if (lvl.smooth) {
          const mr = t ? await sharp(Buffer.from(t.getImage())).raw().toBuffer({ resolveWithObject: true }) : null;
          smoothSurface(doc, doc.getRoot().listMeshes()[0].listPrimitives()[0], lvl.smooth[0], lvl.smooth[1], mr && { data: mr.data, ...mr.info });
          m.setMetallicRoughnessTexture(null);
        } else if (t) m.setMetallicRoughnessTexture(null).setMetallicFactor(0).setRoughnessFactor(0.9);
      }
      await io.write(tmp, doc);
      execFileSync(BIN, ['optimize', tmp, out, '--compress', 'meshopt', '--texture-compress', 'webp', '--texture-size', String(lvl.size),
        '--simplify', 'false', '--palette', 'false', '--instance', 'false', '--prune-solid-textures', 'false', '--prune-attributes', 'false'], { stdio: ['ignore', 'ignore', 'inherit'] });
      rmSync(tmp);
    } else {
      src = src || await readSource(file);
      tris = ` ${await writeClustered(src, lvl.tris, out)} tris`;
    }
    console.log(`${id}.${n}.glb  ${lvl.mode}  ${(statSync(out).size / 1e6).toFixed(2)} MB${tris}`);
  }
}
// Content hash per asset: the game appends it to the .glb URLs, so a rebuilt model can never be served stale from
// a browser or proxy cache (the files themselves are cached for a long time).
for (const [id, info] of Object.entries(index)) {
  const h = createHash('sha1');
  for (let n = 0; n < info.lods; n++) { const f = join(OUT, `${id}.${n}.glb`); if (existsSync(f)) h.update(readFileSync(f)); }
  info.v = h.digest('hex').slice(0, 10);
}
writeFileSync(join(OUT, 'index.json'), JSON.stringify(index, null, 1));
console.log(`index.json: ${Object.keys(index).length} assets`);
