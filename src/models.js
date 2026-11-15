import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { gTime } from './util.js';

// TRELLIS.2 generated assets (see tools/trellis_manifest.json + tools/build_models.mjs).
// Each asset is a chain of LOD .glb files: <id>.0.glb is the full-detail mesh, higher numbers are simplified.
const BASE = import.meta.env.BASE_URL + 'models/';

// Yaw (radians) that turns each raw model so its front faces +Z. TRELLIS orients meshes from the concept view.
const YAW = { car_yellow: Math.PI, farmhouse_b: Math.PI / 2, torii: Math.PI / 2 };

// Car bodies carry roughness/metalness per vertex (TEXCOORD_1), smoothed along the surface at build time.
// Interpolating it on the GPU avoids the blotches a filtered texture gets from the fragmented TRELLIS UV atlas.
function vertexGloss(geo, mat) {
  // TEXCOORD_1 = (roughness, (wheelId + 0.9 * metalness) / 5): split it into a float gloss attribute and wheel ids
  const src = geo.attributes.uv1, n = src.count, gloss = new Float32Array(n * 2), ids = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const v = src.getY(i) * 5, id = Math.min(4, Math.floor(v + 1e-3));
    ids[i] = id; gloss[i * 2] = src.getX(i); gloss[i * 2 + 1] = Math.min(1, Math.max(0, (v - id) / 0.9));
  }
  geo.setAttribute('aGloss', new THREE.BufferAttribute(gloss, 2)); geo.deleteAttribute('uv1');
  mat.roughness = 1; mat.metalness = 1; mat.roughnessMap = mat.metalnessMap = null;
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aGloss;\nvarying vec2 vGloss;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGloss = aGloss;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vGloss;')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = clamp(vGloss.x, 0.04, 1.);')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = clamp(vGloss.y, 0., 1.);');
  };
  mat.customProgramCacheKey = () => 'vertexGloss';
  return ids;
}

// Split a car into body + four wheels using the per-vertex wheel ids. The parts share the car's vertex buffers
// (one GPU upload) and differ only in their index lists. A triangle belongs to a wheel only if all three of its
// vertices do; anything straddling the cut stays with the body, hidden behind the wheel.
function splitWheels(geo, ids) {
  const idx = geo.index.array, pos = geo.attributes.position, body = [], lists = [[], [], [], []];
  for (let t = 0; t < idx.length; t += 3) {
    const a = ids[idx[t]];
    (a && a === ids[idx[t + 1]] && a === ids[idx[t + 2]] ? lists[a - 1] : body).push(idx[t], idx[t + 1], idx[t + 2]);
  }
  if (lists.some((l) => l.length < 900)) return null;
  const part = (list) => {
    const g = new THREE.BufferGeometry();
    for (const k of Object.keys(geo.attributes)) g.setAttribute(k, geo.attributes[k]);
    g.setIndex(list); g.boundingBox = geo.boundingBox; g.boundingSphere = geo.boundingSphere;
    return g;
  };
  const wheels = lists.map((list) => {
    const b = new THREE.Box3(), v = new THREE.Vector3();
    for (const i of list) b.expandByPoint(v.fromBufferAttribute(pos, i));
    const size = b.getSize(new THREE.Vector3());
    return { geo: part(list), center: b.getCenter(new THREE.Vector3()), radius: Math.max(size.y, size.z) / 2, width: size.x };
  });
  return { body: part(body), wheels };
}

export class Models {
  constructor() { this.index = {}; this.map = new Map(); }

