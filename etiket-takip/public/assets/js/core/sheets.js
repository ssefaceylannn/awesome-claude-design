// Excel (.xlsx) ve CSV sipariş listelerini okur ve etiket siparişleriyle aynı biçime çevirir.
// Sütunlar başlık adından bulunur; sıra farkı veya ek sütunlar sorun olmaz.
// Hepsiburada "Gönderime Hazır" dışa aktarımı ayrıca tanınır: satır başına bir ürün kalemi,
// paket numarası = sipariş. Mağaza sütunu yok: başlığın üstündeki ilk hücreye (A1) mağaza adı
// yazılır (ör. "Momordica"); yazılmamışsa yüklerken sorulur.
import { loadScript, collator, today } from './ui.js';
import { dateFromFileName } from '../shared/parser.js';
import { fold } from '../shared/text.js';

const COLS = {
  orderNo: ['siparis no', 'siparis numarasi', 'order no', 'order number', 'siparis id'],
  packageNo: ['paket no', 'paket numarasi', 'package no'],
  store: ['magaza', 'magaza adi', 'store', 'satici'],
  platform: ['platform', 'kanal', 'pazaryeri'],
  customer: ['musteri adi', 'musteri', 'alici', 'alici adi', 'ad soyad'],
  city: ['sehir', 'il'],
  district: ['ilce'],
  cargo: ['kargo firmasi', 'kargo', 'kargo sirketi'],
  tracking: ['kargo takip no', 'takip no', 'kargo takip numarasi', 'tracking number'],
  barcode: ['ptt barkod', 'kargo barkod', 'kargo barkodu', 'gonderi barkodu'],
  products: ['urunler', 'urun', 'urun adi', 'urun adlari'],
  qty: ['toplam adet', 'adet', 'miktar'],
  amount: ['toplam tutar', 'tutar', 'siparis tutari'],
  date: ['platform tarihi', 'siparis tarihi', 'tarih', 'olusturma tarihi'],
  status: ['siparis durumu', 'durum', 'paket durumu'],
};
// Hepsiburada dosyasına özel sütunlar (başka dosyalarda "Barkod" ürün barkodu olabileceği için yalnızca burada)
const HB_COLS = {
  barcode: ['barkod'],
  amount: ['faturalandirilacak satis fiyati'],
  district: ['semt', 'ilce'],
  sku: ['satici stok kodu'],
};
const isHepsiburada = (heads) => !!(heads['hepsiburada urun kodu'] || (heads['paket numarasi'] && heads['kalem numarasi']));
const SKIP_STATUS = /iptal|iade|cancel|return/;
// "Okyanus Oda Kokusu OK, one size x1, Lavanta Oda Kokusu LK, one size x2"
const ITEM_RE = /(.+?) x(\d+)(?:, |$)/g;

function cellText(v) {
  if (v == null) return '';
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map((r) => r.text).join('');
    if (v.text != null) return String(v.text);
    if (v.result != null) return String(v.result);
    if (v.hyperlink) return String(v.text || v.hyperlink);
  }
  return String(v).trim();
}

/** CSV (; , veya sekme ile ayrılmış, tırnaklı alanlar) → satır dizileri */
export function parseCsv(text) {
  const t = String(text || '').replace(/^\uFEFF/, '');
  const first = t.split(/\r?\n/).find((l) => l.trim()) || '';
  const delim = [';', '\t', ','].map((d) => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) {
      if (ch === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch;
    } else if (ch === '"' && cell === '') q = true;
    else if (ch === delim) { row.push(cell.trim()); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && t[i + 1] === '\n') i++;
      row.push(cell.trim()); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell.trim()); rows.push(row); }
  return rows;
}

/** Dosyayı tablolara çevir: Excel'de her sayfa bir tablo, CSV tek tablo */
async function fileTables(f) {
  if (/\.(csv|txt)$/i.test(f.name)) {
    const buf = await f.arrayBuffer();
    let text = new TextDecoder('utf-8').decode(buf);
    if (text.includes('\uFFFD')) text = new TextDecoder('windows-1254').decode(buf); // eski Excel'in Türkçe CSV'si
    return [parseCsv(text)];
  }
  await loadScript('/assets/vendor/exceljs.min.js');
  const wb = new window.ExcelJS.Workbook();
  await wb.xlsx.load(await f.arrayBuffer());
  const out = [];
  wb.eachSheet((ws) => {
    const rows = [];
    for (let r = 1; r <= ws.rowCount; r++) {
      const a = [];
      ws.getRow(r).eachCell({ includeEmpty: true }, (c, col) => { a[col - 1] = cellText(c.value); });
      rows.push(a);
    }
    out.push(rows);
  });
  return out;
}

const money = (v) => {
  const raw = String(v || '').replace(/[^\d.,-]/g, '');
  return /^-?\d+(\.\d+)?$/.test(raw) ? parseFloat(raw) : parseFloat(raw.replace(/\.(?=\d{3}(\D|$))/g, '').replace(/\.(?=.*,)/g, '').replace(',', '.')) || 0;
};

