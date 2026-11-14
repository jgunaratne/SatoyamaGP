import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32, vnoise } from './util.js';
import { ROAD_HALF } from './track.js';
import { T_YARD } from './terrain.js';

const rng = mulberry32(1337);

function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function box(w, h, d, x, y, z) { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); return g; }
function tex(c, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------- procedural textures ----------
function wallTextures() {
  const W = 512, H = 256, c = canvas(W, H), g = c.getContext('2d'), e = canvas(W, H), ge = e.getContext('2d');
  g.fillStyle = '#e4dcc8'; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 4000; i++) { g.fillStyle = `rgba(90,75,55,${rng() * 0.07})`; g.fillRect(rng() * W, rng() * H, 3, 3); }
  const wy = H * 0.62;
  g.fillStyle = '#2a1d14'; g.fillRect(0, wy, W, H - wy);
  for (let x = 0; x < W; x += 16) {
    g.fillStyle = `rgba(0,0,0,${0.25 + rng() * 0.25})`; g.fillRect(x, wy, 2, H - wy);
    g.fillStyle = `rgba(120,90,60,${rng() * 0.12})`; g.fillRect(x + 2, wy, 14, H - wy);
  }
  ge.fillStyle = '#000'; ge.fillRect(0, 0, W, H);
  const shoji = (x, y, w, h) => {
    g.fillStyle = '#2a1c12'; g.fillRect(x - 5, y - 5, w + 10, h + 10);
    g.fillStyle = '#f1e6cc'; g.fillRect(x, y, w, h);
    ge.fillStyle = '#ffb054'; ge.fillRect(x, y, w, h);
    const rows = Math.max(2, Math.round(h / 24));
    for (const cx of [g, ge]) {
      cx.fillStyle = cx === g ? '#3b2a1c' : '#000';
      for (let i = 1; i < 4; i++) cx.fillRect(x + (w * i) / 4 - (i === 2 ? 2 : 1), y, i === 2 ? 4 : 2, h);
      for (let j = 1; j < rows; j++) cx.fillRect(x, y + (h * j) / rows - 1, w, 2);
    }
  };
  shoji(128 + 18, 58, 92, wy - 58 - 12);
  shoji(384 + 14, 40, 100, H - 40 - 16);
  for (const cx of [g, ge]) {
    cx.fillStyle = cx === g ? '#221710' : '#000';
    for (let k = 0; k <= 4; k++) cx.fillRect(k * 128 - 6, 0, 12, H);
    cx.fillRect(0, 0, W, 14); cx.fillRect(0, wy - 5, W, 10); cx.fillRect(0, H - 10, W, 10);
  }
  return { map: tex(c), emissive: tex(e) };
}

function roofTexture() {
  const S = 256, c = canvas(S, S), g = c.getContext('2d');
  for (let x = 0; x < S; x += 32) {
    const gr = g.createLinearGradient(x, 0, x + 32, 0);
    gr.addColorStop(0, '#3a3d43'); gr.addColorStop(0.45, '#b9bdc6'); gr.addColorStop(0.9, '#4a4d54'); gr.addColorStop(1, '#17181b');
    g.fillStyle = gr; g.fillRect(x, 0, 32, S);
  }
  for (let y = 0; y < S; y += 64) {
    for (let x = 0; x < S; x += 32) { g.fillStyle = `rgba(${rng() > 0.5 ? '255,255,255' : '0,0,0'},${rng() * 0.14})`; g.fillRect(x, y, 32, 64); }
    g.fillStyle = 'rgba(0,0,0,.7)'; g.fillRect(0, y, S, 6);
    g.fillStyle = 'rgba(255,255,255,.25)'; g.fillRect(0, y + 6, S, 3);
  }
  return tex(c);
}

function bannerTexture(text, bg, fg) {
  const c = canvas(1024, 128), g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, 1024, 128);
  g.fillStyle = 'rgba(255,255,255,.16)';
  for (let x = -128; x < 1024; x += 64) { g.beginPath(); g.moveTo(x, 128); g.lineTo(x + 64, 0); g.lineTo(x + 96, 0); g.lineTo(x + 32, 128); g.fill(); }
  g.fillStyle = fg; g.font = 'italic 900 84px "Arial Black", Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 512, 68);
  const t = tex(c); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

