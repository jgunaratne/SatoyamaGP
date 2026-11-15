// Course definitions. A level picks the centreline, how the terrain around it is shaped, what grows there,
// and any lakes. The world is generated once at load, so changing course reloads the page (like graphics settings).
const KEY = 'satoyama.level';

// Hakone: a big caldera lake (think Ashinoko) with the road along its east shore, a climb through cedar forest to a
// ridge, a small crater pond at the top, and a fast descent back to the water. Points are [x, y, z] in metres.
const ASHI = { x: -450, z: 0, a: 330, b: 520, level: 0, depth: 10 };
const shore = (deg, y) => { const t = (deg * Math.PI) / 180; return [ASHI.x + (ASHI.a + 45) * Math.cos(t), y, (ASHI.b + 45) * Math.sin(t)]; };
const HAKONE_POINTS = [
  shore(-70, 3.2), shore(-45, 3), shore(-20, 3), shore(5, 3), shore(30, 3), shore(55, 3.5),   // lakeshore, heading north
  [-280, 10, 640], [-150, 24, 780], [0, 36, 800],                                               // leave the lake, start climbing
  [89, 43, 791], [149, 47, 781], [169, 51, 725], [130, 56, 679],                                // right-hand hairpin (60 m radius)
  [35, 63, 614], [-7, 67, 579], [3, 71, 525], [55, 75, 506],                                    // left-hand hairpin (55 m radius)
  [140, 82, 465], [220, 88, 440], [380, 100, 480], [500, 112, 380],                             // up to the pass
  [590, 112, 150], [600, 107, -60], [580, 105, -260],                                           // ridge road past the crater pond
  [500, 96, -430], [400, 82, -620], [240, 66, -770], [50, 50, -830],                            // long descent
  [-120, 34, -790], [-240, 19, -690], [-340, 8.5, -600],                                         // back down to the water
];

export const LEVELS = [
  {
    id: 'sakura', n: '01', name: 'SAKURA VALLEY CIRCUIT', laps: 2, room: '',
    track: {}, terrain: { farms: true, mountainFrom: 120, mountainTo: 620 }, lakes: [],
    flora: { forestFrom: 172, forest: 20000, nearForest: 0, sakura: 1, petals: 1, verge: null, rocks: 1 },
  },
  {
    id: 'hakone', n: '02', name: 'HAKONE LAKES PASS', laps: 2, room: 'H',
    track: { points: HAKONE_POINTS, startNear: shore(-8, 3) },
    terrain: { farms: false, mountainFrom: 26, mountainTo: 430, roadDip: 1.6 },
    lakes: [ASHI, { x: 730, z: -70, a: 95, b: 95, level: 103, depth: 4 }],
    // a torii standing in the lake off the shore road
    torii: { x: ASHI.x + ASHI.a * 0.9 * Math.cos(0.09), z: ASHI.b * 0.9 * Math.sin(0.09), ry: Math.PI / 2, height: 9.5 },
    flora: {
      // the forest comes within 70 m of the road here, so its mid-detail ring is pulled in to stay affordable
      forestFrom: 70, forest: 30000, forestLod: 230, nearForest: 2600, sakura: 0.35, petals: 0.2, rocks: 2,
      // forest-floor and moorland verge: pampas grass, ferns, azalea; no rapeseed
      verge: { grass_a: 0.2, grass_b: 0.32, fern: 0.28, nanohana: 0, shrub: 0.12, azalea: 0.08 },
    },
  },
];

const get = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
export function currentLevel(params) {
  const want = params.get('level') || get();
  return LEVELS.find((l) => l.id === want) || LEVELS[0];
}

// Switch course: remember it and reload on the new one (the invite link, if any, keeps its other parameters).
export function switchLevel(level, dir) {
  const i = LEVELS.indexOf(level), next = LEVELS[(i + dir + LEVELS.length) % LEVELS.length];
  if (next === level) return;
  try { localStorage.setItem(KEY, next.id); } catch { /* private mode */ }
  const u = new URL(location.href);
  u.searchParams.set('level', next.id); u.searchParams.delete('room');
  location.href = u.toString();
}

// Title-screen course line: "◀ LEVEL 02  HAKONE LAKES PASS ▶", clickable, and the results heading.
export function initLevelPicker(level) {
  const el = document.querySelector('#title .lvl');
  if (el) {
    el.textContent = '';
    const mk = (label, dir, aria) => {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = label; b.setAttribute('aria-label', aria);
      b.style.cssText = 'font:inherit;color:inherit;background:none;border:0;cursor:pointer;pointer-events:auto;padding:0 .5em;text-shadow:inherit';
      b.addEventListener('click', () => switchLevel(level, dir));
      b.addEventListener('pointerdown', (e) => e.stopPropagation());   // a click anywhere else starts the race
      return b;
    };
    const tag = document.createElement('b'); tag.textContent = `LEVEL ${level.n}`;
    el.append(mk('◀', -1, 'Previous course'), tag, document.createTextNode(level.name), mk('▶', 1, 'Next course'));
  }
  const sub = document.querySelector('#results .sub');
  if (sub) sub.textContent = `${level.name} · RESULTS`;
  document.title = `Satoyama GP — ${level.name.replace(/\b(\w)(\w*)/g, (_, a, b) => a + b.toLowerCase())}`;
}
