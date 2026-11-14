// Shared math helpers, deterministic noise and GLSL snippets.
import * as THREE from 'three';

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const wrapAngle = (a) => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashInt(ix, iz) {
  let h = Math.imul(ix | 0, 374761393) ^ Math.imul(iz | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function vnoise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z);
  let fx = x - ix, fz = z - iz;
  fx = fx * fx * (3 - 2 * fx);
  fz = fz * fz * (3 - 2 * fz);
  const a = hashInt(ix, iz), b = hashInt(ix + 1, iz);
  const c = hashInt(ix, iz + 1), d = hashInt(ix + 1, iz + 1);
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}

export function fbm(x, z, oct = 5) {
  let a = 0.5, s = 0, f = 1;
  for (let i = 0; i < oct; i++) {
    s += a * vnoise(x * f + i * 17.3, z * f - i * 9.1);
    f *= 2.03; a *= 0.5;
  }
  return s;
}

export function ridged(x, z, oct = 5) {
  let a = 0.5, s = 0, f = 1, w = 1;
  for (let i = 0; i < oct; i++) {
    let n = 1 - Math.abs(2 * vnoise(x * f + 31.7 + i * 5.1, z * f - 12.3) - 1);
    n *= n;
    s += a * n * w;
    w = clamp(n * 1.8, 0, 1);
    f *= 2.07; a *= 0.5;
  }
  return s;
}

// One shared clock uniform so every animated material stays in sync.
export const gTime = { value: 0 };

export const NOISE_GLSL = /* glsl */ `
#ifndef NOISE_OCT
#define NOISE_OCT 5
#endif
float hash12(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * .1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3. - 2. * f);
  return mix(mix(hash12(i), hash12(i + vec2(1., 0.)), f.x),
             mix(hash12(i + vec2(0., 1.)), hash12(i + vec2(1., 1.)), f.x), f.y);
}
float fbm(vec2 p){
  float a = .5, s = 0.;
  for (int i = 0; i < NOISE_OCT; i++) { s += a * vnoise(p); p = p * 2.03 + 17.1; a *= .5; }
  return s;
}
`;

// Baked, tileable noise texture: far cheaper per pixel than hash noise and mip-mapped (no shimmer).
// R,G = white noise (bilinear -> value noise), B,A = periodic 5-octave fbm.
export const gNoise = { value: null };
export function initNoise() {
  const S = 256, d = new Uint8Array(S * S * 4), r = mulberry32(99);
  const pfbm = (x, y, seed) => {
    let a = 0.5, s = 0, cells = 8;
    for (let o = 0; o < 5; o++) {
      const fx = (x / S) * cells, fy = (y / S) * cells, ix = Math.floor(fx), iy = Math.floor(fy);
      let u = fx - ix, v = fy - iy; u = u * u * (3 - 2 * u); v = v * v * (3 - 2 * v);
      const h = (i, j) => hashInt((i % cells) + seed * 131 + o * 977, (j % cells) + o * 57 + seed * 31);
      const p = h(ix, iy), q = h(ix + 1, iy), m = h(ix, iy + 1), n = h(ix + 1, iy + 1);
      s += a * (p + (q - p) * u + (m - p) * v + (p - q - m + n) * u * v);
      a *= 0.5; cells *= 2;
    }
    return s / 0.96875;
  };
  for (let y = 0, o = 0; y < S; y++) for (let x = 0; x < S; x++, o += 4) {
    d[o] = r() * 255; d[o + 1] = r() * 255; d[o + 2] = pfbm(x, y, 1) * 255; d[o + 3] = pfbm(x, y, 2) * 255;
  }
  const t = new THREE.DataTexture(d, S, S, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true; t.anisotropy = 4; t.needsUpdate = true;
  gNoise.value = t;
  return t;
}
// tn(p) ~ value noise with unit cells, tf(p) ~ fbm with unit base features, tn0 = no mip selection.
export const NOISE_TEX_GLSL = /* glsl */ `
uniform sampler2D uNoise;
float tn(vec2 p){ return texture2D(uNoise, p / 256.).r; }
float tn0(vec2 p){ return textureLod(uNoise, p / 256., 0.).g; }
float tf(vec2 p){ return texture2D(uNoise, p * .125).b; }
float tf2(vec2 p){ return texture2D(uNoise, p * .125).a; }
`;

// Uniform spatial hash of circle colliders (trees, poles, buildings).
export class Colliders {
  constructor(cell = 16) { this.cell = cell; this.map = new Map(); }
  add(x, z, r) {
    const k = Math.floor(x / this.cell) + ',' + Math.floor(z / this.cell);
    let a = this.map.get(k);
    if (!a) this.map.set(k, (a = []));
    a.push(x, z, r);
  }
  query(x, z, cb) {
    const cx = Math.floor(x / this.cell), cz = Math.floor(z / this.cell);
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const a = this.map.get((cx + i) + ',' + (cz + j));
      if (!a) continue;
      for (let n = 0; n < a.length; n += 3) cb(a[n], a[n + 1], a[n + 2]);
    }
  }
}
