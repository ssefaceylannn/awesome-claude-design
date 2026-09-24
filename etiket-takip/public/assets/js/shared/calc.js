// Sipariş → mağaza, ürün ve kampanya hesabı. Raporlar her zaman güncel
// katalog / eşleştirme / kampanya ayarlarıyla hesaplanır; bir eşleştirmeyi
// düzelttiğinizde geçmiş günlerin raporları da düzelir.
import { fold } from './text.js';
import { createMatcher } from './matcher.js';

export function createContext(config) {
  const match = createMatcher(config);
  // Pasif mağazalar da çözülür (geçmiş siparişleri "Tanımsız" görünmesin)
  const stores = config.stores || [];
  const senderMap = new Map();
  for (const s of stores) for (const snd of [s.name, ...(s.senders || [])]) if (snd) senderMap.set(fold(snd), s);
  const storeCache = new Map();

  function resolveStore(sender) {
    const k = fold(sender);
    if (storeCache.has(k)) return storeCache.get(k);
    let s = senderMap.get(k) || null;
    if (!s && k) {
      // Kısmi eşleşme: en uzun gönderici metni kazanır
      let best = 0;
      for (const [snd, st] of senderMap) {
        if (snd.length > best && (k.includes(snd) || snd.includes(k))) { s = st; best = snd.length; }
      }
    }
    storeCache.set(k, s);
    return s;
  }

  const products = config.products || [];
  const productsById = new Map(products.map((p) => [p.id, p]));
  // Arşivlenen kampanyalar kendi tarih aralığında geçmiş raporlarda sayılmaya devam eder
  const campaigns = (config.campaigns || []).filter((c) => c.active).map(normCampaign);
  return { config, match, resolveStore, products, productsById, campaigns, stores: config.stores || [] };
}

/**
 * Kampanyayı tek biçime getir. Eski kayıtlarda olmayan alanlar, eski davranışı
 * birebir koruyan varsayılanlarla doldurulur.
 */
export function normCampaign(c) {
  const rewards = Array.isArray(c.rewards) && c.rewards.length
    ? c.rewards.map((r) => ({ productId: r.productId || '', qty: Math.max(1, +r.qty || 1) }))
    : [{ productId: c.rewardProductId || '', qty: Math.max(1, +c.rewardQty || 1) }];
  return {
    ...c,
    storeIds: c.storeIds || [],
    storeMode: c.storeMode === 'exclude' ? 'exclude' : 'include',
    platforms: c.platforms || [],
    triggerProductIds: c.triggerProductIds || [],
    productMode: c.productMode === 'exclude' ? 'exclude' : 'include',
    condition: c.condition || 'qty',
    minQty: Math.max(1, +c.minQty || 1),
    minAmount: Math.max(0, +c.minAmount || 0),
    maxPerOrder: Math.max(0, +c.maxPerOrder || 0),
    mode: c.mode === 'once' ? 'once' : 'every',
    countMode: c.countMode === 'sum' ? 'sum' : 'each',
    rewards,
  };
}

function campaignApplies(c, o, store, platform) {
  if (c.start && o.date < c.start) return false;
  if (c.end && o.date > c.end) return false;
  if (c.storeIds.length) {
    const inList = !!(store && c.storeIds.includes(store.id));
    if (c.storeMode === 'exclude' ? inList : !inList) return false;
  }
  if (c.platforms.length && !c.platforms.includes(platform)) return false;
  return true;
}

/** Ürün kampanyaya dahil mi? Liste boşsa tüm ürünler. */
export function productEligible(c, productId) {
  const ids = c.triggerProductIds;
  if (c.productMode === 'exclude') return !ids.includes(productId);
  return !ids.length || ids.includes(productId);
}

