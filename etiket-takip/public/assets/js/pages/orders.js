// Sipariş listesi: arama, filtre, detay, silme.
import { html, mount, icon, n, trDate, trDateTime, toast, modal, confirmDialog, emptyState, storeTag, pBadge, pLabel, rangeLabel, busy, selTh, selTd, bulkBar, wireBulk } from '../core/ui.js';
import { api, state, fetchOrders, getRange, isAdmin, can, invalidateOrders, patchCachedOrder } from '../core/api.js';
import { aggregate, computeOrder } from '../shared/calc.js';
import { rangePicker, storeFilters, filterLabel } from '../core/widgets.js';
import { exportTable } from '../core/excel.js';

const PAGE = 50;
const pname = (id) => (state.ctx.productsById.get(id) || {}).name || '?';

export async function openOrder(o, onChange) {
  const c = computeOrder(o, state.ctx);
  const actions = [{ label: 'Kapat', value: 'close' }];
  if (can('personel')) actions.unshift({ label: o.checked ? 'Kontrolü kaldır' : 'Kontrol edildi olarak işaretle', value: 'check', icon: 'check' });
  if (isAdmin()) actions.unshift({ label: 'Siparişi sil', value: 'delete', variant: 'danger', icon: 'trash' });
  const v = await modal({
    title: `Sipariş ${o.no}`,
    size: 'lg',
    body: html`<div class="stack">
      <dl class="kv">
        <dt>Tarih</dt><dd>${trDate(o.date, true)}</dd>
        <dt>Mağaza</dt><dd>${storeTag(c.store, o.sender)} ${pBadge(c.platform)}</dd>
        <dt>Etiketteki gönderici</dt><dd>${o.sender}</dd>
        ${o.platformOrderNo ? html`<dt>Platform sipariş no</dt><dd>${o.platformOrderNo}${o.packageNo ? html` <span class="muted">· paket ${o.packageNo}</span>` : ''}</dd>` : ''}
        ${o.amount ? html`<dt>Tutar</dt><dd>${n(o.amount)} TL</dd>` : ''}
        <dt>Kaynak</dt><dd>${o.source === 'excel' ? 'Excel' : 'Etiket PDF'}</dd>
        <dt>Alıcı</dt><dd>${o.recipient || '—'} ${o.city ? html`<span class="muted">· ${o.city}</span>` : ''}</dd>
        <dt>Kargo</dt><dd>${o.cargo || '—'} ${o.cargoCode ? html`<code>${o.cargoCode}</code>` : ''}</dd>
        <dt>Etiket</dt><dd>${o.pages || 1} sayfa · ${o.file || ''}</dd>
        <dt>Yükleyen</dt><dd>${o.by} · ${trDateTime(o.at)}</dd>
        <dt>Barkod kontrolü</dt><dd>${o.checked ? html`<span class="badge ok">${icon('check')} ${o.checkedBy} · ${trDateTime(o.checkedAt)}</span>` : html`<span class="badge">Kontrol edilmedi</span>`}</dd>
      </dl>
      <div class="card"><table class="t"><thead><tr><th>Etiketteki ürün</th><th class="num">Adet</th><th>Katalogdaki ürün</th><th class="num">Sayılan</th></tr></thead><tbody>
        ${c.lines.map((l) => html`<tr><td>${l.raw}</td><td class="num">${l.qty}</td><td>${l.ignored ? html`<span class="muted">yoksayılır</span>` : l.productId ? html`<b>${pname(l.productId)}</b> <span class="muted xs">${l.method === 'manual' ? 'elle' : 'otomatik'}</span>` : html`<span class="badge err">eşleşmedi</span>`}</td><td class="num">${l.ignored ? 0 : l.units}</td></tr>`)}
        ${c.rewards.map((r) => html`<tr><td class="gift">${icon('gift')} ${r.name}</td><td></td><td class="gift"><b>${pname(r.productId)}</b></td><td class="num gift">+${r.qty}</td></tr>`)}
      </tbody></table></div>
    </div>`,
    actions,
    onSubmit: async (val) => {
      if (val === 'check') {
        const r = await api.post('check', { date: o.date, k: o.k, checked: !o.checked });
        patchCachedOrder(r.order);
        toast(r.order.checked ? 'Kontrol edildi' : 'Kontrol kaldırıldı', 'ok');
      }
      if (val === 'delete') {
        if (!(await confirmDialog(`${o.no} numaralı sipariş kalıcı olarak silinsin mi? Aynı etiket tekrar yüklenirse yeni sipariş olarak sayılır.`, { danger: true, ok: 'Sil' }))) return false;
        await api.del(`order?date=${o.date}&k=${encodeURIComponent(o.k)}`);
        invalidateOrders();
        toast('Sipariş silindi');
      }
    },
  });
  if ((v === 'check' || v === 'delete') && onChange) onChange();
}

