// Protocol test for relay.mjs, using Node's built-in WebSocket client. No dependencies.
//   node tools/relay_test.mjs
import { createServer } from 'node:http';
import { connect } from 'node:net';
import assert from 'node:assert/strict';
import { attachRelay } from '../relay.mjs';

const server = createServer((_, res) => res.end('ok'));
const relay = attachRelay(server, { rejectOthers: true });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port, url = `ws://127.0.0.1:${port}/ws`;

// A client that records everything it is sent and can wait for a particular message.
function client() {
  const ws = new WebSocket(url), log = [], waiters = [];
  const c = {
    ws, log, closed: false,
    send: (o) => ws.send(typeof o === 'string' ? o : JSON.stringify(o)),
    next: (pred, ms = 2000) => new Promise((res, rej) => {
      const hit = log.findIndex(pred);
      if (hit >= 0) return res(log.splice(hit, 1)[0]);
      const w = { pred, res, timer: setTimeout(() => rej(new Error('timed out waiting; saw ' + JSON.stringify(log))), ms) };
      waiters.push(w);
    }),
    opened: new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('socket error')); }),
    done: new Promise((res) => { ws.onclose = (e) => { c.closed = true; c.code = e.code; res(e.code); }; }),
  };
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    const i = waiters.findIndex((w) => w.pred(m));
    if (i >= 0) { const [w] = waiters.splice(i, 1); clearTimeout(w.timer); w.res(m); } else log.push(m);
  };
  return c;
}
const is = (t) => (m) => m.t === t;
const quiet = (ms = 150) => new Promise((r) => setTimeout(r, ms));
const join = async (room, name) => {
  const c = client(); await c.opened; c.send({ t: 'join', room, name });
  c.id = (await c.next(is('welcome'))).id;
  return c;
};
let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log('ok  ', name); };

await test('join creates a room; the first driver is host; names are cleaned', async () => {
  const a = await join('abcd', '<b>ann</b>');
  const room = await a.next(is('room'));
  assert.equal(room.code, 'ABCD'); assert.equal(room.host, a.id); assert.equal(room.state, 'lobby');
  assert.deepEqual(room.players, [{ id: a.id, name: 'BANNB' }]);
  a.ws.close(); await a.done; await quiet();
  assert.equal(relay.rooms.size, 0, 'empty room is deleted');
});

await test('a full race: start, state relay, AI relay, finish, back to lobby', async () => {
  const a = await join('RACE', 'ann'), b = await join('RACE', 'bob'), c = await join('RACE', 'cy');
  await a.next((m) => m.t === 'room' && m.players.length === 3);
  b.send({ t: 'start' }); await quiet();
  assert.equal(relay.rooms.get('RACE').state, 'lobby', 'only the host can start');
  a.send({ t: 's', d: [1, 2, 3] }); await quiet();
  assert.ok(!b.log.some(is('s')), 'no states are relayed outside a race');

  a.send({ t: 'start' });
  const starts = await Promise.all([a, b, c].map((x) => x.next(is('start'))));
  assert.deepEqual([...starts[0].order].sort(), [a.id, b.id, c.id].sort());
  assert.deepEqual(starts[1].order, starts[0].order, 'everyone gets the same grid');
  assert.equal((await b.next((m) => m.t === 'room' && m.state === 'race')).state, 'race');

  const d = [12.5, 1, 2, 0.5, 30, 0, 0.1, 400, 1];
  a.send({ t: 's', d });
  assert.deepEqual(await b.next(is('s')), { t: 's', id: a.id, d });
  assert.deepEqual(await c.next(is('s')), { t: 's', id: a.id, d });
  await quiet(); assert.ok(!a.log.some(is('s')), 'the sender does not get its own state back');

  b.send({ t: 'ai', d: [[1, 2, 3]] }); await quiet();
  assert.ok(!a.log.some(is('ai')), 'only the host may send AI cars');
  a.send({ t: 'ai', d: [[100.5, -2.4, 55], [80, 2.4, 50]] });
  assert.deepEqual((await b.next(is('ai'))).d, [[100.5, -2.4, 55], [80, 2.4, 50]]);

  // malformed payloads are dropped, not relayed
  for (const bad of [{ t: 's', d: 'x' }, { t: 's', d: [1, 'x'] }, { t: 's', d: [1e9] }, { t: 's', d: [null] }, { t: 's', d: Array(13).fill(0) }, { t: 'ai', d: [[1, 2]] }, { t: 'fin', d: -1 }, { t: 'fin', d: 'x' }]) a.send(bad);
  a.send('not json');
  assert.equal((await a.next(is('err'))).code, 'bad');
  await quiet(); assert.ok(!b.log.some((m) => m.t === 's' || m.t === 'ai' || m.t === 'fin'));

  a.send({ t: 'fin', d: 91.25 });
  assert.deepEqual(await b.next(is('fin')), { t: 'fin', id: a.id, d: 91.25 });
  a.send({ t: 's', d }); // a finished driver keeps driving on screen
  assert.equal((await c.next(is('s'))).id, a.id);
  b.send({ t: 'fin', d: 0 }); // b retires
  assert.equal((await c.next((m) => m.t === 'fin' && m.id === b.id)).d, 0);
  assert.equal(relay.rooms.get('RACE').state, 'race', 'still waiting for c');
  a.log.length = 0; // drop the lobby updates from before the race
  c.send({ t: 'fin', d: 99 });
  assert.equal((await a.next((m) => m.t === 'room' && m.state === 'lobby')).players.length, 3);
  for (const x of [a, b, c]) x.ws.close();
  await Promise.all([a.done, b.done, c.done]);
});

