// Ürün detayı: üstteki aramadan seçilen ürünün seçili tarih aralığındaki tüm verileri.
import { html, mount, icon, n, pct, addDays, trDate, rangeLabel, today, parseYmd, emptyState, storeTag, pLabel } from '../core/ui.js';
import { state, fetchOrders, getRange, setRange, isAdmin, can } from '../core/api.js';
import { aggregate, productionRows, productEligible, brandRules } from '../shared/calc.js';
import { rangePicker, storeFilters, barChart, filterLabel } from '../core/widgets.js';
import { campaignStatus } from './campaigns.js';
import { productForm } from './products.js';
import { rememberProduct } from '../core/search.js';
import { exportTable } from '../core/excel.js';

export default async function productPage(ctx) {
  const find = () => state.config.products.find((p) => p.id === ctx.params.id);
  let p = find();
  if (!p) {
    mount(ctx.el, emptyState('box', 'Ürün bulunamadı', 'Silinmiş olabilir. Üstteki arama kutusundan başka bir ürün arayın.'));
    return;
  }
  rememberProduct(p.id);
  // Tek günlük aralık ürün analizi için dar kalır: son 30 güne genişlet
  let { from, to } = getRange();
  if (ctx.params.from && ctx.params.to) { from = ctx.params.from; to = ctx.params.to; setRange(from, to); }
  else if (from === to) { to = today(); from = addDays(to, -29); setRange(from, to); }

  let filter = { storeIds: [], platforms: [] };
  let data = null;
  const pid = p.id;

  const head = () => {
    const pos = state.config.products.findIndex((x) => x.id === pid) + 1;
    const rule = p.brand && (brandRules(state.config)[p.brand] || []);
    const storeName = (id) => (state.config.stores.find((s) => s.id === id) || {}).name || '?';
    ctx.setSub([p.brand, p.sku, p.category].filter(Boolean).join(' · '));
    document.querySelector('#topbar h1').textContent = state.ctx.labelOf(p);
    document.title = `${p.name} · Etiket Takip`;
    mount(ctx.actions, html`<a class="btn" href="#/orders?q=${encodeURIComponent(state.ctx.labelOf(p))}">${icon('receipt')}Siparişlerde göster</a>${isAdmin() ? html`<button class="btn" id="edit">${icon('edit')}Ürünü düzenle</button>` : ''}<button class="btn primary" id="xls">${icon('sheet')}Excel indir</button>`);
    const ed = ctx.actions.querySelector('#edit');
    if (ed) ed.addEventListener('click', async () => { if (await productForm(p)) { p = find() || p; head(); render(); } });
    ctx.actions.querySelector('#xls').addEventListener('click', exportXls);
    mount(ctx.el.querySelector('#info'), html`<div class="row wrap small" style="gap:6px 14px">
      <span><span class="muted">Katalog sırası</span> <b>${pos}</b> / ${state.config.products.length}</span>
      ${p.brand ? html`<span><span class="muted">Marka</span> <b>${p.brand}</b>${rule && rule.length ? html` <span class="muted">(yalnız ${rule.map(storeName).join(', ')})</span>` : ''}</span>` : ''}
      ${p.sku ? html`<span><span class="muted">SKU</span> <b>${p.sku}</b></span>` : ''}
      ${p.category ? html`<span class="badge">${p.category}</span>` : ''}
      ${p.active === false ? html`<span class="badge">Pasif</span>` : ''}
      ${p.packMultiplier ? html`<span class="badge info">×paket çarpanı</span>` : ''}
    </div>`);
  };

  mount(ctx.el, html`<div class="stack">
    <div class="card"><div class="card-b stack" style="gap:12px">
      <div id="info"></div>
      <div class="row wrap" style="gap:12px"><div id="range"></div><div id="fStores" style="width:210px"></div><div id="fPf" style="width:180px"></div></div>
    </div></div>
    <div id="body"><div class="loading"><div class="spin"></div></div></div>
  </div>`);
  head();
  rangePicker(ctx.el.querySelector('#range'), { onChange: (f, t) => { from = f; to = t; load(); } });
  storeFilters(ctx.el.querySelector('#fStores'), ctx.el.querySelector('#fPf'), (f) => { filter = f; render(); });

  let orders = [];
  async function load() {
    mount(ctx.el.querySelector('#body'), html`<div class="loading"><div class="spin"></div><span>Yükleniyor…</span></div>`);
    try { orders = await fetchOrders(from, to); } catch (e) { return mount(ctx.el.querySelector('#body'), html`<div class="callout err">${icon('alert')}<div class="c">${e.message}</div></div>`); }
    if (!ctx.isCurrent()) return;
    render();
  }

  function compute() {
    const R = aggregate(orders, state.ctx, filter);
    const days = new Map();
    for (let d = from; d <= to; d = addDays(d, 1)) days.set(d, { a: 0, b: 0, orders: 0 });
    const stores = new Map(), camps = new Map(), names = new Map(), together = new Map();
    const list = [];
    let archive = 0, archiveDays = new Set();
    for (const c of R.computed) {
      const o = c.order;
      const mine = c.lines.filter((l) => l.productId === pid && !l.ignored);
      const rw = c.rewards.filter((r) => r.productId === pid);
      if (!mine.length && !rw.length) continue;
      const lu = mine.reduce((s, l) => s + l.units, 0), cu = rw.reduce((s, r) => s + r.qty, 0);
      const day = days.get(o.date);
      if (day) { day.a += lu; day.b += cu; if (!o.summary) day.orders++; }
      if (o.summary) { archive += lu + cu; archiveDays.add(o.date); }
      const sk = c.store ? c.store.id : '?' + o.sender;
      const S = stores.get(sk) || { store: c.store, sender: o.sender, archive: !c.store && o.summary, platform: c.platform, orders: 0, a: 0, b: 0 };
      S.a += lu; S.b += cu; if (!o.summary) S.orders++;
      stores.set(sk, S);
      for (const r of rw) { const C = camps.get(r.campaignId) || { name: r.name, orders: 0, units: 0 }; C.units += r.qty; if (!o.summary) C.orders++; camps.set(r.campaignId, C); }
      for (const l of mine) { const N = names.get(l.raw) || { raw: l.raw, units: 0, mult: l.mult }; N.units += l.units; names.set(l.raw, N); }
      if (o.summary) continue;
      const others = new Set(c.lines.filter((l) => l.productId && l.productId !== pid && !l.ignored).map((l) => l.productId));
      for (const id of others) together.set(id, (together.get(id) || 0) + 1);
      list.push({ c, lu, cu });
    }
    const rows = productionRows(R, state.ctx).filter((r) => r.total > 0).sort((a, b) => b.total - a.total);
    const all = rows.reduce((s, r) => s + r.total, 0);
    const rank = rows.findIndex((r) => r.product.id === pid) + 1;
    const me = R.products.get(pid) || { labelUnits: 0, campaignUnits: 0 };
    list.sort((x, y) => (y.c.order.date > x.c.order.date ? 1 : y.c.order.date < x.c.order.date ? -1 : 0));
    return { R, days, stores, camps, names, together, list, archive, archiveDays, rank, ranked: rows.length, all, label: me.labelUnits, camp: me.campaignUnits };
  }

  function render() {
    if (!ctx.isCurrent()) return;
    data = compute();
    const D = data;
    const total = D.label + D.camp;
    const nDays = D.days.size;
    const realOrders = D.list.length;
    const daysWith = [...D.days.values()].filter((d) => d.a + d.b > 0).length;
    const series = [...D.days].map(([d, v]) => { const dt = parseYmd(d); return { key: d, label: `${dt.getDate()}.${dt.getMonth() + 1}`, a: v.a, b: v.b, title: `${trDate(d, true)}: ${n(v.a + v.b)} adet${v.b ? ` (${n(v.b)} kampanya)` : ''}${v.orders ? ` · ${v.orders} sipariş` : ''}` }; });
    const peak = [...D.days].sort((a, b) => b[1].a + b[1].b - (a[1].a + a[1].b))[0];
    const stores = [...D.stores.values()].sort((a, b) => b.a + b.b - (a.a + a.b));
    // Bu ürünü açıkça seçen (ya da ödül olarak veren) yayındaki/planlı kampanyalar; "tüm ürünler" kampanyaları listelenmez
    const covers = (c) => (c.rewards || []).some((r) => r.productId === pid) || c.rewardProductId === pid || (((c.triggerProductIds || []).length || c.productMode === 'exclude') && productEligibleRaw(c, pid));
    const liveCamps = state.config.campaigns.map((c) => ({ c, st: campaignStatus(c) })).filter(({ c, st }) => (st.k === 'live' || st.k === 'planned') && covers(c));
    const pname = (id) => state.ctx.label(id);
    ctx.setSub([p.brand, p.sku, p.category].filter(Boolean).join(' · ') + ` · ${rangeLabel(from, to)} · ${filterLabel(filter)}`);

    const body = ctx.el.querySelector('#body');
    mount(body, html`<div class="stack">
      <div class="kpis">
        <div class="kpi hl"><div class="l">${icon('factory')}Toplam gönderilen</div><div class="v">${n(total)}</div><div class="s">${D.all ? `tüm ürünlerin %${pct(total, D.all)}'i` : 'bu aralıkta veri yok'}</div></div>
        <div class="kpi"><div class="l">${icon('box')}Etiketten</div><div class="v">${n(D.label)}</div><div class="s">${n(realOrders)} siparişte</div></div>
        <div class="kpi"><div class="l">${icon('tag')}Kampanyadan</div><div class="v">${n(D.camp)}</div><div class="s">${total ? `toplamın %${pct(D.camp, total)}'i` : '—'}</div></div>
        <div class="kpi"><div class="l">${icon('calendar')}Günlük ortalama</div><div class="v">${(() => { const v = total / Math.max(1, nDays); return v && v < 10 ? v.toFixed(1).replace('.', ',') : n(v); })()}</div><div class="s">${daysWith}/${nDays} günde satış${peak && peak[1].a + peak[1].b ? ` · en yüksek ${trDate(peak[0])}: ${n(peak[1].a + peak[1].b)}` : ''}</div></div>
        <div class="kpi"><div class="l">${icon('dashboard')}Sıralama</div><div class="v">${D.rank ? `${D.rank}.` : '—'}</div><div class="s">${D.ranked} ürün içinde (adet)</div></div>
      </div>
      ${D.archive ? html`<div class="callout info">${icon('info')}<div class="c">${n(D.archive)} adet eski sistemden aktarılan ${D.archiveDays.size} günlük arşivden geliyor; bu günlerin sipariş ve mağaza ayrıntısı yok.</div></div>` : ''}
      <div class="card"><div class="card-h"><h2>Günlük adet</h2><span class="sub">${rangeLabel(from, to)} · bir güne tıklayın → o günün siparişleri</span><span class="spacer"></span><div class="legend"><span><i style="background:var(--brand)"></i>Etiket</span><span><i style="background:color-mix(in srgb,var(--brand) 40%,var(--surface))"></i>Kampanya</span></div></div>
        <div class="card-b" id="chart"></div></div>
      <div class="grid g-2" style="align-items:start">
        <div class="card"><div class="card-h"><h2>Mağaza bazında</h2></div>
          <div class="tw"><table class="t"><thead><tr><th>Mağaza</th><th class="num">Sipariş</th><th class="num">Etiket</th><th class="num">Kamp.</th><th class="num">Toplam</th><th class="num">Pay</th></tr></thead><tbody>
          ${stores.length ? stores.map((s) => html`<tr><td>${s.store ? storeTag(s.store) : s.archive ? html`<span class="badge">${s.sender}</span>` : storeTag(null, s.sender)} <span class="muted xs">${pLabel(s.platform)}</span></td><td class="num">${s.orders ? n(s.orders) : '—'}</td><td class="num">${n(s.a)}</td><td class="num">${s.b ? html`<span class="gift">+${n(s.b)}</span>` : '—'}</td><td class="num"><b>${n(s.a + s.b)}</b></td><td class="num muted">%${pct(s.a + s.b, total)}</td></tr>`) : html`<tr><td colspan="6">${emptyState('store', 'Bu aralıkta satış yok', '')}</td></tr>`}
          </tbody></table></div></div>
        <div class="stack">
          <div class="card"><div class="card-h"><h2>Kampanyalar</h2><span class="sub">bu aralıkta eklenen adet</span></div>
            <div class="tw"><table class="t"><tbody>
            ${D.camps.size ? [...D.camps.values()].sort((a, b) => b.units - a.units).map((c) => html`<tr><td>${c.name}</td><td class="num muted">${c.orders ? `${n(c.orders)} sipariş` : ''}</td><td class="num"><span class="gift">+${n(c.units)}</span></td></tr>`) : html`<tr><td class="muted small">Bu aralıkta bu ürüne kampanya adedi eklenmedi.</td></tr>`}
            </tbody></table></div>
            ${liveCamps.length ? html`<div class="card-f small"><span class="muted">Bu ürünü kapsayan kampanyalar:</span> ${liveCamps.map(({ c, st }) => html`<span class="badge ${st.cls}" title="${st.label}">${c.name}</span> `)}</div>` : ''}
          </div>
          <div class="card"><div class="card-h"><h2>Birlikte alınan ürünler</h2><span class="sub">aynı siparişte</span></div>
            <div class="tw"><table class="t"><tbody>
            ${D.together.size ? [...D.together].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([id, c]) => html`<tr><td><a href="#/product?id=${id}">${pname(id)}</a></td><td class="num">${n(c)} sipariş</td><td class="num muted">%${pct(c, realOrders)}</td></tr>`) : html`<tr><td class="muted small">Bu aralıkta başka ürünle birlikte sipariş yok.</td></tr>`}
            </tbody></table></div></div>
        </div>
      </div>
      <div class="card"><div class="card-h"><h2>Etiketlerde geçen adları</h2><span class="sub">bu ürüne eşleşen etiket satırları</span>${can('admin') ? html`<span class="spacer"></span><a class="btn sm ghost" href="#/matching">Eşleştirme</a>` : ''}</div>
        <div class="tw"><table class="t"><tbody>
        ${D.names.size ? [...D.names.values()].sort((a, b) => b.units - a.units).map((x) => html`<tr><td>${x.raw}${x.mult > 1 ? html` <span class="badge info">×${x.mult}</span>` : ''}</td><td class="num">${n(x.units)} adet</td></tr>`) : html`<tr><td class="muted small">Bu aralıkta yok.</td></tr>`}
        </tbody></table></div></div>
      <div class="card"><div class="card-h"><h2>Siparişler</h2><span class="sub">${n(realOrders)} sipariş · en yeniler önce</span></div>
        <div class="tw" style="max-height:520px"><table class="t"><thead><tr><th>Tarih</th><th>Sipariş no</th><th>Mağaza</th><th>Alıcı</th><th class="num">Adet</th><th class="num">Kamp.</th><th>Siparişteki diğer ürünler</th></tr></thead><tbody>
        ${D.list.length ? D.list.slice(0, 300).map(({ c, lu, cu }) => html`<tr><td class="nowrap">${trDate(c.order.date)}</td><td class="nowrap"><b>${c.order.no}</b></td><td>${storeTag(c.store, c.order.sender)}</td><td class="small">${c.order.recipient || ''}</td><td class="num"><b>${n(lu)}</b></td><td class="num">${cu ? html`<span class="gift">+${n(cu)}</span>` : '—'}</td>
          <td class="small muted">${c.lines.filter((l) => l.productId !== pid && !l.ignored).map((l) => `${l.units}× ${l.productId ? pname(l.productId) : l.raw}`).join(' · ') || '—'}</td></tr>`) : html`<tr><td colspan="7">${emptyState('receipt', 'Bu aralıkta sipariş yok', 'Tarih aralığını genişletin (ör. “Son 30 gün”, “Geçen ay”).')}</td></tr>`}
        </tbody></table></div>
        ${D.list.length > 300 ? html`<div class="card-f small muted">İlk 300 sipariş gösteriliyor; tamamı için Excel indirin.</div>` : ''}</div>
    </div>`);
    body.querySelector('#chart').appendChild(barChart(series, { h: 220, onClick: (d) => { setRange(d, d); ctx.navigate('orders', { q: state.ctx.labelOf(p) }); } }));
  }

  // Kampanyanın bu ürünü tetikleyip tetiklemediği (liste boşsa tüm ürünler)
  function productEligibleRaw(c, id) {
    return productEligible({ triggerProductIds: c.triggerProductIds || [], productMode: c.productMode }, id);
  }

  async function exportXls() {
    if (!data) return;
    const rows = data.list.map(({ c, lu, cu }) => [trDate(c.order.date), c.order.no, c.store ? c.store.name : c.order.sender, pLabel(c.platform), c.order.recipient || '', lu, cu, lu + cu,
      c.lines.filter((l) => l.productId !== pid && !l.ignored).map((l) => `${l.units}× ${l.productId ? state.ctx.label(l.productId) : l.raw}`).join(', ')]);
    await exportTable(`urun_${p.name.replace(/[^\p{L}\p{N}]+/gu, '_')}_${from}_${to}.xlsx`, `${state.ctx.labelOf(p)} · ${rangeLabel(from, to)}`, [
      { label: 'Tarih', width: 12 }, { label: 'Sipariş No', width: 20 }, { label: 'Mağaza', width: 24 }, { label: 'Platform', width: 12 }, { label: 'Alıcı', width: 22 },
      { label: 'Etiket Adedi', num: true, width: 12 }, { label: 'Kampanya', num: true, width: 11 }, { label: 'Toplam', num: true, width: 10 }, { label: 'Diğer ürünler', width: 50 },
    ], rows);
  }

  load();
}

