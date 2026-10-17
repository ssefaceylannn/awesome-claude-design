// Karma ayıklama: siparişleri seçilen kategorilere göre iki gruba ayırır.
//   only → siparişteki ürünlerin HEPSİ seçilen kategorilerde (ör. yalnızca İçecek & Mix: "Sadece Şişe")
//   rest → geri kalan her şey: seçilen kategorinin yanında başka kategoriden ürün olanlar,
//          seçilen kategoriden hiç ürün olmayanlar ve ürünü tanınmayan (eşleşmemiş) siparişler
// Tanınmayan ürün içeren sipariş asla "only" sayılmaz: yanlışlıkla şişe grubuna düşmesin.
import { fold } from './text.js';

export const DEFAULT_KARMA = { cats: ['İçecek & Mix'], only: 'Sadece Şişe', rest: 'Kutulu', split: true };

const catSet = (cats) => new Set((cats || []).map((c) => fold(c)).filter(Boolean));
const catOf = (id, ctx) => { const p = ctx.productsById.get(id); return p ? fold(p.category || '') : ''; };

/**
 * Ürün kimliklerinden grup. Kimliği "?" ile başlayan (eşleşmemiş) parça varsa → unmatched.
 * @returns {'only'|'mixed'|'none'|'unmatched'|'empty'}
 */
export function kindOfIds(ids, ctx, cats) {
  const set = catSet(cats);
  if (!ids.length) return 'empty';
  if (ids.some((id) => !id || String(id).startsWith('?') || !ctx.productsById.has(id))) return 'unmatched';
  if (!set.size) return 'none';
  const inside = ids.filter((id) => set.has(catOf(id, ctx))).length;
  return inside === ids.length ? 'only' : inside ? 'mixed' : 'none';
}

/** Bir siparişin (computeOrder sonucu) grubu. Kampanya hediyeleri etikette yazmadığı için hesaba katılmaz. */
export function classifyOrder(c, ctx, cats) {
  const lines = c.lines.filter((l) => !l.ignored && l.units);
  const ids = lines.map((l) => l.productId || '?' + l.raw);
  const kind = kindOfIds(ids, ctx, cats);
  return { kind, group: kind === 'only' ? 'only' : 'rest' };
}

export const KIND_LABEL = {
  only: 'Yalnızca seçilen kategori',
  mixed: 'Seçilen kategori + başka kategori',
  none: 'Seçilen kategoriden ürün yok',
  unmatched: 'Tanınmayan ürün var',
  empty: 'Ürün satırı okunamadı',
};
