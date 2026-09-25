// Sayfalar arası ortak bileşenler: tarih aralığı seçici, mağaza/platform filtresi.
import { html, mount, icon, today, addDays, multiSelect, PLATFORMS, pLabel } from './ui.js';
import { state, getRange, setRange } from './api.js';

const PRESETS = [
  ['today', 'Bugün'],
  ['yesterday', 'Dün'],
  ['7', 'Son 7 gün'],
  ['30', 'Son 30 gün'],
  ['month', 'Bu ay'],
  ['lastmonth', 'Geçen ay'],
];

function presetRange(p) {
  const t = today();
  if (p === 'today') return [t, t];
  if (p === 'yesterday') return [addDays(t, -1), addDays(t, -1)];
  if (p === '7') return [addDays(t, -6), t];
  if (p === '30') return [addDays(t, -29), t];
  if (p === 'month') return [t.slice(0, 8) + '01', t];
  if (p === 'lastmonth') {
    const first = t.slice(0, 8) + '01';
    const lastPrev = addDays(first, -1);
    return [lastPrev.slice(0, 8) + '01', lastPrev];
  }
  return [t, t];
}

/** Tarih aralığı seçici. onChange(from, to) */
export function rangePicker(el, { onChange, single = false } = {}) {
  let { from, to } = getRange();
  if (single) to = from;
  const draw = () => {
    mount(el, html`<div class="row wrap" style="gap:8px">
      <div class="row" style="gap:6px">
        <button class="btn icon sm" data-step="-1" title="Önceki">${icon('chevL')}</button>
        <input type="date" class="input sm date-in" data-f="from" value="${from}" aria-label="Başlangıç">
        ${single ? '' : html`<span class="muted">–</span><input type="date" class="input sm date-in" data-f="to" value="${to}" aria-label="Bitiş">`}
        <button class="btn icon sm" data-step="1" title="Sonraki">${icon('chevR')}</button>
      </div>
      <div class="seg">${(single ? PRESETS.slice(0, 2) : PRESETS).map(([k, l]) => html`<button type="button" data-p="${k}" class="${presetRange(k)[0] === from && presetRange(k)[1] === to ? 'on' : ''}">${l}</button>`)}</div>
    </div>`);
  };
  const emit = () => { setRange(from, to); draw(); onChange && onChange(from, to); };
  draw();
  el.addEventListener('change', (e) => {
    const f = e.target.dataset.f;
    if (!f || !e.target.value) return;
    if (f === 'from') { from = e.target.value; if (single || from > to) to = from; }
    else { to = e.target.value; if (to < from) from = to; }
    emit();
  });
  el.addEventListener('click', (e) => {
    const p = e.target.closest('[data-p]');
    if (p) { [from, to] = presetRange(p.dataset.p); if (single) to = from; return emit(); }
    const s = e.target.closest('[data-step]');
    if (s) {
      const len = Math.round((new Date(to) - new Date(from)) / 86400000) + 1;
      const k = +s.dataset.step * len;
      from = addDays(from, k); to = addDays(to, k);
      emit();
    }
  });
  return { get: () => ({ from, to }) };
}

/** Mağaza ve platform çoklu seçim filtreleri */
export function storeFilters(elStores, elPlatforms, onChange) {
  const filter = { storeIds: [], platforms: [] };
  const stores = state.config.stores.filter((s) => s.active !== false);
  multiSelect(elStores, {
    options: stores.map((s) => ({ id: s.id, label: s.name, group: pLabel(s.platform), color: s.color }))
      .sort((a, b) => a.group.localeCompare(b.group, 'tr')),
    allLabel: 'Tüm mağazalar',
    onChange: (v) => { filter.storeIds = v; onChange(filter); },
  });
  const used = new Set(stores.map((s) => s.platform));
  multiSelect(elPlatforms, {
    options: PLATFORMS.filter((p) => used.has(p.id)).map((p) => ({ id: p.id, label: p.label })),
    allLabel: 'Tüm platformlar',
    onChange: (v) => { filter.platforms = v; onChange(filter); },
  });
  return filter;
}

export function filterLabel(filter) {
  const parts = [];
  if (filter.platforms && filter.platforms.length) parts.push(filter.platforms.map(pLabel).join(', '));
  if (filter.storeIds && filter.storeIds.length) parts.push(state.config.stores.filter((s) => filter.storeIds.includes(s.id)).map((s) => s.name).join(', '));
  return parts.join(' / ') || 'Tüm mağazalar';
}

/** Basit SVG sütun grafik (yığılmış iki seri) */
export function barChart(data, { h = 200, onClick } = {}) {
  const W = 760, pad = { l: 36, r: 8, t: 12, b: 26 };
  // Eksen 4 eşit adımdan oluşur; adım tam sayı olmalı (boş grafikte 0-1-1-1 gibi tekrar eden etiketler çıkmasın)
  const max = Math.max(4, ...data.map((d) => d.a + d.b));
  const nice = (() => { const r = max / 4, p = 10 ** Math.floor(Math.log10(r)); for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= r && Number.isInteger(m * p)) return m * p * 4; return Math.ceil(r) * 4; })();
  const iw = W - pad.l - pad.r, ih = h - pad.t - pad.b;
  const bw = iw / data.length;
  const y = (v) => pad.t + ih - (v / nice) * ih;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * nice);
  let s = `<svg viewBox="0 0 ${W} ${h}" role="img">`;
  for (const t of ticks) s += `<line class="grid-l" x1="${pad.l}" x2="${W - pad.r}" y1="${y(t)}" y2="${y(t)}"/><text class="ax" x="${pad.l - 6}" y="${y(t) + 3}" text-anchor="end">${Math.round(t).toLocaleString('tr-TR')}</text>`;
  data.forEach((d, i) => {
    const x = pad.l + i * bw + bw * 0.18, w = bw * 0.64;
    const ya = y(d.a), yb = y(d.a + d.b);
    s += `<rect class="b1" x="${x}" y="${ya}" width="${w}" height="${Math.max(0, pad.t + ih - ya)}" rx="2"/>`;
    if (d.b) s += `<rect class="b2" x="${x}" y="${yb}" width="${w}" height="${Math.max(0, ya - yb)}" rx="2"/>`;
    if (data.length <= 16 || i % Math.ceil(data.length / 16) === 0) s += `<text class="ax" x="${x + w / 2}" y="${h - 8}" text-anchor="middle">${d.label}</text>`;
    s += `<rect class="bar-hit" data-key="${d.key}" x="${pad.l + i * bw}" y="${pad.t}" width="${bw}" height="${ih}"><title>${d.title}</title></rect>`;
  });
  s += '</svg>';
  const wrap = document.createElement('div');
  wrap.className = 'chart';
  wrap.innerHTML = s;
  if (onClick) wrap.addEventListener('click', (e) => { const k = e.target.dataset && e.target.dataset.key; if (k) onClick(k); });
  return wrap;
}
