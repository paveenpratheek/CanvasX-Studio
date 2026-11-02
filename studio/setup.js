/* npm run setup: everything NoteX Studio needs on a new PC, checked and,
 * where it can be, done - then what is still missing, said plainly.
 *
 *   node studio/setup.js [--no-pull]
 *
 * Done here: the three projects fetched (git submodules), RAGX's packages
 * installed, each page told where its engine is, the embedding model
 * pulled into Ollama. Only checked: the agents, which need the user's own
 * sign-in - Claude Code and Google Antigravity.
 */
import { spawn, spawnSync } from 'node:child_process';
import { Adb } from './firstrun.js';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, loadConfig, plugins, cliOf } from './config.js';

const results = [];
const ok = (what, detail = '') => { results.push({ ok: true, what, detail }); console.log(`  ✓ ${what}${detail ? ` - ${detail}` : ''}`); };
const no = (what, fix, needed = true) => { results.push({ ok: false, what, fix, needed }); console.log(`  ${needed ? '✗' : '–'} ${what} - ${fix}`); };

function run(cmd, args, { cwd = ROOT, show = false } = {}) {
  // npm and friends are .cmd files on Windows, which only a shell runs; the
  // shell gets one line, each part quoted. Node itself needs no shell.
  const shell = process.platform === 'win32' && cmd !== process.execPath;
  const q = (s) => (/[\s"&|<>^()]/.test(s) ? `"${String(s).replace(/"/g, '""')}"` : s);
  const opts = { cwd, stdio: show ? 'inherit' : 'pipe', encoding: 'utf8', windowsHide: true };
  const r = shell ? spawnSync([cmd, ...args].map(q).join(' '), { ...opts, shell: true }) : spawnSync(cmd, args, opts);
  return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}`.trim(), error: r.error };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function findAgy() {
  if (run('agy', ['--version']).code === 0) return 'agy';
  const local = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'agy', 'bin', 'agy.exe') : null;
  return local && fs.existsSync(local) ? local : null;
}

async function main() {
  const pull = !process.argv.includes('--no-pull');
  console.log('NoteX Studio setup\n');

  const [major] = process.versions.node.split('.').map(Number);
  if (major < 24) { no(`Node.js ${process.version}`, 'install Node.js 24 or newer from nodejs.org, then run setup again'); return finish(); }
  ok(`Node.js ${process.version}`);

  // The projects themselves.
  const plugs = plugins();
  const absent = () => [...Object.values(plugs).map(cliOf), path.join(ROOT, 'canvasx', 'index.html')].filter((f) => !fs.existsSync(f));
  if (absent().length) {
    if (fs.existsSync(path.join(ROOT, '.git'))) {
      console.log('  Fetching NoteX, RAGX and CanvasX…');
      run('git', ['submodule', 'update', '--init', '--recursive'], { show: true });
    }
  }
  if (absent().length) { no('NoteX, RAGX and CanvasX', 'clone this repository with: git clone --recursive <url> (a ZIP download leaves them out)'); return finish(); }
  ok('NoteX, RAGX and CanvasX are here');

  // RAGX's packages: the PDF reader and the canvas it draws figures on.
  if (fs.existsSync(path.join(plugs.rag.repo, 'node_modules', 'pdfjs-dist'))) ok("RAGX's packages are installed");
  else {
    console.log("  Installing RAGX's packages…");
    const r = run('npm', [fs.existsSync(path.join(plugs.rag.repo, 'package-lock.json')) ? 'ci' : 'install', '--no-audit', '--no-fund'], { cwd: plugs.rag.repo, show: true });
    if (r.code === 0) ok("RAGX's packages are installed"); else { no("RAGX's packages", `npm could not install them - run npm install in ${plugs.rag.repo}`); }
  }

  // Each page learns where its engine is.
  for (const p of Object.values(plugs)) {
    const r = run(process.execPath, [cliOf(p), 'plugin-setup'], { cwd: p.repo });
    if (r.code === 0) ok(`${p.label}'s page knows its engine`); else no(`${p.label}'s page`, `plugin-setup failed: ${r.out.split('\n').pop()}`);
  }

  const config = loadConfig();
  fs.mkdirSync(config.dataDir, { recursive: true });
  ok('Data folder', config.dataDir);

  // Embeddings: Ollama and RAGX's model.
  let model = 'embeddinggemma-2:440m';
  try { model = (await import(pathToFileURL(path.join(plugs.rag.repo, 'engine', 'lib', 'embed.js')).href)).DEFAULT_MODEL || model; } catch (_) { /* the default above */ }
  if (run('ollama', ['--version']).code !== 0) {
    no('Ollama', `install it from ollama.com, then run setup again - RAGX embeds your documents with it (${model}). Without it, search is by keyword only`);
  } else {
    let list = run('ollama', ['list']);
    if (list.code !== 0) {
      spawn('ollama', ['serve'], { detached: true, stdio: 'ignore', shell: process.platform === 'win32', windowsHide: true }).on('error', () => {}).unref();
      await wait(4000);
      list = run('ollama', ['list']);
    }
    const has = list.code === 0 && list.out.toLowerCase().includes(model.toLowerCase());
    if (has) ok('Ollama', `${model} is ready`);
    else if (list.code !== 0) no('Ollama', 'installed but not answering - start Ollama, then run setup again');
    else if (!pull) no(`Ollama model ${model}`, `run: ollama pull ${model}`);
    else {
      console.log(`  Downloading ${model} for embeddings…`);
      if (run('ollama', ['pull', model], { show: true }).code === 0) ok('Ollama', `${model} is ready`);
      else no(`Ollama model ${model}`, `the download failed - run: ollama pull ${model}`);
    }
  }

  // The agents: each needs its own sign-in, so they are only checked.
  const claude = run('claude', ['--version']);
  if (claude.code === 0) ok('Claude Code', `${claude.out.split('\n')[0]} - sign in with \`claude\` once if you have not`);
  else no('Claude Code', 'install it (see claude.com/claude-code) and sign in with `claude` - the agents and RAGX\'s answers use it', false);
  const agy = findAgy();
  if (agy) ok('Google Antigravity (agy)', 'Gemini models are available - sign in once if you have not');
  else no('Google Antigravity (agy)', 'optional: install Antigravity for the Gemini models', false);

  // The phone: adb sets up CanvasXP on it (t-c247850a37); the setup screen offers to download it.
  const adb = new Adb().path();
  if (adb) ok('adb, for the phone', adb);
  else no('adb, for the phone', 'optional: the setup screen in the studio downloads it when you set up a phone', false);
  return finish();
}

function finish() {
  const needed = results.filter((r) => !r.ok && r.needed);
  const optional = results.filter((r) => !r.ok && !r.needed);
  console.log('');
  if (needed.length) console.log(`Not ready yet: ${needed.map((r) => r.what).join(', ')}. Fix ${needed.length === 1 ? 'it' : 'them'} as above and run npm run setup again.`);
  else console.log(`Ready. Start it with: npm start${optional.length ? `\n(Optional, still missing: ${optional.map((r) => r.what).join(', ')}.)` : ''}`);
  process.exitCode = needed.length ? 1 : 0;
}

main().catch((e) => { console.error(e.stack || e.message); process.exitCode = 1; });
