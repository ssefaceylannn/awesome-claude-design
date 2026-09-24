// Genel bakış: seçili günün özeti, 14 günlük eğilim, uyarılar.
import { html, mount, icon, n, pct, addDays, longDate, trDate, trDateTime, today, emptyState, pBadge, parseYmd } from '../core/ui.js';
import { api, state, fetchOrders, getRange, setRange, can } from '../core/api.js';
import { aggregate, productionRows, brandResolved } from '../shared/calc.js';
import { rangePicker, barChart } from '../core/widgets.js';
import { campaignStatus } from './campaigns.js';
import { isArchiveOnly } from '../shared/matcher.js';

export default async function dashboardPage(ctx) {
  let day = getRange().to;
  if (day > today()) day = today();
  setRange(day, day);

  const hour = new Date().getHours();
  const greet = hour < 6 ? 'İyi geceler' : hour < 12 ? 'Günaydın' : hour < 18 ? 'İyi günler' : 'İyi akşamlar';
  mount(ctx.actions, html`${can('personel') ? html`<a class="btn" href="#/upload">${icon('upload')}Etiket yükle</a>` : ''}<a class="btn primary" href="#/production">${icon('factory')}Üretim listesi</a>`);
  mount(ctx.el, html`<div class="stack">
    <div class="row wrap"><div><h2 style="font-size:1.2rem">${greet}, ${state.me.username}</h2><div class="muted small" id="dayLabel"></div></div><span class="spacer"></span><div id="picker"></div></div>
    <div id="body"><div class="loading"><div class="spin"></div></div></div>
  </div>`);
  rangePicker(ctx.el.querySelector('#picker'), { single: true, onChange: (f) => { day = f; load(); } });

  let batches = [];
  let names = {};
  const extras = Promise.all([
    api.get('batches?limit=6').then((r) => { batches = r.batches; }).catch(() => {}),
    api.get('labelnames').then((r) => { names = r.names; }).catch(() => {}),
  ]);

  async function load() {
    ctx.el.querySelector('#dayLabel').textContent = longDate(day);
    ctx.setSub(longDate(day));
    const from = addDays(day, -13);
    let orders;
    try { [orders] = await Promise.all([fetchOrders(from, day), extras]); } catch (e) { return mount(ctx.el.querySelector('#body'), html`<div class="callout err">${icon('alert')}<div class="c">${e.message}</div></div>`); }
    if (!ctx.isCurrent()) return;
    const byDay = new Map();
    for (const o of orders) { if (!byDay.has(o.date)) byDay.set(o.date, []); byDay.get(o.date).push(o); }
    const R = aggregate(byDay.get(day) || [], state.ctx);
    const P = aggregate(byDay.get(addDays(day, -1)) || [], state.ctx);
    const series = [];
    for (let d = from; d <= day; d = addDays(d, 1)) {
      const a = aggregate(byDay.get(d) || [], state.ctx);
      const dt = parseYmd(d);
      series.push({ key: d, label: `${dt.getDate()}.${dt.getMonth() + 1}`, a: a.labelUnits, b: a.campaignUnits, title: `${trDate(d, true)}: ${a.orders} sipariş, ${a.totalUnits} ürün (${a.campaignUnits} kampanya)` });
    }
    const top = productionRows(R, state.ctx).sort((a, b) => b.total - a.total).slice(0, 8);
    const maxTop = Math.max(1, ...top.map((t) => t.total));
    let unmatchedNames = 0;
    for (const v of Object.values(names)) { if (isArchiveOnly(v)) continue; const m = state.ctx.match(v.raw); if (!m.productId && !m.ignored && !m.parts && !brandResolved(m, state.ctx)) unmatchedNames++; }
    const unknownSenders = new Set(orders.filter((o) => !o.summary && !state.ctx.resolveStore(o.sender)).map((o) => o.sender)).size;
    const live = state.config.campaigns.filter((c) => campaignStatus(c).k === 'live');
    const delta = (a, b) => {
      if (!b) return '';
      const d = Math.round(((a - b) / b) * 100);
      return html`<span class="delta ${d >= 0 ? 'up' : 'down'}">${d >= 0 ? '▲' : '▼'} %${Math.abs(d)}</span>`;
    };
    const stores = [...R.stores.values()].sort((a, b) => b.orders - a.orders);

    mount(ctx.el.querySelector('#body'), html`<div class="stack">
      <div class="kpis">
        <div class="kpi"><div class="l">Sipariş ${delta(R.orders, P.orders)}</div><div class="v">${n(R.orders)}</div><div class="s">dün ${n(P.orders)}</div></div>
        <div class="kpi"><div class="l">Etiketteki ürün ${delta(R.labelUnits, P.labelUnits)}</div><div class="v">${n(R.labelUnits)}</div><div class="s">dün ${n(P.labelUnits)}</div></div>
        <div class="kpi"><div class="l">Kampanyalı sipariş</div><div class="v">${n(R.campaignOrders)}</div><div class="s">+${n(R.campaignUnits)} ürün · %${pct(R.campaignOrders, R.orders)}</div></div>
        <div class="kpi hl"><div class="l">Toplam gönderilecek ${delta(R.totalUnits, P.totalUnits)}</div><div class="v">${n(R.totalUnits)}</div><div class="s">dün ${n(P.totalUnits)}</div></div>
        <div class="kpi"><div class="l">Barkod kontrolü</div><div class="v">%${pct(R.checked, R.orders)}</div><div class="s">${n(R.checked)} / ${n(R.orders)} sipariş</div></div>
      </div>
      <div class="grid g-main">
        <div class="card"><div class="card-h"><h2>Son 14 gün</h2><span class="sub">Gönderilecek ürün adedi</span><span class="spacer"></span>
          <div class="legend"><span><i style="background:var(--brand)"></i>Etiket</span><span><i style="background:color-mix(in srgb,var(--brand) 40%,var(--surface))"></i>Kampanya</span></div></div>
          <div class="card-b" id="chart"></div></div>
        <div class="card"><div class="card-h"><h2>Dikkat gerektirenler</h2></div><div class="card-b stack" style="gap:10px">
          ${unmatchedNames ? html`<a class="callout warn" href="#/matching" style="text-decoration:none">${icon('link')}<div class="c"><b>${unmatchedNames} ürün adı eşleşmedi</b><span class="small">Üretim listesine girmiyor — eşleştirin</span></div></a>` : html`<div class="callout ok">${icon('check')}<div class="c"><b>Tüm ürün adları eşleşiyor</b></div></div>`}
          ${unknownSenders ? html`<a class="callout warn" href="#/stores" style="text-decoration:none">${icon('store')}<div class="c"><b>${unknownSenders} tanımsız gönderici</b><span class="small">Son 14 günde mağazaya bağlanmamış etiketler</span></div></a>` : ''}
          ${!state.config.products.length ? html`<a class="callout info" href="#/products" style="text-decoration:none">${icon('box')}<div class="c"><b>Ürün kataloğu boş</b><span class="small">Ürünleri üretim sırasıyla ekleyin</span></div></a>` : ''}
          ${!state.config.stores.length ? html`<a class="callout info" href="#/stores" style="text-decoration:none">${icon('store')}<div class="c"><b>Mağaza tanımlanmadı</b><span class="small">6 Trendyol, 3 ikas, 1 Shopify mağazanızı ekleyin</span></div></a>` : ''}
          <div class="callout info">${icon('tag')}<div class="c"><b>${live.length} kampanya yayında</b><span class="small">${live.slice(0, 3).map((c) => c.name).join(' · ') || 'Aktif kampanya yok'}</span></div></div>
        </div></div>
      </div>
      <div class="grid g-2">
        <div class="card"><div class="card-h"><h2>En çok gönderilecek ürünler</h2><span class="sub">${trDate(day)}</span><span class="spacer"></span><a class="small" href="#/production">Tümü →</a></div>
          <div class="card-b">${top.length ? html`<div class="hbar">${top.map((t) => html`<span>${state.ctx.labelOf(t.product)}</span><b class="num">${n(t.total)}</b><div class="track"><i style="width:${(t.total / maxTop) * 100}%"></i></div>`)}</div>` : emptyState('box', 'Bu gün için sipariş yok', '')}</div></div>
        <div class="card"><div class="card-h"><h2>Mağazalar</h2><span class="sub">${trDate(day)}</span></div>
          <div class="tw"><table class="t"><thead><tr><th>Mağaza</th><th class="num">Sipariş</th><th class="num">Ürün</th><th class="num">Kampanya</th></tr></thead><tbody>
          ${stores.length ? stores.map((s) => html`<tr><td>${s.store ? html`<span class="row" style="gap:8px;display:inline-flex"><span class="sdot" style="background:${s.store.color}"></span>${s.store.name}</span>` : s.archive ? html`<span class="badge">${s.sender}</span>` : html`<span class="badge warn">Tanımsız</span>`} ${pBadge(s.platform)}</td><td class="num">${n(s.orders)}</td><td class="num">${n(s.labelUnits)}</td><td class="num">${s.campaignUnits ? html`<span class="gift">+${n(s.campaignUnits)}</span>` : '—'}</td></tr>`) : html`<tr><td colspan="4">${emptyState('store', 'Sipariş yok', '')}</td></tr>`}
          </tbody></table></div></div>
      </div>
      ${batches.length ? html`<div class="card"><div class="card-h"><h2>Son yüklemeler</h2><span class="spacer"></span>${can('personel') ? html`<a class="small" href="#/upload">Tümü →</a>` : ''}</div><div class="tw"><table class="t"><tbody>
        ${batches.map((b) => html`<tr><td class="nowrap">${trDateTime(b.at)}</td><td>${b.by}</td><td class="small muted">${b.files.slice(0, 2).join(', ')}${b.files.length > 2 ? '…' : ''}</td><td class="num"><b>${n(b.counts.new)}</b> yeni</td><td class="num muted">${n(b.counts.dup)} mükerrer</td></tr>`)}
      </tbody></table></div></div>` : ''}
    </div>`);
    // Bir güne tıklayınca o günün üretim listesi açılır
    ctx.el.querySelector('#chart').appendChild(barChart(series, { onClick: (d) => { setRange(d, d); ctx.navigate('production'); } }));
  }
  load();
}
