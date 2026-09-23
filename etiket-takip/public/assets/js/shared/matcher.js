// Ürün eşleştirme motoru.
//
// Etiketteki ürün adı ("ULTRA NATURA Detox Shot Zencefilli 60ml 7'li Hediyeli")
// katalogdaki ürüne ("Detox Shot") şu sırayla eşlenir:
//   1. Elle yapılmış eşleştirme (aliases) — her zaman önceliklidir.
//   2. Otomatik: her ürünün anahtar kelime kurallarının TÜM kelimeleri etiket
//      adında geçmelidir. Birden fazla ürün uyarsa en çok kelimesi tutan
//      (en özel) kazanır: "Detox Shot" (2 kelime) > "Detox" (1 kelime).
//      Birebir kelime eşleşmesi, ekli eşleşmeden ("zencefil" ~ "zencefilli") güçlüdür.
//      "Detox Mix" ile "Detox Shot" birbirine asla karışmaz, çünkü "mix" ve
//      "shot" zorunlu kelimelerdir. Eşit puanlı iki farklı ürün → belirsiz,
//      elle eşleştirme istenir.
//   3. Hariç kelimeler: ürünün "hariç" listesindeki bir kelime geçiyorsa o
//      ürün aday olamaz.
import { fold, lev } from './text.js';

export const DEFAULT_NOISE = [
  'ultra', 'natura', 'ultranatura', 'dogal', 'hediyeli', 'hediye', 'yeni', 'kampanya', 'kampanyali',
  'indirim', 'indirimli', 'firsat', 'orijinal', 'orjinal', 'urun', 'urunu', 'adet', 'paket', 'paketi',
  've', 'ile', 'icin', 'ozel', 'super', 'avantajli', 'ekonomik', 'katkisiz', 'koruyucusuz', 'x',
];

export const IGNORE = '__ignore';

const tokenHit = (kw, tok) => {
  if (kw === tok) return true;
  // Türkçe ek: "sirke" ~ "sirkesi", "shot" ~ "shotu", "toz" ~ "tozu"
  if (kw.length >= 3 && tok.startsWith(kw) && tok.length - kw.length <= 4 && !/\d/.test(kw)) return true;
  // Yazım hatası: 5+ harfli kelimede 1 harf farkı
  if (kw.length >= 5 && !/\d/.test(kw) && lev(kw, tok) <= 1) return true;
  return false;
};

/** Ürün adından otomatik anahtar kelime kuralı üret */
export function autoKeywords(name, noise) {
  const ns = noise instanceof Set ? noise : new Set((noise || DEFAULT_NOISE).map((w) => fold(w)));
  return fold(name)
    .split(' ')
    .filter((t) => t && !ns.has(t))
    .map((t) => {
      const alts = new Set([t]);
      if (t.includes('x')) alts.add(t.replace(/x/g, 'ks')); // detox / detoks
      if (t.includes('ks')) alts.add(t.replace(/ks/g, 'x'));
      return [...alts].join('/');
    })
    .join(' ');
}

/** "detox/detoks shot" → [[["detox","detoks"],["shot"]]] (satır = alternatif kural) */
export function parseRules(text) {
  return String(text || '')
    .split(/\n|;/)
    .map((line) => fold(line, '/'))
    .filter(Boolean)
    .map((line) =>
      line
        .split(' ')
        .map((g) => g.split('/').filter(Boolean))
        .filter((g) => g.length),
    )
    .filter((r) => r.length);
}

function detectPack(toks) {
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    let m = t.match(/^(\d{1,3})(li|lu)$/);
    if (m) return +m[1];
    m = t.match(/^(\d{1,3})x$/) || t.match(/^x(\d{1,3})$/);
    if (m) return +m[1];
    if (/^\d{1,3}$/.test(t) && ['adet', 'x', 'li', 'lu', 'pcs'].includes(toks[i + 1])) return +t;
    if (t === 'x' && /^\d{1,3}$/.test(toks[i + 1] || '')) return +toks[i + 1];
  }
  return 1;
}

export function createMatcher(config) {
  const noise = new Set(((config.settings && config.settings.noiseWords) || DEFAULT_NOISE).map((w) => fold(w)));
  const products = (config.products || []).filter((p) => p.active !== false);
  const entries = products.map((p) => ({
    p,
    rules: parseRules(p.keywords && p.keywords.trim() ? p.keywords : autoKeywords(p.name, noise)),
    excl: fold(p.exclude || '').split(' ').filter(Boolean),
  }));
  const aliases = config.aliases || {};
  const byId = new Map(products.map((p) => [p.id, p]));
  const cache = new Map();

  function auto(key) {
    const toks = key.split(' ').filter(Boolean);
    const cands = [];
    for (const e of entries) {
      if (e.excl.some((x) => toks.some((t) => tokenHit(x, t)))) continue;
      let best = null;
      for (const rule of e.rules) {
        const used = new Set();
        let score = 0;
        const ok = rule.every((alts) => {
          // Önce birebir kelime, yoksa ekli/yazım hatalı kelime (daha düşük puan)
          for (const kw of alts) {
            const i = toks.findIndex((t, j) => !used.has(j) && t === kw);
            if (i >= 0) { used.add(i); score += 100; return true; }
          }
          for (const kw of alts) {
            const i = toks.findIndex((t, j) => !used.has(j) && tokenHit(kw, t));
            if (i >= 0) { used.add(i); score += 70; return true; }
          }
          return false;
        });
        if (!ok) continue;
        if (!best || score > best.score) best = { score, used };
      }
      if (best) cands.push({ id: e.p.id, name: e.p.name, score: best.score, used: best.used });
    }
    cands.sort((a, b) => b.score - a.score);
    const significant = toks.filter((t) => !noise.has(t) && !/^\d+(\.\d+)?(ml|g)?$/.test(t) && !/^\d+(li|lu|x)$/.test(t));
    if (!cands.length) return { productId: null, method: 'none', confidence: 0, candidates: [] };
    if (cands.length > 1 && cands[0].score === cands[1].score && cands[0].id !== cands[1].id) {
      return { productId: null, method: 'ambiguous', confidence: 0, candidates: cands.slice(0, 4).map((c) => c.id) };
    }
    const top = cands[0];
    const covered = significant.filter((t) => toks.indexOf(t) >= 0 && top.used.has(toks.indexOf(t))).length;
    const confidence = significant.length ? Math.min(1, covered / significant.length) : 1;
    const p = byId.get(top.id);
    return {
      productId: top.id,
      method: 'auto',
      confidence,
      multiplier: p && p.packMultiplier ? detectPack(toks) : 1,
      candidates: cands.slice(0, 4).map((c) => c.id),
    };
  }

  function match(raw) {
    const key = fold(raw);
    if (cache.has(key)) return cache.get(key);
    let res;
    const al = aliases[key];
    if (al && (al.productId === IGNORE || byId.has(al.productId))) {
      res = al.productId === IGNORE
        ? { productId: null, ignored: true, method: 'manual', confidence: 1, multiplier: 1, candidates: [] }
        : { productId: al.productId, method: 'manual', confidence: 1, multiplier: Math.max(1, +al.multiplier || 1), candidates: [] };
    } else {
      res = auto(key);
      if (!res.multiplier) res.multiplier = 1;
    }
    res.key = key;
    cache.set(key, res);
    return res;
  }

  match.products = byId;
  return match;
}
