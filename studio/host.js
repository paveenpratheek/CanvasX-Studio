/* The studio's two web servers, both on 127.0.0.1 only (t-dc8e2c779e).
 *
 * The studio server is ter-manager's part for the two pages
 * (t-33bd14605d):
 *   /                      the studio page, with this run's token in it
 *   /studio/<file>         its script and styles
 *   /plugin-host.js        the pages' side of the host API
 *   /plugins/<id>/<file>   each page's plugin folder, as ter-manager serves
 *                          it - runtime.json and local.json included
 *   /api/host/...          what the page asks of the PC: status, logs, a
 *                          data folder, a terminal, an engine restarted -
 *                          only with the token, from the studio's own origin
 *
 * The CanvasX server serves the CanvasX folder as `python -m http.server`
 * would, on the port NoteX's CanvasX link accepts (t-b2251cde5d).
 *
 * Every request must name a loopback Host on its own port, so a web page
 * cannot reach either server through a name that resolves to 127.0.0.1.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { ROOT, pluginDir, cliOf, dataDirOf, studioOrigins } from './config.js';
import { isEngineCommand, openTerminal } from './terminal.js';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf',
  '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8', '.wasm': 'application/wasm',
};
const MAX_BODY = 64 * 1024;

export const loopbackHosts = (port) => [`127.0.0.1:${port}`, `localhost:${port}`];

/* A file inside base by a URL path, or null: no way out, no hidden folders. */
export function fileIn(base, urlPath) {
  let rel;
  try { rel = decodeURIComponent(urlPath); } catch (_) { return null; }
  if (rel.includes('\0')) return null;
  const parts = rel.split(/[\\/]+/).filter(Boolean);
  if (parts.some((p) => p === '..' || p.startsWith('.'))) return null;
  const file = path.resolve(base, ...parts);
  const back = path.relative(path.resolve(base), file);
  if (back.startsWith('..') || path.isAbsolute(back)) return null;
  return file;
}

function sendFile(res, file, { head = false, index = 'index.html' } = {}) {
  let f = file;
  let st;
  try { st = fs.statSync(f); if (st.isDirectory()) { f = path.join(f, index); st = fs.statSync(f); } } catch (_) { return false; }
  if (!st.isFile()) return false;
  res.writeHead(200, {
    'content-type': TYPES[path.extname(f).toLowerCase()] || 'application/octet-stream',
    'content-length': st.size,
    // runtime.json changes with every engine start; the pages read it fresh.
    'cache-control': 'no-store',
  });
  if (head) res.end(); else fs.createReadStream(f).pipe(res);
  return true;
}

function json(res, status, body) {
  const s = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(s), 'cache-control': 'no-store' });
  res.end(s);
}

const refuse = (res, status, message) => json(res, status, { error: { message } });

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

function guardHost(req, res, port) {
  if (!loopbackHosts(port).includes(String(req.headers.host || '').toLowerCase())) { refuse(res, 403, 'Open the studio at 127.0.0.1 or localhost.'); return false; }
  return true;
}

function secure(res) {
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('referrer-policy', 'no-referrer');
  // Another site may not load these files into its page.
  res.setHeader('cross-origin-resource-policy', 'same-origin');
}

/* The studio page with this run's token and settings written in. */
export function studioPage({ token, config, plugs, publicDir }) {
  const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
  const boot = {
    plugins: Object.values(plugs).map((p) => ({ id: p.id, label: p.label, hint: p.hint })),
    canvasx: `http://127.0.0.1:${config.ports.canvasx}/`,
  };
  const attr = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  return html.replace('%%TOKEN%%', attr(token)).replace('%%BOOT%%', attr(JSON.stringify(boot)));
}

