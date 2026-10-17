// Karma ayıklama ayarları (seçilen kategoriler ve grup adları) — bu tarayıcıda saklanır.
// Hem "Karma Ayıklama" sayfası hem Kombinasyon Analizi'ndeki karma satırı aynı ayarı kullanır.
import { DEFAULT_KARMA } from '../shared/karma.js';
import { KARMA } from '../shared/combos.js';

const KEY = 'et-karma';
export function karmaPref() {
  let p = {};
  try { p = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { /* yok */ }
  const name = (v, d) => String(v || '').trim().slice(0, 40) || d;
  return {
    cats: Array.isArray(p.cats) ? p.cats.map(String).filter(Boolean).slice(0, 20) : DEFAULT_KARMA.cats,
    only: name(p.only, DEFAULT_KARMA.only),
    rest: name(p.rest, DEFAULT_KARMA.rest),
    split: p.split !== false,
  };
}
export function saveKarmaPref(patch) {
  try { localStorage.setItem(KEY, JSON.stringify({ ...karmaPref(), ...patch })); } catch { /* yok */ }
}
/** Kombinasyon listesindeki satır adı: "Karma Siparişler – Sadece Şişe" */
export const karmaLabel = (key, p = karmaPref()) => `${KARMA} – ${key === 'only' ? p.only : p.rest}`;