export default async function ordersPage(ctx) {
  let { from, to } = getRange();
  let filter = { storeIds: [], platforms: [] };
  let q = ctx.params.q || '';
  let status = 'all';
  const sel = new Set();
  const sid = (o) => `${o.date}|${o.k}`;
  let page = 0;
  let R = null;

  mount(ctx.actions, html`<button class="btn" id="xls">${icon('sheet')}Excel indir</button>`);
  mount(ctx.el, html`<div class="stack">
    <div class="card"><div class="card-b row wrap" style="gap:12px">
      <div id="range"></div><div id="fStores" style="width:210px"></div><div id="fPf" style="width:180px"></div>
      <div class="search" style="flex:1;min-width:220px">${icon('search')}<input class="input sm" id="q" placeholder="Sipariş no, alıcı, kargo barkodu, ürün…" value="${q}"></div>
    </div></div>
    <div id="body"></div>
  </div>`);
  const $ = (s) => ctx.el.querySelector(s);
  rangePicker($('#range'), { onChange: (f, t) => { from = f; to = t; page = 0; load(); } });
  filter = storeFilters($('#fStores'), $('#fPf'), (f) => { filter = f; page = 0; load(); });
  let tq;
  $('#q').addEventListener('input', (e) => { clearTimeout(tq); tq = setTimeout(() => { q = e.target.value; page = 0; render(); }, 200); });

  async function load() {
    mount($('#body'), html`<div class="loading"><div class="spin"></div></div>`);
    try {
      const orders = await fetchOrders(from, to);
      if (!ctx.isCurrent()) return;
      R = aggregate(orders, state.ctx, filter);
      render();
    } catch (e) { mount($('#body'), html`<div class="callout err">${icon('alert')}<div class="c">${e.message}</div></div>`); }
  }

  function filtered() {
    const ql = q.toLocaleLowerCase('tr-TR').trim();
    return R.computed.filter((c) => {
      if (c.order.summary) return false; // arşiv özeti: sipariş detayı yok
      const o = c.order;
      if (status === 'camp' && !c.rewards.length) return false;
      if (status === 'unm' && !c.lines.some((l) => !l.productId && !l.ignored)) return false;
      if (status === 'open' && o.checked) return false;
      if (status === 'done' && !o.checked) return false;
      if (status === 'multi' && !(o.pages > 1)) return false;
      if (!ql) return true;
      return [o.no, o.platformOrderNo, o.packageNo, o.recipient, o.cargoCode, o.sender, c.store && c.store.name, ...o.items.map((i) => i.name)].join(' ').toLocaleLowerCase('tr-TR').includes(ql);
    }).reverse();
  }

  function render() {
    if (!R) return;
    const list = filtered();
    const pages = Math.max(1, Math.ceil(list.length / PAGE));
    page = Math.min(page, pages - 1);
    const shown = list.slice(page * PAGE, page * PAGE + PAGE);
    const real = R.computed.filter((c) => !c.order.summary);
    const cnt = {
      all: real.length,
      camp: real.filter((c) => c.rewards.length).length,
      unm: real.filter((c) => c.lines.some((l) => !l.productId && !l.ignored)).length,
      open: real.filter((c) => !c.order.checked).length,
      done: real.filter((c) => c.order.checked).length,
      multi: real.filter((c) => c.order.pages > 1).length,
    };
    ctx.setSub(`${rangeLabel(from, to)} · ${filterLabel(filter)} · ${n(list.length)} sipariş`);
    mount($('#body'), html`${R.archiveDays && R.archiveDays.size ? html`<div class="callout info" style="margin-bottom:16px">${icon('history')}<div class="c"><b>Bu aralıkta ${R.archiveDays.size} gün eski sistemden aktarılan arşiv özeti</b>Bu günlerin sipariş detayı yoktur; ürün ve kampanya toplamları Üretim Listesi, Günlük Arşiv ve Genel Bakış'ta görünür.</div></div>` : ''}<div class="card" id="oCard">
      <div class="tabs">${[['all', 'Tümü'], ['camp', 'Kampanyalı'], ['unm', 'Eşleşmeyen ürünlü'], ['open', 'Kontrol bekleyen'], ['done', 'Kontrol edilen'], ['multi', 'Devam etiketli']].map(([k, l]) => html`<button data-s="${k}" class="${status === k ? 'on' : ''}">${l} <span class="muted">${cnt[k]}</span></button>`)}</div>
      <div class="tw"><table class="t"><thead><tr>${can('personel') ? selTh() : ''}<th>Tarih</th><th>Sipariş no</th><th>Mağaza</th><th>Alıcı</th><th>Ürünler</th><th>Kampanya</th><th>Kontrol</th></tr></thead><tbody>
      ${shown.length ? shown.map((c) => {
        const o = c.order;
        return html`<tr class="click" data-k="${o.k}" data-d="${o.date}">${can('personel') ? selTd(sid(o), sel) : ''}
          <td class="nowrap">${trDate(o.date)}</td><td class="nowrap"><b>${o.no}</b>${o.pages > 1 ? html` <span class="badge info">${o.pages} etiket</span>` : ''}</td>
          <td>${storeTag(c.store, o.sender)}</td><td class="small">${o.recipient}</td>
          <td class="lines small">${c.lines.map((l) => html`<div><span class="q">${l.qty}x</span> ${l.productId ? pname(l.productId) : l.ignored ? html`<span class="muted">${l.raw}</span>` : html`<span class="unm">${l.raw} ⚠</span>`}</div>`)}</td>
          <td class="small">${c.rewards.length ? c.rewards.map((r) => html`<div class="gift">+${r.qty} ${pname(r.productId)}</div>`) : html`<span class="muted">—</span>`}</td>
          <td>${o.checked ? html`<span class="badge ok">${icon('check')}</span>` : html`<span class="muted">—</span>`}</td></tr>`;
      }) : html`<tr><td colspan="8">${emptyState('receipt', 'Sipariş bulunamadı', 'Tarih aralığını veya filtreleri değiştirin.')}</td></tr>`}
      </tbody></table></div>
      ${pages > 1 ? html`<div class="card-f row"><span class="muted small">${n(page * PAGE + 1)}–${n(Math.min(list.length, (page + 1) * PAGE))} / ${n(list.length)}</span><span class="spacer"></span>
        <button class="btn sm" data-p="-1" ${page ? '' : 'disabled'}>${icon('chevL')}Önceki</button><span class="small">${page + 1} / ${pages}</span><button class="btn sm" data-p="1" ${page < pages - 1 ? '' : 'disabled'}>Sonraki${icon('chevR')}</button></div>` : ''}
      ${can('personel') && list.length > shown.length ? html`<div class="card-f small"><button class="btn sm ghost" id="selAll">Filtrelenen ${n(list.length)} siparişin tümünü seç</button></div>` : ''}
      ${can('personel') ? bulkBar() : ''}
    </div>`);
    if (!can('personel')) return;
    const card = $('#oCard');
    const acts = [{ id: 'check', label: 'Kontrol edildi yap', icon: 'check' }, { id: 'uncheck', label: 'Kontrolü kaldır' }];
    if (isAdmin()) acts.push({ id: 'del', label: 'Sil', icon: 'trash', danger: true });
    wireBulk(card, sel, acts, async (a, ids) => {
      const items = ids.map((x) => { const i = x.indexOf('|'); return { date: x.slice(0, i), k: x.slice(i + 1) }; });
      if (a === 'del') {
        if (!(await confirmDialog(`${n(items.length)} sipariş kalıcı olarak silinsin mi? Aynı etiketler tekrar yüklenirse yeni sipariş olarak sayılır.`, { danger: true, ok: `${n(items.length)} siparişi sil` }))) return false;
        const r = await api.post('orders/delete', { items });
        toast(`${n(r.removed)} sipariş silindi`);
      } else {
        for (const it of items) {
          const r = await api.post('check', { ...it, checked: a === 'check' });
          patchCachedOrder(r.order);
        }
        toast(`${n(items.length)} sipariş güncellendi`, 'ok');
      }
      invalidateOrders();
      await load();
    });
    const sa = card.querySelector('#selAll');
    if (sa) sa.addEventListener('click', () => { for (const c of list) sel.add(sid(c.order)); render(); });
  }

  $('#body').addEventListener('click', (e) => {
    const s = e.target.closest('[data-s]');
    if (s) { status = s.dataset.s; page = 0; return render(); }
    const p = e.target.closest('[data-p]');
    if (p) { page += +p.dataset.p; return render(); }
    const tr = e.target.closest('tr[data-k]');
    if (tr && !e.target.closest('.sel')) {
      const c = R.computed.find((x) => x.order.k === tr.dataset.k && x.order.date === tr.dataset.d);
      if (c) openOrder(c.order, load);
    }
  });

  ctx.actions.querySelector('#xls').addEventListener('click', async (e) => {
    if (!R) return;
    const btn = e.currentTarget;
    busy(btn, true, 'Hazırlanıyor…');
    try {
      const rows = [];
      for (const c of filtered()) {
        const o = c.order;
        for (const l of c.lines) rows.push([trDate(o.date), o.no, c.store ? c.store.name : o.sender, pLabel(c.platform), o.recipient, l.raw, l.productId ? pname(l.productId) : l.ignored ? '(yoksayıldı)' : '⚠ eşleşmedi', l.ignored ? 0 : l.units, '', o.cargoCode, o.checked ? 'Evet' : '']);
        for (const r of c.rewards) rows.push([trDate(o.date), o.no, c.store ? c.store.name : o.sender, pLabel(c.platform), o.recipient, '', pname(r.productId), r.qty, r.name, o.cargoCode, o.checked ? 'Evet' : '']);
      }
      await exportTable(`siparisler_${from}_${to}.xlsx`, `Siparişler ${rangeLabel(from, to)}`, [
        { label: 'Tarih', width: 12 }, { label: 'Sipariş No', width: 20 }, { label: 'Mağaza', width: 26 }, { label: 'Platform', width: 12 }, { label: 'Alıcı', width: 24 },
        { label: 'Etiketteki Ürün', width: 40 }, { label: 'Katalog Ürünü', width: 30 }, { label: 'Adet', width: 8, num: true }, { label: 'Kampanya', width: 26 }, { label: 'Kargo Barkodu', width: 18 }, { label: 'Kontrol', width: 9 },
      ], rows);
      toast('Excel indirildi', 'ok');
    } catch (err) { toast(err.message, 'err'); }
    busy(btn, false);
  });

  load();
}
