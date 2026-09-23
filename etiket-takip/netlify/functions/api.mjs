// Etiket Takip API — tüm /api/* istekleri buradan geçer.
import { webcrypto } from 'node:crypto';
import { COOKIE, getSecret, parseUsers, readCookie, safeEqual, signToken, verifyToken } from '../lib/auth.js';
import { del, getJSON, listKeys, pmap, setJSON, update } from '../lib/store.js';
import { fold, hashStr, isYmd, orderKey } from '../../public/assets/js/shared/text.js';
import { DEFAULT_NOISE } from '../../public/assets/js/shared/matcher.js';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const env = (k) => globalThis.Netlify?.env?.get(k) ?? process.env[k];
const BUCKETS = 64;
const bucketKey = (orderNo) => 'idx/' + String(hashStr(String(orderNo).trim()) % BUCKETS).padStart(2, '0');
const PLATFORMS = ['trendyol', 'ikas', 'shopify', 'hepsiburada', 'n11', 'amazon', 'pazarama', 'ciceksepeti', 'diger'];

const DEFAULT_CONFIG = () => ({
  stores: [],
  products: [],
  campaigns: [],
  aliases: {},
  settings: { retentionDays: 365, noiseWords: DEFAULT_NOISE, companyName: '' },
  updatedAt: null,
  updatedBy: null,
});

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });

const todayTR = () => new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10); // Türkiye UTC+3
const addDays = (ymd, n) => { const d = new Date(ymd + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const nowIso = () => new Date().toISOString();

// ------------------------------------------------------------------ doğrulama
const str = (v, max = 200) => String(v ?? '').slice(0, max).trim();
const id = (v) => (/^[a-z0-9_-]{1,40}$/i.test(String(v)) ? String(v) : null);
const ymdOrEmpty = (v) => (isYmd(v) ? v : '');
const int = (v, min, max, def) => { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def; };

const SANITIZE = {
  stores: (arr) => {
    if (!Array.isArray(arr)) throw new HttpError(400, 'Geçersiz mağaza listesi');
    return arr.slice(0, 200).map((s) => {
      if (!id(s.id)) throw new HttpError(400, 'Geçersiz mağaza kimliği');
      return {
        id: s.id,
        name: str(s.name, 80) || 'Adsız mağaza',
        platform: PLATFORMS.includes(s.platform) ? s.platform : 'diger',
        senders: (Array.isArray(s.senders) ? s.senders : []).map((x) => str(x, 120)).filter(Boolean).slice(0, 20),
        color: /^#[0-9a-f]{6}$/i.test(s.color) ? s.color : '#64748b',
        code: str(s.code, 20),
        note: str(s.note, 500),
        active: s.active !== false,
      };
    });
  },
  products: (arr) => {
    if (!Array.isArray(arr)) throw new HttpError(400, 'Geçersiz ürün listesi');
    return arr.slice(0, 1000).map((p) => {
      if (!id(p.id)) throw new HttpError(400, 'Geçersiz ürün kimliği');
      return {
        id: p.id,
        name: str(p.name, 120) || 'Adsız ürün',
        sku: str(p.sku, 60),
        category: str(p.category, 60),
        unit: str(p.unit, 20) || 'adet',
        keywords: str(p.keywords, 1000),
        exclude: str(p.exclude, 300),
        packMultiplier: !!p.packMultiplier,
        active: p.active !== false,
      };
    });
  },
  campaigns: (arr) => {
    if (!Array.isArray(arr)) throw new HttpError(400, 'Geçersiz kampanya listesi');
    return arr.slice(0, 500).map((c) => {
      if (!id(c.id)) throw new HttpError(400, 'Geçersiz kampanya kimliği');
      return {
        id: c.id,
        name: str(c.name, 120) || 'Adsız kampanya',
        note: str(c.note, 500),
        active: !!c.active,
        archived: !!c.archived,
        storeIds: (Array.isArray(c.storeIds) ? c.storeIds : []).filter(id).slice(0, 200),
        platforms: (Array.isArray(c.platforms) ? c.platforms : []).filter((p) => PLATFORMS.includes(p)),
        triggerProductIds: (Array.isArray(c.triggerProductIds) ? c.triggerProductIds : []).filter(id).slice(0, 200),
        minQty: int(c.minQty, 1, 9999, 1),
        rewardQty: int(c.rewardQty, 1, 9999, 1),
        rewardProductId: c.rewardProductId && id(c.rewardProductId) ? c.rewardProductId : '',
        countMode: c.countMode === 'sum' ? 'sum' : 'each',
        mode: c.mode === 'once' ? 'once' : 'every',
        start: ymdOrEmpty(c.start),
        end: ymdOrEmpty(c.end),
        createdAt: str(c.createdAt, 40) || nowIso(),
        createdBy: str(c.createdBy, 60),
      };
    });
  },
  aliases: (obj) => {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new HttpError(400, 'Geçersiz eşleştirme listesi');
    const out = {};
    for (const [k, v] of Object.entries(obj).slice(0, 20000)) {
      const key = fold(k);
      if (!key || !v || !(id(v.productId) || v.productId === '__ignore')) continue;
      out[key] = { productId: v.productId, multiplier: int(v.multiplier, 1, 1000, 1), by: str(v.by, 60), at: str(v.at, 40) };
    }
    return out;
  },
  settings: (s) => ({
    retentionDays: int(s && s.retentionDays, 30, 3650, 365),
    noiseWords: (Array.isArray(s && s.noiseWords) ? s.noiseWords : DEFAULT_NOISE).map((w) => str(w, 40)).filter(Boolean).slice(0, 500),
    companyName: str(s && s.companyName, 80),
  }),
};

// ------------------------------------------------------------------ yardımcılar
async function audit(user, action, detail) {
  const month = todayTR().slice(0, 7);
  try {
    await update(`audit/${month}`, (list) => {
      list.push({ at: nowIso(), user: user ? user.u : 'sistem', action, detail: str(detail, 500) });
      return list.slice(-5000);
    }, []);
  } catch (e) {
    console.error('audit', e);
  }
}

async function getConfig() {
  const c = await getJSON('config');
  return c ? { ...DEFAULT_CONFIG(), ...c, settings: { ...DEFAULT_CONFIG().settings, ...(c.settings || {}) } } : DEFAULT_CONFIG();
}

async function session(req) {
  const secret = await getSecret(env);
  const tok = readCookie(req.headers.get('cookie'), COOKIE);
  const s = await verifyToken(tok, secret);
  if (!s) return null;
  // Kullanıcı USERS listesinden silindiyse veya rolü değiştiyse oturumu geçersiz say
  const u = parseUsers(env('USERS')).find((x) => x.username === s.u);
  if (!u) return null;
  return { u: u.username, r: u.role };
}

const need = (user, ...roles) => {
  if (!user) throw new HttpError(401, 'Oturum açmanız gerekiyor');
  if (roles.length && !roles.includes(user.r)) throw new HttpError(403, 'Bu işlem için yetkiniz yok');
};

async function body(req) {
  const ct = req.headers.get('content-type') || '';
  if (!ct.includes('application/json')) throw new HttpError(415, 'JSON bekleniyor');
  try { return await req.json(); } catch { throw new HttpError(400, 'Geçersiz JSON'); }
}

function cookie(value, maxAge) {
  return `${COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

// ------------------------------------------------------------------ oturum
async function login(req) {
  const users = parseUsers(env('USERS'));
  if (req.method === 'GET') return json({ configured: users.length > 0 });
  const b = await body(req);
  const username = str(b.username, 60).toLocaleLowerCase('tr-TR');
  const password = String(b.password ?? '');
  if (!users.length) throw new HttpError(503, 'Netlify ortam değişkenlerinde USERS tanımlı değil');

  const lockKey = 'auth/' + (fold(username) || '_');
  const lock = await getJSON(lockKey, { fails: 0, until: 0 });
  if (lock.until > Date.now()) {
    const min = Math.ceil((lock.until - Date.now()) / 60000);
    throw new HttpError(429, `Çok fazla hatalı deneme. ${min} dakika sonra tekrar deneyin.`);
  }
  const u = users.find((x) => x.username === username);
  const ok = u ? safeEqual(u.password, password) : (safeEqual('x'.repeat(password.length), password + '!'), false);
  if (!ok) {
    const fails = lock.fails + 1;
    await setJSON(lockKey, { fails: fails >= 5 ? 0 : fails, until: fails >= 5 ? Date.now() + 5 * 60e3 : 0 });
    await new Promise((r) => setTimeout(r, 400));
    throw new HttpError(401, 'Kullanıcı adı veya şifre hatalı');
  }
  if (lock.fails) await del(lockKey);
  const maxAge = b.remember ? 30 * 86400 : 12 * 3600;
  const token = await signToken({ u: u.username, r: u.role, exp: Date.now() + maxAge * 1000 }, await getSecret(env));
  await audit({ u: u.username }, 'giriş', b.remember ? 'Beni hatırla' : '');
  return json({ user: { username: u.username, role: u.role } }, 200, { 'set-cookie': cookie(token, maxAge) });
}

// ------------------------------------------------------------------ içe aktarma
function sanitizeOrder(o) {
  const items = (Array.isArray(o.items) ? o.items : [])
    .map((it) => ({ name: str(it.name, 200), qty: int(it.qty, 1, 100000, 1) }))
    .filter((it) => it.name)
    .slice(0, 200);
  return {
    orderNo: str(o.orderNo, 60).replace(/\s+/g, ''),
    sender: str(o.sender, 120),
    platform: fold(o.platform).replace(/\s/g, '').slice(0, 30),
    recipient: str(o.recipient, 120),
    city: str(o.city, 80),
    cargo: str(o.cargo, 60),
    cargoCode: str(o.cargoCode, 60).replace(/\s+/g, ''),
    items,
    pages: int(o.pages, 1, 100, 1),
    file: str(o.file, 200),
    date: isYmd(o.date) ? o.date : todayTR(),
    startsAsContinuation: !!o.startsAsContinuation,
    orphan: !!o.orphan,
  };
}

function mergeItems(target, items) {
  for (const it of items) {
    const ex = target.items.find((x) => x.name === it.name);
    if (ex) ex.qty += it.qty;
    else target.items.push({ name: it.name, qty: it.qty });
  }
}

async function importOrders(req, user) {
  const b = await body(req);
  if (!Array.isArray(b.orders)) throw new HttpError(400, 'orders listesi gerekli');
  if (b.orders.length > 3000) throw new HttpError(413, 'Tek seferde en fazla 3000 sipariş yüklenebilir');
  const orders = b.orders.map(sanitizeOrder);
  const dryRun = !!b.dryRun;

  // Mevcut kayıtları dizinden oku
  const buckets = new Map();
  for (const o of orders) if (!o.orphan && o.orderNo) buckets.set(bucketKey(o.orderNo), null);
  await pmap([...buckets.keys()], 16, async (k) => buckets.set(k, await getJSON(k, {})));
  const lastOrder = await getJSON('meta/last-order');

  const seen = new Set();
  const results = orders.map((o, i) => {
    if (o.orphan) return { i, status: lastOrder ? 'merge' : 'error', target: lastOrder, note: lastOrder ? 'Önceki yüklemedeki son siparişin devamı' : 'Devam etiketinin ait olduğu sipariş bulunamadı' };
    if (!o.orderNo) return { i, status: 'error', note: 'Sipariş numarası yok' };
    const k = orderKey(o.sender, o.orderNo);
    const existingDate = buckets.get(bucketKey(o.orderNo))[k];
    if (seen.has(k)) return { i, k, status: 'dup', note: 'Aynı yüklemede tekrar ediyor' };
    seen.add(k);
    if (existingDate) {
      return o.startsAsContinuation
        ? { i, k, status: 'merge', target: { k, date: existingDate }, note: 'Önceki etiketin devamı, mevcut siparişe eklenecek' }
        : { i, k, status: 'dup', existingDate, note: `Daha önce ${existingDate} tarihinde kaydedilmiş` };
    }
    return { i, k, status: 'new' };
  });
  if (dryRun) return json({ results });
  need(user, 'admin', 'personel');

  const batchId = new Date().toISOString().replace(/[-:.TZ]/g, '') + '-' + Math.random().toString(36).slice(2, 6);
  const at = nowIso();

  // 1) Yeni siparişleri dizinde "sahiplen" (eşzamanlı yüklemede aynı sipariş iki kez yazılmasın)
  const newRes = results.filter((r) => r.status === 'new');
  const byBucket = new Map();
  for (const r of newRes) {
    const bk = bucketKey(orders[r.i].orderNo);
    if (!byBucket.has(bk)) byBucket.set(bk, []);
    byBucket.get(bk).push(r);
  }
  await pmap([...byBucket.entries()], 12, async ([bk, rs]) => {
    await update(bk, (idx) => {
      for (const r of rs) {
        if (idx[r.k]) { r.status = 'dup'; r.existingDate = idx[r.k]; r.note = 'Başka bir kullanıcı az önce kaydetti'; }
        else idx[r.k] = orders[r.i].date;
      }
      return idx;
    }, {});
  });

  // 2) Gün kayıtlarına yaz
  const dayAdds = new Map();
  const dayMerges = new Map();
  let lastKey = null;
  for (const r of results) {
    const o = orders[r.i];
    if (r.status === 'new') {
      const rec = {
        k: r.k, no: o.orderNo, sender: o.sender, platform: o.platform, recipient: o.recipient, city: o.city,
        cargo: o.cargo, cargoCode: o.cargoCode, items: o.items, pages: o.pages, file: o.file,
        date: o.date, batch: batchId, by: user.u, at, checked: false,
      };
      if (!dayAdds.has(o.date)) dayAdds.set(o.date, []);
      dayAdds.get(o.date).push(rec);
      lastKey = { k: r.k, date: o.date };
    } else if (r.status === 'merge') {
      const t = r.target;
      if (!dayMerges.has(t.date)) dayMerges.set(t.date, []);
      dayMerges.get(t.date).push({ k: t.k, items: o.items, pages: o.pages });
      lastKey = t;
    }
  }
  const dates = [...new Set([...dayAdds.keys(), ...dayMerges.keys()])];
  await pmap(dates, 8, (date) =>
    update(`day/${date}`, (day) => {
      const list = day.orders;
      const have = new Set(list.map((x) => x.k));
      for (const rec of dayAdds.get(date) || []) if (!have.has(rec.k)) list.push(rec);
      for (const m of dayMerges.get(date) || []) {
        const t = list.find((x) => x.k === m.k);
        if (t) { mergeItems(t, m.items); t.pages = (t.pages || 1) + m.pages; t.mergedBy = user.u; }
      }
      return day;
    }, () => ({ date, orders: [] })),
  );
  if (lastKey) await setJSON('meta/last-order', lastKey);

  // 3) Etiketlerde görülen ürün adları (eşleştirme ekranı için)
  const names = new Map();
  for (const r of results) {
    if (r.status !== 'new' && r.status !== 'merge') continue;
    const o = orders[r.i];
    for (const it of o.items) {
      const k = fold(it.name);
      const n = names.get(k) || { raw: it.name, qty: 0, lines: 0, date: o.date };
      n.qty += it.qty; n.lines++; names.set(k, n);
    }
  }
  if (names.size) {
    await update('labelnames', (all) => {
      for (const [k, n] of names) {
        const cur = all[k] || { raw: n.raw, qty: 0, lines: 0, firstSeen: n.date };
        cur.qty += n.qty; cur.lines += n.lines; cur.lastSeen = n.date > (cur.lastSeen || '') ? n.date : cur.lastSeen; cur.raw = cur.raw || n.raw;
        all[k] = cur;
      }
      return all;
    }, {});
  }

  // 4) Yükleme kaydı + işlem geçmişi
  const counts = {
    new: results.filter((r) => r.status === 'new').length,
    dup: results.filter((r) => r.status === 'dup').length,
    merge: results.filter((r) => r.status === 'merge').length,
    error: results.filter((r) => r.status === 'error').length,
  };
  const batch = {
    id: batchId, at, by: user.u,
    files: (Array.isArray(b.files) ? b.files : []).map((f) => str(f, 200)).slice(0, 100),
    pages: int(b.pages, 0, 100000, 0),
    counts,
    dates: [...dayAdds.keys()].sort(),
    orders: results.filter((r) => r.status === 'new').map((r) => ({ k: r.k, date: orders[r.i].date, no: orders[r.i].orderNo })),
    units: results.filter((r) => r.status === 'new').reduce((s, r) => s + orders[r.i].items.reduce((a, it) => a + it.qty, 0), 0),
  };
  await setJSON(`batch/${batchId}`, batch);
  await audit(user, 'etiket yükleme', `${counts.new} yeni, ${counts.dup} mükerrer, ${counts.merge} devam · ${batch.files.join(', ')}`);
  await maybeCleanup(user);
  return json({ batchId, results, counts });
}

// ------------------------------------------------------------------ saklama süresi
async function maybeCleanup(user, force = false) {
  const today = todayTR();
  const meta = await getJSON('meta/cleanup', {});
  if (!force && meta.date === today) return null;
  const cfg = await getConfig();
  const cutoff = addDays(today, -cfg.settings.retentionDays);
  const dayKeys = (await listKeys('day/')).filter((k) => k.slice(4) < cutoff);
  await pmap(dayKeys, 8, (k) => del(k));
  const idxKeys = Array.from({ length: BUCKETS }, (_, i) => 'idx/' + String(i).padStart(2, '0'));
  await pmap(idxKeys, 8, (k) =>
    update(k, (idx) => {
      let changed = false;
      for (const [key, d] of Object.entries(idx)) if (d < cutoff) { delete idx[key]; changed = true; }
      return changed ? idx : undefined;
    }, {}),
  );
  const batchKeys = (await listKeys('batch/')).filter((k) => {
    const s = k.slice(6, 14);
    return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` < cutoff;
  });
  await pmap(batchKeys, 8, (k) => del(k));
  await setJSON('meta/cleanup', { date: today, cutoff, removedDays: dayKeys.length });
  if (dayKeys.length) await audit(user, 'otomatik temizlik', `${cutoff} öncesi ${dayKeys.length} günlük kayıt silindi`);
  return { cutoff, removedDays: dayKeys.length };
}

