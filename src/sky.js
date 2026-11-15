import * as THREE from 'three';
import { NOISE_TEX_GLSL, gNoise, gTime, fbm } from './util.js';

// Time of day. Each course can override any of these (levels.js `sky`); the defaults are Sakura Valley's
// mid-afternoon. el/az are the sun's elevation and its bearing from the start straight, in degrees.
const SKY = {
  el: 23, az: 32, sunColor: [1, 0.81, 0.6], sunIntensity: 7.5, hemi: 0.35, env: 0.85,
  zenith: [0.085, 0.2, 0.5], horizon: [0.5, 0.5, 0.58], glow: [1.5, 0.82, 0.4],
  cloudShade: [0.36, 0.31, 0.4], cloudLit: [1.55, 1.12, 0.78], fog: [0.6, 0.52, 0.5], fogDensity: 0.00042,
};
const rad = (d) => (d * Math.PI) / 180;
export const SUN_DIR = new THREE.Vector3();
export const FOG_COLOR = new THREE.Color();
export function setSky(cfg = {}) {
  Object.assign(SKY, cfg);
  FOG_COLOR.setRGB(...SKY.fog);
  orientSun(0);
}
// Aim the low sun ahead and to one side of the start straight so the grid is back-lit.
export function orientSun(heading) {
  const az = heading + rad(SKY.az), el = rad(SKY.el);
  SUN_DIR.set(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)).normalize();
}
setSky();

function skyMaterial(lowq) {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
    uniforms: {
      uSun: { value: SUN_DIR }, uTime: gTime, uNoise: gNoise,
      uZen: { value: new THREE.Vector3(...SKY.zenith) }, uHor: { value: new THREE.Vector3(...SKY.horizon) }, uGlow: { value: new THREE.Vector3(...SKY.glow) },
      uCloudS: { value: new THREE.Vector3(...SKY.cloudShade) }, uCloudL: { value: new THREE.Vector3(...SKY.cloudLit) }, uFog: { value: new THREE.Vector3(...SKY.fog) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
    fragmentShader: /* glsl */ `
      varying vec3 vDir; uniform vec3 uSun; uniform float uTime;
      uniform vec3 uZen, uHor, uGlow, uCloudS, uCloudL, uFog;
      ${NOISE_TEX_GLSL}
      void main(){
        vec3 d = normalize(vDir);
        float h = max(d.y, 0.);
        float sd = max(dot(d, uSun), 0.);
        float sunAmt = pow(sd, 5.);
        vec3 zen = uZen;
        vec3 hor = mix(uHor, uGlow, sunAmt * .85 + .15 * sd);
        vec3 col = mix(hor, zen, pow(h, .42));
        col += vec3(1., .55, .25) * pow(sd, 48.) * .9;
        col += vec3(1., .8, .55) * pow(sd, 700.) * 4.;
        col += vec3(1., .85, .6) * smoothstep(.99935, .9997, sd) * 55.;
        if (d.y > .005) {
          vec2 p = d.xz / (d.y + .14) * 1.15 + vec2(uTime * .0035, uTime * .0012);
          vec2 pb = vec2(p.y, -p.x) * 1.9 + 3.7;
          float c = .64 * tf(p * .6) + .36 * tf2(pb);
          float c2 = .64 * tf(p * .6 + uSun.xz * .16) + .36 * tf2(pb + uSun.zx * .3);
          float dens = smoothstep(.47, .66, c + .05 * tn(p * 40.));
          float lit = clamp((c - c2) * 5. + .55, 0., 1.);
          vec3 cc = mix(uCloudS, uCloudL, lit);
          cc += vec3(1.2, .6, .25) * sunAmt * (1. - dens * .6);
          col = mix(col, cc, dens * .9 * smoothstep(.005, .16, d.y));
        }
        col = mix(col, uFog, smoothstep(.0, -.08, d.y));
        gl_FragColor = vec4(col, 1.);
      }`,
  });
}

