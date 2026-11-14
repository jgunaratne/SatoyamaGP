import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SHADOW_ONLY } from './models.js';

export const WHEEL_R = 0.33, WHEEL_X = 0.83, WHEEL_Z = 1.38;
const HALF_LEN = 2.3;

// 1D Catmull-Rom through (z, value) keys.
function spline(keys) {
  const n = keys.length;
  return (z) => {
    if (z <= keys[0][0]) return keys[0][1];
    if (z >= keys[n - 1][0]) return keys[n - 1][1];
    let i = 0; while (z > keys[i + 1][0]) i++;
    const [z0, v0] = keys[i], [z1, v1] = keys[i + 1], h = z1 - z0, t = (z - z0) / h;
    const m0 = i > 0 ? (v1 - keys[i - 1][1]) / (z1 - keys[i - 1][0]) : (v1 - v0) / h;
    const m1 = i < n - 2 ? (keys[i + 2][1] - v0) / (keys[i + 2][0] - z0) : (v1 - v0) / h;
    const t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * v0 + (t3 - 2 * t2 + t) * h * m0 + (-2 * t3 + 3 * t2) * v1 + (t3 - t2) * h * m1;
  };
}

// Side-profile curves of a low fastback coupe (z forward, y up, metres).
const yTopF = spline([[-2.3, 0.8], [-2.0, 0.93], [-1.5, 0.97], [-0.6, 0.93], [0.6, 0.91], [1.0, 0.88], [1.6, 0.82], [2.1, 0.67], [2.3, 0.52]]);
const cabS = spline([[-1.95, 0], [-1.6, 0.0], [-0.95, 0.24], [-0.35, 0.35], [0.1, 0.35], [0.45, 0.25], [0.98, 0], [1.2, 0]]);
const cabF = (z) => Math.max(0, cabS(z));
const wF = spline([[-2.3, 0.72], [-2.1, 0.89], [-1.4, 0.97], [-0.5, 0.93], [0.6, 0.93], [1.4, 0.96], [2.0, 0.89], [2.2, 0.8], [2.3, 0.68]]);
function bottomF(z) {
  let b = 0.17;
  if (z > 1.95) b += ((z - 1.95) / 0.35) * 0.08;
  if (z < -1.9) b += ((-1.9 - z) / 0.4) * 0.16;
  for (const wz of [WHEEL_Z, -WHEEL_Z]) {
    const d = z - wz, R = 0.41;
    if (Math.abs(d) < R) b = Math.max(b, WHEEL_R + Math.sqrt(R * R - d * d));
  }
  return b;
}

const SUB = 4, NCTRL = 10, M = (NCTRL - 1) * SUB + 1;

function section(z) {
  const w = wF(z), yb = bottomF(z), yt = Math.max(yTopF(z), yb + 0.06), cab = cabF(z), hgt = yt - yb;
  const k = THREE.MathUtils.smoothstep(cab, 0, 0.22);
  const wcb = w - 0.19, wcr = THREE.MathUtils.lerp(w * 0.55, 0.6 * (w / 0.93), k);
  const P = [
    [0, yb], [w - 0.1, yb], [w, yb + Math.min(0.1, hgt * 0.3)], [w + 0.015, yb + hgt * 0.55],
    [w - 0.03, yt - Math.min(0.05, hgt * 0.2)], [w - 0.12, yt], [wcb, yt + 0.012 + cab * 0.04],
    [wcr, yt + cab + 0.022 - 0.04 * k], [wcr * 0.5, yt + cab + 0.032], [0, yt + cab + 0.037],
  ];
  // rounded nose / tail
  const e = THREE.MathUtils.clamp((Math.abs(z) - (HALF_LEN - 0.13)) / 0.13, 0, 1), f = Math.sqrt(Math.max(0, 1 - e * e));
  const yc = (yb + yt) / 2;
  const out = [];
  for (let s = 0; s < NCTRL - 1; s++) {
    const p0 = P[Math.max(0, s - 1)], p1 = P[s], p2 = P[s + 1], p3 = P[Math.min(NCTRL - 1, s + 2)];
    for (let u = 0; u < SUB + (s === NCTRL - 2 ? 1 : 0); u++) {
      const t = u / SUB, t2 = t * t, t3 = t2 * t, pt = [0, 0];
      for (let c = 0; c < 2; c++) {
        pt[c] = 0.5 * (2 * p1[c] + (-p0[c] + p2[c]) * t + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * t2 + (-p0[c] + 3 * p1[c] - 3 * p2[c] + p3[c]) * t3);
      }
      out.push([Math.max(0, pt[0]) * f, yc + (pt[1] - yc) * f]);
    }
  }
  out[0][0] = 0; out[M - 1][0] = 0;
  return out;
}

