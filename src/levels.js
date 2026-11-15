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
#course .card { font: inherit; color: #fff; text-align: left; cursor: pointer; width: min(46vh, 44vw); padding: 0 0 1.8vh; background: rgba(11,12,16,.9);
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
    g.fillStyle = '#17212a'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#2f7f9c';
    for (const L of level.lakes) { g.beginPath(); g.ellipse(mx(L.x), mz(L.z), L.a * sc, L.b * sc, 0, 0, Math.PI * 2); g.fill(); }
    const path = () => { g.beginPath(); for (let i = 0; i <= t.N; i += 3) g.lineTo(mx(t.px[i % t.N]), mz(t.pz[i % t.N])); g.closePath(); };
    g.lineJoin = 'round';
    path(); g.strokeStyle = 'rgba(0,0,0,.6)'; g.lineWidth = 11; g.stroke();
    path(); g.strokeStyle = '#fff'; g.lineWidth = 5; g.stroke();
    g.fillStyle = '#ffe14a'; g.beginPath(); g.arc(mx(t.px[0]), mz(t.pz[0]), 7, 0, Math.PI * 2); g.fill();
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