// ------------------------------------------------------------------ okuma
async function getOrders(url) {
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to') || from;
  if (!isYmd(from) || !isYmd(to) || from > to) throw new HttpError(400, 'Geçersiz tarih aralığı');
  const dates = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    dates.push(d);
    if (dates.length > 31) throw new HttpError(400, 'Tek istekte en fazla 31 gün');
  }
  const days = await pmap(dates, 12, (d) => getJSON(`day/${d}`));
  return json({ orders: days.filter(Boolean).flatMap((d) => d.orders) });
}

async function removeFromIndex(entries) {
  const byBucket = new Map();
  for (const e of entries) {
    const bk = bucketKey(e.no ?? e.k.split('|').pop());
    if (!byBucket.has(bk)) byBucket.set(bk, []);
    byBucket.get(bk).push(e);
  }
  await pmap([...byBucket.entries()], 12, ([bk, es]) =>
    update(bk, (idx) => {
      for (const e of es) if (idx[e.k] === e.date) delete idx[e.k];
      return idx;
    }, {}),
  );
}

// ------------------------------------------------------------------ yönlendirici
export default async (req) => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api\/?/, '').replace(/\/$/, '');
  const m = req.method;
  try {
    if (m !== 'GET') {
      const origin = req.headers.get('origin');
      if (origin && new URL(origin).host !== url.host) throw new HttpError(403, 'Geçersiz istek kaynağı');
    }
    if (path === 'login') return await login(req);
    if (path === 'logout') return json({ ok: true }, 200, { 'set-cookie': cookie('', 0) });

    const user = await session(req);
    need(user);
    if (m !== 'GET') need(user, 'admin', 'personel');

    if (path === 'me' && m === 'GET') {
      const secretSet = !!(env('AUTH_SECRET') && env('AUTH_SECRET').length >= 16);
      return json({ user: { username: user.u, role: user.r }, warnings: secretSet ? [] : ['AUTH_SECRET tanımlı değil'] });
    }

    if (path === 'config' && m === 'GET') return json({ config: await getConfig() });
    if (path.startsWith('config/') && m === 'PUT') {
      need(user, 'admin');
      const section = path.slice(7);
      if (!SANITIZE[section]) throw new HttpError(404, 'Bilinmeyen ayar bölümü');
      const b = await body(req);
      const value = SANITIZE[section](b.value);
      const cfg = await update('config', (c) => ({ ...c, [section]: value, updatedAt: nowIso(), updatedBy: user.u }), DEFAULT_CONFIG);
      await audit(user, 'ayar değişikliği', `${section}${b.summary ? ': ' + str(b.summary, 300) : ''}`);
      return json({ config: { ...DEFAULT_CONFIG(), ...cfg } });
    }

    if (path === 'labelnames' && m === 'GET') return json({ names: await getJSON('labelnames', {}) });
    if (path === 'import' && m === 'POST') return await importOrders(req, user);
    if (path === 'orders' && m === 'GET') return await getOrders(url);
    if (path === 'days' && m === 'GET') return json({ days: (await listKeys('day/')).map((k) => k.slice(4)).sort() });

    if (path === 'check' && m === 'POST') {
      const b = await body(req);
      if (!isYmd(b.date) || !b.k) throw new HttpError(400, 'Eksik bilgi');
      let found = null;
      await update(`day/${b.date}`, (day) => {
        const o = day && day.orders.find((x) => x.k === b.k);
        if (!o) return undefined;
        o.checked = !!b.checked;
        o.checkedAt = b.checked ? nowIso() : null;
        o.checkedBy = b.checked ? user.u : null;
        found = o;
        return day;
      });
      if (!found) throw new HttpError(404, 'Sipariş bulunamadı');
      return json({ order: found });
    }

    if (path === 'order' && m === 'DELETE') {
      need(user, 'admin');
      const date = url.searchParams.get('date'), k = url.searchParams.get('k');
      if (!isYmd(date) || !k) throw new HttpError(400, 'Eksik bilgi');
      let removed = null;
      await update(`day/${date}`, (day) => {
        if (!day) return undefined;
        const i = day.orders.findIndex((x) => x.k === k);
        if (i < 0) return undefined;
        removed = day.orders.splice(i, 1)[0];
        return day;
      });
      if (!removed) throw new HttpError(404, 'Sipariş bulunamadı');
      await removeFromIndex([{ k, date, no: removed.no }]);
      await audit(user, 'sipariş silme', `${removed.no} (${removed.sender}) · ${date}`);
      return json({ ok: true });
    }

    if (path === 'batches' && m === 'GET') {
      const limit = int(url.searchParams.get('limit'), 1, 100, 30);
      const keys = (await listKeys('batch/')).sort().reverse().slice(0, limit);
      const batches = await pmap(keys, 12, (k) => getJSON(k));
      return json({ batches: batches.filter(Boolean).map(({ orders, ...b }) => ({ ...b, orderCount: orders ? orders.length : 0 })) });
    }

    if (path === 'batch' && m === 'DELETE') {
      need(user, 'admin');
      const bid = url.searchParams.get('id');
      if (!/^[0-9a-z-]{10,40}$/.test(bid || '')) throw new HttpError(400, 'Geçersiz yükleme');
      const batch = await getJSON(`batch/${bid}`);
      if (!batch) throw new HttpError(404, 'Yükleme bulunamadı');
      const byDate = new Map();
      for (const o of batch.orders) { if (!byDate.has(o.date)) byDate.set(o.date, new Set()); byDate.get(o.date).add(o.k); }
      await pmap([...byDate.entries()], 8, ([date, keys]) =>
        update(`day/${date}`, (day) => {
          if (!day) return undefined;
          day.orders = day.orders.filter((x) => !(keys.has(x.k) && x.batch === bid));
          return day;
        }),
      );
      await removeFromIndex(batch.orders);
      await del(`batch/${bid}`);
      await audit(user, 'yükleme silme', `${batch.orders.length} sipariş · ${batch.files.join(', ')}`);
      return json({ ok: true, removed: batch.orders.length });
    }

    if (path === 'audit' && m === 'GET') {
      const month = url.searchParams.get('month') || todayTR().slice(0, 7);
      if (!/^\d{4}-\d{2}$/.test(month)) throw new HttpError(400, 'Geçersiz ay');
      return json({ events: (await getJSON(`audit/${month}`, [])).slice().reverse() });
    }

    if (path === 'users' && m === 'GET') {
      need(user, 'admin');
      return json({ users: parseUsers(env('USERS')).map(({ username, role }) => ({ username, role })) });
    }

    if (path === 'cleanup' && m === 'POST') {
      need(user, 'admin');
      return json({ result: await maybeCleanup(user, true) });
    }

    // Yedek: ay ay indirilir (Netlify yanıt boyutu sınırı nedeniyle)
    if (path === 'backup' && m === 'GET') {
      need(user, 'admin');
      const month = url.searchParams.get('month');
      if (!month) {
        const days = (await listKeys('day/')).map((k) => k.slice(4)).sort();
        return json({ config: await getConfig(), labelnames: await getJSON('labelnames', {}), months: [...new Set(days.map((d) => d.slice(0, 7)))] });
      }
      if (!/^\d{4}-\d{2}$/.test(month)) throw new HttpError(400, 'Geçersiz ay');
      const keys = (await listKeys(`day/${month}`)).sort();
      const days = await pmap(keys, 12, (k) => getJSON(k));
      return json({ days: days.filter(Boolean) });
    }

    if (path === 'restore' && m === 'POST') {
      need(user, 'admin');
      const b = await body(req);
      if (b.config) {
        const c = b.config;
        const clean = { stores: SANITIZE.stores(c.stores || []), products: SANITIZE.products(c.products || []), campaigns: SANITIZE.campaigns(c.campaigns || []), aliases: SANITIZE.aliases(c.aliases || {}), settings: SANITIZE.settings(c.settings || {}) };
        await update('config', (cur) => ({ ...cur, ...clean, updatedAt: nowIso(), updatedBy: user.u }), DEFAULT_CONFIG);
      }
      if (b.labelnames && typeof b.labelnames === 'object') await update('labelnames', (all) => ({ ...all, ...b.labelnames }), {});
      let restored = 0;
      for (const d of Array.isArray(b.days) ? b.days : []) {
        if (!isYmd(d.date) || !Array.isArray(d.orders)) continue;
        await update(`day/${d.date}`, (day) => {
          const have = new Set(day.orders.map((x) => x.k));
          for (const o of d.orders) if (o && o.k && !have.has(o.k)) { day.orders.push({ ...o, date: d.date }); restored++; }
          return day;
        }, () => ({ date: d.date, orders: [] }));
        const byBucket = new Map();
        for (const o of d.orders) { if (!o || !o.k) continue; const bk = bucketKey(o.no ?? o.k.split('|').pop()); if (!byBucket.has(bk)) byBucket.set(bk, []); byBucket.get(bk).push(o.k); }
        await pmap([...byBucket.entries()], 12, ([bk, ks]) => update(bk, (idx) => { for (const k of ks) if (!idx[k]) idx[k] = d.date; return idx; }, {}));
      }
      if (b.config || restored) await audit(user, 'yedekten geri yükleme', `${restored} sipariş${b.config ? ' + ayarlar' : ''}`);
      return json({ restored });
    }

    throw new HttpError(404, 'Bulunamadı');
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500) console.error(e);
    return json({ error: status >= 500 && !e.status ? 'Sunucu hatası: ' + e.message : e.message }, status);
  }
};

export const config = { path: '/api/*' };
