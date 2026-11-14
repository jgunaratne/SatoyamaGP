import * as THREE from 'three';
import { Track, buildRoad, buildGuardrails } from './track.js';
import { Terrain, buildShoulders } from './terrain.js';
import { buildSky, orientSun, SUN_DIR } from './sky.js';
import { buildProps } from './props.js';
import { buildFlora } from './flora.js';
import { buildCar } from './car.js';
import { Vehicle } from './vehicle.js';
import { Rival } from './ai.js';
import { Post } from './post.js';
import { Hud, fmtTime } from './hud.js';
import { EngineAudio } from './audio.js';
import { Colliders, clamp, lerp, smoothstep, wrapAngle, gTime, initNoise } from './util.js';

const params = new URLSearchParams(location.search);
const QUALITY = {
  low: { scale: 0.6, msaa: 0, shadow: 1024, dofTaps: 8, blurSamples: 2, density: 0.22, lowq: true, dpr: 1 },
  medium: { scale: 0.8, msaa: 0, shadow: 2048, dofTaps: 22, blurSamples: 4, density: 0.6, lowq: false, dpr: 1 },
  high: { scale: 1, msaa: 4, shadow: 2048, dofTaps: 40, blurSamples: 6, density: 1, lowq: false, dpr: 1.5 },
  ultra: { scale: 1, msaa: 4, shadow: 4096, dofTaps: 64, blurSamples: 8, density: 1.4, lowq: false, dpr: 2 },
};
const LAPS = 2;
const RIVALS = [
  { name: 'AKIRA', color: 0xf2f2ee, css: '#f2f2ee', skill: 1.0 },
  { name: 'MIKA', color: 0x1456d8, css: '#3b7bff', skill: 0.82 },
  { name: 'KENJI', color: 0xf0b400, css: '#f0b400', skill: 0.66 },
  { name: 'YUKI', color: 0x16171a, css: '#666b75', skill: 0.5 },
  { name: 'HANA', color: 0x0f8f5a, css: '#1fc47e', skill: 0.34 },
];

const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
renderer.toneMapping = THREE.NoToneMapping;
renderer.shadowMap.enabled = true;


function detectQuality() {
  const want = params.get('q') || (() => { try { return localStorage.getItem('satoyama.q'); } catch { return null; } })();
  if (QUALITY[want]) return want;
  const gl = renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
  const name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
  if (/V3D|llvmpipe|SwiftShader|softpipe|Mali|PowerVR|Adreno \(TM\) [1-5]/i.test(name)) return 'low';
  if (/Intel|Adreno|Apple GPU/i.test(name) && !/Arc|Iris\(R\) Xe/i.test(name)) return 'medium';
  return 'high';
}
const qName = detectQuality(), Q = QUALITY[qName];
renderer.shadowMap.type = Q.lowq ? THREE.BasicShadowMap : THREE.PCFShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, 1, 0.5, 15000);
const post = new Post(renderer, Q);
const audio = new EngineAudio();
let drs = 1;

function resize() {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, Q.dpr));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  const s = renderer.getDrawingBufferSize(new THREE.Vector2());
  post.setSize(s.x * Q.scale * drs, s.y * Q.scale * drs);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

