/* The first-run setup's server half (t-2b5970444b): adb's output read
 * right, the engines asked only what the setup needs, the folder dialog's
 * answers, the phone linked under the right storage, and the setup routes
 * behind the studio's guards. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig, plugins, saveConfigFile } from '../studio/config.js';
import { createStudioServer, listen } from '../studio/host.js';
import { FirstRun, parseDevices, parseFound, relayAllowed, pickFolder, adbCandidates, SetupError } from '../studio/firstrun.js';
import { checkDeps, installSteps, Jobs, LINKS, PLATFORMS } from '../studio/deps.js';

const tmp = (t) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-first-')); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };

test("adb's device list: each phone, its state and model", () => {
  const out = 'List of devices attached\nRF8N738EZKK            device product:r7nsxx model:SM_N770F device:r7 transport_id:6\nemulator-5554 unauthorized transport_id:2\n\n';
  assert.deepEqual(parseDevices(out), [
    { serial: 'RF8N738EZKK', state: 'device', model: 'SM N770F' },
    { serial: 'emulator-5554', state: 'unauthorized', model: null },
  ]);
  assert.deepEqual(parseDevices('List of devices attached\n'), []);
});

test("CanvasXP's folders found on the phone, relative to their storage; nothing odd taken", () => {
  const found = parseFound('/sdcard/New2/_canvasxp/device.json\n/storage/1A2B-3C4D/Canvases/Work/_canvasxp/device.json\n/sdcard/../x/_canvasxp/device.json\n/data/x/_canvasxp/device.json\n');
  assert.deepEqual(found.map((f) => [f.root, f.segs]), [['/sdcard', ['New2']], ['/storage/1A2B-3C4D', ['Canvases', 'Work']]]);
});

test('the engines are asked only what the setup needs', () => {
  assert.ok(relayAllowed('rag', 'POST', '/api/ollama/pull'));
  assert.ok(relayAllowed('notex', 'POST', '/api/phone/sync'));
  assert.ok(!relayAllowed('rag', 'POST', '/api/shutdown'));
  assert.ok(!relayAllowed('notex', 'PUT', '/api/workspace'), 'the workspace is set by the folders step only');
  assert.ok(!relayAllowed('notex', 'GET', '/api/state/../shutdown'));
  assert.ok(!relayAllowed('other', 'GET', '/api/state'));
});

test("the folder dialog: a chosen folder, a cancel, and no dialog on the computer", async () => {
  const fake = (stdout, err = null) => (cmd, args, opts, cb) => { assert.equal(opts.env.STUDIO_PICK_TITLE, 'Pick'); cb(err, stdout); };
  assert.equal(await pickFolder({ title: 'Pick' }, { platform: 'win32', run: fake('C:\\Users\\a\\Canvases\r\n') }), path.resolve('C:\\Users\\a\\Canvases'));
  assert.equal(await pickFolder({ title: 'Pick' }, { platform: 'win32', run: fake('') }), null);
  assert.equal(await pickFolder({ title: 'Pick' }, { platform: 'darwin', run: fake('', Object.assign(new Error('cancel'), { code: 1 })) }), null);
  await assert.rejects(pickFolder({ title: 'Pick' }, { platform: 'linux', run: fake('', Object.assign(new Error('x'), { code: 'ENOENT' })) }), /no folder dialog/);
});

test('adb is looked for on PATH, in the SDK folders, then in the studio tools folder', () => {
  const c = adbCandidates({ PATH: ['X:\\bin', 'Y:\\tools'].join(path.delimiter), LOCALAPPDATA: 'L:\\local' }, 'H:\\home');
  assert.equal(path.dirname(c[0]), 'X:\\bin');
  assert.ok(c.some((p) => p.includes(path.join('Android', 'Sdk', 'platform-tools'))));
  assert.ok(c.at(-1).includes(path.join('tools', 'platform-tools')));
});

test('settings saved into studio.config.json keep what the file held', (t) => {
  const d = tmp(t);
  const file = path.join(d, 'studio.config.json');
  fs.writeFileSync(file, JSON.stringify({ ports: { studio: 7100 }, open: false }));
  saveConfigFile(file, { setup: { started: 'x' } });
  saveConfigFile(file, { dataDir: d });
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { ports: { studio: 7100 }, open: false, setup: { started: 'x' }, dataDir: d });
  assert.deepEqual(loadConfig({ file }).setup, { started: 'x' });
});

/* A FirstRun whose engine calls and adb are stand-ins. */
function stub({ storages = ['Internal storage', 'SD card'], mtp = ["Paveen's Galaxy Note10 Lite"], found = [{ root: '/sdcard', folder: '/sdcard/New2', segs: ['New2'], id: 'dev1' }], setupAt = 'Internal storage' } = {}) {
  const calls = [];
  const adb = {
    path: () => 'adb', devices: async () => [{ serial: 'S1', state: 'device', model: 'SM N770F', name: "Paveen's Galaxy Note10 Lite" }],
    findCanvasxp: async () => found,
  };
  const config = { setup: {}, file: path.join(os.tmpdir(), `none-${process.pid}.json`), dataDir: 'D:/data', ports: { phone: 8080 } };
  const fr = new FirstRun({ config, plugs: {}, engines: {}, adb });
  fr.call = async (id, method, p, body) => {
    calls.push([id, method, p, body]);
    if (p === '/api/phone/devices') return { devices: mtp.map((name) => ({ name })) };
    if (p.startsWith('/api/phone/browse')) return { folders: storages };
    if (method === 'PUT' && p === '/api/phone') {
      if (body.path[0] !== setupAt) throw new SetupError(400, 'That folder is not set up by CanvasXP');
      return { phone: { device: body.device, path: body.path, id: 'dev1', name: 'Phone' } };
    }
    throw new Error(`unexpected ${method} ${p}`);
  };
  return { fr, calls };
}

