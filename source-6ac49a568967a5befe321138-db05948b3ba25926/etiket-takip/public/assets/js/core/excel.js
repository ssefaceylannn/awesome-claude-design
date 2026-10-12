// Biçimlendirilmiş Excel (.xlsx) çıktıları — ExcelJS ile.
import { loadScript, download, trDate, trDateTime, pLabel, rangeLabel } from './ui.js';
import { productionRows } from '../shared/calc.js';

const GREEN = 'FF166534';
const GREEN_LIGHT = 'FFECF7EF';
const GRAY = 'FFF3F5F4';
const thin = { style: 'thin', color: { argb: 'FFD0D7D3' } };
const border = { top: thin, left: thin, bottom: thin, right: thin };

async function lib() {
  await loadScript('/assets/vendor/exceljs.min.js');
  return window.ExcelJS;
}

function header(ws, row, labels) {
  const r = ws.getRow(row);
  labels.forEach((l, i) => {
    const c = r.getCell(i + 1);
    c.value = l;
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREEN } };
    c.alignment = { vertical: 'middle', horizontal: i === 0 ? 'left' : 'center', wrapText: true };
    c.border = border;
  });
  r.height = 22;
}

function title(ws, text, sub, cols) {
  ws.mergeCells(1, 1, 1, cols);
  const t = ws.getCell(1, 1);
  t.value = text;
  t.font = { bold: true, size: 15, color: { argb: GREEN } };
  ws.getRow(1).height = 24;
  ws.mergeCells(2, 1, 2, cols);
  const s = ws.getCell(2, 1);
  s.value = sub;
  s.font = { size: 10, color: { argb: 'FF5F6B65' } };
}

function body(ws, startRow, rows, numCols = []) {
  rows.forEach((vals, i) => {
    const r = ws.getRow(startRow + i);
    vals.forEach((v, j) => {
      const c = r.getCell(j + 1);
      c.value = v;
      c.border = border;
      if (numCols.includes(j)) { c.numFmt = '#,##0'; c.alignment = { horizontal: 'right' }; }
      if (i % 2 === 1) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GRAY } };
    });
  });
}

function totalRow(ws, row, vals, numCols = []) {
  const r = ws.getRow(row);
  vals.forEach((v, j) => {
    const c = r.getCell(j + 1);
    c.value = v;
    c.font = { bold: true };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREEN_LIGHT } };
    c.border = { ...border, top: { style: 'medium', color: { argb: GREEN } } };
    if (numCols.includes(j)) { c.numFmt = '#,##0'; c.alignment = { horizontal: 'right' }; }
  });
}

/**
 * Üretim / sevk listesi. İlk sayfa tam olarak istenen biçimde:
 * katalog sırasına göre "Ürün | Gönderilecek Adet".
 */