// ------------------------------------------------------------------ input
const keys = new Set();
const input = { throttle: 0, brake: 0, steer: 0, handbrake: false, lookBack: false, start: false };
const IDLE = { throttle: 0, brake: 0, steer: 0, handbrake: true };
let oneShot = {};
window.addEventListener('keydown', (e) => {
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  if (!e.repeat) oneShot[e.code] = true;
  keys.add(e.code);
  audio.start();
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());
window.addEventListener('pointerdown', () => { audio.start(); oneShot.Enter = true; });
let padPrev = {};
function pollInput() {
  const k = (c) => keys.has(c);
  input.throttle = k('KeyW') || k('ArrowUp') ? 1 : 0;
  input.brake = k('KeyS') || k('ArrowDown') ? 1 : 0;
  input.steer = (k('KeyA') || k('ArrowLeft') ? 1 : 0) - (k('KeyD') || k('ArrowRight') ? 1 : 0);
  input.handbrake = k('Space');
  input.lookBack = k('KeyB');
  const gp = navigator.getGamepads ? [...navigator.getGamepads()].find((g) => g && g.connected) : null;
  if (gp) {
    const b = (i) => (gp.buttons[i] ? gp.buttons[i].value : 0);
    const ax = Math.abs(gp.axes[0]) > 0.1 ? gp.axes[0] : 0;
    input.throttle = Math.max(input.throttle, b(7)); input.brake = Math.max(input.brake, b(6));
    if (ax) input.steer = -Math.sign(ax) * Math.pow(Math.abs(ax), 1.6);
    input.handbrake = input.handbrake || b(0) > 0.5; input.lookBack = input.lookBack || b(1) > 0.5;
    const edge = (i, code) => { if (b(i) > 0.5 && !padPrev[i]) oneShot[code] = true; padPrev[i] = b(i) > 0.5; };
    edge(9, 'Enter'); edge(3, 'KeyC'); edge(8, 'KeyR');
  }
}

// ------------------------------------------------------------------ world
let track, terrain, colliders, sky, flora, hud, player, rivals = [], playerCar, smoke;
const loadBar = document.getElementById('loadBar'), loadText = document.getElementById('loadText');
const tick = (label, pct) => { loadText.textContent = label; loadBar.style.width = pct + '%'; return new Promise((r) => setTimeout(r, 30)); };

class Smoke {
  constructor(n = 220) {
    this.n = n; this.i = 0;
    this.pos = new Float32Array(n * 3); this.vel = new Float32Array(n * 3); this.life = new Float32Array(n); this.tint = new Float32Array(n);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('aLife', new THREE.BufferAttribute(this.life, 1));
    g.setAttribute('aTint', new THREE.BufferAttribute(this.tint, 1));
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, uniforms: { uScale: { value: 600 } },
      vertexShader: `attribute float aLife, aTint; uniform float uScale; varying float vLife, vTint;
        void main(){ vLife = aLife; vTint = aTint; vec4 mv = modelViewMatrix * vec4(position, 1.);
          gl_Position = projectionMatrix * mv; gl_PointSize = aLife > 0. ? uScale * (.5 + (1. - aLife) * 2.4) / max(-mv.z, .5) : 0.; }`,
      fragmentShader: `varying float vLife, vTint;
        void main(){ float d = length(gl_PointCoord - .5); float a = smoothstep(.5, .1, d) * vLife * .32; if (a < .01) discard;
          gl_FragColor = vec4(mix(vec3(.85, .82, .8), vec3(.42, .33, .22), vTint), a); }`,
    });
    this.points = new THREE.Points(g, this.mat); this.points.frustumCulled = false;
  }
  emit(x, y, z, vx, vy, vz, tint) {
    const i = this.i; this.i = (i + 1) % this.n;
    this.pos.set([x, y, z], i * 3); this.vel.set([vx, vy, vz], i * 3); this.life[i] = 1; this.tint[i] = tint;
  }
  update(dt) {
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] = Math.max(0, this.life[i] - dt * 0.9);
      for (let c = 0; c < 3; c++) { this.pos[i * 3 + c] += this.vel[i * 3 + c] * dt; this.vel[i * 3 + c] *= 1 - dt * 1.5; }
      this.pos[i * 3 + 1] += dt * 0.7;
    }
    const a = this.points.geometry.attributes;
    a.position.needsUpdate = a.aLife.needsUpdate = a.aTint.needsUpdate = true;
  }
}

async function build() {
  resize();
  initNoise();
  await tick('SURVEYING THE CIRCUIT', 8);
  track = new Track();
  colliders = new Colliders(16);
  await tick('RAISING MOUNTAINS', 20);
  terrain = new Terrain(track);
  await tick('LIGHTING THE SKY', 42);
  const h0 = Math.atan2(track.tx[0], track.tz[0]);
  orientSun(h0);
  sky = buildSky(scene, renderer, Q.lowq, { x: track.px[0], z: track.pz[0], heading: h0 });
  sky.sun.shadow.mapSize.set(Q.shadow, Q.shadow);
  await tick('BUILDING VILLAGES', 52);
  const props = buildProps(scene, track, terrain, colliders);
  await tick('FLOODING RICE PADDIES', 62);
  const tmat = terrain.buildMaterial(Q.lowq);
  scene.add(terrain.buildMesh(), buildShoulders(track, tmat), buildRoad(track), buildGuardrails(track));
  await tick('PLANTING SAKURA', 74);
  flora = buildFlora(scene, track, terrain, colliders, props.yardTrees, Q);
  await tick('TUNING ENGINES', 88);
  const world = { track, terrain, colliders };
  playerCar = buildCar(0xc2101c);
  scene.add(playerCar.group);
  player = new Vehicle(playerCar, world);
  RIVALS.forEach((r) => {
    const car = buildCar(r.color); scene.add(car.group);
    const rv = new Rival(car, track, 0, 0, r.skill, r.name); rv.css = r.css;
    rivals.push(rv);
  });
  smoke = new Smoke(); scene.add(smoke.points);
  hud = new Hud(track, rivals.length + 1);
  placeGrid();
  await tick('COMPILING SHADERS', 96);
  updateCamera(0.016); renderFrame();
  await tick('READY', 100);
  const ld = document.getElementById('loading'); ld.style.opacity = 0; setTimeout(() => ld.remove(), 900);
  hud.show('title', true);
  if (params.has('demo')) { beginCountdown(); state.cd = 0.01; }
  const ff = parseFloat(params.get('ff') || '0');
  for (let t = 0; t < ff; t += 1 / 60) step(1 / 60);
  window.__game = { state, player, rivals, track, terrain, renderer, scene, camera, post };
  last = performance.now();
  requestAnimationFrame(frame);
}

