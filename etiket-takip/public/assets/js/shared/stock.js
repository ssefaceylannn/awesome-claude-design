// Stok kontrolü (yalnızca bilgi): Google E-Tablolar "KALAN" sayfasındaki kalan adetleri
// seçilen siparişlerin ihtiyacıyla karşılaştırır. Hiçbir yerde stok düşülmez, tabloya yazılmaz.
import { fold } from './text.js';

const H = {
  sku: ['sku', 'stok kodu', 'urun kodu'],
  name: ['urun adi', 'urun', 'ad'],
  qty: ['kalan', 'stok', 'kalan stok', 'mevcut'],
};
const num = (v) => {
  const s = String(v ?? '').trim().replace(/\s/g, '');
  if (!s) return null;
  // 1.234 / 1.234,5 / 1234.5 biçimleri
  const t = /^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s) ? s.replace(/\./g, '').replace(',', '.') : s.replace(',', '.');
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

/** CSV satırları → [{ sku, name, qty }]. Sütunlar başlık adından bulunur (SKU · ÜRÜN ADI · KALAN). */
export function parseStockRows(rows) {
  const hi = rows.findIndex((r) => r.some((c) => H.sku.includes(fold(c))) && r.some((c) => H.qty.includes(fold(c))));
  if (hi < 0) throw new Error('Tabloda SKU ve KALAN sütunları bulunamadı');
  const head = rows[hi].map((c) => fold(c));
  const col = (keys) => head.findIndex((h) => keys.includes(h));
  const cs = col(H.sku), cn = col(H.name), cq = col(H.qty);
  const out = [];
  for (const r of rows.slice(hi + 1)) {
    const sku = String(r[cs] ?? '').trim();
    const name = cn >= 0 ? String(r[cn] ?? '').trim() : '';
    const qty = num(r[cq]);
    if (!sku && !name) continue;
    out.push({ sku, name, qty });
  }
  return out;
}

/** Katalog ürünü → tablo satırı (önce SKU, sonra ürün adı). Aynı SKU birden çok satırdaysa toplanır. */
export function matchStock(products, items) {
  const bySku = new Map(), byName = new Map();
  for (const it of items) {
    if (it.qty == null) continue;
    const add = (map, k) => { if (!k) return; const cur = map.get(k); map.set(k, cur ? { ...cur, qty: cur.qty + it.qty } : { ...it }); };
    add(bySku, fold(it.sku));
    add(byName, fold(it.name));
  }
  const map = new Map();
  for (const p of products) {
    const hit = (p.sku && bySku.get(fold(p.sku))) || byName.get(fold(p.name));
    if (hit) map.set(p.id, { qty: hit.qty, sku: hit.sku, name: hit.name, by: p.sku && bySku.get(fold(p.sku)) ? 'sku' : 'name' });
  }
  return map;
}

/** Bir siparişin ürün ihtiyacı (etiket + isteğe bağlı kampanya hediyesi) */
export function orderNeeds(c, { includeRewards = true } = {}) {
  const need = new Map();
  for (const l of c.lines) if (l.productId && !l.ignored) need.set(l.productId, (need.get(l.productId) || 0) + l.units);
  if (includeRewards) for (const r of c.rewards || []) if (r.productId) need.set(r.productId, (need.get(r.productId) || 0) + r.qty);
  return need;
}

/**
 * computed: computeOrder sonuçları (yükleme sırasıyla). stock: matchStock çıktısı.
 * Ürün bazında toplam ihtiyaç/stok/eksik ve sırayla dağıtım: stok ilk yüklenen siparişten başlayarak
 * ayrılır; bir ürünü yetmeyen sipariş "çıkmaz" sayılır ve stoktan hiçbir şey ayırmaz (kısmi gönderim yok).
 * Stok tablosunda bulunmayan ürünler kontrol edilmez (siparişi engellemez, ayrıca listelenir).
 */
export function checkStock(computed, stock, { includeRewards = true } = {}) {
  const need = new Map(); // productId → { units, orders }
  const left = new Map([...stock].map(([id, s]) => [id, Math.max(0, s.qty)]));
  const blocked = [];
  let ok = 0, unmatchedOrders = 0;
  const notInSheet = new Map(); // productId → units
  for (const c of computed) {
    const nd = orderNeeds(c, { includeRewards });
    if (c.lines.some((l) => !l.productId && !l.ignored)) unmatchedOrders++;
    for (const [id, u] of nd) {
      const x = need.get(id) || { units: 0, orders: 0 };
      x.units += u; x.orders++;
      need.set(id, x);
      if (!stock.has(id)) notInSheet.set(id, (notInSheet.get(id) || 0) + u);
    }
    const short = [];
    for (const [id, u] of nd) if (left.has(id) && left.get(id) < u) short.push({ productId: id, need: u, left: left.get(id) });
    if (short.length) { blocked.push({ c, short, need: nd }); continue; }
    for (const [id, u] of nd) if (left.has(id)) left.set(id, left.get(id) - u);
    ok++;
  }
  const rows = [];
  for (const [id, x] of need) {
    const s = stock.get(id);
    if (!s) continue;
    const stockQty = s.qty;
    rows.push({ productId: id, need: x.units, orders: x.orders, stock: stockQty, after: stockQty - x.units, short: Math.max(0, x.units - Math.max(0, stockQty)), sku: s.sku });
  }
  rows.sort((a, b) => b.short - a.short || a.after - b.after);
  return { rows, blocked, ok, total: computed.length, notInSheet, unmatchedOrders };
}

/** Otomatik kontrol saatleri (Türkiye saati). Zamanlanmış görev 07:00–17:59 arasında 10 dakikada bir uyanır. */
export const DEFAULT_STOCK_TIMES = ['07:30', '09:00', '10:00', '13:00', '15:00', '16:30', '17:10'];
export const STOCK_TIME_RANGE = ['07:00', '17:50'];

/** Kaydedilecek özet: ekranda ve Excel'de gösterilecek kadarı (müşteri adı yok) */
export function stockSnapshot(R, ctx, { maxBlocked = 1000 } = {}) {
  const name = (id) => ctx.label(id);
  return {
    total: R.total, okCount: R.ok, blockedCount: R.blocked.length, unmatchedOrders: R.unmatchedOrders,
    rows: R.rows.map((r) => ({ name: name(r.productId), sku: r.sku, need: r.need, stock: r.stock, after: r.after, short: r.short, orders: r.orders })),
    blocked: R.blocked.slice(0, maxBlocked).map((b) => ({
      no: b.c.order.no, at: b.c.order.at || '', store: b.c.store ? b.c.store.name : b.c.order.sender || '',
      short: b.short.map((s) => ({ name: name(s.productId), need: s.need, left: s.left })),
    })),
    notInSheet: [...R.notInSheet].map(([id, u]) => ({ name: name(id), sku: (ctx.productsById.get(id) || {}).sku || '', need: u })),
  };
}

/** Yükleme sırası: yükleme saati (o.at), eşitse gün dosyasındaki sıra */
export function uploadOrder(orders, atOf = (o) => o.at) {
  return orders.map((o, i) => ({ o, i, t: String(atOf(o) || o.date || '') })).sort((a, b) => a.t.localeCompare(b.t) || a.i - b.i).map((x) => x.o);
}
