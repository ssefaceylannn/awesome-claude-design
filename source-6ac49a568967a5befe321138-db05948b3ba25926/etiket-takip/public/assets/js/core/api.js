// Sunucu API istemcisi + paylaşılan uygulama durumu.
import { addDays, collator } from './ui.js';
import { createContext } from '../shared/calc.js';

async function req(method, path, data) {
  const opt = { method, headers: {}, credentials: 'same-origin' };
  if (data !== undefined) { opt.headers['content-type'] = 'application/json'; opt.body = JSON.stringify(data); }
  const r = await fetch('/api/' + path, opt);
  let j = null;
  try { j = await r.json(); } catch { /* boş yanıt */ }
  if (r.status === 401) {
    location.href = '/login.html?next=' + encodeURIComponent(location.pathname + location.hash);
    throw new Error('Oturum süresi doldu');
  }
  if (!r.ok) throw new Error((j && j.error) || `İstek başarısız (${r.status})`);
  return j;
}

export const api = {
  get: (p) => req('GET', p),
  post: (p, d) => req('POST', p, d ?? {}),
  put: (p, d) => req('PUT', p, d ?? {}),
  del: (p) => req('DELETE', p),
};

// ------------------------------------------------------------------ durum
export const state = {
  me: null,
  config: null,
  ctx: null, // hesaplama bağlamı (eşleştirici, mağaza çözümleyici…)
  listeners: new Set(),
};

const ROLE_RANK = { izleyici: 0, personel: 1, admin: 2 };
export const can = (role) => state.me && ROLE_RANK[state.me.role] >= ROLE_RANK[role];
export const isAdmin = () => can('admin');

function setConfig(cfg) {
  state.config = cfg;
  state.ctx = createContext(cfg);
  for (const f of state.listeners) f(cfg);
}
export const onConfig = (f) => { state.listeners.add(f); return () => state.listeners.delete(f); };

export async function boot() {
  const [me, cfg] = await Promise.all([api.get('me'), api.get('config')]);
  state.me = me.user;
  state.warnings = me.warnings || [];
  setConfig(cfg.config);
}

export async function reloadConfig() {
  setConfig((await api.get('config')).config);
}

/** Bir ayar bölümünü kaydet (yalnızca yönetici) */
export async function saveSection(section, value, summary) {
  const r = await api.put('config/' + section, { value, summary });
  setConfig(r.config);
  return r.config;
}

// ------------------------------------------------------------------ sipariş önbelleği
const dayCache = new Map(); // tarih → { at, orders }
const TTL = 60 * 1000;

export function invalidateOrders() { dayCache.clear(); }

/** Tarih aralığındaki siparişler (31 günlük parçalar hâlinde, önbellekli) */
export async function fetchOrders(from, to) {
  const need = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const c = dayCache.get(d);
    if (!c || Date.now() - c.at > TTL) need.push(d);
  }
  if (need.length) {
    // Ardışık günleri en fazla 31 günlük parçalara böl
    const chunks = [];
    let start = need[0], prev = need[0], len = 1;
    for (const d of need.slice(1)) {
      if (d !== addDays(prev, 1) || len >= 31) {
        chunks.push([start, prev]);
        start = d;
        len = 0;
      }
      prev = d;
      len++;
    }
    chunks.push([start, prev]);
    const results = [];
    let i = 0;
    await Promise.all(Array.from({ length: Math.min(3, chunks.length) }, async () => {
      while (i < chunks.length) {
        const [f, t] = chunks[i++];
        const r = await api.get(`orders?from=${f}&to=${t}`);
        results.push([f, t, r.orders]);
      }
    }));
    const at = Date.now();
    for (const [f, t, orders] of results) {
      for (let d = f; d <= t; d = addDays(d, 1)) dayCache.set(d, { at, orders: [] });
      for (const o of orders) dayCache.get(o.date)?.orders.push(o);
    }
  }
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(...(dayCache.get(d)?.orders || []));
  return out.sort((a, b) => a.date.localeCompare(b.date) || collator.compare(a.at || '', b.at || ''));
}

export function patchCachedOrder(order) {
  const c = dayCache.get(order.date);
  if (!c) return;
  const i = c.orders.findIndex((o) => o.k === order.k);
  if (i >= 0) c.orders[i] = order;
}

// ------------------------------------------------------------------ tarih aralığı (sayfalar arası paylaşılır)
export function getRange() {
  try {
    const r = JSON.parse(sessionStorage.getItem('et-range') || 'null');
    if (r && r.from && r.to) return r;
  } catch { /* yok */ }
  const t = new Date();
  const y = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
  return { from: y, to: y };
}
export function setRange(from, to) {
  try { sessionStorage.setItem('et-range', JSON.stringify({ from, to })); } catch { /* yok */ }
}