// ------------------------------------------------------------------ race state
const state = { mode: 'title', cd: 0, cdShown: 4, time: 0, prog: 0, lastIdx: 0, cpN: 0, pos: 6, wrongT: 0, cine: 1, finishT: 0, lapStart: 0, bestLap: 0 };
const demo = params.has('demo');
const gridSlot = (k) => ({ s: -(9 + Math.floor(k / 2) * 9), lat: k % 2 ? -2.4 : 2.4 });

function placeGrid() {
  rivals.forEach((r, k) => {
    const g = gridSlot(k);
    r.s = r.prog = g.s; r.lat = g.lat; r.v = 0; r.finishTime = 0; r.heading = 0; r.pose(0, 0);
  });
  const g = gridSlot(rivals.length), f = track.sample(g.s);
  player.place(f.x + f.lx * g.lat, f.z + f.lz * g.lat, Math.atan2(f.tx, f.tz));
  Object.assign(state, { time: 0, prog: g.s, lastIdx: player.idx, cpN: 0, pos: rivals.length + 1, wrongT: 0, finishT: 0, lapStart: 0, bestLap: 0 });
  camS.init = false;
}
function beginCountdown() {
  state.mode = 'countdown'; state.cd = 4.2; state.cdShown = 4;
  hud.show('title', false); hud.show('results', false); hud.show('hud', true);
  hud.set('split', '');
}
function restart() { placeGrid(); beginCountdown(); }
function resetToTrack() {
  const i = track.nearestGlobal(player.x, player.z);
  player.place(track.px[i], track.pz[i], Math.atan2(track.tx[i], track.tz[i]));
  state.lastIdx = player.idx;
}

const auto = { throttle: 0, brake: 0, steer: 0, handbrake: false };
function autopilot(cap = 999) {
  const v = player.speed, tgt = track.sample(player.idx * track.ds + 9 + v * 0.5);
  const e = wrapAngle(Math.atan2(tgt.x - player.x, tgt.z - player.z) - player.heading);
  auto.steer = clamp(e * 3, -1, 1);
  let maxK = 0;
  for (let d = 0; d < 26 + v * 1.8; d += 6) maxK = Math.max(maxK, Math.abs(track.curvAt(player.idx * track.ds + d)));
  const vt = Math.min(cap, Math.sqrt(11 / Math.max(maxK, 1e-4)));
  auto.throttle = v < vt ? 1 : 0; auto.brake = v > vt + 2 ? 1 : 0;
  return auto;
}

function collideRivals() {
  for (const r of rivals) {
    const dx = player.x - r.x, dz = player.z - r.z;
    if (dx * dx + dz * dz > 36) continue;
    const al = dx * r.fx + dz * r.fz, la = dx * r.fz - dz * r.fx; // rival frame: forward, left
    const penA = 4.5 - Math.abs(al), penL = 1.9 - Math.abs(la);
    if (penA <= 0 || penL <= 0) continue;
    if (penL < penA) {
      const s = Math.sign(la) || 1, lx = r.fz, lz = -r.fx;
      player.x += lx * s * penL; player.z += lz * s * penL;
      const vn = (player.vx * lx + player.vz * lz) * s;
      if (vn < 0) { player.vx -= lx * vn * s * 1.2; player.vz -= lz * vn * s * 1.2; player.impact = Math.max(player.impact, clamp(-vn * 0.15, 0.15, 0.8)); }
      r.lat = clamp(r.lat - s * penL * 0.5, -4, 4);
    } else {
      const s = Math.sign(al) || 1;
      player.x += r.fx * s * penA; player.z += r.fz * s * penA;
      const pv = player.vx * r.fx + player.vz * r.fz;
      if (s < 0 && pv > r.v) { const k = (r.v * 0.96) / Math.max(pv, 0.1); player.vx *= k; player.vz *= k; r.v += 1.2; player.impact = Math.max(player.impact, 0.5); }
      else if (s > 0 && r.v > pv) r.v = Math.max(0, pv * 0.96);
    }
  }
}

