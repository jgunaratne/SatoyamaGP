import { clamp, lerp, wrapAngle } from './util.js';
import { ROAD_HALF, RAIL_OFF } from './track.js';
import { SHOULDER_W, SHOULDER_DROP } from './terrain.js';
import { WHEEL_Z, WHEEL_X, wheelSpinStep } from './car.js';

const GEAR_TOP = [0, 17, 28, 40, 53, 66, 82]; // m/s at redline per gear
const POWER = 215;        // specific power, W/kg
const DRAG = 0.00043;
const WHEELBASE = WHEEL_Z * 2;

// Arcade-leaning vehicle model: power-limited drive, grip-capped lateral forces, handbrake drifts.
export class Vehicle {
  constructor(car, world) {
    this.car = car; this.world = world;
    this.x = 0; this.y = 0; this.z = 0; this.heading = 0;
    this.vx = 0; this.vz = 0; this.vf = 0; this.vl = 0;
    this.steer = 0; this.gear = 1; this.rpm = 1000; this.shiftT = 0;
    this.idx = 0; this.lat = 0; this.onRoad = true;
    this.slip = 0; this.impact = 0; this.latAcc = 0; this.longAcc = 0;
    this.pitch = 0; this.roll = 0; this.spin = 0; this.braking = false; this.throttle = 0;
    this.hit = ''; // what the last impact was against: 'rail' | 'solid' | 'car' (picks the sound)
  }
  get speed() { return Math.hypot(this.vx, this.vz); }

  place(x, z, heading) {
    this.x = x; this.z = z; this.heading = heading; this.vx = this.vz = 0; this.vf = this.vl = 0;
    this.steer = 0; this.gear = 1; this.slip = 0;
    this.idx = this.world.track.nearestGlobal(x, z);
    this.y = this.ground(x, z);
    this.pitch = this.roll = 0;
    this.sync(0);
  }

  ground(x, z) {
    const tr = this.world.track, i = this.idx;
    const al = Math.abs(tr.lateral(x, z, i));
    if (al > ROAD_HALF + SHOULDER_W + 40) return this.world.terrain.heightAt(x, z);
    const ry = tr.heightAt(x, z, i);
    if (al <= ROAD_HALF) return ry;
    const th = this.world.terrain.heightAt(x, z);
    if (al < ROAD_HALF + SHOULDER_W) return Math.max(ry - SHOULDER_DROP * (al - ROAD_HALF) / SHOULDER_W, th);
    return th;
  }

  update(dt, input) {
    const n = Math.max(1, Math.ceil(dt / (1 / 120)));
    for (let i = 0; i < n; i++) this.step(dt / n, input);
    this.sync(dt);
  }

