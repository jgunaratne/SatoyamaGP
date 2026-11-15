import { Track } from './track.js';

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

// Shonan / Izu coastline: a sunlit seaside esplanade and fishing-port straight with the open Pacific and crashing surf
// immediately on the left (-X), a sweeping cove climb up onto a cape headland past a white lighthouse, fast pine-ridge
// sweepers inland, and a cliffside descent back to the harbour seawall.
const COAST_POINTS = [
  [-320, 3.6, -540], [-305, 3.3, -360], [-290, 3.1, -180], [-285, 3.0, 0], [-295, 3.1, 180], [-320, 3.4, 350],
  [-375, 5.5, 520], [-455, 11.0, 670], [-495, 22.0, 810], [-430, 36.0, 920],
  [-290, 44.0, 955], [-135, 42.0, 900], [-35, 34.0, 770],
  [85, 46.0, 620], [215, 56.0, 450], [295, 58.0, 250], [305, 50.0, 30],
  [255, 40.0, -180], [320, 32.0, -370], [310, 24.0, -550],
  [210, 16.0, -700], [60, 11.0, -775], [-105, 7.5, -770], [-245, 5.0, -690],
];

export const LEVELS = [
  {
    id: 'sakura', n: '01', name: 'SAKURA VALLEY CIRCUIT', laps: 2, room: '',
    blurb: 'Rice paddies, farm villages and cherry avenues. Fast and flowing.',
    track: {}, terrain: { farms: true, mountainFrom: 120, mountainTo: 620 }, lakes: [],
    flora: { forestFrom: 172, forest: 20000, nearForest: 0, sakura: 1, petals: 1, verge: null, rocks: 1 },
  },
  {
    id: 'hakone', n: '02', name: 'HAKONE LAKES PASS', laps: 2, room: 'H',
    blurb: 'Lakeshore sweepers, hairpins through cedar forest and a ridge road past a crater pond.',
    track: { points: HAKONE_POINTS, startNear: shore(-8, 3) },
    music: ['hakone1', 'hakone2'],
    // Late afternoon: the sun sits low over the lake, the light is deep amber and the shadows are long.
    sky: {
      el: 11, az: -58, sunColor: [1, 0.66, 0.4], sunIntensity: 6.4, hemi: 0.46, env: 0.95,
      zenith: [0.07, 0.15, 0.4], horizon: [0.56, 0.47, 0.5], glow: [1.7, 0.72, 0.3],
      cloudShade: [0.33, 0.26, 0.36], cloudLit: [1.7, 0.98, 0.58], fog: [0.68, 0.5, 0.41], fogDensity: 0.00052,
    },
    terrain: { farms: false, mountainFrom: 26, mountainTo: 430, roadDip: 1.6 },
    lakes: [ASHI, { x: 730, z: -70, a: 95, b: 95, level: 103, depth: 4 }],
    // a torii standing in the lake off the shore road
    torii: { x: ASHI.x + ASHI.a * 0.9 * Math.cos(0.09), z: ASHI.b * 0.9 * Math.sin(0.09), ry: Math.PI / 2, height: 9.5 },
    flora: {
      // the forest comes within 70 m of the road here; keep mid-detail crowns well past the visible bends
      forestFrom: 70, forest: 30000, forestLod: 680, nearForest: 2600, sakura: 0.35, petals: 0.2, rocks: 2,
      // forest-floor and moorland verge: pampas grass, ferns, azalea; no rapeseed
      verge: { grass_a: 0.2, grass_b: 0.32, fern: 0.28, nanohana: 0, shrub: 0.12, azalea: 0.08 },
    },
  },
  {
    id: 'coast', n: '03', name: 'SHONAN COASTAL HIGHWAY', laps: 2, room: 'C',
    blurb: 'Sunlit ocean esplanade, crashing turquoise surf, a cape lighthouse and pine-clad sea cliffs.',
    track: { points: COAST_POINTS, startNear: [-288, 3, -240] },
    music: ['coast1', 'coast2'],
    // Bright breezy coastal afternoon: crisp deep-azure zenith, sunlit marine horizon, open sea to the west (-X).
    sky: {
      el: 28, az: -62, sunColor: [1, 0.94, 0.84], sunIntensity: 8.1, hemi: 0.48, env: 0.95, openSea: true,
      zenith: [0.045, 0.19, 0.56], horizon: [0.46, 0.62, 0.74], glow: [1.35, 0.98, 0.62],
      cloudShade: [0.42, 0.48, 0.58], cloudLit: [1.55, 1.48, 1.38], fog: [0.54, 0.65, 0.74], fogDensity: 0.00032,
    },
    terrain: { farms: false, mountainFrom: 42, mountainTo: 420, roadDip: 2.2 },
    lakes: [],
    sea: {
      level: 0, depth: 15, shoreX: -322,
      waves: [[-35, 0.0042, -0.4], [18, 0.0095, 1.1], [8, 0.021, 2.0]],
      lighthouse: { x: -535, z: 810, baseY: 28, height: 28, ry: 0.6 },
      torii: { x: -358, z: -20, height: 10.2, ry: Math.PI / 2 },
      breakwaters: [[-520, -220, 26], [280, 510, 20]],
      boats: [
        [-385, -155, 0.35, 11.5], [-430, -35, 1.85, 10.5], [-395, 185, -0.55, 11.0],
        [-465, 390, 0.95, 11.5], [-390, -395, 2.4, 10.0],
      ],
      seaStacks: [
        [-560, -310, 9.5], [-640, 60, 14.0], [-590, 560, 11.5],
        [-720, 860, 16.0], [-490, -680, 10.0],
      ],
    },
    villages: [[-480, 260, 30]],
    flora: {
      forestFrom: 95, forest: 19000, forestLod: 520, nearForest: 1600, sakura: 0.22, petals: 0.06, rocks: 2.2,
      verge: { grass_a: 0.28, grass_b: 0.34, fern: 0.1, nanohana: 0.06, shrub: 0.14, azalea: 0.08 },
    },
  },
];