function finishRace() {
  state.mode = 'finish'; state.finishT = 0;
  const total = LAPS * track.length;
  const rows = rivals.map((r) => ({ name: r.name, t: r.finishTime || state.time + (total - r.prog) / Math.max(r.v, 35), me: false }));
  rows.push({ name: 'YOU', t: state.time, me: true });
  rows.sort((a, b) => a.t - b.t);
  const place = rows.findIndex((r) => r.me) + 1;
  state.pos = place;
  hud.banner('FINISH', fmtTime(state.time), 3);
  setTimeout(() => { if (state.mode === 'finish') { hud.results(rows.map((r) => ({ name: r.name, me: r.me, time: fmtTime(r.t) })), place); hud.show('hud', false); } }, 2600);
}

const proxy = { s: 0, lat: 0, v: 0 };
function step(dt) {
  gTime.value += dt;
  pollInput();
  const st = state;
  if (oneShot.KeyC) camS.mode = (camS.mode + 1) % 3;
  if (oneShot.KeyM) audio.toggleMute();
  for (let n = 1; n <= 4; n++) if (oneShot['Digit' + n]) {
    const name = Object.keys(QUALITY)[n - 1];
    try { localStorage.setItem('satoyama.q', name); } catch { /* ignore */ }
    params.set('q', name); location.search = params.toString();
  }
  const racing = st.mode === 'race';
  proxy.s = player.idx * track.ds; proxy.lat = player.lat; proxy.v = Math.max(0, player.vf);
  const others = [...rivals, proxy];

  if (st.mode === 'title') {
    player.update(dt, IDLE);
    if (oneShot.Enter || oneShot.Space) beginCountdown();
    st.cine = 1;
  } else if (st.mode === 'countdown') {
    st.cd -= dt;
    player.update(dt, IDLE);
    player.rpm = lerp(player.rpm, 1100 + input.throttle * 5200 + Math.sin(gTime.value * 30) * 60, Math.min(1, dt * 9));
    const n = Math.ceil(st.cd - 0.2);
    if (n < st.cdShown && n <= 3 && n >= 1) { st.cdShown = n; hud.count(String(n)); }
    st.cine = 1 - smoothstep(0.6, 2.6, 4.2 - st.cd);
    if (st.cd <= 0.2) { st.mode = 'race'; hud.count('GO!'); st.cine = 0; }
  } else if (racing) {
    st.time += dt;
    if (oneShot.KeyR) resetToTrack();
    player.update(dt, demo ? autopilot() : input);
    for (const r of rivals) r.update(dt, others, st.prog, true, st.time);
    collideRivals();
    if (Math.abs(player.lat) > 170) resetToTrack();
    let di = player.idx - st.lastIdx; const N = track.N;
    if (di > N / 2) di -= N; if (di < -N / 2) di += N;
    st.prog += di * track.ds; st.lastIdx = player.idx;
    const total = LAPS * track.length;
    for (const r of rivals) if (!r.finishTime && r.prog >= total) r.finishTime = st.time;
    st.pos = 1 + rivals.filter((r) => r.prog > st.prog).length;
    // checkpoints / laps
    const cps = [0.25, 0.5, 0.75, 1], thr = (Math.floor(st.cpN / 4) + cps[st.cpN % 4]) * track.length;
    if (st.prog >= thr) {
      const lapEnd = st.cpN % 4 === 3; st.cpN++;
      if (lapEnd) {
        const lt = st.time - st.lapStart; st.lapStart = st.time;
        if (!st.bestLap || lt < st.bestLap) st.bestLap = lt;
        hud.set('split', 'LAP ' + fmtTime(lt));
        if (st.cpN >= LAPS * 4) finishRace();
        else hud.banner(st.cpN / 4 === LAPS - 1 ? 'FINAL LAP' : 'LAP ' + (st.cpN / 4 + 1), fmtTime(lt));
      } else hud.banner('CHECKPOINT', fmtTime(st.time), 1.8);
    }
    const i = player.idx, along = Math.sin(player.heading) * track.tx[i] + Math.cos(player.heading) * track.tz[i];
    st.wrongT = along < -0.3 && player.vf > 4 ? st.wrongT + dt : 0;
    st.cine = Math.max(0, st.cine - dt);
  } else if (st.mode === 'finish') {
    st.finishT += dt;
    player.update(dt, autopilot(24));
    for (const r of rivals) { if (!r.finishTime && r.prog >= LAPS * track.length) r.finishTime = st.time + st.finishT; r.update(dt, others, st.prog, !r.finishTime, 0); }
    collideRivals();
    st.cine = Math.min(1, st.finishT / 1.5);
    if (oneShot.Enter && st.finishT > 2.6) restart();
  }
  if (st.mode === 'title' || st.mode === 'countdown') for (const r of rivals) r.pose(0, dt);

  // tyre smoke / dust
  if (player.speed > 7 && (player.slip > 3.2 || !player.onRoad)) {
    const sh = Math.sin(player.heading), ch = Math.cos(player.heading);
    for (const sx of [0.8, -0.8]) if (Math.random() < dt * 40) {
      smoke.emit(player.x - sh * 1.4 + ch * sx, player.y + 0.15, player.z - ch * 1.4 - sh * sx,
        player.vx * 0.25 + (Math.random() - 0.5) * 1.5, 0.6 + Math.random(), player.vz * 0.25 + (Math.random() - 0.5) * 1.5, player.onRoad ? 0 : 1);
    }
  }
  smoke.update(dt);
  audio.update(player.rpm, st.mode === 'race' && !demo ? input.throttle : 0.2, player.speed, player.slip, st.mode !== 'title');
  updateCamera(dt);
  hud.update(dt, {
    pos: st.pos, lap: Math.min(LAPS, Math.floor(st.cpN / 4) + 1), laps: LAPS, time: st.time, speed: player.vf, gear: player.gear, reverse: player.reverse,
    rpm: player.rpm, wrongWay: st.wrongT > 1, x: player.x, z: player.z, rivals: rivals.map((r) => ({ x: r.x, z: r.z, color: r.css })),
  });
  oneShot = {};
}

