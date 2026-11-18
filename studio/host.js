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
 *   /api/hello             who answers here and whether its setup is done,
 *                          with no token, only to CanvasX's pages, which
 *                          may also show the studio page in a frame
 *                          (t-c614bd5011); and the RAGX conversations the
 *                          user pinned, for CanvasX's sidebar (t-1b6a07a0c5)
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
import { ROOT, pluginDir, cliOf, dataDirOf, studioOrigins, canvasxOrigins, VERSION } from './config.js';
import { isEngineCommand, openTerminal } from './terminal.js';
import { registered } from './launcher.js';

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

/* The file is opened before anything is sent and read through that handle:
 * an engine deletes its runtime.json as it stops, and a file gone between a
 * stat and an open once ended the whole studio with an unhandled stream
 * error (t-514f8b964d, t-2f8fdb051e). */
function sendFile(res, file, { head = false, index = 'index.html' } = {}) {
  let f = file;
  try { if (fs.statSync(f).isDirectory()) f = path.join(f, index); } catch (_) { return false; }
  let fd;
  try { fd = fs.openSync(f, 'r'); } catch (_) { return false; }
  let st;
  try { st = fs.fstatSync(fd); } catch (_) { fs.closeSync(fd); return false; }
  if (!st.isFile()) { fs.closeSync(fd); return false; }
  res.writeHead(200, {
    'content-type': TYPES[path.extname(f).toLowerCase()] || 'application/octet-stream',
    'content-length': st.size,
    // runtime.json changes with every engine start; the pages read it fresh.
    'cache-control': 'no-store',
  });
  if (head) { fs.closeSync(fd); res.end(); return true; }
  const stream = fs.createReadStream(null, { fd, autoClose: true });
  stream.on('error', () => res.destroy());
  stream.pipe(res);
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
    // The CanvasX pages that may frame this one and tell it which view to show.
    parents: canvasxOrigins(config),
  };
  const attr = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  return html.replace('%%TOKEN%%', attr(token)).replace('%%BOOT%%', attr(JSON.stringify(boot)));
}

