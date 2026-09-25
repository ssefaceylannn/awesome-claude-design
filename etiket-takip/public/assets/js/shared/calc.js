// Sipariş → mağaza, ürün ve kampanya hesabı. Raporlar her zaman güncel
// katalog / eşleştirme / kampanya ayarlarıyla hesaplanır; bir eşleştirmeyi
// düzelttiğinizde geçmiş günlerin raporları da düzelir.
import { fold } from './text.js';
import { createMatcher } from './matcher.js';

/**
 * Marka → satıldığı mağazalar. Ayarlanmamışsa (null) varsayılan: "Power Vital" markası
 * yalnızca adında Power Vital geçen mağazalarda satılır. Boş liste = tüm mağazalar.
 */
export function brandRules(config) {
  const saved = config.settings && config.settings.brandStores;
  if (saved) return saved;
  const stores = config.stores || [];
  const out = {};
  const brands = [...new Set((config.products || []).map((p) => p.brand).filter(Boolean))];
  for (const b of brands) {
    if (fold(b).replace(/\s+/g, '') !== 'powervital') continue;
    const ids = stores.filter((st) => fold(st.name).replace(/\s+/g, '').includes('powervital')).map((st) => st.id);
    if (ids.length) out[b] = ids;
  }
  return out;
}

/**
 * Ürünün, marka kuralına ek olarak satıldığı mağazalar (ürün ayarındaki "Ayrıca satıldığı mağazalar").
 * Ayarlanmamışsa (undefined) varsayılan: Power Vital Karamürver/Karadut ürünü adında
 * "Daily Organic" geçen mağazalarda da satılır.
 */
export function productExtraStores(p, stores) {
  if (Array.isArray(p.stores)) return p.stores;
  const brand = fold(p.brand || '').replace(/\s+/g, '');
  if (brand === 'powervital' && /karadut|karamurver/.test(fold(p.name || ''))) {
    return (stores || []).filter((st) => fold(st.name).replace(/\s+/g, '').includes('dailyorganic')).map((st) => st.id);
  }
  return [];
}

