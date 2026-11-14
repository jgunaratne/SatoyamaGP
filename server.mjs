// Zero-dependency static server for the built game (dist/). nginx fronts it at racing.local.
//   node server.mjs --host 127.0.0.1 --port 3013
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const arg = (name, def) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : def; };
const HOST = arg('host', process.env.HOST || '127.0.0.1');
const PORT = Number(arg('port', process.env.PORT || 3013));
const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), 'dist');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.wasm': 'application/wasm', '.map': 'application/json',
  '.glb': 'model/gltf-binary',
};

createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD' }).end(); return; }
  let path;
  try { path = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400).end(); return; }
  if (path.endsWith('/')) path += 'index.html';
  const file = normalize(join(ROOT, path));
  if (file !== ROOT && !file.startsWith(ROOT + sep)) { res.writeHead(403).end(); return; }
  let st;
  try { st = statSync(file); } catch { st = null; }
  if (!st || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found'); return; }
  res.writeHead(200, {
    'Content-Type': TYPES[extname(file)] || 'application/octet-stream',
    'Content-Length': st.size,
    // Vite fingerprints everything under /assets, so it can be cached forever; index.html must not be.
    // The 3D models are large and not fingerprinted: cache them for a day.
    'Cache-Control': path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : path.startsWith('/models/') ? 'public, max-age=86400' : 'no-cache',
  });
  if (req.method === 'HEAD') res.end(); else createReadStream(file).pipe(res);
}).listen(PORT, HOST, () => console.log(`satoyama-gp: serving ${ROOT} on http://${HOST}:${PORT}`));
