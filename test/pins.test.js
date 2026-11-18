/* RAGX's pinned conversations reach CanvasX's sidebar through /api/hello,
 * and the studio page's through its status (t-1b6a07a0c5). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { loadConfig, plugins } from '../studio/config.js';
import { createStudioServer, listen } from '../studio/host.js';

const freePort = async () => {
  const probe = http.createServer();
  await new Promise((r) => probe.listen(0, '127.0.0.1', r));
  const { port } = probe.address();
  await new Promise((r) => probe.close(r));
  return port;
};

test("CanvasX and the studio page learn RAGX's pinned conversations, ids and titles only", async (t) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-pins-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  // A stand-in RAGX: one pinned conversation, one not.
  let asked = 0;
  const rag = http.createServer((req, res) => {
    if (req.headers['x-rag-token'] !== 'rt' || req.url !== '/api/conversations') { res.writeHead(401); return res.end(); }
    asked += 1;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ conversations: [
      { id: 7, title: 'what is the price', pinned_at: '2026-11-18T06:00:00Z', session: 'secret-session', agent: 'claude' },
      { id: 8, title: 'not pinned', pinned_at: null },
    ] }));
  });
  await new Promise((r) => rag.listen(0, '127.0.0.1', r));
  t.after(() => rag.close());
  const ragUrl = `http://127.0.0.1:${rag.address().port}`;

  const port = await freePort();
  const config = loadConfig({ file: path.join(d, 'none.json'), overrides: { dataDir: path.join(d, 'data'), ports: { studio: port, ragx: port + 1, notex: port + 2, canvasx: port + 3 } } });
  const ragEngine = { spec: { id: 'rag', label: 'RAGX', tokenHeader: 'x-rag-token' }, state: 'running', runtime: () => ({ url: ragUrl, token: 'rt' }), snapshot: () => ({ id: 'rag', state: 'running' }) };
  const s = createStudioServer({ config, plugs: plugins(d), engines: { rag: ragEngine }, token: 'tok', launcher: async () => false });
  await listen(s.server, port, 'test');
  t.after(() => s.server.close());

  const cx = `http://127.0.0.1:${port + 3}`;
  const hi = await (await fetch(`http://127.0.0.1:${port}/api/hello`, { headers: { origin: cx } })).json();
  assert.deepEqual(hi.pins, [{ id: 7, title: 'what is the price' }]);
  const st = await (await fetch(`http://127.0.0.1:${port}/api/host/status`, { headers: { 'x-studio-token': 'tok' } })).json();
  assert.deepEqual(st.pins, [{ id: 7, title: 'what is the price' }]);
  assert.equal(asked, 1); // asked of RAGX at most every 2 s

  // A RAGX that is not running has nothing pinned.
  ragEngine.state = 'stopped';
  const off = await (await fetch(`http://127.0.0.1:${port}/api/hello`, { headers: { origin: cx } })).json();
  assert.deepEqual(off.pins, []);
});
