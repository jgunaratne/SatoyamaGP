// Game settings & pause menu: controls reference + graphics presets/per-option overrides (persisted in localStorage).
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
#gfx .card { width: min(920px, 94vw); max-height: 94vh; overflow: auto; background: rgba(11,12,16,.94); border-left: 6px solid var(--pink); padding: 2.4vh 2.6vw; box-shadow: 0 2vh 6vh rgba(0,0,0,.6); }
#gfx h2 { margin: 0; font-size: 4.6vh; font-weight: 900; font-style: italic; line-height: 1; }
#gfx h2 em { color: var(--pink); font-style: inherit; }
#gfx .gpu { margin: .6vh 0 1.4vh; font-size: 1.6vh; letter-spacing: .08em; opacity: .75; }
#gfx .gpu b { color: var(--yellow); }
#gfx .sec { margin: 1.4vh 0 .4vh; font-size: 1.5vh; font-weight: 900; font-style: italic; letter-spacing: .24em; color: var(--yellow); }
#gfx .ctrls { display: grid; grid-template-columns: 11.5em 1fr; gap: .45vh 1em; align-items: baseline; padding: .8vh 0 1vh; border-top: 1px solid rgba(255,255,255,.09); font-size: 1.55vh; letter-spacing: .09em; line-height: 1.65; }
#gfx .ctrls .ck { font-weight: 800; letter-spacing: .14em; font-size: 1.65vh; opacity: .9; }
#gfx .ctrls .cv { display: flex; flex-wrap: wrap; gap: .35vh .9em; opacity: .88; }
#gfx .ctrls span { white-space: nowrap; }
#gfx .ctrls kbd { font: inherit; font-weight: 800; color: var(--yellow); background: rgba(255,255,255,.1); padding: .1vh .45em; margin-right: .25em; }
#gfx .row { display: grid; grid-template-columns: 11.5em 1fr; gap: 1em; align-items: center; padding: .55vh 0; border-top: 1px solid rgba(255,255,255,.09); }
#gfx .row .lab { font-size: 1.8vh; font-weight: 800; letter-spacing: .14em; }
#gfx .row .lab small { display: block; font-weight: 500; letter-spacing: .02em; font-size: 1.3vh; opacity: .6; margin-top: .15vh; }
#gfx .seg { display: flex; gap: .4em; flex-wrap: wrap; }
#gfx button { font: inherit; cursor: pointer; color: #fff; background: rgba(255,255,255,.08); border: 2px solid transparent; padding: .6vh .95em; font-size: 1.7vh; font-weight: 700; letter-spacing: .1em; }
#gfx button:hover { background: rgba(255,255,255,.2); }
#gfx button:focus-visible { outline: 2px solid var(--yellow); outline-offset: 2px; }
#gfx button[aria-pressed="true"] { background: var(--pink); }
#gfx button.rec::after { content: ' ★'; color: var(--yellow); }
#gfx .presets button { font-size: 2vh; font-style: italic; font-weight: 900; padding: .85vh 1.25em; }
#gfx .foot { display: flex; gap: .8em; justify-content: flex-end; align-items: center; margin-top: 1.8vh; padding-top: 1.2vh; border-top: 1px solid rgba(255,255,255,.09); }
#gfx .foot .note { margin-right: auto; font-size: 1.4vh; opacity: .6; }
#gfx .foot .quit { border-color: rgba(255,255,255,.3); }
#gfx .foot .apply { background: var(--yellow); color: #111; font-weight: 900; }
#gfx .foot .apply:hover { background: #fff; }
`;

function controlsHtml(pad) {
  const kb = [
    ['W A S D / ARROWS', 'DRIVE'], ['SPACE', 'HANDBRAKE'], ['B', 'LOOK BACK'], ['C', 'CAMERA'],
    ['R', 'RESET'], ['M', 'MUTE'], ['N', 'MUSIC'], ['RETURN / ESC / P', 'SETTINGS'],
  ];
  const p = pad || { name: 'CONTROLLER', gas: 'RT / R2', brake: 'LT / L2', hand: 'A / ✕', back: 'B / ○', cam: 'Y / △', reset: 'VIEW / SHARE', start: 'MENU / OPTIONS' };
  const gp = [
    [p.gas, 'GAS'], [p.brake, 'BRAKE'], ['LEFT STICK', 'STEER'], [p.hand, 'HANDBRAKE'],
    [p.back, 'LOOK BACK'], [p.cam, 'CAMERA'], [p.reset, 'RESET'], [p.start, 'SETTINGS'],
  ];
  const fmt = (list) => list.map(([k, v]) => `<span><kbd>${k}</kbd>${v}</span>`).join('');
  return `<div class="ck">KEYBOARD</div><div class="cv">${fmt(kb)}</div>
    <div class="ck">${p.name}</div><div class="cv">${fmt(gp)}</div>`;
}

/**
 * Adds the SETTINGS button to the title screen and the pause/settings dialog behind it.
 * cfg: { presets, active, auto, recommended, gpu, Q, isTitle(), inRace(), isOnline(), getPad(), onQuit(), onAudioKey(code) }
 */
export function initSettings(cfg) {
  const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);
  const names = Object.keys(cfg.presets);
  const btn = document.createElement('button');
  btn.id = 'gfxBtn'; btn.type = 'button'; btn.innerHTML = 'SETTINGS<kbd>ESC</kbd>';
  document.body.appendChild(btn);

  const dlg = document.createElement('div');
  dlg.id = 'gfx'; dlg.className = 'panel hidden'; dlg.setAttribute('role', 'dialog'); dlg.setAttribute('aria-modal', 'true'); dlg.setAttribute('aria-labelledby', 'gfxH');
  dlg.innerHTML = `<div class="card">
    <h2 id="gfxH">GAME <em>SETTINGS</em></h2>
    <div class="gpu">DETECTED GPU: <b></b></div>
    <div class="sec">CONTROLS</div>
    <div class="ctrls" id="gfxCtrls"></div>
    <div class="sec">GRAPHICS</div>
    <div class="row presets"><div class="lab">PRESET<small>★ recommended for this computer</small></div><div class="seg" data-opt="preset"></div></div>
    ${OPTIONS.map((o) => `<div class="row"><div class="lab">${o.label}<small>${o.hint}</small></div><div class="seg" data-opt="${o.id}"></div></div>`).join('')}
    <div class="foot"><span class="note">Graphics changes reload the game. Keys 1–4 switch presets directly.</span>
      <button type="button" class="quit hidden">QUIT TO TITLE</button>
      <button type="button" class="cancel">RESUME</button>
      <button type="button" class="apply">APPLY &amp; RELOAD</button></div></div>`;
  document.body.appendChild(dlg);
  dlg.querySelector('.gpu b').textContent = `${cfg.gpu || 'unknown'} — recommended ${cfg.recommended.toUpperCase()}`;
  const headEl = dlg.querySelector('#gfxH'), ctrlsEl = dlg.querySelector('#gfxCtrls');
  const quitBtn = dlg.querySelector('.quit'), cancelBtn = dlg.querySelector('.cancel'), applyBtn = dlg.querySelector('.apply');

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
    const inRace = !!(cfg.inRace && cfg.inRace()), online = !!(cfg.isOnline && cfg.isOnline());
    headEl.innerHTML = inRace ? 'PAUSED · <em>SETTINGS</em>' : 'GAME <em>SETTINGS</em>';
    ctrlsEl.innerHTML = controlsHtml(cfg.getPad ? cfg.getPad() : null);
    quitBtn.classList.toggle('hidden', !inRace);
    quitBtn.textContent = online ? 'LEAVE RACE' : 'QUIT TO TITLE';
    cancelBtn.textContent = inRace ? 'RESUME' : 'CLOSE';
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
    if (open === on) return;
    open = on; dlg.classList.toggle('hidden', !on);
    if (on) { render(); (cfg.inRace && cfg.inRace() ? cancelBtn : dlg.querySelector('.presets button[aria-pressed="true"]'))?.focus(); }
    else btn.blur();
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

  // Row-aware directional navigation for both keyboard arrows and gamepads.
  const navRows = () => [
    ...[...dlg.querySelectorAll('.seg')].map((el) => [...el.children]),
    [quitBtn, cancelBtn, applyBtn].filter((b) => !b.classList.contains('hidden')),
  ];
  function moveFocus(dx, dy) {
    const rows = navRows(), cur = document.activeElement;
    let ri = rows.findIndex((r) => r.includes(cur));
    if (ri < 0) { cancelBtn.focus(); return; }
    if (dy) {
      const next = rows[(ri + dy + rows.length) % rows.length];
      const pressed = next.find((b) => b.getAttribute('aria-pressed') === 'true');
      (pressed || next[Math.min(rows[ri].indexOf(cur), next.length - 1)]).focus();
    } else if (dx) {
      const row = rows[ri], ci = (row.indexOf(cur) + dx + row.length) % row.length;
      row[ci].focus();
      if (row[ci].hasAttribute('aria-pressed')) row[ci].click();
    }
  }

  applyBtn.addEventListener('click', apply);
  cancelBtn.addEventListener('click', () => setOpen(false));
  quitBtn.addEventListener('click', () => { setOpen(false); if (cfg.onQuit) cfg.onQuit(); });
  btn.addEventListener('click', () => setOpen(true));
  dlg.addEventListener('click', (e) => { if (e.target === dlg) setOpen(false); });
  // The game starts a race on any click or Enter; keep input that belongs to the settings UI away from it.
  for (const el of [btn, dlg]) el.addEventListener('pointerdown', (e) => e.stopPropagation());
  window.addEventListener('keydown', (e) => {
    if (open) {
      if (e.code === 'Escape' || e.code === 'Pause' || e.code === 'KeyP') { e.preventDefault(); setOpen(false); e.stopImmediatePropagation(); return; }
      if ((e.code === 'KeyM' || e.code === 'KeyN') && cfg.onAudioKey) { cfg.onAudioKey(e.code); e.stopImmediatePropagation(); return; }
      if (e.code === 'ArrowUp' || e.code === 'ArrowDown') { e.preventDefault(); moveFocus(0, e.code === 'ArrowDown' ? 1 : -1); e.stopImmediatePropagation(); return; }
      if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') { e.preventDefault(); moveFocus(e.code === 'ArrowRight' ? 1 : -1, 0); e.stopImmediatePropagation(); return; }
      if (e.code === 'Tab') {
        const f = [...dlg.querySelectorAll('button:not(.hidden)')], i = f.indexOf(document.activeElement);
        e.preventDefault(); f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus();
        e.stopImmediatePropagation(); return;
      }
      if (e.code === 'Enter' || e.code === 'NumpadEnter') {
        e.preventDefault(); e.stopImmediatePropagation();
        const a = document.activeElement;
        if (a && a.tagName === 'BUTTON' && !a.hasAttribute('aria-pressed')) a.click();
        else if (JSON.stringify(state) !== initial) apply();
        else setOpen(false);
        return;
      }
      if (e.code === 'Space') {
        e.preventDefault(); e.stopImmediatePropagation();
        const a = document.activeElement;
        if (a && a.tagName === 'BUTTON') a.click();
        return;
      }
      e.stopImmediatePropagation();
    } else if (cfg.isTitle() && e.code === 'KeyG') {
      setOpen(true); e.stopImmediatePropagation();
    } else if (cfg.isTitle() && document.activeElement === btn && (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space')) {
      e.preventDefault(); setOpen(true); e.stopImmediatePropagation();
    }
  }, true);
  window.addEventListener('keyup', (e) => { if (open) e.stopPropagation(); }, true);

  return {
    get open() { return open; },
    setOpen,
    refresh() { if (open) render(); },
    handleShots(shots) {
      if (!open) return;
      if (shots.Pause || shots.Escape) { setOpen(false); return; }
      if (shots.ArrowUp) moveFocus(0, -1);
      else if (shots.ArrowDown) moveFocus(0, 1);
      else if (shots.ArrowLeft) moveFocus(-1, 0);
      else if (shots.ArrowRight) moveFocus(1, 0);
      else if (shots.Enter) {
        const a = document.activeElement;
        if (a && a.tagName === 'BUTTON' && !a.hasAttribute('aria-pressed')) a.click();
        else (JSON.stringify(state) !== initial ? applyBtn : cancelBtn).focus();
      }
    },
    // show the floating button only on the title screen
    update() { const on = cfg.isTitle() && !open; if (btn.classList.contains('hidden') === on) btn.classList.toggle('hidden', !on); },
  };
}
