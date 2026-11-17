/* canvasx-studio://start, opened from CanvasX's Start the server
 * (t-41a81632a9): Windows runs this through the link handler the setup
 * registered (studio/launcher.js), and it starts CanvasX Studio in a
 * terminal window the user can see and stop - unless it already runs.
 *
 *   node studio/launch.js canvasx-studio://start
 *
 * It takes only that one link; anything else a page might put after
 * canvasx-studio:// is ignored.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, loadConfig } from './config.js';
import { openTerminal } from './terminal.js';

export const START_LINK = /^canvasx-studio:\/*start\/?$/i;

export async function launch(arg, { config = loadConfig(), open = openTerminal, probe = fetch } = {}) {
  if (!START_LINK.test(String(arg || '').trim())) return { started: false, why: 'not the start link' };
  try {
    await probe(`http://127.0.0.1:${config.ports.studio}/favicon.ico`, { method: 'HEAD', signal: AbortSignal.timeout(1500) });
    return { started: false, why: 'already running' };
  } catch (_) { /* not running: start it */ }
  const cmd = `"${process.execPath}" "${path.join(ROOT, 'studio', 'start.js')}" --no-open`;
  await open({ cwd: ROOT, cmd, title: 'CanvasX Studio' });
  return { started: true };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  launch(process.argv[2]).catch(() => process.exit(1));
}
