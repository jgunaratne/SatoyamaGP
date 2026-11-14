// Graphics settings: preset + per-option overrides, persisted in localStorage and applied on reload
// (almost everything here decides what gets built or allocated, so a reload is the honest way to apply it).
const KEY_PRESET = 'satoyama.q', KEY_CUSTOM = 'satoyama.gfx';

// Each option maps a label to the values it writes into the quality object.
export const OPTIONS = [
  { id: 'models', label: '3D MODELS', hint: 'TRELLIS meshes. Full: 150k+ triangles up close. Reduced: simplified scenery only.',
    choices: [['CLASSIC', { models: 'off' }], ['REDUCED', { models: 'lite' }], ['FULL DETAIL', { models: 'full' }]] },
  { id: 'lod', label: 'DETAIL DISTANCE', hint: 'How far away high-detail models are kept.',
    choices: [['NEAR', { lod: 0.45 }], ['NORMAL', { lod: 0.7 }], ['FAR', { lod: 1 }], ['VERY FAR', { lod: 1.6 }]] },
  { id: 'density', label: 'VEGETATION', hint: 'Amount of grass, verge plants and forest.',
    choices: [['SPARSE', { density: 0.22 }], ['NORMAL', { density: 0.6 }], ['DENSE', { density: 1 }], ['LUSH', { density: 1.4 }]] },
  { id: 'shadow', label: 'SHADOWS', hint: 'Shadow map resolution.',
    choices: [['LOW', { shadow: 1024 }], ['MEDIUM', { shadow: 2048 }], ['HIGH', { shadow: 4096 }]] },
  { id: 'scale', label: 'RENDER SCALE', hint: 'Internal resolution. Lower is much faster on weak GPUs.',
    choices: [['60%', { scale: 0.6 }], ['80%', { scale: 0.8 }], ['100%', { scale: 1 }]] },
  { id: 'msaa', label: 'ANTI-ALIASING', hint: 'Multisampling of geometry edges.',
    choices: [['OFF', { msaa: 0 }], ['MSAA 4×', { msaa: 4 }]] },
  { id: 'fx', label: 'EFFECTS', hint: 'Depth of field and motion blur sample counts.',
    choices: [['LOW', { dofTaps: 8, blurSamples: 2 }], ['MEDIUM', { dofTaps: 22, blurSamples: 4 }], ['HIGH', { dofTaps: 40, blurSamples: 6 }], ['ULTRA', { dofTaps: 64, blurSamples: 8 }]] },
  { id: 'adaptive', label: 'ADAPTIVE QUALITY', hint: 'Automatically trims detail and resolution to hold the frame rate.',
    choices: [['OFF', { adaptive: false }], ['ON', { adaptive: true }]] },
];

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* private mode */ } },
};
const matches = (q, vals) => Object.entries(vals).every(([k, v]) => q[k] === v);
const choiceOf = (opt, q) => Math.max(0, opt.choices.findIndex(([, vals]) => matches(q, vals)));

export function storedPreset() { return store.get(KEY_PRESET); }
export function clearCustom() { store.set(KEY_CUSTOM, null); }

// Preset values with the player's saved per-option choices layered on top. `?q=` in the URL means "exactly this preset".
export function resolveQuality(preset, params) {
  const q = { ...preset };
  if (params.get('q')) return q;
  let custom = null;
  try { custom = JSON.parse(store.get(KEY_CUSTOM) || 'null'); } catch { custom = null; }
  if (custom) for (const opt of OPTIONS) { const c = opt.choices[custom[opt.id]]; if (c) Object.assign(q, c[1]); }
  return q;
}