  // lodStart > 0 skips the heaviest levels (low quality tier).
  async load(lodStart = 0, onProgress = () => {}, only = null) {
    // The index is always revalidated; each model URL carries its content hash from the index.
    try { this.index = await (await fetch(BASE + 'index.json', { cache: 'no-cache' })).json(); } catch { this.index = {}; }
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    const jobs = [];
    for (const [id, info] of Object.entries(this.index)) {
      if (only && !only.includes(id)) continue;
      const first = Math.min(lodStart, info.lods - 1);
      for (let n = first; n < info.lods; n++) jobs.push({ id, n, first });
    }
    let done = 0;
    const raw = new Map();
    await Promise.all(jobs.map(async (j) => {
      try {
        const gltf = await loader.loadAsync(`${BASE}${j.id}.${j.n}.glb?v=${this.index[j.id].v || 0}`);
        let mesh = null;
        gltf.scene.updateMatrixWorld(true);
        gltf.scene.traverse((o) => { if (o.isMesh && !mesh) mesh = o; });
        if (mesh) {
          const geo = mesh.geometry, qp = geo.attributes.position;
          // meshopt stores positions as normalised int16 plus a node transform; bake to float before moving anything,
          // otherwise the baked values clamp to the int16 range.
          const fp = new Float32Array(qp.count * 3);
          for (let i = 0; i < qp.count; i++) { fp[i * 3] = qp.getX(i); fp[i * 3 + 1] = qp.getY(i); fp[i * 3 + 2] = qp.getZ(i); }
          geo.setAttribute('position', new THREE.BufferAttribute(fp, 3));
          geo.applyMatrix4(mesh.matrixWorld);
          if (YAW[j.id]) geo.rotateY(YAW[j.id]);
          if (!raw.has(j.id)) raw.set(j.id, []);
          raw.get(j.id)[j.n - j.first] = { geo, mat: mesh.material };
        }
      } catch (e) { console.warn('model failed', j.id, j.n, e.message); }
      onProgress(++done / jobs.length);
    }));
    for (const [id, lods] of raw) {
      const levels = lods.filter(Boolean);
      if (!levels.length) continue;
      // Stand every level on the origin using the most detailed level's bounds.
      levels[0].geo.computeBoundingBox();
      const bb = levels[0].geo.boundingBox, cx = (bb.min.x + bb.max.x) / 2, cz = (bb.min.z + bb.max.z) / 2;
      const size0 = bb.getSize(new THREE.Vector3());
      const kind = this.index[id].kind, foliage = kind === 'tree' || kind === 'bush' || kind === 'grass';
      levels.forEach((l, idx) => {
        l.geo.translate(-cx, -bb.min.y, -cz);
        l.geo.computeBoundingBox();
        if (idx > 0 && foliage) {
          // Voxel clustering clips outer twig/spire tips on coarse LODs; restore the exact level-0 envelope so trees never jump in height.
          const bbL = l.geo.boundingBox, szL = bbL.getSize(new THREE.Vector3());
          if (szL.x > 1e-4 && szL.y > 1e-4 && szL.z > 1e-4) {
            l.geo.translate(-(bbL.min.x + bbL.max.x) / 2, -bbL.min.y, -(bbL.min.z + bbL.max.z) / 2);
            l.geo.scale(size0.x / szL.x, size0.y / szL.y, size0.z / szL.z);
            l.geo.computeBoundingBox();
          }
        }
        l.geo.computeBoundingSphere();
        const m = l.mat;
        if (m.map) m.map.anisotropy = 8;
        if (kind !== 'car') { m.metalness = 0; m.roughness = Math.max(m.roughness, 0.9); }
        else if (!m.map) { m.metalness = 0.35; m.roughness = 0.4; }
        else if (l.geo.attributes.uv1) l.parts = splitWheels(l.geo, vertexGloss(l.geo, m));
        if (!m.map && foliage) smoothCrownNormals(l.geo, size0);
        m.transparent = false; m.depthWrite = true; m.side = m.map ? THREE.FrontSide : THREE.DoubleSide;
      });
      this.map.set(id, { id, kind, levels, size: size0 });
    }
    return this;
  }

  get(id) { return this.map.get(id) || null; }
  all(...ids) { const out = ids.map((i) => this.get(i)).filter(Boolean); return out.length ? out : null; }
}

// ---------------------------------------------------------------- distance-LOD instancing
const lodSets = [];
const _d = new THREE.Object3D(), _c = new THREE.Color();
// Draws nothing in the colour pass but still casts: lets a cheap LOD stand in for a 150k-triangle mesh in the shadow map.
export const SHADOW_ONLY = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });

// Smooth outward canopy normals for clustered foliage LODs so backlit crowns shade like level 0 instead of glittering.
function smoothCrownNormals(geo, size) {
  const pos = geo.attributes.position, nrm = geo.attributes.normal, n = pos.count;
  const out = new Float32Array(n * 3), cy = size.y * 0.42, upBias = size.y * 0.16;
  for (let i = 0; i < n; i++) {
    let cx = pos.getX(i), cy0 = (pos.getY(i) - cy) * 0.55 + upBias, cz = pos.getZ(i);
    const cl = Math.hypot(cx, cy0, cz) || 1; cx /= cl; cy0 /= cl; cz /= cl;
    const ox = nrm ? nrm.getX(i) : 0, oy = nrm ? nrm.getY(i) : 1, oz = nrm ? nrm.getZ(i) : 0;
    let nx = cx * 0.82 + ox * 0.18, ny = cy0 * 0.82 + oy * 0.18, nz = cz * 0.82 + oz * 0.18;
    const l = Math.hypot(nx, ny, nz) || 1;
    out[i * 3] = nx / l; out[i * 3 + 1] = ny / l; out[i * 3 + 2] = nz / l;
  }
  geo.setAttribute('normal', new THREE.BufferAttribute(out, 3));
}