export function createStudioServer({ config, plugs, engines, firstRun = null, token = crypto.randomBytes(24).toString('hex'), publicDir = path.join(ROOT, 'studio', 'public'), terminal = openTerminal, log = () => {}, launcher = registered }) {
  const port = config.ports.studio;
  const origins = studioOrigins(config);
  const same = (a, b) => { const x = Buffer.from(String(a || '')), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

  /* RAGX's pinned conversations, for the sidebars (t-1b6a07a0c5): their ids
   * and titles only, asked of the engine at most every 2 s; the last list
   * stands while it does not answer. */
  const pinned = { at: 0, list: [] };
  async function pins() {
    const e = engines.rag;
    const rt = e && e.state === 'running' && typeof e.runtime === 'function' ? e.runtime() : null;
    if (!rt) { pinned.list = []; return pinned.list; }
    if (Date.now() - pinned.at < 2000) return pinned.list;
    pinned.at = Date.now();
    try {
      const r = await fetch(`${rt.url}/api/conversations`, { headers: { [e.spec.tokenHeader]: rt.token, 'x-rag-client': 'plugin' }, signal: AbortSignal.timeout(2000) });
      if (r.ok) {
        const { conversations = [] } = await r.json();
        pinned.list = conversations.filter((c) => c.pinned_at).map((c) => ({ id: Number(c.id), title: String(c.title || '').slice(0, 200) }));
      }
    } catch (_) { /* the last list stands */ }
    return pinned.list;
  }

  async function api(req, res, url) {
    if (req.headers.origin && !origins.includes(req.headers.origin)) return refuse(res, 403, `Requests from ${req.headers.origin} are not accepted.`);
    if (!same(req.headers['x-studio-token'], token)) return refuse(res, 401, 'Missing or wrong X-Studio-Token - reload the studio page.');
    const route = url.pathname.slice('/api/host/'.length);
    const plugin = (id) => plugs[id] || null;

    if (req.method === 'GET' && route === 'status') return json(res, 200, { engines: Object.values(engines).map((e) => e.snapshot()), dataDir: config.dataDir, ports: config.ports, pins: await pins() });
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
    if (firstRun && route.startsWith('setup')) return setupApi(req, res, route);
    return refuse(res, 404, 'No such route.');
  }

  /* The first-run setup's routes (t-2b5970444b); studio/firstrun.js does the work. */
  async function setupApi(req, res, route) {
    const body = async () => { try { return await readBody(req); } catch (_) { throw Object.assign(new Error('The request is not JSON.'), { status: 400 }); } };
    const get = req.method === 'GET';
    const post = req.method === 'POST';
    try {
      if (get && route === 'setup') return json(res, 200, await firstRun.status());
      if (post && route === 'setup/pick') { const b = await body(); return json(res, 200, await firstRun.pickFolder({ title: b.title, initial: b.initial })); }
      if (post && route === 'setup/folders') { const b = await body(); return json(res, 200, await firstRun.applyFolders({ canvas: b.canvas, data: b.data })); }
      if (post && route === 'setup/relay') { const b = await body(); return json(res, 200, await firstRun.relay(String(b.id || ''), String(b.method || 'GET').toUpperCase(), String(b.path || ''), b.body)); }
      if (get && route === 'setup/deps') return json(res, 200, await firstRun.deps());
      if (post && route === 'setup/deps/install') { const b = await body(); return json(res, 200, await firstRun.install(String(b.id || ''))); }
      if (post && route === 'setup/agent') { const b = await body(); return json(res, 200, await firstRun.chooseAgent(String(b.platform || ''))); }
      if (post && route === 'setup/agent/signin') { const b = await body(); return json(res, 200, await firstRun.signIn(b.platform ? String(b.platform) : null)); }
      if (post && route === 'setup/engines/start') return json(res, 200, await firstRun.startEngines());
      if (post && route === 'setup/done') { const b = await body(); return json(res, 200, { setup: firstRun.finish({ phone: b.phone || null }) }); }
      if (get && route === 'setup/phone') return json(res, 200, await firstRun.phoneStatus());
      if (post && route === 'setup/phone/adb') return json(res, 200, await firstRun.downloadAdb());
      const pm = /^setup\/phone\/(open|find|link)$/.exec(route);
      if (post && pm) {
        const serial = String((await body()).serial || '');
        if (!serial) return refuse(res, 400, 'Say which phone (serial).');
        const fn = { open: 'openOnPhone', find: 'findOnPhone', link: 'linkPhone' }[pm[1]];
        return json(res, 200, await firstRun[fn](serial));
      }
      return refuse(res, 404, 'No such route.');
    } catch (e) {
      if (!e.status) log(`setup: ${e.stack || e.message}`);
      return json(res, e.status || 500, { error: { message: e.message, code: e.code || 'failed' } });
    }
  }

  /* CanvasX asks whether the studio is here. It learns no token and can
   * change nothing; a page elsewhere is not answered at all. */
  const launcherSeen = { at: 0, on: false };
  async function hello(req, res) {
    const from = req.headers.origin;
    const parents = canvasxOrigins(config);
    if (!from || !parents.includes(from)) return refuse(res, 403, 'Only CanvasX asks this.');
    res.setHeader('access-control-allow-origin', from);
    res.setHeader('vary', 'Origin');
    if (req.method === 'OPTIONS') {
      // A CanvasX served from a public address asks first, under Private Network Access.
      res.writeHead(204, { 'access-control-allow-methods': 'GET', 'access-control-max-age': '600', ...(req.headers['access-control-request-private-network'] ? { 'access-control-allow-private-network': 'true' } : {}) });
      return res.end();
    }
    if (req.method !== 'GET') return refuse(res, 405, 'Only GET here.');
    // Whether CanvasX's Start the server can start this studio (t-41a81632a9); asked at most every 30 s.
    if (Date.now() - launcherSeen.at > 30_000) { launcherSeen.at = Date.now(); launcherSeen.on = await launcher().catch(() => false); }
    let setupDone = Boolean(config.setup && config.setup.done);
    if (!setupDone && firstRun) { try { setupDone = !(await firstRun.status()).needed; } catch (_) { /* not done */ } }
    return json(res, 200, {
      studio: 'CanvasX Studio', version: VERSION, setupDone, launcher: launcherSeen.on,
      page: `http://127.0.0.1:${port}/`,
      engines: Object.values(engines).map((e) => ({ id: e.spec.id, label: e.spec.label, state: e.state })),
      // What the user pinned in RAGX, for CanvasX's sidebar (t-1b6a07a0c5).
      pins: await pins(),
    });
  }

  const server = http.createServer(async (req, res) => {
    secure(res);
    if (!guardHost(req, res, port)) return;
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    try {
      if (url.pathname === '/api/hello') return await hello(req, res);
      if (url.pathname.startsWith('/api/host/')) return await api(req, res, url);
      if (req.method !== 'GET' && req.method !== 'HEAD') return refuse(res, 405, 'Only GET here.');
      const head = req.method === 'HEAD';
      if (url.pathname === '/' || url.pathname === '/index.html') {
        const html = studioPage({ token, config, plugs, publicDir });
        // Framed only by CanvasX's pages (t-c614bd5011), never by another site.
        res.writeHead(200, { 'content-type': TYPES['.html'], 'cache-control': 'no-store', 'content-security-policy': `frame-ancestors 'self' ${canvasxOrigins(config).join(' ')}`, 'cross-origin-resource-policy': 'cross-origin' });
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
