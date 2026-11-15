import * as THREE from 'three';
import { gTime } from './util.js';
import { scatter } from './models.js';

// Lake water: one flat ellipse per lake. All of the look is in the fragment shader (GPU): layered moving ripples
// perturb the normal, so the sky reflection and the low sun break up into glitter, and the colour darkens with the
// viewing angle. The terrain bowl underneath (terrain.js) provides the shoreline.
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
        // slope of a sum of travelling sine ripples; wavelengths from 9 m down to 0.6 m
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
          vec2 g = ripple(vWater.xz, uTime) * (1. / (1. + dist * .012));     // calmer toward the horizon: no shimmer
          normal = normalize((viewMatrix * vec4(normalize(vec3(-g.x, 1., -g.y)), 0.)).xyz);
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          float facing = clamp(dot(normalize(vViewPosition), normalize((viewMatrix * vec4(0., 1., 0., 0.)).xyz)), 0., 1.);
          diffuseColor.rgb = mix(vec3(.012, .05, .06), vec3(.03, .15, .16), facing * facing);   // deep teal looking down
        }`);
  };
  mat.customProgramCacheKey = () => 'lakeWater';
  return mat;
}

export function buildLakes(scene, level, terrain, models) {
  const group = new THREE.Group();
  if (!level.lakes || !level.lakes.length) return group;
  scene.add(group);
  const mat = waterMaterial();
  for (const L of level.lakes) {
    const geo = new THREE.CircleGeometry(1, 96);
    geo.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(geo, mat);
    m.scale.set(L.a * 1.07, 1, L.b * 1.07); m.position.set(L.x, L.level, L.z);
    m.receiveShadow = true;
    group.add(m);
  }
  // The red gate standing in the water.
  const t = level.torii, tm = models && models.get('torii');
  if (t && tm) {
    const lake = terrain.lakeAt(t.x, t.z) || level.lakes[0];
    group.add(scatter(tm, [{ x: t.x, y: lake.level - 0.8, z: t.z, ry: t.ry, s: t.height / tm.size.y }], { cell: 200, dist: [170, 520], cast: 2 }));
  }
  return group;
}
