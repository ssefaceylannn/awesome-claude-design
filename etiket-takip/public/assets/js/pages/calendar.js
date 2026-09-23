// Günlük arşiv: ay takvimi, gün gün sipariş/ürün, yıllık aylık özet.
import { html, mount, icon, n, MONTHS, DOW, today, addDays, parseYmd, emptyState, busy } from '../core/ui.js';
import { state, fetchOrders, setRange, getRange } from '../core/api.js';
import { aggregate } from '../shared/calc.js';
import { storeFilters, filterLabel } from '../core/widgets.js';

const lastDay = (y, m) => new Date(y, m + 1, 0).getDate();
const ym = (y, m) => `${y}-${String(m + 1).padStart(2, '0')}`;

export default async function calendarPage(ctx) {
  const start = parseYmd(getRange().to);
  let y = start.getFullYear(), m = start.getMonth();
  let filter = { storeIds: [], platforms: [] };
  let yearRows = null;

  mount(ctx.el, html`<div class="stack">
    <div class="card"><div class="card-b row wrap" style="gap:12px">
      <button class="btn icon" id="prev">${icon('chevL')}</button><h2 id="mTitle" style="min-width:150px;text-align:center"></h2><button class="btn icon" id="next">${icon('chevR')}</button>
      <button class="btn sm" id="now">Bu ay</button>
      <span class="spacer"></span><div id="fStores" style="width:210px"></div><div id="fPf" style="width:180px"></div>
    </div></div>
    <div id="body"></div>
    <div class="card"><div class="card-h"><h2>Son 12 ay</h2><span class="sub">Aylık toplamlar</span><span class="spacer"></span><button class="btn sm" id="loadYear">${icon('refresh')}Hesapla</button></div><div id="year" class="card-b muted small">Son 12 ayın özetini görmek için “Hesapla”ya basın (birkaç saniye sürebilir).</div></div>
  </div>`);
  const $ = (s) => ctx.el.querySelector(s);
  filter = storeFilters($('#fStores'), $('#fPf'), (f) => { filter = f; load(); yearRows = null; });
  $('#prev').addEventListener('click', () => { m--; if (m < 0) { m = 11; y--; } load(); });
  $('#next').addEventListener('click', () => { m++; if (m > 11) { m = 0; y++; } load(); });
  $('#now').addEventListener('click', () => { const t = new Date(); y = t.getFullYear(); m = t.getMonth(); load(); });

  async function load() {
    $('#mTitle').textContent = `${MONTHS[m]} ${y}`;
    ctx.setSub(`${MONTHS[m]} ${y} · ${filterLabel(filter)}`);
    mount($('#body'), html`<div class="loading"><div class="spin"></div></div>`);
    const from = `${ym(y, m)}-01`, to = `${ym(y, m)}-${String(lastDay(y, m)).padStart(2, '0')}`;
    let orders;
    try { orders = await fetchOrders(from, to); } catch (e) { return mount($('#body'), html`<div class="callout err">${icon('alert')}<div class="c">${e.message}</div></div>`); }
    if (!ctx.isCurrent()) return;
    const byDay = new Map();
    for (const o of orders) { if (!byDay.has(o.date)) byDay.set(o.date, []); byDay.get(o.date).push(o); }
    const days = new Map();
    for (const [d, list] of byDay) days.set(d, aggregate(list, state.ctx, filter));
    const M = aggregate(orders, state.ctx, filter);
    const vals = [...days.values()].map((a) => a.totalUnits);
    const max = Math.max(1, ...vals);
    const active = [...days.values()].filter((a) => a.orders).length;
    const first = new Date(y, m, 1);
    const offset = (first.getDay() + 6) % 7; // Pazartesi başlangıç
    const cells = [];
    for (let i = 0; i < offset; i++) cells.push(null);
    for (let d = 1; d <= lastDay(y, m); d++) cells.push(`${ym(y, m)}-${String(d).padStart(2, '0')}`);
    const t = today();
    const best = [...days.entries()].sort((a, b) => b[1].totalUnits - a[1].totalUnits)[0];

    mount($('#body'), html`<div class="stack">
      <div class="kpis">
        <div class="kpi"><div class="l">Aylık sipariş</div><div class="v">${n(M.orders)}</div><div class="s">${active} günde kayıt var</div></div>
        <div class="kpi"><div class="l">Etiketteki ürün</div><div class="v">${n(M.labelUnits)}</div><div class="s">günlük ort. ${n(active ? M.labelUnits / active : 0)}</div></div>
        <div class="kpi"><div class="l">Kampanyalı sipariş</div><div class="v">${n(M.campaignOrders)}</div><div class="s">+${n(M.campaignUnits)} ürün</div></div>
        <div class="kpi hl"><div class="l">Toplam gönderilen</div><div class="v">${n(M.totalUnits)}</div><div class="s">${best ? `en yoğun gün: ${parseYmd(best[0]).getDate()} ${MONTHS[m]}` : ''}</div></div>
      </div>
      <div class="card"><div class="card-b">
        <div class="cal">${['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'].map((d) => html`<div class="dow">${d}</div>`)}
        ${cells.map((d) => {
          if (!d) return html`<div></div>`;
          const a = days.get(d);
          const h = a && a.totalUnits ? Math.min(4, 1 + Math.floor((a.totalUnits / max) * 4)) : 0;
          return html`<div class="day ${d === t ? 'today' : ''} ${d > t ? 'out' : ''}" data-day="${d}" data-h="${h}" title="${DOW[parseYmd(d).getDay()]}">
            <span class="d">${parseYmd(d).getDate()}</span>
            ${a && a.orders ? html`<span class="o">${n(a.orders)} <span class="muted xs" style="font-weight:500">sipariş</span></span><span class="u">${n(a.totalUnits)} ürün${a.campaignUnits ? ` · +${n(a.campaignUnits)} kamp.` : ''}</span>` : ''}
          </div>`;
        })}</div>
        <p class="muted small" style="margin-top:12px">Bir güne tıklayınca o günün üretim listesi açılır. Kayıtlar ${state.config.settings.retentionDays} gün saklanır.</p>
      </div></div>
    </div>`);
  }

  $('#body').addEventListener('click', (e) => {
    const d = e.target.closest('[data-day]');
    if (!d || d.classList.contains('out')) return;
    setRange(d.dataset.day, d.dataset.day);
    ctx.navigate('production');
  });

  $('#loadYear').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    busy(btn, true, 'Hesaplanıyor…');
    try {
      const rows = [];
      const now = new Date();
      for (let i = 11; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const yy = d.getFullYear(), mm = d.getMonth();
        const from = `${ym(yy, mm)}-01`;
        const to = i === 0 ? today() : `${ym(yy, mm)}-${String(lastDay(yy, mm)).padStart(2, '0')}`;
        const orders = await fetchOrders(from, to);
        rows.push({ label: `${MONTHS[mm]} ${yy}`, R: aggregate(orders, state.ctx, filter) });
        if (!ctx.isCurrent()) return;
      }
      yearRows = rows;
      const max = Math.max(1, ...rows.map((r) => r.R.totalUnits));
      mount($('#year'), rows.some((r) => r.R.orders) ? html`<div class="tw" style="margin:-16px -18px"><table class="t"><thead><tr><th>Ay</th><th class="num">Sipariş</th><th class="num">Etiket</th><th class="num">Kampanyalı sip.</th><th class="num">Kampanya</th><th class="num">Toplam</th><th style="width:30%"></th></tr></thead><tbody>
        ${rows.slice().reverse().map((r) => html`<tr><td><b>${r.label}</b></td><td class="num">${n(r.R.orders)}</td><td class="num">${n(r.R.labelUnits)}</td><td class="num">${n(r.R.campaignOrders)}</td><td class="num">${n(r.R.campaignUnits)}</td><td class="num big">${n(r.R.totalUnits)}</td><td><div class="progress"><i style="width:${(r.R.totalUnits / max) * 100}%"></i></div></td></tr>`)}
      </tbody></table></div>` : emptyState('calendar', 'Son 12 ayda kayıt yok', ''));
    } catch (err) { mount($('#year'), html`<span class="unm">${err.message}</span>`); }
    busy(btn, false);
  });

  load();
  return () => { yearRows = null; };
}

export { addDays };
