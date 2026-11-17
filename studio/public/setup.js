/* The first-run setup screen (t-2b5970444b), in the user's order:
 *   what CanvasX Studio needs on the PC, checked, and what it owns installed;
 *   the agent platform - Claude Code or Google Antigravity - chosen and
 *   signed in to; NoteX and RAGX started (t-80c9a58283);
 *   the folder for canvases and the folder for RAGX's and NoteX's files,
 *   the embedding model downloading, setting up, finished;
 *   then the phone, if there is one: connect it by USB and press OK,
 *   CanvasXP set up on it, open localhost:8080 and pick a target folder,
 *   the phone linked and synced;
 *   NoteX checking the first files, and Ready, Steady... Note.
 * Everything that touches the PC or the engines is the studio server's
 * (studio/firstrun.js); this page shows the steps and waits on them.
 *
 * It looks like CanvasXP (t-1f89a75b86): CanvasXP's colours, a card with an
 * illustration beside each step, as drawn in the "CanvasX Studio Setup" design.
 */
const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const sameModel = (a, b) => (a.includes(':') ? a : `${a}:latest`) === (b.includes(':') ? b : `${b}:latest`);
const fmtBytes = (n) => (!n ? '' : n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.round(n / 1e6)} MB`);
const baseName = (p) => String(p || '').split(/[\\/]/).filter(Boolean).pop() || p;

const STAGES = [['deps', 'Check'], ['agent', 'Agent'], ['folders', 'Folders'], ['setting', 'Set up'], ['phone', 'Phone'], ['ready', 'Ready']];
// What must be there before the engines can start; Ollama and Git are wanted, not needed.
const NEEDED = ['node', 'projects', 'packages', 'pages'];

/* ------------------------------------------------------------ the art */

/* Each step's illustration: fixed markup written here, never built from
 * data; its colours come from classes in studio.css, so light and dark
 * both work. */
const ART = {
  folders: `<svg viewBox="0 0 340 300" fill="none"><path class="f-s s-o" stroke-width="2" d="M40 92h78l16 18h126a14 14 0 0 1 14 14v108a14 14 0 0 1-14 14H40a14 14 0 0 1-14-14V106a14 14 0 0 1 14-14z"/><rect class="f-c s-a" x="54" y="132" width="76" height="52" rx="10" stroke-width="2"/><rect class="f-k" x="62" y="142" width="34" height="6" rx="3"/><rect class="f-l" x="62" y="154" width="54" height="5" rx="2.5"/><rect class="f-l" x="62" y="164" width="44" height="5" rx="2.5"/><rect class="f-c s-o" x="146" y="150" width="62" height="44" rx="10" stroke-width="2"/><circle class="s-k" cx="166" cy="172" r="8" stroke-width="2"/><path class="s-o" d="M180 166h18M180 178h12" stroke-width="2" stroke-linecap="round"/><rect class="f-c s-o" x="222" y="128" width="64" height="70" rx="10" stroke-width="2"/><path class="s-a" d="M234 146l12 10 14-18 14 20" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/><rect class="f-l" x="234" y="174" width="40" height="5" rx="2.5"/><path class="s-o" d="M130 158c10 0 10 14 16 14M208 172c8 0 8-10 14-10" stroke-width="2" stroke-dasharray="3 5" stroke-linecap="round"/><path class="f-s2 s-o" d="M92 54h52l10 12h76a10 10 0 0 1 10 10v8H82V64a10 10 0 0 1 10-10z" stroke-width="2"/><circle class="f-a" cx="292" cy="62" r="18"/><path class="s-w" d="M284 62h16M292 54v16" stroke-width="2.5" stroke-linecap="round"/></svg>`,
  model: `<svg viewBox="0 0 320 300" fill="none"><circle class="s-faint" cx="160" cy="150" r="112" stroke-width="14"/><circle class="s-a sx-ring" cx="160" cy="150" r="112" stroke-width="14" stroke-linecap="round" stroke-dasharray="0 704" transform="rotate(-90 160 150)"/><rect class="f-s s-o" x="104" y="94" width="112" height="112" rx="22" stroke-width="2"/><path class="s-o" d="M118 94v-14M140 94v-14M162 94v-14M184 94v-14M202 94v-14M118 220v-14M140 220v-14M162 220v-14M184 220v-14M202 220v-14M104 116H90M104 140H90M104 164H90M104 186H90M230 116h-14M230 140h-14M230 164h-14M230 186h-14" stroke-width="2" stroke-linecap="round"/><rect class="f-c" x="124" y="114" width="72" height="72" rx="14"/><path class="s-k" d="M160 128v32M146 148l14 14 14-14" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><path class="s-a" d="M144 172h32" stroke-width="3" stroke-linecap="round"/><circle class="f-k" cx="262" cy="56" r="5"/><circle class="f-l" cx="46" cy="232" r="4"/><circle class="f-l" cx="58" cy="70" r="3"/></svg>`,
  finished: `<svg viewBox="0 0 360 340" fill="none"><path class="s-o" d="M180 170L76 78M180 170l112-82M180 170l2 128" stroke-width="2" stroke-dasharray="4 6" stroke-linecap="round"/><rect class="f-s s-o" x="22" y="40" width="104" height="72" rx="14" stroke-width="2"/><rect class="f-a" x="36" y="56" width="22" height="16" rx="4"/><rect class="f-l" x="64" y="56" width="22" height="16" rx="4"/><rect class="f-l2" x="36" y="80" width="76" height="16" rx="4"/><rect class="f-s s-o" x="236" y="48" width="104" height="72" rx="14" stroke-width="2"/><path class="s-o" d="M252 68h44M252 82h64M252 96h34" stroke-width="3" stroke-linecap="round"/><rect class="f-s s-o" x="130" y="262" width="104" height="66" rx="14" stroke-width="2"/><circle class="s-k" cx="164" cy="294" r="12" stroke-width="2.5"/><path class="s-k" d="M173 303l9 9" stroke-width="2.5" stroke-linecap="round"/><path class="s-o" d="M192 286h28M192 298h20" stroke-width="3" stroke-linecap="round"/><circle class="f-at" cx="180" cy="170" r="66"/><circle class="f-a" cx="180" cy="170" r="48"/><path class="s-w" d="M158 171l15 15 30-32" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/><path class="s-k" d="M268 196l6 6M276 188l-2 10M286 196l-10 2M84 196v12M78 202h12" stroke-width="2" stroke-linecap="round"/><text class="t-m" x="74" y="130" text-anchor="middle">CanvasX</text><text class="t-m" x="288" y="138" text-anchor="middle">NoteX</text><text class="t-m" x="248" y="300">RAGX</text></svg>`,
  connect: `<svg viewBox="0 0 380 300" fill="none"><rect class="f-s s-o" x="18" y="64" width="210" height="136" rx="12" stroke-width="2"/><rect class="f-g" x="30" y="76" width="186" height="112" rx="6"/><rect class="f-a" x="40" y="86" width="50" height="34" rx="6"/><rect class="f-l" x="98" y="86" width="50" height="34" rx="6"/><rect class="f-l2" x="156" y="86" width="50" height="34" rx="6"/><rect class="f-l2" x="40" y="130" width="166" height="8" rx="4"/><rect class="f-l2" x="40" y="146" width="120" height="8" rx="4"/><path class="f-s2 s-o" d="M4 206h238l-12 14H16z" stroke-width="2" stroke-linejoin="round"/><rect class="f-s s-o" x="268" y="74" width="92" height="170" rx="18" stroke-width="2"/><rect class="f-g" x="278" y="92" width="72" height="128" rx="8"/><rect class="f-l" x="286" y="102" width="56" height="10" rx="5"/><rect class="f-a" x="286" y="120" width="26" height="26" rx="6"/><rect class="f-l" x="316" y="120" width="26" height="26" rx="6"/><rect class="f-l2" x="286" y="150" width="56" height="26" rx="6"/><path class="s-a" d="M228 186c30 0 36 40 60 62s26 20 26 4v-8" stroke-width="4" stroke-linecap="round"/><rect class="f-k" x="306" y="240" width="16" height="12" rx="3"/><rect class="f-k" x="220" y="180" width="14" height="12" rx="3"/><circle class="f-c s-k" cx="262" cy="214" r="15" stroke-width="2"/><path class="s-k" d="M262 206v14M256 214l6 6 6-6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  phone: `<svg viewBox="0 0 250 470" fill="none"><rect class="f-bezel s-o" x="2" y="2" width="246" height="466" rx="38" stroke-width="2"/><rect class="f-g" x="12" y="12" width="226" height="446" rx="30"/><rect class="f-s" x="24" y="26" width="202" height="32" rx="16"/><text class="t-k sx-url" x="62" y="47">localhost:8080</text><rect class="s-k" x="40" y="37" width="12" height="11" rx="2" stroke-width="2"/><rect class="f-a" x="28" y="76" width="30" height="30" rx="9"/><text class="t-b" x="68" y="90">CanvasXP</text><text class="t-m" x="68" y="104">Your canvases, in your pocket</text><rect class="f-c s-o" x="24" y="122" width="202" height="76" rx="14" stroke-width="1"/><text class="t-m" x="36" y="142">Target folder</text><rect class="f-a sx-pulse" x="36" y="152" width="178" height="34" rx="10"/><text class="t-w" x="125" y="174" text-anchor="middle">Open target folder</text><rect class="f-sync s-o" x="24" y="208" width="202" height="76" rx="14" stroke-width="1"/><text class="t-b2" x="36" y="228">USB sync</text><rect class="f-l2 s-a" x="36" y="240" width="178" height="32" rx="10" stroke-width="2" stroke-dasharray="4 4"/><text class="t-k" x="125" y="261" text-anchor="middle">Set up USB sync</text><rect class="f-l2 s-o" x="24" y="298" width="96" height="70" rx="12" stroke-width="1"/><rect class="f-l2 s-o" x="130" y="298" width="96" height="70" rx="12" stroke-width="1"/><rect class="f-l2 s-o" x="24" y="378" width="96" height="70" rx="12" stroke-width="1"/><rect class="f-l2 s-o" x="130" y="378" width="96" height="70" rx="12" stroke-width="1"/></svg>`,
  sync: `<svg viewBox="0 0 380 300" fill="none"><rect class="f-s s-o" x="14" y="84" width="140" height="100" rx="12" stroke-width="2"/><rect class="f-g" x="24" y="94" width="120" height="74" rx="6"/><rect class="f-a" x="34" y="104" width="30" height="22" rx="5"/><rect class="f-l" x="70" y="104" width="30" height="22" rx="5"/><rect class="f-l2" x="106" y="104" width="28" height="22" rx="5"/><rect class="f-l2" x="34" y="134" width="100" height="6" rx="3"/><path class="f-s2 s-o" d="M2 190h164l-10 12H12z" stroke-width="2" stroke-linejoin="round"/><rect class="f-s s-o" x="276" y="66" width="80" height="148" rx="16" stroke-width="2"/><rect class="f-g" x="285" y="82" width="62" height="112" rx="7"/><rect class="f-a" x="292" y="92" width="22" height="20" rx="5"/><rect class="f-l" x="318" y="92" width="22" height="20" rx="5"/><rect class="f-l2" x="292" y="118" width="48" height="20" rx="5"/><g class="sx-spin-slow"><path class="s-a" d="M176 112c20-22 62-24 84-2" stroke-width="4" stroke-linecap="round"/><path class="s-a" d="M252 98l10 12-15 3" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path class="s-k" d="M260 162c-20 22-62 24-84 2" stroke-width="4" stroke-linecap="round"/><path class="s-k" d="M184 176l-10-12 15-3" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></g><rect class="f-c s-o" x="196" y="126" width="44" height="22" rx="11" stroke-width="2"/><path class="s-k" d="M208 137h20" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="2 5"/></svg>`,
  check: `<svg viewBox="0 0 360 320" fill="none"><rect class="f-c2 s-o" x="58" y="70" width="190" height="130" rx="16" stroke-width="1.5" transform="rotate(-8 153 135)"/><rect class="f-c3 s-o" x="70" y="84" width="190" height="130" rx="16" stroke-width="1.5" transform="rotate(-3 165 149)"/><rect class="f-s s-o" x="82" y="100" width="190" height="130" rx="16" stroke-width="2"/><rect class="f-a" x="98" y="116" width="48" height="34" rx="8"/><rect class="f-l" x="154" y="116" width="48" height="34" rx="8"/><rect class="f-l2" x="210" y="116" width="46" height="34" rx="8"/><rect class="f-l" x="98" y="162" width="158" height="8" rx="4"/><rect class="f-l2" x="98" y="178" width="118" height="8" rx="4"/><rect class="f-l2" x="98" y="194" width="138" height="8" rx="4"/><g class="sx-bob"><circle class="f-c s-k" cx="250" cy="226" r="42" stroke-width="6"/><circle class="f-at" cx="250" cy="226" r="28"/><path class="s-k" d="M238 226l9 9 16-18" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path class="s-k" d="M281 257l30 30" stroke-width="10" stroke-linecap="round"/></g><circle class="f-l" cx="48" cy="244" r="5"/><circle class="f-a" cx="300" cy="74" r="6"/><circle class="f-l" cx="322" cy="104" r="3"/></svg>`,
  ready: `<svg viewBox="0 0 560 210" fill="none"><path class="s-o" d="M128 112h96M336 112h96" stroke-width="2.5" stroke-dasharray="4 7" stroke-linecap="round"/><rect class="f-s s-o" x="18" y="56" width="110" height="80" rx="12" stroke-width="2"/><rect class="f-g" x="27" y="65" width="92" height="56" rx="5"/><rect class="f-a" x="35" y="73" width="22" height="16" rx="4"/><rect class="f-l" x="62" y="73" width="22" height="16" rx="4"/><rect class="f-l2" x="35" y="96" width="76" height="6" rx="3"/><path class="f-s2 s-o" d="M8 142h130l-8 10H16z" stroke-width="2" stroke-linejoin="round"/><circle class="f-at" cx="280" cy="112" r="78"/><circle class="f-a" cx="280" cy="112" r="56"/><rect class="f-w" x="256" y="88" width="20" height="20" rx="5"/><rect class="f-w2" x="284" y="88" width="20" height="20" rx="5"/><rect class="f-w3" x="256" y="116" width="48" height="20" rx="5"/><rect class="f-s s-o" x="452" y="40" width="64" height="122" rx="14" stroke-width="2"/><rect class="f-g" x="460" y="54" width="48" height="92" rx="6"/><rect class="f-a" x="466" y="62" width="16" height="14" rx="4"/><rect class="f-l" x="486" y="62" width="16" height="14" rx="4"/><rect class="f-l2" x="466" y="82" width="36" height="14" rx="4"/><circle class="f-ok" cx="128" cy="56" r="13"/><path class="s-w" d="M122 56l4 4 8-8" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/><circle class="f-ok" cx="516" cy="40" r="13"/><path class="s-w" d="M510 40l4 4 8-8" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/><path class="s-k" d="M196 30l6 10M372 26l-6 12M220 186l10-4M346 190l-10-6M180 160l-8 4M384 70l10-2" stroke-width="2.5" stroke-linecap="round"/><circle class="f-k" cx="404" cy="168" r="4"/><circle class="f-l" cx="160" cy="24" r="3"/></svg>`,
};

