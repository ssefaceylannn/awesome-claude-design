// Yeniden gönderim etiketi tasarımı: her alan (isim, sipariş no, mağaza, firma, ürünler, barkod…)
// kâğıt üzerinde mm cinsinden konum/boyut ve punto ile tanımlanır. Düzen her kâğıt boyutu için ayrı
// saklanır (bu tarayıcıda). Tasarım penceresinde alanlar sürüklenir, köşeden boyutlandırılır.
import { html, raw, mount, icon, personName, modal } from './ui.js';
import { barcodeSvg } from '../shared/barcode.js';
import { companyFor } from '../shared/resend.js';
import { paperById, paperPicker } from './paper.js';

export const ELEMENTS = [
  { key: 'name', label: 'Alıcı adı' },
  { key: 'orderNo', label: 'Sipariş no' },
  { key: 'line', label: 'Ayırıcı çizgi', noText: true },
  { key: 'store', label: 'Mağaza adı' },
  { key: 'company', label: 'Firma' },
  { key: 'items', label: 'Ürünler' },
  { key: 'barcode', label: 'Barkod', noText: true },
  { key: 'code', label: 'Barkod numarası' },
];
const KEY = 'et-label-layouts';
const r1 = (v) => Math.round(v * 2) / 2; // 0,5 mm / 0,5 pt adım

/** Kâğıda göre orantılı varsayılan düzen (10×15 cm'de önceki sabit tasarımla aynı yerleşim) */
export function defaultLayout(W, H) {
  const m = r1(Math.max(3, Math.min(W, H) * 0.05));
  // Yazı ölçeği: 10×10 cm'de de okunaklı kalsın diye yüksekliğe göre daha az küçülür
  const k = Math.min(W / 100, H / 110);
  const iw = W - 2 * m;
  const bottom = H * 0.12, codeH = 5.5 * k, bcH = 22 * k;
  const bcY = H - bottom - codeH - bcH;
  const itemsY = m + 26 * k;
  const L = {
    name: { x: m, y: m, w: iw, h: 9 * k, fs: 18 * k, bold: true, align: 'left' },
    orderNo: { x: m, y: m + 9 * k, w: iw, h: 6.5 * k, fs: 12.5 * k, bold: true, align: 'left' },
    line: { x: m, y: m + 16.5 * k, w: iw, h: 0.6 },
    store: { x: m, y: m + 18.5 * k, w: iw * 0.6, h: 6.5 * k, fs: 11.5 * k, bold: true, align: 'left' },
    company: { x: m + iw * 0.62, y: m + 18.5 * k, w: iw * 0.38, h: 6.5 * k, fs: 11.5 * k, bold: true, align: 'center', box: true },
    items: { x: m, y: itemsY, w: iw, h: Math.max(10, bcY - 3 - itemsY), fs: 15.5 * k, bold: false, align: 'left' },
    barcode: { x: m, y: bcY, w: iw, h: bcH },
    code: { x: m, y: bcY + bcH + 0.5, w: iw, h: codeH, fs: 12 * k, bold: true, align: 'center' },
  };
  for (const e of Object.values(L)) { for (const p of ['x', 'y', 'w', 'h', 'fs']) if (e[p] != null) e[p] = r1(e[p]); e.show = true; }
  L.line.h = 0.6;
  return L;
}

const loadAll = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { return {}; } };
export function getLayout(paper) {
  const saved = loadAll()[paper.id];
  const def = defaultLayout(paper.w, paper.h);
  if (!saved) return def;
  // Eksik alan varsa varsayılandan tamamla (sonradan eklenen alanlar için)
  return Object.fromEntries(ELEMENTS.map(({ key }) => [key, { ...def[key], ...(saved[key] || {}) }]));
}
export function saveLayout(paper, layout) {
  const all = loadAll();
  all[paper.id] = layout;
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* yok */ }
}
export function resetLayout(paper) {
  const all = loadAll();
  delete all[paper.id];
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* yok */ }
}

const box = (e, key) => `left:${e.x}mm;top:${e.y}mm;width:${e.w}mm;height:${e.h}mm;${key === 'line' ? `border-top:${e.h}mm solid #000;` : ''}${e.fs ? `font-size:${e.fs}pt;` : ''}font-weight:${e.bold ? 700 : 400};text-align:${e.align || 'left'};`;

