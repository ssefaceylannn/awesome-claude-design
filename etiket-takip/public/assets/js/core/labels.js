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
  const perFile = new Array(list.length);
  const log = [];
  let done = 0, next = 0;
  // Dosyaları 4'erli paralel oku; sayfa sırası dosya sırasıyla korunur ("devamı" için önemli)
  const worker = async () => {
    while (next < list.length) {
      const idx = next++;
      const f = list[idx];
      const date = manualDate || dateFromFileName(f.name) || today();
      const pages = [];
      try {
        const doc = await lib.getDocument({ data: new Uint8Array(await f.arrayBuffer()), isEvalSupported: false, enableXfa: false, disableFontFace: true }).promise;
        for (let i = 1; i <= doc.numPages; i++) {
          const page = await doc.getPage(i);
          const vp = page.getViewport({ scale: 1 });
          const p = parsePage((await page.getTextContent()).items, vp.height);
          Object.assign(p, { file: f.name, filePage: i, date });
          pages.push(p);
          page.cleanup();
        }
        await doc.destroy();
      } catch (e) {
        console.error(e);
        log.push({ type: 'error', msg: `${f.name}: okunamadı (${e.message || e})` });
      }
      perFile[idx] = pages;
      onProgress && onProgress(++done, list.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, list.length) }, worker));
  const pages = perFile.flat();
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
