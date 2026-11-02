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
