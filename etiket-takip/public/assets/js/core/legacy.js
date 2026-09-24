// Eski "Kampanya Hesaplama" yedeğini (JSON) bu sistemin biçimine çevirir.
// Saf fonksiyonlar: tarayıcıda ve testlerde aynı şekilde çalışır.
import { fold, isYmd } from '../shared/text.js';
import { autoKeywords } from '../shared/matcher.js';

export const isLegacyBackup = (d) => d && typeof d === 'object' && (d.dailyHistory || d.recordedOrders) && (d.urunSirasi || d.productCatalog || d.rules);

const nospace = (s) => fold(s).replace(/\s+/g, '');
const WEAK_TOKENS = new Set(['one', 'size', 'adet', 'x']);
const rid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

function platformOf(name) {
  const f = fold(name);
  if (f.includes('trendyol')) return 'trendyol';
  if (f.includes('ikas')) return 'ikas';
  if (f.includes('shopify')) return 'shopify';
  if (f.includes('hepsiburada')) return 'hepsiburada';
  if (f.includes('amazon')) return 'amazon';
  return 'diger';
}

const COLORS = ['#f97316', '#7c3aed', '#16a34a', '#2563eb', '#db2777', '#0891b2', '#ca8a04', '#dc2626', '#4f46e5', '#65a30d', '#0d9488', '#64748b'];

/**
 * @param legacy  eski yedek
 * @param config  mevcut ayarlar (korunur, üzerine eklenir)
 * @param opts    { reorderProducts: true }
 */