function art(name) {
  const t = document.createElement('template');
  t.innerHTML = ART[name];
  const s = t.content.firstElementChild;
  s.setAttribute('aria-hidden', 'true');
  s.setAttribute('focusable', 'false');
  return s;
}

/* Small inline icons for the fields and notes. */
const ICON = {
  folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  data: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/></svg>',
  phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="2" width="12" height="20" rx="3"/><path d="M11 18h2"/></svg>',
  info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>',
};
function icon(name) {
  const t = document.createElement('template');
  t.innerHTML = ICON[name];
  const s = t.content.firstElementChild;
  s.setAttribute('aria-hidden', 'true');
  s.classList.add('sx-icon');
  return s;
}

export function initSetup({ hostApi, toast, canvasxUrl, onDone, embedded = false, toCanvasx = null }) {
  const S = { step: null, status: null, canvas: '', data: '', serial: null, phone: null, run: 0, pickBusy: false };
  const relay = (id, method, path, body) => hostApi('POST', 'setup/relay', { id, method, path, body });
  const card = $('setup-card');
  let body = null; // the current screen's right-hand column

  function show(on) {
    $('setup').hidden = !on;
    document.body.classList.toggle('in-setup', on);
  }

  /* One screen: the illustration on the left, then the stage rail, a title,
   * what to do. Each render bumps run, so a loop still going for an older
   * screen stops itself. */
  function screen(stage, title, lead, { picture = null, caption = null, centered = false } = {}) {
    S.run++;
    card.replaceChildren();
    card.className = `sx-card${centered ? ' centered' : ''}`;
    const out = { run: S.run, art: null, caption: null };
    if (picture && !centered) {
      const side = el('aside', 'sx-art');
      side.append(art(picture));
      if (caption != null) { out.caption = el('p', 'sx-caption', caption); side.append(out.caption); }
      card.append(side);
      out.art = side;
    }
    body = el('div', 'sx-body');
    const rail = el('ol', 'sx-rail');
    const at = STAGES.findIndex(([k]) => k === stage);
    STAGES.forEach(([, label], i) => {
      const li = el('li', i < at || (centered && i === at) ? 'done' : i === at ? 'now' : '');
      li.append(el('span', 'sx-rail-n', i < at || (centered && i === at) ? '✓' : String(i + 1)), label);
      rail.append(li);
    });
    body.append(rail);
    if (centered && picture) { const big = el('div', 'sx-hero'); big.append(art(picture)); body.append(big); out.art = big; }
    body.append(el('h1', centered ? 'sx-ready' : null, title));
    if (lead) body.append(el('p', 'sx-lead', lead));
    card.append(body);
    return out;
  }
  const alive = (run) => run === S.run && !$('setup').hidden;

  function buttons(...list) {
    if (!body.querySelector('.sx-spacer')) body.append(el('div', 'sx-spacer'));
    const row = el('div', 'sx-actions');
    for (const [label, fn, kind = ''] of list) {
      const b = el('button', `sx-btn ${kind}`, label);
      b.type = 'button';
      b.addEventListener('click', fn);
      row.append(b);
    }
    body.append(row);
    return row;
  }

  function note(text, kind = '') {
    const p = el('p', `sx-note ${kind}`, text);
    body.append(p);
    return p;
  }

  /* Step cards: a mark, a title, a line under it; one may carry a bar. */
  function checklist() {
    const ul = el('ul', 'sx-checks');
    body.append(ul);
    return (text) => {
      const li = el('li', 'wait');
      const t = el('span', 'sx-check-text', text);
      const sub = el('span', 'sx-check-sub');
      const box = el('div', 'sx-check-body');
      box.append(t, sub);
      li.append(el('span', 'sx-mark'), box);
      ul.append(li);
      let bar = null;
      return {
        li, body: box,
        set(state, label, detail = '') { li.className = state; if (label) t.textContent = label; sub.textContent = detail; },
        bar(fraction) {
          if (!bar) { bar = el('div', 'sx-bar'); bar.append(el('span')); box.insertBefore(bar, sub); }
          bar.hidden = fraction === false;
          bar.classList.toggle('busy', fraction == null);
          if (typeof fraction === 'number') bar.firstChild.style.width = `${Math.max(2, Math.min(100, fraction * 100))}%`;
        },
      };
    };
  }

  /* ------------------------------------------------------------ deps */

  const depsOf = () => hostApi('GET', 'setup/deps');
  function linkBtn(href, text) {
    const a = el('a', 'sx-btn small', `${text} ↗`);
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener';
    return a;
  }

  /* What CanvasX Studio needs: each line says what it is for; the studio's
   * own are installed with Install, the programs linked to their sites. */
  async function deps() {
    const { run } = screen('deps', 'Welcome to CanvasX Studio', 'First, what CanvasX Studio needs on this PC. What it owns it installs here; the programs come from their own sites.', {
      picture: 'check', caption: 'Node.js and Git run CanvasX Studio. NoteX, RAGX and CanvasX come with it. Ollama lets RAGX search your documents by meaning.',
    });
    const item = checklist();
    const rows = new Map();
    const msg = note('');
    const row = buttons(['Continue', () => agent(), 'primary'], ['Check again', () => paint(true)]);
    const go = row.querySelector('.primary');
    go.disabled = true;
    const asked = new Set(); // installs pressed here, whose failures are shown

    async function paint(say = false) {
      let r;
      try { r = await depsOf(); } catch (e) { if (alive(run)) { msg.className = 'sx-note bad'; msg.textContent = e.message; } return null; }
      if (!alive(run)) return null;
      S.deps = r.deps;
      if (r.agent) S.agent = r.agent;
      for (const d of r.deps.filter((x) => x.group !== 'agent')) {
        if (!rows.has(d.id)) { const it = item(d.label); const extra = el('div', 'sx-inline'); it.body.append(extra); rows.set(d.id, { it, extra }); }
        const { it, extra } = rows.get(d.id);
        extra.replaceChildren();
        const job = r.jobs[d.id];
        if (job && job.state === 'running') {
          it.set('run', d.label, job.lines.length ? job.lines[job.lines.length - 1] : 'Installing…');
          it.bar(null);
          continue;
        }
        it.bar(false);
        if (d.state === 'ok') { it.set('ok', d.label, d.detail); continue; }
        const failed = Boolean(job && job.state === 'failed' && asked.has(d.id));
        const needed = NEEDED.includes(d.id);
        it.set(failed || needed ? 'bad' : 'ask', d.label, failed ? job.error : d.detail);
        if (d.install) {
          const how = d.installAs || d.id;
          const b = el('button', 'sx-btn small', how === 'ollama' ? 'Start Ollama' : how === 'ollama-get' ? 'Install Ollama' : d.id === 'launcher' ? 'Set it up' : failed ? 'Try again' : 'Install');
          b.type = 'button';
          b.addEventListener('click', async () => {
            b.disabled = true;
            asked.add(d.id);
            try {
              const r = await hostApi('POST', 'setup/deps/install', { id: how });
              // A program's own installer runs in a terminal window; this list notices it once it is done (t-1edca66f55).
              if (r.opened) toast(`${d.label}'s installer opened in a terminal window - answer it there; this list updates once it is done.`);
            } catch (e) { toast(e.message, true); }
            paint();
          });
          extra.append(b);
        }
        if (d.link) extra.append(linkBtn(d.link, d.id === 'node' ? 'Get Node.js 24' : `Get ${d.label}`));
      }
      const missing = r.deps.filter((d) => NEEDED.includes(d.id) && d.state !== 'ok');
      const busy = Object.values(r.jobs).some((j) => j && j.state === 'running');
      go.disabled = missing.length > 0 || busy;
      msg.className = 'sx-note';
      msg.textContent = busy ? 'Installing - this page follows it.'
        : missing.length ? `Still needed: ${missing.map((d) => d.label).join(', ')}.`
          : r.deps.some((d) => d.id === 'ollama' && d.state !== 'ok') ? 'Ready to go on. Without Ollama, RAGX searches by keyword only - you can add it later.' : 'Everything CanvasX Studio needs is here.';
      if (say) toast(missing.length ? 'Checked again.' : 'Everything CanvasX Studio needs is here.');
      return { busy };
    }

    // Follow running installs; a program installed from its site shows up by itself, or with Check again.
    while (alive(run)) {
      const st = await paint();
      await wait(st && st.busy ? 1200 : 5000);
    }
  }

  /* ----------------------------------------------------------- agent */

  const PLAT = [
    { id: 'claude', dep: 'claude', label: 'Claude Code', sub: "Anthropic's Claude: Sonnet, Opus and Haiku", how: 'sign in with your Claude account' },
    { id: 'gemini', dep: 'agy', label: 'Google Antigravity', sub: "Google's Gemini models, through Antigravity's agy", how: 'sign in with your Google account' },
  ];

  /* Which platform the agents run on: only that one is set up (t-621a165092). */
  async function agent() {
    const { run } = screen('agent', 'Which agent will you use?', 'NoteX writes on your canvases with it, and RAGX answers your questions with it. Choose one - you can change it later in NoteX and RAGX.', {
      picture: 'finished', caption: 'The agent runs on this PC, signed in to your own account.',
    });
    const box = el('div', 'sx-choices');
    body.append(box);
    const msg = note('');
    const row = buttons(['Continue', () => startEngines(), 'primary'], ['Sign in…', async () => {
      try { await hostApi('POST', 'setup/agent/signin', { platform: S.agent }); msg.className = 'sx-note'; msg.textContent = 'A terminal opened: sign in there, then come back and press Continue.'; } catch (e) { msg.className = 'sx-note bad'; msg.textContent = e.message; }
    }], ['Back', () => deps()]);
    const [go, signin] = row.querySelectorAll('button');
    signin.title = 'Opens a terminal running the agent, where you sign in once';
    if (!S.deps) { try { S.deps = (await depsOf()).deps; } catch (_) { S.deps = []; } }
    if (!alive(run)) return;
    const installed = (p) => (S.deps.find((x) => x.id === p.dep) || {}).state === 'ok';

    const paint = () => {
      box.replaceChildren();
      const chosen = PLAT.find((p) => p.id === S.agent);
      go.disabled = !chosen || !installed(chosen);
      signin.disabled = go.disabled;
      for (const p of PLAT) {
        const on = S.agent === p.id;
        const card = el('button', `sx-choice${on ? ' on' : ''}`);
        card.type = 'button';
        card.setAttribute('aria-pressed', String(on));
        const words = el('span', 'sx-choice-words');
        words.append(el('strong', null, p.label), el('span', null, p.sub),
          el('span', `sx-choice-state ${installed(p) ? 'ok' : 'bad'}`, installed(p) ? `Installed - ${p.how} the first time` : 'Not installed on this PC yet'));
        card.append(el('span', 'sx-choice-mark'), words);
        card.addEventListener('click', async () => {
          try {
            await hostApi('POST', 'setup/agent', { platform: p.id });
            S.agent = p.id;
            msg.className = 'sx-note';
            msg.textContent = installed(p) ? `${p.label} it is. If you have not signed in to it on this PC, press Sign in.` : '';
            paint();
          } catch (e) { msg.className = 'sx-note bad'; msg.textContent = e.message; }
        });
        box.append(card);
        if (on && !installed(p)) {
          const get = el('div', 'sx-inline');
          const dep = S.deps.find((x) => x.id === p.dep) || {};
          // Claude Code installs from here with its own installer; Antigravity is a download (t-1edca66f55).
          if (dep.install && dep.installAs) {
            const inst = el('button', 'sx-btn small primary', `Install ${p.label}`);
            inst.type = 'button';
            inst.addEventListener('click', async () => {
              inst.disabled = true;
              try {
                await hostApi('POST', 'setup/deps/install', { id: dep.installAs });
                msg.className = 'sx-note';
                msg.textContent = `${p.label}'s installer opened in a terminal window. Answer it there - this screen notices it once it is installed.`;
              } catch (e) { msg.className = 'sx-note bad'; msg.textContent = e.message; inst.disabled = false; }
            });
            get.append(inst);
          }
          get.append(linkBtn(PLAT_LINK[p.id], `Get ${p.label}`), el('span', 'sx-aside', 'This screen checks again by itself.'));
          box.append(get);
        }
      }
    };
    const PLAT_LINK = Object.fromEntries(PLAT.map((p) => [p.id, (S.deps.find((x) => x.id === p.dep) || {}).link || '#']));
    paint();
    // Until the chosen agent is installed, look again every few seconds (t-1edca66f55).
    while (alive(run)) {
      await wait(4000);
      const chosen = PLAT.find((p) => p.id === S.agent);
      if (!alive(run) || !chosen || installed(chosen)) continue;
      try { S.deps = (await depsOf()).deps; } catch (_) { continue; }
      if (alive(run) && installed(chosen)) {
        paint();
        msg.className = 'sx-note';
        msg.textContent = `${chosen.label} is installed. Press Sign in to sign in once, then Continue.`;
      }
    }
  }

  /* ---------------------------------------------------------- engines */

  async function startEngines() {
    const st = S.status && S.status.engines;
    if (st && st.length && st.every((e) => e.state === 'running')) { folders(); return; }
    const { run } = screen('agent', 'Start NoteX and RAGX', 'Everything is set up. NoteX and RAGX run on this PC from now on, whenever CanvasX Studio is open.', { picture: 'ready', caption: 'NoteX · RAGX' });
    const item = checklist();
    const rag = item('RAGX');
    const notex = item('NoteX');
    rag.set('wait', 'RAGX', 'Searches your documents and answers from them.');
    notex.set('wait', 'NoteX', 'Reads your canvases and writes on them with the agent.');
    const msg = note('');
    const row = buttons(['Start NoteX and RAGX', async () => {
      row.querySelectorAll('button').forEach((b) => { b.disabled = true; });
      rag.set('run', 'RAGX', 'Starting…');
      notex.set('run', 'NoteX', 'Starting…');
      try {
        const r = await hostApi('POST', 'setup/engines/start');
        if (!alive(run)) return;
        S.status = { ...S.status, engines: r.engines };
        rag.set('ok', 'RAGX running');
        notex.set('ok', 'NoteX running');
        await wait(700);
        if (alive(run)) folders();
      } catch (e) {
        if (!alive(run)) return;
        rag.set('bad', 'RAGX');
        notex.set('bad', 'NoteX');
        msg.className = 'sx-note bad';
        msg.textContent = `${e.message} Their logs open from the engine names in the top bar.`;
        row.querySelectorAll('button').forEach((b) => { b.disabled = false; });
      }
    }, 'primary'], ['Back', () => agent()]);
  }

  /* --------------------------------------------------------- folders */

  function folderField(label, hint, value, title, kind) {
    const id = `sx-f-${kind}`;
    const wrap = el('div', 'sx-field');
    const lab = el('label', 'sx-field-label', label);
    lab.htmlFor = id;
    const row = el('div', 'sx-field-row');
    const box = el('div', 'sx-input');
    const input = el('input');
    input.id = id;
    input.value = value;
    input.spellcheck = false;
    box.append(icon(kind === 'canvas' ? 'folder' : 'data'), input);
    const browse = el('button', 'sx-btn', 'Browse…');
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
    row.append(box, browse);
    wrap.append(lab, row, el('span', 'sx-hint', hint));
    body.append(wrap);
    return input;
  }

  function folders() {
    screen('folders', 'Your folders', 'Two folders to start with. Press Browse to choose one, or type its path.', {
      picture: 'folders', caption: 'Your canvases stay in a folder you choose. NoteX and RAGX keep their work in another.',
    });
    const sep = S.status.home.includes('\\') ? '\\' : '/';
    const canvas = folderField('Folder to save your canvases', 'CanvasX keeps each canvas here, and NoteX reads them from here.',
      S.canvas || S.status.workspace || `${S.status.home}${sep}NoteX Canvases`, 'Choose the folder to save your canvases', 'canvas');
    const data = folderField('Folder to save RAGX and NoteX files', "RAGX's index of your documents, NoteX's documents and settings, and the logs.",
      S.data || S.status.dataDir, 'Choose the folder to save RAGX and NoteX files', 'data');
    const msg = note('');
    const row = buttons(['Continue', () => {
      S.canvas = canvas.value.trim();
      S.data = data.value.trim();
      if (!S.canvas || !S.data) { msg.textContent = 'Both folders are needed.'; msg.className = 'sx-note bad'; return; }
      setting({ apply: true });
    }, 'primary']);
    row.append(el('span', 'sx-aside', 'You can change both later from Setup.'));
  }

  /* --------------------------------------------------------- setting */

  async function setting({ apply }) {
    const view = screen('setting', 'Setting up', 'A minute or two the first time, most of it the embedding model downloading.', { picture: 'model', caption: '' });
    const { run } = view;
    const big = el('span', 'sx-big', '');
    view.caption.before(big);
    const ring = view.art.querySelector('.sx-ring');
    const showRing = (fraction, label, sub) => {
      ring.setAttribute('stroke-dasharray', `${Math.round(704 * Math.max(0, Math.min(1, fraction)))} 704`);
      big.textContent = label;
      view.caption.textContent = sub;
    };
    showRing(0, '', 'The embedding model turns your documents into something RAGX can search by meaning.');
    const item = checklist();
    const f = item('Folders');
    const m = item('Embedding model');
    const link = item('NoteX and RAGX');
    const cx = item('CanvasX on this PC');

    // 1. The folders: NoteX's canvases, both engines' data.
    if (apply) {
      f.set('run', 'Folders', S.data !== S.status.dataDir ? 'Starting RAGX and NoteX in the new folder…' : 'Setting up…');
      try {
        const r = await hostApi('POST', 'setup/folders', { canvas: S.canvas, data: S.data });
        S.status = { ...S.status, workspace: r.workspace, dataDir: r.dataDir };
        f.set('ok', 'Folders ready', `Canvases in ${r.workspace}`);
      } catch (e) {
        if (!alive(run)) return;
        f.set('bad', 'Folders', e.message);
        buttons(['Back', folders]);
        return;
      }
    } else f.set('ok', 'Folders ready', `Canvases in ${S.status.workspace}`);
    if (!alive(run)) return;
    link.set('ok', 'NoteX and RAGX linked', 'NoteX reads the canvas folder; RAGX reads what NoteX writes.');
    cx.set('ask', 'CanvasX on this PC', 'Open it and choose the same canvas folder once - your browser asks you to allow it.');
    if (embedded) {
      // Inside CanvasX already: the folder is chosen there, behind this page.
      cx.set('ask', 'CanvasX in this tab', `Choose ${S.status.workspace} with Open Target Workspace once this setup is done.`);
    } else {
      const open = el('a', 'sx-btn small', 'Open CanvasX ↗');
      open.href = canvasxUrl;
      open.target = '_blank';
      open.rel = 'noopener';
      open.addEventListener('click', () => cx.set('ok', 'CanvasX opened', `Choose ${S.status.workspace} there, if you have not yet.`));
      cx.li.append(open);
    }

    // 2. The embedding model, downloaded unless Ollama has it already.
    const ok = await model(m, run, showRing);
    if (!alive(run) || !ok) return;
    S.modelName = S.wantModel || S.modelName;
    await wait(700);
    if (alive(run)) finished();
  }

  async function model(m, run, showRing) {
    m.set('run', 'Embedding model', 'Asking Ollama…');
    m.bar(null);
    let list;
    try { list = await relay('rag', 'GET', '/api/ollama/models'); } catch (e) {
      if (!alive(run)) return false;
      m.bar(false);
      m.set('bad', 'Embedding model', /ollama/i.test(e.message)
        ? 'Ollama is not running. Install it from ollama.com (or start it), then press Try again.'
        : e.message);
      const again = el('button', 'sx-btn small', 'Try again');
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
    const pickRow = el('div', 'sx-pick');
    const pickLabel = el('label', null, 'Model');
    pickLabel.htmlFor = 'sx-model';
    const pick = el('select');
    pick.id = 'sx-model';
    pickRow.append(pickLabel, pick);
    // One entry per model: 'bge-m3' and 'bge-m3:latest' are the same.
    const names = [];
    for (const n of [list.current, ...list.suggested.map((s) => s.name), ...list.models.map((x) => x.name)]) if (!names.some((x) => sameModel(x, n))) names.push(n);
    for (const n of names) {
      const s = list.suggested.find((x) => sameModel(x.name, n));
      const have = list.models.find((x) => sameModel(x.name, n));
      const o = el('option', null, [n, have ? `installed${have.size ? `, ${fmtBytes(have.size)}` : ''}` : s && s.note].filter(Boolean).join(' · '));
      o.value = n;
      pick.append(o);
    }
    pick.value = names.find((n) => S.wantModel && sameModel(n, S.wantModel)) || names[0];
    m.body.append(pickRow);
    const chosen = () => pick.value;
    // While downloading, the loop below follows the choice; after, a new choice starts again.
    let busy = true;
    pick.addEventListener('change', () => { S.wantModel = pick.value; if (!busy) setting({ apply: false }); });
    const done = (okay) => { busy = false; return okay; };

    for (;;) {
      const want = chosen();
      S.modelName = want;
      const have = list.models.find((x) => sameModel(x.name, want));
      if (!have) {
        m.set('run', 'Downloading the embedding model', `${want}…`);
        m.bar(null);
        showRing(0.02, '…', `${want} · starting`);
        try { await relay('rag', 'POST', '/api/ollama/pull', { model: want }); } catch (e) {
          if (!/downloading/.test(e.message)) { m.bar(false); m.set('bad', 'Embedding model', e.message); return done(false); }
        }
        let p = null;
        while (alive(run)) {
          await wait(800);
          if (chosen() !== want) { await relay('rag', 'DELETE', '/api/ollama/pull').catch(() => {}); break; }
          try { p = (await relay('rag', 'GET', '/api/state')).pull; } catch (_) { continue; }
          if (!p || p.model !== want) continue;
          const frac = p.total ? p.completed / p.total : null;
          m.bar(frac);
          const pct = frac == null ? '' : `${Math.floor(frac * 100)}%`;
          m.set('run', 'Downloading the embedding model', `${want}: ${frac == null ? p.status : `${pct} of ${fmtBytes(p.total)}`}`);
          showRing(frac || 0.02, pct || '…', frac == null ? `${want} · ${p.status}` : `${want} · ${fmtBytes(p.completed)} of ${fmtBytes(p.total)}`);
          if (p.done) break;
        }
        if (!alive(run)) return false;
        if (chosen() !== want) continue;
        m.bar(false);
        if (!p || !p.ok) { m.set('bad', 'Embedding model', `${want}: ${p ? p.error : 'the download stopped'}`); return done(false); }
        if (p.embeds === false) { m.set('bad', 'Embedding model', `${want} downloaded, but it cannot embed - choose another.`); return done(false); }
        list.models.push({ name: want });
      }
      // A first run has nothing embedded, so the model is simply set.
      if (!sameModel(want, list.current)) {
        try { await relay('rag', 'PUT', '/api/settings', { embedModel: want }); list.current = want; } catch (e) { m.bar(false); m.set('bad', 'Embedding model', e.message); return done(false); }
      }
      m.bar(false);
      showRing(1, '100%', `${want}${have && have.size ? ` · ${fmtBytes(have.size)}` : ''} · ready`);
      m.set('ok', 'Embedding model ready', `${want} - RAGX embeds your documents with it. You can change it later in RAGX's Settings.`);
      return done(true);
    }
  }

  /* -------------------------------------------------------- finished */

  function finished() {
    screen('setting', 'Finished - CanvasX Studio is ready to use', 'Make canvases in CanvasX, ask your files in RAGX, and give a canvas to the agent in NoteX.', { picture: 'finished' });
    const badge = el('span', 'sx-badge', '✓ All set on this PC');
    body.querySelector('h1').before(badge);
    const tiles = el('div', 'sx-tiles');
    for (const [k, v] of [['Canvases', baseName(S.status.workspace)], ['Embedding model', S.modelName || 'ready'], ['Engines', 'RAGX · NoteX running']]) {
      const t = el('div', 'sx-tile');
      t.append(el('span', 'sx-tile-k', k), el('span', 'sx-tile-v', v));
      tiles.append(t);
    }
    body.append(tiles, el('div', 'sx-spacer'));
    const cta = el('div', 'sx-cta');
    const words = el('div', 'sx-cta-words');
    words.append(el('strong', null, 'Take your canvases with you'), el('span', null, 'CanvasXP on an Android phone or tablet, synced over the USB cable.'));
    const go = el('button', 'sx-btn primary', 'Set up my phone');
    go.type = 'button';
    go.addEventListener('click', phoneConnect);
    const skip = el('button', 'sx-btn', 'Skip');
    skip.type = 'button';
    skip.addEventListener('click', () => files({ phone: 'skipped' }));
    cta.append(icon('phone'), words, go, skip);
    body.append(cta);
  }

  /* ----------------------------------------------------------- phone */

  function phoneConnect() {
    screen('phone', 'Connect your phone or tablet', 'Connect it to this PC with a USB cable, then click OK.', { picture: 'connect', caption: 'USB cable · File transfer' });
    body.append(el('p', 'sx-kicker', 'First time with this phone'));
    const steps = el('ol', 'sx-steps');
    for (const [n, html] of [
      ['1', ['Settings → About phone → Software information: tap ', ['Build number'], ' seven times.']],
      ['2', ['Developer options: turn on ', ['USB debugging'], '.']],
      ['3', ['Cable in: tap the USB notification, choose ', ['File transfer'], ', and tap ', ['Allow'], ' when asked.']],
    ]) {
      const li = el('li');
      const t = el('span', 'sx-step-text');
      for (const part of html) t.append(Array.isArray(part) ? el('strong', null, part[0]) : part);
      li.append(el('span', 'sx-step-n', n), t);
      steps.append(li);
    }
    body.append(steps);
    const msg = note('');
    buttons(['OK', () => phoneCheck(msg), 'primary wide'], ['No phone - skip', () => files({ phone: 'skipped' })]);
  }

  async function phoneCheck(msg) {
    msg.className = 'sx-note live';
    msg.textContent = 'Looking for the phone…';
    const bad = (t) => { msg.className = 'sx-note bad'; msg.textContent = t; };
    let st;
    try { st = await hostApi('GET', 'setup/phone'); } catch (e) { bad(e.message); return; }
    if (!st.adb) return adbMissing(st);
    const ready = st.devices.filter((x) => x.state === 'device');
    if (st.error) { bad(st.error); return; }
    if (!st.devices.length) { bad('No phone found. Check the cable, and that USB debugging is on - then click OK again.'); return; }
    if (!ready.length) {
      bad(st.devices.some((x) => x.state === 'unauthorized') ? 'The phone is asking - tap Allow on it to let this PC use USB debugging, then click OK again.' : `The phone is ${st.devices[0].state}. Unplug it, plug it in again, and click OK.`);
      return;
    }
    if (ready.length > 1 && !S.serial) {
      msg.className = 'sx-note';
      msg.textContent = 'More than one phone is connected. Which one?';
      const row = el('div', 'sx-actions');
      for (const dev of ready) {
        const b = el('button', 'sx-btn', dev.name || dev.model || dev.serial);
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
    screen('phone', 'One more tool for the phone', "Setting up CanvasXP on the phone needs Android's platform tools (adb) on this PC. They come from Google, about 7 MB, and stay in CanvasX Studio's tools folder.", { picture: 'connect', caption: 'Android platform tools' });
    const terms = el('p', 'sx-note');
    const a = el('a', null, "Google's terms for the platform tools");
    a.href = st.download.terms;
    a.target = '_blank';
    a.rel = 'noopener';
    terms.append('Downloading them means you accept ', a, '.');
    body.append(terms);
    const msg = note('');
    const row = buttons(['Download the platform tools', async () => {
      row.querySelectorAll('button').forEach((b) => { b.disabled = true; });
      msg.className = 'sx-note live';
      msg.textContent = 'Downloading from Google…';
      try { await hostApi('POST', 'setup/phone/adb'); phoneConnect(); } catch (e) {
        msg.className = 'sx-note bad';
        msg.textContent = e.message;
        row.querySelectorAll('button').forEach((b) => { b.disabled = false; });
      }
    }, 'primary'], ['No phone - skip', () => files({ phone: 'skipped' })]);
  }

  async function phoneOpen() {
    const { run } = screen('phone', 'Setting up CanvasXP on your phone', `Connecting ${S.phone.name || 'the phone'}…`, { picture: 'connect', caption: S.phone.name || '' });
    const live = note('Forwarding localhost on the phone and opening CanvasXP…', 'live');
    try {
      await hostApi('POST', 'setup/phone/open', { serial: S.serial });
    } catch (e) {
      if (!alive(run)) return;
      live.className = 'sx-note bad';
      live.textContent = e.message;
      buttons(['Try again', phoneOpen, 'primary'], ['Back', phoneConnect]);
      return;
    }
    if (alive(run)) phoneWait();
  }

  async function phoneWait() {
    const view = screen('phone', 'Open CanvasXP on your phone', null, { picture: 'phone' });
    const { run } = view;
    view.art.classList.add('phone');
    view.art.querySelector('.sx-url').textContent = `localhost:${S.status.xpPort}`;
    const lead = el('p', 'sx-lead');
    lead.append("It should be open in the phone's browser now. If not, open the browser and go to ", el('strong', 'sx-em', `localhost:${S.status.xpPort}`), '.');
    body.append(lead);
    const steps = el('ol', 'sx-steps big');
    [['Open target folder', 'Choose where the phone keeps your canvases.'], ['Set up USB sync', 'CanvasXP marks the folder so NoteX can find it.'], ['Install it (optional)', 'Add to Home screen, so it opens like an app.']].forEach(([t, s], i) => {
      const li = el('li', i === 0 ? 'on' : '');
      const words = el('span', 'sx-step-text');
      words.append(el('strong', null, t), el('span', null, s));
      li.append(el('span', 'sx-step-n', String(i + 1)), words);
      steps.append(li);
    });
    body.append(steps, el('div', 'sx-spacer'));
    const foot = el('div', 'sx-actions');
    const status = el('span', 'sx-note live', 'Waiting for CanvasXP to set up its folder…');
    const again = el('button', 'sx-btn push', 'Open it on the phone again');
    again.type = 'button';
    again.addEventListener('click', () => hostApi('POST', 'setup/phone/open', { serial: S.serial }).then(() => toast('Opened on the phone.'), (e) => toast(e.message, true)));
    const back = el('button', 'sx-btn', 'Back');
    back.type = 'button';
    back.addEventListener('click', phoneConnect);
    foot.append(status, again, back);
    body.append(foot);
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
    const where = found.folder.replace(/^\/sdcard\//, 'Internal storage / ').replace(/^\/storage\/[^/]+\//, 'SD card / ').replace(/\//g, ' / ').replace(/\s+\/\s+/g, ' / ');
    const view = screen('phone', 'Connecting your phone for sync', null, { picture: 'sync', caption: 'Linking…' });
    const { run } = view;
    const lead = el('p', 'sx-lead');
    lead.append("CanvasXP's folder on the phone: ", el('strong', 'sx-em', where));
    body.append(lead);
    const item = checklist();
    const d = item('Phone found');
    d.set('ok', 'Phone found', `${S.phone.name || S.phone.model || 'Phone'} · USB debugging allowed`);
    const l = item('Linking NoteX to the phone');
    const s = item('First sync');
    l.set('run', 'Linking NoteX to the phone', 'Over File transfer - nothing to browse.');
    try {
      const r = await hostApi('POST', 'setup/phone/link', { serial: S.serial });
      l.set('ok', 'NoteX linked to the phone', `${r.storage} / ${r.phone.path.slice(1).join(' / ')}`);
    } catch (e) {
      if (!alive(run)) return;
      l.set('bad', 'Linking NoteX to the phone', e.message);
      view.caption.textContent = 'Not linked yet';
      buttons(['Try again', () => phoneLink(found), 'primary'], ['Back', phoneConnect]);
      return;
    }
    s.set('run', 'First sync', 'Starting…');
    s.bar(null);
    view.caption.textContent = 'Starting the first sync…';
    try { await relay('notex', 'POST', '/api/phone/sync'); } catch (e) {
      if (!alive(run)) return;
      s.bar(false);
      s.set('bad', 'First sync', e.message);
      view.caption.textContent = 'The first sync did not run';
      buttons(['Try again', () => phoneLink(found), 'primary'], ['Skip the sync', () => files({ phone: 'linked' })]);
      return;
    }
    body.append(el('div', 'sx-spacer'));
    const hint = el('p', 'sx-note quiet');
    hint.append(icon('info'), 'Keep the cable in until the sync finishes. CanvasXP shows the same progress on the phone.');
    body.append(hint);
    let rep = null;
    while (alive(run)) {
      await wait(1200);
      try { rep = await relay('notex', 'GET', '/api/phone'); } catch (_) { continue; }
      if (rep.running) { s.set('run', 'First sync', rep.progress || 'Working…'); view.caption.textContent = rep.progress || 'Syncing…'; continue; }
      break;
    }
    if (!alive(run)) return;
    s.bar(false);
    const last = rep && rep.last;
    if (!last || last.error) {
      s.set('bad', 'First sync', last ? last.error : 'The sync stopped.');
      view.caption.textContent = 'The first sync did not finish';
      buttons(['Try again', () => phoneLink(found), 'primary'], ['Skip the sync', () => files({ phone: 'linked' })]);
      return;
    }
    const n = (k) => (Array.isArray(last[k]) ? last[k].length : 0);
    s.set('ok', 'Phone synced', `${n('pulled')} file${n('pulled') === 1 ? '' : 's'} from the phone, ${n('pushed')} to it${n('conflicts') ? `, ${n('conflicts')} kept side by side` : ''}.`);
    view.caption.textContent = 'Synced';
    await wait(900);
    if (alive(run)) files({ phone: 'linked' });
  }

  /* ----------------------------------------------------------- files */

  async function files({ phone }) {
    S.phoneResult = phone;
    const { run } = screen('ready', 'NoteX is checking your files', 'Reading the canvases, and RAGX taking in what NoteX writes.', { picture: 'check' });
    const item = checklist();
    const c = item('Canvases');
    const r = item('RAGX');
    c.set('run', 'Canvases', 'Looking…');
    try {
      const fab = await relay('notex', 'GET', '/api/fabrics');
      const list = fab.fabrics || [];
      c.set('ok', `${list.length} canvas${list.length === 1 ? '' : 'es'} found`, list.length ? '' : 'None yet - make your first in CanvasX or CanvasXP.');
      if (list.length) {
        const chips = el('div', 'sx-chips');
        for (const x of list.slice(0, 8)) chips.append(el('span', `sx-chip${x.agent ? ' agent' : ''}`, x.name));
        if (list.length > 8) chips.append(el('span', 'sx-chip', `+${list.length - 8}`));
        c.body.append(chips);
      }
    } catch (e) { c.set('bad', 'Canvases', e.message); }
    const started = Date.now();
    let skip = null;
    while (alive(run)) {
      let st;
      try { st = await relay('rag', 'GET', '/api/state'); } catch (_) { await wait(1000); continue; }
      const waiting = st.queue ? st.queue.length : 0;
      if (!st.ingesting && !waiting) { r.bar(false); r.set('ok', 'RAGX is up to date', `${st.totals.docs} document${st.totals.docs === 1 ? '' : 's'} in its library.`); break; }
      r.bar(null);
      r.set('run', 'RAGX is reading', `${st.ingesting || ''}${waiting ? ` · ${waiting} waiting` : ''}`);
      if (!skip && Date.now() - started > 6000) skip = buttons(['Continue - it keeps reading in the background', () => ready()]);
      await wait(1500);
    }
    if (!alive(run)) return;
    await wait(700);
    if (alive(run)) ready();
  }

  function ready() {
    screen('ready', 'Ready, Steady… Note', S.phoneResult === 'linked'
      ? 'Your canvases, RAGX and your phone are set up. Whenever the phone is plugged in, press Phone attached - sync in NoteX to bring them together.'
      : 'Your canvases and RAGX are set up. You can connect a phone later from Setup.', { picture: 'ready', centered: true });
    const h = body.querySelector('h1');
    h.replaceChildren('Ready, Steady', el('span', 'sx-dots', '…'), ' ', el('span', 'sx-note-word', 'Note'));
    const row = buttons(['Start', async () => {
      try { await hostApi('POST', 'setup/done', { phone: S.phoneResult || null }); S.status.needed = false; } catch (e) { toast(e.message, true); }
      show(false);
      onDone();
    }, 'primary big']);
    if (embedded && toCanvasx) {
      const cx = el('button', 'sx-btn big', 'Back to CanvasX');
      cx.type = 'button';
      cx.addEventListener('click', async () => {
        try { await hostApi('POST', 'setup/done', { phone: S.phoneResult || null }); S.status.needed = false; } catch (_) {}
        show(false);
        onDone();
        toCanvasx();
      });
      row.append(cx);
    } else {
      const cx = el('a', 'sx-btn big', 'Open CanvasX ↗');
      cx.href = canvasxUrl;
      cx.target = '_blank';
      cx.rel = 'noopener';
      row.append(cx);
    }
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
    S.agent = S.agent || S.status.setup.agent || null;
    // A setup begun before a reload goes on from its folders; else it starts with what the PC has.
    if (!force && S.status.workspace && S.status.setup.started) setting({ apply: false });
    else deps();
  }

  $('setup-btn').addEventListener('click', () => open({ force: true }));
  $('setup-close').addEventListener('click', () => { S.run++; show(false); });
  return { open, shown: () => !$('setup').hidden, needed: () => Boolean(S.status && S.status.needed), close: () => { S.run++; show(false); } };
}
