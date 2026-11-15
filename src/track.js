import * as THREE from 'three';
import { NOISE_TEX_GLSL, gNoise, wrapAngle } from './util.js';

export const ROAD_HALF = 5.0; // half width of the asphalt in metres
export const RAIL_OFF = ROAD_HALF + 0.9;

// Convention used everywhere: heading h -> forward (sin h, cos h), left (cos h, -sin h).
export class Track {
  // def.points: closed loop of [x, y, z] control points (see levels.js); without it, the Sakura Valley loop.
  // def.startNear: [x, y, z] the start line should be close to.
  constructor(def = {}) {
    const pts = [];
    if (def.points) for (const [x, y, z] of def.points) pts.push(new THREE.Vector3(x, y, z));
    else {
      const radii = [560, 610, 500, 370, 440, 600, 660, 580, 430, 330, 430, 590, 640, 520, 400, 470], K = radii.length;
      for (let i = 0; i < K; i++) {
        const a = (i / K) * Math.PI * 2, r = radii[i];
        const y = 8 + 10 * Math.sin(a * 2 + 0.8) + 6 * Math.sin(a * 3 + 2.0);
        pts.push(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r));
      }
    }
    const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
    curve.arcLengthDivisions = 6000;
    const L = (this.length = curve.getLength());
    const N = (this.N = Math.round(L / 2));
    const ds = (this.ds = L / N);
    let sp = curve.getSpacedPoints(N);
    sp.pop();
    // Put the start/finish line on the longest straight: rotate the samples so index 0 sits there.
    {
      const kk = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        const a = sp[(i + N - 3) % N], b = sp[i], c = sp[(i + 3) % N];
        kk[i] = Math.abs(wrapAngle(Math.atan2(c.x - b.x, c.z - b.z) - Math.atan2(b.x - a.x, b.z - a.z))) / (3 * ds);
      }
      let best = 0, bv = 1e9;
      for (let i = 0; i < N; i += 2) {
        if (def.startNear && Math.hypot(sp[i].x - def.startNear[0], sp[i].z - def.startNear[2]) > 160) continue;
        let m = 0;
        for (let o = -45; o <= 150; o += 3) m = Math.max(m, kk[(i + o + N) % N]);
        if (m < bv) { bv = m; best = i; }
      }
      sp = sp.slice(best).concat(sp.slice(0, best));
    }

    const px = (this.px = new Float32Array(N)), py = (this.py = new Float32Array(N)), pz = (this.pz = new Float32Array(N));
    const tx = (this.tx = new Float32Array(N)), tz = (this.tz = new Float32Array(N));
    const lx = (this.lx = new Float32Array(N)), lz = (this.lz = new Float32Array(N));
    const k = (this.k = new Float32Array(N));
    for (let i = 0; i < N; i++) { px[i] = sp[i].x; py[i] = sp[i].y; pz[i] = sp[i].z; }
    const th = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const a = (i + 1) % N, b = (i - 1 + N) % N;
      let dx = px[a] - px[b], dz = pz[a] - pz[b];
      const l = Math.hypot(dx, dz); dx /= l; dz /= l;
      tx[i] = dx; tz[i] = dz; lx[i] = dz; lz[i] = -dx;
      th[i] = Math.atan2(dx, dz);
    }
    let tmp = new Float32Array(N);
    for (let i = 0; i < N; i++) k[i] = wrapAngle(th[(i + 1) % N] - th[(i - 1 + N) % N]) / (2 * ds);
    for (let pass = 0; pass < 4; pass++) {
      for (let i = 0; i < N; i++) tmp[i] = (k[(i - 1 + N) % N] + 2 * k[i] + k[(i + 1) % N]) / 4;
      k.set(tmp);
    }

    // Guardrails on the outside of the tighter corners. +1 = left side, -1 = right side.
    const raw = new Int8Array(N), rail = (this.rail = new Int8Array(N));
    for (let i = 0; i < N; i++) raw[i] = k[i] > 1 / 240 ? -1 : k[i] < -1 / 240 ? 1 : 0;
    for (let i = 0; i < N; i++) {
      if (!raw[i]) continue;
      for (let o = -14; o <= 14; o++) { const j = (i + o + N) % N; if (!rail[j]) rail[j] = raw[i]; }
    }
    for (let i = -20; i <= 20; i++) rail[(i + N) % N] = 0; // keep the start gate clear

    this.coarseStep = 8;
    this._s = { x: 0, y: 0, z: 0, tx: 0, tz: 1, lx: 1, lz: 0, k: 0, slope: 0 };
  }

  nearest(x, z, hint, win = 40) {
    const { N, px, pz } = this;
    let best = hint, bd = 1e18;
    for (let o = -win; o <= win; o++) {
      const i = (((hint + o) % N) + N) % N;
      const dx = x - px[i], dz = z - pz[i], d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }
  nearestGlobal(x, z) {
    const { N, px, pz, coarseStep: st } = this;
    let best = 0, bd = 1e18;
    for (let i = 0; i < N; i += st) {
      const dx = x - px[i], dz = z - pz[i], d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = i; }
    }
    return this.nearest(x, z, best, st + 2);
  }
  lateral(x, z, i) { return (x - this.px[i]) * this.lx[i] + (z - this.pz[i]) * this.lz[i]; }
  along(x, z, i) { return (x - this.px[i]) * this.tx[i] + (z - this.pz[i]) * this.tz[i]; }
  heightAt(x, z, i) {
    const N = this.N, a = (i + 1) % N, b = (i - 1 + N) % N;
    return this.py[i] + this.along(x, z, i) * (this.py[a] - this.py[b]) / (2 * this.ds);
  }
  curvAt(s) {
    const N = this.N;
    return this.k[((Math.round(s / this.ds) % N) + N) % N];
  }
  // Interpolated frame at arc length s (any real number, wraps). Returns a shared object.
  sample(s) {
    const { N, ds, px, py, pz, tx, tz, k } = this, o = this._s;
    let f = (s / ds) % N; if (f < 0) f += N;
    const i = Math.floor(f) % N, j = (i + 1) % N, t = f - Math.floor(f);
    o.x = px[i] + (px[j] - px[i]) * t;
    o.y = py[i] + (py[j] - py[i]) * t;
    o.z = pz[i] + (pz[j] - pz[i]) * t;
    let ax = tx[i] + (tx[j] - tx[i]) * t, az = tz[i] + (tz[j] - tz[i]) * t;
    const l = Math.hypot(ax, az); ax /= l; az /= l;
    o.tx = ax; o.tz = az; o.lx = az; o.lz = -ax;
    o.k = k[i] + (k[j] - k[i]) * t;
    o.slope = (py[j] - py[i]) / ds;
    return o;
  }
}

