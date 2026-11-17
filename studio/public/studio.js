/* The studio page: NoteX's and RAGX's pages side by side as tabs, and the
 * host API they ask through, answered the way ter-manager answers it
 * (t-33bd14605d). A page's identity is the frame its message came from,
 * never anything the message says about itself.
 */
import { initSetup } from './setup.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

const TOKEN = document.querySelector('meta[name="studio-token"]').content;
const BOOT = JSON.parse(document.querySelector('meta[name="studio-boot"]').content);
/* Inside CanvasX's tab (t-c614bd5011): CanvasX's switcher picks the view,
 * and only CanvasX's own pages are listened to or told anything. */
const EMBED = new URLSearchParams(location.search).get('embed') === '1' && window.parent !== window;
const PARENTS = Array.isArray(BOOT.parents) ? BOOT.parents : [];
function toParent(msg) {
  if (!EMBED) return;
  for (const o of PARENTS) { try { window.parent.postMessage({ notexStudio: 1, ...msg }, o); } catch (_) { /* not that origin */ } }
}
const STORE_PREFIX = 'notexstudio.plugin.';
const VALUE_MAX = 256 * 1024;

function toast(text, bad = false) {
  const t = $('toast');
  t.textContent = text;
  t.classList.toggle('bad', bad);
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, bad ? 7000 : 3500);
}