function buildBodyGeometry() {
  const NS = 128, pos = [], paint = [], glass = [];
  const zs = [];
  for (let i = 0; i < NS; i++) {
    const q = (i / (NS - 1)) * 2 - 1, z = HALF_LEN * q * (1.5 - 0.5 * q * q);
    zs.push(z);
    for (const p of section(z)) pos.push(p[0], p[1], z);
  }
  const half = NS * M;
  for (let i = 0; i < half; i++) pos.push(-pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
  for (let i = 0; i < NS - 1; i++) {
    const z = (zs[i] + zs[i + 1]) / 2, cab = cabF(z);
    for (let j = 0; j < M - 1; j++) {
      const seg = Math.floor(j / SUB);
      let isGlass = false;
      if (seg === 6 && cab > 0.13 && z > -1.12 && z < 0.6 && j % SUB > 0) isGlass = true;        // side windows
      if (j >= 7 * SUB + 1 && z > 0.36 && z < 0.9) isGlass = true;                               // windscreen
      if (j >= 7 * SUB + 1 && z > -1.38 && z < -0.5) isGlass = true;                             // rear screen
      const a = i * M + j, b = a + M, c = a + 1, d = b + 1, t = isGlass ? glass : paint;
      t.push(a, c, b, b, c, d);
      t.push(a + half, b + half, c + half, b + half, d + half, c + half);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex([...paint, ...glass]);
  g.addGroup(0, paint.length, 0);
  g.addGroup(paint.length, glass.length, 1);
  g.computeVertexNormals();
  // weld the centreline shading
  const n = g.attributes.normal, p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    if (Math.abs(p.getX(i)) < 1e-5) { v.set(0, n.getY(i), n.getZ(i)); if (v.lengthSq() < 1e-8) v.set(0, 0, Math.sign(p.getZ(i))); v.normalize(); n.setXYZ(i, v.x, v.y, v.z); }
  }
  return g;
}

function buildWheelGeometry() {
  const prof = [[0.232, -0.13], [0.3, -0.137], [0.322, -0.115], [0.33, -0.07], [0.33, 0.07], [0.322, 0.115], [0.3, 0.137], [0.232, 0.13]]
    .map(([r, x]) => new THREE.Vector2(r, x));
  const tire = new THREE.LatheGeometry(prof, 36); tire.rotateZ(-Math.PI / 2);
  const rim = [];
  const barrel = new THREE.CylinderGeometry(0.236, 0.236, 0.25, 36, 1, true); barrel.rotateZ(Math.PI / 2); rim.push(barrel);
  const lip = new THREE.TorusGeometry(0.228, 0.014, 8, 36); lip.rotateY(Math.PI / 2); lip.translate(0.125, 0, 0); rim.push(lip);
  const hub = new THREE.CylinderGeometry(0.06, 0.075, 0.07, 16); hub.rotateZ(-Math.PI / 2); hub.translate(0.1, 0, 0); rim.push(hub);
  for (let s = 0; s < 10; s++) {
    const a = (Math.floor(s / 2) / 5) * Math.PI * 2 + (s % 2 ? 0.17 : -0.17);
    const sp = new THREE.BoxGeometry(0.03, 0.2, 0.026); sp.translate(0.1, 0.135, 0);
    sp.rotateX(a); rim.push(sp);
  }
  const back = new THREE.CylinderGeometry(0.23, 0.23, 0.02, 24); back.rotateZ(Math.PI / 2); back.translate(-0.1, 0, 0); rim.push(back);
  const disc = new THREE.CylinderGeometry(0.19, 0.19, 0.025, 28); disc.rotateZ(Math.PI / 2); disc.translate(0.03, 0, 0);
  const caliper = new THREE.BoxGeometry(0.07, 0.1, 0.17); caliper.translate(0.045, 0.06, -0.15);
  return { tire, rim: mergeGeometries(rim), disc, caliper };
}

let shared = null;
function getShared() {
  if (shared) return shared;
  const sc = document.createElement('canvas'); sc.width = sc.height = 128;
  const g = sc.getContext('2d'), gr = g.createRadialGradient(64, 64, 8, 64, 64, 64);
  gr.addColorStop(0, 'rgba(0,0,0,.7)'); gr.addColorStop(0.6, 'rgba(0,0,0,.32)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  const gc = document.createElement('canvas'); gc.width = 128; gc.height = 64;
  const gg = gc.getContext('2d'), ggr = gg.createRadialGradient(64, 32, 2, 64, 32, 62);
  ggr.addColorStop(0, 'rgba(255,255,255,1)'); ggr.addColorStop(0.35, 'rgba(255,255,255,.45)'); ggr.addColorStop(1, 'rgba(255,255,255,0)');
  gg.fillStyle = ggr; gg.save(); gg.translate(0, 16); gg.scale(1, 0.5); gg.fillRect(0, 0, 128, 64); gg.restore();
  shared = {
    glow: new THREE.CanvasTexture(gc),
    body: buildBodyGeometry(), wheel: buildWheelGeometry(),
    glass: new THREE.MeshPhysicalMaterial({ color: 0x06090c, roughness: 0.04, metalness: 0.0, clearcoat: 1, envMapIntensity: 1.6 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x0b0b0c, roughness: 0.6, metalness: 0.2 }),
    tire: new THREE.MeshStandardMaterial({ color: 0x0c0c0d, roughness: 0.88 }),
    rim: new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.22, metalness: 1 }),
    disc: new THREE.MeshStandardMaterial({ color: 0x4b4b4e, roughness: 0.45, metalness: 0.9 }),
    caliper: new THREE.MeshStandardMaterial({ color: 0xe6c21c, roughness: 0.4 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.12, metalness: 1 }),
    head: new THREE.MeshStandardMaterial({ color: 0x8899aa, emissive: 0xdfeaff, emissiveIntensity: 5, roughness: 0.2 }),
    blob: new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(sc), transparent: true, depthWrite: false, fog: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
  };
  return shared;
}

// Car built around a TRELLIS.2 scanned-style body (wheels are part of the mesh), scaled to the physics wheelbase.
function buildModelCar(model, S) {
  const group = new THREE.Group(), body = new THREE.Group();
  group.add(body);
  const s = (HALF_LEN * 2) / model.size.z, W = model.size.x * s, H = model.size.y * s;
  const lod = new THREE.LOD();
  model.levels.forEach((l, n) => {
    const m = new THREE.Mesh(l.geo, l.mat); m.scale.setScalar(s); m.receiveShadow = true;
    m.castShadow = model.levels.length === 1 || n > 0;
    lod.addLevel(m, n * 160);
  });
  body.add(lod);
  if (model.levels.length > 1) {   // the simplified level casts the shadow for the 190k-triangle body
    const p = new THREE.Mesh(model.levels[1].geo, SHADOW_ONLY); p.scale.setScalar(s); p.castShadow = true;
    lod.levels[1].object.castShadow = false; body.add(p);
  }
  // brake lights: soft additive glows over the model's tail lamps
  const tail = new THREE.MeshBasicMaterial({ map: S.glow, color: 0xd81004, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 });
  for (const sx of [1, -1]) {
    const g = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.3), tail);
    g.position.set(sx * W * 0.31, H * 0.58, -HALF_LEN - 0.03); g.rotation.y = Math.PI;
    body.add(g);
  }
  Object.defineProperty(tail, 'emissiveIntensity', { set(v) { tail.opacity = v > 5 ? 0.8 : 0.0; }, get() { return 0; } });
  const wheels = [];
  for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    const pivot = new THREE.Group(); pivot.position.set(sx * WHEEL_X, WHEEL_R, sz * WHEEL_Z);
    const spin = new THREE.Group(); pivot.add(spin); group.add(pivot);
    wheels.push({ pivot, spin, front: sz > 0 });
  }
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(W + 0.5, 5.0), S.blob);
  blob.rotation.x = -Math.PI / 2; blob.position.y = 0.035; blob.renderOrder = 2;
  group.add(blob);
  return { group, body, wheels, tail, paint: model.levels[0].mat };
}