  step(dt, input) {
    const tr = this.world.track;
    const sh = Math.sin(this.heading), ch = Math.cos(this.heading);
    let vf = this.vx * sh + this.vz * ch, vl = this.vx * ch - this.vz * sh;

    this.idx = tr.nearest(this.x, this.z, this.idx, 30);
    this.lat = tr.lateral(this.x, this.z, this.idx);
    this.onRoad = Math.abs(this.lat) < ROAD_HALF + 0.4;
    const grip = this.onRoad ? 1 : 0.58;

    // --- longitudinal ---
    let throttle = input.throttle, brake = input.brake, reverse = false;
    if (brake > 0.1 && vf < 1.5 && throttle < 0.1) { reverse = true; }
    this.shiftT = Math.max(0, this.shiftT - dt);
    const av = Math.abs(vf);
    let a = 0;
    if (reverse) a = vf > -9 ? -5.5 * brake * grip : 0;
    else {
      const cut = this.shiftT > 0 ? 0.25 : 1;
      a += throttle * Math.min(10.5 * grip, POWER / Math.max(av, 6)) * cut;
      if (brake > 0 && vf > 0) a -= brake * 15 * grip;
      if (vf < -0.2 && throttle > 0) a += 8 * grip;
    }
    a -= vf * av * DRAG;
    a -= Math.sign(vf) * (this.onRoad ? 0.18 : 1.6 + av * 0.045);
    if (throttle < 0.05 && !reverse) a -= Math.sign(vf) * Math.min(av, 0.9);
    // gravity along the slope
    a -= 9.8 * Math.sin(this.pitchGround || 0);
    const vf0 = vf;
    vf += a * dt;
    if (!reverse && throttle < 0.05 && vf0 * vf < 0) vf = 0;
    this.longAcc = lerp(this.longAcc, a, Math.min(1, dt * 8));

    // --- steering ---
    const maxSteer = 0.52 / (1 + av * 0.05);
    const target = input.steer * maxSteer;
    this.steer += clamp(target - this.steer, -dt * 2.6, dt * 2.6) * (Math.abs(target) < Math.abs(this.steer) ? 1.6 : 1);
    this.steer = clamp(this.steer, -maxSteer, maxSteer);
    const hb = input.handbrake;
    const maxLat = 13.5 * grip;
    let yaw = (vf * Math.tan(this.steer)) / WHEELBASE;
    const yawCap = (hb ? maxLat * 1.5 : maxLat) / Math.max(av, 4);
    yaw = clamp(yaw, -yawCap, yawCap);
    // self-aligning torque: the nose weathervanes toward the direction of travel
    yaw += clamp(vl * 0.035, -0.5, 0.5) * (av > 3 ? 1 : 0);
    this.heading += yaw * dt;

    // --- lateral grip ---
    const sh2 = Math.sin(this.heading), ch2 = Math.cos(this.heading);
    const wvx = sh * vf + ch * vl, wvz = ch * vf - sh * vl;
    vf = wvx * sh2 + wvz * ch2; vl = wvx * ch2 - wvz * sh2;
    let latCap = (hb ? 5.5 : 17) * grip;
    if (!hb && throttle > 0.7 && av < 32) latCap *= 1 - 0.3 * Math.min(1, Math.abs(this.steer) / maxSteer);
    const rate = hb ? 2.2 : 10;
    const want = -vl * (1 - Math.exp(-rate * dt));
    const dvl = clamp(want, -latCap * dt, latCap * dt);
    vl += dvl;
    if (hb && vf > 0) vf -= Math.min(vf, 5.5 * dt);
    this.latAcc = lerp(this.latAcc, vf * yaw, Math.min(1, dt * 6));
    this.slip = lerp(this.slip, Math.abs(vl) + (hb ? 2 : 0) * (av > 6 ? 1 : 0), Math.min(1, dt * 10));

    this.vx = sh2 * vf + ch2 * vl; this.vz = ch2 * vf - sh2 * vl;
    this.x += this.vx * dt; this.z += this.vz * dt;

    // --- guardrails ---
    const i = this.idx, rawSide = tr.rail[i];
    if (rawSide) {
      const lat = tr.lateral(this.x, this.z, i), side = rawSide === 2 ? (lat >= 0 ? 1 : -1) : rawSide, lim = RAIL_OFF - 1.05;
      if (lat * side > lim && lat * side < RAIL_OFF + 2.5) {
        const push = lat * side - lim;
        this.x -= tr.lx[i] * push * side; this.z -= tr.lz[i] * push * side;
        const vn = (this.vx * tr.lx[i] + this.vz * tr.lz[i]) * side;
        if (vn > 0) {
          this.vx -= tr.lx[i] * vn * side * 1.25; this.vz -= tr.lz[i] * vn * side * 1.25;
          const loss = clamp(vn * 0.035, 0, 0.3);
          this.vx *= 1 - loss; this.vz *= 1 - loss;
          this.impact = Math.max(this.impact, clamp(vn * 0.12, 0, 1)); this.hit = 'rail';
          // nudge the nose back along the rail
          const tHead = Math.atan2(tr.tx[i], tr.tz[i]);
          this.heading += wrapAngle(tHead - this.heading) * clamp(vn * 0.02, 0, 0.25);
        }
      }
    }
    // --- static obstacles ---
    this.world.colliders.query(this.x, this.z, (cx, cz, r) => {
      const dx = this.x - cx, dz = this.z - cz, d = Math.hypot(dx, dz), R = r + 1.05;
      if (d >= R || d < 1e-4) return;
      const nx = dx / d, nz = dz / d;
      this.x = cx + nx * R; this.z = cz + nz * R;
      const vn = this.vx * nx + this.vz * nz;
      if (vn < 0) {
        this.vx -= 1.3 * vn * nx; this.vz -= 1.3 * vn * nz;
        this.vx *= 0.72; this.vz *= 0.72;
        this.impact = Math.max(this.impact, clamp(-vn * 0.1, 0.1, 1)); this.hit = 'solid';
      }
    });

    this.vf = this.vx * sh2 + this.vz * ch2; this.vl = this.vx * ch2 - this.vz * sh2;
    this.braking = brake > 0.1 && !reverse;
    this.throttle = throttle;

    // --- drivetrain (for the tach + audio) ---
    const sp = Math.abs(this.vf);
    if (this.gear < 6 && sp > GEAR_TOP[this.gear] * 0.97) { this.gear++; this.shiftT = 0.14; }
    else if (this.gear > 1 && sp < GEAR_TOP[this.gear - 1] * 0.66) this.gear--;
    const g0 = this.gear === 1 ? 0 : GEAR_TOP[this.gear - 1] * 0.55;
    let rpm = 1100 + 6500 * clamp((sp - g0 * 0) / GEAR_TOP[this.gear], 0, 1.03);
    if (sp < 3) rpm = Math.max(rpm, 1100 + throttle * 4200);
    this.rpm = lerp(this.rpm, rpm, Math.min(1, dt * 12));
    this.reverse = reverse && this.vf < -0.3;
  }

