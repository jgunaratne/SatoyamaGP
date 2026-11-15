import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32, gTime } from './util.js';
import { ROAD_HALF } from './track.js';

function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function box(w, h, d, x = 0, y = 0, z = 0) { const g = new THREE.BoxGeometry(w, h, d); if (x || y || z) g.translate(x, y, z); return g; }

function makeTex(c, srgb = true, clampEdge = false) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = clampEdge ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// High-rise glass curtain-wall & mid-rise commercial facade atlas with lit office/apartment window grids.
function buildingFacadeTextures(rng) {
  const W = 512, H = 1024, c = canvas(W, H), g = c.getContext('2d'), e = canvas(W, H), ge = e.getContext('2d');
  g.fillStyle = '#121722'; g.fillRect(0, 0, W, H);
  ge.fillStyle = '#000000'; ge.fillRect(0, 0, W, H);

  const cols = 16, rows = 48, cw = W / cols, rh = H / rows;
  const tones = ['#ffdca8', '#ffe9c4', '#cce6ff', '#e4f1ff', '#9ad4ff', '#ffcf86'];
  for (let r = 0; r < rows; r++) {
    // Structural spandrel band between floors
    g.fillStyle = r % 6 === 0 ? '#0b0e15' : '#161c28';
    g.fillRect(0, r * rh, W, 5);
    const floorLit = rng() < 0.72 ? 0.35 + rng() * 0.45 : 0.1;
    const bandHue = tones[Math.floor(rng() * tones.length)];
    for (let k = 0; k < cols; k++) {
      const px = k * cw + 3, py = r * rh + 5, pw = cw - 6, ph = rh - 7;
      // Ground-floor glowing konbini / arcade / shopfronts at bottom rows
      if (r >= rows - 2) {
        const shopCol = (k >> 2) % 3 === 0 ? '#6ee7ff' : (k >> 2) % 3 === 1 ? '#ffe09e' : '#ff7ab8';
        g.fillStyle = '#242c3c'; g.fillRect(px, py, pw, ph);
        ge.fillStyle = shopCol; ge.fillRect(px, py + 2, pw, ph - 3);
        continue;
      }
      g.fillStyle = rng() < 0.5 ? '#1b2434' : '#151d2b';
      g.fillRect(px, py, pw, ph);
      if (rng() < floorLit) {
        const col = rng() < 0.65 ? bandHue : tones[Math.floor(rng() * tones.length)];
        const br = 0.45 + rng() * 0.55;
        ge.globalAlpha = br;
        ge.fillStyle = col;
        ge.fillRect(px + 1, py + 1, pw - 2, ph - 2);
        // Subtle interior blinds / desk silhouette
        if (rng() < 0.4) {
          ge.fillStyle = '#000';
          ge.fillRect(px + 1, py + ph * 0.55, pw - 2, ph * 0.4);
        }
        ge.globalAlpha = 1;
      }
    }
  }
  // Vertical mullions
  g.fillStyle = '#0a0d14';
  for (let k = 0; k <= cols; k++) g.fillRect(k * cw - 1.5, 0, 3, H);
  return { map: makeTex(c), emissive: makeTex(e) };
}

// Vertical & rooftop Japanese neon sign atlas (4 columns x 2 rows of signs).
function neonAtlasTexture() {
  const W = 1024, H = 512, c = canvas(W, H), g = c.getContext('2d');
  g.fillStyle = '#05060a'; g.fillRect(0, 0, W, H);
  const signs = [
    { bg: '#180414', border: '#ff2a7f', fg: '#ffe14a', sub: '#ff6ad5', top: '里山 GP', main: '東京湾岸', bot: '24H EXPRESS' },
    { bg: '#031520', border: '#00e5ff', fg: '#ffffff', sub: '#00e5ff', top: 'SHUTO', main: '首都高速', bot: 'BAYSHORE' },
    { bg: '#191003', border: '#ffb800', fg: '#ffe14a', sub: '#ff5533', top: 'SHIBUYA', main: '渋谷ネオン', bot: 'ARCADE' },
    { bg: '#0d0522', border: '#a855f7', fg: '#f0abfc', sub: '#38bdf8', top: 'ODAIBA', main: 'お台場', bot: 'FUTURE PORT' },
    { bg: '#031a14', border: '#10b981', fg: '#a7f3d0', sub: '#fde047', top: 'GINZA', main: '銀座通り', bot: 'TOKYO NIGHT' },
    { bg: '#200509', border: '#ff3b5c', fg: '#ffffff', sub: '#ffe14a', top: 'TURBO', main: '湾岸線', bot: 'MAX SPEED' },
    { bg: '#051226', border: '#38bdf8', fg: '#bae6fd', sub: '#ff2a7f', top: 'ROPPONGI', main: '六本木', bot: 'SKY LOUNGE' },
    { bg: '#18081e', border: '#f43f5e', fg: '#fde047', sub: '#67e8f9', top: 'HOTEL', main: '東京タワー', bot: 'PANORAMA' },
  ];
  const cw = W / 4, ch = H / 2;
  signs.forEach((s, idx) => {
    const x = (idx % 4) * cw, y = Math.floor(idx / 4) * ch;
    g.fillStyle = s.bg; g.fillRect(x + 8, y + 8, cw - 16, ch - 16);
    g.strokeStyle = s.border; g.lineWidth = 8; g.strokeRect(x + 14, y + 14, cw - 28, ch - 28);
    g.strokeStyle = '#ffffff'; g.lineWidth = 2; g.strokeRect(x + 22, y + 22, cw - 44, ch - 44);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = s.sub; g.font = '900 24px "Arial Black", Arial, sans-serif';
    g.fillText(s.top, x + cw / 2, y + 54);
    g.fillStyle = s.fg; g.font = '900 50px "Noto Sans JP", "Hiragino Sans", "Yu Gothic", Arial, sans-serif';
    g.fillText(s.main, x + cw / 2, y + ch / 2 + 4);
    g.fillStyle = s.border; g.font = '800 20px "Arial Black", Arial, sans-serif';
    g.fillText(s.bot, x + cw / 2, y + ch - 46);
  });
  return makeTex(c, true, true);
}

