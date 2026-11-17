/* The first-run setup, the server's half (t-2b5970444b): what the studio
 * page's setup screen asks of the PC.
 *
 * - Folders come from the operating system's own folder dialog, opened here
 *   on the PC the studio runs on (t-c3a090b64a). A new data folder is
 *   written to studio.config.json and both engines restart on it.
 * - The engines are called from here, with each one's runtime.json, through
 *   a short list of their routes (t-e8bb501103, t-b83ee3dc31).
 * - The phone: adb, found or downloaded from Google when the user asks
 *   (t-c247850a37), forwards localhost:8080 on the phone to CanvasXP served
 *   here (t-d4739a5f8f) and opens it there; once CanvasXP has set up its
 *   folder, adb finds that folder and NoteX's phone sync is linked to it
 *   over File transfer, with no browsing (t-9a05b8dc7e).
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT, DEFAULTS, saveConfigFile, canvasxOrigins, NOTEX_CANVASX_ORIGINS } from './config.js';
import { engineSpecs } from './engines.js';
import { checkDeps, installSteps, Jobs, PLATFORMS, findAgy, writeNotexConfig } from './deps.js';
import { openTerminal } from './terminal.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export class SetupError extends Error {
  constructor(status, message, code = 'failed') { super(message); this.status = status; this.code = code; }
}

/* ------------------------------------------------------- folder dialog */

const PICK_PS = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms
$d = New-Object System.Windows.Forms.FolderBrowserDialog
$d.Description = $env:STUDIO_PICK_TITLE
$d.ShowNewFolderButton = $true
if ($env:STUDIO_PICK_START -and (Test-Path -LiteralPath $env:STUDIO_PICK_START)) { $d.SelectedPath = $env:STUDIO_PICK_START }
$o = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true; ShowInTaskbar = $false; Opacity = 0; StartPosition = 'CenterScreen' }
$o.Show(); $o.Activate()
$r = $d.ShowDialog($o)
$o.Close()
if ($r -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($d.SelectedPath) }
`;

/* The folder the user chose, or null when they cancelled. Title and start
 * folder go in the environment, so no path is ever quoted into a script. */
export function pickFolder({ title = 'Choose a folder', initial = '' } = {}, { platform = process.platform, run = execFile } = {}) {
  const env = { ...process.env, STUDIO_PICK_TITLE: String(title).slice(0, 200), STUDIO_PICK_START: String(initial || '') };
  const [cmd, args] = platform === 'win32' ? ['powershell.exe', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-Command', PICK_PS]]
    : platform === 'darwin' ? ['osascript', ['-e', 'POSIX path of (choose folder with prompt (system attribute "STUDIO_PICK_TITLE"))']]
      : ['zenity', ['--file-selection', '--directory', `--title=${String(title).slice(0, 200)}`]];
  return new Promise((resolve, reject) => {
    run(cmd, args, { env, windowsHide: false, timeout: 15 * 60_000, encoding: 'utf8' }, (err, stdout) => {
      const out = String(stdout || '').trim();
      if (out) return resolve(path.resolve(out));
      // Cancelling ends osascript and zenity with code 1; it is not an error.
      if (!err || err.code === 1) return resolve(null);
      reject(new Error(err.code === 'ENOENT' ? `This computer has no folder dialog (${cmd}); type the path instead.` : `The folder dialog failed: ${err.message}`));
    });
  });
}

/* ----------------------------------------------------------------- adb */

const ADB_EXE = process.platform === 'win32' ? 'adb.exe' : 'adb';
export const TOOLS_DIR = path.join(ROOT, 'tools');
const ZIP = { win32: 'windows', darwin: 'darwin', linux: 'linux' }[process.platform] || 'linux';
export const PLATFORM_TOOLS_URL = `https://dl.google.com/android/repository/platform-tools-latest-${ZIP}.zip`;
export const PLATFORM_TOOLS_TERMS = 'https://developer.android.com/studio/releases/platform-tools';

/* Where adb usually is: PATH, the Android SDK's folders, then the copy
 * this studio downloaded. */