export function buildRoad(track) {
  const { N, px, py, pz, lx, lz, ds } = track;
  const pos = new Float32Array((N + 1) * 6), uv = new Float32Array((N + 1) * 4), idx = [];
  for (let i = 0; i <= N; i++) {
    const k = i % N;
    pos.set([px[k] + lx[k] * ROAD_HALF, py[k], pz[k] + lz[k] * ROAD_HALF,
             px[k] - lx[k] * ROAD_HALF, py[k], pz[k] - lz[k] * ROAD_HALF], i * 6);
    uv.set([0, i * ds, 1, i * ds], i * 4);
    if (i < N) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uNoise = gNoise;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vRUv;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRUv = uv;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vRUv;\nfloat gRough;\n' + NOISE_TEX_GLSL)
      .replace('#include <color_fragment>', /* glsl */ `
        {
          float HW = ${ROAD_HALF.toFixed(2)};
          float x = (vRUv.x - .5) * 2. * HW;
          float s = vRUv.y;
          float n = tf(vec2(x * 1.3, s * .35));
          float nf = tn(vec2(x, s) * 37.);
          float ng = tn(vec2(x, s) * 140.);
          vec3 asphalt = mix(vec3(.028), vec3(.062), n) + (nf - .5) * .018 + (ng - .5) * .02;
          float wear = exp(-pow((abs(x) - 2.4) / .9, 2.));
          asphalt *= 1. - .22 * wear;
          float patchN = tf(vec2(x * .22 + 3., s * .045));
          float patchM = smoothstep(.5, .72, patchN);
          asphalt = mix(asphalt, asphalt * .7, patchM * .6);
          // cracks / tar seams
          float seam = smoothstep(.03, .0, abs(tn(vec2(x * .7, s * .12)) - .5)) * .5;
          asphalt *= 1. - seam * .5;
          float aa = fwidth(x) * 1.2 + .004;
          float lw = .5 + .5 * tn(vec2(x * 9., s * 2.5));
          float edge = 1. - smoothstep(.075, .075 + aa, abs(abs(x) - (HW - .5)));
          float dash = step(fract(s / 12.), .5);
          float center = (1. - smoothstep(.08, .08 + aa, abs(x))) * dash;
          float lm = max(edge, center) * (.55 + .45 * lw);
          vec3 col = mix(asphalt, vec3(.62, .62, .58), lm);
          // chequered start line
          if (s < 2.4 && abs(x) < HW - .6) {
            float ch = mod(floor(x / .6) + floor(s / .6), 2.);
            col = mix(vec3(.03), vec3(.7), ch);
          }
          diffuseColor.rgb = col;
          gRough = mix(.84, .4, patchM) - wear * .12 + lm * .1;
        }
      `)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = clamp(gRough, .05, 1.);');
  };
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  return mesh;
}