export async function exportProduction({ R, ctx, from, to, filterLabel, includeZero, user, company }) {
  const ExcelJS = await lib();
  const wb = new ExcelJS.Workbook();
  wb.creator = user || 'Etiket Takip';
  wb.created = new Date();
  const rows = productionRows(R, ctx, { includeZero });
  const sub = `${rangeLabel(from, to)} · ${filterLabel} · ${R.orders} sipariş · Oluşturma: ${trDateTime(new Date().toISOString())}${user ? ' · ' + user : ''}`;

  // 1) Üretim listesi (ürün + son gönderilecek adet)
  const ws = wb.addWorksheet('Üretim Listesi', { views: [{ state: 'frozen', ySplit: 3 }], pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  ws.columns = [{ width: 48 }, { width: 22 }];
  title(ws, `${company ? company + ' — ' : ''}Üretim / Sevk Listesi`, sub, 2);
  header(ws, 3, ['Ürün', 'Gönderilecek Adet']);
  body(ws, 4, rows.map((r) => [ctx.labelOf(r.product), r.total]), [1]);
  totalRow(ws, 4 + rows.length, ['TOPLAM', rows.reduce((s, r) => s + r.total, 0)], [1]);
  for (let i = 4; i < 4 + rows.length; i++) ws.getCell(i, 2).font = { bold: true, size: 12 };
  if (R.unmatched.size) {
    const r0 = 6 + rows.length;
    ws.mergeCells(r0, 1, r0, 2);
    const c = ws.getCell(r0, 1);
    c.value = `⚠ ${R.unmatched.size} ürün adı eşleşmedi (${[...R.unmatched.values()].reduce((s, u) => s + u.units, 0)} adet) — listede yok. Ayrıntı: "Eşleşmeyen" sayfası.`;
    c.font = { bold: true, color: { argb: 'FFB45309' } };
  }

  // 2) Detay
  const wd = wb.addWorksheet('Detay', { views: [{ state: 'frozen', ySplit: 3 }] });
  wd.columns = [{ width: 7 }, { width: 44 }, { width: 18 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }];
  title(wd, 'Ürün detayı', sub, 7);
  header(wd, 3, ['Sıra', 'Ürün', 'Kategori', 'Etiket Adedi', 'Kampanya', 'Toplam', 'Sipariş']);
  body(wd, 4, rows.map((r, i) => [i + 1, ctx.labelOf(r.product), r.product.category || '', r.labelUnits, r.campaignUnits, r.total, r.orders]), [3, 4, 5, 6]);
  totalRow(wd, 4 + rows.length, ['', 'TOPLAM', '', R.labelUnits - [...R.unmatched.values()].reduce((s, u) => s + u.units, 0), R.campaignUnits, rows.reduce((s, r) => s + r.total, 0), R.orders], [3, 4, 5, 6]);

  // 3) Mağaza × ürün
  const stores = [...R.stores.values()];
  const wm = wb.addWorksheet('Mağaza Bazında', { views: [{ state: 'frozen', xSplit: 1, ySplit: 3 }] });
  wm.columns = [{ width: 40 }, ...stores.map(() => ({ width: 16 })), { width: 14 }];
  title(wm, 'Mağaza bazında gönderilecek adetler', sub, stores.length + 2);
  header(wm, 3, ['Ürün', ...stores.map((s) => (s.store ? `${s.store.name} (${pLabel(s.platform)})` : s.archive ? s.sender : `Tanımsız: ${s.sender}`)), 'Toplam']);
  body(wm, 4, rows.map((r) => [ctx.labelOf(r.product), ...stores.map((s) => s.products.get(r.product.id) || 0), r.total]), stores.map((_, i) => i + 1).concat(stores.length + 1));
  totalRow(wm, 4 + rows.length, ['TOPLAM', ...stores.map((s) => rows.reduce((a, r) => a + (s.products.get(r.product.id) || 0), 0)), rows.reduce((s, r) => s + r.total, 0)], stores.map((_, i) => i + 1).concat(stores.length + 1));

  // 4) Mağaza özeti
  const wo = wb.addWorksheet('Mağaza Özeti');
  wo.columns = [{ width: 34 }, { width: 14 }, { width: 12 }, { width: 14 }, { width: 18 }, { width: 16 }, { width: 14 }];
  title(wo, 'Mağaza özeti', sub, 7);
  header(wo, 3, ['Mağaza', 'Platform', 'Sipariş', 'Etiket Adedi', 'Kampanyalı Sipariş', 'Kampanya Adedi', 'Toplam']);
  body(wo, 4, stores.map((s) => [s.store ? s.store.name : s.archive ? s.sender : `Tanımsız: ${s.sender}`, pLabel(s.platform), s.orders, s.labelUnits, s.campaignOrders, s.campaignUnits, s.labelUnits + s.campaignUnits]), [2, 3, 4, 5, 6]);
  totalRow(wo, 4 + stores.length, ['TOPLAM', '', R.orders, R.labelUnits, R.campaignOrders, R.campaignUnits, R.totalUnits], [2, 3, 4, 5, 6]);

  // 5) Kampanyalar
  const camps = [...R.campaigns.entries()];
  if (camps.length) {
    const wc = wb.addWorksheet('Kampanyalar');
    wc.columns = [{ width: 40 }, { width: 16 }, { width: 18 }];
    title(wc, 'Uygulanan kampanyalar', sub, 3);
    header(wc, 3, ['Kampanya', 'Sipariş', 'Eklenen Adet']);
    body(wc, 4, camps.map(([, c]) => [c.name, c.orders.size, c.units]), [1, 2]);
  }

  // 6) Eşleşmeyen
  if (R.unmatched.size) {
    const wu = wb.addWorksheet('Eşleşmeyen');
    wu.columns = [{ width: 60 }, { width: 14 }, { width: 14 }];
    title(wu, 'Katalogla eşleşmeyen ürün adları', 'Ürün Eşleştirme sayfasından atayın; rapor otomatik güncellenir.', 3);
    header(wu, 3, ['Etiketteki ad', 'Adet', 'Sipariş']);
    body(wu, 4, [...R.unmatched.values()].map((u) => [u.raw, u.units, u.orders.size]), [1, 2]);
  }

  // 7) Siparişler
  const wsO = wb.addWorksheet('Siparişler', { views: [{ state: 'frozen', ySplit: 3 }] });
  wsO.columns = [{ width: 12 }, { width: 20 }, { width: 26 }, { width: 12 }, { width: 24 }, { width: 44 }, { width: 9 }, { width: 30 }, { width: 18 }];
  title(wsO, 'Sipariş satırları', sub, 9);
  header(wsO, 3, ['Tarih', 'Sipariş No', 'Mağaza', 'Platform', 'Alıcı', 'Ürün', 'Adet', 'Etiketteki Ad / Kampanya', 'Kargo Barkodu']);
  const lines = [];
  for (const c of R.computed) {
    const o = c.order;
    const st = c.store ? c.store.name : o.sender;
    for (const l of c.lines) {
      if (l.ignored) continue;
      const p = l.productId && ctx.productsById.get(l.productId);
      lines.push([trDate(o.date), o.no, st, pLabel(c.platform), o.recipient, p ? ctx.labelOf(p) : '⚠ EŞLEŞMEDİ', l.units, l.raw, o.cargoCode]);
    }
    for (const r of c.rewards) {
      const p = ctx.productsById.get(r.productId);
      lines.push([trDate(o.date), o.no, st, pLabel(c.platform), o.recipient, p ? ctx.labelOf(p) : r.productId, r.qty, 'Kampanya: ' + r.name, o.cargoCode]);
    }
  }
  body(wsO, 4, lines, [6]);
  wsO.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3 + lines.length, column: 9 } };

  const buf = await wb.xlsx.writeBuffer();
  const stamp = from === to ? from : `${from}_${to}`;
  download(`uretim-listesi_${stamp}.xlsx`, new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
}

/** Basit tablo çıktısı (sipariş listesi vb.) */
export async function exportTable(name, sheetTitle, columns, rows) {
  const ExcelJS = await lib();
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetTitle.slice(0, 31), { views: [{ state: 'frozen', ySplit: 3 }] });
  ws.columns = columns.map((c) => ({ width: c.width || 16 }));
  title(ws, sheetTitle, `Oluşturma: ${trDateTime(new Date().toISOString())}`, columns.length);
  header(ws, 3, columns.map((c) => c.label));
  body(ws, 4, rows, columns.map((c, i) => (c.num ? i : -1)).filter((i) => i >= 0));
  ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3 + rows.length, column: columns.length } };
  const buf = await wb.xlsx.writeBuffer();
  download(name, new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
}