// Green Shuto Expressway overhead direction sign board texture.
function gantrySignTexture(route, jp, en) {
  const c = canvas(1024, 192), g = c.getContext('2d');
  g.fillStyle = '#0a5c36'; g.fillRect(0, 0, 1024, 192);
  g.strokeStyle = '#e8f5ee'; g.lineWidth = 8; g.strokeRect(10, 10, 1004, 172);
  // Route shield badge on left
  g.fillStyle = '#0e3b8c'; g.fillRect(34, 36, 150, 120);
  g.strokeStyle = '#ffffff'; g.lineWidth = 5; g.strokeRect(34, 36, 150, 120);
  g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = '900 46px "Arial Black", Arial, sans-serif';
  g.fillText(route, 109, 98);
  // Destination text
  g.textAlign = 'left';
  g.font = '900 54px "Noto Sans JP", "Hiragino Sans", Arial, sans-serif';
  g.fillText(jp, 218, 76);
  g.fillStyle = '#b9f6ca';
  g.font = '800 34px "Arial Black", Arial, sans-serif';
  g.fillText(en + '  ▲', 218, 138);
  return makeTex(c, true, true);
}

function uvTileBox(w, h, d, u0, v0, u1, v1) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
  }
  return g;
}

// 320 m red-and-white curved lattice communications tower ("Tokyo Tower" silhouette).
function buildTokyoTower(x, baseY, z) {
  const group = new THREE.Group();
  const H = 315;
  const redGeo = [], whiteGeo = [], deckGeo = [], beaconGeo = [];
  const bands = 14;
  const spanAt = (t) => 34 * Math.pow(1 - t, 1.55) + 2.4;

  for (let b = 0; b < bands; b++) {
    const t0 = b / bands, t1 = (b + 1) / bands;
    const y0 = t0 * H, y1 = t1 * H, ym = (y0 + y1) / 2, segH = y1 - y0;
    const s0 = spanAt(t0), s1 = spanAt(t1), sm = (s0 + s1) / 2;
    const colArr = b % 2 === 0 ? redGeo : whiteGeo;
    const legR = Math.max(0.45, 1.65 * (1 - t0 * 0.72));

    // 4 corner legs tilted inward along the curve
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const dx = sx * (s1 - s0), dz = sz * (s1 - s0);
      const len = Math.hypot(dx, segH, dz);
      const leg = new THREE.CylinderGeometry(legR * 0.88, legR, len, 8);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dx, segH, dz).normalize());
      leg.applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(q));
      leg.translate(sx * sm, ym, sz * sm);
      colArr.push(leg);
    }
    // Horizontal perimeter girders + X-bracing on all 4 faces
    const beamT = Math.max(0.32, legR * 0.55);
    colArr.push(box(s1 * 2 + legR, beamT, beamT, 0, y1, s1), box(s1 * 2 + legR, beamT, beamT, 0, y1, -s1));
    colArr.push(box(beamT, beamT, s1 * 2 + legR, s1, y1, 0), box(beamT, beamT, s1 * 2 + legR, -s1, y1, 0));

    const diagLen = Math.hypot(sm * 2, segH), ang = Math.atan2(sm * 2, segH);
    for (const sign of [-1, 1]) {
      for (const fz of [-1, 1]) {
        const d1 = new THREE.BoxGeometry(beamT * 0.65, diagLen, beamT * 0.65);
        d1.rotateZ(sign * ang); d1.translate(0, ym, fz * sm); colArr.push(d1);
      }
      for (const fx of [-1, 1]) {
        const d2 = new THREE.BoxGeometry(beamT * 0.65, diagLen, beamT * 0.65);
        d2.rotateX(sign * ang); d2.translate(fx * sm, ym, 0); colArr.push(d2);
      }
    }
  }
  // Spire mast
  redGeo.push(box(2.2, 28, 2.2, 0, H + 14, 0));
  whiteGeo.push(box(1.2, 24, 1.2, 0, H + 40, 0));

  // Main two-story observatory deck (~135 m) & upper observatory (~235 m)
  deckGeo.push(box(26, 8.5, 26, 0, 136, 0), box(28.5, 3.8, 28.5, 0, 142.5, 0));
  deckGeo.push(box(13.5, 6.5, 13.5, 0, 236, 0));

  // Aviation warning beacons
  for (const [bx, by, bz] of [[0, H + 53, 0], [15, 145, 15], [-15, 145, 15], [15, 145, -15], [-15, 145, -15]]) {
    const sp = new THREE.SphereGeometry(1.3, 8, 8); sp.translate(bx, by, bz); beaconGeo.push(sp);
  }

  const redMat = new THREE.MeshStandardMaterial({ color: 0xe63820, emissive: 0xff4818, emissiveIntensity: 1.35, roughness: 0.42, metalness: 0.35 });
  const whiteMat = new THREE.MeshStandardMaterial({ color: 0xf4f4f8, emissive: 0xffcf96, emissiveIntensity: 1.0, roughness: 0.4, metalness: 0.3 });
  const deckMat = new THREE.MeshStandardMaterial({ color: 0x1e2430, emissive: 0xffe4a8, emissiveIntensity: 2.8, roughness: 0.25 });
  const beaconMat = new THREE.MeshBasicMaterial({ color: 0xff1e38 });

  group.add(
    new THREE.Mesh(mergeGeometries(redGeo), redMat),
    new THREE.Mesh(mergeGeometries(whiteGeo), whiteMat),
    new THREE.Mesh(mergeGeometries(deckGeo), deckMat),
    new THREE.Mesh(mergeGeometries(beaconGeo), beaconMat),
  );
  group.position.set(x, baseY, z);
  return group;
}