const get = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
export function currentLevel(params) {
  const want = params.get('level') || get();
  return LEVELS.find((l) => l.id === want) || LEVELS[0];
}

// Go to another course: remember it and reload on it. `go` ('race' | 'online') tells the fresh page to carry
// straight on into the countdown or the online lobby, so picking a course feels like one step.
export function gotoLevel(level, go = '') {
  try { localStorage.setItem(KEY, level.id); } catch { /* private mode */ }
  const u = new URL(location.href);
  u.searchParams.set('level', level.id); u.searchParams.delete('room');
  if (go) u.searchParams.set('go', go); else u.searchParams.delete('go');
  location.href = u.toString();
}

// Title-screen course line and the results heading for the course this page built.
export function showLevelName(level) {
  const el = document.querySelector('#title .lvl');
  if (el) { el.textContent = ''; const tag = document.createElement('b'); tag.textContent = `LEVEL ${level.n}`; el.append(tag, document.createTextNode(level.name)); }
  const sub = document.querySelector('#results .sub');
  if (sub) sub.textContent = `${level.name} · RESULTS`;
  document.title = `Satoyama GP — ${level.name.replace(/\b(\w)(\w*)/g, (_, a, b) => a + b.toLowerCase())}`;
}

const CSS = `
#course { position: fixed; inset: 0; z-index: 20; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2.4vh;
  background: rgba(6,7,12,.6); backdrop-filter: blur(8px); pointer-events: auto; font-style: italic; }
#course h2 { margin: 0; font-size: 7vh; font-weight: 900; line-height: 1; }
#course h2 em { color: var(--pink); font-style: inherit; }
#course .cards { display: flex; gap: 2.2vw; flex-wrap: wrap; justify-content: center; max-width: 96vw; }
#course .card { font: inherit; color: #fff; text-align: left; cursor: pointer; width: min(41vh, 29vw); padding: 0 0 1.8vh; background: rgba(11,12,16,.9);
  border: .5vh solid transparent; box-shadow: 0 1.5vh 4vh rgba(0,0,0,.5); transition: transform .12s, border-color .12s; }
#course .card[aria-pressed="true"] { border-color: var(--pink); transform: translateY(-1vh); }
#course canvas { display: block; width: 100%; aspect-ratio: 16 / 10; background: #10141b; }
#course .n { display: inline-block; margin: 1.6vh 0 0 1.8vh; background: var(--pink); padding: .2vh 1.2vh; font-size: 1.9vh; font-weight: 800; letter-spacing: .2em; }
#course .cur { margin-left: 1vh; font-size: 1.5vh; letter-spacing: .18em; color: var(--yellow); font-weight: 700; }
#course .name { margin: .8vh 1.8vh 0; font-size: 3.4vh; font-weight: 900; line-height: 1.05; }
#course .stat { margin: .6vh 1.8vh 0; font-size: 1.9vh; letter-spacing: .16em; font-weight: 700; color: var(--yellow); }
#course .blurb { margin: .8vh 1.8vh 0; font-size: 1.75vh; font-style: normal; opacity: .8; line-height: 1.35; min-height: 4.8vh; }
#course .hint { font-size: 1.9vh; letter-spacing: .2em; font-weight: 700; opacity: .85; font-style: normal; }
`;

/**
 * The course-select screen shown before a race. cfg: { level (the course this page built), hint() -> footer text,
 * onPick(level, go) with go = 'race' | 'online', onOpen(open) }. Input comes from the game's own input layer through
 * handleShots(), so keyboard and gamepad behave the same; cards are also clickable.
 */
