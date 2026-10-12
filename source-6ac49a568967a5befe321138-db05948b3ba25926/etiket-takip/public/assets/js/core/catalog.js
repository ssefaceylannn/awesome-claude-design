// Ürün kataloğunu yapıştırılan listeyle değiştirme (SKU / Marka / Ürün [/ Kategori]).
// Mevcut ürünler SKU'dan, sonra addan eşleştirilir; kimlikleri (kampanya, eşleştirme,
// geçmiş) korunur. Saf fonksiyonlar — testlerde de kullanılır.
import { fold } from '../shared/text.js';
import { autoKeywords } from '../shared/matcher.js';

const nospace = (s) => fold(s).replace(/\s+/g, '');
const normSku = (s) => String(s || '').trim().toUpperCase().replace(/\s+/g, ' ');
const uniqLines = (lines) => { const seen = new Set(); return lines.map((l) => String(l || '').trim()).filter((l) => l && !seen.has(fold(l, '/')) && seen.add(fold(l, '/'))).join('\n'); };
const noiseSet = (noise) => new Set((noise || ['ultra', 'natura', 'hediyeli', 'hediye', 'kampanyali', 'x', 'adet', 'ml', 'gr']).map((w) => fold(w)));
const rid = () => 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// SKU ön ekinden kategori tahmini (yeni ürünler için)
const CAT_BY_PREFIX = {
  IC: 'İçecek & Mix', SHT: 'Shot', TAK: 'Takviye & Kapsül', GDA: 'Gıda & Kahve', SIK: 'Sirke',
  YAG: 'Bitkisel Yağ', OKO: 'Oda Kokusu', KOZ: 'Kozmetik & Bakım', AKS: 'Aksesuar',
};

const HEAD = {
  sku: /^(sku|stok ?kodu|stok|urun ?kodu|kod|barkod)$/,
  brand: /^(marka|brand)$/,
  name: /^(urun|urun ?adi|urunler|ad|product|product ?name|isim)$/,
  category: /^(kategori|category|grup|urun ?grubu)$/,
};

/**
 * Satırları ayrıştır: sekme (Excel'den kopyala) veya ; ile ayrılmış.
 * Başlık satırı varsa sütunlar ona göre bulunur (SKU / Marka / Ürün / Kategori, sıra fark etmez).
 * Başlık yoksa: 4 sütun = SKU, Marka, Ürün, Kategori · 3 = SKU, Marka, Ürün · 2 = SKU, Ürün · 1 = Ürün.
 * Dönen dizide ayrıca: .lines (boş olmayan satır sayısı), .repeats (tekrar eden satırlar), .header (başlık bulundu mu)
 */
