// Arayüz yardımcıları: güvenli şablon, ikonlar, bildirim, diyalog, çoklu seçim, sürükle-sırala.

export class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Raw(String(s));
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rv = (v) => (v == null || v === false ? '' : v instanceof Raw ? v.s : Array.isArray(v) ? v.map(rv).join('') : esc(v));
/** Otomatik kaçışlı HTML şablonu */
export function html(strings, ...vals) {
  let out = '';
  strings.forEach((s, i) => { out += s + (i < vals.length ? rv(vals[i]) : ''); });
  return new Raw(out);
}
export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
export const mount = (el, content) => { el.innerHTML = rv(content); return el; };

// ------------------------------------------------------------------ biçimlendirme
const nf = new Intl.NumberFormat('tr-TR');
export const n = (v) => nf.format(Math.round(v || 0));
export const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const pad = (v) => String(v).padStart(2, '0');
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const today = () => ymd(new Date());
export const parseYmd = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const addDays = (s, k) => { const d = parseYmd(s); d.setDate(d.getDate() + k); return ymd(d); };
export const DOW = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
export const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
export const trDate = (s, withDow) => {
  if (!s) return '';
  const [y, m, d] = s.split('-');
  return `${d}.${m}.${y}` + (withDow ? ' ' + DOW[parseYmd(s).getDay()] : '');
};
export const longDate = (s) => { const d = parseYmd(s); return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${DOW[d.getDay()]}`; };
export const trDateTime = (iso) => { if (!iso) return ''; const d = new Date(iso); return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
export const rangeLabel = (f, t) => (f === t ? trDate(f, true) : `${trDate(f)} – ${trDate(t)}`);
export const uid = (p = '') => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
export const collator = new Intl.Collator('tr-TR', { numeric: true });
/** Kişi adlarını büyük harfle başlatır (yalnızca görünüm; giriş adı değişmez): "sami ceylan" → "Sami Ceylan" */
export const personName = (s) => String(s ?? '').replace(/(^|[\s._-])(\p{Ll})/gu, (_, sep, ch) => sep + ch.toLocaleUpperCase('tr-TR'));
export const initials = (s) => { const w = String(s ?? '').split(/[\s._-]+/).filter(Boolean); return (w.length > 1 ? w[0][0] + w[1][0] : (w[0] || '?').slice(0, 2)).toLocaleUpperCase('tr-TR'); };

export const PLATFORMS = [
  { id: 'trendyol', label: 'Trendyol' },
  { id: 'ikas', label: 'ikas' },
  { id: 'shopify', label: 'Shopify' },
  { id: 'hepsiburada', label: 'Hepsiburada' },
  { id: 'n11', label: 'n11' },
  { id: 'amazon', label: 'Amazon' },
  { id: 'pazarama', label: 'Pazarama' },
  { id: 'ciceksepeti', label: 'ÇiçekSepeti' },
  { id: 'diger', label: 'Diğer' },
];
export const pLabel = (p) => (PLATFORMS.find((x) => x.id === p) || { label: p || '—' }).label;
export const pBadge = (p) => html`<span class="pf pf-${p || 'diger'}">${pLabel(p)}</span>`;
export const storeTag = (store, sender) =>
  store
    ? html`<span class="row" style="gap:7px;display:inline-flex"><span class="sdot" style="background:${store.color}"></span>${store.name}</span>`
    : html`<span class="badge warn" title="Mağazalar sayfasından tanımlayın">Tanımsız: ${sender || '?'}</span>`;

// ------------------------------------------------------------------ ikonlar (lucide tarzı)
const P = {
  dashboard: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>',
  factory: '<path d="M2 20a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8l-7 5V8l-7 5V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/><path d="M17 18h1M12 18h1M7 18h1"/>',
  receipt: '<path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z"/><path d="M16 8H8M16 12H8M13 16H8"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  scan: '<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M7 8v8M10 8v8M13 8v8M17 8v8"/>',
  store: '<path d="m2 7 4.4-4.4A2 2 0 0 1 7.8 2h8.4a2 2 0 0 1 1.4.6L22 7"/><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><path d="M15 22v-4a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4"/><path d="M2 7h20"/><path d="M22 7v3a2 2 0 0 1-2 2 2.7 2.7 0 0 1-2-1 2.7 2.7 0 0 1-2 1 2.7 2.7 0 0 1-2-1 2.7 2.7 0 0 1-2 1 2.7 2.7 0 0 1-2-1 2.7 2.7 0 0 1-2 1 2 2 0 0 1-2-2V7"/>',
  box: '<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5M12 22V12"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  tag: '<path d="M12.6 2.6A2 2 0 0 0 11.2 2H4a2 2 0 0 0-2 2v7.2a2 2 0 0 0 .6 1.4l8.7 8.7a2.4 2.4 0 0 0 3.4 0l6.6-6.6a2.4 2.4 0 0 0 0-3.4Z"/><circle cx="7.5" cy="7.5" r="1.2"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5M12 15V3"/>',
  printer: '<path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  grip: '<circle cx="9" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="18" r="1"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  chevL: '<path d="m15 18-6-6 6-6"/>',
  chevR: '<path d="m9 18 6-6-6-6"/>',
  chevD: '<path d="m6 9 6 6 6-6"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16M8 16H3v5"/>',
  file: '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5Z"/><path d="M14 2v6h6"/>',
  sheet: '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5Z"/><path d="M14 2v6h6M8 13h8M8 17h8M12 11v8"/>',
  gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5C9.5 3 12 8 12 8s2.5-5 4.5-5a2.5 2.5 0 0 1 0 5"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  archive: '<rect x="2" y="3" width="20" height="5" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8M10 12h4"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
  camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z"/><circle cx="12" cy="13" r="3"/>',
  history: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5M12 7v5l4 2"/>',
  sparkle: '<path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/>',
  eye: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
};
export const icon = (name, cls = '') => raw(`<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${P[name] || ''}</svg>`);

// ------------------------------------------------------------------ bildirim
let toastBox;
export function toast(msg, type = '') {
  if (!toastBox) { toastBox = document.createElement('div'); toastBox.className = 'toasts'; document.body.appendChild(toastBox); }
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.setAttribute('role', 'status');
  t.textContent = msg;
  toastBox.appendChild(t);
  setTimeout(() => t.remove(), type === 'err' ? 6000 : 3200);
}

// ------------------------------------------------------------------ diyalog
/**
 * modal({ title, body, actions:[{label,value,variant}], size, onOpen(el), onSubmit(value, el) })
 * onSubmit false döndürürse diyalog kapanmaz. Promise değeri: seçilen value ya da null.
 */
export function modal({ title, body, actions = [{ label: 'Kapat', value: 'close' }], size = '', onOpen, onSubmit }) {
  return new Promise((resolve) => {
    const d = document.createElement('dialog');
    d.className = 'modal ' + size;
    mount(d, html`<form method="dialog" novalidate>
      <div class="modal-h"><h2>${title}</h2><span class="spacer"></span><button class="btn ghost icon" value="__x" type="submit" aria-label="Kapat">${icon('x')}</button></div>
      <div class="modal-b">${body}</div>
      <div class="modal-f">${actions.map((a) => html`<button class="btn ${a.variant || ''}" type="submit" value="${a.value}">${a.icon ? icon(a.icon) : ''}${a.label}</button>`)}</div>
    </form>`);
    document.body.appendChild(d);
    const form = d.querySelector('form');
    let result = null;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const v = e.submitter ? e.submitter.value : 'close';
      if (v !== '__x' && v !== 'cancel' && v !== 'close' && onSubmit) {
        const btn = e.submitter;
        btn.disabled = true;
        try {
          const ok = await onSubmit(v, d);
          if (ok === false) return;
        } catch (err) {
          toast(err.message || String(err), 'err');
          return;
        } finally { btn.disabled = false; }
      }
      result = v === '__x' || v === 'cancel' ? null : v;
      d.close();
    });
    d.addEventListener('close', () => { d.remove(); resolve(result); });
    d.addEventListener('cancel', () => { result = null; });
    d.showModal();
    if (onOpen) onOpen(d);
  });
}

export async function confirmDialog(text, { title = 'Emin misiniz?', ok = 'Onayla', danger = false } = {}) {
  const v = await modal({
    title, size: 'sm', body: html`<p>${text}</p>`,
    actions: [{ label: 'Vazgeç', value: 'cancel' }, { label: ok, value: 'ok', variant: danger ? 'danger solid' : 'primary' }],
  });
  return v === 'ok';
}

// ------------------------------------------------------------------ çoklu seçim
/**
 * multiSelect(el, { options:[{id,label,group,color}], selected:[], placeholder, allLabel, onChange })
 * Boş seçim = "tümü".
 */
export function multiSelect(el, opts) {
  let selected = new Set(opts.selected || []);
  const summary = () => {
    if (!selected.size) return opts.allLabel || 'Tümü';
    const labels = opts.options.filter((o) => selected.has(o.id)).map((o) => o.label);
    return labels.length <= 2 ? labels.join(', ') : `${labels.length} seçili`;
  };
  el.classList.add('ms');
  const render = () => mount(el, html`<button type="button" class="btn">${raw('<span>' + esc(summary()) + '</span>')}${icon('chevD')}</button>`);
  render();
  let pop = null;
  const close = () => { if (pop) { pop.remove(); pop = null; document.removeEventListener('mousedown', outside, true); } };
  const outside = (e) => { if (!el.contains(e.target)) close(); };
  el.addEventListener('click', (e) => {
    if (e.target.closest('.pop')) return;
    if (pop) return close();
    pop = document.createElement('div');
    pop.className = 'pop';
    const draw = (q = '') => {
      let last = null;
      const ql = q.toLocaleLowerCase('tr-TR');
      const list = opts.options.filter((o) => !ql || o.label.toLocaleLowerCase('tr-TR').includes(ql));
      mount(pop.querySelector('.opts'), list.map((o) => {
        const g = o.group && o.group !== last ? html`<div class="grp">${(last = o.group)}</div>` : '';
        return html`${g}<label class="opt"><input type="checkbox" data-id="${o.id}" ${selected.has(o.id) ? raw('checked') : ''}>${o.color ? html`<span class="sdot" style="background:${o.color}"></span>` : ''}<span>${o.label}</span></label>`;
      }));
    };
    mount(pop, html`${opts.options.length > 8 ? html`<div class="search">${icon('search')}<input class="input sm" placeholder="Ara…"></div>` : ''}<div class="opts"></div>
      <div class="foot"><button type="button" class="btn sm ghost" data-a="none">${opts.allLabel || 'Tümü'}</button><button type="button" class="btn sm primary" data-a="done">Tamam</button></div>`);
    el.appendChild(pop);
    draw();
    const s = pop.querySelector('input.input');
    if (s) { s.addEventListener('input', () => draw(s.value)); s.focus(); }
    pop.addEventListener('change', (ev) => {
      const id = ev.target.dataset.id;
      if (!id) return;
      if (ev.target.checked) selected.add(id); else selected.delete(id);
      render(); el.appendChild(pop);
      opts.onChange && opts.onChange([...selected]);
    });
    pop.addEventListener('click', (ev) => {
      const a = ev.target.closest('[data-a]');
      if (!a) return;
      if (a.dataset.a === 'none') { selected.clear(); render(); opts.onChange && opts.onChange([]); }
      close();
    });
    setTimeout(() => document.addEventListener('mousedown', outside, true));
  });
  return { get: () => [...selected], set: (v) => { selected = new Set(v); render(); } };
}

// ------------------------------------------------------------------ sürükle-sırala (fare + dokunmatik)
export function sortable(tbody, onChange) {
  let drag = null;
  tbody.addEventListener('pointerdown', (e) => {
    const h = e.target.closest('.grip');
    if (!h) return;
    const row = h.closest('tr');
    e.preventDefault();
    drag = { row, startY: e.clientY };
    row.classList.add('dragging');
    h.setPointerCapture(e.pointerId);
  });
  tbody.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const rows = [...tbody.querySelectorAll('tr[data-id]')];
    for (const r of rows) {
      if (r === drag.row) continue;
      const b = r.getBoundingClientRect();
      if (e.clientY > b.top && e.clientY < b.bottom) {
        if (e.clientY < b.top + b.height / 2) tbody.insertBefore(drag.row, r);
        else tbody.insertBefore(drag.row, r.nextSibling);
        break;
      }
    }
  });
  const end = () => {
    if (!drag) return;
    drag.row.classList.remove('dragging');
    drag = null;
    onChange([...tbody.querySelectorAll('tr[data-id]')].map((r) => r.dataset.id));
  };
  tbody.addEventListener('pointerup', end);
  tbody.addEventListener('pointercancel', end);
}

export function download(name, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

export const loading = (text = 'Yükleniyor…') => html`<div class="loading"><div class="spin"></div><span>${text}</span></div>`;
export const emptyState = (ic, title, text) => html`<div class="empty">${icon(ic)}<b>${title}</b>${text || ''}</div>`;

export function busy(btn, on, label) {
  if (on) { btn.dataset.html = btn.innerHTML; btn.disabled = true; btn.innerHTML = `<span class="spin"></span>${esc(label || 'Lütfen bekleyin…')}`; }
  else { btn.disabled = false; if (btn.dataset.html) btn.innerHTML = btn.dataset.html; }
}

export function loadScript(src) {
  return new Promise((res, rej) => {
    if (document.querySelector(`script[src="${src}"]`)) return res();
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = () => rej(new Error(src + ' yüklenemedi'));
    document.head.appendChild(s);
  });
}

// ------------------------------------------------------------------ toplu seçim
/** Tablo başlığı için "tümünü seç" kutusu */
export const selTh = () => html`<th class="sel"><input type="checkbox" data-all aria-label="Tümünü seç"></th>`;
/** Satır seçim kutusu */
export const selTd = (id, set) => html`<td class="sel"><input type="checkbox" data-sel="${id}" ${set.has(id) ? raw('checked') : ''} aria-label="Seç"></td>`;
export const bulkBar = () => html`<div class="bulkbar hidden"></div>`;

/**
 * Seçim kutularını ve toplu işlem çubuğunu bağla. Her yeniden çizimden sonra çağrılır.
 * root: tabloyu ve .bulkbar'ı içeren (yeniden oluşturulan) öğe
 * set: sayfa boyunca korunan seçili kimlikler
 * actions: [{ id, label, icon, danger }]
 * onAction(actionId, ids) → Promise; bitince seçim temizlenir
 */
export function wireBulk(root, set, actions, onAction) {
  const bar = root.querySelector('.bulkbar');
  const boxes = () => [...root.querySelectorAll('[data-sel]')];
  const draw = () => {
    for (const all of root.querySelectorAll('[data-all]')) {
      const visible = [...(all.closest('table') || root).querySelectorAll('[data-sel]')];
      const n = visible.filter((b) => set.has(b.dataset.sel)).length;
      all.checked = visible.length > 0 && n === visible.length;
      all.indeterminate = n > 0 && n < visible.length;
    }
    if (!bar) return;
    bar.classList.toggle('hidden', !set.size);
    mount(bar, html`<b>${set.size} seçili</b><span class="spacer"></span>
      ${actions.map((a) => html`<button type="button" class="btn sm ${a.danger ? 'danger solid' : ''}" data-bulk="${a.id}">${a.icon ? icon(a.icon) : ''}${a.label}</button>`)}
      <button type="button" class="btn sm ghost" data-bulk="__clear">Seçimi temizle</button>`);
  };
  root.addEventListener('change', (e) => {
    if (e.target.matches('[data-all]')) {
      for (const b of (e.target.closest('table') || root).querySelectorAll('[data-sel]')) { b.checked = e.target.checked; if (e.target.checked) set.add(b.dataset.sel); else set.delete(b.dataset.sel); }
      return draw();
    }
    if (e.target.matches('[data-sel]')) {
      if (e.target.checked) set.add(e.target.dataset.sel); else set.delete(e.target.dataset.sel);
      draw();
    }
  });
  bar && bar.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-bulk]');
    if (!b) return;
    if (b.dataset.bulk === '__clear') { set.clear(); boxes().forEach((x) => { x.checked = false; }); return draw(); }
    const ids = [...set];
    b.disabled = true;
    try {
      const done = await onAction(b.dataset.bulk, ids);
      if (done !== false) set.clear();
    } catch (err) { toast(err.message || String(err), 'err'); }
    b.disabled = false;
    draw();
  });
  draw();
}