// ---------- roof construction ----------
function roofFace(e0, e1, r0, r1, y0, H, sag, up, nu = 14, nv = 6) {
  const pos = [], uv = [], idx = [];
  const ex = e1[0] - e0[0], ez = e1[1] - e0[1], el = Math.hypot(ex, ez), dx = ex / el, dz = ez / el;
  const run = Math.hypot((r0[0] + r1[0] - e0[0] - e1[0]) / 2, (r0[1] + r1[1] - e0[1] - e1[1]) / 2);
  const sl = Math.hypot(run, H);
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
    const s = i / nu, t = j / nv;
    const Ex = e0[0] + ex * s, Ez = e0[1] + ez * s;
    const Rx = r0[0] + (r1[0] - r0[0]) * s, Rz = r0[1] + (r1[1] - r0[1]) * s;
    const x = Ex + (Rx - Ex) * t, z = Ez + (Rz - Ez) * t;
    const y = y0 + H * (t * (1 - sag) + sag * t * t) + up * (1 - t) * (1 - t) * Math.pow(Math.abs(2 * s - 1), 3);
    pos.push(x, y, z);
    uv.push(((x - e0[0]) * dx + (z - e0[1]) * dz) / 2.2, (t * sl) / 1.6);
    if (i < nu && j < nv) { const a = j * (nu + 1) + i, c = a + nu + 1; idx.push(a, a + 1, c, a + 1, c + 1, c); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}
function tri(a, b, c) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...b, ...c], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0.5, 1], 2));
  g.setIndex([0, 1, 2]); g.computeVertexNormals();
  return g;
}

// Farmhouse with an irimoya (hip-and-gable) tiled roof, engawa veranda and shoji walls.
function makeHouse(a, b, wallH, H1, H2) {
  const o = 1.15, A = a + o, B = b + o, base = 0.5, yE = base + wallH - 0.15, fc = 0.5;
  const Ax = A - B * fc, Bz = B * (1 - fc), y1 = yE + H1, G = Ax + 0.4;
  const roof = [
    roofFace([-A, B], [A, B], [-Ax, Bz], [Ax, Bz], yE, H1, 0.4, 0.32),
    roofFace([A, -B], [-A, -B], [Ax, -Bz], [-Ax, -Bz], yE, H1, 0.4, 0.32),
    roofFace([A, B], [A, -B], [Ax, Bz], [Ax, -Bz], yE, H1, 0.4, 0.32, 10),
    roofFace([-A, -B], [-A, B], [-Ax, -Bz], [-Ax, Bz], yE, H1, 0.4, 0.32, 10),
    roofFace([-G, Bz], [G, Bz], [-G, 0], [G, 0], y1 - 0.03, H2, 0.25, 0, 10, 5),
    roofFace([G, -Bz], [-G, -Bz], [G, 0], [-G, 0], y1 - 0.03, H2, 0.25, 0, 10, 5),
    box(2 * G + 0.3, 0.3, 0.45, 0, y1 + H2 + 0.08, 0),
    box(0.24, 0.55, 0.55, G + 0.12, y1 + H2 + 0.12, 0), box(0.24, 0.55, 0.55, -G - 0.12, y1 + H2 + 0.12, 0),
  ];
  const wall = new THREE.BoxGeometry(2 * a, wallH, 2 * b);
  wall.translate(0, base + wallH / 2, 0);
  const uv = wall.attributes.uv;
  for (let i = 0; i < 8; i++) uv.setX(i, uv.getX(i) * (2 * b) / 7.2);
  for (let i = 16; i < 24; i++) uv.setX(i, uv.getX(i) * (2 * a) / 7.2);
  const wood = [
    box(2 * a, 0.14, 1.3, 0, base + 0.07, b + 0.65),
    box(2 * A, 0.16, 0.22, 0, yE - 0.1, B - 0.12), box(2 * A, 0.16, 0.22, 0, yE - 0.1, -B + 0.12),
    box(0.22, 0.16, 2 * B, A - 0.12, yE - 0.1, 0), box(0.22, 0.16, 2 * B, -A + 0.12, yE - 0.1, 0),
  ];
  const np = Math.round((2 * a) / 3.6);
  for (let k = 0; k <= np; k++) wood.push(box(0.16, wallH - 0.2, 0.16, -a + 0.1 + (k * (2 * a - 0.2)) / np, base + wallH / 2 - 0.05, b + 1.2));
  for (const sx of [1, -1]) wood.push(tri([sx * (Ax - 0.05), y1, Bz * 0.92], [sx * (Ax - 0.05), y1, -Bz * 0.92], [sx * (Ax - 0.05), y1 + H2 * 0.84, 0]));
  const stone = [box(2 * a + 0.5, base, 2 * b + 0.5, 0, base / 2, 0), box(1.6, 0.25, 0.8, 0, 0.125, b + 1.7)];
  return { roof: mergeGeometries(roof), wall, wood: mergeGeometries(wood), stone: mergeGeometries(stone) };
}

