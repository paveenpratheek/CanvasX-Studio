/* npm run bundle: a portable CanvasX Studio for Windows x64 that runs with
 * nothing installed (t-43690a6e2d) - unzip it and double-click
 * "CanvasX Studio.cmd".
 *
 *   node studio/bundle.js [--node v24.18.0] [--out dist] [--no-zip]
 *
 * In it:
 *   node/node.exe        the official Node.js runtime from nodejs.org,
 *                        checked against its published SHA-256
 *   studio/, notex/, ragx/, canvasx/
 *                        the code as committed (git archive of HEAD and of
 *                        each submodule's checked-out commit), so nothing
 *                        uncommitted, ignored or private - no runtime.json,
 *                        no local.json, no studio.config.json - goes in
 *   ragx/node_modules    RAGX's packages, installed for Windows x64
 *   CanvasX Studio.cmd   starts it with the bundled node and opens CanvasX
 *
 * Not in it: the agents (Claude Code, Antigravity) and Ollama, which need
 * their own installs - and the agents the user's own sign-in. The setup's
 * Check and Agent screens install Claude Code and Ollama when asked
 * (t-1edca66f55). Built on Windows, for Windows x64: RAGX's canvas package
 * is native code, so one bundle serves one kind of PC.
 */
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT } from './config.js';

export const NAME = 'CanvasX Studio';
export const PROJECTS = ['notex', 'ragx', 'canvasx'];

export const nodeZipName = (version) => `node-${version}-win-x64.zip`;
export const nodeBase = (version) => `https://nodejs.org/dist/${version}`;

/* What the friend double-clicks. %~dp0 is the folder the file is in. */
export function launcherText() {
  return [
    '@echo off',
    `title ${NAME}`,
    'cd /d "%~dp0"',
    'echo Starting CanvasX Studio - your browser opens when it is ready. Close this window to stop it.',
    '"%~dp0node\\node.exe" studio\\start.js --open-canvasx %*',
    'echo.',
    'pause',
    '',
  ].join('\r\n');
}

export function readmeText(version) {
  return [
    `${NAME} - portable, for Windows x64`,
    '',
    'Start: double-click "CanvasX Studio.cmd". Keep its window open while you use',
    'it; closing the window stops it. The first time, your browser opens the',
    "setup: it checks this PC, installs Ollama and Claude Code if you ask it to,",
    'lets you choose the agent and sign in, and starts NoteX and RAGX.',
    '',
    'Then CanvasX is at http://127.0.0.1:9075 - open it in Chrome or Edge.',
    '',
    `Nothing else needs installing to start it: Node.js ${version} is in node\\.`,
    'For the agents you need Claude Code or Google Antigravity, signed in with',
    'your own account; for search by meaning, Ollama. The setup offers both.',
    '',
    'Windows may warn that the file is from the internet ("Windows protected',
    'your PC"): choose More info, then Run anyway.',
    '',
    'Your data is kept in "CanvasX Studio" in your home folder; your canvases',
    'in the folder you choose. To remove it, delete this folder and that one.',
    '',
    'Source: https://github.com/paveenpratheek/CanvasX-Studio',
    '',
  ].join('\r\n');
}