export function buildSky(scene, renderer, lowq, start) {
  const mat = skyMaterial(lowq);
  const sky = new THREE.Mesh(new THREE.SphereGeometry(4000, 32, 16), mat);
  sky.renderOrder = -100; sky.frustumCulled = false;
  scene.add(sky);

  // Image-based lighting from the same sky.
  const envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), mat));
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(envScene, 0, 1, 200).texture;
  scene.environmentIntensity = SKY.env;
  pmrem.dispose();

  scene.fog = new THREE.FogExp2(FOG_COLOR, SKY.fogDensity);

  const sun = new THREE.DirectionalLight(new THREE.Color().setRGB(...SKY.sunColor, THREE.SRGBColorSpace), SKY.sunIntensity);
  sun.castShadow = true;
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.35;
  const sc = sun.shadow.camera;
  sc.left = -110; sc.right = 110; sc.top = 110; sc.bottom = -110; sc.near = 1; sc.far = 800;
  scene.add(sun, sun.target);
  scene.add(new THREE.HemisphereLight(0x9fb6ff, 0x4a3d2c, SKY.hemi));

  scene.add(buildBackdrop(start));
  return { sky, sun };
}

// Hazy silhouette ridges + a snow-capped volcano on the horizon.
function buildBackdrop(start) {
  const g = new THREE.Group();
  const pos = [], col = [], idx = [];
  const layers = [
    { R: 2500, h: 330, top: [0.085, 0.12, 0.15], base: [0.42, 0.38, 0.39], f: 5.5, o: 1.3 },
    { R: 3300, h: 520, top: [0.2, 0.24, 0.31], base: [0.52, 0.46, 0.46], f: 4.2, o: 7.7 },
    { R: 4300, h: 760, top: [0.34, 0.37, 0.46], base: [0.6, 0.52, 0.5], f: 3.1, o: 4.1 },
  ];
  const SEG = 480;
  for (const L of layers) {
    const base = pos.length / 3;
    for (let i = 0; i <= SEG; i++) {
      const a = (i / SEG) * Math.PI * 2, cx = Math.cos(a), sz = Math.sin(a);
      const n = fbm(cx * L.f + L.o, sz * L.f - L.o, 6);
      const hh = L.h * (0.25 + 1.5 * n);
      pos.push(cx * L.R, -120, sz * L.R, cx * L.R, hh, sz * L.R);
      col.push(...L.base, ...L.top);
      if (i < SEG) { const v = base + i * 2; idx.push(v, v + 1, v + 2, v + 1, v + 3, v + 2); }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, side: THREE.DoubleSide });
  g.add(new THREE.Mesh(geo, mat));

  // Fuji-style stratovolcano.
  const H = 2500, R = 4200, pts = [];
  for (let i = 0; i <= 40; i++) {
    const t = i / 40, r = R * (0.035 + 0.965 * t);
    const y = H * (Math.exp(-3.4 * t) - Math.exp(-3.4)) / (1 - Math.exp(-3.4));
    pts.push(new THREE.Vector2(r, y));
  }
  pts.reverse();
  const fg = new THREE.LatheGeometry(pts, 96);
  const p = fg.attributes.position, c = new Float32Array(p.count * 3);
  fg.computeVertexNormals();
  const nrm = fg.attributes.normal;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i), a = Math.atan2(p.getZ(i), p.getX(i));
    const line = H * (0.5 + 0.07 * Math.sin(a * 9) + 0.05 * Math.sin(a * 17 + 1) + 0.04 * Math.sin(a * 31 + 2));
    const snow = THREE.MathUtils.smoothstep(y, line - 60, line + 90);
    const haze = 1 - Math.min(1, y / (H * 0.55));
    const lit = 0.72 + 0.4 * Math.max(0, nrm.getX(i) * SUN_DIR.x + nrm.getY(i) * SUN_DIR.y + nrm.getZ(i) * SUN_DIR.z);
    const rock = [0.3 + 0.28 * haze, 0.33 + 0.2 * haze, 0.44 + 0.07 * haze];
    const sn = [1.25 * lit, 1.12 * lit, 1.05 * lit];
    c[i * 3] = rock[0] + (sn[0] - rock[0]) * snow;
    c[i * 3 + 1] = rock[1] + (sn[1] - rock[1]) * snow;
    c[i * 3 + 2] = rock[2] + (sn[2] - rock[2]) * snow;
  }
  fg.setAttribute('color', new THREE.BufferAttribute(c, 3));
  const fuji = new THREE.Mesh(fg, mat);
  const fs = Math.sin(start.heading), fc = Math.cos(start.heading);
  fuji.position.set(start.x + fs * 9000 - fc * 1300, -80, start.z + fc * 9000 + fs * 1300);
  g.add(fuji);
  return g;
}
