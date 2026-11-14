// Game audio: a synthesised engine / wind / tyre bed, sampled sound effects (ElevenLabs,
// tools/generate_sfx.sh) and a streamed, cross-fading score (Lyria 3, tools/generate_music.sh).
// Every sample is optional: a missing file is simply silent.
const BASE = import.meta.env.BASE_URL + 'audio/';
const SHOTS = ['count', 'go', 'ui_start', 'checkpoint', 'lap', 'final_lap', 'finish', 'impact_light', 'impact_heavy', 'scrape',
  'shift', 'pass', 'passed', 'whoosh', 'wrong_way', 'reset'];
const LOOPS = ['skid', 'gravel', 'ambience'];
export const RACE_TRACKS = ['race1', 'race2', 'race3'];
const MUSIC_VOL = 0.42, SFX_VOL = 0.85;
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
    for (const n of [...SHOTS, ...LOOPS]) {
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
  }
  toggleMute() {
    this.muted = !this.muted;
    if (this.out) this.out.gain.setTargetAtTime(this.muted ? 0 : 1, this.ctx.currentTime, 0.03);
  }
  toggleMusic() { this.music.toggle(); }
  playMusic(list, i = 0) { this.music.play(list, i); }

  // One-shot effect. `gap` (s) drops retriggers that arrive too soon after the last one.
  play(name, { gain = 1, rate = 1, gap = 0.05 } = {}) {
    const b = this.buffers[name]; if (!b || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime; if (t - (this.last[name] || -9) < gap) return;
    this.last[name] = t;
    const s = this.ctx.createBufferSource(); s.buffer = b; s.playbackRate.value = rate;
    const g = this.ctx.createGain(); g.gain.value = gain; s.connect(g); g.connect(this.sfxBus); s.start();
  }

  update(rpm, throttle, speed, slip, active, onRoad = true) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, f = (rpm / 60) * 2;
    for (const { o, mul } of this.oscs) o.frequency.setTargetAtTime(f * mul, t, 0.03);
    this.lp.frequency.setTargetAtTime(500 + rpm * 0.25 + throttle * 1500, t, 0.05);
    this.master.gain.setTargetAtTime(!active ? 0 : 0.2 + throttle * 0.14, t, 0.08);
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