/** Tek etiket. edit: tasarım penceresinde sürükleme tutamakları eklenir. */
export function renderLabel(o, store, paper, layout, { edit = false, selected = '' } = {}) {
  const L = layout || getLayout(paper);
  const company = companyFor(store);
  let bcOk = true, bcSvg = '';
  if (o.code) { try { bcSvg = barcodeSvg(o.code); } catch { bcOk = false; } }
  const content = {
    name: personName(o.recipient) || '—',
    orderNo: o.orderNo ? '#' + o.orderNo : '',
    line: '',
    store: store ? store.name : 'Mağaza seçilmedi',
    company,
    items: html`${o.items.map((it) => html`<div class="pl-item"><b>${it.qty} ×</b> <span>${it.name}</span></div>`)}`,
    barcode: o.code ? (bcOk ? raw(bcSvg) : html`<span class="pl-miss">Barkod oluşturulamadı</span>`) : html`<span class="pl-miss">Kargo kodu (734…) bulunamadı</span>`,
    code: o.code || '',
  };
  return html`<div class="plabel" style="width:${paper.w}mm;height:${paper.h}mm">
    ${ELEMENTS.filter(({ key }) => L[key] && (L[key].show !== false || edit)).map(({ key, label }) => {
      const e = L[key];
      if (!edit && key === 'company' && !company) return '';
      const cls = `pe pe-${key}${e.box ? ' boxed' : ''}${e.show === false ? ' hidden-el' : ''}${selected === key ? ' sel' : ''}`;
      return html`<div class="${cls}" data-el="${key}" style="${box(e, key)}"><div class="pe-in">${content[key]}</div>${edit ? html`<span class="pe-tag">${label}</span><span class="pe-rz" data-rz="${key}"></span>` : ''}</div>`;
    })}
  </div>`;
}

/** Alanına sığmayan yazıyı (ürünler, isim…) sığana kadar küçült — yazdırmadan hemen önce çağrılır */
export function fitLabels(root) {
  // Yazdırma alanı ekranda gizli (display:none) iken ölçüm 0 çıkar ve her şey küçülür:
  // ölçüm süresince görünmez biçimde açılır
  const hidden = getComputedStyle(root).display === 'none';
  const prev = root.getAttribute('style');
  if (hidden) root.setAttribute('style', 'display:block;position:fixed;left:-30000px;top:0;visibility:hidden');
  root.querySelectorAll('.pe').forEach((el) => {
    if (el.classList.contains('pe-barcode') || el.classList.contains('pe-line')) return;
    const inner = el.querySelector('.pe-in');
    let fs = parseFloat(el.style.fontSize) || 0;
    if (!fs) return;
    let guard = 0;
    while ((inner.scrollHeight > el.clientHeight + 1 || inner.scrollWidth > el.clientWidth + 1) && fs > 5 && guard++ < 60) {
      fs = Math.round((fs - 0.5) * 2) / 2;
      el.style.fontSize = fs + 'pt';
    }
  });
  if (hidden) { if (prev == null) root.removeAttribute('style'); else root.setAttribute('style', prev); }
}

/**
 * Tasarım penceresi. sample: önizlemede gösterilecek sipariş; onSave(paper) kaydedince.
 */
