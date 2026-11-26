// Mini-Webserver zum lokalen Testen. Bildet GitHub Pages nach: http://localhost:5173/ToDo/
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../public');
const port = Number(process.env.PORT) || 5173;
const base = '/ToDo/';
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json',
};

http
  .createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/' || url.pathname === '/ToDo') {
      res.writeHead(302, { Location: base });
      return res.end();
    }
    if (!url.pathname.startsWith(base)) {
      res.writeHead(404);
      return res.end('Not found');
    }
    let rel = decodeURIComponent(url.pathname.slice(base.length)) || 'index.html';
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.join(root, rel);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      return res.end('Not found');
    }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  })
  .listen(port, () => console.log(`ToDo läuft lokal auf http://localhost:${port}${base}`));