const CSS = `
#gfxBtn { position: fixed; right: 3vw; top: 3.5vh; z-index: 30; pointer-events: auto; cursor: pointer; font: inherit; font-weight: 800; font-style: italic;
  font-size: 2.2vh; letter-spacing: .16em; color: #fff; background: rgba(11,12,16,.55); border: 2px solid rgba(255,255,255,.6); padding: .9vh 1.6vw; backdrop-filter: blur(6px); }
#gfxBtn:hover, #gfxBtn:focus-visible { background: var(--pink); border-color: var(--pink); outline: none; }
#gfxBtn kbd { font: inherit; color: var(--yellow); margin-left: .6em; }
#gfx { position: fixed; inset: 0; z-index: 40; display: flex; align-items: center; justify-content: center; background: rgba(5,6,10,.62); backdrop-filter: blur(10px); }
#gfx .card { width: min(880px, 94vw); max-height: 94vh; overflow: auto; background: rgba(11,12,16,.94); border-left: 6px solid var(--pink); padding: 3vh 2.6vw; box-shadow: 0 2vh 6vh rgba(0,0,0,.6); }
#gfx h2 { margin: 0; font-size: 5vh; font-weight: 900; font-style: italic; line-height: 1; }
#gfx h2 em { color: var(--pink); font-style: inherit; }
#gfx .gpu { margin: .8vh 0 2vh; font-size: 1.7vh; letter-spacing: .08em; opacity: .75; }
#gfx .gpu b { color: var(--yellow); }
#gfx .row { display: grid; grid-template-columns: 11.5em 1fr; gap: 1em; align-items: center; padding: .7vh 0; border-top: 1px solid rgba(255,255,255,.09); }
#gfx .row .lab { font-size: 1.9vh; font-weight: 800; letter-spacing: .14em; }
#gfx .row .lab small { display: block; font-weight: 500; letter-spacing: .02em; font-size: 1.35vh; opacity: .6; margin-top: .2vh; }
#gfx .seg { display: flex; gap: .4em; flex-wrap: wrap; }
#gfx button { font: inherit; cursor: pointer; color: #fff; background: rgba(255,255,255,.08); border: 2px solid transparent; padding: .7vh 1em; font-size: 1.75vh; font-weight: 700; letter-spacing: .1em; }
#gfx button:hover { background: rgba(255,255,255,.2); }
#gfx button:focus-visible { outline: 2px solid var(--yellow); outline-offset: 2px; }
#gfx button[aria-pressed="true"] { background: var(--pink); }
#gfx button.rec::after { content: ' ★'; color: var(--yellow); }
#gfx .presets button { font-size: 2.1vh; font-style: italic; font-weight: 900; padding: 1vh 1.3em; }
#gfx .foot { display: flex; gap: 1em; justify-content: flex-end; align-items: center; margin-top: 2.2vh; }
#gfx .foot .note { margin-right: auto; font-size: 1.45vh; opacity: .6; }
#gfx .foot .apply { background: var(--yellow); color: #111; font-weight: 900; }
#gfx .foot .apply:hover { background: #fff; }
`;

/**
 * Adds the GRAPHICS button to the title screen and the settings dialog behind it.
 * cfg: { presets, active (preset name in use), auto (true when the preset was auto-detected), recommended, gpu, Q, isTitle() }
 */
