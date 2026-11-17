/* terminal.open, the studio's way (t-f16266d576).
 *
 * ter-manager types a plugin's command into a terminal pane the user can
 * see and stop. A command that starts the plugin's own engine is the
 * studio's to run - it restarts the engine it manages, with the studio's
 * origin and data folder. Any other command (ollama serve, ollama pull)
 * opens in a terminal window of its own, so the user sees it run and can
 * stop it, as in ter-manager.
 */
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const norm = (s) => String(s || '').replace(/\\/g, '/').replace(/"/g, '').toLowerCase();

/* Is this the command that starts this plugin's engine? Both pages build it
 * from their local.json: node "<repo>/engine/cli.js" ... serve ... */
export function isEngineCommand(cmd, cli) {
  return norm(cmd).includes(norm(cli)) && /(^|\s)serve(\s|$)/.test(String(cmd));
}

/* A window title cmd's start and AppleScript both take as it is. */
export const safeTitle = (t) => String(t || 'CanvasX Studio').replace(/[^\w .()-]/g, '').slice(0, 60) || 'CanvasX Studio';

/* Windows: a small .cmd file, so the command reaches cmd exactly as the
 * page wrote it, with no second layer of quoting. */
export function windowsScript({ cwd, cmd, title }) {
  const lines = ['@echo off', `title ${safeTitle(title)}`];
  if (cwd) lines.push(`cd /d "${String(cwd).replace(/"/g, '')}"`);
  lines.push(String(cmd));
  return lines.join('\r\n') + '\r\n';
}

export function openTerminal({ cwd, cmd, title }, { platform = process.platform, run = spawn } = {}) {
  const where = cwd && fs.existsSync(cwd) ? cwd : os.homedir();
  return new Promise((resolve, reject) => {
    let child;
    try {
      if (platform === 'win32') {
        const file = path.join(os.tmpdir(), `notex-studio-${crypto.randomBytes(4).toString('hex')}.cmd`);
        fs.writeFileSync(file, windowsScript({ cwd: where, cmd, title }));
        child = run('cmd.exe', ['/d', '/s', '/c', `"start "${safeTitle(title)}" cmd.exe /k "${file}""`], { detached: true, stdio: 'ignore', windowsVerbatimArguments: true });
        // cmd has read it long before this.
        setTimeout(() => fs.rm(file, { force: true }, () => {}), 60_000).unref();
      } else if (platform === 'darwin') {
        const q = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        const sh = `cd '${String(where).replace(/'/g, "'\\''")}' && ${cmd}`;
        child = run('osascript', ['-e', `tell application "Terminal" to do script "${q(sh)}"`, '-e', 'tell application "Terminal" to activate'], { detached: true, stdio: 'ignore' });
      } else {
        child = run('x-terminal-emulator', ['-T', safeTitle(title), '-e', 'bash', '-c', `${cmd}; exec bash`], { cwd: where, detached: true, stdio: 'ignore' });
      }
    } catch (e) { reject(e); return; }
    child.on('error', (e) => reject(new Error(`no terminal could be opened (${e.message}) - run it yourself: ${cmd}`)));
    child.on('spawn', () => { child.unref(); resolve({ opened: true }); });
  });
}