test('the phone is linked to the folder CanvasXP set up, under the storage File transfer shows it in', async () => {
  const { fr, calls } = stub();
  const r = await fr.linkPhone('S1');
  assert.deepEqual(r.phone.path, ['Internal storage', 'New2']);
  assert.equal(r.phone.device, "Paveen's Galaxy Note10 Lite");
  // The phone's own storage is tried before the SD card.
  assert.deepEqual(calls.filter((c) => c[1] === 'PUT').map((c) => c[3].path[0]), ['Internal storage']);

  const sd = stub({ found: [{ root: '/storage/1A2B-3C4D', folder: '/storage/1A2B-3C4D/C', segs: ['C'], id: 'dev1' }], setupAt: 'SD card' });
  assert.deepEqual((await sd.fr.linkPhone('S1')).phone.path, ['SD card', 'C']);
  assert.deepEqual(sd.calls.filter((c) => c[1] === 'PUT').map((c) => c[3].path[0]), ['SD card']);
});

test('linking says what is missing: no CanvasXP folder yet, or the phone not in File transfer', async () => {
  await assert.rejects(stub({ found: [] }).fr.linkPhone('S1'), (e) => e.code === 'no-folder' && /Set up USB sync/.test(e.message));
  await assert.rejects(stub({ mtp: [] }).fr.linkPhone('S1'), (e) => e.code === 'no-mtp' && /File transfer/.test(e.message));
  // One phone in File transfer under another name is still that phone.
  assert.ok(await stub({ mtp: ['Galaxy'] }).fr.linkPhone('S1'));
  await assert.rejects(stub({ mtp: ['A', 'B'] }).fr.linkPhone('S1'), /Unplug the other phones/);
});