export function parseProductList(text) {
  const rows = [];
  const seen = new Map();
  const repeats = [];
  let map = null, header = false, lines = 0;
  for (const line of String(text || '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    let cols = line.includes('\t') ? line.split('\t') : line.includes(';') ? line.split(';') : [line];
    cols = cols.map((c) => c.replace(/\s+/g, ' ').trim());
    if (!rows.length && !header) {
      const m = {};
      cols.forEach((c, i) => { for (const [k, re] of Object.entries(HEAD)) if (m[k] == null && re.test(fold(c))) m[k] = i; });
      if (m.name != null) { map = m; header = true; continue; }
    }
    lines++;
    let sku = '', brand = '', name = '', category = '';
    const at = (i) => (i == null ? '' : cols[i] || '');
    if (map) [sku, brand, name, category] = [at(map.sku), at(map.brand), at(map.name), at(map.category)];
    else if (cols.length >= 3) [sku, brand, name, category = ''] = cols;
    else if (cols.length === 2) [sku, name] = cols;
    else [name] = cols;
    if (!name) continue;
    const key = (normSku(sku) || '') + '|' + fold(brand) + '|' + nospace(name);
    if (seen.has(key)) { repeats.push({ line: lines, first: seen.get(key), sku, brand, name }); continue; } // aynı satır tekrar yapıştırılmışsa bir kez
    seen.set(key, lines);
    rows.push({ sku, brand, name, category });
  }
  return Object.assign(rows, { lines, repeats, header });
}

/**
 * @returns {{ products, kept:[{row, old}], added:[row], removed:[product], merged, remap:{eskiId: yeniId}, duplicates:[name] }}
 */
export function planCatalogReplace(existing, rows, noise, { mode = 'replace' } = {}) {
  const pool = [...existing];
  const take = (pred) => { const i = pool.findIndex(pred); return i >= 0 ? pool.splice(i, 1)[0] : null; };
  const kept = [], added = [], products = [];
  // 1. tur: aynı ad (+ aynı SKU), 2. tur: aynı ad + uyumlu marka — eski kayıtlarda yanlış SKU
  // olabilir (ör. Kabak Çekirdeği Yağı'nda Tatlı Badem'in SKU'su), ad eşleşmesi önceliklidir.
  // 3. tur: SKU (yeniden adlandırılmış ürünler: "Sinek Kovucu Koruyucu Sprey" → "Sivrisinek Kovucu").
  const brandOk = (r, p) => !r.brand || !p.brand || fold(p.brand) === fold(r.brand);
  const skuEq = (r, p) => r.sku && p.sku && normSku(p.sku) === normSku(r.sku);
  const matched = rows.map((r) => take((p) => nospace(p.name) === nospace(r.name) && skuEq(r, p)));
  rows.forEach((r, i) => { if (!matched[i]) matched[i] = take((p) => nospace(p.name) === nospace(r.name) && brandOk(r, p)); });
  rows.forEach((r, i) => { if (!matched[i] && r.sku) matched[i] = take((p) => skuEq(r, p)); });
  rows.forEach((r, i) => {
    const old = matched[i];
    const prefix = (r.sku.split('-')[0] || '').toUpperCase();
    if (old) {
      const next = { ...old, name: r.name, sku: r.sku || old.sku || '', brand: r.brand || old.brand || '', category: r.category || old.category || CAT_BY_PREFIX[prefix] || '' };
      // Ad değiştiyse: yeni ad + eski ad (etiketlerde hâlâ eski ad yazar) + mevcut kurallar
      if (autoKeywords(old.name, noise) !== autoKeywords(r.name, noise)) {
        const lines = (old.keywords || '').trim() ? old.keywords.split('\n') : [autoKeywords(old.name, noise)];
        next.keywords = uniqLines([autoKeywords(r.name, noise), ...lines]);
      }
      products.push(next);
      kept.push({ row: r, old });
    } else {
      products.push({ id: rid(), name: r.name, sku: r.sku, brand: r.brand, category: r.category || CAT_BY_PREFIX[prefix] || '', unit: 'adet', keywords: '', exclude: '', packMultiplier: false, active: true });
      added.push(r);
    }
  });
  if (mode === 'append') {
    // Mevcut katalog aynen kalır (sırası dahil); eşleşenlerin SKU/marka/kategorisi güncellenir, yeniler sona eklenir
    const upd = new Map(kept.map((k) => [k.old.id, products.find((p) => p.id === k.old.id)]));
    const addedIds = new Set(products.filter((p) => !existing.some((e) => e.id === p.id)).map((p) => p.id));
    const out = [...existing.map((p) => upd.get(p.id) || p), ...products.filter((p) => addedIds.has(p.id))];
    return { products: out, kept, added, removed: [], merged: 0, remap: {}, duplicates: dupNames(out), mode };
  }
  // Listede olmayan ama başka bir ürünün kopyası olan kayıtlar (ör. eski sistemden gelen
  // "Ham Kakao Tozu" ile "Ham Kakao Tozu - 125 gr"): eşleşme kelimeleri kalan ürüne taşınır,
  // kampanya/eşleştirme bağlantıları ona yönlendirilir.
  const remap = {};
  const toks = (name) => new Set(fold(name).split(' ').filter((t) => t && !/^\d/.test(t) && !(noiseSet(noise)).has(t)));
  const removed = [];
  for (const old of pool) {
    const mine = toks(old.name);
    if (!mine.size) { removed.push(old); continue; }
    const supers = products.filter((p) => [...mine].every((t) => toks(p.name).has(t) || (p.keywords || '').split('\n').some((l) => l.split(' ').some((g) => g.split('/').includes(t)))));
    const best = supers.filter((p) => nospace(p.name) === nospace(old.name))[0] || (supers.length === 1 ? supers[0] : null);
    if (!best) { removed.push(old); continue; }
    const lines = [
      ...((best.keywords || '').trim() ? best.keywords.split('\n') : [autoKeywords(best.name, noise)]),
      autoKeywords(old.name, noise),
      ...((old.keywords || '').trim() ? old.keywords.split('\n') : []),
    ];
    best.keywords = uniqLines(lines);
    remap[old.id] = best.id;
  }
  return { products, kept, added, removed, merged: Object.keys(remap).length, remap, duplicates: dupNames(products), mode };
}

function dupNames(products) {
  const counts = new Map();
  for (const p of products) counts.set(nospace(p.name), (counts.get(nospace(p.name)) || 0) + 1);
  return [...new Set(products.filter((p) => counts.get(nospace(p.name)) > 1).map((p) => p.name))];
}
