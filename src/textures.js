import * as THREE from 'three';

// AI-generated texture maps (public/textures/, sources and prompts in tools/generate_textures.sh).
// Mirrored repeat makes any generated image tile without visible seams.
const BASE = import.meta.env.BASE_URL + 'textures/';
const loader = new THREE.TextureLoader(), cache = new Map();
export function loadTexture(path, { srgb = true, wrap = THREE.MirroredRepeatWrapping, aniso = 8 } = {}) {
  const key = path + '|' + wrap;
  if (cache.has(key)) return cache.get(key);
  const t = loader.load(BASE + path);
  t.wrapS = t.wrapT = wrap; t.anisotropy = aniso;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, t);
  return t;
}
