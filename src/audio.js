// Tiny synthesised engine / wind / tyre audio (no assets).
export class EngineAudio {
  constructor() { this.ctx = null; this.muted = false; }
  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain(); this.master.gain.value = 0.0; this.master.connect(ctx.destination);
    const comp = ctx.createDynamicsCompressor(); comp.connect(this.master);
    this.lp = ctx.createBiquadFilter(); this.lp.type = 'lowpass'; this.lp.frequency.value = 900; this.lp.Q.value = 1.2; this.lp.connect(comp);
    this.oscs = [['sawtooth', 1, 0.34], ['square', 0.5, 0.3], ['sawtooth', 2.01, 0.1], ['triangle', 0.25, 0.3]].map(([type, mul, g]) => {
      const o = ctx.createOscillator(), gn = ctx.createGain(); o.type = type; gn.gain.value = g; o.connect(gn); gn.connect(this.lp); o.start(); return { o, mul };
    });
    this.eng = ctx.createGain(); this.eng.gain.value = 1;
    const len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const mkNoise = (type, f, q) => {
      const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true;
      const bp = ctx.createBiquadFilter(); bp.type = type; bp.frequency.value = f; bp.Q.value = q;
      const g = ctx.createGain(); g.gain.value = 0; s.connect(bp); bp.connect(g); g.connect(comp); s.start(); return { bp, g };
    };
    this.wind = mkNoise('lowpass', 500, 0.3); this.tyre = mkNoise('bandpass', 1500, 2.5);
  }
  toggleMute() { this.muted = !this.muted; }
  update(rpm, throttle, speed, slip, active) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, f = (rpm / 60) * 2;
    for (const { o, mul } of this.oscs) o.frequency.setTargetAtTime(f * mul, t, 0.03);
    this.lp.frequency.setTargetAtTime(500 + rpm * 0.25 + throttle * 1500, t, 0.05);
    this.master.gain.setTargetAtTime(this.muted || !active ? 0 : 0.2 + throttle * 0.14, t, 0.08);
    this.wind.g.gain.setTargetAtTime(Math.min(0.5, (speed / 80) ** 2 * 0.5), t, 0.1);
    this.wind.bp.frequency.setTargetAtTime(350 + speed * 14, t, 0.1);
    this.tyre.g.gain.setTargetAtTime(Math.min(0.4, Math.max(0, slip - 2.2) * 0.07), t, 0.05);
  }
}