function foliageMaterial(src, amount = 0, twoSidedCrown = false) {
  if (!amount && !twoSidedCrown) return src;
  const mat = src.clone();
  mat.onBeforeCompile = (sh) => {
    if (amount) {
      sh.uniforms.uTime = gTime;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          #ifdef USE_INSTANCING
            vec3 ip = instanceMatrix[3].xyz;
            float w = sin(uTime * 2.1 + ip.x * .31 + ip.z * .27) + .5 * sin(uTime * 3.7 + ip.x * .9 - ip.z * .6);
            float hy = max(position.y, 0.); hy *= hy;
            transformed.x += w * ${amount.toFixed(3)} * hy; transformed.z += w * ${(amount * 0.55).toFixed(3)} * hy;
          #endif`);
    }
    if (twoSidedCrown) {
      // Keep the crown normal on back-facing clustered leaves instead of flipping it into the sun.
      sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>',
        '#include <normal_fragment_begin>\nnormal = normalize( vNormal );');
    }
  };
  mat.customProgramCacheKey = () => `fol_${amount}_${twoSidedCrown ? 1 : 0}`;
  return mat;
}

/**
 * Instances `model` at every item ({x,y,z,ry,s,sy,c}) in spatial cells; each cell shows the LOD level matching
 * its distance to the camera. opt: { cell, dist: [d0, d1, ...] (switch distances), far (hide beyond),
 * cast (number of levels that cast shadows), receive, sway (wind amount, 0 = rigid), first (first level used) }.
 */
export function scatter(model, items, opt = {}) {
  const out = new THREE.Group();
  if (!model || !items.length) return out;
  const cell = opt.cell || 64, first = Math.min(opt.first || 0, model.levels.length - 1);
  const foliage = model.kind === 'tree' || model.kind === 'bush' || model.kind === 'grass';
  const levels = model.levels.slice(first).map((l) => ({
    geo: l.geo,
    mat: foliageMaterial(l.mat, opt.sway || 0, foliage && !l.mat.map),
  }));
  const dist = (opt.dist || []).slice(0, levels.length - 1);
  const groups = new Map();
  for (const it of items) {
    const k = Math.floor(it.x / cell) + ',' + Math.floor(it.z / cell);
    let a = groups.get(k); if (!a) groups.set(k, (a = []));
    a.push(it);
  }
  const cells = [], cast = opt.cast ?? 1;
    const rad = Math.max(model.size.x, model.size.z) * 0.5;
    for (const arr of groups.values()) {
      const box = new THREE.Box3(), meshes = [];
      levels.forEach((l, n) => {
        const m = new THREE.InstancedMesh(l.geo, l.mat, arr.length);
        arr.forEach((it, i) => {
          const s = it.s || 1, sy = it.sy || s, r = rad * s;
          _d.position.set(it.x, it.y, it.z); _d.rotation.set(0, it.ry || 0, 0);
          _d.scale.set(s, sy, s); _d.updateMatrix();
          m.setMatrixAt(i, _d.matrix);
          if (it.c) m.setColorAt(i, _c.setRGB(it.c[0], it.c[1], it.c[2]));
          if (n === 0) {
            box.expandByPoint(_d.position.set(it.x - r, it.y, it.z - r));
            box.expandByPoint(_d.position.set(it.x + r, it.y + model.size.y * sy, it.z + r));
          }
        });
        // The full-detail level never renders into the shadow map; a level-1 proxy casts for it (see below).
        m.castShadow = n < cast && !(n === 0 && levels.length > 1); m.receiveShadow = opt.receive ?? true;
        m.computeBoundingSphere(); m.visible = false;
        meshes.push(m); out.add(m);
      });
      let proxy = null;
      if (cast > 0 && levels.length > 1) {
        proxy = new THREE.InstancedMesh(levels[1].geo, SHADOW_ONLY, arr.length);
        proxy.instanceMatrix = meshes[1].instanceMatrix;
        proxy.castShadow = true; proxy.receiveShadow = false; proxy.visible = false;
        proxy.boundingSphere = meshes[1].boundingSphere;
        out.add(proxy);
      }
      cells.push({ box, meshes, proxy, lvl: -1, hidden: false });
    }
    lodSets.push({ cells, dist, far: opt.far || Infinity });
    return out;
  }

export function updateLods(cam, scale = 1) {
  for (const set of lodSets) {
    for (const c of set.cells) {
      const d = c.box.distanceToPoint(cam) / scale;
      let lvl = 0;
      // Hysteresis keeps cells from chattering across an LOD threshold as the car corners or adaptive scale shifts.
      while (lvl < set.dist.length && d > set.dist[lvl] * (c.lvl >= 0 && lvl >= c.lvl ? 1.08 : 0.96)) lvl++;
      const hide = d > set.far * (c.hidden ? 0.95 : 1.05);
      c.lvl = lvl; c.hidden = hide;
      for (let n = 0; n < c.meshes.length; n++) c.meshes[n].visible = !hide && n === lvl;
      if (c.proxy) c.proxy.visible = !hide && lvl === 0;
    }
  }
}
