// Minimal static file server for browser tests (no external dependencies).
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.md': 'text/markdown' };

export function startServer(port = 0) {
  const server = http.createServer(async (req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
    if (path.startsWith('..')) { res.writeHead(403).end(); return; }
    try {
      const body = await readFile(join(root, path || 'index.html'));
      res.writeHead(200, { 'content-type': types[extname(path)] || 'application/octet-stream' }).end(body);
    } catch { res.writeHead(404).end('not found'); }
  });
  return new Promise(r => server.listen(port, '127.0.0.1', () => r({ server, url: `http://127.0.0.1:${server.address().port}/` })));
}