// Twin-pylon illuminated suspension bridge ("Rainbow Bridge") across Tokyo Bay.
function buildSuspensionBridge(track, terrain, bridgeCfg) {
  const group = new THREE.Group();
  let { s0, s1 } = bridgeCfg;
  if (s0 == null || s1 == null) {
    let i0 = -1, i1 = -1;
    for (let i = 0; i < track.N; i++) {
      if (track.py[i] > 18 && terrain.lakeAt(track.px[i], track.pz[i], 1.04)) {
        if (i0 < 0) i0 = i;
        i1 = i;
      }
    }
    if (i0 < 0) return group;
    s0 = Math.max(0, i0 * track.ds - 24);
    s1 = Math.min(track.length, i1 * track.ds + 24);
  }
  const pA = track.sample(s0), pB = track.sample(s1);
  const f1 = track.sample(s0 + (s1 - s0) * 0.27), f2 = track.sample(s0 + (s1 - s0) * 0.73);
  const spanW = ROAD_HALF + 3.2, towerH = 92;

  const whiteGeo = [], cableGeo = [], lightEmerald = [], lightMagenta = [];
  const addTower = (f) => {
    const yaw = Math.atan2(f.tx, f.tz), m4 = new THREE.Matrix4().makeRotationY(yaw).setPosition(f.x, 0, f.z);
    const put = (geo, dst = whiteGeo) => { geo.applyMatrix4(m4); dst.push(geo); };
    // Concrete caisson footing in the bay + twin inclined H-frame legs + 3 cross-struts
    put(box(spanW * 2 + 8, 9, 10, 0, 1.5, 0));
    for (const sx of [-1, 1]) {
      put(box(3.2, towerH, 4.2, sx * spanW, towerH / 2 + 3, 0));
      put(box(0.28, towerH - 14, 0.32, sx * (spanW - 1.65), towerH / 2 + 6, 2.15), lightEmerald);
    }
    for (const [hy, th] of [[f.y - 2.2, 3.0], [towerH * 0.58, 2.8], [towerH - 4, 3.2]]) {
      put(box(spanW * 2 + 3.4, th, 3.8, 0, hy, 0));
      put(box(spanW * 2 - 2, 0.38, 3.95, 0, hy, 0), lightMagenta);
    }
  };
  addTower(f1); addTower(f2);

  // Main catenary cables + vertical suspenders along the bridge arc
  const steps = 44;
  for (let k = 0; k <= steps; k++) {
    const u = k / steps, s = s0 + (s1 - s0) * u;
    const f = track.sample(s);
    // Cable height: anchored near deck at s0/s1, peaks at towerH + 3 at u=0.27 and u=0.73, parabolic sag in middle
    let cy;
    const peakY = towerH + 2.5;
    if (u < 0.27) {
      const q = u / 0.27;
      cy = f.y + 2 + (peakY - (f.y + 2)) * (q * q * 0.85 + q * 0.15);
    } else if (u <= 0.73) {
      const q = (u - 0.5) / 0.23; // -1 .. +1
      const sagLow = f.y + 7.5;
      cy = sagLow + (peakY - sagLow) * (q * q);
    } else {
      const q = (1 - u) / 0.27;
      cy = f.y + 2 + (peakY - (f.y + 2)) * (q * q * 0.85 + q * 0.15);
    }
    for (const sx of [-1, 1]) {
      const wx = f.x + f.lx * sx * spanW, wz = f.z + f.lz * sx * spanW;
      // Vertical suspender cable
      const hLen = Math.max(0.5, cy - (f.y + 0.5));
      cableGeo.push(box(0.14, hLen, 0.14, wx, f.y + 0.5 + hLen / 2, wz));
      // Deck edge illumination node
      if (k % 2 === 0) lightEmerald.push(box(0.45, 0.45, 1.4, wx, f.y + 0.35, wz));
      // Segment of main cable to next sample
      if (k < steps) {
        const u2 = (k + 1) / steps, fN = track.sample(s0 + (s1 - s0) * u2);
        let cy2;
        if (u2 < 0.27) { const q = u2 / 0.27; cy2 = fN.y + 2 + (peakY - (fN.y + 2)) * (q * q * 0.85 + q * 0.15); }
        else if (u2 <= 0.73) { const q = (u2 - 0.5) / 0.23; cy2 = (fN.y + 7.5) + (peakY - (fN.y + 7.5)) * (q * q); }
        else { const q = (1 - u2) / 0.27; cy2 = fN.y + 2 + (peakY - (fN.y + 2)) * (q * q * 0.85 + q * 0.15); }
        const nx = fN.x + fN.lx * sx * spanW, nz = fN.z + fN.lz * sx * spanW;
        const dv = new THREE.Vector3(nx - wx, cy2 - cy, nz - wz), len = dv.length();
        const seg = new THREE.CylinderGeometry(0.42, 0.42, len, 6);
        const qRot = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dv.normalize());
        seg.applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(qRot).setPosition((wx + nx) / 2, (cy + cy2) / 2, (wz + nz) / 2));
        cableGeo.push(seg);
      }
    }
  }
  void pA; void pB;
  const towerMat = new THREE.MeshStandardMaterial({ color: 0xcbd6e6, emissive: 0x162236, emissiveIntensity: 0.18, roughness: 0.45, metalness: 0.25 });
  const cableMat = new THREE.MeshStandardMaterial({ color: 0xb8c8dc, emissive: 0x244668, emissiveIntensity: 0.24, roughness: 0.38, metalness: 0.45 });
  const emMat = new THREE.MeshStandardMaterial({ color: 0x105044, emissive: 0x22d8a8, emissiveIntensity: 1.05, roughness: 0.4 });
  const mgMat = new THREE.MeshStandardMaterial({ color: 0x521233, emissive: 0xf0388c, emissiveIntensity: 1.05, roughness: 0.4 });
  group.add(
    new THREE.Mesh(mergeGeometries(whiteGeo), towerMat),
    new THREE.Mesh(mergeGeometries(cableGeo), cableMat),
    new THREE.Mesh(mergeGeometries(lightEmerald), emMat),
    new THREE.Mesh(mergeGeometries(lightMagenta), mgMat),
  );
  return group;
}

