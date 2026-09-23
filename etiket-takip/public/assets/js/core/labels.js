// Etiket PDF'lerini tarayıcıda okur (pdf.js) ve siparişlere çevirir.
import { loadScript, collator, today } from './ui.js';
import { parsePage, combinePages, dateFromFileName } from '../shared/parser.js';

async function pdfjs() {
  await loadScript('/assets/vendor/pdf.min.js');
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = '/assets/vendor/pdf.worker.min.js';
  return window.pdfjsLib;
}

/**
 * @param {File[]} files
 * @param {{manualDate?:string, onProgress?:(done,total)=>void}} opt
 * @returns {{orders, log, pages, files}}
 */
export async function readLabels(files, { manualDate, onProgress } = {}) {
  const lib = await pdfjs();
  const list = [...files].filter((f) => /\.pdf$/i.test(f.name) || f.type === 'application/pdf').sort((a, b) => collator.compare(a.name, b.name));
  const pages = [];
  const log = [];
  let done = 0;
  for (const f of list) {
    const date = manualDate || dateFromFileName(f.name) || today();
    try {
      const doc = await lib.getDocument({ data: new Uint8Array(await f.arrayBuffer()) }).promise;
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const vp = page.getViewport({ scale: 1 });
        const p = parsePage((await page.getTextContent()).items, vp.height);
        Object.assign(p, { file: f.name, filePage: i, date });
        pages.push(p);
      }
      await doc.destroy();
    } catch (e) {
      console.error(e);
      log.push({ type: 'error', msg: `${f.name}: okunamadı (${e.message || e})` });
    }
    onProgress && onProgress(++done, list.length);
  }
  const combined = combinePages(pages);
  const orders = combined.orders.map((o) => ({
    orderNo: o.orderNo,
    sender: o.store,
    platform: o.platform,
    recipient: o.recipient,
    city: o.city,
    cargo: o.cargo,
    cargoCode: o.cargoCode,
    items: o.items,
    pages: o.pages.length,
    file: o.file,
    date: o.date || manualDate || today(),
    startsAsContinuation: !!o.startsAsContinuation,
    orphan: !!o.orphan,
    warnings: o.warnings || [],
  }));
  return { orders, log: log.concat(combined.log), pages: pages.length, files: list.map((f) => f.name) };
}
