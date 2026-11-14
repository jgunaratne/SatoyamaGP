// Game audio: a synthesised engine / wind / tyre bed, sampled sound effects (ElevenLabs,
// tools/generate_sfx.sh) and a streamed, cross-fading score (Lyria 3, tools/generate_music.sh).
// Every sample is optional: a missing file is simply silent.
const BASE = import.meta.env.BASE_URL + 'audio/';
const SHOTS = ['count', 'go', 'ui_start', 'checkpoint', 'lap', 'final_lap', 'finish', 'impact_light', 'impact_heavy', 'scrape',
  'shift', 'whoosh', 'wrong_way', 'reset'];
const LOOPS = ['skid', 'gravel', 'ambience'];
// Sampled engine (tools/generate_engine.py): steady-rpm recordings, cross-faded by rpm and pitched to it.
// ENGINE layers are on-throttle, lowest rpm first; engine_off is the overrun layer for a closed throttle.
const ENGINE = ['idle', 'low', 'mid', 'high'], ENGINE_OFF = 'off';
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const RACE_TRACKS = ['race1', 'race2', 'race3'];
const MUSIC_VOL = 0.42, SFX_VOL = 0.85;
const ENGINE_VOL = 0.5;   // overall level of the sampled engine against music and effects
const TRAFFIC_VOL = 0.45;  // other cars' engines, at their loudest (alongside)
const GEAR_TOP = [0, 17, 28, 40, 53, 66, 82]; // m/s at redline per gear, as in vehicle.js: gives other cars an rpm
const ENGINE_PITCH = 1;   // < 1 plays every layer deeper than its true rpm (0.85 is a noticeably bassier car)
const pref = (k, def) => { try { const v = localStorage.getItem(k); return v === null ? def : v === '1'; } catch { return def; } };
const savePref = (k, v) => { try { localStorage.setItem(k, v ? '1' : '0'); } catch { /* ignore */ } };

// A few ms of silence: playing it inside a user gesture unlocks a media element (Safari / iOS).
function silentUrl() {
  const n = 800, b = new DataView(new ArrayBuffer(44 + n));
  const w = (o, s) => [...s].forEach((c, i) => b.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); b.setUint32(4, 36 + n, true); w(8, 'WAVEfmt '); b.setUint32(16, 16, true); b.setUint16(20, 1, true); b.setUint16(22, 1, true);
  b.setUint32(24, 8000, true); b.setUint32(28, 8000, true); b.setUint16(32, 1, true); b.setUint16(34, 8, true); w(36, 'data'); b.setUint32(40, n, true);
  for (let i = 0; i < n; i++) b.setUint8(44 + i, 128);
  return URL.createObjectURL(new Blob([b], { type: 'audio/wav' }));
}

// The tracks are three minutes each, so they are streamed through two media elements
// (decoding one to PCM would cost ~60 MB) that cross-fade into each other.
class Music {
  constructor() { this.slots = []; this.cur = -1; this.list = null; this.i = 0; this.blocked = false; this.on = pref('satoyama.music', true); }
  attach(ctx, dest) {
    this.ctx = ctx; this.silence = silentUrl();
    this.bus = ctx.createGain(); this.bus.gain.value = this.on ? MUSIC_VOL : 0; this.bus.connect(dest);
    for (let k = 0; k < 2; k++) {
      const el = new Audio(); el.preload = 'auto';
      const g = ctx.createGain(); g.gain.value = 0;
      ctx.createMediaElementSource(el).connect(g); g.connect(this.bus);
      const slot = { el, g, primed: false, gen: 0 };
      el.addEventListener('ended', () => { if (slot === this.slots[this.cur] && this.list) { this.i = (this.i + 1) % this.list.length; this.start(false); } });
      this.slots.push(slot);
    }
  }
  // Call from input handlers: unlocks idle elements and retries a blocked play().
  gesture() {
    if (!this.ctx) return;
    for (const s of this.slots) if (!s.primed && s !== this.slots[this.cur]) {
      s.primed = true; s.el.src = this.silence; s.el.play().catch(() => { s.primed = false; });
    }
    if (this.blocked) this.start(false);
  }
  // Plays `list` in order from index `i`, wrapping around; a one-track list loops.
  play(list, i = 0) {
    if (this.list && this.list.join() === list.join()) return;
    this.list = list; this.i = i % list.length; this.start(true);
  }
  start(xfade) {
    if (!this.ctx || !this.list) { this.blocked = true; return; }
    const t = this.ctx.currentTime, old = this.slots[this.cur];
    if (xfade && old) {
      const gen = ++old.gen;
      old.g.gain.cancelScheduledValues(t); old.g.gain.setTargetAtTime(0, t, 0.35);
      setTimeout(() => { if (old.gen === gen) old.el.pause(); }, 1600);
      this.cur = 1 - this.cur;
    } else if (!old) this.cur = 0;
    const s = this.slots[this.cur]; s.gen++; s.primed = true;
    s.el.loop = this.list.length === 1;
    s.el.src = `${BASE}music/${this.list[this.i]}.mp3`;
    s.g.gain.cancelScheduledValues(t); s.g.gain.setTargetAtTime(1, t, 0.25);
    this.blocked = false;
    const gen = s.gen;
    s.el.play().catch((e) => { if (s.gen === gen && e.name === 'NotAllowedError') this.blocked = true; });
  }
  toggle() {
    this.on = !this.on; savePref('satoyama.music', this.on);
    if (this.bus) this.bus.gain.setTargetAtTime(this.on ? MUSIC_VOL : 0, this.ctx.currentTime, 0.1);
  }
}