export function createContext(config) {
  const match = createMatcher(config);
  // Marka kuralı: bir mağazanın etiketleri yalnızca o mağazada satılan markaların ürünleriyle eşleşir
  const rules = new Map(Object.entries(brandRules(config)).filter(([, ids]) => ids && ids.length).map(([b, ids]) => [fold(b), new Set(ids)]));
  const extra = new Map((config.products || []).map((p) => [p.id, new Set(productExtraStores(p, config.stores))]));
  // Ürün bu mağazada markasının kuralıyla mı (native) yoksa yalnızca ürüne özel ek mağaza olarak mı satılıyor
  const native = (p, store) => { const r = p.brand && rules.get(fold(p.brand)); return !r || r.has(store.id); };
  const storeMatchers = new Map();
  const matchFor = (store) => {
    if (!rules.size || !store) return match;
    if (!storeMatchers.has(store.id)) {
      const ok = (p) => native(p, store) || extra.get(p.id).has(store.id);
      const all = config.products || [];
      storeMatchers.set(store.id, all.every(ok) ? match : createMatcher({ ...config, products: all.filter(ok) }));
    }
    return storeMatchers.get(store.id);
  };
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
  // Farklı markalarda aynı adlı ürünler ekranda "Ad (Marka)" olarak gösterilir
  const nameKey = (p) => fold(p.name).replace(/\s+/g, '');
  const nameCount = new Map();
  for (const p of products) nameCount.set(nameKey(p), (nameCount.get(nameKey(p)) || 0) + 1);
  const labelOf = (p) => (!p ? '(silinmiş ürün)' : nameCount.get(nameKey(p)) > 1 && p.brand ? `${p.name} (${p.brand})` : p.name);
  const label = (id) => labelOf(productsById.get(id));
  // Arşivlenen kampanyalar kendi tarih aralığında geçmiş raporlarda sayılmaya devam eder
  const campaigns = (config.campaigns || []).filter((c) => c.active).map(normCampaign);
  return { config, match, matchFor, resolveStore, products, productsById, label, labelOf, campaigns, stores: config.stores || [], native };
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
    maxQty: Math.max(0, +c.maxQty || 0),
    pureOnly: !!c.pureOnly,
    minAmount: Math.max(0, +c.minAmount || 0),
    maxPerOrder: Math.max(0, +c.maxPerOrder || 0),
    mode: ['every', 'once', 'roundup'].includes(c.mode) ? c.mode : 'every',
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
/**
 * Aynı ada sahip farklı marka ürünleri (ör. iki "Karamürver ve Karadut Özü"):
 * belirsiz eşleşmede, markası mağaza adında geçen ürün seçilir.
 */
function byBrand(m, store, sender, ctx, raw = '') {
  if (!m.candidates || m.candidates.length < 2 || m.method === 'manual') return m;
  const ns = (id) => fold((ctx.productsById.get(id) || {}).name || '').replace(/\s+/g, '');
  // Belirsiz eşleşme ya da seçilen ürünle aynı adlı (farklı yazımlı) başka marka ürünü varsa
  const pool = m.method === 'ambiguous' ? m.candidates : m.productId ? m.candidates.filter((id) => ns(id) === ns(m.productId)) : [];
  if (pool.length < 2) return m;
  const brandIn = (text) => {
    const hay = fold(text).replace(/\s+/g, '');
    return pool.filter((id) => {
      const b = (ctx.productsById.get(id) || {}).brand;
      return b && hay.includes(fold(b).replace(/\s+/g, ''));
    });
  };
  // 1) Etiketteki ürün adında marka yazıyorsa o, 2) mağaza/gönderici adında geçen marka
  for (const hit of [brandIn(raw), brandIn(`${store ? store.name : ''} ${sender || ''}`)]) {
    if (hit.length === 1) return { ...m, productId: hit[0], method: 'brand', multiplier: 1 };
  }
  // 3) Mağazada markası gereği satılan ürün, yalnızca ürüne özel "ek mağaza" olarak satılana tercih edilir
  if (store && ctx.native) {
    const nat = pool.filter((id) => { const p = ctx.productsById.get(id); return p && ctx.native(p, store); });
    if (nat.length === 1 && nat.length < pool.length) return { ...m, productId: nat[0], method: 'brand', multiplier: 1 };
  }
  return m;
}

/**
 * Mağazadan bağımsız bakıldığında belirsiz ama aslında aynı adlı farklı marka ürünleri arasında
 * kalan eşleşme (ör. "Karamürver ve Karadut Özü": Ultra Natura / Power Vital). Raporlarda etiketin
 * mağazasına göre doğru ürün seçildiği için bekleyen iş sayılmaz. Dönen dizi: aday ürün kimlikleri.
 */
export function brandResolved(m, ctx) {
  if (!m || m.method !== 'ambiguous' || !m.candidates || m.candidates.length < 2) return null;
  const ps = m.candidates.map((id) => ctx.productsById.get(id)).filter(Boolean);
  const key = (p) => fold(p.name).replace(/\s+/g, '');
  const same = ps.filter((p) => key(p) === key(ps[0]));
  if (same.length < 2 || same.some((p) => !p.brand) || new Set(same.map((p) => fold(p.brand))).size !== same.length) return null;
  return same.map((p) => p.id);
}

/**
 * Eski sistemden aktarılan günlük özet ("arşiv"): sipariş detayı yok; etiket ve
 * kampanya adetleri o gün kaydedildiği gibi sabit kullanılır, yeniden hesaplanmaz.
 */
function computeSummary(o, ctx) {
  const store = ctx.resolveStore(o.sender);
  const platform = (store && store.platform) || o.platform || '';
  const toLines = (list) => (list || []).flatMap((it) => {
    const m = byBrand(ctx.matchFor(store)(it.name), store, o.sender, ctx, it.name);
    if (m.parts && m.parts.length) return m.parts.map((p) => ({ raw: it.name, qty: it.qty, productId: p.productId, ignored: false, method: m.method, mult: p.qty, units: it.qty * p.qty, candidates: [] }));
    return [{ raw: it.name, qty: it.qty, productId: m.productId, ignored: !!m.ignored, method: m.method, mult: 1, units: it.qty, candidates: m.candidates }];
  });
  const lines = toLines(o.items);
  const rewards = toLines(o.bonus).filter((l) => !l.ignored).map((l) => ({ campaignId: '__archive', name: 'Arşiv (eski sistem kampanyaları)', productId: l.productId, raw: l.raw, qty: l.units }));
  return { order: o, store, platform, lines, rewards, summary: true };
}

export function computeOrder(o, ctx) {
  if (o.summary) return computeSummary(o, ctx);
  const store = ctx.resolveStore(o.sender);
  const platform = (store && store.platform) || o.platform || '';
  const lines = (o.items || []).flatMap((it) => {
    // Ürünü elle seçilmiş satır (ör. yeniden gönderim): eşleştirme yapılmaz
    if (it.productId && ctx.productsById.has(it.productId)) {
      return [{ raw: it.name, qty: it.qty, productId: it.productId, ignored: false, method: 'pinned', mult: 1, units: it.qty, candidates: [] }];
    }
    const m = byBrand(ctx.matchFor(store)(it.name), store, o.sender, ctx, it.name);
    // Set / birleşik ad: her ürün ayrı satır olarak sayılır
    if (m.parts && m.parts.length) {
      return m.parts.map((p) => ({ raw: it.name, qty: it.qty, productId: p.productId, ignored: false, method: m.method, bundle: true, mult: p.qty, units: it.qty * p.qty, candidates: [] }));
    }
    const mult = m.multiplier || 1;
    return [{ raw: it.name, qty: it.qty, productId: m.productId, ignored: !!m.ignored, method: m.method, mult, units: it.qty * mult, candidates: m.candidates }];
  });
  const counts = new Map();
  for (const l of lines) if (l.productId) counts.set(l.productId, (counts.get(l.productId) || 0) + l.units);

  // Siparişteki farklı ürün sayısı (eşleşmeyen satırlar da ayrı ürün sayılır, yoksayılanlar sayılmaz)
  const distinctInOrder = counts.size + new Set(lines.filter((l) => !l.productId && !l.ignored).map((l) => l.raw)).size;

  const rewards = [];
  // Yeniden gönderimde kampanya uygulanmaz (eksik/hasarlı ürünün tekrar gönderimi)
  if (o.source === 'resend') return { order: o, store, platform, lines, rewards, resend: true };
  for (const c of ctx.campaigns) {
    if (!campaignApplies(c, o, store, platform)) continue;
    const eligible = [...counts.keys()].filter((id) => productEligible(c, id));
    if (!eligible.length) continue;
    // Karışık siparişte uygulanmaz: sipariş tek çeşit üründen oluşmalı
    if (c.pureOnly && distinctInOrder !== 1) continue;
    // roundup: adedi X'in katına tamamla (X=2 → 1→+1, 2→0, 3→+1, 4→0)
    const times = (q, min) => {
      if (c.maxQty && q > c.maxQty) return 0;
      if (c.mode === 'roundup') return q > 0 ? (min - (q % min)) % min : 0;
      return q < min ? 0 : c.mode === 'once' ? 1 : Math.floor(q / min);
    };
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
    const orderCount = o.summary ? +o.orderCount || 0 : 1;
    if (o.summary && !(o.items || []).length && !(o.bonus || []).length) {
      // Arşiv: yalnızca günün sipariş sayısı (mağaza bazında bilinmiyor)
      R.orders += orderCount;
      R.archiveDays = (R.archiveDays || new Set()).add(o.date);
      continue;
    }
    R.computed.push(c);
    R.orders += orderCount;
    if (o.summary) R.archiveDays = (R.archiveDays || new Set()).add(o.date);
    if (o.checked) R.checked++;
    const sk = c.store ? c.store.id : '?' + fold(o.sender);
    if (!R.stores.has(sk)) R.stores.set(sk, { store: c.store, sender: o.sender, archive: !c.store && !!o.summary, platform: c.platform, orders: 0, labelUnits: 0, campaignUnits: 0, campaignOrders: 0, products: new Map() });
    const S = R.stores.get(sk);
    S.orders += orderCount;
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
    if (c.rewards.length && !o.summary) { R.campaignOrders++; S.campaignOrders++; }
    for (const r of c.rewards) {
      if (!r.productId) {
        // Arşivdeki eşleşmeyen kampanya adedi → eşleşmeyenler arasında göster
        const k = fold(r.raw || '');
        const u = R.unmatched.get(k) || { raw: r.raw, units: 0, orders: new Set(), candidates: [], method: 'none' };
        u.units += r.qty;
        R.unmatched.set(k, u);
        R.campaignUnits += r.qty;
        S.campaignUnits += r.qty;
        continue;
      }
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
