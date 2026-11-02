/* The engines the studio runs: RAGX's and NoteX's, each its own Node process,
 * started by the launcher rather than typed into a terminal (t-f16266d576).
 *
 * Running means answering: an engine writes plugin/runtime.json - its url, a
 * fresh token and its pid - each time it starts, and the studio calls it
 * running only once /api/state answers with that token from the process it
 * started. A runtime.json left by a hard kill names another pid and is not
 * believed. Stopping asks the engine to shut down (POST /api/shutdown) so it
 * removes its runtime.json and ends its agents itself; only an engine that
 * does not go in time is killed.
 */
import { spawn, spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { cliOf, pluginDir, dataDirOf, studioOrigins } from './config.js';

const MAX_LINES = 600;

/* How each engine is started, from its own CLI's usage. */
export function engineSpecs(config, plugs) {
  const origin = studioOrigins(config).join(',');
  const spec = (p, args) => ({
    id: p.id, label: p.label, cwd: p.repo, args, port: config.ports[p.id === 'rag' ? 'ragx' : 'notex'],
    runtimeFile: path.join(pluginDir(p), 'runtime.json'), tokenHeader: p.token, dataDir: dataDirOf(config, p.id).dir,
  });
  return {
    rag: spec(plugs.rag, [cliOf(plugs.rag), '--data-dir', dataDirOf(config, 'rag').dir, 'serve', '--port', String(config.ports.ragx), '--origin', origin]),
    // NoteX reads images and hands drops to RAGX through RAGX's runtime.json in its plugin folder.
    notex: spec(plugs.notex, [cliOf(plugs.notex), 'serve', '--data-dir', dataDirOf(config, 'notex').dir, '--port', String(config.ports.notex), '--origin', origin, '--ragx', pluginDir(plugs.rag)]),
  };
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function killTree(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  else child.kill('SIGKILL');
}

export class ManagedEngine extends EventEmitter {
  constructor(spec, { node = process.execPath, log = () => {}, startTimeoutMs = 90_000, pollMs = 400 } = {}) {
    super();
    this.spec = spec;
    this.node = node;
    this.log = log;
    this.startTimeoutMs = startTimeoutMs;
    this.pollMs = pollMs;
    this.child = null;
    this.state = 'stopped';
    this.detail = '';
    this.startedAt = null;
    this.url = null;
    this.lines = [];
    this.exited = null;
  }

  set(state, detail = '') {
    this.state = state;
    this.detail = detail;
    this.emit('state', this.snapshot());
  }

  snapshot() {
    const { id, label, port } = this.spec;
    return { id, label, port, state: this.state, detail: this.detail, pid: this.child ? this.child.pid : null, url: this.url, startedAt: this.startedAt };
  }

  logs() { return this.lines.slice(); }

  note(text) {
    for (const line of String(text).split(/\r?\n/)) {
      if (!line.trim()) continue;
      this.lines.push(line);
      this.log(`[${this.spec.label}] ${line}`);
    }
    if (this.lines.length > MAX_LINES) this.lines.splice(0, this.lines.length - MAX_LINES);
  }

  /* Its own runtime.json, or null: one naming another pid is a leftover. */
  runtime() {
    const rt = readJson(this.spec.runtimeFile);
    return rt && this.child && rt.pid === this.child.pid && rt.url && rt.token ? rt : null;
  }

  async answers(rt, timeoutMs = 3000) {
    try {
      const r = await fetch(`${rt.url}/api/state`, { headers: { [this.spec.tokenHeader]: rt.token }, signal: AbortSignal.timeout(timeoutMs) });
      return r.ok;
    } catch (_) { return false; }
  }

  start() {
    if (this.child) return this.snapshot();
    fs.mkdirSync(this.spec.dataDir, { recursive: true });
    this.url = null;
    this.startedAt = new Date().toISOString();
    this.note(`starting: node ${this.spec.args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ')}`);
    let child;
    try {
      child = spawn(this.node, this.spec.args, { cwd: this.spec.cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    } catch (e) {
      this.set('failed', `could not start: ${e.message}`);
      return this.snapshot();
    }
    this.child = child;
    this.set('starting');
    let lastErr = '';
    child.stdout.on('data', (d) => this.note(d));
    child.stderr.on('data', (d) => { this.note(d); const s = String(d).trim().split(/\r?\n/).pop(); if (s) lastErr = s; });
    this.exited = new Promise((resolve) => {
      child.on('error', (e) => { this.note(`could not start: ${e.message}`); });
      child.on('exit', (code, signal) => {
        if (this.child === child) this.child = null;
        this.url = null;
        const how = signal ? `stopped by ${signal}` : `exited with code ${code}`;
        if (this.state === 'stopping' || code === 0) this.set('stopped');
        else this.set('failed', lastErr ? `${how}: ${lastErr}` : how);
        this.note(how);
        resolve();
      });
    });
    this.watchStart(child);
    return this.snapshot();
  }

  async watchStart(child) {
    const until = Date.now() + this.startTimeoutMs;
    while (this.child === child && this.state === 'starting') {
      const rt = this.runtime();
      if (rt && (await this.answers(rt))) {
        if (this.child === child && this.state === 'starting') { this.url = rt.url; this.set('running'); }
        return;
      }
      if (Date.now() > until) { this.detail = 'started, but not answering yet'; this.emit('state', this.snapshot()); }
      await wait(this.pollMs);
    }
  }

  async stop({ timeoutMs = 8000 } = {}) {
    const child = this.child;
    if (!child) return this.snapshot();
    this.set('stopping');
    const rt = this.runtime();
    if (rt) {
      try { await fetch(`${rt.url}/api/shutdown`, { method: 'POST', headers: { [this.spec.tokenHeader]: rt.token }, signal: AbortSignal.timeout(3000) }); } catch (_) { /* killed below */ }
    } else killTree(child); // not answering yet: nothing to ask
    const gone = await Promise.race([this.exited.then(() => true), wait(timeoutMs).then(() => false)]);
    if (!gone) { this.note(`did not stop within ${Math.round(timeoutMs / 1000)} s; ended`); killTree(child); await this.exited; }
    return this.snapshot();
  }

  async restart() {
    await this.stop();
    return this.start();
  }
}
