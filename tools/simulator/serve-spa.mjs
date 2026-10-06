// A tiny local server for the app's web export: static files, and any unknown path falls back to the app's index.
//   node tools/simulator/serve-spa.mjs <folder that contains doddily/> [port]
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const root = process.argv[2], T = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
http.createServer((q, r) => { let p = decodeURIComponent(new URL(q.url, 'http://x').pathname); let f = path.join(root, p);
  if (!f.startsWith(root)) return r.writeHead(403).end();
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { const h = f.replace(/\/$/, '') + '.html', i = path.join(f, 'index.html'); f = fs.existsSync(h) ? h : fs.existsSync(i) ? i : path.join(root, 'doddily', 'index.html'); }
  r.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); }).listen(Number(process.argv[3] || 8266), '127.0.0.1', function () { console.log('serving on ' + this.address().port); });