export function adbCandidates(env = process.env, home = os.homedir()) {
  const out = [];
  if (env.ADB) out.push(env.ADB);
  for (const d of String(env.PATH || env.Path || '').split(path.delimiter).filter(Boolean)) out.push(path.join(d, ADB_EXE));
  for (const sdk of [env.ANDROID_HOME, env.ANDROID_SDK_ROOT].filter(Boolean)) out.push(path.join(sdk, 'platform-tools', ADB_EXE));
  if (env.LOCALAPPDATA) out.push(path.join(env.LOCALAPPDATA, 'Android', 'Sdk', 'platform-tools', ADB_EXE), path.join(env.LOCALAPPDATA, 'Android', 'platform-tools', ADB_EXE));
  out.push(path.join(home, 'Library', 'Android', 'sdk', 'platform-tools', ADB_EXE), path.join(home, 'Android', 'Sdk', 'platform-tools', ADB_EXE));
  out.push(path.join(TOOLS_DIR, 'platform-tools', ADB_EXE));
  return out;
}

/* Lines of `adb devices -l`: each phone with its state and model. */
export function parseDevices(text) {
  const out = [];
  for (const line of String(text).split(/\r?\n/).slice(1)) {
    const m = /^(\S+)\s+(device|unauthorized|offline|authorizing|no permissions|recovery|sideload|bootloader)\b(.*)$/.exec(line.trim());
    if (!m) continue;
    const model = /\bmodel:(\S+)/.exec(m[3]);
    out.push({ serial: m[1], state: m[2], model: model ? model[1].replace(/_/g, ' ') : null });
  }
  return out;
}

/* The folders on the phone holding _canvasxp/device.json, from find's
 * output: each folder relative to the storage it is on. */