function run(cmd, args, opts = {}) {
  const shell = process.platform === 'win32' && !path.isAbsolute(cmd) && cmd !== 'git' && cmd !== 'tar';
  const r = shell
    ? spawnSync([cmd, ...args].map((a) => (/[\s"&|<>^()]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a)).join(' '), { ...opts, shell: true, encoding: 'utf8' })
    : spawnSync(cmd, args, { ...opts, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed: ${(r.stderr || r.stdout || r.error || '').toString().trim().split('\n').pop()}`);
  return r.stdout;
}

const say = (s) => console.log(`  ${s}`);

/* The code as committed: HEAD of the studio and of each submodule. */
function exportCode(out, cache) {
  const tar = path.join(cache, 'code.tar');
  const dirty = run('git', ['status', '--porcelain', '--ignore-submodules=none'], { cwd: ROOT }).trim();
  if (dirty) say(`Not committed, so not in the bundle:\n    ${dirty.split('\n').join('\n    ')}`);
  run('git', ['archive', '--format=tar', '-o', tar, 'HEAD'], { cwd: ROOT });
  run('tar', ['-xf', tar, '-C', out]);
  for (const p of PROJECTS) {
    const dir = path.join(ROOT, p);
    if (!fs.existsSync(path.join(dir, '.git'))) throw new Error(`${p} is not fetched - run: git submodule update --init --recursive`);
    fs.mkdirSync(path.join(out, p), { recursive: true });
    run('git', ['archive', '--format=tar', '-o', tar, 'HEAD'], { cwd: dir });
    run('tar', ['-xf', tar, '-C', path.join(out, p)]);
    say(`${p} at ${run('git', ['rev-parse', '--short', 'HEAD'], { cwd: dir }).trim()}`);
  }
  fs.rmSync(tar, { force: true });
}

/* The official Node.js for Windows x64, checked against nodejs.org's SHASUMS256.txt. */
async function fetchNode(version, cache) {
  const zip = path.join(cache, nodeZipName(version));
  const sums = await (await fetch(`${nodeBase(version)}/SHASUMS256.txt`)).text();
  const want = (sums.split('\n').find((l) => l.trim().endsWith(nodeZipName(version))) || '').split(/\s+/)[0];
  if (!want) throw new Error(`nodejs.org lists no ${nodeZipName(version)} - choose another version with --node.`);
  const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
  if (!fs.existsSync(zip) || sha(zip) !== want) {
    say(`Downloading ${nodeZipName(version)} from nodejs.org…`);
    const r = await fetch(`${nodeBase(version)}/${nodeZipName(version)}`);
    if (!r.ok) throw new Error(`nodejs.org answered ${r.status} for ${nodeZipName(version)}.`);
    fs.writeFileSync(zip, Buffer.from(await r.arrayBuffer()));
  }
  if (sha(zip) !== want) throw new Error(`${nodeZipName(version)} does not match nodejs.org's SHA-256 - not used.`);
  say(`Node.js ${version}: SHA-256 matches nodejs.org`);
  const unpacked = path.join(cache, `node-${version}-win-x64`);
  if (!fs.existsSync(path.join(unpacked, 'node.exe'))) run('tar', ['-xf', zip, '-C', cache]);
  return unpacked;
}

export async function bundle({ version = process.version, outRoot = path.join(ROOT, 'dist'), zip = true } = {}) {
  if (process.platform !== 'win32') throw new Error('The portable bundle is built on Windows, for Windows x64.');
  const out = path.join(outRoot, NAME);
  const cache = path.join(outRoot, '.cache');
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  fs.mkdirSync(cache, { recursive: true });
  console.log(`Building ${out}`);

  exportCode(out, cache);

  say("Installing RAGX's packages for Windows x64…");
  const ragx = path.join(out, 'ragx');
  run('npm', [fs.existsSync(path.join(ragx, 'package-lock.json')) ? 'ci' : 'install', '--omit=dev', '--no-audit', '--no-fund'], { cwd: ragx });

  const node = await fetchNode(version, cache);
  fs.mkdirSync(path.join(out, 'node'), { recursive: true });
  fs.copyFileSync(path.join(node, 'node.exe'), path.join(out, 'node', 'node.exe'));
  fs.copyFileSync(path.join(node, 'LICENSE'), path.join(out, 'node', 'LICENSE'));

  fs.writeFileSync(path.join(out, `${NAME}.cmd`), launcherText());
  fs.writeFileSync(path.join(out, 'README-FIRST.txt'), readmeText(version));

  let zipFile = null;
  if (zip) {
    zipFile = path.join(outRoot, `${NAME}-win-x64.zip`);
    fs.rmSync(zipFile, { force: true });
    say('Zipping…');
    run('tar', ['-a', '-cf', zipFile, '-C', outRoot, NAME]);
  }
  console.log(`Ready: ${out}${zipFile ? `\n       ${zipFile} (${(fs.statSync(zipFile).size / 1e6).toFixed(0)} MB)` : ''}`);
  return { out, zip: zipFile };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  bundle({ version: opt('--node') || process.version, outRoot: opt('--out') ? path.resolve(opt('--out')) : undefined, zip: !args.includes('--no-zip') })
    .catch((e) => { console.error(`\n${e.message}\n`); process.exit(1); });
}
