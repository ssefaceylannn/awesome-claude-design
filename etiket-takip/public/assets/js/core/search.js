// Üst çubuktaki ürün arama kutusu: yazdıkça tamamlar, seçilen ürünün detay sayfasını açar.
import { html, mount, icon, esc } from './ui.js';
import { state } from './api.js';
import { fold } from '../shared/text.js';

const RECENT_KEY = 'et-recent-products';
const recent = () => { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch { return []; } };
export function rememberProduct(id) {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify([id, ...recent().filter((x) => x !== id)].slice(0, 6))); } catch { /* yok */ }
}

/** Ürünleri sorguya göre sırala: ad başı > kelime başı > içerir; SKU ve marka da aranır */
export function searchProducts(q, products, limit = 8) {
  const words = fold(q).split(' ').filter(Boolean);
  if (!words.length) return [];
  const out = [];
  products.forEach((p, pos) => {
    const name = fold(p.name);
    const hay = `${name} ${fold(p.brand || '')} ${fold(p.sku || '').replace(/[^a-z0-9]+/g, ' ')} ${fold(p.category || '')} ${fold((p.keywords || '').replace(/[\n/]/g, ' '))}`;
    const flat = hay.replace(/\s+/g, '');
    let score = 0;
    for (const w of words) {
      if (name.startsWith(w)) score += 30;
      else if ((' ' + name).includes(' ' + w)) score += 20;
      else if ((' ' + hay).includes(' ' + w)) score += 10;
      else if (hay.includes(w) || flat.includes(w)) score += 4;
      else return; // her kelime bir yerde geçmeli
    }
    // Bitişik/boşluklu yazım farkı: "detox mix" = "DetoxMix"
    const qn = words.join(''), nn = name.replace(/\s+/g, '');
    if (nn === qn) score += 100;
    else if (nn.startsWith(qn)) score += 15;
    if (p.active === false) score -= 5;
    out.push({ p, score, pos });
  });
  return out.sort((a, b) => b.score - a.score || a.pos - b.pos).slice(0, limit).map((x) => x.p);
}

export function mountProductSearch(el, onPick) {
  mount(el, html`<div class="gsearch">${icon('search')}<input class="input sm" type="search" placeholder="Ürün ara…  ( / )" autocomplete="off" aria-label="Ürün ara"><div class="gs-pop hidden" role="listbox"></div></div>`);
  const input = el.querySelector('input');
  const pop = el.querySelector('.gs-pop');
  let items = [];
  let active = 0;
  const hl = (text, q) => {
    // Eşleşen kısmı kalın göster (Türkçe karakterlere duyarsız)
    const t = String(text);
    const f = fold(t);
    const w = fold(q).split(' ').filter(Boolean).sort((a, b) => b.length - a.length)[0];
    const i = w && f.length === t.length ? f.indexOf(w) : -1;
    return i < 0 ? esc(t) : `${esc(t.slice(0, i))}<b>${esc(t.slice(i, i + w.length))}</b>${esc(t.slice(i + w.length))}`;
  };
  const draw = () => {
    const q = input.value.trim();
    const products = state.config.products;
    items = q ? searchProducts(q, products) : recent().map((id) => products.find((p) => p.id === id)).filter(Boolean);
    active = Math.min(active, Math.max(0, items.length - 1));
    if (!q && !items.length) { pop.classList.add('hidden'); return; }
    pop.innerHTML = (!q ? '<div class="gs-h">Son bakılanlar</div>' : '') + (items.length
      ? items.map((p, i) => `<div class="gs-i${i === active ? ' on' : ''}" data-i="${i}" role="option"><div class="gs-n">${hl(state.ctx.labelOf(p), q)}${p.active === false ? ' <span class="badge">pasif</span>' : ''}</div><div class="gs-m">${esc([p.brand, p.sku, p.category].filter(Boolean).join(' · '))}</div></div>`).join('')
      : `<div class="gs-empty">“${esc(q)}” ile eşleşen ürün yok</div>`);
    pop.classList.remove('hidden');
  };
  const close = () => pop.classList.add('hidden');
  const pick = (p) => { if (!p) return; rememberProduct(p.id); input.value = ''; input.blur(); close(); onPick(p); };
  input.addEventListener('input', () => { active = 0; draw(); });
  input.addEventListener('focus', draw);
  input.addEventListener('blur', () => setTimeout(close, 150));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(items.length - 1, active + 1); draw(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); draw(); }
    else if (e.key === 'Enter') { e.preventDefault(); pick(items[active]); }
    else if (e.key === 'Escape') { input.value = ''; close(); input.blur(); }
  });
  pop.addEventListener('mousedown', (e) => {
    const it = e.target.closest('[data-i]');
    if (it) { e.preventDefault(); pick(items[+it.dataset.i]); }
  });
  return input;
}
