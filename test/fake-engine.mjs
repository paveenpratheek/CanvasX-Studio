// An engine as the studio sees one: writes runtime.json, answers /api/state
// with its token, stops on /api/shutdown removing runtime.json.
//   node fake-engine.mjs <runtime.json> [crash|slow-stop|silent]
import fs from 'node:fs';
import http from 'node:http';
import crypto from 'node:crypto';

const [file, mode = ''] = process.argv.slice(2);
if (mode === 'crash') { console.error('boom: no workspace'); process.exit(3); }
const token = crypto.randomBytes(8).toString('hex');
const server = http.createServer((req, res) => {
  if (req.headers['x-test-token'] !== token) { res.writeHead(401); return res.end('{}'); }
  if (req.url === '/api/state') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"ok":true}'); }
  if (req.url === '/api/shutdown' && req.method === 'POST') {
    res.writeHead(200); res.end('{}');
    if (mode === 'slow-stop') return; // ignores it
    fs.rmSync(file, { force: true });
    setTimeout(() => process.exit(0), 20);
    return;
  }
  res.writeHead(404); res.end('{}');
});
server.listen(0, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${server.address().port}`;
  if (mode !== 'silent') fs.writeFileSync(file, JSON.stringify({ url, token, pid: process.pid }));
  console.log(`fake engine at ${url}`);
});
