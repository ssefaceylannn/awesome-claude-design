// Karma ayıklama: siparişleri seçilen kategorilere ve/veya ürünlere göre gruplar.
//   only → siparişteki ürünlerin HEPSİ seçimde (ör. yalnızca İçecek & Mix: "Sadece Şişe")
//   rest → seçimdeki bir ürünün yanında seçim dışı ürün de olanlar ("Kutulu"); tanınmayan ürün
//          içerenler ve okunamayan sayfalar da burada kalır
//   none → seçimden hiç ürün olmayanlar ("Şişesiz") — yalnızca 3. grup açıksa; kapalıysa rest'e girer
// Tanınmayan ürün içeren sipariş asla "only" sayılmaz: yanlışlıkla şişe grubuna düşmesin.
import { fold } from './text.js';
import { provinceOf } from './cities.js';

export const DEFAULT_KARMA = { cats: ['İçecek & Mix'], productIds: [], names: { only: 'Sadece Şişe', rest: 'Kutulu', none: 'Şişesiz' }, third: false, cities: ['Düzce'] };

/** Sunucudaki ayar (eksik alanlar varsayılanla) */
export function karmaRule(k) {
  const d = DEFAULT_KARMA;
  const names = (k && k.names) || {};
  return {
    cats: Array.isArray(k && k.cats) ? k.cats : d.cats,
    productIds: Array.isArray(k && k.productIds) ? k.productIds : [],
    names: { only: names.only || d.names.only, rest: names.rest || d.names.rest, none: names.none || d.names.none },
    third: !!(k && k.third),
    cities: Array.isArray(k && k.cities) ? k.cities : d.cities,
  };
}

const inSel = (rule, ctx) => {
  const cats = new Set((rule.cats || []).map((c) => fold(c)).filter(Boolean));
  const ids = new Set(rule.productIds || []);
  return (id) => ids.has(id) || cats.has(fold((ctx.productsById.get(id) || {}).category || ''));
};
export const ruleEmpty = (rule) => !(rule.cats || []).length && !(rule.productIds || []).length;

/**
 * Ürün kimliklerinden tür. Kimliği "?" ile başlayan (eşleşmemiş) parça varsa → unmatched.
 * @returns {'only'|'mixed'|'none'|'unmatched'|'empty'}
 */
export function kindOfIds(ids, ctx, rule) {
  if (!ids.length) return 'empty';
  if (ids.some((id) => !id || String(id).startsWith('?') || !ctx.productsById.has(id))) return 'unmatched';
  if (ruleEmpty(rule)) return 'none';
  const has = inSel(rule, ctx);
  const inside = ids.filter(has).length;
  return inside === ids.length ? 'only' : inside ? 'mixed' : 'none';
}

/** Tür → grup (3. grup kapalıyken "none" da rest'e girer) */
export const groupOfKind = (kind, rule) => (kind === 'only' ? 'only' : kind === 'none' && rule.third ? 'none' : 'rest');

/** Bir siparişin (computeOrder sonucu) türü ve grubu. Kampanya hediyeleri etikette yazmadığı için hesaba katılmaz. */
export function classifyOrder(c, ctx, rule) {
  const ids = c.lines.filter((l) => !l.ignored && l.units).map((l) => l.productId || '?' + l.raw);
  const kind = kindOfIds(ids, ctx, rule);
  return { kind, group: groupOfKind(kind, rule) };
}

/** Ürün seçimde mi (ekranda rozet rengi için) */
export const productInRule = (id, ctx, rule) => inSel(rule, ctx)(id);

export const GROUPS = ['only', 'rest', 'none'];

/** Şehre göre: alıcı ili seçilen illerden biri mi. @returns {{kind:'in'|'out'|'nocity', group:'in'|'out', province}} */
export function classifyCity(cityText, rule) {
  const province = provinceOf(cityText);
  if (!province) return { kind: 'nocity', group: 'out', province };
  const set = new Set((rule.cities || []).map((c) => fold(c)));
  return set.has(fold(province)) ? { kind: 'in', group: 'in', province } : { kind: 'out', group: 'out', province };
}
export const CITY_KIND_LABEL = { in: 'Seçilen ilde', out: 'Başka ilde', nocity: 'İl okunamadı' };
export const KIND_LABEL = {
  only: 'Yalnızca seçilen ürünler',
  mixed: 'Seçilen + seçim dışı ürün',
  none: 'Seçilen üründen hiç yok',
  unmatched: 'Tanınmayan ürün var',
  empty: 'Ürün satırı okunamadı',
};