export function convertLegacy(legacy, config, opts = {}) {
  const report = { storesAdded: [], storesUpdated: [], productsAdded: 0, productsUpdated: 0, campaigns: [], days: 0, archiveRows: 0, legacyOrders: 0, skippedRules: [], weakKeywords: [] };

  // ---------------------------------------------------------------- mağazalar
  const stores = (config.stores || []).map((s) => ({ ...s, senders: [...(s.senders || [])] }));
  const findStore = (name) => stores.find((s) => [s.name, ...(s.senders || [])].some((x) => nospace(x) === nospace(name)));
  const storeNames = new Set([...(legacy.storeNames || []), ...(legacy.rules || []).map((r) => r.magaza).filter(Boolean)]);
  for (const day of Object.values(legacy.dailyHistory || {})) for (const sn of Object.keys(day.storeProducts || {})) if (!/mağaza yok/i.test(sn)) storeNames.add(sn);
  for (const name of storeNames) {
    const ex = findStore(name);
    if (ex) {
      if (!ex.senders.some((x) => fold(x) === fold(name))) { ex.senders.push(name); report.storesUpdated.push(name); }
      continue;
    }
    // Aynı mağazanın farklı yazımı (Ultranatura İkas ↔ Ultra Natura İkas) aynı kayda gider
    stores.push({ id: rid('s'), name, platform: platformOf(name), senders: [name], color: COLORS[stores.length % COLORS.length], code: '', note: 'Eski sistemden aktarıldı', active: true });
    report.storesAdded.push(name);
  }
  const canonStore = (name) => { const s = findStore(name); return s ? s.name : name; };

  // ---------------------------------------------------------------- ürünler + sıra
  const products = (config.products || []).map((p) => ({ ...p }));
  const byKey = new Map(products.map((p) => [nospace(p.name), p]));
  const canonicals = [...new Set([...(legacy.productNames || []), ...(legacy.productCatalog || []).map((c) => c.canonical)].filter(Boolean))];
  const prettyName = (name) => canonicals.find((c) => nospace(c) === nospace(name)) || name;
  const order = [];
  const upsert = (name, extra = {}) => {
    const key = nospace(name);
    let p = byKey.get(key);
    if (!p) {
      p = { id: rid('p'), name: prettyName(name), sku: '', brand: '', category: '', unit: 'adet', keywords: '', exclude: '', packMultiplier: false, active: true };
      products.push(p);
      byKey.set(key, p);
      report.productsAdded++;
    } else report.productsUpdated++;
    for (const [k, v] of Object.entries(extra)) if (v && !p[k]) p[k] = v;
    if (!order.includes(p)) order.push(p);
    return p;
  };
  for (const r of legacy.urunSirasi || []) if (r && r.urun) upsert(r.urun, { sku: r.sku, brand: r.marka, category: r.kategori });
  for (const c of canonicals) upsert(c);
  // Eski sistemin anahtar kelimeleri → eşleşme kuralı (ürün adından üretilen kural korunur)
  const kw = new Map();
  for (const c of legacy.productCatalog || []) {
    if (!c || !c.canonical || !c.keyword) continue;
    const p = byKey.get(nospace(c.canonical));
    if (!p) continue;
    // Çok genel anahtar kelimeleri alma ("one size", "CM", "MG"): başka ürünlerin adlarında da geçer
    const toks = fold(c.keyword).split(' ').filter((t) => t && !WEAK_TOKENS.has(t));
    if (!toks.length || toks.join('').length < 3) { report.weakKeywords.push(`${c.canonical}: ${c.keyword}`); continue; }
    if (!kw.has(p)) kw.set(p, new Set());
    kw.get(p).add(c.keyword.trim());
  }
  for (const [p, set] of kw) {
    if (p.keywords && p.keywords.trim()) continue; // elle yazılmış kural varsa dokunma
    const lines = [autoKeywords(p.name, config.settings && config.settings.noiseWords), ...set].filter(Boolean);
    p.keywords = [...new Set(lines)].join('\n');
  }
  let finalProducts = products;
  if (opts.reorderProducts !== false) finalProducts = [...order, ...products.filter((p) => !order.includes(p))];

  // ---------------------------------------------------------------- kampanyalar (durdurulmuş taslak)
  const pid = (name) => { const p = byKey.get(nospace(name)); return p ? p.id : null; };
  const campaigns = [...(config.campaigns || [])];
  const TYPE_TR = { grup: 'Her X adette Y bedava', tamamla: 'Katına tamamla', katSabit: 'katSabit (eski tür)', yok: 'Kampanya yok' };
  for (const r of legacy.rules || []) {
    if (!r || !r.magaza) continue;
    if (r.tip === 'yok') { report.skippedRules.push(`${r.magaza}: kampanya yok`); continue; }
    const store = findStore(r.magaza);
    const only = (r.sadece || []).map(pid).filter(Boolean);
    const restricted = (r.kisit || []).map(pid).filter(Boolean);
    const name = `[Eski] ${r.magaza} — ${TYPE_TR[r.tip] || r.tip}`;
    if (campaigns.some((c) => c.name === name)) continue;
    const c = {
      id: rid('c'),
      name,
      note: `Eski sistemden aktarıldı, kontrol edip başlatın. tip=${r.tip}, grup=${r.grup}, bonus=${r.bonus}, çarpan=${r.carpan}${r.sadece && r.sadece.length ? `, sadece=${r.sadece.join(' / ')}` : ''}${r.kisit && r.kisit.length ? `, kısıt=${r.kisit.join(' / ')}` : ''}`,
      active: false,
      archived: false,
      storeIds: store ? [store.id] : [],
      storeMode: 'include',
      platforms: [],
      triggerProductIds: only.length ? only : restricted,
      productMode: only.length ? 'include' : restricted.length ? 'exclude' : 'include',
      condition: 'qty',
      countMode: 'each',
      mode: r.tip === 'tamamla' ? 'roundup' : 'every',
      minQty: Math.max(1, +r.grup || 1),
      maxQty: 0,
      pureOnly: false,
      maxPerOrder: 0,
      minAmount: 0,
      rewards: [{ productId: '', qty: Math.max(1, +r.bonus || 1) }],
      rewardProductId: '',
      rewardQty: Math.max(1, +r.bonus || 1),
      start: '',
      end: '',
      templateId: r.tip === 'tamamla' ? 'roundup2' : 'custom',
      createdAt: new Date().toISOString(),
      createdBy: 'aktarım',
    };
    campaigns.push(c);
    report.campaigns.push(name);
  }

  // ---------------------------------------------------------------- günlük arşiv özetleri
  const days = [];
  const names = {};
  const seeName = (n, qty, date) => {
    const k = fold(n);
    const cur = names[k] || { raw: n, qty: 0, lines: 0, firstSeen: date };
    cur.qty += qty; cur.lines++; cur.lastSeen = !cur.lastSeen || date > cur.lastSeen ? date : cur.lastSeen;
    if (date < cur.firstSeen) cur.firstSeen = date;
    names[k] = cur;
  };
  for (const [date, day] of Object.entries(legacy.dailyHistory || {})) {
    if (!isYmd(date) || !day) continue;
    const entries = [];
    const mk = (sender, prods) => {
      const items = [], bonus = [];
      for (const [pn, v] of Object.entries(prods || {})) {
        const a = Math.max(0, Math.round(+v.adet || 0)), b = Math.max(0, Math.round(+v.bonus || 0));
        if (a) { items.push({ name: pn, qty: a }); seeName(pn, a, date); }
        if (b) bonus.push({ name: pn, qty: b });
      }
      if (!items.length && !bonus.length) return;
      entries.push({
        k: `hist|${nospace(sender)}`, summary: true, no: 'ARŞİV', date, sender, platform: platformOf(sender),
        items, bonus, orderCount: 0, source: 'kampanya-hesaplama', by: 'aktarım', at: legacy.savedAt || new Date().toISOString(),
        recipient: '', city: '', cargo: '', cargoCode: '', pages: 0, file: 'Eski sistem yedeği', checked: false,
      });
    };
    const sp = day.storeProducts && Object.keys(day.storeProducts).length ? day.storeProducts : null;
    if (sp) for (const [sn, prods] of Object.entries(sp)) mk(/mağaza yok/i.test(sn) ? 'Arşiv (mağaza bilgisi yok)' : canonStore(sn), prods);
    else mk('Arşiv (mağaza ayrımı yok)', day.products);
    // Günün toplam sipariş sayısı (mağaza bazında bilinmiyor)
    entries.push({ k: 'hist|__orders', summary: true, no: 'ARŞİV', date, sender: 'Arşiv (günlük sipariş sayısı)', platform: '', items: [], bonus: [], orderCount: Math.max(0, Math.round(+(day.totals && day.totals.orders) || 0)), source: 'kampanya-hesaplama', by: 'aktarım', at: legacy.savedAt || '', pages: 0, file: 'Eski sistem yedeği', checked: false });
    days.push({ date, orders: entries, totals: day.totals || null });
    report.archiveRows += entries.length;
  }
  days.sort((a, b) => a.date.localeCompare(b.date));
  report.days = days.length;

  // ---------------------------------------------------------------- mükerrer kontrolü için eski sipariş numaraları
  const legacyIndex = [];
  let shortSkipped = 0;
  for (const [no, date] of Object.entries(legacy.recordedOrders || {})) {
    if (!isYmd(date)) continue;
    const n = String(no).trim();
    if (/^\d{10,30}$/.test(n)) legacyIndex.push([n, date]);
    else shortSkipped++;
  }
  for (const o of legacy.customerOrders || []) {
    const n = String(o.siparisNo || '').trim();
    if (/^\d{10,30}$/.test(n) && isYmd(o.tarih)) legacyIndex.push([n, o.tarih]);
  }
  report.legacyOrders = legacyIndex.length;
  report.legacyShortSkipped = shortSkipped;

  return {
    config: { stores, products: finalProducts, campaigns },
    days,
    labelnames: names,
    legacyIndex,
    report,
  };
}