// Kura: white plaster storehouse with a simple gabled roof.
function makeKura() {
  const a = 2.7, b = 2.25, wallH = 4.6, base = 0.4, A = a + 0.75, B = b + 0.75, yE = base + wallH - 0.15, H = 1.9, top = base + wallH;
  const roof = [
    roofFace([-A, B], [A, B], [-A, 0], [A, 0], yE, H, 0.15, 0.1, 8, 5),
    roofFace([A, -B], [-A, -B], [A, 0], [-A, 0], yE, H, 0.15, 0.1, 8, 5),
    box(2 * A + 0.2, 0.26, 0.4, 0, yE + H + 0.06, 0),
  ];
  const plaster = [box(2 * a, wallH, 2 * b, 0, base + wallH / 2, 0)];
  for (const sx of [1, -1]) plaster.push(tri([sx * a, top, b], [sx * a, top, -b], [sx * a, yE + H - 0.12, 0]));
  const wood = [box(2 * a + 0.08, 1.5, 2 * b + 0.08, 0, base + 0.75, 0), box(0.8, 1.0, 0.12, 0, base + wallH * 0.72, b + 0.03), box(1.3, 2.0, 0.12, 0, base + 1.0, b + 0.06)];
  const stone = [box(2 * a + 0.5, base, 2 * b + 0.5, 0, base / 2, 0)];
  return { roof: mergeGeometries(roof), plaster: mergeGeometries(plaster), wood: mergeGeometries(wood), stone: mergeGeometries(stone) };
}

function instanced(geo, mat, list, cast = true) {
  const m = new THREE.InstancedMesh(geo, mat, list.length), d = new THREE.Object3D();
  list.forEach((it, i) => { d.position.set(it.x, it.y, it.z); d.rotation.set(0, it.ry || 0, 0); d.scale.setScalar(it.s || 1); d.updateMatrix(); m.setMatrixAt(i, d.matrix); });
  m.castShadow = cast; m.receiveShadow = true;
  m.computeBoundingSphere();
  return m;
}

