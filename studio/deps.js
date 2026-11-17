/* What NoteX Studio needs on the PC, for the setup screen (t-80c9a58283):
 * each dependency checked, and what the studio owns installed when the user
 * presses Install.
 *
 *   installed here     the three projects (git submodules), RAGX's packages
 *                      (npm ci), each page's local.json (plugin-setup),
 *                      Ollama started (ollama serve)
 *   checked, linked    Git, Node.js, Ollama itself, Claude Code, Google
 *                      Antigravity - each a program the user installs from
 *                      its own site, and the agents need the user's sign-in
 *
 * The embedding model is not here: the setup's model step pulls it through
 * RAGX, with its progress, once the engines run.
 */
import { spawn, execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { cliOf, pluginDir } from './config.js';

export const LINKS = Object.freeze({
  git: 'https://git-scm.com/downloads',
  node: 'https://nodejs.org/en/download',
  ollama: 'https://ollama.com/download',
  claude: 'https://claude.com/claude-code',
  agy: 'https://antigravity.google',
});

/* The two agent platforms: the program each runs, NoteX's default model for
 * it, and RAGX's agent id (t-621a165092). */
export const PLATFORMS = Object.freeze({
  claude: { id: 'claude', label: 'Claude Code', exe: 'claude', notexModel: 'sonnet', ragxAgent: 'claude', signin: 'claude', link: LINKS.claude },
  gemini: { id: 'gemini', label: 'Google Antigravity', exe: 'agy', notexModel: 'gemini-3.8-flash-medium', ragxAgent: 'agy', signin: 'agy', link: LINKS.agy },
});

const OLLAMA_URL = 'http://127.0.0.1:11434';
const quote = (s) => (/[\s"&|<>^()]/.test(s) ? `"${String(s).replace(/"/g, '""')}"` : s);

/* A program's --version, or null when it is not on this PC. */
export function version(cmd, args = ['--version'], { exec = execFile } = {}) {
  return new Promise((resolve) => {
    // .cmd shims (npm, claude) run only through a shell on Windows.
    const win = process.platform === 'win32' && !path.isAbsolute(cmd);
    const done = (err, out) => resolve(err ? null : String(out || '').trim().split('\n')[0] || 'found');
    if (win) exec([cmd, ...args].map(quote).join(' '), { shell: true, windowsHide: true, timeout: 15_000, encoding: 'utf8' }, done);
    else exec(cmd, args, { windowsHide: true, timeout: 15_000, encoding: 'utf8' }, done);
  });
}

/* agy is on PATH, or where Antigravity's installer puts it. */
export async function findAgy({ env = process.env, check = version } = {}) {
  if (await check('agy')) return 'agy';
  const local = env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, 'agy', 'bin', process.platform === 'win32' ? 'agy.exe' : 'agy') : null;
  return local && fs.existsSync(local) ? local : null;
}

async function ollamaUp(fetcher = fetch) {
  try { const r = await fetcher(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(2500) }); return r.ok; } catch (_) { return false; }
}

/* Each page's local.json names the repository it belongs to. */
function pageKnowsEngine(p) {
  try { return path.resolve(JSON.parse(fs.readFileSync(path.join(pluginDir(p), 'local.json'), 'utf8')).repo) === path.resolve(p.repo); } catch (_) { return false; }
}

/* ------------------------------------------------------------ the jobs */

const MAX_LINES = 200;

/* One install at a time per dependency: a child process, its output kept. */
export class Jobs {
  constructor({ run = spawn, log = () => {} } = {}) { this.run = run; this.log = log; this.jobs = new Map(); }

  get(id) { const j = this.jobs.get(id); return j ? { id, state: j.state, lines: j.lines.slice(-12), error: j.error, startedAt: j.startedAt } : null; }
  all() { return Object.fromEntries([...this.jobs.keys()].map((id) => [id, this.get(id)])); }
  busy(id) { const j = this.jobs.get(id); return Boolean(j && j.state === 'running'); }

  /* steps: [[cmd, args, cwd], ...] run one after another; detach: started and left running. */
  start(id, steps, { detach = false } = {}) {
    if (this.busy(id)) return this.get(id);
    const job = { state: 'running', lines: [], error: null, startedAt: new Date().toISOString() };
    this.jobs.set(id, job);
    const say = (chunk) => {
      for (const l of String(chunk).split(/\r?\n|\r/)) if (l.trim()) job.lines.push(l.trimEnd());
      if (job.lines.length > MAX_LINES) job.lines.splice(0, job.lines.length - MAX_LINES);
    };
    const one = ([cmd, args, cwd]) => new Promise((resolve, reject) => {
      say(`> ${[cmd, ...args].join(' ')}`);
      const win = process.platform === 'win32' && !path.isAbsolute(cmd);
      const opts = { cwd, windowsHide: true, ...(detach ? { detached: true, stdio: 'ignore' } : {}) };
      let child;
      try { child = win ? this.run([cmd, ...args].map(quote).join(' '), { ...opts, shell: true }) : this.run(cmd, args, opts); } catch (e) { reject(e); return; }
      child.on('error', reject);
      if (detach) { child.unref(); resolve(); return; }
      child.stdout && child.stdout.on('data', say);
      child.stderr && child.stderr.on('data', say);
      child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} ended with code ${code}`))));
    });
    (async () => {
      for (const s of steps) await one(s);
    })().then(() => { job.state = 'done'; }, (e) => { job.state = 'failed'; job.error = e.message; say(e.message); this.log(`setup: ${id} failed: ${e.message}`); });
    return this.get(id);
  }
}