export function initSettings(cfg) {
  const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);
  const names = Object.keys(cfg.presets);
  const btn = document.createElement('button');
  btn.id = 'gfxBtn'; btn.type = 'button'; btn.innerHTML = 'GRAPHICS<kbd>G</kbd>';
  document.body.appendChild(btn);

  const dlg = document.createElement('div');
  dlg.id = 'gfx'; dlg.className = 'hidden'; dlg.setAttribute('role', 'dialog'); dlg.setAttribute('aria-modal', 'true'); dlg.setAttribute('aria-labelledby', 'gfxH');
  dlg.innerHTML = `<div class="card">
    <h2 id="gfxH">GRAPHICS <em>SETTINGS</em></h2>
    <div class="gpu">DETECTED GPU: <b></b></div>
    <div class="row presets"><div class="lab">PRESET<small>★ recommended for this computer</small></div><div class="seg" data-opt="preset"></div></div>
    ${OPTIONS.map((o) => `<div class="row"><div class="lab">${o.label}<small>${o.hint}</small></div><div class="seg" data-opt="${o.id}"></div></div>`).join('')}
    <div class="foot"><span class="note">Changes reload the game. Keys 1–4 switch presets directly.</span>
      <button type="button" class="cancel">CANCEL</button><button type="button" class="apply">APPLY &amp; RELOAD</button></div></div>`;
  document.body.appendChild(dlg);
  dlg.querySelector('.gpu b').textContent = `${cfg.gpu || 'unknown'} — recommended ${cfg.recommended.toUpperCase()}`;

  // working copy: preset = 'auto' | name, sel = choice index per option
  const state = { preset: cfg.auto ? 'auto' : cfg.active, sel: {} };
  for (const o of OPTIONS) state.sel[o.id] = choiceOf(o, cfg.Q);
  const initial = JSON.stringify(state);
  const presetQ = () => cfg.presets[state.preset === 'auto' ? cfg.recommended : state.preset];

  const seg = (id) => dlg.querySelector(`[data-opt="${id}"]`);
  const mk = (parent, label, pressed, onClick, rec = false) => {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = label; b.setAttribute('aria-pressed', String(pressed)); if (rec) b.className = 'rec';
    b.addEventListener('click', onClick); parent.appendChild(b);
  };
  function render() {
    // buttons are rebuilt on every change; remember which one had keyboard focus and give it back
    const a = document.activeElement, key = a && a.parentNode && a.parentNode.dataset ? a.parentNode.dataset.opt : null;
    const at = key ? [...a.parentNode.children].indexOf(a) : -1;
    const p = seg('preset'); p.textContent = '';
    for (const n of ['auto', ...names]) {
      mk(p, n.toUpperCase(), state.preset === n, () => { state.preset = n; for (const o of OPTIONS) state.sel[o.id] = choiceOf(o, presetQ()); render(); }, n === cfg.recommended);
    }
    for (const o of OPTIONS) {
      const el = seg(o.id); el.textContent = '';
      o.choices.forEach(([label], i) => mk(el, label, state.sel[o.id] === i, () => { state.sel[o.id] = i; render(); }));
    }
    if (key && seg(key).children[at]) seg(key).children[at].focus();
  }

  let open = false;
  const setOpen = (on) => {
    open = on; dlg.classList.toggle('hidden', !on);
    if (on) { render(); dlg.querySelector('.presets button[aria-pressed="true"]')?.focus(); } else btn.blur();
  };
  const apply = () => {
    if (JSON.stringify(state) === initial) { setOpen(false); return; }
    store.set(KEY_PRESET, state.preset);
    // only keep choices that differ from the preset, so later preset changes still mean something
    const base = presetQ(), custom = {};
    for (const o of OPTIONS) if (choiceOf(o, base) !== state.sel[o.id]) custom[o.id] = state.sel[o.id];
    store.set(KEY_CUSTOM, Object.keys(custom).length ? JSON.stringify(custom) : null);
    const u = new URL(location.href); u.searchParams.delete('q'); location.href = u.toString();
  };
  dlg.querySelector('.apply').addEventListener('click', apply);
  dlg.querySelector('.cancel').addEventListener('click', () => setOpen(false));
  btn.addEventListener('click', () => setOpen(true));
  dlg.addEventListener('click', (e) => { if (e.target === dlg) setOpen(false); });
  // The game starts a race on any click or Enter; keep input that belongs to the settings UI away from it.
  for (const el of [btn, dlg]) el.addEventListener('pointerdown', (e) => e.stopPropagation());
  window.addEventListener('keydown', (e) => {
    if (open) {
      if (e.code === 'Escape') setOpen(false);
      if (e.code !== 'Tab' && e.code !== 'Enter' && e.code !== 'Space' && e.code !== 'Escape') return void e.stopPropagation();
      if (e.code === 'Tab') {   // keep focus inside the dialog
        const f = [...dlg.querySelectorAll('button')], i = f.indexOf(document.activeElement);
        e.preventDefault(); f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus();
      }
      e.stopPropagation();
    } else if (cfg.isTitle()) {
      if (e.code === 'KeyG') { setOpen(true); e.stopPropagation(); }
      else if (document.activeElement === btn && (e.code === 'Enter' || e.code === 'Space')) e.stopPropagation();
    }
  }, true);
  window.addEventListener('keyup', (e) => { if (open) e.stopPropagation(); }, true);

  return {
    get open() { return open; },
    // show the button only on the title screen
    update() { const on = cfg.isTitle() || open; if (btn.classList.contains('hidden') === on) btn.classList.toggle('hidden', !on); },
  };
}
