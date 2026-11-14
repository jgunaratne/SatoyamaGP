import { Vehicle } from './vehicle.js';
import { clamp, wrapAngle } from './util.js';

const DELAY = 0.1;       // seconds behind the newest state we draw, so there are two states to blend between
const MAX_EXTRAP = 0.3;  // how long to coast on the last known velocity when states stop arriving
const STALE = 3;         // after this long with no states the car is lifted off the track until they resume

// Another driver's car. It is drawn from the states that driver sends, and it answers the same questions
// as an AI Rival (x, z, fx, fz, s, lat, v, prog, finishTime) so traffic, collisions and results treat both alike.
export class RemoteCar extends Vehicle {
  constructor(car, world, name, css) {
    super(car, world);
    this.name = name; this.css = css;
    this.fx = 0; this.fz = 1; this.prog = 0; this.finishTime = 0; this.gone = false;
    this.snaps = []; this.off = null; this.stale = false;
  }
  get s() { return this.prog; }
  set s(_) { /* driven by the network */ }
  get v() { return Math.max(0, this.vf); }
  set v(_) { /* collisions try to slow rivals; a remote driver's own game decides that */ }

  reset(x, z, heading, prog) {
    this.snaps.length = 0; this.off = null; this.stale = false; this.prog = prog; this.finishTime = 0; this.gone = false;
    this.car.group.visible = true;
    this.place(x, z, heading);
    this.lat = this.world.track.lateral(x, z, this.idx);
    this.fx = Math.sin(heading); this.fz = Math.cos(heading);
  }

  // The driver left or retired: take the car off the track.
  retire() {
    this.gone = true; this.car.group.visible = false;
    this.x = this.z = 1e7; this.lat = 1e4; this.prog = -1e9; this.vx = this.vz = this.vf = 0;
  }

  // d = [t, x, z, heading, vx, vz, steer, prog, flags]; t is the sender's clock in seconds.
  push(d, now) {
    if (this.gone) return;
    const [t, x, z, h, vx, vz, steer, prog, flags] = d;
    const last = this.snaps[this.snaps.length - 1];
    if (last && t <= last.t) return;
    // Track the smallest (receive - send) gap seen: that is the clock offset plus the best-case latency.
    const off = now - t;
    this.off = this.off === null ? off : Math.min(off, this.off + 0.002);
    this.snaps.push({ t, x, z, h, vx, vz, steer, prog, flags });
    if (this.snaps.length > 40) this.snaps.shift();
    if (this.stale) { this.stale = false; this.car.group.visible = true; }
  }

  // Called like Rival.update(dt, others, ...): only dt is used, the rest belongs to the AI.
  update(dt) {
    const sn = this.snaps, now = performance.now() / 1000;
    if (this.gone || !sn.length) return;
    const rt = now - this.off - DELAY;
    let i = sn.length - 1;
    while (i > 0 && sn[i].t > rt) i--;
    const a = sn[i], b = sn[i + 1];
    // A driver who stopped sending (back in the lobby, or a stalled connection) must not sit there as a wall.
    if (!b && rt - a.t > STALE) {
      if (!this.stale) { this.stale = true; this.car.group.visible = false; this.x = this.z = 1e7; this.lat = 1e4; this.vx = this.vz = this.vf = 0; }
      return;
    }
    let x, z, h, vx = a.vx, vz = a.vz, prog;
    if (b && rt >= a.t) {
      const k = (rt - a.t) / (b.t - a.t);
      x = a.x + (b.x - a.x) * k; z = a.z + (b.z - a.z) * k; h = a.h + wrapAngle(b.h - a.h) * k;
      vx += (b.vx - a.vx) * k; vz += (b.vz - a.vz) * k; prog = a.prog + (b.prog - a.prog) * k;
    } else {
      const e = clamp(rt - a.t, 0, MAX_EXTRAP);
      x = a.x + vx * e; z = a.z + vz * e; h = a.h;
      prog = a.prog + (vx * Math.sin(h) + vz * Math.cos(h)) * e;
      if (rt - a.t > MAX_EXTRAP) vx = vz = 0;
    }
    const tr = this.world.track, jump = Math.hypot(x - this.x, z - this.z);
    this.idx = jump > 25 ? tr.nearestGlobal(x, z) : tr.nearest(x, z, this.idx, 30);
    this.x = x; this.z = z; this.heading = h; this.vx = vx; this.vz = vz; this.prog = prog;
    const sh = Math.sin(h), ch = Math.cos(h);
    this.fx = sh; this.fz = ch; this.vf = vx * sh + vz * ch; this.vl = vx * ch - vz * sh;
    this.lat = tr.lateral(x, z, this.idx);
    this.steer = a.steer; this.braking = !!(a.flags & 1);
    if (jump > 25) this.y = this.ground(x, z);
    this.sync(dt);
  }
  // Rivals are posed with pose(latRate, dt) while the grid waits; for a remote car that is just update().
  pose(_, dt) { this.update(dt); }
}
