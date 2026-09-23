// Netlify Blobs erişimi + iyimser eşzamanlılık (etag) ile güvenli güncelleme.
import { getStore } from '@netlify/blobs';

let cached = null;

export function store() {
  if (cached) return cached;
  if (process.env.BLOBS_LOCAL_URL) {
    // Yerel geliştirme / test (scripts/dev-server.mjs)
    cached = getStore({ name: 'etiket-takip', siteID: 'local', token: 'dev', apiURL: process.env.BLOBS_LOCAL_URL });
  } else {
    cached = getStore({ name: 'etiket-takip', consistency: 'strong' });
  }
  return cached;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function getJSON(key, fallback = null) {
  const v = await store().get(key, { type: 'json' });
  return v == null ? fallback : v;
}

export const setJSON = (key, value) => store().setJSON(key, value);
export const del = (key) => store().delete(key);

export async function listKeys(prefix) {
  const out = [];
  // Yerel Blobs sunucusu prefix filtresini desteklemiyor; orada tümünü listeleyip süz.
  const opts = process.env.BLOBS_LOCAL_URL ? { paginate: true } : { prefix, paginate: true };
  for await (const page of store().list(opts)) for (const b of page.blobs) if (b.key.startsWith(prefix)) out.push(b.key);
  return out;
}

/**
 * Anahtarı oku → fn(mevcut) ile yeni değeri üret → yalnızca arada başkası
 * yazmadıysa kaydet. Çakışmada tekrar dener. fn undefined döndürürse yazılmaz.
 */
export async function update(key, fn, fallback = null, tries = 8) {
  for (let i = 0; i < tries; i++) {
    const cur = await store().getWithMetadata(key, { type: 'json' });
    const base = cur ? cur.data : typeof fallback === 'function' ? fallback() : structuredClone(fallback);
    const next = await fn(base);
    if (next === undefined) return base;
    let res;
    if (!cur) res = await store().setJSON(key, next, { onlyIfNew: true });
    else if (cur.etag) res = await store().setJSON(key, next, { onlyIfMatch: cur.etag });
    else res = await store().setJSON(key, next); // etag dönmeyen ortam (yerel test sunucusu)
    if (res.modified) return next;
    await sleep(40 * 2 ** i + Math.random() * 60);
  }
  throw Object.assign(new Error('Kayıt şu an başka bir kullanıcı tarafından güncelleniyor, lütfen tekrar deneyin.'), { status: 409 });
}

/** Sınırlı eşzamanlılıkla map */
export async function pmap(list, limit, fn) {
  const out = new Array(list.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, list.length) }, async () => {
    while (i < list.length) {
      const j = i++;
      out[j] = await fn(list[j], j);
    }
  });
  await Promise.all(workers);
  return out;
}
