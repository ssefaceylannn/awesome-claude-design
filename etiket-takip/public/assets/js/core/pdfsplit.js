// Etiket PDF'lerinden sayfa seçip yeni PDF oluşturma — KURAL: sayfaların içeriğine dokunulmaz.
// Yalnızca var olan sayfalar kaynak PDF'ten aynen kopyalanır ve sıraları değişebilir; yeni sayfa eklenmez,
// hiçbir sayfaya yazı/resim çizilmez. İndirmeden önce her sayfa kaynakla karşılaştırılır (metin, barkod
// numaraları, sayfa boyutu); en küçük farkta PDF verilmez.
import { loadScript } from './ui.js';
import { pdfjs } from './labels.js';

async function pageSig(doc, n) {
  const p = await doc.getPage(n);
  const vp = p.getViewport({ scale: 1 });
  const t = (await p.getTextContent()).items.map((i) => i.str).join('|');
  p.cleanup();
  return `${Math.round(vp.width * 10)}x${Math.round(vp.height * 10)}|${t}`;
}

/**
 * @param {File[]} fileList kaynak PDF'ler
 * @param {{fileIndex:number, filePage:number}[]} refs yeni PDF'teki sırayla sayfalar
 * @returns {Promise<Uint8Array>} doğrulanmış PDF
 */
export async function buildPdf(fileList, refs) {
  if (!refs.length) throw new Error('Bu grupta sayfa yok');
  await loadScript('/assets/vendor/pdf-lib.min.js');
  const { PDFDocument } = window.PDFLib;
  const out = await PDFDocument.create();
  const bufs = new Map();
  const buf = async (fi) => { if (!bufs.has(fi)) bufs.set(fi, new Uint8Array(await fileList[fi].arrayBuffer())); return bufs.get(fi); };
  const srcs = new Map();
  const src = async (fi) => { if (!srcs.has(fi)) srcs.set(fi, await PDFDocument.load(await buf(fi), { ignoreEncryption: true })); return srcs.get(fi); };
  // Ardışık aynı dosyadan gelen sayfalar tek seferde kopyalanır
  let run = null;
  const flush = async () => { if (!run) return; for (const pg of await out.copyPages(await src(run.fi), run.idx)) out.addPage(pg); run = null; };
  for (const { fileIndex: fi, filePage } of refs) {
    if (run && run.fi !== fi) await flush();
    if (!run) run = { fi, idx: [] };
    run.idx.push(filePage - 1);
  }
  await flush();
  const bytes = await out.save();

  // ---- Doğrulama: çıkan PDF'in her sayfası kaynaktaki karşılığıyla aynı mı
  const lib = await pdfjs();
  const open = (data) => lib.getDocument({ data: data.slice(), isEvalSupported: false, enableXfa: false, disableFontFace: true }).promise;
  const res = await open(bytes);
  try {
    if (res.numPages !== refs.length) throw new Error(`sayfa sayısı ${res.numPages} / ${refs.length}`);
    const docs = new Map();
    for (let i = 0; i < refs.length; i++) {
      const { fileIndex: fi, filePage } = refs[i];
      if (!docs.has(fi)) docs.set(fi, await open(await buf(fi)));
      const [a, b] = await Promise.all([pageSig(res, i + 1), pageSig(docs.get(fi), filePage)]);
      if (a !== b) throw new Error(`${i + 1}. sayfa kaynaktan farklı (${fileList[fi].name} / sayfa ${filePage})`);
    }
    for (const d of docs.values()) await d.destroy();
  } catch (e) {
    throw new Error('Güvenlik kontrolü başarısız, PDF verilmedi: ' + e.message);
  } finally { await res.destroy(); }
  return bytes;
}
