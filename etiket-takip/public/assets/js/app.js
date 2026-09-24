// Uygulama kabuğu: kenar menü, üst bar, yönlendirici.
import { html, mount, icon, esc, toast, $ } from './core/ui.js';
import { api, boot, state, can } from './core/api.js';
import { isArchiveOnly } from './shared/matcher.js';
import { brandResolved } from './shared/calc.js';

const NAV = [
  { group: 'Operasyon', items: [
    { id: 'dashboard', label: 'Genel Bakış', icon: 'dashboard' },
    { id: 'upload', label: 'Etiket Yükle', icon: 'upload', role: 'personel' },
    { id: 'production', label: 'Üretim Listesi', icon: 'factory' },
    { id: 'orders', label: 'Siparişler', icon: 'receipt' },
    { id: 'calendar', label: 'Günlük Arşiv', icon: 'calendar' },
    { id: 'scan', label: 'Barkod Kontrol', icon: 'scan', role: 'personel' },
  ] },
  { group: 'Katalog & Kurallar', items: [
    { id: 'stores', label: 'Mağazalar', icon: 'store' },
    { id: 'products', label: 'Ürünler & Sıra', icon: 'box' },
    { id: 'matching', label: 'Ürün Eşleştirme', icon: 'link' },
    { id: 'campaigns', label: 'Kampanyalar', icon: 'tag' },
  ] },
  { group: 'Sistem', items: [
    { id: 'users', label: 'Kullanıcılar', icon: 'users', role: 'admin' },
    { id: 'settings', label: 'Ayarlar & Kayıtlar', icon: 'settings' },
  ] },
];
const ROLE_LABEL = { admin: 'Yönetici', personel: 'Personel', izleyici: 'İzleyici' };
const pages = {};
let cleanup = null;
let current = null;

function sidebar() {
  const u = state.me;
  mount($('#sidebar'), html`
    <div class="brandmark"><div class="logo">${icon('scan')}</div>
      <div><b>${state.config.settings.companyName || 'Etiket Takip'}</b><small>Sipariş & Üretim Planlama</small></div></div>
    <nav class="nav">${NAV.map((g) => {
      const items = g.items.filter((i) => !i.role || can(i.role));
      return items.length ? html`<div class="nav-group"><span>${g.group}</span>${items.map((i) => html`<a href="#/${i.id}" data-id="${i.id}">${icon(i.icon)}<span>${i.label}</span><span class="count hidden" data-count="${i.id}"></span></a>`)}</div>` : '';
    })}</nav>
    <div class="me"><div class="avatar">${u.username.slice(0, 2)}</div><div><b>${u.username}</b><small>${ROLE_LABEL[u.role] || u.role}</small></div>
      <button id="themeBtn" title="Tema">${icon('moon')}</button>
      <button id="logoutBtn" title="Çıkış yap">${icon('logout')}</button></div>`);
  $('#logoutBtn').addEventListener('click', async () => {
    await fetch('/api/logout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    location.href = '/login.html';
  });
  $('#themeBtn').addEventListener('click', () => {
    const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('et-theme', next); } catch { /* yok */ }
  });
}

export function setBadge(id, n) {
  const el = document.querySelector(`[data-count="${id}"]`);
  if (!el) return;
  el.textContent = n > 99 ? '99+' : n;
  el.classList.toggle('hidden', !n);
}

function parseHash() {
  const h = location.hash.replace(/^#\/?/, '');
  const [path, q] = h.split('?');
  return { id: path || 'dashboard', params: Object.fromEntries(new URLSearchParams(q || '')) };
}

export function navigate(id, params) {
  const q = params ? '?' + new URLSearchParams(params).toString() : '';
  location.hash = `#/${id}${q}`;
}

async function route() {
  const { id, params } = parseHash();
  const item = NAV.flatMap((g) => g.items).find((i) => i.id === id);
  if (!item) return navigate('dashboard');
  if (item.role && !can(item.role)) { toast('Bu sayfaya erişim yetkiniz yok', 'err'); return navigate('dashboard'); }
  document.querySelectorAll('.nav a').forEach((a) => a.classList.toggle('active', a.dataset.id === id));
  $('#app').classList.remove('nav-open');
  if (cleanup) { try { cleanup(); } catch { /* yok */ } cleanup = null; }
  current = id;
  const top = $('#topbar');
  mount(top, html`<button class="btn ghost icon menu-btn" id="menuBtn" aria-label="Menü">${icon('menu')}</button>
    <div class="title"><h1>${item.label}</h1><small id="pageSub"></small></div><div class="actions" id="pageActions"></div>`);
  $('#menuBtn').addEventListener('click', () => $('#app').classList.add('nav-open'));
  // Her sayfa için yeni bir kap: önceki sayfanın olay dinleyicileri taşınmasın
  const old = $('#page');
  const el = old.cloneNode(false);
  old.replaceWith(el);
  mount(el, html`<div class="loading"><div class="spin"></div><span>Yükleniyor…</span></div>`);
  document.title = `${item.label} · Etiket Takip`;
  try {
    if (!pages[id]) pages[id] = (await import(`./pages/${id}.js`)).default;
    if (current !== id) return;
    const ctx = {
      el,
      params,
      actions: $('#pageActions'),
      setSub: (t) => { $('#pageSub').textContent = t || ''; },
      navigate,
      isCurrent: () => current === id,
    };
    cleanup = (await pages[id](ctx)) || null;
  } catch (e) {
    console.error(e);
    mount(el, html`<div class="callout err">${icon('alert')}<div class="c"><b>Sayfa yüklenemedi</b>${e.message}</div></div>`);
  }
}

async function unmatchedBadge() {
  try {
    const { names } = await api.get('labelnames');
    let n = 0;
    for (const v of Object.values(names)) {
      if (isArchiveOnly(v)) continue;
      const m = state.ctx.match(v.raw);
      if (!m.productId && !m.ignored && !m.parts && !brandResolved(m, state.ctx)) n++;
    }
    setBadge('matching', n);
  } catch { /* yok */ }
}
export const refreshBadges = unmatchedBadge;

(async function start() {
  try {
    await boot();
  } catch (e) {
    mount($('#page'), html`<div class="callout err" style="margin:24px">${icon('alert')}<div class="c"><b>Bağlantı kurulamadı</b>${esc(e.message)}</div></div>`);
    return;
  }
  sidebar();
  $('#scrim').addEventListener('click', () => $('#app').classList.remove('nav-open'));
  window.addEventListener('hashchange', route);
  route();
  unmatchedBadge();
})();
