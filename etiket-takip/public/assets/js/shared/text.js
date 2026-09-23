// Metin normalleştirme: hem tarayıcıda hem Netlify Functions'ta kullanılır.

const FOLD = { ı: 'i', ş: 's', ğ: 'g', ü: 'u', ö: 'o', ç: 'c', â: 'a', î: 'i', û: 'u', é: 'e', è: 'e', ä: 'a' };

export const trLower = (s) => String(s ?? '').toLocaleLowerCase('tr-TR');
export const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

function unit(num, u) {
  const v = parseFloat(num);
  const r = (x) => String(Math.round(x * 100) / 100);
  if (u === 'ml') return r(v) + 'ml';
  if (u === 'cl') return r(v * 10) + 'ml';
  if (u === 'lt' || u === 'litre' || u === 'l') return r(v * 1000) + 'ml';
  if (u === 'gr' || u === 'gram' || u === 'g') return r(v) + 'g';
  if (u === 'kg') return r(v * 1000) + 'g';
  return num + u;
}

/**
 * Karşılaştırma için sadeleştir: küçük harf, Türkçe karakterleri ASCII'ye çevir,
 * noktalama sil, birimleri birleştir ("500 ml" → "500ml", "1 lt" → "1000ml").
 * keep: korunacak ek karakterler (ör. "/" kural yazımı için)
 */
export function fold(s, keep = '') {
  let t = trLower(s).replace(/[ışğüöçâîûéèä]/g, (c) => FOLD[c]);
  t = t.normalize('NFKD').replace(/[̀-ͯ]/g, '');
  t = t.replace(/['’`´]/g, ''); // 7'li → 7li
  t = t.replace(/(\d),(\d)/g, '$1.$2');
  const allowed = new RegExp(`[^a-z0-9.${keep.replace(/[\\\]^-]/g, '\\$&')}]+`, 'g');
  t = t.replace(allowed, ' ');
  t = t.replace(/(^|[^\d])\.|\.(?!\d)/g, '$1 ');
  t = t.replace(/\b(\d+(?:\.\d+)?)\s*(ml|cl|lt|litre|l|gr|gram|g|kg)\b/g, (m, num, u) => unit(num, u));
  return t.replace(/\s+/g, ' ').trim();
}

export const tokens = (s) => fold(s).split(' ').filter(Boolean);

export function lev(a, b) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 2) return 3;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

/** Sipariş anahtarı: gönderici (mağaza) + sipariş no */
export const orderKey = (sender, orderNo) => `${fold(sender)}|${String(orderNo).trim()}`;

export function hashStr(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export const isYmd = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s));