await test('leaving: host moves on, a mid-race leaver no longer blocks the race from ending', async () => {
  const a = await join('GONE', 'ann'), b = await join('GONE', 'bob');
  await b.next((m) => m.t === 'room' && m.players.length === 2);
  a.send({ t: 'start' }); await b.next(is('start'));
  b.send({ t: 'fin', d: 50 }); await quiet();
  assert.equal(relay.rooms.get('GONE').state, 'race');
  a.ws.close(); await a.done;
  const room = await b.next((m) => m.t === 'room' && m.players.length === 1 && m.state === 'lobby');
  assert.equal(room.host, b.id);
  b.send({ t: 'leave' }); await quiet();
  assert.equal(relay.rooms.size, 0);
  b.ws.close(); await b.done;
});

await test('a seventh driver is refused; a driver who joins mid-race waits for the next one', async () => {
  const cs = [];
  for (let i = 0; i < 6; i++) cs.push(await join('FULL', 'd' + i));
  const x = client(); await x.opened; x.send({ t: 'join', room: 'FULL', name: 'late' });
  assert.equal((await x.next(is('err'))).code, 'full');
  x.send({ t: 'join', room: '!!' }); assert.equal((await x.next(is('err'))).code, 'bad');
  cs[5].ws.close(); await cs[5].done;
  cs[0].send({ t: 'start' }); await cs[1].next(is('start'));
  x.send({ t: 'join', room: 'FULL', name: 'late' });
  assert.equal((await x.next(is('room'))).state, 'race');
  cs[0].send({ t: 's', d: [1] }); await cs[1].next(is('s')); await quiet();
  assert.ok(!x.log.some(is('s')) && !x.log.some(is('start')), 'spectators are not sent car states');
  for (const c of [...cs.slice(0, 5), x]) c.ws.close();
  await quiet();
});

await test('abuse: oversized frames, floods and unmasked frames close the connection', async () => {
  const big = await join('ABUSE', 'big'); big.send({ t: 's', d: [], pad: 'x'.repeat(4000) });
  assert.equal(await big.done, 1009);
  const flood = await join('ABUSE', 'flood');
  for (let i = 0; i < 400; i++) flood.send({ t: 'leave' });
  assert.equal(await flood.done, 1008);
  // an unmasked frame, written by hand on a raw socket
  const raw = connect(port, '127.0.0.1');
  const reply = await new Promise((res) => {
    let buf = Buffer.alloc(0), upgraded = false;
    raw.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      const end = buf.indexOf('\r\n\r\n');
      if (!upgraded && end >= 0) { upgraded = true; buf = buf.subarray(end + 4); raw.write(Buffer.from([0x81, 2, 0x68, 0x69])); }
      if (upgraded && buf.length >= 4) res(buf);
    });
    raw.write('GET /ws HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n');
  });
  assert.equal(reply[0], 0x88); assert.equal(reply.readUInt16BE(2), 1002);
  raw.destroy(); await quiet();
  assert.equal(relay.rooms.size, 0);
});

await test('handshake: other paths and foreign origins are refused', async () => {
  const req = (path, headers) => new Promise((res) => {
    const s = connect(port, '127.0.0.1'); let out = '';
    s.on('data', (d) => { out += d; if (out.includes('\r\n\r\n')) { res(out.split('\r\n')[0]); s.destroy(); } });
    s.on('close', () => res(out.split('\r\n')[0] || 'closed'));
    s.write(`GET ${path} HTTP/1.1\r\nHost: game.example\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n${headers}\r\n`);
  });
  assert.equal(await req('/ws', 'Origin: https://game.example\r\n'), 'HTTP/1.1 101 Switching Protocols');
  assert.equal(await req('/ws', 'Origin: https://evil.example\r\n'), 'HTTP/1.1 403 Forbidden');
  assert.equal(await req('/other', ''), 'closed');
});

relay.close(); server.close();
console.log(`\n${passed} tests passed`);
