// Headless-Chrome screenshot of the running game (expects `npm run dev` or `node server.mjs`).
// usage: node tools/capture.mjs "<query>" <out.png> [settleMs=3000] [WxH=1600x900] [evalJs]
//   PORT=5173 node tools/capture.mjs "demo&ff=20&q=high&nodrs" /tmp/shot.png
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [query = '', out = '/tmp/satoyama.png', settle = '3000', size = '1600x900', evalJs = ''] = process.argv.slice(2);
const [W, H] = size.split('x').map(Number);
const url = `http://127.0.0.1:${process.env.PORT || 5173}/${process.env.PAGE || ''}?${query}`;
const profile = mkdtempSync(join(tmpdir(), 'sgp-cdp-'));
const chrome = spawn(process.env.CHROME || 'google-chrome', [
  '--headless=new', '--disable-extensions', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars',
  '--no-first-run', `--user-data-dir=${profile}`, `--window-size=${W},${H}`, '--remote-debugging-port=0',
  '--proxy-server=direct://', '--proxy-bypass-list=*', 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });
const done = (code) => { try { chrome.kill('SIGKILL'); } catch { /* gone */ } try { rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ } process.exit(code); };
const timer = setTimeout(() => { console.error('TIMEOUT'); done(2); }, Number(process.env.TIMEOUT || 600) * 1000);

const wsUrl = await new Promise((resolve) => chrome.stderr.on('data', (d) => { const m = String(d).match(/DevTools listening on (ws:\/\/\S+)/); if (m) resolve(m[1]); }));
const targets = await (await fetch(`http://127.0.0.1:${new URL(wsUrl).port}/json`)).json();
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const pending = new Map();
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning', 'info'].includes(m.params.type)) console.log(`[console.${m.params.type}]`, m.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 400));
  if (m.method === 'Runtime.exceptionThrown') console.log('[exception]', (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 600));
});
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;

await send('Runtime.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
if (process.env.PRE_JS) await send('Page.addScriptToEvaluateOnNewDocument', { source: process.env.PRE_JS });   // e.g. seed localStorage
await send('Page.navigate', { url });
const ok = await evaluate(`(async () => { const t = performance.now(); while (!window.__game && performance.now() - t < ${(Number(process.env.TIMEOUT || 600) - 30) * 1000}) await new Promise(r => setTimeout(r, 200)); return !!window.__game; })()`);
if (!ok) { console.error('game did not boot:', await evaluate(`document.getElementById('loadText')?.textContent`)); }
if (evalJs) console.log('eval:', JSON.stringify(await evaluate(evalJs)));
await new Promise((r) => setTimeout(r, Number(settle)));
// the game fades in over ~25 rendered frames; software GL can take a while to get there
await evaluate(`new Promise((r) => { let n = 0; const f = () => (++n < ${Number(process.env.FRAMES || 40)} ? requestAnimationFrame(f) : r(1)); requestAnimationFrame(f); })`);
console.log('info:', JSON.stringify(await evaluate(`(() => { const g = window.__game; if (!g) return null; const i = g.renderer.info; return { fps: document.getElementById('fps')?.textContent, calls: i.render.calls, tris: i.render.triangles, geos: i.memory.geometries, tex: i.memory.textures }; })()`)));
const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
console.log('wrote', out);
clearTimeout(timer); done(ok ? 0 : 1);
