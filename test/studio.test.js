/* NoteX Studio's launcher: its settings, its servers' guards, how a
 * terminal.open is routed, and how it runs an engine (t-33bd14605d,
 * t-f16266d576, t-dc8e2c779e). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, plugins, dataDirOf, DEFAULTS, cliOf, canvasxOrigins } from '../studio/config.js';
import { ManagedEngine, engineSpecs } from '../studio/engines.js';
import { createStudioServer, createStaticServer, fileIn, listen } from '../studio/host.js';
import { isEngineCommand, windowsScript, safeTitle } from '../studio/terminal.js';
import { parseArgs, holdEngines } from '../studio/start.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const tmp = (t) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-test-')); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };

test('settings: defaults, the file, the command line, and ports that clash', (t) => {
  const d = tmp(t);
  const file = path.join(d, 'studio.config.json');
  const c = loadConfig({ file });
  assert.deepEqual(c.ports, DEFAULTS.ports);
  assert.equal(c.dataDir, DEFAULTS.dataDir);
  fs.writeFileSync(file, JSON.stringify({ dataDir: d, ports: { studio: 7100 }, open: false }));
  const c2 = loadConfig({ file, overrides: { ports: { notex: '7200' } } });
  assert.equal(c2.dataDir, d);
  assert.equal(c2.ports.studio, 7100);
  assert.equal(c2.ports.notex, 7200);
  assert.equal(c2.open, false);
  assert.throws(() => loadConfig({ file, overrides: { ports: { ragx: 7100 } } }), /studio and ragx ports are both 7100/);
  assert.throws(() => loadConfig({ file, overrides: { ports: { ragx: 'x' } } }), /ragx port must be a whole number/);
  assert.deepEqual(dataDirOf(c2, 'rag'), { dir: path.join(d, 'plugins', 'rag'), saveDir: d });
});

test('the engines start as their CLIs say, linked to each other and to the studio page', () => {
  const config = loadConfig({ file: path.join(os.tmpdir(), 'none.json'), overrides: { dataDir: 'D:/data' } });
  const specs = engineSpecs(config, plugins('R:/studio'));
  const rag = specs.rag.args, notex = specs.notex.args;
  assert.equal(rag[0], path.join('R:/studio', 'ragx', 'engine', 'cli.js'));
  assert.deepEqual(rag.slice(1, 4), ['--data-dir', path.resolve('D:/data', 'plugins', 'rag'), 'serve']);
  assert.equal(rag[rag.indexOf('--origin') + 1], 'http://127.0.0.1:7075,http://localhost:7075');
  assert.equal(notex[1], 'serve');
  assert.equal(notex[notex.indexOf('--ragx') + 1], path.join('R:/studio', 'ragx', 'plugin'));
  assert.equal(notex[notex.indexOf('--port') + 1], '7781');
  // RAGX finds NoteX's documents beside its own data folder, as in ter-manager.
  assert.equal(path.resolve(specs.rag.dataDir, '..', 'notex', 'docs'), path.resolve('D:/data', 'plugins', 'notex', 'docs'));
});

test('a terminal.open is the engine only when it runs that plugin\'s own cli.js serve', () => {
  const cli = 'C:\\Studio\\notex\\engine\\cli.js';
  assert.equal(isEngineCommand('"C:\\Program Files\\nodejs\\node.exe" "C:\\Studio\\notex\\engine\\cli.js" serve --data-dir "D:\\x"', cli), true);
  assert.equal(isEngineCommand('node "C:/Studio/notex/engine/cli.js" --data-dir "D:/x" serve', cli), true);
  assert.equal(isEngineCommand('ollama serve', cli), false);
  assert.equal(isEngineCommand('node "C:/Other/engine/cli.js" serve', cli), false);
  assert.equal(isEngineCommand('node "C:/Studio/notex/engine/cli.js" build x', cli), false);
  assert.equal(windowsScript({ cwd: 'C:\\a "b"', cmd: 'ollama pull m', title: 'Ollama & "pull"' }), '@echo off\r\ntitle Ollama  pull\r\ncd /d "C:\\a b"\r\nollama pull m\r\n');
  assert.equal(safeTitle(''), 'NoteX Studio');
});

test('fileIn never leaves its folder nor serves a hidden one', () => {
  const base = path.resolve('/srv/site');
  assert.equal(fileIn(base, '/a/b.js'), path.join(base, 'a', 'b.js'));
  for (const bad of ['/../x', '/a/../../x', '/%2e%2e/x', '/.git/config', '/a/.env', '/%E0%A4%A', '/a\0b']) assert.equal(fileIn(base, bad), null, bad);
});

function request(port, pathname, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: pathname, method, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data, json: () => JSON.parse(data) }));
    });
    req.on('error', reject);
    if (body) req.end(JSON.stringify(body)); else req.end();
  });
}

test('the studio server: its page with the token, the plugin folders, and its guards', async (t) => {
  const d = tmp(t);
  const root = path.join(d, 'root');
  for (const p of ['notex', 'ragx']) {
    fs.mkdirSync(path.join(root, p, 'plugin'), { recursive: true });
    fs.writeFileSync(path.join(root, p, 'plugin', 'plugin.html'), `<p>${p}</p>`);
    fs.writeFileSync(path.join(root, p, 'plugin', 'runtime.json'), '{"url":"x"}');
  }
  fs.mkdirSync(path.join(root, 'ragx', 'plugin', '.secret'));
  fs.writeFileSync(path.join(root, 'ragx', 'plugin', '.secret', 'k'), 'no');
  const probe = http.createServer();
  await new Promise((r) => probe.listen(0, '127.0.0.1', r));
  const port = probe.address().port;
  await new Promise((r) => probe.close(r));

  const config = loadConfig({ file: path.join(d, 'none.json'), overrides: { dataDir: path.join(d, 'data'), ports: { studio: port, ragx: port + 1, notex: port + 2, canvasx: port + 3 } } });
  const plugs = plugins(root);
  const opened = [];
  const restarted = [];
  const engines = { notex: { spec: { id: 'notex' }, snapshot: () => ({ id: 'notex', state: 'running' }), logs: () => ['a', 'b'], restart: async () => { restarted.push('notex'); return {}; } } };
  const s = createStudioServer({ config, plugs, engines, token: 'tok', terminal: async (o) => { opened.push(o); return { opened: true }; } });
  await listen(s.server, port, 'test');
  t.after(() => s.server.close());
  const auth = { 'x-studio-token': 'tok' };

  const page = await request(port, '/');
  assert.equal(page.status, 200);
  assert.match(page.body, /<meta name="studio-token" content="tok">/);
  assert.match(page.body, /&quot;id&quot;:&quot;notex&quot;/);
  // Framed only by the studio itself and CanvasX's pages (t-c614bd5011).
  assert.equal(page.headers['content-security-policy'], `frame-ancestors 'self' http://127.0.0.1:${port + 3} http://localhost:${port + 3}`);

  // CanvasX asks whether the studio is here: answered to CanvasX only, and with no token.
  const cx = `http://localhost:${port + 3}`;
  const hi = await request(port, '/api/hello', { headers: { origin: cx } });
  assert.equal(hi.status, 200);
  assert.equal(hi.headers['access-control-allow-origin'], cx);
  assert.equal(hi.json().studio, 'NoteX Studio');
  assert.equal(hi.json().setupDone, false);
  assert.doesNotMatch(hi.body, /tok/);
  assert.equal((await request(port, '/api/hello', { headers: { origin: 'http://evil.example' } })).status, 403);
  assert.equal((await request(port, '/api/hello')).status, 403);
  const pre = await request(port, '/api/hello', { method: 'OPTIONS', headers: { origin: cx, 'access-control-request-private-network': 'true' } });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers['access-control-allow-private-network'], 'true');
  // CanvasX's origin gets no further than hello.
  assert.equal((await request(port, '/api/host/status', { headers: { ...auth, origin: cx } })).status, 403);
  assert.equal((await request(port, '/plugins/notex/plugin.html')).body, '<p>notex</p>');
  assert.equal((await request(port, '/plugins/rag/')).body, '<p>ragx</p>');
  assert.equal((await request(port, '/plugins/rag/runtime.json')).headers['cache-control'], 'no-store');
  assert.equal((await request(port, '/plugins/rag/.secret/k')).status, 404);
  assert.equal((await request(port, '/plugins/other/plugin.html')).status, 404);
  assert.match((await request(port, '/plugin-host.js')).body, /window\.TerManager|global\.TerManager/);

  // Guards: a foreign Host, no token, another origin.
  assert.equal((await request(port, '/', { headers: { host: `evil.example:${port}` } })).status, 403);
  assert.equal((await request(port, '/api/host/status')).status, 401);
  assert.equal((await request(port, '/api/host/status', { headers: { ...auth, origin: 'http://evil.example' } })).status, 403);
  assert.equal((await request(port, '/api/host/terminal', { method: 'POST', headers: { 'x-studio-token': 'wrong' }, body: { plugin: 'rag', cmd: 'calc' } })).status, 401);
  assert.equal(opened.length, 0);

  const st = (await request(port, '/api/host/status', { headers: { ...auth, origin: `http://localhost:${port}` } })).json();
  assert.deepEqual(st.engines, [{ id: 'notex', state: 'running' }]);
  assert.deepEqual((await request(port, '/api/host/logs?id=notex', { headers: auth })).json().lines, ['a', 'b']);
  const dd = (await request(port, '/api/host/data-dir?id=rag', { headers: auth })).json();
  assert.equal(dd.dir, path.join(d, 'data', 'plugins', 'rag'));
  assert.ok(fs.existsSync(dd.dir));
  assert.equal((await request(port, '/api/host/data-dir?id=nope', { headers: auth })).status, 404);

  // terminal.open: the plugin's own engine is restarted; anything else opens a terminal.
  const eng = await request(port, '/api/host/terminal', { method: 'POST', headers: auth, body: { plugin: 'notex', cmd: `node "${cliOf(plugs.notex)}" serve --data-dir x` } });
  assert.deepEqual(eng.json(), { opened: true, engine: true });
  assert.deepEqual(restarted, ['notex']);
  assert.equal(opened.length, 0);
  const term = await request(port, '/api/host/terminal', { method: 'POST', headers: auth, body: { plugin: 'rag', cmd: 'ollama pull m', cwd: 'C:/x', title: 'Ollama pull' } });
  assert.deepEqual(term.json(), { opened: true });
  assert.deepEqual(opened, [{ cwd: 'C:/x', cmd: 'ollama pull m', title: 'Ollama pull' }]);
});

test('the CanvasX server serves its folder and nothing hidden', async (t) => {
  const d = tmp(t);
  fs.writeFileSync(path.join(d, 'index.html'), '<h1>CanvasX</h1>');
  fs.mkdirSync(path.join(d, '.git'));
  fs.writeFileSync(path.join(d, '.git', 'config'), 'x');
  const s = createStaticServer({ root: d, port: 0 });
  await new Promise((r) => s.server.listen(0, '127.0.0.1', r));
  const port = s.server.address().port;
  t.after(() => s.server.close());
  // Its guard knows the configured port, 0 here, so a test request names that Host.
  const get = (p) => new Promise((resolve) => http.get({ host: '127.0.0.1', port, path: p, headers: { host: '127.0.0.1:0' } }, (res) => { let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve({ status: res.statusCode, body: b })); }));
  assert.equal((await get('/')).body, '<h1>CanvasX</h1>');
  assert.equal((await get('/.git/config')).status, 404);
  assert.equal((await new Promise((resolve) => http.get({ host: '127.0.0.1', port, path: '/' }, (res) => { res.resume(); resolve(res.statusCode); }))), 403);
});

function fakeSpec(d, mode = '') {
  const runtimeFile = path.join(d, 'runtime.json');
  return { id: 'fake', label: 'Fake', cwd: HERE, port: 0, runtimeFile, tokenHeader: 'x-test-token', dataDir: path.join(d, 'data'), args: [path.join(HERE, 'fake-engine.mjs'), runtimeFile, mode].filter(Boolean) };
}
const until = async (fn, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 50)); } return false; };

test('an engine runs once it answers, and stops by being asked', async (t) => {
  const d = tmp(t);
  const e = new ManagedEngine(fakeSpec(d), { pollMs: 50 });
  t.after(() => e.stop());
  // A runtime.json from another process is not believed.
  fs.writeFileSync(path.join(d, 'runtime.json'), JSON.stringify({ url: 'http://127.0.0.1:1', token: 'old', pid: 1 }));
  e.start();
  assert.equal(e.state, 'starting');
  assert.ok(await until(() => e.state === 'running'), `state ${e.state} ${e.detail}`);
  assert.match(e.snapshot().url, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.ok(e.logs().some((l) => l.startsWith('fake engine at')));
  await e.stop();
  assert.equal(e.state, 'stopped');
  assert.equal(fs.existsSync(path.join(d, 'runtime.json')), false, 'it removed its own runtime.json');
  e.start();
  assert.ok(await until(() => e.state === 'running'));
  const pid = e.snapshot().pid;
  await e.restart();
  assert.ok(await until(() => e.state === 'running'));
  assert.notEqual(e.snapshot().pid, pid);
});

test('an engine that fails says why; one that will not stop is ended', async (t) => {
  const d = tmp(t);
  const bad = new ManagedEngine(fakeSpec(d, 'crash'), { pollMs: 50 });
  bad.start();
  assert.ok(await until(() => bad.state === 'failed'));
  assert.match(bad.detail, /exited with code 3: boom: no workspace/);
  const stubborn = new ManagedEngine(fakeSpec(d, 'slow-stop'), { pollMs: 50 });
  stubborn.start();
  assert.ok(await until(() => stubborn.state === 'running'));
  await stubborn.stop({ timeoutMs: 500 });
  assert.equal(stubborn.state, 'stopped');
  assert.ok(stubborn.logs().some((l) => /did not stop within/.test(l)));
});

test('the command line', () => {
  assert.deepEqual(parseArgs(['--no-open', '--data', 'D:/x', '--notex-port', '7900']), { ports: { notex: '7900' }, open: false, dataDir: 'D:/x' });
  assert.throws(() => parseArgs(['--data']), /needs a value/);
  assert.throws(() => parseArgs(['--what']), /Unknown option/);
  assert.deepEqual(parseArgs(['--canvasx-origin', 'http://localhost:5500', '--canvasx-origin', 'https://x.example']).canvasxOrigins, ['http://localhost:5500', 'https://x.example']);
});

test('a CanvasX served elsewhere is kept as its origin, and a bad one refused (t-08d48066f9)', (t) => {
  const d = tmp(t);
  const file = path.join(d, 'studio.config.json');
  const c = loadConfig({ file, overrides: { canvasxOrigins: ['http://localhost:5500/index.html'] } });
  assert.deepEqual(c.canvasxOrigins, ['http://localhost:5500']);
  assert.deepEqual(canvasxOrigins(c), ['http://127.0.0.1:9075', 'http://localhost:9075', 'http://localhost:5500']);
  assert.throws(() => loadConfig({ file, overrides: { canvasxOrigins: ['file:///C:/x'] } }), /not an http/);
  assert.throws(() => loadConfig({ file, overrides: { canvasxOrigins: ['nope'] } }), /not an address/);
});

test('the engines wait for the setup on a first run, and start by themselves after it', (t) => {
  const d = tmp(t);
  const config = loadConfig({ file: path.join(d, 'c.json'), overrides: { dataDir: d } });
  assert.equal(holdEngines(config, []), true);
  assert.equal(holdEngines(config, ['RAGX is not here']), true);
  fs.mkdirSync(path.join(d, 'plugins', 'notex'), { recursive: true });
  fs.writeFileSync(path.join(d, 'plugins', 'notex', 'config.json'), JSON.stringify({ workspace: 'E:/canvases' }));
  assert.equal(holdEngines(config, []), false);
  assert.equal(holdEngines({ ...config, setup: { done: 'yes' } }, ['RAGX is not here']), true);
});