/**
 * Sabit sıralı liste: katalogdaki TÜM ürünler, Ürünler sayfasındaki sırayla, 0 olanlar dahil.
 * Başka bir tabloya yapıştırmak için: ilk satır başlık, ürün satırları hep aynı yerde.
 */
export async function exportFixedList({ R, ctx, from, to, filterLabel }) {
  const ExcelJS = await lib();
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Liste', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = [{ width: 48 }, { width: 20 }];
  const head = ws.getRow(1);
  head.values = ['Ürün', 'Gönderilecek Adet'];
  head.font = { bold: true };
  ctx.products.forEach((p, i) => {
    const a = R.products.get(p.id);
    ws.getRow(i + 2).values = [p.name, a ? a.labelUnits + a.campaignUnits : 0];
  });
  // Bilgi ayrı sayfada: yapıştırılan tablonun satırları kaymasın
  const info = wb.addWorksheet('Bilgi');
  info.columns = [{ width: 24 }, { width: 60 }];
  [['Tarih', rangeLabel(from, to)], ['Kapsam', filterLabel], ['Sipariş', R.orders], ['Ürün sayısı', ctx.products.length], ['Oluşturma', trDateTime(new Date().toISOString())]]
    .forEach((r, i) => { info.getRow(i + 1).values = r; });
  const buf = await wb.xlsx.writeBuffer();
  const stamp = from === to ? from : `${from}_${to}`;
  download(`sabit-liste_${stamp}.xlsx`, new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
}