export function initCourseSelect(cfg) {
  const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);
  const el = document.createElement('div');
  el.id = 'course'; el.className = 'hidden'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-labelledby', 'courseH');
  el.innerHTML = '<h2 id="courseH">CHOOSE A <em>COURSE</em></h2><div class="cards"></div><div class="hint"></div>';
  document.body.appendChild(el);
  el.addEventListener('pointerdown', (e) => e.stopPropagation());   // the game treats a click anywhere as "start"
  const cardsEl = el.querySelector('.cards'), hintEl = el.querySelector('.hint');
  let sel = Math.max(0, LEVELS.indexOf(cfg.level)), open = false, built = false;

  // Top-down map of a course: lakes, then the road, with the start line marked.
  function drawMap(canvas, level) {
    const t = new Track(level.track), W = (canvas.width = 480), H = (canvas.height = 300), g = canvas.getContext('2d');
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    const grow = (x, z) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); };
    for (let i = 0; i < t.N; i++) grow(t.px[i], t.pz[i]);
    for (const L of level.lakes) { grow(L.x - L.a, L.z - L.b); grow(L.x + L.a, L.z + L.b); }
    const sc = Math.min((W - 50) / (x1 - x0), (H - 50) / (z1 - z0)), mx = (x) => W / 2 + (x - (x0 + x1) / 2) * sc, mz = (z) => H / 2 + (z - (z0 + z1) / 2) * sc;
    if (level.sea) grow(level.sea.shoreX - 280, 0);
    const sc2 = Math.min((W - 50) / (x1 - x0), (H - 50) / (z1 - z0));
    const px = (x) => W / 2 + (x - (x0 + x1) / 2) * sc2, pz = (z) => H / 2 + (z - (z0 + z1) / 2) * sc2;
    g.fillStyle = '#17212a'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#2f7f9c';
    if (level.sea) {
      const shAt = (z) => { let s = level.sea.shoreX; for (const [a, f, p] of (level.sea.waves || [])) s += a * Math.sin(z * f + p); return s; };
      g.beginPath(); g.moveTo(0, 0);
      for (let py0 = 0; py0 <= H; py0 += 6) {
        const z = (py0 - H / 2) / sc2 + (z0 + z1) / 2;
        g.lineTo(px(shAt(z)), py0);
      }
      g.lineTo(0, H); g.closePath(); g.fill();
    }
    for (const L of level.lakes) { g.beginPath(); g.ellipse(px(L.x), pz(L.z), L.a * sc2, L.b * sc2, 0, 0, Math.PI * 2); g.fill(); }
    const path = () => { g.beginPath(); for (let i = 0; i <= t.N; i += 3) g.lineTo(px(t.px[i % t.N]), pz(t.pz[i % t.N])); g.closePath(); };
    g.lineJoin = 'round';
    path(); g.strokeStyle = 'rgba(0,0,0,.6)'; g.lineWidth = 11; g.stroke();
    path(); g.strokeStyle = '#fff'; g.lineWidth = 5; g.stroke();
    g.fillStyle = '#ffe14a'; g.beginPath(); g.arc(px(t.px[0]), pz(t.pz[0]), 7, 0, Math.PI * 2); g.fill();
    return t.length;
  }

  function build() {
    built = true;
    LEVELS.forEach((level, i) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'card'; b.tabIndex = -1;   // driven by the game's input layer; no DOM focus, so Enter is not handled twice
      const canvas = document.createElement('canvas'), km = (drawMap(canvas, level) / 1000).toFixed(1);
      const n = document.createElement('span'); n.className = 'n'; n.textContent = `LEVEL ${level.n}`;
      const cur = document.createElement('span'); cur.className = 'cur'; cur.textContent = level === cfg.level ? 'LOADED' : '';
      const name = document.createElement('div'); name.className = 'name'; name.textContent = level.name;
      const stat = document.createElement('div'); stat.className = 'stat'; stat.textContent = `${km} KM · ${level.laps} LAPS`;
      const blurb = document.createElement('div'); blurb.className = 'blurb'; blurb.textContent = level.blurb;
      b.append(canvas, n, cur, name, stat, blurb);
      b.addEventListener('click', () => { sel = i; render(); cfg.onPick(LEVELS[sel], 'race'); });
      b.addEventListener('pointerenter', () => { if (sel !== i) { sel = i; render(); } });
      cardsEl.appendChild(b);
    });
  }
  function render() {
    [...cardsEl.children].forEach((c, i) => c.setAttribute('aria-pressed', String(i === sel)));
    hintEl.textContent = cfg.hint();
  }
  const api = {
    get open() { return open; },
    setOpen(on) {
      open = on;
      if (on) { if (!built) build(); sel = Math.max(0, LEVELS.indexOf(cfg.level)); render(); }
      el.classList.toggle('hidden', !on);
      cfg.onOpen(on);
    },
    refresh() { if (open) render(); },
    // one-shot input codes from the game's input layer (keyboard and gamepad alike)
    handleShots(s) {
      if (s.ArrowLeft || s.ArrowUp) { sel = (sel + LEVELS.length - 1) % LEVELS.length; render(); }
      else if (s.ArrowRight || s.ArrowDown) { sel = (sel + 1) % LEVELS.length; render(); }
      else if (s.Enter || s.Space) cfg.onPick(LEVELS[sel], 'race');
      else if (s.KeyO) cfg.onPick(LEVELS[sel], 'online');
      else if (s.Escape) api.setOpen(false);
    },
  };
  return api;
}
