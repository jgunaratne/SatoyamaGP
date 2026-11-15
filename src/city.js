import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32, gTime } from './util.js';
import { ROAD_HALF } from './track.js';
import { scatter, nightGlow } from './models.js';
import { loadTexture } from './textures.js';

function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function box(w, h, d, x = 0, y = 0, z = 0) { const g = new THREE.BoxGeometry(w, h, d); if (x || y || z) g.translate(x, y, z); return g; }

function makeTex(c, srgb = true, clampEdge = false) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = clampEdge ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Box whose four walls repeat a facade map at real-world scale (one tile = tw x th metres); the roof samples one texel.
function facadeBox(w, h, d, tw, th, uo = 0, vo = 0) {
  const g = new THREE.BoxGeometry(w, h, d), uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    const f = i >> 2;   // BoxGeometry: 4 vertices per face, in the order +x, -x, +y, -y, +z, -z
    if (f === 2 || f === 3) uv.setXY(i, uo, vo);
    else uv.setXY(i, uo + uv.getX(i) * (f < 2 ? d : w) / tw, vo + uv.getY(i) * h / th);
  }
  return g;
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

export function buildCity(scene, track, terrain, colliders, level, q = {}, models = null) {
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

    // Warm pool of light on the asphalt under every lamp (an additive decal laid along the road's slope).
    const pc = canvas(64, 64), pg2 = pc.getContext('2d'), gr = pg2.createRadialGradient(32, 32, 2, 32, 32, 31);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.45, 'rgba(255,255,255,.42)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    pg2.fillStyle = gr; pg2.fillRect(0, 0, 64, 64);
    const poolGeo = new THREE.PlaneGeometry(7, 13); poolGeo.rotateX(-Math.PI / 2);
    const poolMat = new THREE.MeshBasicMaterial({ map: makeTex(pc, true, true), color: 0xffd9a8, transparent: true, opacity: 0.17, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const pools = new THREE.InstancedMesh(poolGeo, poolMat, list.length);
    const vl = new THREE.Vector3(), vt = new THREE.Vector3(), vn = new THREE.Vector3(), m4 = new THREE.Matrix4();
    let k = 0;
    for (let i = 8; i < track.N - 8; i += 18) {
      const a = (i + 1) % track.N, b = (i - 1 + track.N) % track.N;
      vt.set(track.tx[i], (track.py[a] - track.py[b]) / (2 * track.ds), track.tz[i]).normalize();
      for (const sd of [1, -1]) {
        vl.set(track.lx[i], 0, track.lz[i]); vn.crossVectors(vt, vl).normalize(); vl.crossVectors(vn, vt);
        const off = sd * (ROAD_HALF - 2.4);
        m4.makeBasis(vl, vn, vt).setPosition(track.px[i] + track.lx[i] * off, track.py[i] + 0.035, track.pz[i] + track.lz[i] * off);
        pools.setMatrixAt(k++, m4);
      }
    }
    pools.renderOrder = 1; pools.computeBoundingSphere();
    group.add(pools);
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

  // 4. City blocks. The street walls and the towers behind them are TRELLIS.2 buildings generated from night-time
  //    concepts (lit windows and signs are in their textures; see nightGlow in models.js). The far skyline clusters,
  //    and every building when models are off, are boxes skinned with gemini-image facade maps.
  const M = (id) => (models ? models.get(id) : null);
  const kinds = (rows) => rows.map(([id, h0, h1, wt]) => ({ id, m: M(id), h0, h1, wt, list: [] })).filter((k) => k.m);
  const STREET = kinds([
    ['city_zakkyo_a', 30, 38, 3], ['city_zakkyo_b', 38, 48, 3], ['city_office_a', 46, 60, 2], ['city_dept', 40, 50, 2],
    ['city_apartment', 48, 60, 2], ['city_konbini', 5.0, 5.6, 1],
  ]);
  const TOWERS = kinds([['city_tower_a', 150, 215, 1], ['city_tower_b', 135, 190, 1], ['city_tower_c', 115, 160, 1]]);
  const useModels = STREET.length >= 3 && TOWERS.length >= 1;
  const pick = (set, not) => {
    const pool = set.length > 1 ? set.filter((k) => k !== not) : set;
    let r = rng() * pool.reduce((a, k) => a + k.wt, 0);
    for (const k of pool) { if (r < k.wt) return k; r -= k.wt; }
    return pool[pool.length - 1];
  };

  // facade map -> [material key, tile width, tile height] in metres
  const TILE = { glass: [43, 40], office: [25, 44], apartment: [24, 30] };
  const facades = { glass: [], office: [], apartment: [] };
  const retailGeos = [], roofGeos = [], neonGeos = [], beaconGeos = [], frameGeos = [], screenGeos = [[], [], [], []];
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

  // Procedural block: facade-mapped box, roof slab and plant room, optional shopfront strip on the street side (+Z).
  const addBox = (x, z, w, d, h, ry, kind, street) => {
    const y0 = terrain.heightAt(x, z) - 0.6, m4 = new THREE.Matrix4().makeRotationY(ry).setPosition(x, y0, z);
    const T = TILE[kind], body = facadeBox(w, h, d, T[0], T[1], Math.floor(rng() * 4), Math.floor(rng() * 4));
    body.translate(0, h / 2, 0); body.applyMatrix4(m4); facades[kind].push(body);
    const slab = box(w + 0.7, 0.8, d + 0.7, 0, h + 0.4, 0); slab.applyMatrix4(m4); roofGeos.push(slab);
    const pw = w * (0.38 + rng() * 0.22), pd = d * (0.38 + rng() * 0.22), ph = 3 + rng() * 5;
    const pent = box(pw, ph, pd, 0, h + 0.8 + ph / 2, 0); pent.applyMatrix4(m4); roofGeos.push(pent);
    if (h > 58) for (const sx of [-1, 1]) { const b = box(0.95, 0.95, 0.95, sx * (w * 0.44), h + 1.3, d * 0.44); b.applyMatrix4(m4); beaconGeos.push(b); }
    if (street) {
      const shop = new THREE.PlaneGeometry(w, 5.4), uv = shop.attributes.uv, u0 = Math.floor(rng() * 5) * 0.2;
      for (let i = 0; i < uv.count; i++) uv.setX(i, u0 + uv.getX(i) * (w / 17.6));
      shop.translate(0, 0.6 + 2.7, d / 2 + 0.07); shop.applyMatrix4(m4); retailGeos.push(shop);
    }
  };

  // Signs every street building can carry: a projecting neon blade (canvas-drawn, real Japanese) and a rooftop LED screen (gemini-image art).
  const addSigns = (x, z, w, d, h, ry) => {
    const m4 = new THREE.Matrix4().makeRotationY(ry).setPosition(x, terrain.heightAt(x, z) - 0.25, z);
    if (rng() < 0.55) {
      const si = Math.floor(rng() * 8), u0 = (si % 4) * 0.25, v0 = Math.floor(si / 4) * 0.5;
      const sh = Math.min(h * 0.5, 9 + rng() * 9), sw = 2.4 + rng() * 1.2;
      const blade = uvTileBox(0.5, sh, sw, u0 + 0.02, v0 + 0.02, u0 + 0.23, v0 + 0.48);
      blade.translate((rng() < 0.5 ? 1 : -1) * w * 0.42, Math.min(h - sh * 0.55, 6 + sh * 0.5 + rng() * 5), d * 0.5 + sw * 0.5 + 0.25);
      blade.applyMatrix4(m4); neonGeos.push(blade);
    }
    if (h < 64 && rng() < 0.24) {
      const bw = Math.min(w * 0.8, 15), bh = bw * 0.56, k = Math.floor(rng() * 4);
      const scr = uvTileBox(bw, bh, 0.5, 0, 0, 1, 1); scr.translate(0, h + 1.6 + bh / 2, d * 0.3); scr.applyMatrix4(m4); screenGeos[k].push(scr);
      const fr = mergeGeometries([box(bw + 0.5, bh + 0.5, 0.3, 0, h + 1.6 + bh / 2, d * 0.3 - 0.3), box(0.3, 1.8, 0.3, -bw * 0.35, h + 0.8, d * 0.3 - 0.3), box(0.3, 1.8, 0.3, bw * 0.35, h + 0.8, d * 0.3 - 0.3)]);
      fr.applyMatrix4(m4); frameGeos.push(fr);
    }
  };

  // 4A. Street walls: buildings set shoulder to shoulder along both sides of the road, fronts (+Z) facing it.
  const N = track.N, ds = track.ds, densityK = q.lowq ? 0.7 : 1;
  for (const sd of [1, -1]) {
    let i = sd > 0 ? 4 : 11, last = null;
    while (i < N - 4) {
      if (terrain.lakeAt(track.px[i], track.pz[i], 1.05)) { i += 5; continue; }
      let k = null, w, d, h, s = 1;
      if (useModels) { k = last = pick(STREET, last); h = k.h0 + rng() * (k.h1 - k.h0); s = h / k.m.size.y; w = k.m.size.x * s; d = k.m.size.z * s; }
      else { w = 17 + rng() * 15; d = 14 + rng() * 10; h = track.px[i] < 40 ? 26 + Math.pow(rng(), 1.35) * 70 : 20 + rng() * 44; }
      const j = Math.min(N - 1, i + Math.round((w * 0.5) / ds));
      const off = sd * (ROAD_HALF + 7 + rng() * 3 + d * 0.5);
      const bx = track.px[j] + track.lx[j] * off, bz = track.pz[j] + track.lz[j] * off, rad = Math.min(w, d) * 0.5;
      if (!okSpot(bx, bz, rad, ROAD_HALF + 5.5 + d * 0.5)) { i += 4; continue; }
      const ry = Math.atan2(-track.lx[j] * sd, -track.lz[j] * sd);
      if (k) k.list.push({ x: bx, y: terrain.heightAt(bx, bz) - 0.25, z: bz, ry, s, sy: s * (0.96 + rng() * 0.1) });
      else addBox(bx, bz, w, d, h, ry, h > 52 ? 'glass' : rng() < 0.5 ? 'office' : 'apartment', true);
      if (h > 12) addSigns(bx, bz, w, d, h, ry);
      placed.push(bx, bz, rad * 0.95);
      for (const o of w > d * 1.4 ? [-(w - d) / 2, 0, (w - d) / 2] : [0]) colliders.add(bx + track.tx[j] * o, bz + track.tz[j] * o, Math.min(w, d) * 0.5);
      i = j + Math.max(2, Math.round((w * 0.5 + (1.5 + rng() * 4.5) / densityK) / ds));
    }
  }

  // 4B. Second tier: skyscrapers standing behind the street wall.
  for (let i = 0; i < N; i += Math.round(44 / ds / densityK)) {
    if (terrain.lakeAt(track.px[i], track.pz[i], 1.05)) continue;
    for (const sd of [1, -1]) {
      const downtown = track.px[i] < 40;
      if (rng() > (downtown ? 0.85 : 0.5)) continue;
      let k = null, w, d, h, s = 1;
      if (useModels) { k = pick(TOWERS, null); h = (k.h0 + rng() * (k.h1 - k.h0)) * (downtown ? 1 : 0.8); s = h / k.m.size.y; w = k.m.size.x * s; d = k.m.size.z * s; }
      else { w = 20 + rng() * 16; d = 20 + rng() * 16; h = 60 + Math.pow(rng(), 1.15) * 120; }
      const off = sd * (ROAD_HALF + 52 + d * 0.5 + rng() * 44);
      const bx = track.px[i] + track.lx[i] * off, bz = track.pz[i] + track.lz[i] * off, rad = Math.hypot(w, d) * 0.42;
      if (!okSpot(bx, bz, rad, ROAD_HALF + 40 + d * 0.5)) continue;
      const ry = Math.atan2(-track.lx[i] * sd, -track.lz[i] * sd) + Math.floor(rng() * 4) * (Math.PI / 2);
      if (k) k.list.push({ x: bx, y: terrain.heightAt(bx, bz) - 0.4, z: bz, ry, s, sy: s });
      else addBox(bx, bz, w, d, h, ry, 'glass', false);
      placed.push(bx, bz, rad);
    }
  }
  // Beyond the switch distance each building is a 10-triangle box impostor baked from the same texture (build_models.mjs).
  for (const k of [...STREET, ...TOWERS]) group.add(scatter(k.m, k.list, { cell: 110, dist: [300], cast: 2 }));

  // 4C. Street furniture: vending machines glowing on the pavement and taxis parked at the kerb (ground-level streets only).
  {
    const vend = M('city_vending'), taxi = M('city_taxi'), vendItems = [], taxiItems = [];
    const atGrade = (i, x, z) => track.py[i] - terrain.heightAt(x, z) < 0.7 && !terrain.lakeAt(x, z, 1.1);
    for (let i = 30; i < N - 30; i += Math.round(64 / ds)) {
      const sd = rng() < 0.5 ? 1 : -1, j = i + Math.floor(rng() * 12);
      if (vend) {
        const off = sd * (ROAD_HALF + 5.9), x = track.px[j] + track.lx[j] * off, z = track.pz[j] + track.lz[j] * off;
        if (atGrade(j, x, z)) { vendItems.push({ x, y: terrain.heightAt(x, z) - 0.03, z, ry: Math.atan2(-track.lx[j] * sd, -track.lz[j] * sd), s: 1.95 / vend.size.y }); colliders.add(x, z, 1.1); }
      }
      if (taxi && rng() < 0.6) {
        const jj = (j + 14) % N, off = -sd * (ROAD_HALF + 2.75), x = track.px[jj] + track.lx[jj] * off, z = track.pz[jj] + track.lz[jj] * off;
        if (atGrade(jj, x, z)) { taxiItems.push({ x, y: terrain.heightAt(x, z) - 0.02, z, ry: Math.atan2(track.tx[jj], track.tz[jj]), s: 4.7 / Math.max(taxi.size.x, taxi.size.z) }); colliders.add(x, z, 1.5); }
      }
    }
    if (vend) group.add(scatter(vend, vendItems, { cell: 60, dist: [90, 260], far: 700, cast: 1 }));
    if (taxi) group.add(scatter(taxi, taxiItems, { cell: 60, dist: [110, 300], far: 800, cast: 1 }));
  }

  // 4D. Distant Shinjuku / Marunouchi / Hamamatsucho / Toyosu skyline clusters visible across Tokyo Bay
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
      addBox(x, z, w, d, h, rng() * Math.PI * 0.5, rng() < 0.6 ? 'glass' : rng() < 0.6 ? 'office' : 'apartment', false);
      placed.push(x, z, Math.hypot(w, d) * 0.4);
    }
  }

  const addBatch = (geos, mat, cast = false) => {
    if (!geos.length) return;
    const m = new THREE.Mesh(mergeGeometries(geos), mat);
    m.castShadow = cast; m.receiveShadow = true;
    group.add(m);
  };
  const facadeMat = (file, roughness, metalness) => nightGlow(new THREE.MeshStandardMaterial({ map: loadTexture(`city/${file}.webp`), roughness, metalness, envMapIntensity: 1.3 }), 0.2, 0.55, 2.1);
  addBatch(facades.glass, facadeMat('facade_glass', 0.26, 0.5), !q.lowq);
  addBatch(facades.office, facadeMat('facade_office', 0.6, 0.15), !q.lowq);
  addBatch(facades.apartment, facadeMat('facade_apartment', 0.7, 0.05), !q.lowq);
  addBatch(retailGeos, nightGlow(new THREE.MeshStandardMaterial({ map: loadTexture('city/facade_retail.webp'), roughness: 0.5 }), 0.12, 0.5, 2.4));
  addBatch(roofGeos, new THREE.MeshStandardMaterial({ color: 0x151922, roughness: 0.85 }));
  addBatch(frameGeos, new THREE.MeshStandardMaterial({ color: 0x1a1e27, roughness: 0.6, metalness: 0.5 }));
  addBatch(neonGeos, new THREE.MeshBasicMaterial({ map: neonAtlasTexture() }));
  addBatch(beaconGeos, new THREE.MeshBasicMaterial({ color: 0xff2038 }));
  ['a', 'b', 'c', 'd'].forEach((n, k) => addBatch(screenGeos[k], new THREE.MeshBasicMaterial({ map: loadTexture(`city/billboard_${n}.webp`, { wrap: THREE.ClampToEdgeWrapping }), color: 0xd8d8d8 })));

  // 5. Landmarks: Tokyo Tower, Rainbow Suspension Bridge, Odaiba Ferris Wheel
  if (C.tower) {
    const lt = q.models === 'full' ? M('city_lattice_tower') : null, ty = terrain.heightAt(C.tower.x, C.tower.z) - 0.5;
    if (lt) group.add(scatter(lt, [{ x: C.tower.x, y: ty, z: C.tower.z, ry: 0, s: 333 / lt.size.y }], { cell: 4000, dist: [1e6], cast: 0 }));
    else group.add(buildTokyoTower(C.tower.x, ty, C.tower.z));
  }
  if (C.bridge) group.add(buildSuspensionBridge(track, terrain, C.bridge));
  if (C.ferris) group.add(buildFerrisWheel(C.ferris.x, terrain.heightAt(C.ferris.x, C.ferris.z) - 0.5, C.ferris.z, C.ferris.ry || 0));

  return group;
}