// ------------------------------------------------------------------ camera
const camS = { yaw: 0, cy: 0, mode: parseInt(params.get('cam') || '0', 10) || 0, init: false };
const V = { a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Vector3(), d: new THREE.Vector3(), look: new THREE.Vector3(), sun: new THREE.Vector3(), tgt: new THREE.Vector3() };
const dof = { focusNear: 4, focusFar: 50, farScale: 170, nearScale: 22, maxBlur: 4 };
let speedBlur = 0;
const camGround = (v, min) => { v.y = Math.max(v.y, terrain.heightAt(v.x, v.z) + min); };

function updateCamera(dt) {
  const p = player, sp = p.speed, sh = Math.sin(p.heading), ch = Math.cos(p.heading);
  if (!camS.init) { camS.yaw = p.heading; camS.cy = p.y; camS.init = true; }
  const velYaw = sp > 4 ? Math.atan2(p.vx, p.vz) : p.heading;
  const ty = p.heading + clamp(wrapAngle(velYaw - p.heading), -0.7, 0.7) * 0.45 + (input.lookBack ? Math.PI : 0);
  camS.yaw += wrapAngle(ty - camS.yaw) * (1 - Math.exp(-dt * (input.lookBack ? 40 : 6.5)));
  camS.cy = lerp(camS.cy, p.y, 1 - Math.exp(-dt * 9));
  const shake = Math.pow(sp / 85, 2) * 0.035 + p.impact * 0.35;
  let fovChase;
  const chase = V.a, chaseLook = V.b;
  if (camS.mode === 2) {
    chase.set(p.x + sh * 0.25, p.y + 1.12, p.z + ch * 0.25);
    chaseLook.set(p.x + sh * 20, p.y + 0.6 + Math.tan(p.pitch) * 20, p.z + ch * 20);
    fovChase = 66 + 18 * smoothstep(0, 85, sp);
  } else {
    const d = (camS.mode ? 9.6 : 6.3) + sp * 0.016, h = camS.mode ? 3.1 : 1.95;
    chase.set(p.x - Math.sin(camS.yaw) * d, camS.cy + h, p.z - Math.cos(camS.yaw) * d);
    camGround(chase, 0.8);
    chaseLook.set(p.x + sh * 3.5, camS.cy + 1.0, p.z + ch * 3.5);
    fovChase = 58 + 22 * smoothstep(0, 85, sp);
  }
  chaseLook.x += (Math.random() - 0.5) * shake; chaseLook.y += (Math.random() - 0.5) * shake;

  const t = gTime.value, a = t * 0.11 + 2.2, orbit = V.c, orbitLook = V.d;
  const rad = 7.4 + Math.sin(t * 0.17) * 0.9;
  orbit.set(p.x + Math.sin(p.heading + a) * rad, p.y + 1.0 + 0.45 * Math.sin(t * 0.23), p.z + Math.cos(p.heading + a) * rad);
  camGround(orbit, 0.45);
  orbitLook.set(p.x, p.y + 0.72, p.z);

  const k = smoothstep(0, 1, state.cine);
  camera.position.lerpVectors(chase, orbit, k);
  V.look.lerpVectors(chaseLook, orbitLook, k);
  camera.fov = lerp(fovChase, 31, k);
  camera.updateProjectionMatrix();
  camera.lookAt(V.look);

  const dist = camera.position.distanceTo(V.tgt.set(p.x, p.y + 0.7, p.z));
  dof.focusNear = lerp(camS.mode === 2 ? 0.6 : 3.0, dist * 0.92, k);
  dof.focusFar = lerp(60, dist * 1.08, k);
  dof.farScale = lerp(170, 85, k); dof.nearScale = lerp(camS.mode === 2 ? 0 : 20, 60, k);
  dof.maxBlur = lerp(3.8, 13, k);
  speedBlur = smoothstep(22, 85, sp) * (1 - k) * (camS.mode === 2 ? 1.25 : 1);

  // keep the shadow frustum, sky dome and petals centred on the action
  const sun = sky.sun, tx = lerp(p.x + sh * 28, p.x, k), tz = lerp(p.z + ch * 28, p.z, k);
  sun.target.position.set(tx, p.y, tz);
  sun.position.set(tx + SUN_DIR.x * 400, p.y + SUN_DIR.y * 400, tz + SUN_DIR.z * 400);
  sun.target.updateMatrixWorld();
  sky.sky.position.copy(camera.position);
  flora.petalMat.uniforms.uCam.value.copy(camera.position);
}