/* ------------------------------------------------------------ the list */

/* Every dependency: { id, label, group, state: ok|missing|optional,
 * detail, install?: true (the studio can), link?: its download page }. */
export async function checkDeps({ root, plugs, nodeVersion = process.version, check = version, fetcher = fetch, agy = findAgy }) {
  const out = [];
  const add = (d) => { out.push(d); return d; };
  const major = Number(String(nodeVersion).replace(/^v/, '').split('.')[0]);
  add({ id: 'node', label: 'Node.js', group: 'pc', state: major >= 24 ? 'ok' : 'missing', detail: major >= 24 ? nodeVersion : `${nodeVersion} - NoteX Studio needs 24 or newer`, link: LINKS.node });
  const git = await check('git');
  add({ id: 'git', label: 'Git', group: 'pc', state: git ? 'ok' : 'missing', detail: git || 'fetches NoteX, RAGX and CanvasX, and their updates', link: LINKS.git });

  const absent = [...Object.values(plugs).map(cliOf), path.join(root, 'canvasx', 'index.html')].filter((f) => !fs.existsSync(f));
  add({ id: 'projects', label: 'NoteX, RAGX and CanvasX', group: 'studio', state: absent.length ? 'missing' : 'ok',
    detail: absent.length ? (fs.existsSync(path.join(root, '.git')) ? 'not fetched yet' : 'not here - clone NoteX Studio with git clone --recursive') : 'here', install: Boolean(absent.length && git && fs.existsSync(path.join(root, '.git'))) });
  const ragx = plugs.rag.repo;
  const pkgs = fs.existsSync(path.join(ragx, 'node_modules', 'pdfjs-dist'));
  add({ id: 'packages', label: "RAGX's packages", group: 'studio', state: pkgs ? 'ok' : 'missing', detail: pkgs ? 'installed' : 'the PDF reader and the canvas it draws figures on', install: !pkgs && fs.existsSync(path.join(ragx, 'package.json')) });
  const pages = Object.values(plugs).filter((p) => !pageKnowsEngine(p));
  add({ id: 'pages', label: 'NoteX and RAGX pages', group: 'studio', state: pages.length ? 'missing' : 'ok', detail: pages.length ? `${pages.map((p) => p.label).join(' and ')} not told where ${pages.length === 1 ? 'its engine is' : 'their engines are'}` : 'each knows its engine', install: pages.length > 0 && pages.every((p) => fs.existsSync(cliOf(p))) });

  const ollama = await check('ollama');
  const up = ollama ? await ollamaUp(fetcher) : false;
  add({ id: 'ollama', label: 'Ollama', group: 'pc', state: !ollama ? 'missing' : up ? 'ok' : 'missing', detail: !ollama ? 'RAGX embeds your documents with it - without it, search is by keyword only' : up ? `${ollama}, running` : `${ollama}, not running`, link: ollama ? undefined : LINKS.ollama, install: Boolean(ollama && !up), optional: true });

  const claude = await check('claude');
  const agyAt = await agy({ check });
  add({ id: 'claude', label: 'Claude Code', group: 'agent', state: claude ? 'ok' : 'missing', detail: claude || 'not installed', link: LINKS.claude });
  add({ id: 'agy', label: 'Google Antigravity', group: 'agent', state: agyAt ? 'ok' : 'missing', detail: agyAt ? (agyAt === 'agy' ? 'agy on PATH' : agyAt) : 'not installed', link: LINKS.agy, path: agyAt });
  return out;
}

/* The commands an Install press runs, for the dependencies the studio owns. */
export function installSteps(id, { root, plugs }) {
  const node = process.execPath;
  switch (id) {
    case 'projects': return { steps: [['git', ['submodule', 'update', '--init', '--recursive'], root]] };
    case 'packages': {
      const ragx = plugs.rag.repo;
      return { steps: [['npm', [fs.existsSync(path.join(ragx, 'package-lock.json')) ? 'ci' : 'install', '--no-audit', '--no-fund'], ragx]] };
    }
    case 'pages': return { steps: Object.values(plugs).map((p) => [node, [cliOf(p), 'plugin-setup'], p.repo]) };
    case 'ollama': return { steps: [['ollama', ['serve'], root]], detach: true };
    default: return null;
  }
}

/* NoteX reads its default model and the CanvasX pages its link takes from
 * its config.json, which is written before it starts (t-621a165092,
 * t-08d48066f9); whatever else the file holds is kept. */
export function writeNotexConfig(file, { model, origins } = {}) {
  let c = {};
  try { c = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { /* a first start */ }
  if (model) c.arranger = { ...(c.arranger || {}), model };
  if (origins && origins.length) c.canvasxOrigins = [...new Set([...(Array.isArray(c.canvasxOrigins) ? c.canvasxOrigins : []), ...origins])];
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(c, null, 2));
  return c;
}