export function createStudioServer({ config, plugs, engines, token = crypto.randomBytes(24).toString('hex'), publicDir = path.join(ROOT, 'studio', 'public'), terminal = openTerminal, log = () => {} }) {
  const port = config.ports.studio;
  const origins = studioOrigins(config);
  const same = (a, b) => { const x = Buffer.from(String(a || '')), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

  async function api(req, res, url) {
    if (req.headers.origin && !origins.includes(req.headers.origin)) return refuse(res, 403, `Requests from ${req.headers.origin} are not accepted.`);
    if (!same(req.headers['x-studio-token'], token)) return refuse(res, 401, 'Missing or wrong X-Studio-Token - reload the studio page.');
    const route = url.pathname.slice('/api/host/'.length);
    const plugin = (id) => plugs[id] || null;

    if (req.method === 'GET' && route === 'status') return json(res, 200, { engines: Object.values(engines).map((e) => e.snapshot()), dataDir: config.dataDir, ports: config.ports });
    if (req.method === 'GET' && route === 'logs') {
      const e = engines[url.searchParams.get('id')];
      return e ? json(res, 200, { id: e.spec.id, lines: e.logs() }) : refuse(res, 404, 'No such engine.');
    }
    if (req.method === 'GET' && route === 'data-dir') {
      const p = plugin(url.searchParams.get('id'));
      if (!p) return refuse(res, 404, 'No such plugin.');
      const d = dataDirOf(config, p.id);
      fs.mkdirSync(d.dir, { recursive: true });
      return json(res, 200, d);
    }
    const m = /^engines\/([a-z0-9-]+)\/(start|stop|restart)$/.exec(route);
    if (req.method === 'POST' && m) {
      const e = engines[m[1]];
      if (!e) return refuse(res, 404, 'No such engine.');
      const snap = m[2] === 'start' ? e.start() : m[2] === 'stop' ? await e.stop() : await e.restart();
      return json(res, 200, snap);
    }
    if (req.method === 'POST' && route === 'terminal') {
      let body;
      try { body = await readBody(req); } catch (_) { return refuse(res, 400, 'The request is not JSON.'); }
      const p = plugin(body.plugin);
      if (!p) return refuse(res, 404, 'No such plugin.');
      const cmd = String(body.cmd || '');
      if (cmd && engines[p.id] && isEngineCommand(cmd, cliOf(p))) {
        log(`${p.label} asked for its engine: restarting it`);
        engines[p.id].restart().catch((e) => log(`${p.label}: ${e.message}`));
        return json(res, 200, { opened: true, engine: true });
      }
      try {
        return json(res, 200, await terminal({ cwd: body.cwd ? String(body.cwd) : '', cmd, title: body.title ? String(body.title) : p.label }));
      } catch (e) { return refuse(res, 500, e.message); }
    }
    return refuse(res, 404, 'No such route.');
  }

  const server = http.createServer(async (req, res) => {
    secure(res);
    if (!guardHost(req, res, port)) return;
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    try {
      if (url.pathname.startsWith('/api/host/')) return await api(req, res, url);
      if (req.method !== 'GET' && req.method !== 'HEAD') return refuse(res, 405, 'Only GET here.');
      const head = req.method === 'HEAD';
      if (url.pathname === '/' || url.pathname === '/index.html') {
        const html = studioPage({ token, config, plugs, publicDir });
        res.writeHead(200, { 'content-type': TYPES['.html'], 'cache-control': 'no-store', 'content-security-policy': "frame-ancestors 'none'" });
        return res.end(head ? undefined : html);
      }
      if (url.pathname === '/plugin-host.js') return sendFile(res, path.join(publicDir, 'plugin-host.js'), { head }) || refuse(res, 404, 'Not found.');
      if (url.pathname.startsWith('/studio/')) {
        const f = fileIn(publicDir, url.pathname.slice('/studio/'.length));
        return (f && sendFile(res, f, { head })) || refuse(res, 404, 'Not found.');
      }
      const pm = /^\/plugins\/([a-z0-9-]+)\/(.*)$/.exec(url.pathname);
      if (pm && plugs[pm[1]]) {
        const f = fileIn(pluginDir(plugs[pm[1]]), pm[2]);
        return (f && sendFile(res, f, { head, index: 'plugin.html' })) || refuse(res, 404, 'Not found.');
      }
      if (url.pathname === '/favicon.ico') return sendFile(res, path.join(publicDir, 'icon.svg'), { head }) || refuse(res, 404, 'Not found.');
      return refuse(res, 404, 'Not found.');
    } catch (e) {
      log(`studio server: ${e.stack || e.message}`);
      if (!res.headersSent) refuse(res, 500, e.message);
      else res.end();
    }
  });
  return { server, token, port };
}

export function createStaticServer({ root, port }) {
  const server = http.createServer((req, res) => {
    secure(res);
    if (!guardHost(req, res, port)) return;
    if (req.method !== 'GET' && req.method !== 'HEAD') return refuse(res, 405, 'Only GET here.');
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    const f = fileIn(root, url.pathname);
    if (!(f && sendFile(res, f, { head: req.method === 'HEAD' }))) refuse(res, 404, 'Not found.');
  });
  return { server, port };
}

/* Listen on 127.0.0.1, or say plainly what holds the port. */
export function listen(server, port, what) {
  return new Promise((resolve, reject) => {
    server.once('error', (e) => reject(e.code === 'EADDRINUSE' ? new Error(`Port ${port} (${what}) is in use - is it already running, perhaps in ter-manager? Stop that, or set another port in studio.config.json.`) : e));
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}