test('the setup routes stand behind the studio token, and refuse what is not on the list', async (t) => {
  const d = tmp(t);
  const config = loadConfig({ file: path.join(d, 'studio.config.json'), overrides: { dataDir: d, ports: { studio: 7391, ragx: 7392, notex: 7393, canvasx: 7394, phone: 7395 } } });
  const fr = new FirstRun({ config, plugs: plugins(d), engines: {}, adb: { path: () => null, devices: async () => [] } });
  const { server, token } = createStudioServer({ config, plugs: plugins(d), engines: {}, firstRun: fr, publicDir: path.join(d) });
  await listen(server, 7391, 'test');
  t.after(() => server.close());
  const call = (p, { method = 'GET', body, tok = token } = {}) => fetch(`http://127.0.0.1:7391/api/host/${p}`, { method, headers: { 'x-studio-token': tok, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body && JSON.stringify(body) });
  assert.equal((await call('setup', { tok: 'wrong' })).status, 401);
  const relay = await call('setup/relay', { method: 'POST', body: { id: 'rag', method: 'POST', path: '/api/shutdown' } });
  assert.equal(relay.status, 403);
  const folders = await call('setup/folders', { method: 'POST', body: { canvas: 'relative/path', data: d } });
  assert.equal(folders.status, 400);
  assert.match((await folders.json()).error.message, /full path/);
  const nested = await call('setup/folders', { method: 'POST', body: { canvas: path.join(d, 'canvases'), data: d } });
  assert.match((await nested.json()).error.message, /apart/);
  const phone = await (await call('setup/phone')).json();
  assert.equal(phone.adb, null);
  assert.match(phone.download.url, /^https:\/\/dl\.google\.com\/android\/repository\/platform-tools-latest-/);
});

test('a file deleted while it is being served never takes the server down (t-514f8b964d)', async (t) => {
  const { createStaticServer } = await import('../studio/host.js');
  const d = tmp(t);
  const f = path.join(d, 'runtime.json');
  fs.writeFileSync(f, '{"url":"http://127.0.0.1:1"}');
  const { server } = createStaticServer({ root: d, port: 7396 });
  await listen(server, 7396, 'test');
  t.after(() => server.close());
  // The engine stopping deletes its runtime.json right after the server has looked at it.
  const realStat = fs.statSync;
  fs.statSync = (p, ...rest) => { const st = realStat(p, ...rest); if (path.resolve(String(p)) === f) fs.rmSync(f, { force: true }); return st; };
  t.after(() => { fs.statSync = realStat; });
  let status;
  try { status = (await fetch('http://127.0.0.1:7396/runtime.json')).status; } catch (_) { status = 'cut'; }
  fs.statSync = realStat;
  assert.ok(status === 404 || status === 'cut', `answered ${status}`);
  fs.writeFileSync(f, '{"ok":true}');
  assert.equal((await fetch('http://127.0.0.1:7396/runtime.json')).status, 200, 'the server still answers');
});

/* The setup's dependencies and agent platform (t-80c9a58283, t-621a165092). */
test('the dependencies: each checked, the studio\'s own installable, the programs linked', async (t) => {
  const d = tmp(t);
  const plugs = plugins(d);
  const have = new Set(['git', 'claude']);
  const check = async (cmd) => (have.has(cmd) ? `${cmd} 1.0` : null);
  fs.mkdirSync(path.join(d, '.git'));
  let list = await checkDeps({ root: d, plugs, nodeVersion: 'v24.1.0', check, fetcher: async () => ({ ok: false }), agy: async () => null, platform: 'linux' });
  const by = (id) => list.find((x) => x.id === id);
  assert.equal(by('node').state, 'ok');
  assert.equal(by('git').state, 'ok');
  assert.deepEqual([by('projects').state, by('projects').install], ['missing', true]);
  assert.equal(by('packages').install, false); // nothing to install into before RAGX is fetched
  assert.deepEqual([by('ollama').state, by('ollama').install, by('ollama').link], ['missing', false, LINKS.ollama]);
  assert.equal(by('claude').state, 'ok');
  assert.deepEqual([by('agy').state, by('agy').link], ['missing', LINKS.agy]);

  // RAGX and NoteX here: the packages and the pages can be installed; Ollama installed but stopped can be started.
  for (const p of Object.values(plugs)) { fs.mkdirSync(path.join(p.repo, 'engine'), { recursive: true }); fs.writeFileSync(path.join(p.repo, 'engine', 'cli.js'), ''); fs.mkdirSync(path.join(p.repo, 'plugin'), { recursive: true }); }
  fs.writeFileSync(path.join(plugs.rag.repo, 'package.json'), '{}');
  fs.mkdirSync(path.join(d, 'canvasx'));
  fs.writeFileSync(path.join(d, 'canvasx', 'index.html'), '');
  fs.writeFileSync(path.join(plugs.notex.repo, 'plugin', 'local.json'), JSON.stringify({ repo: plugs.notex.repo }));
  have.add('ollama');
  assert.equal(list.find((x) => x.id === 'launcher'), undefined); // Windows only for now
  list = await checkDeps({ root: d, plugs, nodeVersion: 'v22.0.0', check, fetcher: async () => ({ ok: false }), agy: async () => 'agy', platform: 'win32', launcher: async () => false });
  assert.deepEqual([list.find((x) => x.id === 'launcher').state, list.find((x) => x.id === 'launcher').install], ['missing', true]);
  assert.equal(installSteps('launcher', { root: d, plugs }).steps.length, 3);
  assert.equal(list.find((x) => x.id === 'node').state, 'missing');
  assert.equal(list.find((x) => x.id === 'projects').state, 'ok');
  assert.equal(list.find((x) => x.id === 'packages').install, true);
  assert.match(list.find((x) => x.id === 'pages').detail, /^RAGX not told/);
  assert.deepEqual([list.find((x) => x.id === 'ollama').detail, list.find((x) => x.id === 'ollama').install], ['ollama 1.0, not running', true]);
  assert.equal(list.find((x) => x.id === 'agy').state, 'ok');

  assert.deepEqual(installSteps('projects', { root: d, plugs }).steps, [['git', ['submodule', 'update', '--init', '--recursive'], d]]);
  assert.equal(installSteps('packages', { root: d, plugs }).steps[0][1][0], 'install');
  assert.equal(installSteps('ollama', { root: d, plugs }).detach, true);
  assert.equal(installSteps('git', { root: d, plugs }), null);
});

test('an install job runs its steps in turn, keeps their output, and says how it ended', async () => {
  const { EventEmitter } = await import('node:events');
  const ran = [];
  const fake = (code, out) => (cmd, args) => {
    ran.push([cmd, args]);
    const c = new EventEmitter();
    c.stdout = new EventEmitter();
    c.stderr = new EventEmitter();
    setImmediate(() => { c.stdout.emit('data', out); c.emit('close', code); });
    return c;
  };
  const jobs = new Jobs({ run: fake(0, 'added 12 packages\n') });
  jobs.start('pages', [[process.execPath, ['a'], '.'], [process.execPath, ['b'], '.']]);
  assert.equal(jobs.busy('pages'), true);
  assert.equal(jobs.start('pages', []).state, 'running'); // not started twice
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(jobs.get('pages').state, 'done');
  assert.equal(ran.length, 2);
  assert.ok(jobs.get('pages').lines.includes('added 12 packages'));
  const bad = new Jobs({ run: fake(1, 'npm ERR! nope') });
  bad.start('packages', [[process.execPath, ['x'], '.']]);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(bad.get('packages').state, 'failed');
  assert.match(bad.get('packages').error, /code 1/);
});

test('the agent platform is written into NoteX\'s config, keeping what it holds, and RAGX told once it runs', async (t) => {
  const d = tmp(t);
  const config = loadConfig({ file: path.join(d, 'studio.config.json'), overrides: { dataDir: d, canvasxOrigins: ['http://localhost:5500'] } });
  const notexCfg = path.join(d, 'plugins', 'notex', 'config.json');
  fs.mkdirSync(path.dirname(notexCfg), { recursive: true });
  fs.writeFileSync(notexCfg, JSON.stringify({ workspace: 'E:/c', arranger: { other: 1 } }));
  const eng = (id, label) => ({ state: 'stopped', spec: { id, label }, snapshot() { return { id, state: this.state }; } });
  const engines = { rag: eng('rag', 'RAGX'), notex: eng('notex', 'NoteX') };
  const fr = new FirstRun({ config, plugs: plugins(d), engines, adb: { path: () => null } });
  await assert.rejects(fr.chooseAgent('openai'), /claude or gemini/);
  const r = await fr.chooseAgent('gemini');
  assert.deepEqual(r, { agent: 'gemini', notexModel: PLATFORMS.gemini.notexModel, ragx: 'later' });
  const c = JSON.parse(fs.readFileSync(notexCfg, 'utf8'));
  assert.equal(c.workspace, 'E:/c');
  assert.deepEqual(c.arranger, { other: 1, model: 'gemini-3.8-flash-medium' });
  assert.deepEqual(c.canvasxOrigins, ['http://localhost:9075', 'http://127.0.0.1:9075', 'http://localhost:5500']);
  assert.equal(JSON.parse(fs.readFileSync(config.file, 'utf8')).setup.agent, 'gemini');
  // Held engines: the setup is needed, and known at once.
  const st = await fr.status();
  assert.deepEqual([st.held, st.needed, st.known], [true, true, true]);
  await assert.rejects(fr.install('git'), /not something the setup installs/);
  engines.rag.state = 'running';
  await assert.rejects(fr.install('packages'), /Stop NoteX and RAGX first/);
});
