// Browser side of relay.mjs: one WebSocket, one room. See relay.mjs for the message list.
export class Net {
  constructor(url, handlers = {}) {
    this.url = url; this.h = handlers;
    this.ws = null; this.id = 0; this.room = null; this.status = 'off'; // off | connecting | open | closed
  }
  get open() { return this.status === 'open' && !!this.room; }
  get isHost() { return !!this.room && this.room.host === this.id; }
  nameOf(id) { const p = this.room && this.room.players.find((q) => q.id === id); return p ? p.name : 'DRIVER'; }

  join(code, name) {
    this.leave();
    this.status = 'connecting';
    let ws;
    try { ws = this.ws = new WebSocket(this.url); } catch { this.status = 'closed'; this.emit('close'); return; }
    ws.onopen = () => { if (ws === this.ws) ws.send(JSON.stringify({ t: 'join', room: code, name })); };
    ws.onmessage = (e) => {
      if (ws !== this.ws) return;
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.t === 'welcome') { this.id = m.id; this.status = 'open'; }
      else if (m.t === 'room') { this.room = m; this.emit('room', m); }
      else if (m.t === 'start') this.emit('start', m);
      else if (m.t === 's') this.emit('state', m.id, m.d);
      else if (m.t === 'ai') this.emit('ai', m.d);
      else if (m.t === 'fin') this.emit('fin', m.id, m.d);
      else if (m.t === 'err') { this.error = m.code; this.emit('error', m.code); }
    };
    ws.onclose = () => { if (ws !== this.ws) return; this.ws = null; this.room = null; this.status = 'closed'; this.emit('close'); };
  }
  leave() {
    const ws = this.ws;
    this.ws = null; this.room = null; this.id = 0; this.status = 'off'; this.error = null;
    if (ws) { try { ws.close(); } catch { /* already gone */ } }
  }
  send(obj) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj)); }
  emit(name, ...args) { if (this.h[name]) this.h[name](...args); }
}

// Unambiguous letters and digits only, so a code read out loud survives.
export function randomRoom() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 4; i++) s += A[Math.floor(Math.random() * A.length)];
  return s;
}
