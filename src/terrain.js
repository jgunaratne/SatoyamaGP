import * as THREE from 'three';
import { NOISE_TEX_GLSL, gNoise, clamp, lerp, smoothstep, fbm, ridged, hashInt } from './util.js';
import { ROAD_HALF } from './track.js';

export const TSIZE = 3072, TN = 384, TCELL = 8;
export const CX = 5, CZ = 4;            // one farm plot = 5 x 4 terrain cells (40 x 32 m)
export const T_PADDY = 1, T_VEG = 2, T_YARD = 3, T_FLOWER = 4;
const HALF = TSIZE / 2;

export class Terrain {
  constructor(track) {
    const n1 = (this.n1 = TN + 1);
    const H = (this.H = new Float32Array(n1 * n1));
    const D = (this.D = new Float32Array(n1 * n1));
    const TH = new Float32Array(n1 * n1), IDX = new Int32Array(n1 * n1);

    // Coarse copy of the centreline for the distance / height field.
    const st = track.coarseStep, nc = Math.floor(track.N / st);
    const cx = new Float32Array(nc), cy = new Float32Array(nc), cz = new Float32Array(nc);
    for (let c = 0; c < nc; c++) { cx[c] = track.px[c * st]; cy[c] = track.py[c * st]; cz[c] = track.pz[c * st]; }

    for (let j = 0; j < n1; j++) {
      const z = -HALF + j * TCELL;
      for (let i = 0; i < n1; i++) {
        const x = -HALF + i * TCELL;
        let best = 0, bd = 1e18, sw = 0, sy = 0;
        for (let c = 0; c < nc; c++) {
          const dx = x - cx[c], dz = z - cz[c], d2 = dx * dx + dz * dz;
          if (d2 < bd) { bd = d2; best = c; }
          const w = 1 / ((d2 + 400) * (d2 + 400));
          sw += w; sy += w * cy[c];
        }
        const idx = track.nearest(x, z, best * st, st + 1);
        const d = Math.hypot(x - track.px[idx], z - track.pz[idx]);
        const th = lerp(track.heightAt(x, z, idx), sy / sw, smoothstep(16, 45, d));
        const r = Math.hypot(x, z);
        const m = Math.pow(smoothstep(120, 620, d), 1.4);
        const rid = ridged(x * 0.0016, z * 0.0016, 5);
        const big = fbm(x * 0.0007 + 5, z * 0.0007 + 9, 3);
        const h = th - 0.35
          + smoothstep(16, 70, d) * (fbm(x * 0.01, z * 0.01, 4) - 0.5) * 5
          + m * (40 + 340 * (0.55 * rid + 0.45 * fbm(x * 0.003 + 2, z * 0.003 - 4, 4)) * (0.5 + big))
          + smoothstep(800, 1500, r) * 230 * (0.5 + rid);
        const o = j * n1 + i;
        H[o] = h; D[o] = d; TH[o] = th; IDX[o] = idx;
      }
    }

    // Terraced farm plots along the valley floor.
    const ncx = (this.ncx = Math.floor(TN / CX)), ncz = (this.ncz = Math.floor(TN / CZ));
    this.cellData = new Uint8Array(ncx * ncz * 4);
    this.cells = [];
    for (let cj = 0; cj < ncz; cj++) for (let ci = 0; ci < ncx; ci++) {
      const i0 = ci * CX, j0 = cj * CZ;
      let minD = 1e9;
      for (let j = j0; j <= j0 + CZ; j++) for (let i = i0; i <= i0 + CX; i++) minD = Math.min(minD, D[j * n1 + i]);
      const c = (j0 + 2) * n1 + i0 + 2;
      if (minD <= 17.5 || D[c] >= 165) continue;
      const r = hashInt(ci * 7 + 3, cj * 13 + 1);
      const type = r < 0.6 ? T_PADDY : r < 0.78 ? T_VEG : r < 0.9 ? T_FLOWER : T_PADDY;
      const h = Math.round((TH[c] - 0.7) / 0.5) * 0.5;
      for (let j = j0; j < j0 + CZ; j++) for (let i = i0; i < i0 + CX; i++) H[j * n1 + i] = h;
      const cell = { ci, cj, type, h, d: D[c], idx: IDX[c], x: -HALF + i0 * TCELL + 16, z: -HALF + j0 * TCELL + 12 };
      this.cells.push(cell);
      this.setCellType(cell, type, hashInt(ci, cj));
    }
  }

