/* npm start: the studio page, CanvasX, and both engines, from one terminal
 * (t-33bd14605d, t-f16266d576). Ctrl+C stops everything it started.
 *
 *   node studio/start.js [--data <folder>] [--no-open] [--canvasx-origin <url>]
 *                        [--studio-port N] [--ragx-port N] [--notex-port N] [--canvasx-port N]
 *
 * On a first run - the setup never finished and NoteX has no canvas
 * folder, or something setup installs is missing - the engines wait: the
 * setup screen checks and installs first, then starts them (t-80c9a58283).
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, loadConfig, plugins, cliOf, pluginDir, saveConfigFile, dataDirOf } from './config.js';
import { ManagedEngine, engineSpecs } from './engines.js';
import { createStudioServer, createStaticServer, listen } from './host.js';
import { FirstRun } from './firstrun.js';

export function parseArgs(argv) {
  const o = { ports: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => { if (i + 1 >= argv.length) throw new Error(`${a} needs a value.`); return argv[++i]; };
    if (a === '--no-open') o.open = false;
    else if (a === '--open') o.open = true;
    else if (a === '--open-canvasx') o.openCanvasx = true;
    else if (a === '--data') o.dataDir = val();
    else if (a === '--canvasx-origin') (o.canvasxOrigins = o.canvasxOrigins || []).push(val());
    else if (/^--(studio|ragx|notex|canvasx|phone)-port$/.test(a)) o.ports[a.slice(2, -5)] = val();
    else if (a === '-h' || a === '--help') o.help = true;
    else throw new Error(`Unknown option ${a} - see npm start -- --help.`);
  }
  return o;
}

const HELP = `npm start [-- options]
  --data <folder>        where NoteX and RAGX keep their data (default ~/CanvasX Studio)
  --no-open              do not open the browser
  --open-canvasx         open CanvasX rather than the studio page, once the setup is done
  --canvasx-origin <url> a CanvasX served elsewhere (e.g. http://localhost:5500) that may
                         find the studio and open NoteX and RAGX in its tab; kept for later runs
  --studio-port N  --ragx-port N  --notex-port N  --canvasx-port N  --phone-port N
Settings can also live in studio.config.json beside package.json.`;

/* What setup must have done, each with the fix. */
/* NoteX has a canvas folder in this data folder. */
export function hasWorkspace(config) {
  try { return Boolean(JSON.parse(fs.readFileSync(path.join(dataDirOf(config, 'notex').dir, 'config.json'), 'utf8')).workspace); } catch (_) { return false; }
}

/* Whether the engines wait for the setup screen. */
export function holdEngines(config, gaps) {
  return gaps.length > 0 || (!(config.setup && config.setup.done) && !hasWorkspace(config));
}

export function missing(root = ROOT) {
  const plugs = plugins(root);
  const out = [];
  for (const p of Object.values(plugs)) if (!fs.existsSync(cliOf(p))) out.push(`${p.label} is not here (${path.relative(root, p.repo)} is empty) - run: npm run setup`);
  if (!fs.existsSync(path.join(root, 'canvasx', 'index.html'))) out.push('CanvasX is not here (canvasx is empty) - run: npm run setup');
  if (fs.existsSync(cliOf(plugs.rag)) && !fs.existsSync(path.join(plugs.rag.repo, 'node_modules', 'pdfjs-dist'))) out.push("RAGX's packages are not installed - run: npm run setup");
  return out;
}

/* local.json tells each page where its engine is; written for this copy. */
function pluginSetup(p) {
  const local = path.join(pluginDir(p), 'local.json');
  try { if (path.resolve(JSON.parse(fs.readFileSync(local, 'utf8')).repo) === path.resolve(p.repo)) return; } catch (_) { /* written below */ }
  spawnSync(process.execPath, [cliOf(p), 'plugin-setup'], { cwd: p.repo, stdio: 'ignore' });
}

function portFree(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.listen(port, '127.0.0.1', () => s.close(() => resolve(true)));
  });
}

