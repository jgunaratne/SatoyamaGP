// Turns raw TRELLIS.2 .glb output (assets_src/models) into web-ready LOD chains in public/models.
//   level 0   : the full-detail mesh, meshopt-compressed with WebP PBR textures
//   LODs 1+   : vertex clustering with the base colour baked into vertex colours, no textures. TRELLIS foliage is
//               thousands of loose shells, which edge-collapse cannot reduce; clustering can, and stays tiny.
// usage: GT_MODULES=/dir/with/node_modules node tools/build_models.mjs [id ...] [--force]
//   needs @gltf-transform/cli (which brings @gltf-transform/core and sharp); GT_MODULES defaults to this repo.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync, rmSync } from 'node:fs';
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

// Texture budget (VRAM is the limit on the GPU, not download size): only level 0 carries textures. Cars keep a small
// metallic-roughness map; everything else is dielectric, so its MR map is dropped and roughness is a constant.
const tex = (size, mr = 0) => ({ mode: 'tex', size, mr }), vc = (tris) => ({ mode: 'vc', tris });
const CHAINS = {
  car: [tex(2048, 512), vc(14000)],
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
          : /^(farmhouse|kura)/.test(id) ? 'build' : 'prop';

const io = new NodeIO();
const srgb2lin = new Float32Array(256).map((_, i) => { const c = i / 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); });

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
        if (t && lvl.mr) t.setImage(await sharp(Buffer.from(t.getImage())).resize(lvl.mr, lvl.mr).png().toBuffer()).setMimeType('image/png');
        else if (t) m.setMetallicRoughnessTexture(null).setMetallicFactor(0).setRoughnessFactor(0.9);
      }
      await io.write(tmp, doc);
      execFileSync(BIN, ['optimize', tmp, out, '--compress', 'meshopt', '--texture-compress', 'webp', '--texture-size', String(lvl.size),
        '--simplify', 'false', '--palette', 'false', '--instance', 'false', '--prune-solid-textures', 'false'], { stdio: ['ignore', 'ignore', 'inherit'] });
      rmSync(tmp);
    } else {
      src = src || await readSource(file);
      tris = ` ${await writeClustered(src, lvl.tris, out)} tris`;
    }
    console.log(`${id}.${n}.glb  ${lvl.mode}  ${(statSync(out).size / 1e6).toFixed(2)} MB${tris}`);
  }
}
writeFileSync(join(OUT, 'index.json'), JSON.stringify(index, null, 1));
console.log(`index.json: ${Object.keys(index).length} assets`);
