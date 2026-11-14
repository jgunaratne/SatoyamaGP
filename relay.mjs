// Zero-dependency WebSocket relay for online races. Attach it to any node:http server:
//   attachRelay(server)                      — handles upgrades on /ws
//
// The relay keeps rooms of up to six drivers. Each client simulates its own car and sends its state;
// the relay validates and forwards it to the other drivers in the room. It never runs game logic.
//
// Client -> relay                         Relay -> client
//   {t:'join', room, name}                  {t:'welcome', id, room}
//   {t:'leave'}                             {t:'room', code, host, state, players:[{id, name}]}
//   {t:'start'}            (host only)      {t:'start', order:[id...]}
//   {t:'s', d:[numbers]}   car state        {t:'s', id, d}
//   {t:'ai', d:[[s,lat,v]...]} (host only)  {t:'ai', d}
//   {t:'fin', d:seconds}   0 = retired      {t:'fin', id, d}
//                                           {t:'err', code}   full | busy | bad
import { createHash } from 'node:crypto';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
export const MAX_PLAYERS = 6;
const MAX_ROOMS = 200;
const MAX_MSG = 2048;            // bytes per frame; a car state is ~90
const MAX_RATE = 120;            // messages per second per connection
const MAX_BACKLOG = 256 * 1024;  // drop car states for a client whose socket is this far behind
const FINISH_GRACE_MS = 60_000;  // after the first finisher, the rest get this long
const RACE_LIMIT_MS = 15 * 60_000;
const HEARTBEAT_MS = 25_000;

const frame = (op, data) => {
  const n = data.length;
  let head;
  if (n < 126) head = Buffer.from([0x80 | op, n]);
  else if (n < 65536) head = Buffer.from([0x80 | op, 126, n >> 8, n & 255]);
  else { head = Buffer.alloc(10); head[0] = 0x80 | op; head[1] = 127; head.writeBigUInt64BE(BigInt(n), 2); }
  return Buffer.concat([head, data]);
};
const num = (v, lim = 1e7) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < lim;
const cleanName = (v) => (String(v ?? '').replace(/[^A-Za-z0-9 _-]/g, '').trim().slice(0, 12).toUpperCase() || 'DRIVER');
const cleanRoom = (v) => { const s = String(v ?? '').toUpperCase(); return /^[A-Z0-9]{3,8}$/.test(s) ? s : null; };

