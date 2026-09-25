// Yeniden gönderim: pazaryeri sipariş detayından kopyalanan metni okur.
// Ürün satırları katalogla eşleştirilir (eşleştirme fonksiyonu dışarıdan verilir);
// sipariş no, alıcı ve tutarlar bulunursa alınır. Tarayıcıda ve testlerde çalışır.
import { fold } from './text.js';

/** "₺1.234,56" → 1234.56 */
export function parseMoney(s) {
  const m = String(s || '').replace(/\s/g, '').match(/-?\d[\d.]*(?:,\d{1,2})?/);
  if (!m) return null;
  const v = parseFloat(m[0].replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'));
  return Number.isFinite(v) ? v : null;
}

const AMOUNTS = [
  ['sale', /^sat[ıi][sş] tutar[ıi]/i],
  ['discount', /^sat[ıi]c[ıi] indirim tutar[ıi]/i],
  ['billed', /^faturalanacak tutar/i],
];
// Ürün adı olamayacak satırlar (başlıklar, tutarlar, kodlar)
const NOT_PRODUCT = /^(sat[ıi][sş]|sat[ıi]c[ıi]|faturalanacak|toplam|kargo|indirim|komisyon|birim fiyat|fiyat|tutar|barkod|stok kodu|sku|sipari[sş]|paket|al[ıi]c[ıi]|m[uü][sş]teri|adres|telefon|tarih|durum|fatura)\b/i;

const QTY_INLINE = [
  /(?:adet|miktar)\s*[:：]?\s*(\d{1,4})\b/i, // "Adet: 2"
  /\b(\d{1,4})\s*adet\b/i, // "2 Adet"
  /^\s*(\d{1,3})\s*[x×]\s+\S/i, // "2x Detox Shot" (etiket biçimi)
];
const qtyIn = (line) => { for (const re of QTY_INLINE) { const m = line.match(re); if (m) return +m[1]; } return null; };
// Başlıklar Türkçe küçük harfe çevrilmiş satırda aranır ("İndirim" → "indirim"); değer özgün satırdan alınır
const lower = (l) => l.toLocaleLowerCase('tr-TR');
const labelThenValue = (lines, i, re) => {
  const m = lower(lines[i]).match(new RegExp(re.source + '\\s*[:：]?\\s*(.*)$', 'i'));
  if (!m) return null;
  const v = lines[i].slice(m.index + m[0].length - m[m.length - 1].length).trim();
  if (v) return v;
  for (let j = i + 1; j < Math.min(lines.length, i + 3); j++) if (lines[j].trim()) return lines[j].trim();
  return null;
};

/** Metinde adı veya gönderici adı geçen mağaza (en uzun eşleşme) */
export function detectStore(text, stores) {
  const hay = fold(text);
  let best = null, len = 0;
  for (const st of stores || []) {
    for (const n of [st.name, ...(st.senders || [])]) {
      const k = fold(n);
      if (k.length > 3 && k.length > len && hay.includes(k)) { best = st; len = k.length; }
    }
  }
  return best;
}

/**
 * @param {string} text  Yapıştırılan metin
 * @param {(line:string)=>string|null} matchLine  Satırı katalog ürününe eşler (ürün kimliği ya da null)
 */
export function parseResendText(text, matchLine) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim());
  const out = { orderNo: '', recipient: '', amounts: {}, items: [] };

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!l) continue;
    for (const [key, re] of AMOUNTS) {
      if (out.amounts[key] == null && re.test(lower(l))) { const v = parseMoney(labelThenValue(lines, i, re)); if (v != null) out.amounts[key] = v; }
    }
    if (!out.orderNo) {
      const v = labelThenValue(lines, i, /^(?:sipari[sş]|paket)\s*(?:no|numaras[ıi]|numara)\.?/i);
      const m = v && v.match(/[A-Za-z0-9-]{4,}/);
      if (m) out.orderNo = m[0];
    }
    if (!out.recipient) {
      const v = labelThenValue(lines, i, /^(?:al[ıi]c[ıi]|m[uü][sş]teri)(?:\s*(?:ad[ıi]?\s*soyad[ıi]?|ad[ıi]|bilgisi))?/i);
      if (v && /\p{L}{2,}/u.test(v) && !/\d{5,}/.test(v)) out.recipient = v.slice(0, 120);
    }
  }
  if (!out.orderNo) {
    // Etiketsiz uzun numara (barkod/stok kodu satırları hariç)
    const l = lines.find((x) => /\b\d{8,}\b/.test(x) && !/barkod|stok|sku|tel|gsm|₺|tl\b/i.test(x));
    if (l) out.orderNo = l.match(/\b\d{8,}\b/)[0];
  }

  // Ürün satırları: katalogla eşleşen her satır bir ürün; adet aynı satırda ya da
  // sonraki satırlarda ("Adet" başlığının altındaki sayı dâhil) aranır.
  const found = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.length < 3 || NOT_PRODUCT.test(lower(l)) || /^[\d\s.,₺tl%-]+$/i.test(l)) continue;
    const productId = matchLine(l);
    if (productId) found.push({ i, raw: l, productId, qty: qtyIn(l) });
  }
  found.forEach((f, n) => {
    if (f.qty != null) return;
    const end = n + 1 < found.length ? found[n + 1].i : Math.min(lines.length, f.i + 8);
    for (let j = f.i + 1; j < end; j++) {
      const q = qtyIn(lines[j]);
      if (q != null) { f.qty = q; break; }
      if (/^(adet|miktar)\s*[:：]?$/i.test(lower(lines[j]))) {
        const next = lines.slice(j + 1, end).find(Boolean);
        if (next && /^\d{1,4}$/.test(next)) { f.qty = +next; break; }
      }
    }
  });
  // Aynı ürün birden çok satırda geçerse (ör. başlık + fatura satırı) bir kez alınır; açık adetler toplanır
  const byId = new Map();
  for (const f of found) {
    const cur = byId.get(f.productId);
    if (!cur) byId.set(f.productId, { productId: f.productId, raw: f.raw, qty: f.qty });
    else if (f.qty != null) cur.qty = (cur.qty || 0) + f.qty;
  }
  out.items = [...byId.values()].map((x) => ({ ...x, qty: Math.max(1, Math.min(9999, x.qty || 1)), qtyFound: x.qty != null }));
  return out;
}
