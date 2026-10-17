// Kombinasyon analizi: aynı ürün + adet bileşimine sahip siparişleri gruplar.
// En az `min` siparişi olan bileşimler ayrı satırda, kalanlar "Karma Siparişler" altında toplanır.
// Ayrıca Trendyol "Gönderime Hazır" sayfasından kopyalanan grup metnini okur.
import { fold } from './text.js';
import { kindOfIds, groupOfKind, GROUPS } from './karma.js';

export const KARMA = 'Karma Siparişler';

/**
 * Siparişin bileşimi. computed = computeOrder() sonucu.
 * Ürün satırları birleştirilir (aynı ürün iki satırda → toplam adet); eşleşmeyen adlar "⚠ ad" olarak kalır.
 * includeRewards: kampanyayla eklenen ürünler de pakete dahil sayılır.
 */
export function comboOf(c, ctx, { includeRewards = false } = {}) {
  const parts = new Map();
  const add = (id, name, qty, order) => {
    const p = parts.get(id) || { id, name, qty: 0, order };
    p.qty += qty;
    parts.set(id, p);
  };
  const pos = new Map(ctx.products.map((p, i) => [p.id, i]));
  for (const l of c.lines) {
    if (l.ignored || !l.units) continue;
    if (l.productId) add(l.productId, ctx.label(l.productId), l.units, pos.get(l.productId) ?? 1e6);
    else add('?' + fold(l.raw), '⚠ ' + l.raw, l.units, 2e6);
  }
  if (includeRewards) for (const r of c.rewards) if (r.productId) add(r.productId, ctx.label(r.productId), r.qty, pos.get(r.productId) ?? 1e6);
  const list = [...parts.values()].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'tr'));
  return {
    key: list.map((p) => `${p.id}*${p.qty}`).join('+'),
    label: list.map((p) => `${p.name} x${p.qty}`).join(' + '),
    parts: list,
    units: list.reduce((s, p) => s + p.qty, 0),
  };
}

/**
 * @param computed computeOrder() sonuçları (arşiv özetleri hariç tutulmalı)
 * @returns {{ groups, karma, orders }} groups: en az `min` siparişli bileşimler (çoktan aza);
 *   karma: { orders, units, groups (karmaya düşen bileşimler), products (ürün toplamları),
 *            split: karmaRule verilirse [{ key:'only'|'rest'|'none', orders, units, groups }] (Sadece Şişe / Kutulu / Şişesiz) }
 */
export function analyzeCombos(computed, ctx, { min = 10, includeRewards = false, karmaRule = null } = {}) {
  const by = new Map();
  let orders = 0;
  for (const c of computed) {
    const cb = comboOf(c, ctx, { includeRewards });
    if (!cb.parts.length) continue;
    orders++;
    const g = by.get(cb.key) || { ...cb, orders: 0, refs: [] };
    g.orders++;
    g.refs.push(c.order);
    by.set(cb.key, g);
  }
  const all = [...by.values()].sort((a, b) => b.orders - a.orders || a.label.localeCompare(b.label, 'tr'));
  const groups = all.filter((g) => g.orders >= min);
  const small = all.filter((g) => g.orders < min);
  const products = new Map();
  for (const g of small) for (const p of g.parts) {
    const e = products.get(p.id) || { id: p.id, name: p.name, qty: 0, order: p.order };
    e.qty += p.qty * g.orders;
    products.set(p.id, e);
  }
  let split = null;
  if (karmaRule) {
    split = GROUPS.filter((k) => k !== 'none' || karmaRule.third).map((key) => ({ key, orders: 0, units: 0, groups: [] }));
    for (const g of small) {
      const key = groupOfKind(kindOfIds(g.parts.map((p) => p.id), ctx, karmaRule), karmaRule);
      const part = split.find((x) => x.key === key);
      part.orders += g.orders;
      part.units += g.units * g.orders;
      part.groups.push(g);
    }
  }
  return {
    orders,
    groups,
    karma: {
      split,
      orders: small.reduce((s, g) => s + g.orders, 0),
      units: small.reduce((s, g) => s + g.units * g.orders, 0),
      groups: small,
      products: [...products.values()].sort((a, b) => a.order - b.order || b.qty - a.qty),
    },
  };
}

// ------------------------------------------------------------------ yapıştırılan grup metni
// Trendyol "Gönderime Hazır" sayfası: her kartta "Ürün x2" satırları (birden çoksa "+" ile),
// ardından "N sipariş"; "Karma Siparişler" kartı ayrıca. (Eski "Kargo Triyaj" aracının mantığı.)
export function parseComboPaste(raw) {
  const lines = String(raw || '').replace(/ /g, ' ').replace(/×/g, 'x').replace(/\+/g, '\n')
    .split(/\r?\n/).map((l) => l.trim().replace(/^[•\-–—:]+|[•\-–—:]+$/g, '').trim()).filter(Boolean);
  const reSiparis = /^(\d+)\s*sipari[sş]$/i;
  const reNoise = [/^(\d+)\s*sipari[sş]\s*yak[ıi]nda\s*gecikecek$/i, /^PTT\s*Kargo\s*:?\s*(\d+)/i, /^(\d+)\s*acil$/i];
  const noise = (l) => reNoise.some((re) => re.test(l));
  const reProduct = /^(.+?)\s*x\s*(\d+)$/i;
  const reKarma = /^Karma\s*Sipari[sş]ler/i;
  const reKarmaTotal = /^Karma\s*Sipari[sş]ler.*?(\d+)\s*sipari[sş]/i;
  const cards = [];
  const unrecognized = [];
  let cur = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (reKarma.test(line)) {
      const km = line.match(reKarmaTotal);
      let total = km ? +km[1] : null;
      i++;
      while (i < lines.length) {
        const sm = lines[i].match(reSiparis);
        if (sm) { if (total == null) total = +sm[1]; i++; continue; }
        if (noise(lines[i])) { i++; continue; }
        break;
      }
      if (total != null) cards.push({ combo: KARMA, parts: [], total, karma: true });
      continue;
    }
    const sm = line.match(reSiparis);
    if (sm && cur.length) {
      i++;
      while (i < lines.length && noise(lines[i])) i++;
      cards.push({ combo: cur.map((p) => `${p.name} x${p.qty}`).join(' + '), parts: cur, total: +sm[1] });
      cur = [];
      continue;
    }
    const pm = line.match(reProduct);
    if (pm) { cur.push({ name: pm[1].trim(), qty: +pm[2] }); i++; continue; }
    unrecognized.push(line);
    i++;
  }
  return { cards, unrecognized };
}