export function attachRelay(server, { path = '/ws', origins = null, rejectOthers = false, log = () => {} } = {}) {
  const rooms = new Map();
  const clients = new Set();
  let nextId = 1;

  // Browsers always send Origin. By default only pages served from this same host may connect.
  const originOk = (req) => {
    const o = req.headers.origin;
    if (!o || origins === '*') return true;
    if (origins) return origins.includes(o);
    try { return new URL(o).host === req.headers.host; } catch { return false; }
  };

  const send = (c, obj, droppable = false) => {
    if (c.closed) return;
    if (droppable && c.socket.writableLength > MAX_BACKLOG) return;
    c.socket.write(frame(1, Buffer.from(JSON.stringify(obj))));
  };
  const roomInfo = (r) => ({ t: 'room', code: r.code, host: r.host, state: r.state, players: [...r.members.values()].map((m) => ({ id: m.id, name: m.name })) });
  const broadcast = (r, obj, except = null, only = null, droppable = false) => {
    for (const m of r.members.values()) if (m !== except && (!only || only.has(m.id))) send(m, obj, droppable);
  };

  const endRace = (r) => {
    clearTimeout(r.graceTimer); clearTimeout(r.limitTimer); r.graceTimer = r.limitTimer = null;
    r.state = 'lobby'; r.grid = new Set(); r.pending = new Set();
    broadcast(r, roomInfo(r));
  };
  const retire = (r, id) => {
    if (!r.pending.delete(id) || r.state !== 'race') return;
    if (!r.pending.size) endRace(r);
  };
  const leave = (c) => {
    const r = c.room; if (!r) return;
    c.room = null; r.members.delete(c.id);
    if (!r.members.size) { clearTimeout(r.graceTimer); clearTimeout(r.limitTimer); rooms.delete(r.code); log(`room ${r.code} closed`); return; }
    if (r.host === c.id) r.host = r.members.keys().next().value;
    r.grid.delete(c.id);
    broadcast(r, roomInfo(r));
    retire(r, c.id);
  };

  const onMessage = (c, text) => {
    let m; try { m = JSON.parse(text); } catch { return send(c, { t: 'err', code: 'bad' }); }
    if (!m || typeof m !== 'object') return send(c, { t: 'err', code: 'bad' });
    const r = c.room;
    switch (m.t) {
      case 'join': {
        const code = cleanRoom(m.room);
        if (!code) return send(c, { t: 'err', code: 'bad' });
        leave(c);
        let room = rooms.get(code);
        if (!room) {
          if (rooms.size >= MAX_ROOMS) return send(c, { t: 'err', code: 'busy' });
          room = { code, members: new Map(), host: c.id, state: 'lobby', grid: new Set(), pending: new Set(), graceTimer: null, limitTimer: null };
          rooms.set(code, room); log(`room ${code} opened`);
        } else if (room.members.size >= MAX_PLAYERS) return send(c, { t: 'err', code: 'full' });
        c.name = cleanName(m.name); c.room = room; room.members.set(c.id, c);
        send(c, { t: 'welcome', id: c.id, room: code });
        return broadcast(room, roomInfo(room));
      }
      case 'leave': return leave(c);
      case 'start': {
        if (!r || r.host !== c.id || r.state !== 'lobby') return;
        const order = [...r.members.keys()];
        for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
        r.state = 'race'; r.grid = new Set(order); r.pending = new Set(order);
        r.limitTimer = setTimeout(() => endRace(r), RACE_LIMIT_MS); r.limitTimer.unref();
        broadcast(r, roomInfo(r));
        return broadcast(r, { t: 'start', order });
      }
      case 's': {
        if (!r || !r.grid.has(c.id) || !Array.isArray(m.d) || m.d.length > 12 || !m.d.every((v) => num(v))) return;
        return broadcast(r, { t: 's', id: c.id, d: m.d }, c, r.grid, true);
      }
      case 'ai': {
        if (!r || r.host !== c.id || !r.grid.has(c.id) || !Array.isArray(m.d) || m.d.length >= MAX_PLAYERS) return;
        if (!m.d.every((a) => Array.isArray(a) && a.length === 3 && a.every((v) => num(v)))) return;
        return broadcast(r, { t: 'ai', d: m.d }, c, r.grid, true);
      }
      case 'fin': {
        if (!r || !r.pending.has(c.id) || !num(m.d, 1e5) || m.d < 0) return;
        broadcast(r, { t: 'fin', id: c.id, d: m.d }, c, r.grid);
        if (m.d > 0 && !r.graceTimer) { r.graceTimer = setTimeout(() => endRace(r), FINISH_GRACE_MS); r.graceTimer.unref(); }
        return retire(r, c.id);
      }
      default: return undefined;
    }
  };

  const drop = (c, code) => {
    if (c.closed) return;
    c.closed = true; clients.delete(c);
    if (code) { const b = Buffer.alloc(2); b.writeUInt16BE(code); c.socket.end(frame(8, b)); } else c.socket.destroy();
    leave(c);
  };

  const parse = (c) => {
    while (!c.closed) {
      const b = c.buf;
      if (b.length < 2) return;
      const op = b[0] & 0x0f;
      let len = b[1] & 0x7f, off = 2;
      // Clients must mask, and nothing we accept needs fragmentation or extensions.
      if (!(b[0] & 0x80) || (b[0] & 0x70) || !(b[1] & 0x80)) return drop(c, 1002);
      if (len === 127) return drop(c, 1009);
      if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
      if (len > MAX_MSG) return drop(c, 1009);
      if (b.length < off + 4 + len) return;
      const payload = Buffer.allocUnsafe(len);
      for (let i = 0; i < len; i++) payload[i] = b[off + 4 + i] ^ b[off + (i & 3)];
      c.buf = b.subarray(off + 4 + len);
      if (op === 1) {
        const sec = Math.floor(Date.now() / 1000);
        if (sec !== c.rateSec) { c.rateSec = sec; c.rateN = 0; }
        if (++c.rateN > MAX_RATE) return drop(c, 1008);
        onMessage(c, payload.toString('utf8'));
      } else if (op === 8) return drop(c, 1000);
      else if (op === 9) c.socket.write(frame(10, payload));
      else if (op === 10) c.alive = true;
      else return drop(c, 1003);
    }
  };

  server.on('upgrade', (req, socket, head) => {
    let pathname; try { pathname = new URL(req.url, 'http://x').pathname; } catch { socket.destroy(); return; }
    if (pathname !== path) { if (rejectOthers) socket.destroy(); return; } // leave e.g. Vite's HMR socket alone
    const key = req.headers['sec-websocket-key'];
    if (String(req.headers.upgrade).toLowerCase() !== 'websocket' || !key || req.headers['sec-websocket-version'] !== '13') { socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'); return; }
    if (!originOk(req)) { socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return; }
    const accept = createHash('sha1').update(key + GUID).digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    socket.setNoDelay(true);
    const c = { id: nextId++, socket, buf: head && head.length ? head : Buffer.alloc(0), room: null, name: 'DRIVER', alive: true, closed: false, rateSec: 0, rateN: 0 };
    clients.add(c);
    socket.on('data', (d) => { c.buf = c.buf.length ? Buffer.concat([c.buf, d]) : d; parse(c); });
    socket.on('close', () => drop(c));
    socket.on('error', () => drop(c));
    parse(c);
  });

  // Ping every connection so idle proxies keep it open and dead peers are noticed.
  const beat = setInterval(() => {
    for (const c of [...clients]) {
      if (!c.alive) { drop(c); continue; }
      c.alive = false; c.socket.write(frame(9, Buffer.alloc(0)));
    }
  }, HEARTBEAT_MS);
  beat.unref();

  return { rooms, clients, close() { clearInterval(beat); for (const c of [...clients]) drop(c); } };
}
