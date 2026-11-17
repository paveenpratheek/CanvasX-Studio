/* The setup's installers and the portable bundle (t-1edca66f55, t-43690a6e2d). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { installer, installSteps, knownBins, freshPath, checkDeps } from '../studio/deps.js';
import { launcherText, readmeText, nodeZipName, nodeBase } from '../studio/bundle.js';
import { plugins } from '../studio/config.js';
import { parseArgs } from '../studio/start.js';

test('Install runs each program\'s own one-line installer, in a terminal the user watches', () => {
  assert.equal(installer('claude', 'win32'), 'powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://claude.ai/install.ps1 | iex"');
  assert.equal(installer('ollama', 'win32'), 'powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://ollama.com/install.ps1 | iex"');
  assert.equal(installer('claude', 'darwin'), 'curl -fsSL https://claude.ai/install.sh | bash');
  assert.equal(installer('ollama', 'linux'), 'curl -fsSL https://ollama.com/install.sh | sh');
  assert.equal(installer('agy', 'win32'), null); // Antigravity documents no scripted install
  const plugs = plugins('R:/s');
  assert.equal(installSteps('claude-get', { root: 'R:/s', plugs }).terminal, installer('claude'));
  assert.equal(installSteps('ollama-get', { root: 'R:/s', plugs }).title, 'Installing Ollama');
  assert.equal(installSteps('agy-get', { root: 'R:/s', plugs }), null);
});

test('a program installed while the studio runs is found: its folder is added to PATH, once', () => {
  const env = { USERPROFILE: 'C:\\Users\\a', LOCALAPPDATA: 'C:\\Users\\a\\AppData\\Local', Path: 'C:\\Windows' };
  const bins = knownBins(env, 'win32');
  assert.ok(bins.includes(path.join('C:\\Users\\a', '.local', 'bin')));
  assert.ok(bins.includes(path.join('C:\\Users\\a\\AppData\\Local', 'Programs', 'Ollama')));
  const exists = (d) => d.endsWith(path.join('.local', 'bin'));
  assert.deepEqual(freshPath(env, 'win32', exists), [path.join('C:\\Users\\a', '.local', 'bin')]);
  assert.ok(env.Path.endsWith(path.join('C:\\Users\\a', '.local', 'bin')));
  assert.deepEqual(freshPath(env, 'win32', exists), []); // already there
});

test('the Check offers to install Claude Code and Ollama, and asks no Git of a portable copy', async (t) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-bundle-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const list = await checkDeps({ root: d, plugs: plugins(d), nodeVersion: 'v24.1.0', check: async () => null, fetcher: async () => ({ ok: false }), agy: async () => null, platform: 'linux' });
  const by = (id) => list.find((x) => x.id === id);
  assert.equal(by('git'), undefined); // no .git: a portable copy
  assert.deepEqual([by('ollama').install, by('ollama').installAs], [true, 'ollama-get']);
  assert.deepEqual([by('claude').install, by('claude').installAs], [true, 'claude-get']);
  assert.equal(by('agy').install, undefined);
});

test('the portable bundle: its launcher, its note, the Node.js it fetches', () => {
  const cmd = launcherText();
  assert.match(cmd, /^@echo off\r\n/);
  assert.match(cmd, /"%~dp0node\\node\.exe" studio\\start\.js --open-canvasx %\*/);
  assert.ok(!cmd.includes('\n') || cmd.split('\n').every((l, i, a) => i === a.length - 1 || l.endsWith('\r')));
  assert.match(readmeText('v24.18.0'), /Node\.js v24\.18\.0 is in node\\/);
  assert.equal(nodeZipName('v24.18.0'), 'node-v24.18.0-win-x64.zip');
  assert.equal(nodeBase('v24.18.0'), 'https://nodejs.org/dist/v24.18.0');
  assert.equal(parseArgs(['--open-canvasx']).openCanvasx, true);
});
