// Keyboard + gamepad input. Xbox and PlayStation (DualSense / DualShock) pads are read through the
// browser's standard gamepad mapping, so one button layout covers both; only the on-screen labels differ.
//
// A paired controller is invisible to the page until one of its buttons is pressed — that is a browser
// privacy rule, not something the game can work around.

const B = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };
const DEADZONE = 0.12;

const LABELS = {
  xbox: { name: 'XBOX CONTROLLER', gas: 'RT', brake: 'LT', hand: 'A', back: 'B', cam: 'Y', online: 'X', reset: 'VIEW', start: 'MENU', ok: 'A' },
  ps: { name: 'PLAYSTATION CONTROLLER', gas: 'R2', brake: 'L2', hand: '✕', back: '○', cam: '△', online: '□', reset: 'SHARE', start: 'OPTIONS', ok: '✕' },
  generic: { name: 'GAMEPAD', gas: 'RT', brake: 'LT', hand: 'A', back: 'B', cam: 'Y', online: 'X', reset: 'SELECT', start: 'START', ok: 'A' },
};

// Work out which glyphs to show from the id string the browser reports, e.g.
//   "Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)"
//   "DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)"
//   "054c-0ce6-Wireless Controller"                       (Firefox)
export function padInfo(id) {
  const s = String(id || '');
  if (/054c|dualsense|dualshock|playstation|\bps[345]\b/i.test(s)) {
    const sense = /dualsense|0ce6|0df2/i.test(s);
    return { family: 'ps', ...LABELS.ps, name: sense ? 'DUALSENSE' : LABELS.ps.name, reset: sense ? 'CREATE' : 'SHARE' };
  }
  if (/045e|xbox|xinput/i.test(s)) return { family: 'xbox', ...LABELS.xbox };
  if (/^wireless controller/i.test(s)) return { family: 'ps', ...LABELS.ps }; // how Sony pads name themselves with no vendor id
  return { family: 'generic', ...LABELS.generic };
}

const typing = (e) => { const t = e.target; return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable); };

export class Controls {
  // onWake: first user gesture (lets audio start). onChange: the active device or pad changed.
  // onPad(info, connected): a controller appeared or went away.
  constructor({ onWake = () => {}, onChange = () => {}, onPad = () => {} } = {}) {
    this.input = { throttle: 0, brake: 0, steer: 0, handbrake: false, lookBack: false };
    this.device = 'keyboard';   // which prompts to show: 'keyboard' | 'pad'
    this.pad = null;            // padInfo() of the controller in use
    this.keys = new Set();
    this.shots = {};
    this.padIndex = -1; this.prev = []; this.rumbleT = 0; this.lastImpact = 0;
    this.onChange = onChange; this.onPad = onPad; this.onWake = onWake;

    window.addEventListener('keydown', (e) => {
      if (typing(e)) return;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      if (!e.repeat) this.shots[e.code] = true;
      this.keys.add(e.code);
      this.use('keyboard');
      onWake();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    window.addEventListener('pointerdown', (e) => {
      onWake();
      if (!(e.target && e.target.closest && e.target.closest('.panel'))) this.shots.Enter = true;
    });
    window.addEventListener('gamepadconnected', (e) => { onPad(padInfo(e.gamepad.id), true); });
    window.addEventListener('gamepaddisconnected', (e) => {
      onPad(padInfo(e.gamepad.id), false);
      if (e.gamepad.index === this.padIndex) { this.padIndex = -1; this.pad = null; this.prev = []; this.use('keyboard', true); }
    });
  }

  use(device, force = false) {
    if (this.device === device && !force) return;
    this.device = device; this.onChange();
  }

  pads() {
    if (!navigator.getGamepads) return [];
    let list; try { list = navigator.getGamepads(); } catch { return []; }
    return [...list].filter((g) => g && g.connected);
  }

  // Read this frame's input. Returns the one-shot presses (by keyboard code) since the last call.
  poll() {
    const k = (c) => this.keys.has(c), input = this.input;
    input.throttle = k('KeyW') || k('ArrowUp') ? 1 : 0;
    input.brake = k('KeyS') || k('ArrowDown') ? 1 : 0;
    input.steer = (k('KeyA') || k('ArrowLeft') ? 1 : 0) - (k('KeyD') || k('ArrowRight') ? 1 : 0);
    input.handbrake = k('Space');
    input.lookBack = k('KeyB');

    const pads = this.pads();
    const busy = (g) => g.buttons.some((b) => b.pressed || b.value > 0.5) || Math.abs(g.axes[0] || 0) > 0.5;
    let gp = pads.find((g) => g.index === this.padIndex);
    // Follow whichever controller is being touched, so a second pad can take over from an idle one.
    if (!gp || !busy(gp)) { const other = pads.find((g) => g !== gp && busy(g)); if (other || !gp) gp = other || pads[0]; }
    if (gp && gp.index !== this.padIndex) { this.padIndex = gp.index; this.pad = padInfo(gp.id); this.prev = []; if (this.device === 'pad') this.onChange(); }
    if (gp) {
      const b = (i) => (gp.buttons[i] ? gp.buttons[i].value || (gp.buttons[i].pressed ? 1 : 0) : 0);
      const ax = gp.axes[0] || 0, mag = Math.abs(ax);
      const stick = mag > DEADZONE ? -Math.sign(ax) * Math.pow((mag - DEADZONE) / (1 - DEADZONE), 1.6) : 0;
      const dpad = (b(B.LEFT) > 0.5 ? 1 : 0) - (b(B.RIGHT) > 0.5 ? 1 : 0);
      if (busy(gp)) { this.use('pad'); this.onWake(); }
      input.throttle = Math.max(input.throttle, b(B.RT));
      input.brake = Math.max(input.brake, b(B.LT));
      if (stick || dpad) input.steer = stick || dpad;
      input.handbrake = input.handbrake || b(B.A) > 0.5;
      input.lookBack = input.lookBack || b(B.B) > 0.5;
      const edge = (i, ...codes) => { const on = b(i) > 0.5; if (on && !this.prev[i]) for (const c of codes) this.shots[c] = true; this.prev[i] = on; };
      edge(B.START, 'Enter'); edge(B.A, 'Enter'); edge(B.B, 'Escape'); edge(B.X, 'KeyO'); edge(B.Y, 'KeyC'); edge(B.BACK, 'KeyR');
    }
    const shots = this.shots; this.shots = {};
    return shots;
  }

  // Rumble: a thump on impacts, a light buzz while sliding or off the road.
  feedback(dt, { impact = 0, slip = 0, offRoad = false, speed = 0 }) {
    this.rumbleT -= dt;
    const hit = impact > this.lastImpact + 0.05 ? impact : 0;
    this.lastImpact = impact;
    if (this.device !== 'pad' || (!hit && this.rumbleT > 0)) return;
    const buzz = speed > 6 ? Math.min(0.5, (offRoad ? 0.3 : 0) + Math.max(0, slip - 3) * 0.06) : 0;
    if (!hit && buzz < 0.05) return;
    const gp = this.pads().find((g) => g.index === this.padIndex), act = gp && gp.vibrationActuator;
    if (!act || !act.playEffect) return;
    this.rumbleT = 0.09;
    act.playEffect('dual-rumble', { duration: hit ? 180 : 110, strongMagnitude: Math.min(1, hit * 1.2), weakMagnitude: Math.min(1, buzz + hit * 0.5) }).catch(() => {});
  }
}
