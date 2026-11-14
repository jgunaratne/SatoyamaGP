import { clamp, lerp, wrapAngle } from './util.js';
import { WHEEL_R } from './car.js';

// Rival driver: follows the centreline with a racing-line bias, brakes for curvature, dodges traffic.
export class Rival {
  constructor(car, track, s, lat, skill, name) {
    this.car = car; this.track = track; this.name = name;
    this.s = s; this.prog = s; this.lat = lat; this.bias = lat * 0.35; this.v = 0;
    this.vmax = 60 + skill * 11; this.alat = 9.6 + skill * 2.6; this.skill = skill;
    this.x = 0; this.y = 0; this.z = 0; this.heading = 0; this.spin = 0; this.fx = 0; this.fz = 1;
    this.finishTime = 0; this.braking = false;
    this.pose(0, 0);
  }
  update(dt, others, playerProg, racing, time) {
    const tr = this.track, L = tr.length;
    let maxK = 0;
    const look = 22 + this.v * 1.75;
    for (let d = 0; d < look; d += 6) { const k = tr.curvAt(this.s + d); if (Math.abs(k) > Math.abs(maxK)) maxK = k; }
    let vt = Math.min(this.vmax, Math.sqrt(this.alat / Math.max(Math.abs(maxK), 1e-4)));
    // gentle rubber band keeps the pack interesting
    const gap = this.prog - playerProg;
    vt *= 1 - clamp(gap / 400, -0.07, 0.09);
    if (!racing) vt = this.finishTime ? Math.min(vt, 30) : 0;
    let dodge = 0;
    for (const o of others) {
      if (o === this) continue;
      let ahead = (o.s - this.s) % L; if (ahead < -L / 2) ahead += L; if (ahead > L / 2) ahead -= L;
      if (ahead > 0 && ahead < 16 && Math.abs(o.lat - this.lat) < 2.3) {
        vt = Math.min(vt, o.v + (ahead - 7) * 0.9);
        dodge = this.lat >= o.lat ? 1 : -1;
      }
    }
    const targetLat = clamp(clamp(maxK * 650, -2.6, 2.6) + this.bias + dodge * 2.6, -3.6, 3.6);
    const dl = clamp(targetLat - this.lat, -2.4 * dt, 2.4 * dt);
    this.lat += dl;
    const v0 = this.v;
    if (this.v < vt) this.v = Math.min(vt, this.v + Math.min(9.2, 205 / Math.max(this.v, 7)) * dt);
    else this.v = Math.max(vt, this.v - 12 * dt);
    this.braking = this.v < v0 - 2 * dt;
    const ds = this.v * dt;
    this.s += ds; this.prog += ds;
    this.pose(dl / Math.max(dt, 1e-4), dt);
  }
  pose(latRate, dt) {
    const f = this.track.sample(this.s);
    this.x = f.x + f.lx * this.lat; this.z = f.z + f.lz * this.lat; this.y = f.y;
    const h = Math.atan2(f.tx, f.tz) + Math.atan2(latRate, Math.max(this.v, 6));
    this.heading = dt > 0 ? this.heading + wrapAngle(h - this.heading) * Math.min(1, dt * 10) : h;
    this.fx = Math.sin(this.heading); this.fz = Math.cos(this.heading);
    const c = this.car;
    c.group.position.set(this.x, this.y, this.z);
    c.group.rotation.set(-Math.atan(f.slope), this.heading, 0, 'YXZ');
    c.body.rotation.z = lerp(c.body.rotation.z, clamp(this.v * this.v * f.k * 0.0035, -0.05, 0.05), 0.1);
    this.spin += (this.v * dt) / WHEEL_R;
    for (const w of c.wheels) w.spin.rotation.x = this.spin;
    c.tail.emissiveIntensity = this.braking ? 14 : 1.6;
  }
}