export function openBrowser(url) {
  const opts = { detached: true, stdio: 'ignore' };
  const child = process.platform === 'win32' ? spawn('cmd.exe', ['/d', '/s', '/c', `"start "" "${url}""`], { ...opts, windowsVerbatimArguments: true })
    : spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], opts);
  child.on('error', () => console.log(`  Open ${url} in Chrome or Edge.`));
  child.unref();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { console.log(HELP); return; }
  const [major] = process.versions.node.split('.').map(Number);
  if (major < 24) throw new Error(`CanvasX Studio needs Node.js 24 or newer; this is ${process.version}. Install it from nodejs.org.`);
  const gaps = missing();

  const config = loadConfig({ overrides: args });
  if (args.canvasxOrigins) saveConfigFile(config.file, { canvasxOrigins: config.canvasxOrigins });
  const hold = holdEngines(config, gaps);
  const plugs = plugins();
  for (const p of Object.values(plugs)) if (fs.existsSync(cliOf(p))) pluginSetup(p);
  // Logs follow the data folder, which the setup may move (t-c3a090b64a).
  const logTo = (id, line) => {
    const dir = path.join(config.dataDir, 'logs');
    fs.mkdir(dir, { recursive: true }, () => fs.appendFile(path.join(dir, `${id}.log`), `${new Date().toISOString()} ${line}\n`, () => {}));
  };

  for (const [what, port] of [['RAGX engine', config.ports.ragx], ['NoteX engine', config.ports.notex]]) {
    if (!(await portFree(port))) throw new Error(`Port ${port} (${what}) is in use - is it already running, perhaps in ter-manager? Stop that, or set another port in studio.config.json.`);
  }

  const engines = {};
  for (const spec of Object.values(engineSpecs(config, plugs))) {
    const e = new ManagedEngine(spec, { log: (line) => logTo(spec.id, line) });
    e.on('state', (s) => console.log(`  ${s.label.padEnd(5)} ${s.state}${s.url ? ` at ${s.url}` : ''}${s.detail ? ` - ${s.detail}` : ''}`));
    engines[spec.id] = e;
  }

  const say = (s) => console.log(`  ${s}`);
  const firstRun = new FirstRun({ config, plugs, engines, log: say });
  const studio = createStudioServer({ config, plugs, engines, firstRun, log: say });
  const canvasx = createStaticServer({ root: path.join(ROOT, 'canvasx'), port: config.ports.canvasx });
  await listen(studio.server, config.ports.studio, 'CanvasX Studio');
  // The CanvasX the user has open may be the one on this port (t-08d48066f9).
  let canvasxUp = false;
  try { await listen(canvasx.server, config.ports.canvasx, 'CanvasX'); canvasxUp = true; } catch (e) {
    say(`CanvasX is not served from here: port ${config.ports.canvasx} is in use - if that is CanvasX already, it finds the studio by itself.`);
  }
  /* CanvasXP for the phone, built fresh from CanvasX each start (t-d4739a5f8f).
   * Only the phone needs it, so a port in use is said, not fatal. */
  const xpBuilt = spawnSync(process.execPath, [path.join(ROOT, 'canvasx', 'xp', 'make.js')], { cwd: path.join(ROOT, 'canvasx'), encoding: 'utf8' });
  const phone = createStaticServer({ root: path.join(ROOT, 'canvasx', 'xp', 'site'), port: config.ports.phone });
  let phoneUp = false;
  if (xpBuilt.status !== 0) say(`CanvasXP could not be built: ${(xpBuilt.stderr || xpBuilt.stdout || '').trim().split('\n').pop()}`);
  else {
    try { await listen(phone.server, config.ports.phone, 'CanvasXP'); phoneUp = true; } catch (e) {
      say(`CanvasXP for the phone is not served: port ${config.ports.phone} is in use. If that is CanvasXP already, the phone setup still works.`);
    }
  }

  const url = `http://127.0.0.1:${config.ports.studio}/`;
  console.log(`CanvasX Studio at ${url}`);
  if (canvasxUp) console.log(`  CanvasX    http://127.0.0.1:${config.ports.canvasx}/`);
  if (phoneUp) console.log(`  CanvasXP   http://127.0.0.1:${config.ports.phone}/ (the phone opens it as localhost:${config.ports.phone})`);
  console.log(`  data       ${config.dataDir}`);
  console.log('  Ctrl+C stops everything.');
  if (hold) {
    console.log(gaps.length ? `  Setup is not finished:\n    ${gaps.join('\n    ')}` : '  First run: NoteX and RAGX start from the setup screen.');
  } else {
    // RAGX first: NoteX hands it images and drops once both run.
    firstRun.prepareNotex();
    engines.rag.start();
    engines.notex.start();
  }
  // The portable copy opens CanvasX; a first run opens the setup instead (t-43690a6e2d).
  if (config.open) openBrowser(args.openCanvasx && canvasxUp && !hold ? `http://127.0.0.1:${config.ports.canvasx}/` : url);

  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    console.log('Stopping…');
    await Promise.all(Object.values(engines).map((e) => e.stop().catch(() => {})));
    studio.server.close();
    if (canvasxUp) canvasx.server.close();
    if (phoneUp) phone.server.close();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  process.on('SIGBREAK', stop);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(`\n${e.message}\n`); process.exit(1); });
}
