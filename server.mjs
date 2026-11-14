// Zero-dependency server for the built game (dist/) and the online-race relay (WebSocket at /ws, see relay.mjs).
// nginx fronts it at racing.local.
//   node server.mjs --host 127.0.0.1 --port 3013
// The relay only accepts pages served from this same host. To let a copy of the game hosted elsewhere connect
// (with ?server=wss://this-host/ws), list its origins: ORIGINS=https://a.example,https://b.example
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { attachRelay } from './relay.mjs';

const arg = (name, def) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : def; };
const HOST = arg('host', process.env.HOST || '127.0.0.1');
const PORT = Number(arg('port', process.env.PORT || 3013));
const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), 'dist');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.wasm': 'application/wasm', '.map': 'application/json',
  '.mp3': 'audio/mpeg',
};

const server = createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD' }).end(); return; }
  let path;
  try { path = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400).end(); return; }
  if (path.endsWith('/')) path += 'index.html';
  const file = normalize(join(ROOT, path));
  if (file !== ROOT && !file.startsWith(ROOT + sep)) { res.writeHead(403).end(); return; }
  let st;
  try { st = statSync(file); } catch { st = null; }
  if (!st || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found'); return; }
  const headers = {
    'Content-Type': TYPES[extname(file)] || 'application/octet-stream',
    // Vite fingerprints everything under /assets, so it can be cached forever; index.html must not be.
    'Cache-Control': path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
    'Accept-Ranges': 'bytes',
  };
  // Byte ranges: Safari refuses to play <audio> from a server that cannot answer them.
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  let start = 0, end = st.size - 1, status = 200;
  if (m && (m[1] || m[2])) {
    if (m[1]) { start = Number(m[1]); if (m[2]) end = Math.min(end, Number(m[2])); }
    else start = Math.max(0, st.size - Number(m[2]));
    if (start > end) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }).end(); return; }
    status = 206; headers['Content-Range'] = `bytes ${start}-${end}/${st.size}`;
  }
  headers['Content-Length'] = end - start + 1;
  res.writeHead(status, headers);
  if (req.method === 'HEAD' || st.size === 0) res.end(); else createReadStream(file, { start, end }).pipe(res);
});
attachRelay(server, {
  rejectOthers: true,
  origins: process.env.ORIGINS ? process.env.ORIGINS.split(',').map((o) => o.trim()) : null,
  log: (line) => console.log('satoyama-gp: ' + line),
});
server.listen(PORT, HOST, () => console.log(`satoyama-gp: serving ${ROOT} on http://${HOST}:${PORT}`));