export async function openDesigner({ paperId, sample, store, onSave }) {
  let paper = paperById(paperId, 'l100x150');
  let L = getLayout(paper);
  const drafts = { [paper.id]: L }; // kâğıt değiştirilince yapılan ayarlar kaybolmasın; kaydette hepsi saklanır
  let sel = 'items';
  const demo = sample || { recipient: 'Ayşe Örnek', orderNo: '11600000001', code: '7340000000000001', items: [{ name: 'Zencefil Shot - 10 Adet', qty: 2 }, { name: 'Coconut Mix - 250 ml', qty: 1 }] };
  let saved = false;
  await modal({
    title: 'Etiket tasarımı',
    size: 'lg',
    body: html`<div class="ld">
      <div class="ld-side stack" style="gap:12px">
        <label class="f">Kâğıt boyutu<div id="ldPaper"></div></label>
        <div class="f">Alanlar <span class="hint">Önizlemede alana tıklayıp sürükleyin, sağ alt köşeden boyutlandırın</span></div>
        <div id="ldList" class="ld-list"></div>
        <div id="ldProps"></div>
        <button type="button" class="btn sm ghost" id="ldReset">${icon('refresh')}Bu kâğıt için varsayılan düzen</button>
      </div>
      <div><div class="muted small" style="margin-bottom:6px" id="ldInfo"></div><div class="ld-stage" id="ldStage"></div></div>
    </div>`,
    actions: [{ label: 'Vazgeç', value: 'cancel' }, { label: 'Kaydet', value: 'save', variant: 'primary' }],
    onOpen: (d) => {
      const stage = d.querySelector('#ldStage');
      let zoom = 1;
      const pxPerMm = 96 / 25.4;
      paperPicker(d.querySelector('#ldPaper'), { selected: paper.id, onChange: (p) => { paper = p; L = drafts[p.id] || (drafts[p.id] = getLayout(p)); drawAll(); } });
      const drawList = () => mount(d.querySelector('#ldList'), ELEMENTS.map(({ key, label }) => html`<label class="ld-item ${sel === key ? 'on' : ''}" data-pick="${key}"><input type="checkbox" data-show="${key}" ${L[key].show !== false ? 'checked' : ''}> <span>${label}</span></label>`));
      const drawProps = () => {
        const e = L[sel];
        const def = ELEMENTS.find((x) => x.key === sel);
        mount(d.querySelector('#ldProps'), html`<div class="fieldset ld-props"><b class="small">${def.label}</b>
          <div class="ld-grid">
            <label class="f">X (mm)<input class="input sm" type="number" step="0.5" data-p="x" value="${e.x}"></label>
            <label class="f">Y (mm)<input class="input sm" type="number" step="0.5" data-p="y" value="${e.y}"></label>
            <label class="f">Genişlik<input class="input sm" type="number" step="0.5" min="1" data-p="w" value="${e.w}"></label>
            <label class="f">Yükseklik<input class="input sm" type="number" step="0.5" min="0.3" data-p="h" value="${e.h}"></label>
            ${def.noText ? '' : html`<label class="f">Punto<input class="input sm" type="number" step="0.5" min="4" max="72" data-p="fs" value="${e.fs}"></label>
            <label class="f">Hizalama<select class="input sm" data-p="align">${[['left', 'Sola'], ['center', 'Ortaya'], ['right', 'Sağa']].map(([v, l]) => html`<option value="${v}" ${e.align === v ? 'selected' : ''}>${l}</option>`)}</select></label>
            <label class="check small"><input type="checkbox" data-p="bold" ${e.bold ? 'checked' : ''}> Kalın</label>
            ${sel === 'company' ? html`<label class="check small"><input type="checkbox" data-p="box" ${e.box ? 'checked' : ''}> Çerçeveli</label>` : ''}`}
          </div></div>`);
      };
      const drawStage = () => {
        const avail = Math.max(260, stage.clientWidth - 28);
        zoom = Math.min(2.2, avail / (paper.w * pxPerMm), 560 / (paper.h * pxPerMm));
        d.querySelector('#ldInfo').textContent = `Önizleme · ${paper.w} × ${paper.h} mm · %${Math.round(zoom * 100)}`;
        mount(stage, html`<div class="ld-canvas" style="zoom:${zoom}">${renderLabel(demo, store, paper, L, { edit: true, selected: sel })}</div>`);
        fitLabels(stage); // kâğıtta olacağı gibi: sığmayan yazı küçülür
      };
      const drawAll = () => { drawList(); drawProps(); drawStage(); };
      // Sürükle / boyutlandır
      stage.addEventListener('pointerdown', (ev) => {
        const t = ev.target.closest('[data-el]');
        if (!t) return;
        ev.preventDefault();
        const key = t.dataset.el;
        const resize = !!ev.target.closest('[data-rz]');
        if (sel !== key) { sel = key; drawList(); drawProps(); stage.querySelectorAll('.pe').forEach((x) => x.classList.toggle('sel', x.dataset.el === key)); }
        const e = L[key];
        const start = { x: ev.clientX, y: ev.clientY, ex: e.x, ey: e.y, ew: e.w, eh: e.h };
        const el = stage.querySelector(`[data-el="${key}"]`);
        const toMm = (px) => px / (zoom * pxPerMm);
        const move = (mv) => {
          const dx = toMm(mv.clientX - start.x), dy = toMm(mv.clientY - start.y);
          if (resize) {
            e.w = Math.max(2, Math.min(paper.w - e.x, r1(start.ew + dx)));
            e.h = Math.max(key === 'line' ? 0.3 : 2, Math.min(paper.h - e.y, r1(start.eh + dy)));
          } else {
            e.x = Math.max(0, Math.min(paper.w - e.w, r1(start.ex + dx)));
            e.y = Math.max(0, Math.min(paper.h - e.h, r1(start.ey + dy)));
          }
          Object.assign(el.style, { left: e.x + 'mm', top: e.y + 'mm', width: e.w + 'mm', height: e.h + 'mm' });
        };
        const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); drawProps(); };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
      });
      d.querySelector('#ldList').addEventListener('click', (ev) => {
        const s = ev.target.closest('[data-show]');
        if (s) { L[s.dataset.show].show = s.checked; drawStage(); return; }
        const p = ev.target.closest('[data-pick]');
        if (p) { ev.preventDefault(); sel = p.dataset.pick; drawAll(); }
      });
      d.querySelector('#ldProps').addEventListener('input', (ev) => {
        const p = ev.target.dataset.p;
        if (!p) return;
        const e = L[sel];
        if (ev.target.type === 'checkbox') e[p] = ev.target.checked;
        else if (p === 'align') e[p] = ev.target.value;
        else { const v = parseFloat(ev.target.value); if (Number.isFinite(v)) e[p] = Math.max(p === 'x' || p === 'y' ? 0 : 0.3, v); }
        drawStage();
      });
      d.querySelector('#ldProps').addEventListener('change', (ev) => { if (ev.target.dataset.p === 'align') { L[sel].align = ev.target.value; drawStage(); } });
      d.querySelector('#ldReset').addEventListener('click', () => { L = drafts[paper.id] = defaultLayout(paper.w, paper.h); drawAll(); });
      requestAnimationFrame(drawAll);
    },
    onSubmit: () => { for (const [id, lay] of Object.entries(drafts)) saveLayout(paperById(id), lay); saved = true; },
  });
  if (saved && onSave) onSave(paper);
  return saved;
}
