/* One NoteX and one RAGX shared with ter-manager (t-5cb2f89c68): the
 * folders and data studio.config.json may name, the pages the engines let
 * in, and an engine already running used as it is, never stopped. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { loadConfig, plugins, dataDirOf } from '../studio/config.js';
import { ManagedEngine, engineSpecs } from '../studio/engines.js';
import { writeNotexConfig } from '../studio/deps.js';

const tmp = (t) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-shared-')); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };

test('studio.config.json can name the engines\' folders, their data and the pages they also serve', (t) => {
  const d = tmp(t);
  const file = path.join(d, 'studio.config.json');
  fs.writeFileSync(file, JSON.stringify({
    projects: { notex: 'E:\\Coding CLI\\Project NoteX', rag: 'E:\\Coding CLI\\Project Harness' },
    engineData: { notex: 'E:\\ter-manager\\plugins\\notex', rag: 'E:\\ter-manager\\plugins\\rag' },
    engineOrigins: ['http://127.0.0.1:7070', 'http://localhost:7070/'],
  }));
  const c = loadConfig({ file });
  const plugs = plugins('R:\\studio', c.projects);
  assert.equal(plugs.notex.repo, path.resolve('E:\\Coding CLI\\Project NoteX'));
  assert.equal(plugs.rag.repo, path.resolve('E:\\Coding CLI\\Project Harness'));
  assert.equal(dataDirOf(c, 'notex').dir, path.resolve('E:\\ter-manager\\plugins\\notex'));
  // RAGX still finds NoteX's documents beside its own data, as in ter-manager.
  assert.equal(path.resolve(dataDirOf(c, 'rag').dir, '..', 'notex', 'docs'), path.resolve('E:\\ter-manager\\plugins\\notex\\docs'));
  const specs = engineSpecs(c, plugs);
  const origins = specs.notex.args[specs.notex.args.indexOf('--origin') + 1].split(',');
  assert.deepEqual(origins, ['http://127.0.0.1:7075', 'http://localhost:7075', 'http://127.0.0.1:7070', 'http://localhost:7070']);
  assert.equal(specs.notex.runtimeFile, path.join(path.resolve('E:\\Coding CLI\\Project NoteX'), 'plugin', 'runtime.json'));
  // Without them, the submodules and the studio's own data, as before.
  const plain = loadConfig({ file: path.join(d, 'none.json'), overrides: { dataDir: d } });
  assert.equal(plugins('R:\\studio', plain.projects).notex.repo, path.join('R:\\studio', 'notex'));
  assert.equal(dataDirOf(plain, 'rag').dir, path.join(d, 'plugins', 'rag'));
  fs.writeFileSync(file, JSON.stringify({ projects: { notex: 'relative\\NoteX' } }));
  assert.throws(() => loadConfig({ file }), /projects\.notex .* must be a full path/);
});

test('an engine already running is used as it is when it lets the studio in, and never stopped by the studio', async (t) => {
  const d = tmp(t);
  const server = http.createServer((req, res) => {
    if (req.headers['x-notex-token'] !== 'tok') { res.writeHead(401); return res.end(); }
    if (req.headers.origin && req.headers.origin !== 'http://127.0.0.1:7075') { res.writeHead(403); return res.end(); }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{}');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}`;
  const runtimeFile = path.join(d, 'runtime.json');
  const spec = { id: 'notex', label: 'NoteX', cwd: d, args: [], port: server.address().port, runtimeFile, tokenHeader: 'x-notex-token', dataDir: d };

  const e = new ManagedEngine(spec);
  assert.deepEqual(await e.adopt({ origin: 'http://127.0.0.1:7075' }), { ok: false, why: 'no-runtime' });
  fs.writeFileSync(runtimeFile, JSON.stringify({ url, port: spec.port, token: 'tok', pid: 4242 }));
  assert.deepEqual(await e.adopt({ origin: 'http://127.0.0.1:7999' }), { ok: false, why: 'origin' });
  assert.deepEqual(await e.adopt({ origin: 'http://127.0.0.1:7075' }), { ok: true });
  assert.equal(e.state, 'running');
  assert.equal(e.snapshot().shared, true);
  assert.equal(e.snapshot().pid, 4242);
  assert.equal(e.runtime().token, 'tok'); // the setup reaches it like its own
  assert.equal(e.start().state, 'running'); // still running: nothing started
  await e.stop();
  assert.equal(e.state, 'stopped');
  assert.match(e.detail, /left running where it was started/);
  assert.ok(fs.existsSync(runtimeFile)); // it was not asked to shut down
});

test('a NoteX shared with ter-manager keeps the model it has there', (t) => {
  const file = path.join(tmp(t), 'config.json');
  fs.writeFileSync(file, JSON.stringify({ workspace: 'W', arranger: { model: 'opus' } }));
  assert.equal(writeNotexConfig(file, { model: 'sonnet', keepModel: true }).arranger.model, 'opus');
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).workspace, 'W');
  assert.equal(writeNotexConfig(file, { model: 'sonnet' }).arranger.model, 'sonnet');
});