/** Tek sipariş: satırları eşleştir, kampanyaları uygula */
export function computeOrder(o, ctx) {
  const store = ctx.resolveStore(o.sender);
  const platform = (store && store.platform) || o.platform || '';
  const lines = (o.items || []).map((it) => {
    const m = ctx.match(it.name);
    const mult = m.multiplier || 1;
    return { raw: it.name, qty: it.qty, productId: m.productId, ignored: !!m.ignored, method: m.method, mult, units: it.qty * mult, candidates: m.candidates };
  });
  const counts = new Map();
  for (const l of lines) if (l.productId) counts.set(l.productId, (counts.get(l.productId) || 0) + l.units);

  const rewards = [];
  for (const c of ctx.campaigns) {
    if (!campaignApplies(c, o, store, platform)) continue;
    const eligible = [...counts.keys()].filter((id) => productEligible(c, id));
    if (!eligible.length) continue;
    const times = (q, min) => (q < min ? 0 : c.mode === 'once' ? 1 : Math.floor(q / min));
    const out = [];
    const give = (t, sameAs) => {
      if (!t) return;
      for (const r of c.rewards) {
        const pid = r.productId || sameAs;
        if (pid) out.push({ productId: pid, qty: r.qty * t });
      }
    };
    if (c.condition === 'qty' && c.countMode !== 'sum') {
      // Her ürün ayrı sayılır; "aynı üründen" ödül o ürüne verilir
      for (const id of eligible) give(times(counts.get(id), c.minQty), id);
    } else {
      let t = 0;
      if (c.condition === 'qty') t = times(eligible.reduce((s, id) => s + counts.get(id), 0), c.minQty);
      else if (c.condition === 'distinct') t = times(eligible.length, c.minQty);
      else if (c.condition === 'amount') t = o.amount > 0 && c.minAmount > 0 ? times(o.amount, c.minAmount) : 0;
      else if (c.condition === 'order') t = 1;
      // "Aynı üründen" ödül toplu koşullarda en çok alınan ürüne verilir
      const top = eligible.slice().sort((a, b) => counts.get(b) - counts.get(a))[0];
      give(t, top);
    }
    // Sipariş başına üst sınır
    if (c.maxPerOrder) {
      let left = c.maxPerOrder;
      for (const r of out) { r.qty = Math.min(r.qty, left); left -= r.qty; }
    }
    for (const r of out) if (r.qty > 0) rewards.push({ campaignId: c.id, name: c.name, productId: r.productId, qty: r.qty });
  }
  return { order: o, store, platform, lines, rewards };
}

/** Siparişleri topla. filter: { storeIds:[], platforms:[] } */
export function aggregate(orders, ctx, filter = {}) {
  const R = {
    orders: 0, campaignOrders: 0, labelUnits: 0, campaignUnits: 0, lineCount: 0, checked: 0,
    products: new Map(), // productId → { labelUnits, campaignUnits, orders:Set }
    unmatched: new Map(), // fold(raw) → { raw, units, orders:Set, candidates, method }
    stores: new Map(), // storeId|'?'+sender → { store, sender, platform, orders, labelUnits, campaignUnits, campaignOrders, products: Map }
    campaigns: new Map(), // campaignId → { name, orders, units }
    computed: [],
  };
  const prod = (id) => {
    if (!R.products.has(id)) R.products.set(id, { labelUnits: 0, campaignUnits: 0, orders: new Set() });
    return R.products.get(id);
  };
  for (const o of orders) {
    const c = computeOrder(o, ctx);
    if (filter.storeIds && filter.storeIds.length && !(c.store && filter.storeIds.includes(c.store.id))) continue;
    if (filter.platforms && filter.platforms.length && !filter.platforms.includes(c.platform)) continue;
    R.computed.push(c);
    R.orders++;
    if (o.checked) R.checked++;
    const sk = c.store ? c.store.id : '?' + fold(o.sender);
    if (!R.stores.has(sk)) R.stores.set(sk, { store: c.store, sender: o.sender, platform: c.platform, orders: 0, labelUnits: 0, campaignUnits: 0, campaignOrders: 0, products: new Map() });
    const S = R.stores.get(sk);
    S.orders++;
    for (const l of c.lines) {
      if (l.ignored) continue;
      R.lineCount++;
      R.labelUnits += l.units;
      S.labelUnits += l.units;
      if (l.productId) {
        const p = prod(l.productId);
        p.labelUnits += l.units;
        p.orders.add(o.k);
        S.products.set(l.productId, (S.products.get(l.productId) || 0) + l.units);
      } else {
        const k = fold(l.raw);
        const u = R.unmatched.get(k) || { raw: l.raw, units: 0, orders: new Set(), candidates: l.candidates, method: l.method };
        u.units += l.units;
        u.orders.add(o.k);
        R.unmatched.set(k, u);
      }
    }
    if (c.rewards.length) { R.campaignOrders++; S.campaignOrders++; }
    for (const r of c.rewards) {
      R.campaignUnits += r.qty;
      S.campaignUnits += r.qty;
      const p = prod(r.productId);
      p.campaignUnits += r.qty;
      S.products.set(r.productId, (S.products.get(r.productId) || 0) + r.qty);
      const cm = R.campaigns.get(r.campaignId) || { name: r.name, orders: new Set(), units: 0 };
      cm.orders.add(o.k);
      cm.units += r.qty;
      R.campaigns.set(r.campaignId, cm);
    }
  }
  R.totalUnits = R.labelUnits + R.campaignUnits;
  return R;
}

/** Katalog sırasına göre üretim listesi satırları */
export function productionRows(R, ctx, { includeZero = false, includeInactive = false } = {}) {
  const rows = [];
  for (const p of ctx.products) {
    const a = R.products.get(p.id);
    if (!a && (!includeZero || (p.active === false && !includeInactive))) continue;
    rows.push({
      product: p,
      labelUnits: a ? a.labelUnits : 0,
      campaignUnits: a ? a.campaignUnits : 0,
      total: a ? a.labelUnits + a.campaignUnits : 0,
      orders: a ? a.orders.size : 0,
    });
  }
  return rows;
}
