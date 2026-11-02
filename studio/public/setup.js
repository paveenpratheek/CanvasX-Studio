/* The first-run setup screen (t-2b5970444b), in the user's order:
 *   the folder for canvases and the folder for RAGX's and NoteX's files,
 *   the embedding model downloading, setting up, finished;
 *   then the phone, if there is one: connect it by USB and press OK,
 *   CanvasXP set up on it, open localhost:8080 and pick a target folder,
 *   the phone linked and synced;
 *   NoteX checking the first files, and Ready, Steady... Note.
 * Everything that touches the PC or the engines is the studio server's
 * (studio/firstrun.js); this page shows the steps and waits on them.
 */
const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const sameModel = (a, b) => (a.includes(':') ? a : `${a}:latest`) === (b.includes(':') ? b : `${b}:latest`);
const fmtBytes = (n) => (!n ? '' : n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.round(n / 1e6)} MB`);

const STAGES = [['folders', 'Folders'], ['setting', 'Set up'], ['phone', 'Phone'], ['ready', 'Ready']];

export function initSetup({ hostApi, toast, canvasxUrl, onDone }) {
  const S = { step: null, status: null, canvas: '', data: '', serial: null, phone: null, run: 0, pickBusy: false };
  const relay = (id, method, path, body) => hostApi('POST', 'setup/relay', { id, method, path, body });
  const card = $('setup-card');

  function show(on) {
    $('setup').hidden = !on;
    document.body.classList.toggle('in-setup', on);
  }

  /* One screen: the stage rail, a title, what to do. Each render bumps run,
   * so a loop still going for an older screen stops itself. */
  function screen(stage, title, lead) {
    S.run++;
    card.replaceChildren();
    const rail = el('ol', 'rail');
    const at = STAGES.findIndex(([k]) => k === stage);
    STAGES.forEach(([, label], i) => { const li = el('li', i < at ? 'done' : i === at ? 'now' : '', label); rail.append(li); });
    card.append(rail, el('h1', null, title));
    if (lead) card.append(el('p', 'lead', lead));
    return S.run;
  }
  const alive = (run) => run === S.run && !$('setup').hidden;

  function buttons(...list) {
    const row = el('div', 'actions');
    for (const [label, fn, kind = ''] of list) {
      const b = el('button', `btn ${kind}`, label);
      b.type = 'button';
      b.addEventListener('click', fn);
      row.append(b);
    }
    card.append(row);
    return row;
  }

  function note(text, kind = '') {
    const p = el('p', `note ${kind}`, text);
    card.append(p);
    return p;
  }

  /* --------------------------------------------------------- folders */

  function folderField(label, hint, value, title) {
    const wrap = el('label', 'field');
    wrap.append(el('span', 'field-label', label));
    const row = el('span', 'field-row');
    const input = el('input');
    input.value = value;
    input.spellcheck = false;
    const browse = el('button', 'btn', 'Browse…');
    browse.type = 'button';
    browse.addEventListener('click', async () => {
      if (S.pickBusy) return;
      S.pickBusy = true;
      browse.disabled = true;
      browse.textContent = 'Dialog open…';
      try {
        const r = await hostApi('POST', 'setup/pick', { title, initial: input.value.trim() });
        if (r.path) input.value = r.path;
      } catch (e) { toast(e.message, true); }
      S.pickBusy = false;
      browse.disabled = false;
      browse.textContent = 'Browse…';
    });
    row.append(input, browse);
    wrap.append(row, el('span', 'field-hint', hint));
    card.append(wrap);
    return input;
  }

  function folders() {
    screen('folders', 'Welcome to NoteX Studio', 'Two folders to start with. Press Browse to choose one, or type its path.');
    const sep = S.status.home.includes('\\') ? '\\' : '/';
    const canvas = folderField('Folder to save your canvases', 'CanvasX keeps each canvas here, and NoteX reads them from here.',
      S.canvas || S.status.workspace || `${S.status.home}${sep}NoteX Canvases`, 'Choose the folder to save your canvases');
    const data = folderField('Folder to save RAGX and NoteX files', "RAGX's index of your documents, NoteX's documents and settings, and the logs.",
      S.data || S.status.dataDir, 'Choose the folder to save RAGX and NoteX files');
    const msg = note('');
    buttons(['Continue', () => {
      S.canvas = canvas.value.trim();
      S.data = data.value.trim();
      if (!S.canvas || !S.data) { msg.textContent = 'Both folders are needed.'; msg.className = 'note bad'; return; }
      setting({ apply: true });
    }, 'primary']);
  }

  /* --------------------------------------------------------- setting */

  function checklist() {
    const ul = el('ul', 'checks');
    card.append(ul);
    const item = (text) => {
      const li = el('li', 'wait');
      const t = el('span', 'check-text', text);
      const sub = el('span', 'check-sub');
      li.append(el('span', 'mark'), el('span', 'check-body'));
      li.lastChild.append(t, sub);
      ul.append(li);
      return {
        li, set(state, label, detail = '') { li.className = state; if (label) t.textContent = label; sub.textContent = detail; },
        body: li.lastChild,
      };
    };
    return item;
  }

  async function setting({ apply }) {
    const run = screen('setting', 'Setting up', 'This takes a minute or two the first time, most of it the embedding model downloading.');
    const item = checklist();
    const f = item('Folders');
    const m = item('Embedding model');
    const link = item('NoteX and RAGX');
    const cx = item('CanvasX on this PC');
    const tail = el('div');
    card.append(tail);

    // 1. The folders: NoteX's canvases, both engines' data.
    if (apply) {
      f.set('run', 'Folders', S.data !== S.status.dataDir ? 'Starting RAGX and NoteX in the new folder…' : 'Setting up…');
      try {
        const r = await hostApi('POST', 'setup/folders', { canvas: S.canvas, data: S.data });
        S.status = { ...S.status, workspace: r.workspace, dataDir: r.dataDir };
        f.set('ok', 'Folders ready', `Canvases in ${r.workspace} · RAGX and NoteX in ${r.dataDir}`);
      } catch (e) {
        if (!alive(run)) return;
        f.set('bad', 'Folders', e.message);
        buttons(['Back', folders]);
        return;
      }
    } else f.set('ok', 'Folders ready', `Canvases in ${S.status.workspace} · RAGX and NoteX in ${S.status.dataDir}`);
    if (!alive(run)) return;
    link.set('ok', 'NoteX and RAGX linked', 'NoteX reads the canvas folder; RAGX reads what NoteX writes and shows images from the canvas folder.');
    cx.set('ask', 'CanvasX on this PC', `Open CanvasX and choose the same folder there: ${S.status.workspace}. Your browser asks you once to allow it.`);
    const open = el('a', 'btn small', 'Open CanvasX ↗');
    open.href = canvasxUrl;
    open.target = '_blank';
    open.rel = 'noopener';
    open.addEventListener('click', () => cx.set('ok', 'CanvasX opened', `Choose ${S.status.workspace} there, if you have not yet.`));
    cx.body.append(open);

    // 2. The embedding model, downloaded unless Ollama has it already.
    const ok = await model(m, run);
    if (!alive(run) || !ok) return;
    tail.replaceChildren(el('p', 'finished', 'Finished - NoteX Studio is ready to use.'));
    buttons(['Set up my phone or tablet', phoneConnect, 'primary'], ['No phone - skip', () => files({ phone: 'skipped' })]);
  }

  async function model(m, run) {
    m.set('run', 'Embedding model', 'Asking Ollama…');
    let list;
    try { list = await relay('rag', 'GET', '/api/ollama/models'); } catch (e) {
      if (!alive(run)) return false;
      m.set('bad', 'Embedding model', /ollama/i.test(e.message)
        ? 'Ollama is not running. Install it from ollama.com (or start it), then press Try again.'
        : e.message);
      const again = el('button', 'btn small', 'Try again');
      again.type = 'button';
      again.addEventListener('click', async () => {
        m.set('run', 'Embedding model', 'Restarting RAGX, which starts Ollama…');
        try { await hostApi('POST', 'engines/rag/restart'); } catch (_) {}
        await wait(4000);
        if (alive(run)) setting({ apply: false });
      });
      m.body.append(again);
      return false;
    }
    // The model to use: RAGX's setting, unless another is chosen here.
    const pick = el('select', 'model-pick');
    // One entry per model: 'bge-m3' and 'bge-m3:latest' are the same.
    const names = [];
    for (const n of [list.current, ...list.suggested.map((s) => s.name), ...list.models.map((x) => x.name)]) if (!names.some((x) => sameModel(x, n))) names.push(n);
    for (const n of names) {
      const s = list.suggested.find((x) => sameModel(x.name, n));
      const have = list.models.find((x) => sameModel(x.name, n));
      const o = el('option', null, [n, have ? `installed${have.size ? `, ${fmtBytes(have.size)}` : ''}` : s && s.note].filter(Boolean).join(' - '));
      o.value = n;
      pick.append(o);
    }
    pick.value = names.find((n) => S.wantModel && sameModel(n, S.wantModel)) || names[0];
    m.body.append(pick);
    const chosen = () => pick.value;
    // While downloading, the loop below follows the choice; after, a new choice starts again.
    let busy = true;
    pick.addEventListener('change', () => { S.wantModel = pick.value; if (!busy) setting({ apply: false }); });
    const done = (okay) => { busy = false; return okay; };
    const bar = el('progress');
    bar.hidden = true;
    m.body.append(bar);

    for (;;) {
      const want = chosen();
      const have = list.models.some((x) => sameModel(x.name, want));
      if (!have) {
        m.set('run', 'Downloading the embedding model', `${want}…`);
        bar.hidden = false;
        bar.removeAttribute('value');
        try { await relay('rag', 'POST', '/api/ollama/pull', { model: want }); } catch (e) {
          if (!/downloading/.test(e.message)) { m.set('bad', 'Embedding model', e.message); return done(false); }
        }
        let p = null;
        while (alive(run)) {
          await wait(800);
          if (chosen() !== want) { await relay('rag', 'DELETE', '/api/ollama/pull').catch(() => {}); break; }
          try { p = (await relay('rag', 'GET', '/api/state')).pull; } catch (_) { continue; }
          if (!p || p.model !== want) continue;
          if (p.total) { bar.max = p.total; bar.value = p.completed; }
          m.set('run', 'Downloading the embedding model', `${want}: ${p.total ? `${Math.floor((100 * p.completed) / p.total)}% of ${fmtBytes(p.total)}` : p.status}`);
          if (p.done) break;
        }
        if (!alive(run)) return false;
        if (chosen() !== want) continue;
        bar.hidden = true;
        if (!p || !p.ok) { m.set('bad', 'Embedding model', `${want}: ${p ? p.error : 'the download stopped'}`); return done(false); }
        if (p.embeds === false) { m.set('bad', 'Embedding model', `${want} downloaded, but it cannot embed - choose another.`); return done(false); }
        list.models.push({ name: want });
      }
      // A first run has nothing embedded, so the model is simply set.
      if (!sameModel(want, list.current)) {
        try { await relay('rag', 'PUT', '/api/settings', { embedModel: want }); list.current = want; } catch (e) { m.set('bad', 'Embedding model', e.message); return done(false); }
      }
      pick.disabled = false;
      m.set('ok', 'Embedding model ready', `${want} - RAGX embeds your documents with it. You can change it later in RAGX's Settings.`);
      return done(true);
    }
  }

  /* ----------------------------------------------------------- phone */

  function phoneConnect() {
    screen('phone', 'Connect your phone or tablet', 'Connect it to this PC with a USB cable, then click OK.');
    const d = el('details', 'help');
    d.append(el('summary', null, 'First time with this phone? Turn on USB debugging'));
    const ol = el('ol');
    for (const t of [
      'On the phone, open Settings → About phone → Software information, and tap Build number seven times.',
      'Back in Settings, open Developer options and turn on USB debugging.',
      'With the cable in, tap the USB notification on the phone and choose File transfer.',
      'When the phone asks to allow USB debugging from this computer, tap Allow.',
    ]) ol.append(el('li', null, t));
    d.append(ol);
    card.append(d);
    const msg = note('');
    buttons(['OK', () => phoneCheck(msg), 'primary'], ['No phone - skip', () => files({ phone: 'skipped' })]);
  }

  async function phoneCheck(msg) {
    msg.className = 'note';
    msg.textContent = 'Looking for the phone…';
    let st;
    try { st = await hostApi('GET', 'setup/phone'); } catch (e) { msg.className = 'note bad'; msg.textContent = e.message; return; }
    if (!st.adb) return adbMissing(st);
    const ready = st.devices.filter((x) => x.state === 'device');
    if (st.error) { msg.className = 'note bad'; msg.textContent = st.error; return; }
    if (!st.devices.length) { msg.className = 'note bad'; msg.textContent = 'No phone found. Check the cable, and that USB debugging is on - then click OK again.'; return; }
    if (!ready.length) {
      msg.className = 'note bad';
      msg.textContent = st.devices.some((x) => x.state === 'unauthorized') ? 'The phone is asking - tap Allow on it to let this PC use USB debugging, then click OK again.' : `The phone is ${st.devices[0].state}. Unplug it, plug it in again, and click OK.`;
      return;
    }
    if (ready.length > 1 && !S.serial) {
      msg.className = 'note';
      msg.textContent = 'More than one phone is connected. Which one?';
      const row = el('div', 'actions');
      for (const dev of ready) {
        const b = el('button', 'btn', dev.name || dev.model || dev.serial);
        b.type = 'button';
        b.addEventListener('click', () => { S.serial = dev.serial; S.phone = dev; phoneOpen(); });
        row.append(b);
      }
      msg.after(row);
      return;
    }
    S.serial = ready[0].serial;
    S.phone = ready[0];
    phoneOpen();
  }

  function adbMissing(st) {
    screen('phone', 'One more tool for the phone', "Setting up CanvasXP on the phone needs Android's platform tools (adb) on this PC. They come from Google, about 7 MB, and stay in NoteX Studio's tools folder.");
    const terms = el('p', 'note');
    const a = el('a', null, "Google's terms for the platform tools");
    a.href = st.download.terms;
    a.target = '_blank';
    a.rel = 'noopener';
    terms.append('Downloading them means you accept ', a, '.');
    card.append(terms);
    const msg = note('');
    const row = buttons(['Download the platform tools', async () => {
      row.querySelectorAll('button').forEach((b) => { b.disabled = true; });
      msg.className = 'note';
      msg.textContent = 'Downloading from Google…';
      try { await hostApi('POST', 'setup/phone/adb'); phoneConnect(); } catch (e) {
        msg.className = 'note bad';
        msg.textContent = e.message;
        row.querySelectorAll('button').forEach((b) => { b.disabled = false; });
      }
    }, 'primary'], ['No phone - skip', () => files({ phone: 'skipped' })]);
  }

  async function phoneOpen() {
    const run = screen('phone', 'Setting up CanvasXP on your phone', `Connecting ${S.phone.name || 'the phone'}…`);
    try {
      await hostApi('POST', 'setup/phone/open', { serial: S.serial });
    } catch (e) {
      if (!alive(run)) return;
      note(e.message, 'bad');
      buttons(['Try again', phoneOpen, 'primary'], ['Back', phoneConnect]);
      return;
    }
    if (alive(run)) phoneWait();
  }

  async function phoneWait() {
    const run = screen('phone', 'Open CanvasXP on your phone', `The phone's browser should be showing CanvasXP now. If it is not, open the browser on the phone and go to localhost:${S.status.xpPort}.`);
    const ol = el('ol', 'steps');
    for (const t of ['Choose a target folder - where the phone keeps your canvases.', 'Press Set up USB sync.', 'Optional: Install it, or Add to Home screen, so it opens like an app.']) ol.append(el('li', null, t));
    card.append(ol);
    const status = note('Waiting for CanvasXP to set up its folder on the phone…', 'live');
    buttons(['Open it on the phone again', () => hostApi('POST', 'setup/phone/open', { serial: S.serial }).then(() => toast('Opened on the phone.'), (e) => toast(e.message, true))], ['Back', phoneConnect]);
    while (alive(run)) {
      try {
        const { folders: found } = await hostApi('POST', 'setup/phone/find', { serial: S.serial });
        if (!alive(run)) return;
        if (found.length) { phoneLink(found[0]); return; }
      } catch (e) { if (alive(run)) status.textContent = `${e.message} - still trying.`; }
      await wait(2500);
    }
  }

  async function phoneLink(found) {
    const run = screen('phone', 'Connecting your phone for sync', `CanvasXP's folder on the phone: ${found.folder.replace(/^\/sdcard\//, 'Internal storage/')}`);
    const item = checklist();
    const l = item('Linking NoteX to the phone');
    const s = item('First sync');
    l.set('run', 'Linking NoteX to the phone', 'Over File transfer…');
    try {
      const r = await hostApi('POST', 'setup/phone/link', { serial: S.serial });
      l.set('ok', 'NoteX linked to the phone', `${r.phone.name} · ${r.storage}/${r.phone.path.slice(1).join('/')}`);
    } catch (e) {
      if (!alive(run)) return;
      l.set('bad', 'Linking NoteX to the phone', e.message);
      buttons(['Try again', () => phoneLink(found), 'primary'], ['Back', phoneConnect]);
      return;
    }
    s.set('run', 'First sync', 'Starting…');
    try { await relay('notex', 'POST', '/api/phone/sync'); } catch (e) {
      if (!alive(run)) return;
      s.set('bad', 'First sync', e.message);
      buttons(['Try again', () => phoneLink(found), 'primary'], ['Skip the sync', () => files({ phone: 'linked' })]);
      return;
    }
    let rep = null;
    while (alive(run)) {
      await wait(1200);
      try { rep = await relay('notex', 'GET', '/api/phone'); } catch (_) { continue; }
      if (rep.running) { s.set('run', 'First sync', rep.progress || 'Working…'); continue; }
      break;
    }
    if (!alive(run)) return;
    const last = rep && rep.last;
    if (!last || last.error) {
      s.set('bad', 'First sync', last ? last.error : 'The sync stopped.');
      buttons(['Try again', () => phoneLink(found), 'primary'], ['Skip the sync', () => files({ phone: 'linked' })]);
      return;
    }
    const n = (k) => (Array.isArray(last[k]) ? last[k].length : 0);
    s.set('ok', 'Phone synced', `${n('pulled')} file${n('pulled') === 1 ? '' : 's'} from the phone, ${n('pushed')} to it${n('conflicts') ? `, ${n('conflicts')} kept side by side` : ''}.`);
    await wait(900);
    if (alive(run)) files({ phone: 'linked' });
  }

  /* ----------------------------------------------------------- files */

  async function files({ phone }) {
    S.phoneResult = phone;
    const run = screen('ready', 'NoteX is checking your files', 'Reading the canvases, and RAGX taking in what NoteX writes.');
    const item = checklist();
    const c = item('Canvases');
    const r = item('RAGX');
    c.set('run', 'Canvases', 'Looking…');
    try {
      const fab = await relay('notex', 'GET', '/api/fabrics');
      const list = fab.fabrics || [];
      c.set('ok', `${list.length} canvas${list.length === 1 ? '' : 'es'} found`, list.length ? list.slice(0, 6).map((x) => x.name).join(', ') + (list.length > 6 ? '…' : '') : 'None yet - make your first in CanvasX or CanvasXP.');
    } catch (e) { c.set('bad', 'Canvases', e.message); }
    const started = Date.now();
    let skip = null;
    while (alive(run)) {
      let st;
      try { st = await relay('rag', 'GET', '/api/state'); } catch (_) { await wait(1000); continue; }
      const busy = st.ingesting || (st.queue && st.queue.length);
      if (!busy) { r.set('ok', 'RAGX is up to date', `${st.totals.docs} document${st.totals.docs === 1 ? '' : 's'} in its library.`); break; }
      r.set('run', 'RAGX is reading', `${st.ingesting || ''}${st.queue && st.queue.length ? ` · ${st.queue.length} waiting` : ''}`);
      if (!skip && Date.now() - started > 6000) skip = buttons(['Continue - it keeps reading in the background', () => ready()]);
      await wait(1500);
    }
    if (!alive(run)) return;
    await wait(700);
    if (alive(run)) ready();
  }

  function ready() {
    screen('ready', 'Ready, Steady… Note', null);
    card.lastChild.classList.add('ready-title');
    card.append(el('p', 'lead', S.phoneResult === 'linked'
      ? 'Your canvases, RAGX and your phone are set up. Whenever the phone is plugged in, press Phone attached - sync in NoteX to bring them together.'
      : 'Your canvases and RAGX are set up. You can connect a phone later with the Setup button at the top.'));
    buttons(['Start', async () => {
      try { await hostApi('POST', 'setup/done', { phone: S.phoneResult || null }); } catch (e) { toast(e.message, true); }
      show(false);
      onDone();
    }, 'primary']);
  }

  /* ------------------------------------------------------------ open */

  async function open({ force = false } = {}) {
    for (let i = 0; i < 120; i++) {
      try { S.status = await hostApi('GET', 'setup'); } catch (_) { S.status = null; }
      if (S.status && S.status.known) break;
      await wait(1000);
    }
    if (!S.status) return;
    if (!force && !S.status.needed) return;
    show(true);
    // A setup begun before a reload goes on from its folders.
    if (!force && S.status.workspace && S.status.setup.started) setting({ apply: false });
    else folders();
  }

  $('setup-btn').addEventListener('click', () => open({ force: true }));
  $('setup-close').addEventListener('click', () => { S.run++; show(false); });
  return { open };
}