export function parseFound(text) {
  const out = [];
  for (const line of String(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
    const m = /^(\/sdcard|\/storage\/emulated\/0|\/storage\/[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4})\/(.+)\/_canvasxp\/device\.json$/.exec(line);
    if (!m) continue;
    const segs = m[2].split('/').filter(Boolean);
    if (segs.some((s) => s === '..' || s === '.')) continue;
    out.push({ file: line, root: m[1], folder: `${m[1]}/${m[2]}`, segs });
  }
  return out;
}

export class Adb {
  constructor({ candidates = adbCandidates(), run = execFile, fetchImpl = globalThis.fetch } = {}) {
    Object.assign(this, { candidates, run, fetchImpl });
    this.downloading = null;
  }

  path() { return this.candidates.find((p) => { try { return fs.statSync(p).isFile(); } catch (_) { return false; } }) || null; }

  exec(args, { timeout = 30_000 } = {}) {
    const exe = this.path();
    if (!exe) return Promise.reject(new SetupError(409, 'adb is not on this PC yet.', 'no-adb'));
    return new Promise((resolve, reject) => {
      this.run(exe, args, { timeout, windowsHide: true, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
        if (err && !stdout) return reject(new SetupError(502, `adb ${args[0] === '-s' ? args[2] : args[0]} failed: ${String(stderr || err.message).trim().split('\n').pop()}`, 'adb'));
        resolve(String(stdout || ''));
      });
    });
  }

  async devices() {
    const list = parseDevices(await this.exec(['devices', '-l']));
    // A phone's own name - the one File transfer shows Windows - when it lets adb read it.
    for (const d of list) {
      if (d.state !== 'device') continue;
      const name = (await this.exec(['-s', d.serial, 'shell', 'settings get global device_name']).catch(() => '')).trim();
      d.name = name && name !== 'null' ? name : d.model;
    }
    return list;
  }

  async reverse(serial, port) { await this.exec(['-s', serial, 'reverse', `tcp:${port}`, `tcp:${port}`]); }

  async openUrl(serial, url) {
    if (!/^http:\/\/localhost:\d+\/$/.test(url)) throw new SetupError(400, 'Only localhost addresses are opened on the phone.');
    return this.exec(['-s', serial, 'shell', `am start -a android.intent.action.VIEW -d ${url}`]);
  }

  /* CanvasXP's set-up folders, under the phone's own storage and any SD card. */
  async findCanvasxp(serial) {
    const cards = (await this.exec(['-s', serial, 'shell', 'ls /storage']).catch(() => '')).split(/\s+/).filter((s) => /^[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}$/.test(s));
    const roots = ['/sdcard', ...cards.map((c) => `/storage/${c}`)];
    const cmd = roots.map((r) => `find ${r}/ -maxdepth 6 -path ${r}/Android -prune -o -type f -path '*/_canvasxp/device.json' -print 2>/dev/null`).join('; ');
    const found = parseFound(await this.exec(['-s', serial, 'shell', cmd], { timeout: 90_000 }));
    for (const f of found) {
      try { const d = JSON.parse(await this.exec(['-s', serial, 'shell', `cat '${f.file.replace(/'/g, '')}'`])); f.id = d.id || null; f.name = d.name || null; f.createdAt = d.createdAt || null; } catch (_) { f.id = null; }
    }
    return found.filter((f) => f.id).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  /* Google's platform-tools, into tools/, only when the user asks. */
  download() {
    if (this.downloading) return this.downloading;
    this.downloading = (async () => {
      fs.mkdirSync(TOOLS_DIR, { recursive: true });
      const zip = path.join(TOOLS_DIR, 'platform-tools.zip');
      const r = await this.fetchImpl(PLATFORM_TOOLS_URL, { signal: AbortSignal.timeout(5 * 60_000) });
      if (!r.ok) throw new SetupError(502, `Google answered ${r.status} for the Android platform tools.`);
      fs.writeFileSync(zip, Buffer.from(await r.arrayBuffer()));
      const [cmd, args] = process.platform === 'linux' ? ['unzip', ['-o', '-q', zip, '-d', TOOLS_DIR]] : ['tar', ['-xf', zip, '-C', TOOLS_DIR]];
      await new Promise((resolve, reject) => this.run(cmd, args, { windowsHide: true }, (err) => (err ? reject(new SetupError(500, `Could not unpack the platform tools: ${err.message}`)) : resolve())));
      fs.rmSync(zip, { force: true });
      const exe = path.join(TOOLS_DIR, 'platform-tools', ADB_EXE);
      if (process.platform !== 'win32') fs.chmodSync(exe, 0o755);
      if (!fs.existsSync(exe)) throw new SetupError(500, 'The platform tools were unpacked but hold no adb.');
      return exe;
    })().finally(() => { this.downloading = null; });
    return this.downloading;
  }
}

/* ------------------------------------------------------------- engines */

/* What the setup may ask each engine, and nothing else (t-e8bb501103). */
export const RELAY = {
  rag: [['GET', /^\/api\/state$/], ['GET', /^\/api\/settings$/], ['PUT', /^\/api\/settings$/], ['GET', /^\/api\/ollama\/models$/], ['POST', /^\/api\/ollama\/pull$/], ['DELETE', /^\/api\/ollama\/pull$/]],
  notex: [['GET', /^\/api\/state$/], ['GET', /^\/api\/phone$/], ['POST', /^\/api\/phone\/sync$/], ['GET', /^\/api\/fabrics$/]],
};
export const relayAllowed = (id, method, p) => Boolean(RELAY[id] && RELAY[id].some(([m, re]) => m === method && re.test(p)));

export class FirstRun {
  constructor({ config, plugs, engines, adb = new Adb(), pick = pickFolder, xpPort = null, log = () => {}, root = ROOT, check = checkDeps, jobs = null, terminal = openTerminal }) {
    Object.assign(this, { config, plugs, engines, adb, pick, log, root, check, terminal });
    this.jobs = jobs || new Jobs({ log });
    this.xpPort = xpPort ?? config.ports.phone;
    this.picking = null;
    this.applying = null;
  }

  setupState() { return this.config.setup || {}; }

  mark(patch) {
    this.config.setup = { ...this.setupState(), ...patch };
    saveConfigFile(this.config.file, { setup: this.config.setup });
  }

  async call(id, method, p, body) {
    const e = this.engines[id];
    const rt = e && e.runtime();
    if (!rt) throw new SetupError(503, `The ${e ? e.spec.label : id} engine is not running yet.`, 'engine-down');
    let r;
    try {
      r = await fetch(rt.url + p, {
        method, signal: AbortSignal.timeout(120_000),
        headers: { [e.spec.tokenHeader]: rt.token, ...(id === 'rag' ? { 'x-rag-client': 'plugin' } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (err) { throw new SetupError(503, `The ${e.spec.label} engine did not answer: ${err.message}`, 'engine-down'); }
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new SetupError(r.status, (d.error && d.error.message) || `The ${e.spec.label} engine answered ${r.status}.`, (d.error && d.error.code) || 'engine');
    return d;
  }

  relay(id, method, p, body) {
    if (!relayAllowed(id, method, p)) throw new SetupError(403, `The setup does not ask ${id} for ${method} ${p}.`);
    return this.call(id, method, p, body);
  }

  async running(ids = Object.keys(this.engines), timeoutMs = 120_000) {
    const until = Date.now() + timeoutMs;
    for (;;) {
      const bad = ids.map((id) => this.engines[id]).find((e) => e.state === 'failed');
      if (bad) throw new SetupError(503, `The ${bad.spec.label} engine stopped: ${bad.detail || 'see its log'}.`, 'engine-down');
      if (ids.every((id) => this.engines[id].state === 'running')) return;
      if (Date.now() > until) throw new SetupError(504, 'The engines did not start in time - click their names in the top bar for their logs.', 'engine-down');
      await wait(300);
    }
  }

  /* Whether this is a first run: no canvas folder in NoteX, or a setup
   * begun and not finished. On a first run the engines wait for the
   * setup's Start (t-80c9a58283): held, and the answer is known at once. */
  async status() {
    const s = this.setupState();
    const held = Object.values(this.engines).length > 0 && Object.values(this.engines).every((e) => e.state === 'stopped');
    let workspace;
    if (held) workspace = null;
    else { try { workspace = (await this.call('notex', 'GET', '/api/state')).workspace || null; } catch (_) { workspace = undefined; } }
    return {
      needed: workspace === null || Boolean(s.started && !s.done) || (held && !s.done), known: workspace !== undefined, held,
      workspace: workspace ?? null, dataDir: this.config.dataDir, defaultDataDir: DEFAULTS.dataDir, home: os.homedir(),
      setup: s, xpPort: this.xpPort, engines: Object.values(this.engines).map((e) => e.snapshot()),
      platforms: Object.values(PLATFORMS).map(({ id, label, link }) => ({ id, label, link })),
    };
  }

  /* ---------------------------------------------- dependencies, agent */

  async deps() {
    const list = await this.check({ root: this.root, plugs: this.plugs });
    return { deps: list, jobs: this.jobs.all(), agent: this.setupState().agent || null };
  }

  /* Install one dependency the studio owns; the page polls deps() for it. */
  async install(id) {
    const plan = installSteps(id, { root: this.root, plugs: this.plugs });
    if (!plan) throw new SetupError(400, `${id} is not something the setup installs - its page has the link.`);
    if (['projects', 'packages', 'pages'].includes(id) && Object.values(this.engines).some((e) => ['running', 'starting'].includes(e.state))) {
      throw new SetupError(409, 'Stop NoteX and RAGX first - their files are in use while they run.');
    }
    this.log(`Setup: installing ${id}`);
    return { job: this.jobs.start(id, plan.steps, { detach: plan.detach }) };
  }

  /* The agent platform the user chose: NoteX's default model is written
   * into its config.json now, RAGX's agent set once it runs (t-621a165092). */
  async chooseAgent(platform) {
    const p = PLATFORMS[platform];
    if (!p) throw new SetupError(400, `platform is ${Object.keys(PLATFORMS).join(' or ')}.`);
    this.mark({ agent: p.id });
    this.prepareNotex();
    let ragx = 'later';
    if (this.engines.rag && this.engines.rag.state === 'running') {
      try { await this.call('rag', 'PUT', '/api/settings', { agent: p.ragxAgent }); ragx = 'set'; } catch (e) { ragx = e.message; }
    }
    return { agent: p.id, notexModel: p.notexModel, ragx };
  }

  /* NoteX's config.json in the data folder, before NoteX starts there. */
  prepareNotex() {
    const p = PLATFORMS[this.setupState().agent];
    return writeNotexConfig(path.join(this.config.dataDir, 'plugins', 'notex', 'config.json'), {
      model: p ? p.notexModel : null,
      origins: (this.config.canvasxOrigins || []).length ? [...NOTEX_CANVASX_ORIGINS, ...canvasxOrigins(this.config)] : null,
    });
  }

  /* A terminal window running the platform's CLI, where the user signs in. */
  async signIn(platform) {
    const p = PLATFORMS[platform || this.setupState().agent];
    if (!p) throw new SetupError(400, 'Choose Claude Code or Google Antigravity first.');
    let cmd = p.signin;
    if (p.id === 'gemini') { const at = await findAgy(); if (!at) throw new SetupError(404, `${p.label} is not installed - get it from ${p.link}.`); cmd = at === 'agy' ? 'agy' : `"${at}"`; }
    return this.terminal({ cwd: os.homedir(), cmd, title: `Sign in to ${p.label}` });
  }

  /* Start NoteX and RAGX, the CanvasX pages and the agent's model told
   * them first, and RAGX's agent set once it answers. */
  async startEngines() {
    const p = PLATFORMS[this.setupState().agent];
    this.prepareNotex();
    for (const id of ['rag', 'notex']) if (this.engines[id] && ['stopped', 'failed'].includes(this.engines[id].state)) this.engines[id].start();
    await this.running();
    if (p) await this.call('rag', 'PUT', '/api/settings', { agent: p.ragxAgent }).catch((e) => this.log(`Setup: RAGX's agent not set: ${e.message}`));
    return { engines: Object.values(this.engines).map((e) => e.snapshot()) };
  }

  async pickFolder(opts) {
    if (this.picking) throw new SetupError(409, 'A folder dialog is already open on this PC - it may be behind this window.');
    this.picking = this.pick(opts).finally(() => { this.picking = null; });
    return { path: await this.picking };
  }

  /* The canvas folder for NoteX (and RAGX's images), and the data folder
   * for both engines - moving them there when it is new. */
  async applyFolders({ canvas, data }) {
    if (this.applying) throw new SetupError(409, 'The folders are being set up already.');
    const full = (p, what) => {
      const s = String(p || '').trim().replace(/^"(.*)"$/, '$1');
      if (!s || !path.isAbsolute(s)) throw new SetupError(400, `Give the ${what} as a full path, like ${path.join(os.homedir(), 'Canvases')}.`);
      return path.resolve(s);
    };
    const ws = full(canvas, 'canvas folder');
    const dd = full(data || this.config.dataDir, 'folder for RAGX and NoteX');
    const inside = (a, b) => { const r = path.relative(b, a); return !r.startsWith('..') && !path.isAbsolute(r); };
    if (inside(dd, ws) || inside(ws, dd)) throw new SetupError(400, 'Keep the canvas folder and the RAGX and NoteX folder apart - neither inside the other.');
    this.applying = (async () => {
      for (const d of [ws, dd]) {
        try { fs.mkdirSync(d, { recursive: true }); } catch (e) { throw new SetupError(400, `Could not make ${d}: ${e.message}`); }
      }
      this.mark({ started: new Date().toISOString(), done: null });
      if (dd !== this.config.dataDir) {
        this.log(`Setup: RAGX and NoteX move to ${dd}`);
        this.config.dataDir = dd;
        saveConfigFile(this.config.file, { dataDir: dd });
        const specs = engineSpecs(this.config, this.plugs);
        await Promise.all(Object.values(this.engines).map((e) => e.stop()));
        this.prepareNotex();
        for (const [id, e] of Object.entries(this.engines)) { e.spec = specs[id]; e.start(); }
      } else if (Object.values(this.engines).some((e) => e.state === 'stopped')) {
        // Held for a first run and not started yet: start them now.
        this.prepareNotex();
        for (const e of Object.values(this.engines)) if (e.state === 'stopped') e.start();
      }
      await this.running();
      const r = await fetch(`${this.engines.notex.runtime().url}/api/workspace`, {
        method: 'PUT', headers: { [this.engines.notex.spec.tokenHeader]: this.engines.notex.runtime().token, 'content-type': 'application/json' }, body: JSON.stringify({ path: ws }),
      });
      const wsr = await r.json().catch(() => ({}));
      if (!r.ok) throw new SetupError(r.status, (wsr.error && wsr.error.message) || `NoteX refused the folder (${r.status}).`);
      // RAGX shows the images of cited places only from folders it is given.
      const s = await this.call('rag', 'GET', '/api/settings');
      const folders = [...new Set([...(s.imageFolders || []), ws])];
      await this.call('rag', 'PUT', '/api/settings', { imageFolders: folders });
      return { workspace: ws, dataDir: dd, fabrics: wsr.fabrics || 0 };
    })().finally(() => { this.applying = null; });
    return this.applying;
  }

  finish({ phone = null } = {}) {
    this.mark({ done: new Date().toISOString(), phone });
    return this.setupState();
  }

  /* ----------------------------------------------------------- phone */

  async xpServed() {
    try {
      const r = await fetch(`http://127.0.0.1:${this.xpPort}/manifest.json`, { signal: AbortSignal.timeout(3000) });
      const m = await r.json();
      return /canvasxp/i.test(`${m.name} ${m.short_name}`);
    } catch (_) { return false; }
  }

  async phoneStatus() {
    const adb = this.adb.path();
    let devices = [];
    let error = null;
    if (adb) { try { devices = await this.adb.devices(); } catch (e) { error = e.message; } }
    return { adb, devices, error, xp: await this.xpServed(), xpPort: this.xpPort, download: { url: PLATFORM_TOOLS_URL, terms: PLATFORM_TOOLS_TERMS, running: Boolean(this.adb.downloading) } };
  }

  async downloadAdb() { return { adb: await this.adb.download() }; }

  async device(serial) {
    const d = (await this.adb.devices()).find((x) => x.serial === serial);
    if (!d) throw new SetupError(404, 'That phone is not connected any more - check the cable.', 'no-phone');
    if (d.state === 'unauthorized') throw new SetupError(409, 'Tap Allow on the phone to let this PC use USB debugging, then try again.', 'unauthorized');
    if (d.state !== 'device') throw new SetupError(409, `The phone is ${d.state} - unplug it and plug it in again.`, 'offline');
    return d;
  }

  /* localhost:8080 on the phone reaches CanvasXP here, and the phone's
   * browser opens it. */
  async openOnPhone(serial) {
    await this.device(serial);
    if (!(await this.xpServed())) throw new SetupError(503, `CanvasXP is not being served on port ${this.xpPort} - something else holds that port. Close it and restart the studio.`, 'no-xp');
    await this.adb.reverse(serial, this.xpPort);
    const url = `http://localhost:${this.xpPort}/`;
    await this.adb.openUrl(serial, url).catch((e) => this.log(`Could not open CanvasXP on the phone: ${e.message}`));
    return { url };
  }

  async findOnPhone(serial) {
    await this.device(serial);
    return { folders: await this.adb.findCanvasxp(serial) };
  }

  /* NoteX's phone sync, linked to CanvasXP's folder: the phone as File
   * transfer shows it, then the folder under each of its storages until
   * NoteX finds CanvasXP's device.json there. */
  async linkPhone(serial) {
    const dev = await this.device(serial);
    const folders = await this.adb.findCanvasxp(serial);
    if (!folders.length) throw new SetupError(404, 'CanvasXP has not set up a folder on the phone yet - in CanvasXP, open a target folder and press Set up USB sync.', 'no-folder');
    const want = folders[0];
    const { devices = [] } = await this.call('notex', 'GET', '/api/phone/devices').catch(() => ({ devices: [] }));
    const names = devices.map((d) => d.name);
    const mtp = names.find((n) => n === dev.name) || names.find((n) => dev.model && n.includes(dev.model)) || (names.length === 1 ? names[0] : null);
    if (!mtp) {
      throw new SetupError(409, names.length ? `Windows shows ${names.join(', ')}, none of them ${dev.name}. Unplug the other phones and try again.`
        : 'Windows does not see the phone as a drive. On the phone, tap the USB notification and choose File transfer, then try again.', 'no-mtp');
    }
    const root = await this.call('notex', 'GET', `/api/phone/browse?device=${encodeURIComponent(mtp)}&path=${encodeURIComponent('[]')}`);
    const storages = (root.folders || []).slice();
    // The SD card's folders are tried under a storage named like one first.
    if (want.root.startsWith('/storage/') && !want.root.endsWith('/0')) storages.sort((a, b) => Number(/sd/i.test(b)) - Number(/sd/i.test(a)));
    else storages.sort((a, b) => Number(/sd/i.test(a)) - Number(/sd/i.test(b)));
    let lastErr = null;
    for (const s of storages) {
      try {
        const r = await this.call('notex', 'PUT', '/api/phone', { device: mtp, path: [s, ...want.segs] });
        return { phone: r.phone, folder: want.folder, storage: s };
      } catch (e) { lastErr = e; }
    }
    throw new SetupError(409, `NoteX could not reach ${want.folder} on ${mtp}${lastErr ? `: ${lastErr.message}` : ''}`, 'no-link');
  }
}