export function buildProps(scene, track, terrain, colliders) {
  const group = new THREE.Group();
  scene.add(group);
  const wt = wallTextures(), rt = roofTexture();
  const mats = {
    wall: new THREE.MeshStandardMaterial({ map: wt.map, emissiveMap: wt.emissive, emissive: 0xffffff, emissiveIntensity: 2.2, roughness: 0.92 }),
    roofGrey: new THREE.MeshStandardMaterial({ map: rt, bumpMap: rt, bumpScale: 3, color: 0x7d8490, roughness: 0.5, metalness: 0.1, side: THREE.DoubleSide }),
    roofRed: new THREE.MeshStandardMaterial({ map: rt, bumpMap: rt, bumpScale: 3, color: 0xb0603f, roughness: 0.45, metalness: 0.05, side: THREE.DoubleSide }),
    wood: new THREE.MeshStandardMaterial({ color: 0x2c1f16, roughness: 0.85, side: THREE.DoubleSide }),
    stone: new THREE.MeshStandardMaterial({ color: 0x77736c, roughness: 0.95 }),
    plaster: new THREE.MeshStandardMaterial({ color: 0xe9e4d8, roughness: 0.9, side: THREE.DoubleSide }),
  };

  // ----- villages -----
  const variants = [makeHouse(7.2, 3.6, 3.0, 1.35, 2.3), makeHouse(5.4, 3.6, 2.9, 1.25, 2.1), makeKura()];
  const lists = [[], [], []], yardTrees = [];
  let houses = 0;
  for (const cell of terrain.cells) {
    if (cell.d < 30 || cell.d > 95) continue;
    if (vnoise(cell.ci * 0.21 + 3.3, cell.cj * 0.21 + 7.7) < 0.6) continue;
    if (houses >= 70) break;
    terrain.setCellType(cell, T_YARD);
    const dz = track.pz[cell.idx] - cell.z;
    const ry = dz > 0 ? 0 : Math.PI, f = dz > 0 ? 1 : -1;
    const v = rng() < 0.55 ? 0 : 1, hx = cell.x - 3.5 * f, hz = cell.z - 2 * f;
    lists[v].push({ x: hx, y: cell.h, z: hz, ry });
    for (const o of [-5, 0, 5]) colliders.add(hx + o * (v ? 0.75 : 1), hz, 4.3);
    if (rng() < 0.6) {
      const kx = cell.x + 10.4 * f, kz = cell.z - 4.5 * f;
      lists[2].push({ x: kx, y: cell.h, z: kz, ry });
      colliders.add(kx, kz, 3.4);
    }
    yardTrees.push({ x: cell.x - 12.5 * f, y: cell.h, z: cell.z + 8.5 * f, green: rng() < 0.5 });
    houses++;
  }
  const add = (geo, mat, list) => { if (list.length) group.add(instanced(geo, mat, list)); };
  add(variants[0].roof, mats.roofGrey, lists[0]); add(variants[0].wall, mats.wall, lists[0]);
  add(variants[0].wood, mats.wood, lists[0]); add(variants[0].stone, mats.stone, lists[0]);
  add(variants[1].roof, mats.roofRed, lists[1]); add(variants[1].wall, mats.wall, lists[1]);
  add(variants[1].wood, mats.wood, lists[1]); add(variants[1].stone, mats.stone, lists[1]);
  add(variants[2].roof, mats.roofGrey, lists[2]); add(variants[2].plaster, mats.plaster, lists[2]);
  add(variants[2].wood, mats.wood, lists[2]); add(variants[2].stone, mats.stone, lists[2]);

  // ----- torii gate over the start/finish line -----
  const frame = (i, lat = 0) => ({
    x: track.px[i] + track.lx[i] * lat, y: track.py[i], z: track.pz[i] + track.lz[i] * lat,
    ry: Math.atan2(-track.lz[i], track.lx[i]),
  });
  {
    const red = new THREE.MeshStandardMaterial({ color: 0xc9321a, roughness: 0.5 });
    const black = new THREE.MeshStandardMaterial({ color: 0x15130f, roughness: 0.6 });
    const t = new THREE.Group(), SP = 7.4;
    const bent = (w, h, d, y, k) => {
      const g = new THREE.BoxGeometry(w, h, d, 28, 1, 1), p = g.attributes.position;
      for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) + k * p.getX(i) * p.getX(i));
      g.computeVertexNormals(); g.translate(0, y, 0); return g;
    };
    const reds = [box(17, 0.6, 0.5, 0, 8.1, 0), bent(19.4, 0.7, 0.8, 10.3, 0.011), box(0.55, 1.6, 0.34, 0, 9.3, 0)];
    const blacks = [bent(20, 0.3, 1.05, 10.82, 0.011)];
    for (const sx of [1, -1]) {
      const c = new THREE.CylinderGeometry(0.4, 0.5, 10.4, 20); c.rotateZ(sx * 0.03); c.translate(sx * SP, 5.2, 0); reds.push(c);
      const bs = new THREE.CylinderGeometry(0.62, 0.66, 0.7, 20); bs.translate(sx * (SP + 0.15), 0.35, 0); blacks.push(bs);
    }
    const rm = new THREE.Mesh(mergeGeometries(reds), red), bm = new THREE.Mesh(mergeGeometries(blacks), black);
    rm.castShadow = bm.castShadow = true; rm.receiveShadow = true;
    t.add(rm, bm);
    const f = frame(0);
    t.position.set(f.x, f.y - 0.3, f.z); t.rotation.y = f.ry;
    group.add(t);
    for (const sx of [1, -1]) colliders.add(f.x + track.lx[0] * sx * SP, f.z + track.lz[0] * sx * SP, 0.7);
  }

  // ----- stone lanterns lining the grid -----
  {
    const parts = [];
    const cyl = (r0, r1, h, y, seg = 8) => { const g = new THREE.CylinderGeometry(r0, r1, h, seg); g.translate(0, y, 0); return g; };
    parts.push(cyl(0.42, 0.5, 0.25, 0.125), cyl(0.16, 0.2, 1.0, 0.75), cyl(0.42, 0.2, 0.18, 1.34, 6), cyl(0.14, 0.14, 0.42, 1.64, 4));
    const cap = new THREE.ConeGeometry(0.62, 0.42, 6); cap.translate(0, 2.06, 0); parts.push(cap);
    const fin = new THREE.SphereGeometry(0.1, 8, 6); fin.translate(0, 2.33, 0); parts.push(fin);
    const stoneGeo = mergeGeometries(parts.map((g) => g.toNonIndexed()));
    const glowGeo = new THREE.BoxGeometry(0.36, 0.34, 0.36); glowGeo.translate(0, 1.64, 0);
    const glow = new THREE.MeshStandardMaterial({ color: 0x241405, emissive: 0xffa040, emissiveIntensity: 5 });
    const list = [];
    for (let n = 1; n <= 5; n++) for (const sx of [1, -1]) {
      const i = (track.N - n * 6) % track.N, f = frame(i, sx * (ROAD_HALF + 2.3));
      list.push({ x: f.x, y: f.y - 0.3, z: f.z });
      colliders.add(f.x, f.z, 0.5);
    }
    group.add(instanced(stoneGeo, mats.stone, list), instanced(glowGeo, glow, list, false));
  }

  // ----- utility poles + sagging wires -----
  {
    const parts = [];
    const pole = new THREE.CylinderGeometry(0.13, 0.19, 9.6, 10); pole.translate(0, 4.8, 0); parts.push(pole);
    parts.push(box(2.0, 0.12, 0.12, 0, 9.0, 0), box(1.4, 0.1, 0.1, 0, 8.2, 0));
    const tr = new THREE.CylinderGeometry(0.28, 0.28, 0.75, 10); tr.translate(0.4, 7.3, 0); parts.push(tr);
    const geo = mergeGeometries(parts.map((g) => g.toNonIndexed()));
    const mat = new THREE.MeshStandardMaterial({ color: 0x6c6a66, roughness: 0.8 });
    const list = [], OFF = -(ROAD_HALF + 4.6);
    for (let i = 10; i < track.N - 10; i += 19) {
      const f = frame(i, OFF);
      list.push({ x: f.x, y: terrain.heightAt(f.x, f.z) - 0.1, z: f.z, ry: f.ry, i });
      colliders.add(f.x, f.z, 0.35);
    }
    group.add(instanced(geo, mat, list));
    const wp = [];
    for (let n = 0; n < list.length; n++) {
      const a = list[n], b = list[(n + 1) % list.length];
      const la = [track.lx[a.i], track.lz[a.i]], lb = [track.lx[b.i], track.lz[b.i]];
      for (const [off, hy] of [[-0.9, 9.1], [0, 9.1], [0.9, 9.1], [-0.6, 8.3], [0.6, 8.3]]) {
        const SEG = 8; let px = 0, py = 0, pz = 0;
        for (let s = 0; s <= SEG; s++) {
          const t = s / SEG;
          const x = (a.x + la[0] * off) * (1 - t) + (b.x + lb[0] * off) * t;
          const z = (a.z + la[1] * off) * (1 - t) + (b.z + lb[1] * off) * t;
          const y = (a.y + hy) * (1 - t) + (b.y + hy) * t - 0.8 * 4 * t * (1 - t);
          if (s > 0) wp.push(px, py, pz, x, y, z);
          px = x; py = y; pz = z;
        }
      }
    }
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.Float32BufferAttribute(wp, 3));
    group.add(new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: 0x0c0c0c })));
  }

  // ----- checkpoint arches -----
  const checkpoints = [0.25, 0.5, 0.75];
  {
    const bt = bannerTexture('CHECKPOINT', '#ff2a7f', '#ffe14a');
    const bm = new THREE.MeshStandardMaterial({ map: bt, emissiveMap: bt, emissive: 0xffffff, emissiveIntensity: 0.9, roughness: 0.6, side: THREE.DoubleSide });
    const pm = new THREE.MeshStandardMaterial({ color: 0x1b1b1f, roughness: 0.4, metalness: 0.7 });
    const lm = new THREE.MeshStandardMaterial({ color: 0x220011, emissive: 0xff2a7f, emissiveIntensity: 6 });
    const W = ROAD_HALF + 1.6;
    for (const fr of checkpoints) {
      const i = Math.round(fr * track.N) % track.N, f = frame(i);
      const g = new THREE.Group();
      const posts = [], lights = [];
      for (const sx of [1, -1]) {
        posts.push(box(0.35, 7.2, 0.35, sx * W, 3.6, 0));
        lights.push(box(0.1, 5.4, 0.37, sx * (W - 0.14), 3.0, 0));
        colliders.add(f.x + track.lx[i] * sx * W, f.z + track.lz[i] * sx * W, 0.45);
      }
      posts.push(box(2 * W + 0.35, 0.25, 0.35, 0, 7.3, 0));
      const banner = new THREE.Mesh(new THREE.PlaneGeometry(2 * W - 0.4, 1.25), bm);
      banner.position.set(0, 6.45, 0); banner.rotation.y = Math.PI;
      const a = new THREE.Mesh(mergeGeometries(posts), pm), b = new THREE.Mesh(mergeGeometries(lights), lm);
      a.castShadow = true;
      g.add(a, b, banner);
      g.position.set(f.x, f.y - 0.2, f.z); g.rotation.y = f.ry;
      group.add(g);
    }
  }

  return { group, yardTrees, checkpoints, houses };
}