// Giant waterfront neon Ferris wheel (Odaiba Palette-style landmark) with animated slow rotation.
function buildFerrisWheel(x, baseY, z, ry = 0) {
  const group = new THREE.Group();
  const R = 54, cy = baseY + R + 10;
  const legGeo = [], wheelGeo = [], neonRim = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const dx = sx * 24, dz = sz * 5.5, len = Math.hypot(dx, R + 10);
    const leg = new THREE.CylinderGeometry(0.9, 1.3, len, 8);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(-dx, R + 10, 0).normalize());
    leg.applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(q).setPosition(dx / 2, (R + 10) / 2, dz));
    legGeo.push(leg);
  }
  const spokes = 20;
  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * Math.PI * 2, a2 = ((i + 1) / spokes) * Math.PI * 2;
    for (const zOff of [-3.2, 3.2]) {
      const sp = new THREE.BoxGeometry(0.35, R, 0.35);
      sp.translate(0, R / 2, zOff); sp.rotateZ(a); neonRim.push(sp);
      const chord = 2 * R * Math.sin(Math.PI / spokes);
      const rim = new THREE.BoxGeometry(chord, 0.75, 0.75);
      rim.translate(0, R, zOff); rim.rotateZ((a + a2) / 2); neonRim.push(rim);
      const inner = new THREE.BoxGeometry(chord * 0.58, 0.45, 0.45);
      inner.translate(0, R * 0.58, zOff); inner.rotateZ((a + a2) / 2); wheelGeo.push(inner);
    }
    const pod = box(2.2, 2.6, 5.8, Math.cos(a) * R, Math.sin(a) * R, 0);
    neonRim.push(pod);
  }
  const steelMat = new THREE.MeshStandardMaterial({ color: 0x2c3342, roughness: 0.45, metalness: 0.6 });
  const rimMat = new THREE.MeshBasicMaterial({ color: 0xff3b9a });
  rimMat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = gTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nvarying float vAng;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float a = uTime * 0.12;
        float ca = cos(a), sa = sin(a);
        transformed.xy = mat2(ca, -sa, sa, ca) * transformed.xy;
        vAng = atan(transformed.y, transformed.x);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nvarying float vAng;')
      .replace('vec4 diffuseColor = vec4( diffuse, opacity );', `
        float h = fract(vAng / 6.2831853 + uTime * 0.08);
        vec3 rainbow = 0.55 + 0.45 * cos(6.2831853 * (h + vec3(0.0, 0.33, 0.67)));
        vec4 diffuseColor = vec4(rainbow * 1.6, opacity );`);
  };
  const wheelMesh = new THREE.Mesh(mergeGeometries(neonRim), rimMat);
  wheelMesh.position.y = R + 10;
  const innerMesh = new THREE.Mesh(mergeGeometries(wheelGeo), steelMat);
  innerMesh.position.y = R + 10;
  group.add(new THREE.Mesh(mergeGeometries(legGeo), steelMat), innerMesh, wheelMesh);
  group.position.set(x, baseY, z);
  group.rotation.y = ry;
  return group;
}

