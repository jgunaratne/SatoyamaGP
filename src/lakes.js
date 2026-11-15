import * as THREE from 'three';
import { NOISE_TEX_GLSL, gNoise, gTime, mulberry32 } from './util.js';
import { scatter } from './models.js';
import { TSIZE, TN } from './terrain.js';

// Calm lake water: one flat ellipse per lake. Layered moving ripples perturb the normal in the fragment shader.
function waterMaterial() {
  const mat = new THREE.MeshStandardMaterial({ color: 0x0a2a30, roughness: 0.07, metalness: 0, envMapIntensity: 1.5 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = gTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWater;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWater = (modelMatrix * vec4(position, 1.)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uTime; varying vec3 vWater;
        vec2 ripple(vec2 p, float t) {
          vec2 g = vec2(0.);
          vec2 d = vec2(.8, .6); float k = .7, a = .05;
          for (int i = 0; i < 6; i++) {
            float ph = dot(p, d) * k + t * (1.1 + .35 * float(i));
            g += d * (a * k * cos(ph));
            d = vec2(d.x * .58 - d.y * .81, d.x * .81 + d.y * .58); k *= 1.72; a *= .6;
          }
          return g;
        }`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          float dist = length(vViewPosition);
          vec2 g = ripple(vWater.xz, uTime) * (1. / (1. + dist * .012));
          normal = normalize((viewMatrix * vec4(normalize(vec3(-g.x, 1., -g.y)), 0.)).xyz);
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          float facing = clamp(dot(normalize(vViewPosition), normalize((viewMatrix * vec4(0., 1., 0., 0.)).xyz)), 0., 1.);
          diffuseColor.rgb = mix(vec3(.012, .05, .06), vec3(.03, .15, .16), facing * facing);
        }`);
  };
  mat.customProgramCacheKey = () => 'lakeWater';
  return mat;
}

// Open ocean material: samples a GPU seabed-depth texture so water transitions from deep Pacific cobalt offshore to
// luminous turquoise over shallow sandbars, with animated rolling shoreward surf lines and whitecap foam.
function seaMaterial(depthTex, seaLevel) {
  const mat = new THREE.MeshStandardMaterial({ color: 0x0b3c58, roughness: 0.08, metalness: 0, envMapIntensity: 1.55 });
  const half = TSIZE / 2;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = gTime;
    sh.uniforms.uNoise = gNoise;
    sh.uniforms.uSeaDepth = { value: depthTex };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWater;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWater = (modelMatrix * vec4(position, 1.)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uTime; uniform sampler2D uSeaDepth; varying vec3 vWater;
        float gSeaRough; float gSeaDepth;
        ${NOISE_TEX_GLSL}
        vec2 swell(vec2 p, float t, float chop) {
          vec2 g = vec2(0.);
          // Long ocean swells rolling shoreward (+X) plus wind chop
          vec2 d0 = normalize(vec2(.95, .18));
          g += d0 * (.11 * .13 * cos(dot(p, d0) * .13 - t * 1.45));
          vec2 d1 = normalize(vec2(.86, -.28));
          g += d1 * (.07 * .23 * cos(dot(p, d1) * .23 - t * 1.85 + 1.3));
          vec2 d = vec2(.78, .62); float k = .55, a = .048 * chop;
          for (int i = 0; i < 5; i++) {
            float ph = dot(p, d) * k + t * (1.25 + .38 * float(i));
            g += d * (a * k * cos(ph));
            d = vec2(d.x * .58 - d.y * .81, d.x * .81 + d.y * .58); k *= 1.78; a *= .58;
          }
          return g;
        }`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          float dist = length(vViewPosition);
          float atten = 1. / (1. + dist * .0065);
          vec2 g = swell(vWater.xz, uTime, smoothstep(.4, 4., gSeaDepth)) * atten;
          normal = normalize((viewMatrix * vec4(normalize(vec3(-g.x, 1., -g.y)), 0.)).xyz);
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          float seaDepth = 18.;
          vec2 duv = (vWater.xz + ${half.toFixed(1)}) / ${TSIZE.toFixed(1)};
          if (duv.x > 0. && duv.x < 1. && duv.y > 0. && duv.y < 1.) {
            seaDepth = texture2D(uSeaDepth, duv).r * 24.;
          }
          gSeaDepth = seaDepth;
          float facing = clamp(dot(normalize(vViewPosition), normalize((viewMatrix * vec4(0., 1., 0., 0.)).xyz)), 0., 1.);
          float shallow = 1. - smoothstep(.3, 9.5, seaDepth);
          vec3 deepCol = mix(vec3(.009, .042, .085), vec3(.018, .105, .175), facing);
          vec3 turquoise = mix(vec3(.02, .19, .22), vec3(.08, .36, .34), facing);
          vec3 col = mix(deepCol, turquoise, shallow * .88);

          // Rolling surf bands & shoreline swash where seabed rises toward 0 m
          float surfZone = 1. - smoothstep(.0, 5.2, seaDepth);
          float n = tf(vWater.xz * .06 + vec2(-uTime * .08, uTime * .02));
          float nFine = tn(vWater.xz * .65 + vec2(-uTime * .35, .0));
          float wavePhase = seaDepth * 2.35 - uTime * 2.15 + n * 4.2;
          float breaker = pow(max(0., sin(wavePhase)), 5.) * surfZone * smoothstep(.12, 1.1, seaDepth);
          float shoreFoam = (1. - smoothstep(.0, .85 + .45 * sin(uTime * 1.6 + vWater.z * .05), seaDepth));
          // Offshore wind whitecaps on open swells
          float whitecap = smoothstep(.74, .88, tf(vWater.xz * .035 + vec2(uTime * .03, -uTime * .02))) * (1. - surfZone) * .35;
          float foam = clamp((breaker * (.65 + .55 * nFine) + shoreFoam * (.75 + .35 * nFine) + whitecap) * (1. / (1. + length(vViewPosition) * .0018)), 0., 1.);
          col = mix(col, vec3(.86, .91, .94), foam);
          gSeaRough = mix(.065, .62, foam);
          diffuseColor.rgb = col;
        }`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = gSeaRough;');
  };
  mat.customProgramCacheKey = () => 'openSeaWater_' + seaLevel;
  return mat;
}

function buildSeaDepthTexture(terrain, seaLevel) {
  const n = TN + 1, data = new Uint8Array(n * n * 4);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const h = terrain.H[j * n + i];
      const depth = Math.max(0, Math.min(24, seaLevel - h));
      const o = (j * n + i) * 4;
      data[o] = Math.round((depth / 24) * 255);
      data[o + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

export function buildLakes(scene, level, terrain, models, colliders) {
  const group = new THREE.Group();
  const hasLakes = level.lakes && level.lakes.length > 0;
  const sea = level.sea;
  if (!hasLakes && !sea) return group;
  scene.add(group);

  if (hasLakes) {
    const mat = waterMaterial();
    for (const L of level.lakes) {
      const geo = new THREE.CircleGeometry(1, 96);
      geo.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(geo, mat);
      m.scale.set(L.a * 1.07, 1, L.b * 1.07); m.position.set(L.x, L.level, L.z);
      m.receiveShadow = true;
      group.add(m);
    }
    const t = level.torii, tm = models && models.get('torii');
    if (t && tm) {
      const lake = terrain.lakeAt(t.x, t.z) || level.lakes[0];
      group.add(scatter(tm, [{ x: t.x, y: lake.level - 0.8, z: t.z, ry: t.ry, s: t.height / tm.size.y }], { cell: 200, dist: [170, 520], cast: 2 }));
    }
  }

  if (sea) {
    const depthTex = buildSeaDepthTexture(terrain, sea.level);
    const oceanGeo = new THREE.PlaneGeometry(16000, 18000, 1, 1);
    oceanGeo.rotateX(-Math.PI / 2);
    const ocean = new THREE.Mesh(oceanGeo, seaMaterial(depthTex, sea.level));
    ocean.position.set(-6800, sea.level, 0);
    ocean.receiveShadow = true;
    group.add(ocean);

    const rng = mulberry32(90210);

    // Cape headland lighthouse overlooking the sea
    const lh = sea.lighthouse, lhM = models && models.get('lighthouse');
    if (lh && lhM) {
      const y = terrain.heightAt(lh.x, lh.z) - 0.35;
      group.add(scatter(lhM, [{ x: lh.x, y, z: lh.z, ry: lh.ry || 0, s: (lh.height || 20) / lhM.size.y }], { cell: 256, dist: [260, 850], cast: 2 }));
      if (colliders) colliders.add(lh.x, lh.z, 3.8);
    }

    // Concrete tetrapod breakwater clusters along exposed seawalls and headlands
    const tpM = models && models.get('tetrapod');
    if (tpM && sea.breakwaters) {
      const items = [];
      for (const [z0, z1, count] of sea.breakwaters) {
        for (let k = 0; k < count; k++) {
          const z = z0 + (z1 - z0) * (k / Math.max(1, count - 1)) + (rng() - 0.5) * 6;
          const sh = terrain.shoreAt(z);
          for (let row = 0; row < 2; row++) {
            const x = sh - 3 - row * 3.8 + (rng() - 0.5) * 2.2;
            if (terrain.distAt(x, z) < 9.5) continue;
            const h = 2.0 + rng() * 0.65;
            const y = Math.max(sea.level - 0.85, terrain.heightAt(x, z) - 0.45);
            items.push({ x, y, z, ry: rng() * 6.28, s: h / tpM.size.y });
          }
        }
      }
      group.add(scatter(tpM, items, { cell: 48, dist: [110, 340], far: 950, cast: 2 }));
    }

    // Moored coastal fishing boats floating in the bay & cove
    const boatM = models && models.get('fishing_boat');
    if (boatM && sea.boats) {
      const items = sea.boats.map(([x, z, ry, len = 9.5]) => ({
        x, y: sea.level - 0.42, z, ry, s: len / Math.max(boatM.size.x, boatM.size.z),
      }));
      group.add(scatter(boatM, items, { cell: 256, dist: [220, 680], cast: 2 }));
    }

    // Sea-stack torii gate standing on an offshore reef rock
    const st = sea.torii, tm = models && models.get('torii'), rkM = models && models.get('boulder_a');
    if (st && tm) {
      if (rkM) {
        group.add(scatter(rkM, [{ x: st.x, y: sea.level - 1.2, z: st.z, ry: 0.7, s: 4.8 / rkM.size.y }], { cell: 200, dist: [220, 680], cast: 2 }));
      }
      group.add(scatter(tm, [{ x: st.x, y: sea.level + 1.8, z: st.z, ry: st.ry || Math.PI / 2, s: (st.height || 9.0) / tm.size.y }], { cell: 200, dist: [220, 680], cast: 2 }));
    }

    // Offshore sea stacks / rocky islets dotting the bay
    const rocks = models && models.all('boulder_a', 'boulder_b');
    if (rocks && sea.seaStacks) {
      const lists = rocks.map(() => []);
      sea.seaStacks.forEach(([x, z, h], idx) => {
        const v = idx % rocks.length;
        lists[v].push({ x, y: sea.level - h * 0.22, z, ry: idx * 2.1, s: h / rocks[v].size.y });
      });
      rocks.forEach((m, v) => group.add(scatter(m, lists[v], { cell: 256, dist: [260, 820], cast: 2 })));
    }
  }

  return group;
}
