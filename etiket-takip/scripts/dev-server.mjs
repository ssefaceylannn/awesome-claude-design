// Yerel geliştirme sunucusu: Netlify CLI olmadan uygulamayı çalıştırır.
//   USERS="admin:admin123:admin,personel:personel123:personel" npm run dev
// Netlify Blobs yerine .dev-data klasörünü kullanan resmi yerel Blobs sunucusu
// başlatılır; edge (giriş kapısı) ve API fonksiyonu Netlify'daki gibi çağrılır.
import http from 'node:http';
import { readFile, stat, mkdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BlobsServer } from '@netlify/blobs/server';

const root = fileURLToPath(new URL('..', import.meta.url));
const pub = join(root, 'public');
const port = +(process.env.PORT || 8888);
const dataDir = process.env.DEV_DATA || join(root, '.dev-data');
await mkdir(dataDir, { recursive: true });

const blobs = new BlobsServer({ directory: dataDir, token: 'dev', port: 0 });
const { port: bport } = await blobs.start();
process.env.BLOBS_LOCAL_URL = `http://127.0.0.1:${bport}`;
process.env.USERS ??= 'admin:admin123:admin,personel:personel123:personel,izleyici:izleyici123:izleyici';
process.env.AUTH_SECRET ??= 'yerel-gelistirme-anahtari-degistirin';
globalThis.Netlify = { env: { get: (k) => process.env[k] } };

const api = (await import('../netlify/functions/api.mjs')).default;
const gateMod = await import('../netlify/edge-functions/auth-gate.js');
const gate = gateMod.default;
const excluded = gateMod.config.excludedPath.map((p) => new RegExp('^' + p.replace(/[.]/g, '\\.').replace(/\*/g, '.*') + '$'));

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon' };

async function toRequest(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const url = `http://${req.headers.host}${req.url}`;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
  return new Request(url, { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks) });
}

async function send(res, r) {
  const h = {};
  r.headers.forEach((v, k) => { h[k] = v; });
  res.writeHead(r.status, h);
  res.end(Buffer.from(await r.arrayBuffer()));
}

http.createServer(async (req, res) => {
  try {
    const request = await toRequest(req);
    const url = new URL(request.url);
    if (!excluded.some((re) => re.test(url.pathname))) {
      const r = await gate(request.clone());
      if (r) return send(res, r);
    }
    if (url.pathname.startsWith('/api/')) return send(res, await api(request));
    let p = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
    if (p.endsWith('/')) p += 'index.html';
    const file = join(pub, p);
    if (!file.startsWith(pub)) throw new Error('yol');
    const s = await stat(file).catch(() => null);
    if (!s || !s.isFile()) { res.writeHead(404); return res.end('Bulunamadı'); }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(await readFile(file));
  } catch (e) {
    console.error(e);
    res.writeHead(500);
    res.end(String(e));
  }
}).listen(port, () => console.log(`Etiket Takip: http://localhost:${port}  (veri: ${dataDir})`));