  setCellType(cell, type, rnd) {
    const o = (cell.cj * this.ncx + cell.ci) * 4;
    cell.type = type;
    this.cellData[o] = type * 50;
    if (rnd !== undefined) this.cellData[o + 1] = Math.floor(rnd * 255);
    this.cellData[o + 3] = 255;
    if (this.cellTex) this.cellTex.needsUpdate = true;
  }

  _bil(A, x, z) {
    const n1 = this.n1;
    const fx = clamp((x + HALF) / TCELL, 0, TN - 0.001), fz = clamp((z + HALF) / TCELL, 0, TN - 0.001);
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, o = j * n1 + i;
    return (A[o] * (1 - u) + A[o + 1] * u) * (1 - v) + (A[o + n1] * (1 - u) + A[o + n1 + 1] * u) * v;
  }
  heightAt(x, z) { return this._bil(this.H, x, z); }
  distAt(x, z) { return this._bil(this.D, x, z); }
  slopeAt(x, z) {
    const e = 4;
    const dx = this.heightAt(x + e, z) - this.heightAt(x - e, z), dz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
    return Math.hypot(dx, dz) / (2 * e);
  }

  buildMaterial(lowq) {
    const tex = (this.cellTex = new THREE.DataTexture(this.cellData, this.ncx, this.ncz, THREE.RGBAFormat));
    tex.magFilter = tex.minFilter = THREE.NearestFilter;
    tex.needsUpdate = true;
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
    const ncx = this.ncx, ncz = this.ncz;
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uCells = { value: tex };
      sh.uniforms.uNoise = gNoise;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aRoad;\nvarying float vRoad;\nvarying vec3 vWPos;\nvarying vec3 vWNrm;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRoad = aRoad; vWPos = (modelMatrix * vec4(position, 1.)).xyz; vWNrm = normal;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform sampler2D uCells;
          varying float vRoad; varying vec3 vWPos; varying vec3 vWNrm;
          float gRough;
          ${NOISE_TEX_GLSL}`)
        .replace('#include <color_fragment>', /* glsl */ `
        {
          vec3 wp = vWPos;
          float slope = 1. - normalize(vWNrm).y;
          float vd = length(vViewPosition);
          float n1 = tf(wp.xz * .045);
          float n2 = tn(wp.xz * .9);
          float n3 = tn(wp.xz * 6.3);
          vec3 grass = mix(vec3(.05, .10, .018), vec3(.15, .2, .04), n1);
          grass *= (.75 + .5 * n2) * (.85 + .3 * n3);
          float forest = smoothstep(150., 230., vRoad);
          float cn = tn(wp.xz * .22), cn2 = tn(wp.xz * .07 + 7.);
          vec3 forestCol = mix(vec3(.018, .045, .016), vec3(.065, .115, .032), cn * cn2 * 1.6);
          vec3 col = mix(grass, forestCol, forest);
          vec3 rock = mix(vec3(.1, .09, .08), vec3(.23, .21, .19), n2);
          col = mix(col, rock, smoothstep(.42, .62, slope) * (.4 + .6 * forest));
          gRough = .95;

          vec2 cellUv = (wp.xz + ${HALF.toFixed(1)}) / vec2(${(CX * TCELL).toFixed(1)}, ${(CZ * TCELL).toFixed(1)});
          vec2 cid = floor(cellUv), cf = fract(cellUv);
          vec4 ct = texture2D(uCells, (cid + .5) / vec2(${ncx.toFixed(1)}, ${ncz.toFixed(1)}));
          float type = floor(ct.r * 5.1 + .5);
          if (type > .5) {
            vec2 m = cf * vec2(${(CX * TCELL).toFixed(1)}, ${(CZ * TCELL).toFixed(1)});
            float bd = min(min(m.x, ${((CX - 1) * TCELL).toFixed(1)} - m.x), min(m.y, ${((CZ - 1) * TCELL).toFixed(1)} - m.y));
            float inside = smoothstep(.7, 1.3, bd);
            vec2 p = ct.g > .5 ? wp.xz : wp.zx;
            float fade = exp(-vd * .03);
            if (type < 1.5) {            // flooded rice paddy
              float row = abs(fract(p.x / .32) - .5) * 2.;
              float cl = tn0(vec2(floor(p.x / .32) * 7., p.y * 5.));
              float plant = (1. - smoothstep(.25, .6, row)) * smoothstep(.25, .6, cl);
              float cover = mix(.2, plant, fade);
              vec3 pc = mix(vec3(.016, .022, .018), vec3(.11, .23, .035), cover);
              col = mix(col, pc, inside);
              gRough = mix(gRough, mix(.04, .7, cover), inside);
            } else if (type < 2.5) {     // vegetable furrows
              float row = abs(fract(p.x / 1.1) - .5) * 2.;
              vec3 soil = mix(vec3(.065, .042, .026), vec3(.11, .075, .05), n2);
              float crop = (1. - smoothstep(.2, .55, row)) * smoothstep(.2, .5, tn0(vec2(floor(p.x / 1.1) * 3., p.y * 1.5)));
              crop = mix(.3, crop, fade);
              vec3 vc = mix(soil * (.7 + .3 * mix(.5, row, fade)), vec3(.07, .2, .035), crop);
              col = mix(col, vc, inside);
            } else if (type < 3.5) {     // packed-earth farmyard
              vec3 yc = mix(vec3(.19, .16, .12), vec3(.29, .26, .21), n2) * (.85 + .3 * n3);
              col = mix(col, yc, inside);
            } else {                     // nanohana (rapeseed) field
              float fl = smoothstep(.3, .65, tn(wp.xz * 3.1));
              fl = mix(.55, fl, fade);
              vec3 fc = mix(vec3(.09, .2, .03), vec3(.78, .56, .02), fl);
              col = mix(col, fc, inside);
            }
          }
          float gr = 1. - smoothstep(${(ROAD_HALF + 0.3).toFixed(2)}, ${(ROAD_HALF + 1.8).toFixed(2)}, vRoad);
          col = mix(col, vec3(.2, .18, .155) * (.7 + .6 * n3), gr);
          diffuseColor.rgb = col;
        }`)
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = gRough;');
    };
    return (this.material = mat);
  }

  buildMesh() {
    const n1 = this.n1, H = this.H;
    const pos = new Float32Array(n1 * n1 * 3), idx = new Uint32Array(TN * TN * 6);
    for (let j = 0, o = 0; j < n1; j++) for (let i = 0; i < n1; i++, o++) {
      pos[o * 3] = -HALF + i * TCELL; pos[o * 3 + 1] = H[o]; pos[o * 3 + 2] = -HALF + j * TCELL;
    }
    let q = 0;
    for (let j = 0; j < TN; j++) for (let i = 0; i < TN; i++) {
      const a = j * n1 + i, b = a + 1, c = a + n1, d = c + 1;
      idx[q++] = a; idx[q++] = c; idx[q++] = b; idx[q++] = b; idx[q++] = c; idx[q++] = d;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aRoad', new THREE.BufferAttribute(this.D, 1));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, this.material);
    mesh.receiveShadow = true;
    return mesh;
  }
}

export const SHOULDER_W = 4, SHOULDER_DROP = 0.45;

// Gravel verges that hide the seam between the asphalt ribbon and the height field.
export function buildShoulders(track, material) {
  const { N, px, py, pz, lx, lz } = track;
  const pos = [], road = [], idx = [];
  for (const side of [1, -1]) {
    const base = pos.length / 3;
    for (let i = 0; i <= N; i++) {
      const k = i % N;
      const a = side > 0 ? ROAD_HALF + SHOULDER_W : ROAD_HALF, b = side > 0 ? ROAD_HALF : ROAD_HALF + SHOULDER_W;
      pos.push(px[k] + lx[k] * a * side, py[k] - (a > ROAD_HALF ? SHOULDER_DROP : 0.01), pz[k] + lz[k] * a * side);
      pos.push(px[k] + lx[k] * b * side, py[k] - (b > ROAD_HALF ? SHOULDER_DROP : 0.01), pz[k] + lz[k] * b * side);
      road.push(a, b);
      if (i < N) { const v = base + i * 2; idx.push(v, v + 1, v + 2, v + 1, v + 3, v + 2); }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aRoad', new THREE.Float32BufferAttribute(road, 1));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, material);
  mesh.receiveShadow = true;
  return mesh;
}