const postP = { time: 0, speed: 0, letterbox: 0, fade: 1, sun: new THREE.Vector3(), ...dof };
let fadeIn = 0;
function renderFrame() {
  camera.updateMatrixWorld();
  V.sun.copy(camera.position).addScaledVector(SUN_DIR, 1000).project(camera);
  const fwd = camera.getWorldDirection(V.tgt);
  postP.sun.set(V.sun.x * 0.5 + 0.5, V.sun.y * 0.5 + 0.5, fwd.dot(SUN_DIR) > 0 ? 1 : 0);
  Object.assign(postP, dof);
  postP.time = gTime.value; postP.speed = speedBlur; postP.letterbox = smoothstep(0, 1, state.cine); postP.fade = Math.min(1, fadeIn);
  flora.petalMat.uniforms.uScale.value = post.h * 0.055;
  smoke.mat.uniforms.uScale.value = post.h * 0.9;
  post.render(scene, camera, postP);
}

// ------------------------------------------------------------------ main loop
let last = 0, fpsAcc = 0, fpsN = 0, fpsT = 0, slowT = 0;
const fpsEl = document.getElementById('fps');
function frame(now) {
  requestAnimationFrame(frame);
  const raw = (now - last) / 1000; last = now;
  const dt = Math.min(0.05, Math.max(0.001, raw));
  fadeIn += dt * 0.8;
  step(dt);
  renderFrame();
  // dynamic resolution scaling keeps the frame rate playable on weaker GPUs
  fpsAcc += raw; fpsN++; fpsT += raw;
  if (fpsT > 1) {
    const fps = fpsN / fpsAcc; fpsAcc = fpsN = fpsT = 0;
    let nd = drs;
    const lo = Q.lowq ? 24 : 40, floor = Q.lowq ? 0.75 : 0.5;
    if (fps < lo) nd = Math.max(floor, drs - (fps < lo * 0.6 ? 0.15 : 0.08)); else if (fps > lo + 17 && drs < 1 && ++slowT > 2) { nd = Math.min(1, drs + 0.05); slowT = 0; }
    if (nd !== drs && !params.has('nodrs')) { drs = nd; resize(); }
    fpsEl.textContent = `${fps.toFixed(0)} FPS · ${post.w}×${post.h} · ${qName.toUpperCase()}`;
  }
}

build().catch((e) => { console.error(e); loadText.textContent = 'ERROR: ' + e.message; });