export function buildGuardrails(track) {
  const { N, px, py, pz, lx, lz, rail } = track;
  const pos = [], idx = [], posts = [];
  // find a starting index that is not inside a run
  let start = 0; while (start < N && rail[start]) start++;
  let prev = 0, base = 0;
  for (let n = 0; n <= N; n++) {
    const i = (start + n) % N, s = n === N ? 0 : rail[i];
    if (s) {
      const ox = px[i] + lx[i] * RAIL_OFF * s, oz = pz[i] + lz[i] * RAIL_OFF * s;
      const v = pos.length / 3;
      pos.push(ox, py[i] + 0.42, oz, ox, py[i] + 0.6, oz + 0, ox, py[i] + 0.78, oz);
      // slight W-beam bulge on the middle row, toward the road
      pos[pos.length - 6] -= lx[i] * 0.05 * s; pos[pos.length - 4] -= lz[i] * 0.05 * s;
      if (prev === s && v - base >= 3) idx.push(v - 3, v - 2, v, v - 2, v + 1, v, v - 2, v - 1, v + 1, v - 1, v + 2, v + 1);
      else base = v;
      if (n % 2 === 0) posts.push(ox + lx[i] * 0.08 * s, py[i] + 0.15, oz + lz[i] * 0.08 * s, Math.atan2(track.tx[i], track.tz[i]));
    }
    prev = s;
  }
  const g = new THREE.Group();
  if (!pos.length) return g;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ color: 0xdfe3e6, roughness: 0.45, metalness: 0.55, side: THREE.DoubleSide });
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true; m.receiveShadow = true;
  g.add(m);
  const pm = new THREE.InstancedMesh(new THREE.BoxGeometry(0.1, 0.9, 0.12), mat, posts.length / 4);
  const d = new THREE.Object3D();
  for (let i = 0; i < posts.length / 4; i++) {
    d.position.set(posts[i * 4], posts[i * 4 + 1] + 0.2, posts[i * 4 + 2]);
    d.rotation.y = posts[i * 4 + 3];
    d.updateMatrix(); pm.setMatrixAt(i, d.matrix);
  }
  pm.castShadow = true;
  g.add(pm);
  return g;
}