export class EngineAudio {
  constructor() {
    this.ctx = null; this.muted = false; this.music = new Music();
    this.buffers = {}; this.loops = {}; this.last = {};
    // Fetch the samples up front; they are decoded once a gesture has created the context.
    this.raw = {};
    this.engMeta = fetch(`${BASE}sfx/engine.json`).then((r) => r.json()).catch(() => null); // measured rpm per layer
    for (const n of [...SHOTS, ...LOOPS, ...ENGINE.map((e) => 'engine_' + e), 'engine_' + ENGINE_OFF]) {
      this.raw[n] = fetch(`${BASE}sfx/${n}.mp3`).then((r) => (r.ok && !/html/.test(r.headers.get('content-type') || '') ? r.arrayBuffer() : null)).catch(() => null);
    }
  }
  start() {
    if (this.ctx) { if (this.ctx.state !== 'running') this.ctx.resume(); this.music.gesture(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.out = ctx.createGain(); this.out.gain.value = this.muted ? 0 : 1; this.out.connect(ctx.destination);
    this.master = ctx.createGain(); this.master.gain.value = 0.0; this.master.connect(this.out);
    const comp = ctx.createDynamicsCompressor(); comp.connect(this.master);
    this.lp = ctx.createBiquadFilter(); this.lp.type = 'lowpass'; this.lp.frequency.value = 900; this.lp.Q.value = 1.2; this.lp.connect(comp);
    this.oscs = [['sawtooth', 1, 0.34], ['square', 0.5, 0.3], ['sawtooth', 2.01, 0.1], ['triangle', 0.25, 0.3]].map(([type, mul, g]) => {
      const o = ctx.createOscillator(), gn = ctx.createGain(); o.type = type; gn.gain.value = g; o.connect(gn); gn.connect(this.lp); o.start(); return { o, mul };
    });
    const len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const mkNoise = (type, f, q) => {
      const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true;
      const bp = ctx.createBiquadFilter(); bp.type = type; bp.frequency.value = f; bp.Q.value = q;
      const g = ctx.createGain(); g.gain.value = 0; s.connect(bp); bp.connect(g); g.connect(comp); s.start(); return { bp, g };
    };
    this.wind = mkNoise('lowpass', 500, 0.3); this.tyre = mkNoise('bandpass', 1500, 2.5);

    this.sfxBus = ctx.createGain(); this.sfxBus.gain.value = SFX_VOL; this.sfxBus.connect(this.out);
    for (const [n, p] of Object.entries(this.raw)) {
      if (n.startsWith('engine_')) continue;
      p.then((ab) => (ab ? ctx.decodeAudioData(ab) : null)).then((b) => {
        if (!b) return;
        if (!LOOPS.includes(n)) { this.buffers[n] = b; return; }
        const s = ctx.createBufferSource(); s.buffer = b; s.loop = true;
        const g = ctx.createGain(); g.gain.value = 0; s.connect(g); g.connect(this.sfxBus); s.start();
        this.loops[n] = g;
      }).catch(() => {});
    }
    this.music.attach(ctx, this.out);
    this.music.gesture();
    this.loadEngine(ctx);
  }
  // Starts every engine loop silent; update() then mixes and pitches them. Until (or unless) all the
  // on-throttle layers have decoded, the oscillator engine above stays in charge.
  async loadEngine(ctx) {
    const meta = await this.engMeta; if (!meta) return;
    const decode = async (n) => { const ab = await this.raw['engine_' + n]; return ab && meta[n] ? ctx.decodeAudioData(ab).catch(() => null) : null; };
    const bufs = await Promise.all([...ENGINE, ENGINE_OFF].map(decode));
    if (bufs.slice(0, ENGINE.length).some((b) => !b)) return;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2000; lp.Q.value = 0.7;
    const gain = ctx.createGain(); gain.gain.value = 0; lp.connect(gain); gain.connect(this.out);
    const layer = (b, n) => {
      if (!b) return null;
      const src = ctx.createBufferSource(); src.buffer = b; src.loop = true;
      const g = ctx.createGain(); g.gain.value = 0; src.connect(g); g.connect(lp);
      src.start(0, Math.random() * b.duration); // de-correlate the loops
      return { src, g, rpm: meta[n] };
    };
    const all = bufs.map((b, k) => layer(b, [...ENGINE, ENGINE_OFF][k]));
    this.engine = { layers: all.slice(0, ENGINE.length).sort((a, b) => a.rpm - b.rpm), off: all[ENGINE.length], lp, gain };
  }
  toggleMute() {
    this.muted = !this.muted;
    if (this.out) this.out.gain.setTargetAtTime(this.muted ? 0 : 1, this.ctx.currentTime, 0.03);
  }
  toggleMusic() { this.music.toggle(); }
  playMusic(list, i = 0) { this.music.play(list, i); }

  // One-shot effect. `gap` (s) drops retriggers that arrive too soon after the last one.
  play(name, { gain = 1, rate = 1, gap = 0.05, pan = 0 } = {}) {
    const b = this.buffers[name]; if (!b || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime; if (t - (this.last[name] || -9) < gap) return;
    this.last[name] = t;
    const s = this.ctx.createBufferSource(); s.buffer = b; s.playbackRate.value = rate;
    const g = this.ctx.createGain(); g.gain.value = gain; s.connect(g);
    if (pan && this.ctx.createStereoPanner) { const p = this.ctx.createStereoPanner(); p.pan.value = clamp(pan, -1, 1); g.connect(p); p.connect(this.sfxBus); }
    else g.connect(this.sfxBus);
    s.start();
  }

  // One engine voice for another car: the two upper engine recordings, then distance low-pass, level and pan.
  trafficVoice() {
    const ctx = this.ctx, g = ctx.createGain(); g.gain.value = 0;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3000; lp.connect(g);
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (pan) { g.connect(pan); pan.connect(this.out); } else g.connect(this.out);
    const layers = this.engine.layers.slice(-2).map((l) => {
      const src = ctx.createBufferSource(); src.buffer = l.src.buffer; src.loop = true;
      const lg = ctx.createGain(); lg.gain.value = 0; src.connect(lg); lg.connect(lp);
      src.start(0, Math.random() * src.buffer.duration);
      return { src, g: lg, rpm: l.rpm };
    });
    return { g, lp, pan, layers, tune: 0.93 + Math.random() * 0.14 }; // no two cars are tuned alike
  }
  // Other cars as heard from the player's seat. cars[i] = { d: distance m, right / fwd: offset in the player's
  // frame m, closing: approach speed m/s (negative when pulling away), v: its speed m/s } or null.
  // Passing is then simply what it is on a road: the other engine swells, sweeps across and drops in pitch.
  updateTraffic(cars, active) {
    if (!this.engine) return;
    const t = this.ctx.currentTime, V = this.traffic || (this.traffic = []);
    for (let i = 0; i < Math.max(cars.length, V.length); i++) {
      const c = cars[i];
      if (!V[i]) { if (!c || !active || c.d > 110) continue; V[i] = this.trafficVoice(); }
      const v = V[i];
      if (!c || !active || c.d > 110) { v.g.gain.setTargetAtTime(0, t, 0.1); continue; }
      let gear = 1; while (gear < 6 && c.v > GEAR_TOP[gear] * 0.97) gear++;
      const doppler = clamp(343 / (343 - c.closing), 0.8, 1.25);
      const rpm = (1100 + 6500 * c.v / GEAR_TOP[gear]) * v.tune * doppler * ENGINE_PITCH;
      const [a, b] = v.layers, x = clamp(Math.log(rpm / a.rpm) / Math.log(b.rpm / a.rpm), 0, 1) * Math.PI / 2;
      a.g.gain.setTargetAtTime(Math.cos(x), t, 0.06); b.g.gain.setTargetAtTime(Math.sin(x), t, 0.06);
      for (const l of v.layers) l.src.playbackRate.setTargetAtTime(clamp(rpm / l.rpm, 0.35, 2.5), t, 0.04);
      // inverse-square falloff from 7 m; air and the car body in between eat the highs with distance
      v.g.gain.setTargetAtTime(TRAFFIC_VOL * 49 / (49 + c.d * c.d), t, 0.05);
      v.lp.frequency.setTargetAtTime((700 + 9000 / (1 + c.d / 22)) * (c.fwd < 0 ? 0.75 : 1), t, 0.08);
      if (v.pan) v.pan.pan.setTargetAtTime(clamp(c.right / (Math.abs(c.right) + Math.abs(c.fwd) * 0.5 + 3), -0.9, 0.9), t, 0.05);
    }
  }

  update(rpm, throttle, speed, slip, active, onRoad = true) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, f = (rpm / 60) * 2;
    for (const { o, mul } of this.oscs) o.frequency.setTargetAtTime(f * mul, t, 0.03);
    this.lp.frequency.setTargetAtTime(500 + rpm * 0.25 + throttle * 1500, t, 0.05);
    this.master.gain.setTargetAtTime(!active || this.engine ? 0 : 0.2 + throttle * 0.14, t, 0.08);
    const E = this.engine;
    if (E) {
      const L = E.layers, n = L.length;
      let i = 0; while (i < n - 2 && rpm > L[i + 1].rpm) i++;
      // equal-power cross-fade between the two recordings that bracket this rpm (log scale: pitch is ratios)
      const x = clamp(Math.log(rpm / L[i].rpm) / Math.log(L[i + 1].rpm / L[i].rpm), 0, 1) * Math.PI / 2;
      const load = 0.3 + 0.7 * throttle;
      for (let k = 0; k < n; k++) {
        const w = k === i ? Math.cos(x) : k === i + 1 ? Math.sin(x) : 0;
        L[k].src.playbackRate.setTargetAtTime(clamp(ENGINE_PITCH * rpm / L[k].rpm, 0.4, 2.5), t, 0.03);
        L[k].g.gain.setTargetAtTime(w * load, t, 0.06);
      }
      if (E.off) { // engine braking: grows as the throttle closes, fades out towards idle
        E.off.src.playbackRate.setTargetAtTime(clamp(ENGINE_PITCH * rpm / E.off.rpm, 0.4, 2.5), t, 0.03);
        E.off.g.gain.setTargetAtTime((1 - throttle) * 0.75 * clamp((rpm - 1300) / 1500, 0, 1), t, 0.09);
      }
      // a closed throttle muffles the intake and exhaust; opening it lets the rasp through
      E.lp.frequency.setTargetAtTime(1100 + rpm * 0.45 + throttle * (2500 + rpm * 1.3), t, 0.07);
      E.gain.gain.setTargetAtTime(active ? ENGINE_VOL * (0.5 + 0.22 * clamp((rpm - 1000) / 6500, 0, 1)) : 0, t, 0.08);
    }
    this.wind.g.gain.setTargetAtTime(Math.min(0.5, (speed / 80) ** 2 * 0.5), t, 0.1);
    this.wind.bp.frequency.setTargetAtTime(350 + speed * 14, t, 0.1);
    const skid = speed > 5 && onRoad ? Math.max(0, slip - 2.2) : 0, L = this.loops;
    // the sampled squeal takes over from the noise-band tyre once it has loaded
    this.tyre.g.gain.setTargetAtTime(Math.min(0.4, skid * 0.07) * (L.skid ? 0.3 : 1), t, 0.05);
    if (L.skid) L.skid.gain.setTargetAtTime(Math.min(0.75, skid * 0.16), t, 0.06);
    if (L.gravel) L.gravel.gain.setTargetAtTime(!onRoad && active ? Math.min(0.9, speed / 22) : 0, t, 0.08);
    if (L.ambience) L.ambience.gain.setTargetAtTime(0.55 - 0.35 * Math.min(1, speed / 45), t, 0.4);
  }
}
