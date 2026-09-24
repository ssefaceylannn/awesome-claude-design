// Excel (.xlsx) sipariş listelerini okur ve etiket siparişleriyle aynı biçime çevirir.
// Sütunlar başlık adından bulunur; sıra farkı veya ek sütunlar sorun olmaz.
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
  status: ['siparis durumu', 'durum'],
};
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
 */
export async function readSheets(files, { dateMode = 'file', manualDate, onProgress } = {}) {
  await loadScript('/assets/vendor/exceljs.min.js');
  const list = [...files].sort((a, b) => collator.compare(a.name, b.name));
  const byKey = new Map();
  const log = [];
  let rowsRead = 0, skipped = 0, done = 0;
  for (const f of list) {
    try {
      const wb = new window.ExcelJS.Workbook();
      await wb.xlsx.load(await f.arrayBuffer());
      const fileDate = dateFromFileName(f.name);
      let found = false;
      wb.eachSheet((ws) => {
        // Başlık satırını ilk 10 satırda ara
        let hRow = 0, map = null;
        for (let r = 1; r <= Math.min(10, ws.rowCount) && !map; r++) {
          const heads = {};
          ws.getRow(r).eachCell((c, col) => { heads[fold(cellText(c.value))] = col; });
          const m = {};
          for (const [k, names] of Object.entries(COLS)) { const n = names.find((x) => heads[x]); if (n) m[k] = heads[n]; }
          if (m.products && (m.orderNo || m.tracking)) { map = m; hRow = r; }
        }
        if (!map) return;
        found = true;
        for (let r = hRow + 1; r <= ws.rowCount; r++) {
          const row = ws.getRow(r);
          const g = (k) => (map[k] ? cellText(row.getCell(map[k]).value) : '');
          const products = g('products');
          const orderNo = String(g('orderNo')).replace(/\s+/g, '');
          const tracking = String(g('tracking')).replace(/\s+/g, '');
          if (!products && !orderNo && !tracking) continue;
          rowsRead++;
          if (SKIP_STATUS.test(fold(g('status')))) { skipped++; continue; }
          const store = g('store') || g('platform') || 'Excel';
          // Etiket PDF'indeki üst numara = kargo takip no → aynı paket PDF ve Excel'den iki kez sayılmaz
          const key = tracking || orderNo;
          if (!key) continue;
          const date = dateMode === 'manual' ? manualDate : dateMode === 'today' ? today() : dateMode === 'platform' ? (toYmd(g('date')) || fileDate || today()) : (fileDate || today());
          const items = parseItems(products, g('qty'));
          const k = fold(store) + '|' + key;
          const prev = byKey.get(k);
          if (prev) { // aynı sipariş birden çok satırda (satır başına bir ürün biçimi)
            for (const it of items) { const ex = prev.items.find((x) => x.name === it.name); if (ex) ex.qty += it.qty; else prev.items.push(it); }
            continue;
          }
          const rawAmt = String(g('amount')).replace(/[^\d.,-]/g, '');
          const amount = /^-?\d+(\.\d+)?$/.test(rawAmt) ? parseFloat(rawAmt) : parseFloat(rawAmt.replace(/\./g, '').replace(',', '.')) || 0;
          byKey.set(k, {
            orderNo: key,
            platformOrderNo: orderNo,
            packageNo: String(g('packageNo')),
            sender: store,
            platform: fold(g('platform')).replace(/\s/g, ''),
            recipient: g('customer'),
            city: [g('district'), g('city')].filter(Boolean).join(' / '),
            cargo: g('cargo'),
            cargoCode: String(g('barcode') || tracking).replace(/\s+/g, ''),
            amount,
            items,
            pages: 1,
            file: f.name,
            date,
            source: 'excel',
            startsAsContinuation: false,
            orphan: false,
            warnings: items.length === 1 && !/ x\d+$/.test(products.trim()) ? ['Ürün adedi ayrıştırılamadı, toplam adet kullanıldı'] : [],
          });
        }
      });
      if (!found) log.push({ type: 'error', msg: `${f.name}: “Ürünler” ve “Sipariş No / Kargo Takip No” sütunları bulunamadı.` });
    } catch (e) {
      console.error(e);
      log.push({ type: 'error', msg: `${f.name}: okunamadı (${e.message || e}). Yalnızca .xlsx desteklenir.` });
    }
    onProgress && onProgress(++done, list.length);
  }
  if (skipped) log.push({ type: 'warn', msg: `${skipped} iptal/iade satırı atlandı.` });
  return { orders: [...byKey.values()], log, rows: rowsRead, files: list.map((f) => f.name) };
}
