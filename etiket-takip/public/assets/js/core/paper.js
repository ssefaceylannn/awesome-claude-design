// Kâğıt boyutları: hazır boyutlar + kullanıcının eklediği boyutlar (bu tarayıcıda saklanır).
// Hem kombinasyon listesi yazdırma hem yeniden gönderim etiketi aynı listeyi kullanır.
import { html, mount, icon, toast } from './ui.js';

const KEY = 'et-papers';
export const BUILTIN = [
  { id: 'a4p', name: 'A4 dikey', w: 210, h: 297 },
  { id: 'a4l', name: 'A4 yatay', w: 297, h: 210 },
  { id: 'l100x100', name: 'Etiket 10 × 10 cm', w: 100, h: 100 },
  { id: 'l100x150', name: 'Etiket 10 × 15 cm', w: 100, h: 150 },
];
const load = () => { try { const a = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(a) ? a.filter((p) => p && p.id && +p.w > 0 && +p.h > 0) : []; } catch { return []; } };
const store = (list) => { try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* yok */ } };

export const papers = () => [...BUILTIN, ...load()];
export const paperById = (id, fallback = 'a4p') => papers().find((p) => p.id === id) || papers().find((p) => p.id === fallback) || BUILTIN[0];
export const paperLabel = (p) => `${p.name} (${fmt(p.w)} × ${fmt(p.h)} mm)`;
const fmt = (v) => String(+(+v).toFixed(1)).replace('.', ',');

export function addPaper(name, w, h) {
  w = +String(w).replace(',', '.'); h = +String(h).replace(',', '.');
  if (!(w >= 20 && w <= 600 && h >= 20 && h <= 1000)) throw new Error('Genişlik 20–600 mm, yükseklik 20–1000 mm olmalı');
  const p = { id: 'c' + Date.now().toString(36), name: String(name || '').trim().slice(0, 40) || `${fmt(w)} × ${fmt(h)} mm`, w: +w.toFixed(1), h: +h.toFixed(1) };
  store([...load(), p]);
  return p;
}
export function removePaper(id) { store(load().filter((p) => p.id !== id)); }

/**
 * Kâğıt seçici: liste + "Yeni boyut" formu + eklenen boyutu silme.
 * onChange(paper) seçim değişince çağrılır.
 */
export function paperPicker(el, { selected, onChange }) {
  let cur = paperById(selected).id;
  let adding = false;
  const draw = () => {
    const list = papers();
    const custom = !BUILTIN.some((b) => b.id === cur);
    mount(el, html`<div class="paper-pick">
      <div class="row" style="gap:6px">
        <select class="input" data-pp="sel" style="flex:1;min-width:0">${list.map((p) => html`<option value="${p.id}" ${p.id === cur ? 'selected' : ''}>${paperLabel(p)}</option>`)}</select>
        <button type="button" class="btn icon" data-pp="add" title="Yeni kâğıt boyutu ekle">${icon('plus')}</button>
        ${custom ? html`<button type="button" class="btn icon danger" data-pp="del" title="Bu boyutu listeden sil">${icon('trash')}</button>` : ''}
      </div>
      ${adding ? html`<div class="paper-add">
        <input class="input sm" data-pp="name" placeholder="Ad (ör. Termal 8×5)" maxlength="40">
        <input class="input sm" data-pp="w" inputmode="decimal" placeholder="Genişlik mm">
        <span class="muted">×</span>
        <input class="input sm" data-pp="h" inputmode="decimal" placeholder="Yükseklik mm">
        <button type="button" class="btn sm primary" data-pp="save">Ekle</button>
        <button type="button" class="btn sm ghost" data-pp="cancel">Vazgeç</button>
      </div>` : ''}
    </div>`);
  };
  el.addEventListener('change', (e) => {
    if (e.target.dataset.pp !== 'sel') return;
    cur = e.target.value;
    onChange && onChange(paperById(cur));
    draw();
  });
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-pp]');
    if (!b || b.tagName === 'SELECT' || b.tagName === 'INPUT') return;
    const a = b.dataset.pp;
    if (a === 'add') { adding = !adding; draw(); if (adding) el.querySelector('[data-pp="name"]').focus(); }
    else if (a === 'cancel') { adding = false; draw(); }
    else if (a === 'save') {
      try {
        const p = addPaper(el.querySelector('[data-pp="name"]').value, el.querySelector('[data-pp="w"]').value, el.querySelector('[data-pp="h"]').value);
        adding = false; cur = p.id; draw(); onChange && onChange(p);
        toast('Kâğıt boyutu eklendi', 'ok');
      } catch (err) { toast(err.message, 'err'); }
    } else if (a === 'del') {
      removePaper(cur); cur = BUILTIN[0].id; draw(); onChange && onChange(paperById(cur));
    }
  });
  draw();
  return { get: () => paperById(cur), set: (id) => { cur = paperById(id).id; adding = false; draw(); } };
}
