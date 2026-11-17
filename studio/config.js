/* What NoteX Studio runs and where it keeps things (t-33bd14605d).
 *
 *   studio.config.json   beside this repository's package.json, optional,
 *                        git-ignored: { dataDir, ports: { studio, ragx,
 *                        notex, canvasx, phone }, open, setup }
 *                        - setup is the first-run setup's progress
 *                        (t-2b5970444b), written by the studio itself
 *
 * The data folder holds plugins/<id> for each engine, the layout
 * ter-manager gives its plugins, so RAGX finds NoteX's documents at
 * <data>/plugins/notex/docs with no setting (t-f16266d576).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CONFIG_FILE = path.join(ROOT, 'studio.config.json');

export const DEFAULTS = Object.freeze({
  dataDir: path.join(os.homedir(), 'NoteX Studio'),
  // RAGX and NoteX keep the ports they have in ter-manager; CanvasX keeps the
  // one NoteX's CanvasX link accepts (t-b2251cde5d).
  // phone: CanvasXP, reached from the phone as localhost:8080 through adb (t-d4739a5f8f).
  ports: Object.freeze({ studio: 7075, ragx: 7780, notex: 7781, canvasx: 9075, phone: 8080 }),
  open: true,
});

/* The two pages the studio hosts, by the ids their plugin.json give. */
export function plugins(root = ROOT) {
  return {
    notex: { id: 'notex', label: 'NoteX', hint: 'Canvases, inbox, agents, phone', repo: path.join(root, 'notex'), token: 'x-notex-token' },
    rag: { id: 'rag', label: 'RAGX', hint: 'Ask your files', repo: path.join(root, 'ragx'), token: 'x-rag-token' },
  };
}

export const pluginDir = (p) => path.join(p.repo, 'plugin');
export const cliOf = (p) => path.join(p.repo, 'engine', 'cli.js');

function readConfigFile(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {
    if (e.code === 'ENOENT') return {};
    throw new Error(`${file} is not valid JSON: ${e.message}`);
  }
}

function port(v, name) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1024 || n > 65535) throw new Error(`The ${name} port must be a whole number from 1024 to 65535, not ${JSON.stringify(v)}.`);
  return n;
}

/* An origin a CanvasX page may be served from: http(s)://host[:port], no path. */
export function origin(v) {
  let u;
  try { u = new URL(String(v)); } catch (_) { throw new Error(`${JSON.stringify(v)} is not an address like http://localhost:9075.`); }
  if (!/^https?:$/.test(u.protocol) || u.username || u.password) throw new Error(`${v} is not an http or https address.`);
  return u.origin;
}

/* The file, then what the command line says. */
export function loadConfig({ file = CONFIG_FILE, overrides = {} } = {}) {
  const fromFile = readConfigFile(file);
  const ports = { ...DEFAULTS.ports, ...(fromFile.ports || {}), ...(overrides.ports || {}) };
  for (const k of Object.keys(DEFAULTS.ports)) ports[k] = port(ports[k], k);
  const taken = new Map();
  for (const [k, v] of Object.entries(ports)) {
    if (taken.has(v)) throw new Error(`The ${taken.get(v)} and ${k} ports are both ${v}; give each its own.`);
    taken.set(v, k);
  }
  const dataDir = path.resolve(overrides.dataDir || fromFile.dataDir || DEFAULTS.dataDir);
  const open = overrides.open ?? fromFile.open ?? DEFAULTS.open;
  const setup = fromFile.setup && typeof fromFile.setup === 'object' ? fromFile.setup : {};
  // Other addresses CanvasX is served from, beside the studio's own (t-08d48066f9).
  const extra = [...(Array.isArray(fromFile.canvasxOrigins) ? fromFile.canvasxOrigins : []), ...(overrides.canvasxOrigins || [])].map(origin);
  return { dataDir, ports, open: Boolean(open), file, setup, canvasxOrigins: [...new Set(extra)] };
}

/* Some settings written into the file, keeping whatever else it holds. */
export function saveConfigFile(file, patch) {
  const now = readConfigFile(file);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ ...now, ...patch }, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

/* Where a plugin keeps what it must not lose, as ter-manager's host.dataDir answers. */
export function dataDirOf(config, id) {
  return { dir: path.join(config.dataDir, 'plugins', id), saveDir: config.dataDir };
}

/* The studio page's own origins: the only pages the engines take requests from. */
export const studioOrigins = (config) => [`http://127.0.0.1:${config.ports.studio}`, `http://localhost:${config.ports.studio}`];

/* NoteX's own CanvasX addresses, which its CanvasX link accepts with no setting. */
export const NOTEX_CANVASX_ORIGINS = Object.freeze(['http://localhost:9075', 'http://127.0.0.1:9075']);

/* The CanvasX pages that may find the studio and show its page in theirs
 * (t-c614bd5011): the CanvasX the studio serves, and any other address the
 * user started it for. */
export const canvasxOrigins = (config) => [...new Set([
  `http://127.0.0.1:${config.ports.canvasx}`, `http://localhost:${config.ports.canvasx}`, ...(config.canvasxOrigins || []),
])];

export const VERSION = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version; } catch (_) { return '0'; } })();