function toYmd(v) {
  if (v instanceof Date && !isNaN(v)) return v.toISOString().slice(0, 10);
  const s = String(v || '');
  let m = s.match(/(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
}

export function parseItems(text, totalQty) {
  const s = String(text || '').trim();
  if (!s) return [];
  const items = [];
  let covered = '';
  for (const m of s.matchAll(ITEM_RE)) { items.push({ name: m[1].trim(), qty: parseInt(m[2], 10) || 1 }); covered += m[0]; }
  if (items.length && covered.replace(/, $/, '') === s) return items;
  return [{ name: s, qty: parseInt(totalQty, 10) || 1 }];
}

/**
 * @param {File[]} files
 * @param {{dateMode:'file'|'today'|'manual'|'platform', manualDate}} opt
 * Hepsiburada siparişleri `needStore` ile döner (mağaza adı dosyada yok; yüklerken seçilir).
 */
export async function readSheets(files, { dateMode = 'file', manualDate, onProgress } = {}) {
  const list = [...files].sort((a, b) => collator.compare(a.name, b.name));
  const byKey = new Map();
  const log = [];
  let rowsRead = 0, skipped = 0, done = 0;
  for (const f of list) {
    try {
      const fileDate = dateFromFileName(f.name);
      let found = false;
      for (const rows of await fileTables(f)) {
        const res = readTable(rows, f.name, fileDate, { dateMode, manualDate }, byKey);
        if (!res) continue;
        found = true;
        rowsRead += res.rows;
        skipped += res.skipped;
      }
      if (!found) log.push({ type: 'error', msg: `${f.name}: “Ürünler” ve “Sipariş No / Kargo Takip No” sütunları bulunamadı.` });
    } catch (e) {
      console.error(e);
      log.push({ type: 'error', msg: `${f.name}: okunamadı (${e.message || e}). .xlsx veya .csv desteklenir.` });
    }
    onProgress && onProgress(++done, list.length);
  }
  if (skipped) log.push({ type: 'warn', msg: `${skipped} iptal/iade satırı atlandı.` });
  return { orders: [...byKey.values()], log, rows: rowsRead, files: list.map((f) => f.name) };
}

/** Tek tablo (sayfa/CSV): başlık satırını bul, siparişleri byKey'e ekle. Başlık yoksa null. */
export function readTable(rows, fileName, fileDate, { dateMode = 'file', manualDate } = {}, byKey = new Map()) {
  // Başlık satırını ilk 10 satırda ara
  let hRow = -1, map = null, hb = false;
  for (let r = 0; r < Math.min(10, rows.length) && !map; r++) {
    const heads = {};
    (rows[r] || []).forEach((c, col) => { const k = fold(c instanceof Date ? '' : c); if (k && heads[k] == null) heads[k] = col; });
    hb = isHepsiburada(heads);
    const m = {};
    for (const [k, names] of Object.entries(hb ? { ...COLS, ...HB_COLS } : COLS)) { const nm = names.find((x) => heads[x] != null); if (nm) m[k] = heads[nm]; }
    if (m.products != null && (m.orderNo != null || m.tracking != null)) { map = m; hRow = r; }
  }
  if (!map) return null;
  // Hepsiburada: başlığın üstündeki ilk dolu hücre = mağaza adı (kullanıcı A1'e yazar)
  let storeHint = '';
  if (hb) for (let r = 0; r < hRow && !storeHint; r++) storeHint = String((rows[r] || []).find((c) => String(c || '').trim()) || '').trim().slice(0, 80);
  let count = 0, skipped = 0;
  for (let r = hRow + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const g = (k) => (map[k] != null && row[map[k]] != null ? row[map[k]] : '');
    const products = String(g('products')).trim();
    const orderNo = String(g('orderNo')).replace(/\s+/g, '');
    const tracking = String(g('tracking')).replace(/\s+/g, '');
    const packageNo = String(g('packageNo')).replace(/\s+/g, '');
    if (!products && !orderNo && !tracking) continue;
    count++;
    if (SKIP_STATUS.test(fold(g('status')))) { skipped++; continue; }
    const store = hb ? '' : (g('store') || g('platform') || 'Excel');
    // Etiket PDF'indeki üst numara = kargo takip no → aynı paket PDF ve Excel'den iki kez sayılmaz.
    // Hepsiburada: kargolanan birim paket olduğu için paket numarası.
    const key = hb ? (packageNo || orderNo) : (tracking || orderNo);
    if (!key) continue;
    const date = dateMode === 'manual' ? manualDate : dateMode === 'today' ? today() : dateMode === 'platform' ? (toYmd(g('date')) || fileDate || today()) : (fileDate || today());
    // Hepsiburada: her satır tek ürün kalemi, adet kendi sütununda (ürün adındaki "10 Adet" adet değildir)
    const items = hb ? (products ? [{ name: products, qty: Math.max(1, parseInt(g('qty'), 10) || 1) }] : []) : parseItems(products, g('qty'));
    const k = (hb ? 'hb:' + fileName : fold(store)) + '|' + key;
    const prev = byKey.get(k);
    if (prev) { // aynı sipariş birden çok satırda (satır başına bir ürün biçimi)
      for (const it of items) { const ex = prev.items.find((x) => x.name === it.name); if (ex) ex.qty += it.qty; else prev.items.push(it); }
      if (hb) prev.amount = Math.round((prev.amount + money(g('amount'))) * 100) / 100;
      continue;
    }
    byKey.set(k, {
      orderNo: key,
      platformOrderNo: orderNo,
      packageNo,
      sender: store,
      platform: hb ? 'hepsiburada' : fold(g('platform')).replace(/\s/g, ''),
      recipient: String(g('customer')),
      city: [g('district'), g('city')].filter(Boolean).join(' / '),
      cargo: String(g('cargo')),
      cargoCode: String(g('barcode') || tracking).replace(/\s+/g, ''),
      amount: money(g('amount')),
      items,
      pages: 1,
      file: fileName,
      date,
      source: 'excel',
      startsAsContinuation: false,
      orphan: false,
      ...(hb ? { needStore: fileName, storeHint } : {}),
      warnings: !hb && items.length === 1 && !/ x\d+$/.test(products) ? ['Ürün adedi ayrıştırılamadı, toplam adet kullanıldı'] : [],
    });
  }
  return { rows: count, skipped, hb };
}
