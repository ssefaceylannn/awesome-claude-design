// Doğrulanmış PDF'i dosya açmadan doğrudan yazdırma: sayfalar yüksek çözünürlükte (varsayılan 300 dpi)
// görüntüye çevrilip yazıcı penceresi açılır. PDF dosyasına dokunulmaz; tarayıcının kendi PDF görüntüleyicisi
// de yazdırırken sayfayı böyle çizer (o 150 dpi kullanır). Barkodlar keskin kalsın diye kayıpsız PNG.
import { html, raw, mount } from './ui.js';
import { pdfjs } from './labels.js';

export async function printPdf(bytes, { dpi = 300, onProgress } = {}) {
  const lib = await pdfjs();
  const doc = await lib.getDocument({ data: bytes.slice(), isEvalSupported: false, enableXfa: false }).promise;
  const pages = [];
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const p = await doc.getPage(i);
      const vp1 = p.getViewport({ scale: 1 });
      const vp = p.getViewport({ scale: dpi / 72 });
      const cv = document.createElement('canvas');
      cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
      const g = cv.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height);
      await p.render({ canvasContext: g, viewport: vp, intent: 'print' }).promise;
      const blob = await new Promise((res) => cv.toBlob(res, 'image/png'));
      pages.push({ url: URL.createObjectURL(blob), w: vp1.width * 25.4 / 72, h: vp1.height * 25.4 / 72 });
      p.cleanup();
      onProgress && onProgress(i, doc.numPages);
    }
  } finally { await doc.destroy(); }
  const W = pages[0].w, H = pages[0].h;
  if (pages.some((pg) => Math.abs(pg.w - W) > 0.5 || Math.abs(pg.h - H) > 0.5)) {
    for (const pg of pages) URL.revokeObjectURL(pg.url);
    throw new Error('Bu pakette farklı boyutlu etiketler var; doğrudan yazdırılmadı. PDF olarak indirip yazdırın.');
  }
  const box = document.getElementById('print');
  mount(box, html`<style>@page { size: ${W.toFixed(2)}mm ${H.toFixed(2)}mm; margin: 0 }
    #print .pp { display: block; width: ${W.toFixed(2)}mm; height: ${H.toFixed(2)}mm; break-after: page; page-break-after: always; }
    #print .pp:last-child { break-after: auto; page-break-after: auto; }</style>
    ${pages.map((pg) => raw(`<img class="pp" alt="" src="${pg.url}">`))}`);
  await Promise.all([...box.querySelectorAll('img')].map((im) => (im.complete ? 1 : new Promise((r) => { im.onload = r; im.onerror = r; }))));
  const done = () => { box.innerHTML = ''; for (const pg of pages) URL.revokeObjectURL(pg.url); };
  window.addEventListener('afterprint', done, { once: true });
  window.print();
  return { pages: pages.length };
}