export function buildCar(color, model = null) {
  const S = getShared();
  if (model) return buildModelCar(model, S);
  const group = new THREE.Group(), body = new THREE.Group();
  group.add(body);
  const paint = new THREE.MeshPhysicalMaterial({ color, roughness: 0.34, metalness: 0.55, clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 1.25 });
  const tail = new THREE.MeshStandardMaterial({ color: 0x2a0303, emissive: 0xff1508, emissiveIntensity: 1.6, roughness: 0.3 });
  const add = (geo, mat, x = 0, y = 0, z = 0, parent = body) => {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m;
  };
  add(S.body, [paint, S.glass]);
  // underbody + inner arches
  add(new THREE.BoxGeometry(1.3, 0.5, 3.7), S.dark, 0, 0.44, 0);
  // aero
  add(new THREE.BoxGeometry(1.62, 0.03, 0.34), S.dark, 0, 0.19, 2.08);
  add(new THREE.BoxGeometry(1.5, 0.12, 0.5), S.dark, 0, 0.27, -2.03);
  for (const sx of [1, -1]) {
    add(new THREE.BoxGeometry(0.06, 0.07, 1.75), S.dark, sx * 0.93, 0.19, 0);
    // mirrors
    const mir = add(new THREE.SphereGeometry(0.085, 12, 8), paint, sx * 0.99, yTopF(0.6) + 0.1, 0.62); mir.scale.set(1.25, 0.7, 0.75);
    add(new THREE.BoxGeometry(0.16, 0.025, 0.05), S.dark, sx * 0.9, yTopF(0.6) + 0.06, 0.62);
    // headlights
    const hl = add(new THREE.SphereGeometry(0.1, 14, 8), S.head, sx * 0.6, yTopF(2.02) + 0.005, 2.02); hl.scale.set(2.1, 0.42, 1.9); hl.rotation.y = sx * 0.35;
    // wing stands
    add(new THREE.BoxGeometry(0.03, 0.14, 0.14), S.dark, sx * 0.48, yTopF(-2.0) + 0.06, -2.02);
    // exhaust tips
    const ex = add(new THREE.CylinderGeometry(0.048, 0.048, 0.16, 12), S.chrome, sx * 0.42, 0.3, -2.25); ex.rotation.x = Math.PI / 2;
  }
  add(new THREE.BoxGeometry(1.56, 0.028, 0.26), paint, 0, yTopF(-2.0) + 0.135, -2.06);       // ducktail wing
  add(new THREE.BoxGeometry(1.0, 0.11, 0.07), S.dark, 0, 0.37, 2.265);                         // grille
  add(new THREE.BoxGeometry(1.2, 0.045, 0.06), tail, 0, 0.7, -2.262);                         // light bar
  add(new THREE.BoxGeometry(0.42, 0.11, 0.03), new THREE.MeshStandardMaterial({ color: 0xe8e8e0, roughness: 0.5 }), 0, 0.5, -2.285);

  const wheels = [];
  for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    const pivot = new THREE.Group(); pivot.position.set(sx * WHEEL_X, WHEEL_R, sz * WHEEL_Z);
    const spin = new THREE.Group(); pivot.add(spin);
    const t = add(S.wheel.tire, S.tire, 0, 0, 0, spin), r = add(S.wheel.rim, S.rim, 0, 0, 0, spin);
    const d = add(S.wheel.disc, S.disc, 0, 0, 0, spin), c = add(S.wheel.caliper, S.caliper, 0, 0, 0, pivot);
    for (const m of [t, r, d, c]) m.scale.x = sx;
    group.add(pivot);
    wheels.push({ pivot, spin, front: sz > 0 });
  }
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(2.35, 5.0), S.blob);
  blob.rotation.x = -Math.PI / 2; blob.position.y = 0.035; blob.renderOrder = 2;
  group.add(blob);
  return { group, body, wheels, tail, paint };
}