export function buildCity(scene, track, terrain, colliders, level, q = {}) {
  const group = new THREE.Group();
  if (!level.city) return group;
  scene.add(group);
  const rng = mulberry32(90210);
  const C = level.city;

  // 1. Elevated viaduct box-girders + concrete support piers wherever the road rises above terrain/water
  {
    const deckPos = [], deckIdx = [], pierList = [];
    const N = track.N, W = ROAD_HALF + 1.35, D = 1.65;
    let prev = false, base = 0;
    for (let n = 0; n <= N; n++) {
      const i = n % N;
      const th = terrain.heightAt(track.px[i], track.pz[i]);
      const clear = track.py[i] - th;
      const on = n < N && clear > 1.8;
      if (on) {
        const lx = track.lx[i], lz = track.lz[i], x = track.px[i], y = track.py[i] - 0.06, z = track.pz[i];
        const v = deckPos.length / 3;
        // Left top, left bottom, right bottom, right top
        deckPos.push(
          x + lx * W, y, z + lz * W,
          x + lx * (W - 0.35), y - D, z + lz * (W - 0.35),
          x - lx * (W - 0.35), y - D, z - lz * (W - 0.35),
          x - lx * W, y, z - lz * W,
        );
        if (prev && v - base >= 4) {
          // Left fascia, soffit underside, right fascia
          deckIdx.push(
            v - 4, v - 3, v, v - 3, v + 1, v,
            v - 3, v - 2, v + 1, v - 2, v + 2, v + 1,
            v - 2, v - 1, v + 2, v - 1, v + 3, v + 2,
          );
        } else base = v;
        if (i % 22 === 0 && clear > 3.2) {
          const botY = Math.min(th - 1.5, 0), h = (y - D) - botY;
          if (h > 1.5) pierList.push({ x, y: botY + h / 2, z, h, ry: Math.atan2(track.tx[i], track.tz[i]) });
        }
      }
      prev = on;
    }
    const concMat = new THREE.MeshStandardMaterial({ color: 0x3a404c, roughness: 0.82, metalness: 0.1, side: THREE.DoubleSide });
    if (deckPos.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(deckPos, 3));
      g.setIndex(deckIdx); g.computeVertexNormals();
      const m = new THREE.Mesh(g, concMat); m.castShadow = true; m.receiveShadow = true;
      group.add(m);
    }
    if (pierList.length) {
      const pg = new THREE.BoxGeometry(3.4, 1, 2.2);
      const pm = new THREE.InstancedMesh(pg, concMat, pierList.length);
      const d = new THREE.Object3D();
      pierList.forEach((p, k) => {
        d.position.set(p.x, p.y, p.z); d.rotation.set(0, p.ry, 0); d.scale.set(1, p.h, 1);
        d.updateMatrix(); pm.setMatrixAt(k, d.matrix);
      });
      pm.castShadow = true; pm.receiveShadow = true; pm.computeBoundingSphere();
      group.add(pm);
    }
  }

  // 2. Streetlamps along the entire circuit (warm-white LED highway & avenue lamps)
  {
    const poleParts = [
      box(0.16, 8.6, 0.16, 0, 4.3, 0),
      box(2.3, 0.12, 0.14, -1.05, 8.55, 0),
    ];
    const poleGeo = mergeGeometries(poleParts);
    const bulbGeo = box(0.75, 0.14, 0.32, -2.0, 8.44, 0);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x2a303b, roughness: 0.45, metalness: 0.7 });
    const bulbMat = new THREE.MeshBasicMaterial({ color: 0xfff0d4 });
    const list = [];
    for (let i = 8; i < track.N - 8; i += 18) {
      for (const sd of [1, -1]) {
        const off = sd * (ROAD_HALF + 1.15);
        const x = track.px[i] + track.lx[i] * off, z = track.pz[i] + track.lz[i] * off;
        const ry = Math.atan2(-track.lz[i] * sd, track.lx[i] * sd);
        list.push({ x, y: track.py[i] - 0.1, z, ry });
      }
    }
    const pm = new THREE.InstancedMesh(poleGeo, poleMat, list.length);
    const bm = new THREE.InstancedMesh(bulbGeo, bulbMat, list.length);
    const d = new THREE.Object3D();
    list.forEach((it, k) => {
      d.position.set(it.x, it.y, it.z); d.rotation.set(0, it.ry, 0); d.scale.setScalar(1);
      d.updateMatrix(); pm.setMatrixAt(k, d.matrix); bm.setMatrixAt(k, d.matrix);
    });
    pm.computeBoundingSphere(); bm.computeBoundingSphere();
    group.add(pm, bm);
  }

  // 3. Start/Finish Metropolitan Race Arch (s = 0) + Shuto Expressway overhead green direction sign gantries
  const gantrySteel = new THREE.MeshStandardMaterial({ color: 0x333946, roughness: 0.42, metalness: 0.75 });
  {
    const W = ROAD_HALF + 1.85;
    const g = new THREE.Group();
    const frame = mergeGeometries([
      box(0.45, 8.6, 0.55, -W, 4.3, 0), box(0.45, 8.6, 0.55, W, 4.3, 0),
      box(W * 2 + 0.8, 0.42, 0.55, 0, 8.45, 0), box(W * 2 + 0.8, 0.32, 0.55, 0, 6.25, 0),
    ]);
    g.add(new THREE.Mesh(frame, gantrySteel));
    const accent = mergeGeometries([
      box(0.14, 7.2, 0.6, -(W - 0.22), 4.1, 0), box(0.14, 7.2, 0.6, W - 0.22, 4.1, 0),
      box(W * 2, 0.14, 0.62, 0, 8.68, 0),
    ]);
    g.add(new THREE.Mesh(accent, new THREE.MeshBasicMaterial({ color: 0x00e5ff })));
    const sc = canvas(1024, 192), sg = sc.getContext('2d');
    sg.fillStyle = '#0b1020'; sg.fillRect(0, 0, 1024, 192);
    sg.strokeStyle = '#ff2a7f'; sg.lineWidth = 8; sg.strokeRect(10, 10, 1004, 172);
    for (let k = 0; k < 32; k++) { sg.fillStyle = k % 2 ? '#ffffff' : '#151926'; sg.fillRect(18 + k * 31, 18, 31, 20); }
    sg.textAlign = 'center'; sg.textBaseline = 'middle';
    sg.fillStyle = '#ffe14a'; sg.font = '900 54px "Noto Sans JP", "Arial Black", Arial, sans-serif';
    sg.fillText('東京首都高速  ·  SATOYAMA GP', 512, 92);
    sg.fillStyle = '#67e8f9'; sg.font = '800 28px "Arial Black", Arial, sans-serif';
    sg.fillText('START / FINISH  ·  SHUTO EXPRESSWAY', 512, 148);
    const st = makeTex(sc, true, true);
    const sm = new THREE.MeshStandardMaterial({ map: st, emissiveMap: st, emissive: 0xffffff, emissiveIntensity: 1.5, roughness: 0.35, side: THREE.DoubleSide });
    const board = new THREE.Mesh(new THREE.PlaneGeometry(11.4, 2.05), sm);
    board.position.set(0, 7.35, -0.3); board.rotation.y = Math.PI;
    g.add(board);
    const ry0 = Math.atan2(-track.lz[0], track.lx[0]);
    g.position.set(track.px[0], track.py[0] - 0.1, track.pz[0]); g.rotation.y = ry0;
    group.add(g);
    for (const sx of [1, -1]) colliders.add(track.px[0] + track.lx[0] * sx * W, track.pz[0] + track.lz[0] * sx * W, 0.55);
  }

  const signs = C.gantries || [
    [0.08, 'C1', '芝公園 · 六本木', 'SHIBA PARK / ROPPONGI'],
    [0.24, 'B', 'レインボーブリッジ', 'RAINBOW BRIDGE / ODAIBA'],
    [0.54, 'B', 'お台場海浜公園', 'ODAIBA WATERFRONT'],
    [0.82, 'C1', '銀座 · 渋谷方面', 'GINZA / SHIBUYA'],
  ];
  for (const [frac, route, jp, en] of signs) {
    const i = Math.floor(frac * track.N) % track.N;
    const x = track.px[i], y = track.py[i], z = track.pz[i];
    const ry = Math.atan2(-track.lz[i], track.lx[i]);
    const W = ROAD_HALF + 1.55;
    const g = new THREE.Group();
    const frame = mergeGeometries([
      box(0.32, 7.8, 0.32, -W, 3.9, 0), box(0.32, 7.8, 0.32, W, 3.9, 0),
      box(W * 2 + 0.5, 0.32, 0.35, 0, 7.6, 0), box(W * 2 + 0.5, 0.24, 0.35, 0, 6.0, 0),
    ]);
    g.add(new THREE.Mesh(frame, gantrySteel));
    const st = gantrySignTexture(route, jp, en);
    const sm = new THREE.MeshStandardMaterial({ map: st, emissiveMap: st, emissive: 0xffffff, emissiveIntensity: 1.15, roughness: 0.45 });
    const board = new THREE.Mesh(new THREE.PlaneGeometry(10.2, 1.9), sm);
    board.position.set(0, 6.8, -0.22); board.rotation.y = Math.PI;
    g.add(board);
    g.position.set(x, y - 0.1, z); g.rotation.y = ry;
    group.add(g);
  }

  // 4. Skyscrapers, mid-rise city blocks, vertical neon signs & rooftop aviation lights
  const fac1 = buildingFacadeTextures(rng), fac2 = buildingFacadeTextures(rng);
  const neonTex = neonAtlasTexture();
  const matGlass = new THREE.MeshStandardMaterial({
    map: fac1.map, emissiveMap: fac1.emissive, emissive: 0xffffff, emissiveIntensity: 1.85,
    roughness: 0.24, metalness: 0.55, envMapIntensity: 1.35,
  });
  const matMid = new THREE.MeshStandardMaterial({
    map: fac2.map, emissiveMap: fac2.emissive, emissive: 0xffffff, emissiveIntensity: 1.65,
    roughness: 0.55, metalness: 0.25,
  });
  const neonMat = new THREE.MeshBasicMaterial({ map: neonTex });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x151922, roughness: 0.85 });
  const beaconMat = new THREE.MeshBasicMaterial({ color: 0xff2038 });

  const glassGeos = [], midGeos = [], roofGeos = [], neonGeos = [], beaconGeos = [];
  const placed = []; // [x, z, rad] to prevent overlapping buildings

  const okSpot = (x, z, rad, minRoad = ROAD_HALF + 11.5) => {
    if (terrain.distAt(x, z) < minRoad) return false;
    if (terrain.lakeAt(x, z, 1.12)) return false;
    if (C.tower && Math.hypot(x - C.tower.x, z - C.tower.z) < 165 + rad) return false;
    if (C.ferris && Math.hypot(x - C.ferris.x, z - C.ferris.z) < 92 + rad) return false;
    for (let k = 0; k < placed.length; k += 3) {
      const dx = x - placed[k], dz = z - placed[k + 1], rr = rad + placed[k + 2];
      if (dx * dx + dz * dz < rr * rr) return false;
    }
    return true;
  };

  const addBuilding = (x, z, w, d, h, ry, tall, withNeon, addCol) => {
    const y0 = terrain.heightAt(x, z) - 0.6;
    const m4 = new THREE.Matrix4().makeRotationY(ry).setPosition(x, y0, z);
    const uScale = Math.max(1, Math.round(w / 14)), vScale = Math.max(1, Math.round(h / 38));
    const body = uvTileBox(w, h, d, 0, 0, uScale, vScale);
    body.translate(0, h / 2, 0); body.applyMatrix4(m4);
    (tall ? glassGeos : midGeos).push(body);

    // Rooftop mechanical penthouse + red aviation beacon on tall towers
    const pw = w * (0.38 + rng() * 0.22), pd = d * (0.38 + rng() * 0.22), ph = 3 + rng() * 5;
    const pent = box(pw, ph, pd, 0, h + ph / 2, 0); pent.applyMatrix4(m4);
    roofGeos.push(pent);
    if (h > 58) {
      for (const sx of [-1, 1]) {
        const b = box(0.95, 0.95, 0.95, sx * (w * 0.44), h + 0.9, d * 0.44);
        b.applyMatrix4(m4); beaconGeos.push(b);
      }
    }
    // Eye-level vertical street blade signs & facade billboards, plus high rooftop signs
    if (withNeon) {
      const si = Math.floor(rng() * 8), u0 = (si % 4) * 0.25, v0 = Math.floor(si / 4) * 0.5;
      // Street-level projecting vertical blade sign (visible right along the avenue at y = 9..26 m)
      const sh = Math.min(h * 0.55, 13 + rng() * 10), sw = 2.6 + rng() * 1.3;
      const blade = uvTileBox(sw, sh, 0.65, u0 + 0.02, v0 + 0.02, u0 + 0.23, v0 + 0.48);
      blade.translate((rng() < 0.5 ? 1 : -1) * (w * 0.5 + sw * 0.52), Math.min(h - sh * 0.55, 7 + sh * 0.5 + rng() * 6), d * 0.32);
      blade.applyMatrix4(m4); neonGeos.push(blade);
      // Lower-facade street-facing neon billboard at y = 10..24 m or rooftop billboard on mid-rises
      if (rng() < 0.7) {
        const s2 = (si + 3) % 8, bu0 = (s2 % 4) * 0.25, bv0 = Math.floor(s2 / 4) * 0.5;
        const bw = Math.min(w * 0.76, 14.5), bh = bw * 0.48;
        const by = h < 46 ? h + bh * 0.52 : 11 + rng() * 12;
        const bill = uvTileBox(bw, bh, 0.55, bu0 + 0.01, bv0 + 0.01, bu0 + 0.24, bv0 + 0.49);
        bill.translate(0, by, d * 0.5 + 0.28);
        bill.applyMatrix4(m4); neonGeos.push(bill);
      }
    }
    const rad = Math.hypot(w, d) * 0.44;
    placed.push(x, z, rad * 0.88);
    if (addCol) colliders.add(x, z, Math.min(w, d) * 0.48);
  };

  // 4A. Roadside city canyon rows (front row + second taller row behind it)
  const densityK = q.lowq ? 0.65 : 1;
  const stride = Math.max(7, Math.round(9 / densityK));
  for (let i = 0; i < track.N; i += stride) {
    // Skip bridge spans over open water
    if (terrain.lakeAt(track.px[i], track.pz[i], 1.05)) continue;
    for (const sd of [1, -1]) {
      // Front street-wall row
      const w = 13 + rng() * 11, d = 13 + rng() * 11;
      const off = sd * (ROAD_HALF + 9.5 + d * 0.5 + rng() * 4.5);
      const bx = track.px[i] + track.lx[i] * off, bz = track.pz[i] + track.lz[i] * off;
      const rad = Math.hypot(w, d) * 0.46;
      if (okSpot(bx, bz, rad, ROAD_HALF + 8.5)) {
        const downtown = bx < 40;
        const nearTower = C.tower && Math.hypot(bx - C.tower.x, bz - C.tower.z) < 280;
        const h = nearTower ? 18 + rng() * 22 : downtown ? 26 + Math.pow(rng(), 1.35) * 92 : 20 + rng() * 54;
        const ry = Math.atan2(-track.lx[i] * sd, -track.lz[i] * sd);
        addBuilding(bx, bz, w, d, h, ry, h > 52 || rng() < 0.45, rng() < 0.68, true);
      }
      // Second tier of taller skyscrapers behind the street wall
      if (rng() < 0.72) {
        const w2 = 18 + rng() * 16, d2 = 18 + rng() * 16;
        const off2 = sd * (ROAD_HALF + 34 + d2 * 0.5 + rng() * 22);
        const bx2 = track.px[i] + track.lx[i] * off2, bz2 = track.pz[i] + track.lz[i] * off2;
        if (okSpot(bx2, bz2, Math.hypot(w2, d2) * 0.46, ROAD_HALF + 26)) {
          const h2 = 48 + Math.pow(rng(), 1.15) * 125;
          const ry2 = Math.atan2(-track.lx[i] * sd, -track.lz[i] * sd);
          addBuilding(bx2, bz2, w2, d2, h2, ry2, true, rng() < 0.42, false);
        }
      }
    }
  }

  // 4B. Distant Shinjuku / Marunouchi / Hamamatsucho / Toyosu skyline clusters visible across Tokyo Bay
  const clusters = C.clusters || [
    [-620, 120, 320, 52], [-560, -420, 260, 38], [-180, 960, 250, 34],
    [-145, 90, 165, 36], [-150, -250, 155, 28], [920, -60, 210, 26],
  ];
  for (const [cx, cz, radius, count] of clusters) {
    const nWant = Math.round(count * densityK);
    for (let n = 0; n < nWant; n++) {
      const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * radius;
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      const w = 22 + rng() * 22, d = 22 + rng() * 22;
      if (!okSpot(x, z, Math.hypot(w, d) * 0.45, 36)) continue;
      const h = 65 + Math.pow(rng(), 1.1) * 155;
      addBuilding(x, z, w, d, h, rng() * Math.PI * 0.5, true, rng() < 0.3, false);
    }
  }

  const addBatch = (geos, mat, cast = false) => {
    if (!geos.length) return;
    const m = new THREE.Mesh(mergeGeometries(geos), mat);
    m.castShadow = cast; m.receiveShadow = true;
    group.add(m);
  };
  addBatch(glassGeos, matGlass, !q.lowq);
  addBatch(midGeos, matMid, !q.lowq);
  addBatch(roofGeos, roofMat, false);
  addBatch(neonGeos, neonMat, false);
  addBatch(beaconGeos, beaconMat, false);

  // 5. Landmarks: Tokyo Tower, Rainbow Suspension Bridge, Odaiba Ferris Wheel
  if (C.tower) group.add(buildTokyoTower(C.tower.x, terrain.heightAt(C.tower.x, C.tower.z) - 0.5, C.tower.z));
  if (C.bridge) group.add(buildSuspensionBridge(track, terrain, C.bridge));
  if (C.ferris) group.add(buildFerrisWheel(C.ferris.x, terrain.heightAt(C.ferris.x, C.ferris.z) - 0.5, C.ferris.z, C.ferris.ry || 0));

  return group;
}