  // Settle onto the ground and pose the visual model.
  sync(dt) {
    const sh = Math.sin(this.heading), ch = Math.cos(this.heading);
    const g = (f, l) => this.ground(this.x + sh * f + ch * l, this.z + ch * f - sh * l);
    const hF = (g(WHEEL_Z, WHEEL_X) + g(WHEEL_Z, -WHEEL_X)) / 2, hB = (g(-WHEEL_Z, WHEEL_X) + g(-WHEEL_Z, -WHEEL_X)) / 2;
    const hL = (g(WHEEL_Z, WHEEL_X) + g(-WHEEL_Z, WHEEL_X)) / 2, hR = (g(WHEEL_Z, -WHEEL_X) + g(-WHEEL_Z, -WHEEL_X)) / 2;
    const k = dt > 0 ? 1 - Math.exp(-dt * 22) : 1;
    this.y = lerp(this.y, (hF + hB) / 2, k);
    this.pitchGround = Math.atan2(hF - hB, WHEELBASE);
    this.pitch = lerp(this.pitch, this.pitchGround, k);
    this.roll = lerp(this.roll, Math.atan2(hL - hR, WHEEL_X * 2), k);
    this.impact = Math.max(0, this.impact - dt * 2.5);

    const c = this.car;
    c.group.position.set(this.x, this.y, this.z);
    c.group.rotation.set(-this.pitch, this.heading, this.roll, 'YXZ');
    c.body.rotation.z = clamp(this.latAcc * 0.0035, -0.06, 0.06);
    c.body.rotation.x = clamp(-this.longAcc * 0.0028, -0.035, 0.04);
    this.spin += wheelSpinStep(this.vf, dt);
    for (const w of c.wheels) {
      w.spin.rotation.x = this.spin;
      if (w.front) w.pivot.rotation.y = this.steer * 1.4;
    }
    c.tail.emissiveIntensity = this.braking ? 14 : 1.6;
  }
}
