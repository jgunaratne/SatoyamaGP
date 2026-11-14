import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32, fbm, vnoise, gTime } from './util.js';
import { ROAD_HALF } from './track.js';
import { SHOULDER_W, SHOULDER_DROP } from './terrain.js';

const rng = mulberry32(4242);

function paint(geo, fn) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const p = g.attributes.position, c = new Float32Array(p.count * 3), col = [0, 0, 0];
  for (let i = 0; i < p.count; i++) { fn(p.getX(i), p.getY(i), p.getZ(i), col, i); c.set(col, i * 3); }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}

// Spatially chunked instancing so frustum culling can drop whole groves.
function chunked(geo, mat, items, cell, cast) {
  const groups = new Map(), out = new THREE.Group(), d = new THREE.Object3D(), col = new THREE.Color();
  for (const it of items) {
    const k = Math.floor(it.x / cell) + ',' + Math.floor(it.z / cell);
    let a = groups.get(k); if (!a) groups.set(k, (a = []));
    a.push(it);
  }
  for (const arr of groups.values()) {
    const m = new THREE.InstancedMesh(geo, mat, arr.length);
    arr.forEach((it, i) => {
      d.position.set(it.x, it.y, it.z); d.rotation.set(0, it.ry || 0, 0);
      d.scale.set(it.s || 1, it.sy || it.s || 1, it.s || 1); d.updateMatrix();
      m.setMatrixAt(i, d.matrix);
      if (it.c) m.setColorAt(i, col.setRGB(it.c[0], it.c[1], it.c[2]));
    });
    m.castShadow = cast; m.receiveShadow = false;
    m.computeBoundingSphere();
    out.add(m);
  }
  return out;
}

function cedarGeometry() {
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.22, 0.42, 6, 5, 1, true); trunk.translate(0, 3, 0);
  parts.push(paint(trunk, (x, y, z, c) => { c[0] = 0.13; c[1] = 0.08; c[2] = 0.05; }));
  const tiers = [[3.3, 6.5, 3.5], [2.8, 6, 7], [2.2, 5.5, 10.5], [1.5, 5, 14], [0.85, 4, 17.2]];
  for (const [r, h, y] of tiers) {
    const cone = new THREE.ConeGeometry(r, h, 7, 1, true);
    cone.translate(0, y + h / 2, 0);
    parts.push(paint(cone, (x, yy, z, c) => {
      const t = (yy - y) / h, rim = Math.hypot(x, z) / r;
      const k = 0.55 + 0.6 * t + 0.25 * rim;
      c[0] = 0.028 * k; c[1] = 0.085 * k; c[2] = 0.035 * k;
    }));
  }
  return mergeGeometries(parts);
}

function blossomGeometry(detail) {
  const parts = [];
  const add = (r0, r1, len, px, py, pz, rx, rz) => {
    const g = new THREE.CylinderGeometry(r0, r1, len, 7); g.translate(0, len / 2, 0);
    g.rotateX(rx); g.rotateZ(rz); g.translate(px, py, pz);
    parts.push(paint(g, (x, y, z, c) => { c[0] = 0.09; c[1] = 0.06; c[2] = 0.05; }));
  };
  add(0.2, 0.34, 2.9, 0, 0, 0, 0, 0);
  add(0.12, 0.19, 2.6, 0, 2.6, 0, 0.6, 0.35); add(0.12, 0.19, 2.6, 0, 2.6, 0, -0.5, -0.5);
  add(0.1, 0.17, 2.4, 0, 2.7, 0, 0.1, 0.75); add(0.1, 0.17, 2.2, 0, 2.7, 0, -0.75, 0.2);
  const blobs = [[0, 5.6, 0, 2.5], [1.9, 4.9, 0.6, 1.9], [-1.7, 5.0, -0.9, 2.0], [0.5, 4.8, -2.0, 1.8], [-0.7, 4.7, 1.9, 1.8], [2.1, 5.6, -1.4, 1.5], [-2.3, 5.5, 1.0, 1.5], [0.4, 6.7, 0.5, 1.6]];
  for (const [bx, by, bz, r] of blobs) {
    const g = new THREE.IcosahedronGeometry(r, detail), p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const n = 0.78 + 0.5 * fbm(x * 0.9 + bx * 3, z * 0.9 + y * 0.7 + bz, 3);
      p.setXYZ(i, x * n + bx, y * n * 0.72 + by, z * n + bz);
    }
    parts.push(paint(g, (x, y, z, c) => {
      const t = THREE.MathUtils.clamp((y - 3.6) / 4, 0, 1), sp = vnoise(x * 3.1, z * 3.1 + y * 2.3);
      const k = 0.5 + 0.65 * t + 0.25 * sp;
      c[0] = 0.95 * k; c[1] = 0.58 * k; c[2] = 0.68 * k;
    }));
  }
  return mergeGeometries(parts);
}