async function hostApi(method, path, body) {
  const r = await fetch(`/api/host/${path}`, {
    method,
    headers: { 'x-studio-token': TOKEN, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((d.error && d.error.message) || `The studio answered ${r.status}.`);
  return d;
}

/* ------------------------------------------------------------- theme */

/* ter-manager's palette variables, with values of the studio's own; the
 * pages build every colour from these. */
const PALETTES = {
  // AutomatU's whites and near-black (t-8fc8ecee06); clay is the one warm colour.
  light: { '--pal-bg': '#FAFAFA', '--pal-raise': '#FFFFFF', '--pal-fg': '#1F1E1D', '--pal-accent': '#1F1E1D', '--on-accent': '#FFFFFF', '--pal-red': '#B42318', '--pal-green': '#3E7A57', '--pal-yellow': '#C6613F' },
  dark: { '--pal-bg': '#161616', '--pal-raise': '#1C1C1C', '--pal-fg': '#EDEDEB', '--pal-accent': '#EDEDEB', '--on-accent': '#161616', '--pal-red': '#FF7A6E', '--pal-green': '#5BA67A', '--pal-yellow': '#D9805F' },
};
const dark = window.matchMedia('(prefers-color-scheme: dark)');
// Inside CanvasX, CanvasX's own light or dark mode, not the system's.
const themeWord = (v) => (v === 'light' || v === 'dark' ? v : null);
let forcedMode = EMBED ? themeWord(new URLSearchParams(location.search).get('theme')) : null;

function theme() {
  const mode = forcedMode || (dark.matches ? 'dark' : 'light');
  return { vars: { ...PALETTES[mode], '--mono': '"Geist Mono", ui-monospace, "Cascadia Mono", Consolas, monospace' }, attrs: { 'data-theme': mode === 'dark' ? 'dark' : null, 'data-scene': null, 'data-surface': null, 'data-host': 'canvasx-studio' } };
}

function applyTheme() {
  const t = theme();
  const root = document.documentElement;
  for (const [k, v] of Object.entries(t.vars)) root.style.setProperty(k, v);
  if (t.attrs['data-theme']) root.setAttribute('data-theme', t.attrs['data-theme']); else root.removeAttribute('data-theme');
  for (const f of frames.values()) {
    try { f.contentWindow.postMessage({ __tm: 1, event: 'theme', theme: t }, location.origin); } catch (_) { /* loading; it asks on load */ }
  }
}

/* ------------------------------------------------------- the host API */

const frames = new Map(); // plugin id -> iframe

function pluginOf(source) {
  for (const [id, f] of frames) if (f.contentWindow === source) return id;
  return null;
}

function storageKey(pid, key) {
  const k = String(key);
  if (!/^[A-Za-z0-9_.:-]{1,80}$/.test(k)) throw new Error('bad storage key');
  return `${STORE_PREFIX}${pid}.${k}`;
}

async function answer(pid, method, params) {
  switch (method) {
    case 'host.info': return { hostApi: '1', pluginId: pid, hosted: true, theme: theme(), host: 'CanvasX Studio' };
    case 'terminal.open': {
      const r = await hostApi('POST', 'terminal', { plugin: pid, cwd: params.cwd || '', cmd: params.cmd || '', title: params.title || '' });
      if (r.engine) { toast(`Restarting the ${labelOf(pid)} engine…`); setTimeout(pollEngines, 300); }
      return { opened: true };
    }
    case 'storage.get': {
      try { const raw = localStorage.getItem(storageKey(pid, params.key)); return raw == null ? null : JSON.parse(raw); } catch (_) { return null; }
    }
    case 'storage.set': {
      const k = storageKey(pid, params.key);
      const raw = JSON.stringify(params.value);
      if (raw === undefined) throw new Error('value is not serialisable');
      if (raw.length > VALUE_MAX) throw new Error(`value is larger than ${VALUE_MAX / 1024}KB`);
      try { localStorage.setItem(k, raw); } catch (_) { throw new Error('storage is full'); }
      return true;
    }
    case 'storage.remove': localStorage.removeItem(storageKey(pid, params.key)); return true;
    case 'theme.get': return theme();
    case 'host.dataDir': return hostApi('GET', `data-dir?id=${encodeURIComponent(pid)}`);
    default: throw new Error(`unknown method ${method}`);
  }
}

window.addEventListener('message', async (e) => {
  if (e.origin !== location.origin) return;
  const m = e.data;
  if (!m || m.__tm !== 1 || typeof m.id !== 'number' || typeof m.method !== 'string') return;
  const pid = pluginOf(e.source);
  if (!pid) return;
  let reply;
  try { reply = { __tm: 1, id: m.id, ok: true, method: m.method, result: await answer(pid, m.method, m.params || {}) }; } catch (err) { reply = { __tm: 1, id: m.id, ok: false, method: m.method, error: err.message || String(err) }; }
  try { e.source.postMessage(reply, location.origin); } catch (_) { /* the frame went away */ }
});

/* ------------------------------------------------------------- tabs */

const labelOf = (id) => (BOOT.plugins.find((p) => p.id === id) || { label: id }).label;
let current = null;

function show(id) {
  current = id;
  try { localStorage.setItem('notexstudio.tab', id); } catch (_) {}
  for (const [pid, f] of frames) f.hidden = pid !== id;
  for (const b of $('tabs').children) { const on = b.dataset.id === id; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); }
  document.title = `${labelOf(id)} · CanvasX Studio`;
}

function build() {
  for (const p of BOOT.plugins) {
    const b = el('button', 'tab');
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.dataset.id = p.id;
    b.title = p.hint;
    b.append(el('span', 'dot'), el('span', null, p.label));
    b.addEventListener('click', () => show(p.id));
    $('tabs').append(b);
    const f = document.createElement('iframe');
    f.src = `/plugins/${p.id}/plugin.html`;
    f.title = p.label;
    f.dataset.plugin = p.id;
    f.hidden = true;
    f.addEventListener('load', applyTheme);
    $('frames').append(f);
    frames.set(p.id, f);
  }
  $('canvasx').href = BOOT.canvasx;
  let first = BOOT.plugins[0].id;
  try { const saved = localStorage.getItem('notexstudio.tab'); if (frames.has(saved)) first = saved; } catch (_) {}
  const asked = new URLSearchParams(location.search).get('view');
  if (frames.has(asked)) first = asked;
  show(first);
}

/* ---------------------------------------------------------- engines */

const STATE_WORDS = { running: 'running', starting: 'starting…', stopping: 'stopping…', stopped: 'stopped', failed: 'stopped with an error' };
let engines = [];
let logsFor = null;

function renderEngines() {
  const box = $('engines');
  box.replaceChildren();
  for (const e of engines) {
    const b = el('button', `engine ${e.state}`);
    b.type = 'button';
    b.title = `${e.label} engine ${STATE_WORDS[e.state] || e.state}${e.detail ? ` - ${e.detail}` : ''}. Click for its log.`;
    b.append(el('span', 'dot'), el('span', null, e.label));
    b.addEventListener('click', () => openLogs(e.id));
    box.append(b);
    const tab = [...$('tabs').children].find((t) => t.dataset.id === e.id);
    if (tab) tab.dataset.state = e.state;
  }
  if (logsFor) renderLogsHead();
}

async function pollEngines() {
  try { engines = (await hostApi('GET', 'status')).engines; renderEngines(); } catch (err) {
    engines = engines.map((e) => ({ ...e, state: 'failed', detail: 'the studio is not answering - is its terminal still open?' }));
    renderEngines();
  }
}

function renderLogsHead() {
  const e = engines.find((x) => x.id === logsFor);
  if (!e) return;
  $('logs-title').textContent = `${e.label} engine`;
  $('logs-state').textContent = STATE_WORDS[e.state] || e.state;
  $('logs-state').className = `state ${e.state}`;
  $('logs-detail').textContent = e.detail || (e.url ? `Listening at ${e.url}` : '');
  $('logs-stop').disabled = !['running', 'starting'].includes(e.state);
  $('logs-restart').textContent = ['stopped', 'failed'].includes(e.state) ? 'Start' : 'Restart';
}

async function loadLogs() {
  if (!logsFor) return;
  try {
    const { lines } = await hostApi('GET', `logs?id=${encodeURIComponent(logsFor)}`);
    const pre = $('logs-lines');
    const atEnd = pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 8;
    pre.textContent = lines.join('\n') || 'Nothing written yet.';
    if (atEnd) pre.scrollTop = pre.scrollHeight;
  } catch (err) { $('logs-lines').textContent = err.message; }
}

function openLogs(id) {
  logsFor = id;
  renderLogsHead();
  $('logs-lines').textContent = '';
  $('logs').showModal();
  loadLogs().then(() => { const pre = $('logs-lines'); pre.scrollTop = pre.scrollHeight; });
  clearInterval(openLogs.timer);
  openLogs.timer = setInterval(loadLogs, 1500);
}

function closeLogs() {
  clearInterval(openLogs.timer);
  logsFor = null;
  if ($('logs').open) $('logs').close();
}

async function engineAction(action) {
  const id = logsFor;
  if (!id) return;
  const e = engines.find((x) => x.id === id);
  const verb = action === 'restart' && e && ['stopped', 'failed'].includes(e.state) ? 'start' : action;
  try { await hostApi('POST', `engines/${encodeURIComponent(id)}/${verb}`); } catch (err) { toast(err.message, true); }
  pollEngines();
  loadLogs();
}

$('logs-close').addEventListener('click', closeLogs);
$('logs').addEventListener('close', () => { clearInterval(openLogs.timer); logsFor = null; });
$('logs-restart').addEventListener('click', () => engineAction('restart'));
$('logs-stop').addEventListener('click', () => engineAction('stop'));

/* -------------------------------------------------------------- go */

applyTheme();
dark.addEventListener('change', applyTheme);
build();
pollEngines();
setInterval(pollEngines, 3000);

/* First run: no canvas folder yet, so the setup screen comes first (t-2b5970444b).
 * When it ends, the pages load again with their folders set. */
const setup = initSetup({
  hostApi, toast, canvasxUrl: BOOT.canvasx, embedded: EMBED,
  onDone: () => { for (const f of frames.values()) f.src = f.src; toParent({ event: 'setup-done' }); },
  toCanvasx: () => toParent({ event: 'show', view: 'canvasx' }),
});

if (EMBED) {
  document.body.classList.add('embed');
  window.addEventListener('message', (e) => {
    if (e.source !== window.parent || !PARENTS.includes(e.origin)) return;
    const m = e.data;
    if (!m || m.notexStudio !== 1) return;
    if (themeWord(m.theme)) { forcedMode = m.theme; applyTheme(); }
    if (m.show === 'setup') setup.open({ force: true });
    else if (frames.has(m.show)) {
      // A setup still needed stays in front; one opened again from Setup gives way.
      if (setup.shown() && !setup.needed()) setup.close();
      show(m.show);
    }
  });
}
setup.open({ force: EMBED && new URLSearchParams(location.search).get('view') === 'setup' });
toParent({ event: 'ready' });
