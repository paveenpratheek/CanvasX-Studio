/* The canvasx-studio:// link handler, so CanvasX's Start the server can
 * start the studio (t-41a81632a9). A web page cannot start a program; a link
 * the user's own Windows account hands to studio/launch.js can, and the
 * browser asks the user before it opens one.
 *
 * Registered only when the user presses Install on its line in the setup's
 * Check, for this user alone (HKCU\Software\Classes) - nothing machine-wide
 * and no administrator. Windows only for now.
 */
import { execFile } from 'node:child_process';
import path from 'node:path';
import { ROOT } from './config.js';

export const KEY = 'HKCU\\Software\\Classes\\canvasx-studio';
const reg = () => path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'reg.exe');

/* The command Windows runs for canvasx-studio://...: this node, launch.js, the link. */
export const handlerCommand = (root = ROOT, node = process.execPath) => `"${node}" "${path.join(root, 'studio', 'launch.js')}" "%1"`;

/* reg add, three times: the scheme, that it is a URL protocol, its command. */
export function registerSteps(root = ROOT, node = process.execPath) {
  const exe = reg();
  return [
    [exe, ['add', KEY, '/ve', '/d', 'URL:CanvasX Studio', '/f'], root],
    [exe, ['add', KEY, '/v', 'URL Protocol', '/d', '', '/f'], root],
    [exe, ['add', `${KEY}\\shell\\open\\command`, '/ve', '/d', handlerCommand(root, node), '/f'], root],
  ];
}

/* Whether this copy of the studio is the handler now. */
export function registered({ root = ROOT, platform = process.platform, exec = execFile } = {}) {
  if (platform !== 'win32') return Promise.resolve(false);
  return new Promise((resolve) => {
    exec(reg(), ['query', `${KEY}\\shell\\open\\command`, '/ve'], { windowsHide: true, timeout: 5000, encoding: 'utf8' }, (err, out) => {
      resolve(!err && String(out || '').toLowerCase().includes(path.join(root, 'studio', 'launch.js').toLowerCase()));
    });
  });
}