function tuftGeometry() {
  const pos = [], col = [], nrm = [], idx = [];
  const N = 5;
  for (let b = 0; b < N; b++) {
    const a = (b / N) * Math.PI * 2 + rng(), h = 0.38 + rng() * 0.3, w = 0.045, lean = 0.12 + rng() * 0.2;
    const ca = Math.cos(a), sa = Math.sin(a), bx = ca * 0.1, bz = sa * 0.1, v = pos.length / 3;
    pos.push(bx - sa * w, 0, bz + ca * w, bx + sa * w, 0, bz - ca * w,
      bx + ca * lean * 0.4 - sa * w * 0.7, h * 0.55, bz + sa * lean * 0.4 + ca * w * 0.7,
      bx + ca * lean * 0.4 + sa * w * 0.7, h * 0.55, bz + sa * lean * 0.4 - ca * w * 0.7,
      bx + ca * lean, h, bz + sa * lean);
    col.push(0.03, 0.06, 0.012, 0.03, 0.06, 0.012, 0.07, 0.125, 0.025, 0.07, 0.125, 0.025, 0.13, 0.2, 0.045);
    for (let i = 0; i < 5; i++) nrm.push(0, 1, 0);
    idx.push(v, v + 1, v + 2, v + 1, v + 3, v + 2, v + 2, v + 3, v + 4);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setIndex(idx);
  return g;
}

export function buildFlora(scene, track, terrain, colliders, yardTrees, q) {
  const group = new THREE.Group();
  scene.add(group);
  const N = track.N;

  // ----- cedar forest on the slopes -----
  {
    const items = [], want = Math.round(20000 * q.density);
    for (let tries = 0; items.length < want && tries < want * 14; tries++) {
      const x = (rng() - 0.5) * 2960, z = (rng() - 0.5) * 2960;
      const d = terrain.distAt(x, z);
      if (d < 172) continue;
      if (terrain.slopeAt(x, z) > 0.95) continue;
      const dens = fbm(x * 0.004 + 3, z * 0.004 + 1, 3);
      const near = Math.max(0, 1 - (d - 172) / 500);
      if (rng() > 0.25 + 0.75 * near || dens < 0.33) continue;
      const s = 0.75 + rng() * 0.75, k = 0.75 + rng() * 0.5;
      items.push({ x, y: terrain.heightAt(x, z) - 0.4, z, ry: rng() * 6.28, s, sy: s * (0.9 + rng() * 0.4), c: [k, k * (0.9 + rng() * 0.2), k * 0.9] });
    }
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide });
    group.add(chunked(cedarGeometry(), mat, items, 384, false));
  }

  // ----- sakura avenues + farmyard trees -----
  {
    const items = [];
    const pinks = [[1, 1, 1], [1.08, 0.93, 0.97], [1.1, 1.08, 1.06], [0.98, 0.82, 0.9]];
    let side = 1;
    for (let i = 4; i < N; i += 7) {
      const inAvenue = fbm(i * 0.011, 2.5, 3) > 0.43 || i < 170 || i > N - 110;
      if (!inAvenue) continue;
      for (const sd of [side, -side]) {
        if (sd !== side && rng() < 0.45) continue;
        const off = sd * (ROAD_HALF + 7 + rng() * 3.2);
        const x = track.px[i] + track.lx[i] * off, z = track.pz[i] + track.lz[i] * off;
        const s = 0.95 + rng() * 0.5;
        items.push({ x, y: terrain.heightAt(x, z) - 0.1, z, ry: rng() * 6.28, s, c: pinks[Math.floor(rng() * pinks.length)] });
        colliders.add(x, z, 0.5);
      }
      side = -side;
    }
    for (const t of yardTrees) {
      const s = 0.8 + rng() * 0.4;
      items.push({ x: t.x, y: t.y - 0.1, z: t.z, ry: rng() * 6.28, s, c: t.green ? [0.2 + rng() * 0.1, 0.62, 0.22] : pinks[0] });
      colliders.add(t.x, t.z, 0.5);
    }
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
    group.add(chunked(blossomGeometry(q.lowq ? 1 : 2), mat, items, 256, true));
  }

  // ----- roadside grass tufts swaying in the wind -----
  {
    const items = [], want = Math.round(60000 * q.density * (q.lowq ? 0.5 : 1));
    for (let n = 0; n < want; n++) {
      const i = Math.floor(rng() * N), sd = rng() < 0.5 ? 1 : -1;
      const lat = ROAD_HALF + 1.5 + Math.pow(rng(), 1.4) * 9.5;
      const al = (rng() - 0.5) * 2;
      const x = track.px[i] + track.lx[i] * lat * sd + track.tx[i] * al, z = track.pz[i] + track.lz[i] * lat * sd + track.tz[i] * al;
      const sh = lat < ROAD_HALF + SHOULDER_W ? track.py[i] - SHOULDER_DROP * (lat - ROAD_HALF) / SHOULDER_W : -1e9;
      const s = 0.5 + rng() * 0.75, k = 0.7 + rng() * 0.6, fl = rng();
      const c = fl < 0.04 ? [2.6, 2.1, 0.4] : fl < 0.07 ? [2.6, 2.6, 3.4] : [k, k * (0.85 + rng() * 0.3), k * 0.8];
      items.push({ x, y: Math.max(sh, terrain.heightAt(x, z)) - 0.02, z, ry: rng() * 6.28, s, sy: s * (0.7 + rng() * 0.8), c });
    }
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = gTime;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          #ifdef USE_INSTANCING
            vec3 ip = instanceMatrix[3].xyz;
            float w = sin(uTime * 2.3 + ip.x * .31 + ip.z * .27) + .5 * sin(uTime * 4.1 + ip.x * .9 - ip.z * .6);
            transformed.x += w * .16 * position.y; transformed.z += w * .09 * position.y;
          #endif`);
      // shade blades with the ground normal so both faces light identically
      sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>',
        '#include <normal_fragment_begin>\nnormal = normalize((viewMatrix * vec4(0., 1., 0., 0.)).xyz);');
    };
    const g = chunked(tuftGeometry(), mat, items, 192, false);
    g.traverse((m) => { if (m.isMesh) m.receiveShadow = true; });
    group.add(g);
  }

  // ----- drifting sakura petals -----
  const BOX = new THREE.Vector3(70, 26, 70);
  const count = Math.round(2600 * Math.max(0.4, q.density));
  const pp = new Float32Array(count * 3), seed = new Float32Array(count);
  for (let i = 0; i < count; i++) { pp[i * 3] = rng() * BOX.x; pp[i * 3 + 1] = rng() * BOX.y; pp[i * 3 + 2] = rng() * BOX.z; seed[i] = rng(); }
  const pg = new THREE.BufferGeometry();
  pg.setAttribute('position', new THREE.BufferAttribute(pp, 3));
  pg.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const petalMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uTime: gTime, uCam: { value: new THREE.Vector3() }, uBox: { value: BOX }, uScale: { value: 60 } },
    vertexShader: /* glsl */ `
      attribute float aSeed; uniform float uTime, uScale; uniform vec3 uCam, uBox;
      varying float vSeed; varying float vFade;
      void main(){
        vec3 p = position;
        p.y -= uTime * (.7 + aSeed * .7);
        p.x += uTime * 1.6 + sin(uTime * 1.3 + aSeed * 40.) * .8;
        p.z += uTime * .5 + cos(uTime * 1.1 + aSeed * 23.) * .8;
        p = mod(p - uCam + uBox * .5, uBox) - uBox * .5;
        vFade = smoothstep(35., 24., length(p));
        vec4 mv = viewMatrix * vec4(p + uCam, 1.);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = uScale * (.6 + aSeed * .8) / max(-mv.z, .5);
        vSeed = aSeed;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; varying float vSeed; varying float vFade;
      void main(){
        vec2 c = gl_PointCoord - .5;
        float a = uTime * (2. + vSeed * 3.) + vSeed * 30.;
        float cs = cos(a), sn = sin(a);
        c = vec2(c.x * cs - c.y * sn, c.x * sn + c.y * cs);
        c.y *= 1.4 + 1.2 * abs(sin(a * .7));
        float m = smoothstep(.5, .38, length(c));
        if (m * vFade < .02) discard;
        gl_FragColor = vec4(vec3(1.25, .82, .92) * (.75 + .5 * vSeed), m * vFade * .92);
      }`,
  });
  const petals = new THREE.Points(pg, petalMat);
  petals.frustumCulled = false;
  scene.add(petals);

  return { group, petals, petalMat };
}
