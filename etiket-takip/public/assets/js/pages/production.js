// Üretim / sevk listesi: katalog sırasına göre gönderilecek adetler.
import { html, mount, icon, n, pct, toast, busy, emptyState, rangeLabel, esc, pBadge, multiSelect, collator } from '../core/ui.js';
import { state, fetchOrders, getRange } from '../core/api.js';
import { aggregate, productionRows } from '../shared/calc.js';
import { rangePicker, storeFilters, filterLabel } from '../core/widgets.js';
import { exportProduction, exportFixedList } from '../core/excel.js';

export default async function productionPage(ctx) {
  let { from, to } = getRange();
  let filter = { storeIds: [], platforms: [] };
  let includeZero = localStorage.getItem('et-zero') === '1';
  let view = 'list';
  let R = null;
  // Ekran görünümü (Excel "sabit liste"yi etkilemez)
  let sortKey = 'catalog', sortDir = 1, q = '', cats = [], onlyCamp = false;

  mount(ctx.actions, html`<button class="btn" id="printBtn">${icon('printer')}Yazdır</button>
    <div class="ms" id="xlsWrap" style="position:relative"><button class="btn primary" id="xls">${icon('sheet')}Excel indir ${icon('chevD')}</button></div>`);
  mount(ctx.el, html`<div class="stack">
    <div class="card"><div class="card-b row wrap" style="gap:12px">
      <div id="range"></div>
      <div id="fStores" style="width:210px"></div>
      <div id="fPf" style="width:180px"></div>
      <label class="switch small"><input type="checkbox" id="zero" ${includeZero ? 'checked' : ''}> Satışı olmayan ürünleri de göster</label>
    </div>
    <div class="card-f row wrap" style="gap:10px">
      <div class="search" style="width:240px;max-width:100%">${icon('search')}<input class="input sm" id="q" placeholder="Ürün ara…"></div>
      <div id="fCat" style="width:200px"></div>
      <label class="check small"><input type="checkbox" id="onlyCamp"> Sadece kampanyalı ürünler</label>
      <select class="input sm" id="sort" style="width:auto">
        <option value="catalog">Sıralama: katalog sırası</option>
        <option value="name:1">Ürün adı A → Z</option><option value="name:-1">Ürün adı Z → A</option>
        <option value="total:-1">Gönderilecek: çok → az</option><option value="total:1">Gönderilecek: az → çok</option>
        <option value="label:-1">Etiket adedi: çok → az</option><option value="camp:-1">Kampanya: çok → az</option>
        <option value="orders:-1">Sipariş sayısı: çok → az</option><option value="cat:1">Kategoriye göre</option>
      </select>
      <span class="muted xs">Sıralama ve filtre yalnızca ekranı etkiler.</span>
    </div></div>
    <div id="body"></div>
  </div>`);
  const $ = (s) => ctx.el.querySelector(s);

  rangePicker($('#range'), { onChange: (f, t) => { from = f; to = t; load(); } });
  filter = storeFilters($('#fStores'), $('#fPf'), (f) => { filter = f; load(); });
  $('#zero').addEventListener('change', (e) => { includeZero = e.target.checked; localStorage.setItem('et-zero', includeZero ? '1' : '0'); render(); });
  const allCats = [...new Set(state.config.products.map((p) => p.category).filter(Boolean))].sort(collator.compare);
  multiSelect($('#fCat'), { options: allCats.map((c) => ({ id: c, label: c })), allLabel: 'Tüm kategoriler', onChange: (v) => { cats = v; render(); } });
  $('#q').addEventListener('input', (e) => { q = e.target.value.toLocaleLowerCase('tr-TR').trim(); render(); });
  $('#onlyCamp').addEventListener('change', (e) => { onlyCamp = e.target.checked; render(); });
  $('#sort').addEventListener('change', (e) => { const [k, d] = e.target.value.split(':'); sortKey = k; sortDir = +d || 1; render(); });

  /** Ekranda gösterilecek satırlar: filtre + sıralama */
  function viewRows() {
    let rows = productionRows(R, state.ctx, { includeZero });
    rows.forEach((r, i) => { r.pos = i + 1; });
    if (q) rows = rows.filter((r) => r.product.name.toLocaleLowerCase('tr-TR').includes(q) || (r.product.sku || '').toLocaleLowerCase('tr-TR').includes(q));
    if (cats.length) rows = rows.filter((r) => cats.includes(r.product.category));
    if (onlyCamp) rows = rows.filter((r) => r.campaignUnits > 0);
    const val = { name: (r) => r.product.name, total: (r) => r.total, label: (r) => r.labelUnits, camp: (r) => r.campaignUnits, orders: (r) => r.orders, cat: (r) => r.product.category || 'ÿ' };
    if (sortKey !== 'catalog' && val[sortKey]) {
      rows.sort((a, b) => {
        const x = val[sortKey](a), y = val[sortKey](b);
        const c = typeof x === 'string' ? collator.compare(x, y) : x - y;
        return c * sortDir || a.pos - b.pos;
      });
    }
    return rows;
  }
  const sortTh = (key, label, cls = '') => html`<th class="${cls}" data-sort="${key}" style="cursor:pointer;user-select:none" title="Sıralamak için tıklayın">${label}${sortKey === key ? (sortDir > 0 ? ' ▲' : ' ▼') : ''}</th>`;

  async function load() {
    mount($('#body'), html`<div class="loading"><div class="spin"></div><span>Hesaplanıyor…</span></div>`);
    try {
      const orders = await fetchOrders(from, to);
      if (!ctx.isCurrent()) return;
      R = aggregate(orders, state.ctx, filter);
      render();
    } catch (e) { mount($('#body'), html`<div class="callout err">${icon('alert')}<div class="c">${e.message}</div></div>`); }
  }

  function render() {
    if (!R) return;
    ctx.setSub(`${rangeLabel(from, to)} · ${filterLabel(filter)}`);
    const rows = viewRows();
    const unmatchedUnits = [...R.unmatched.values()].reduce((s, u) => s + u.units, 0);
    const maxT = Math.max(1, ...rows.map((r) => r.total));
    const stores = [...R.stores.values()];

    mount($('#body'), html`<div class="stack">
      <div class="kpis">
        <div class="kpi"><div class="l">${icon('receipt')}Sipariş</div><div class="v">${n(R.orders)}</div><div class="s">${stores.length} mağazadan</div></div>
        <div class="kpi"><div class="l">${icon('box')}Etiketteki ürün</div><div class="v">${n(R.labelUnits)}</div><div class="s">${R.orders ? (R.labelUnits / R.orders).toLocaleString('tr-TR', { maximumFractionDigits: 2 }) : 0} / sipariş</div></div>
        <div class="kpi"><div class="l">${icon('tag')}Kampanyalı sipariş</div><div class="v">${n(R.campaignOrders)}</div><div class="s">siparişlerin %${pct(R.campaignOrders, R.orders)}'i</div></div>
        <div class="kpi"><div class="l">${icon('gift')}Kampanyayla eklenen</div><div class="v">${n(R.campaignUnits)}</div><div class="s">${R.campaigns.size} kampanya</div></div>
        <div class="kpi hl"><div class="l">${icon('factory')}Toplam gönderilecek</div><div class="v">${n(R.totalUnits - unmatchedUnits)}</div><div class="s">${unmatchedUnits ? `+${n(unmatchedUnits)} eşleşmeyen adet hariç` : 'etiket + kampanya'}</div></div>
      </div>
      ${R.archiveDays && R.archiveDays.size ? html`<div class="callout info">${icon('history')}<div class="c"><b>${R.archiveDays.size} gün eski sistemden aktarılan arşiv özeti içeriyor</b>Bu günlerin adetleri eski sistemin kaydettiği gibidir (kampanyalar yeniden hesaplanmaz); kampanyalı sipariş sayısı bu günler için bilinmiyor.</div></div>` : ''}
      ${R.unmatched.size ? html`<div class="callout warn">${icon('alert')}<div class="c"><b>${R.unmatched.size} ürün adı (${n(unmatchedUnits)} adet) katalogla eşleşmediği için listede yok</b>
        ${[...R.unmatched.values()].slice(0, 6).map((u) => u.raw).join(' · ')}${R.unmatched.size > 6 ? ' …' : ''} — <a href="#/matching">Ürün Eşleştirme</a> sayfasından atayın, liste anında güncellenir.</div></div>` : ''}
      <div class="card">
        <div class="tabs">${[['list', 'Üretim listesi'], ['matrix', 'Mağaza × ürün'], ['stores', 'Mağaza özeti'], ['camps', 'Kampanyalar']].map(([k, l]) => html`<button data-v="${k}" class="${view === k ? 'on' : ''}">${l}</button>`)}</div>
        ${view === 'list' ? html`<div class="tw"><table class="t"><thead><tr>${sortTh('catalog', '#', 'num')}${sortTh('name', 'Ürün')}${sortTh('cat', 'Kategori', 'hide-m')}${sortTh('label', 'Etiket', 'num')}${sortTh('camp', 'Kamp.', 'num')}${sortTh('total', 'Gönderilecek', 'num')}${sortTh('orders', 'Sipariş', 'num hide-m')}<th class="hide-m" style="width:22%"></th></tr></thead><tbody>
          ${rows.length ? rows.map((r) => html`<tr class="${r.total ? '' : 'muted'}">
            <td class="num muted" title="Katalog sırası">${r.pos}</td><td><b>${r.product.name}</b></td><td class="hide-m">${r.product.category ? html`<span class="badge">${r.product.category}</span>` : ''}</td>
            <td class="num">${n(r.labelUnits)}</td><td class="num">${r.campaignUnits ? html`<span class="gift">+${n(r.campaignUnits)}</span>` : html`<span class="muted">—</span>`}</td>
            <td class="num big">${n(r.total)}</td><td class="num hide-m">${n(r.orders)}</td>
            <td class="hide-m"><div class="progress" style="height:6px"><i style="width:${(r.total / maxT) * 100}%"></i></div></td></tr>`)
          : html`<tr><td colspan="8">${emptyState('factory', 'Bu aralıkta sipariş yok', state.config.products.length ? 'Tarih aralığını değiştirin veya etiket yükleyin.' : html`Önce <a href="#/products">Ürünler</a> sayfasından ürün kataloğunuzu ve sırasını oluşturun.`)}</td></tr>`}
          </tbody>${rows.length ? html`<tfoot><tr><td></td><td>TOPLAM</td><td class="hide-m"></td><td class="num">${n(rows.reduce((s, r) => s + r.labelUnits, 0))}</td><td class="num">+${n(rows.reduce((s, r) => s + r.campaignUnits, 0))}</td><td class="num big">${n(rows.reduce((s, r) => s + r.total, 0))}</td><td class="num hide-m">${n(R.orders)}</td><td class="hide-m"></td></tr></tfoot>` : ''}</table></div>` : ''}
        ${view === 'matrix' ? html`<div class="tw"><table class="t"><thead><tr><th>Ürün</th>${stores.map((s) => html`<th class="num">${s.store ? html`<span class="sdot" style="background:${s.store.color}"></span> ${s.store.code || s.store.name}` : 'Tanımsız'}</th>`)}<th class="num">Toplam</th></tr></thead><tbody>
          ${rows.map((r) => html`<tr><td><b>${r.product.name}</b></td>${stores.map((s) => html`<td class="num">${n(s.products.get(r.product.id) || 0) === '0' ? html`<span class="muted">·</span>` : n(s.products.get(r.product.id) || 0)}</td>`)}<td class="num big">${n(r.total)}</td></tr>`)}
          </tbody></table></div>` : ''}
        ${view === 'stores' ? html`<div class="tw"><table class="t"><thead><tr><th>Mağaza</th><th>Platform</th><th class="num">Sipariş</th><th class="num">Etiket adedi</th><th class="num">Kampanyalı sipariş</th><th class="num">Kampanya adedi</th><th class="num">Toplam</th></tr></thead><tbody>
          ${stores.map((s) => html`<tr><td>${s.store ? html`<span class="row" style="gap:8px;display:inline-flex"><span class="sdot" style="background:${s.store.color}"></span><b>${s.store.name}</b></span>` : html`<span class="badge warn">Tanımsız: ${s.sender}</span>`}</td><td>${pBadge(s.platform)}</td>
            <td class="num">${n(s.orders)}</td><td class="num">${n(s.labelUnits)}</td><td class="num">${n(s.campaignOrders)}</td><td class="num">${n(s.campaignUnits)}</td><td class="num big">${n(s.labelUnits + s.campaignUnits)}</td></tr>`)}
          </tbody><tfoot><tr><td>TOPLAM</td><td></td><td class="num">${n(R.orders)}</td><td class="num">${n(R.labelUnits)}</td><td class="num">${n(R.campaignOrders)}</td><td class="num">${n(R.campaignUnits)}</td><td class="num">${n(R.totalUnits)}</td></tr></tfoot></table></div>` : ''}
        ${view === 'camps' ? html`<div class="tw"><table class="t"><thead><tr><th>Kampanya</th><th class="num">Uygulanan sipariş</th><th class="num">Eklenen adet</th></tr></thead><tbody>
          ${R.campaigns.size ? [...R.campaigns.values()].map((c) => html`<tr><td><b>${c.name}</b></td><td class="num">${n(c.orders.size)}</td><td class="num">${n(c.units)}</td></tr>`) : html`<tr><td colspan="3">${emptyState('tag', 'Bu aralıkta kampanya uygulanmadı', '')}</td></tr>`}
          </tbody></table></div>` : ''}
      </div>
    </div>`);
    $('#body').querySelectorAll('[data-v]').forEach((b) => b.addEventListener('click', () => { view = b.dataset.v; render(); }));
    $('#body').querySelectorAll('[data-sort]').forEach((th) => th.addEventListener('click', () => {
      const k = th.dataset.sort;
      if (sortKey === k) sortDir = -sortDir; else { sortKey = k; sortDir = k === 'name' || k === 'cat' || k === 'catalog' ? 1 : -1; }
      if (k === 'catalog') sortDir = 1;
      const opt = [...$('#sort').options].find((o) => o.value === (k === 'catalog' ? 'catalog' : `${k}:${sortDir}`));
      $('#sort').value = opt ? opt.value : 'catalog';
      render();
    }));
  }

  // Sabit sıra: katalogdaki tüm ürünler, 0'lar dahil (ekran sıralaması/filtresi etkilemez)
  const fixedValues = () => state.ctx.products.map((p) => { const a = R.products.get(p.id); return [p.name, a ? a.labelUnits + a.campaignUnits : 0]; });
  async function copyText(text, msg) {
    try { await navigator.clipboard.writeText(text); toast(msg, 'ok'); }
    catch { // izin yoksa eski yöntem
      const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); ta.remove(); toast(msg, 'ok');
    }
  }
  const wrap = ctx.actions.querySelector('#xlsWrap');
  let menu = null;
  const closeMenu = () => { if (menu) { menu.remove(); menu = null; } };
  ctx.actions.querySelector('#xls').addEventListener('click', (e) => {
    e.stopPropagation();
    if (menu) return closeMenu();
    if (!R) return;
    menu = document.createElement('div');
    menu.className = 'pop';
    menu.style.cssText = 'right:0;left:auto;min-width:320px';
    mount(menu, html`<div class="opts" style="margin:0">
      <div class="opt" data-x="full">${icon('sheet')}<div><b>Detaylı rapor</b><div class="muted xs">Üretim listesi + mağaza, kampanya, sipariş sayfaları</div></div></div>
      <div class="opt" data-x="fixed">${icon('sheet')}<div><b>Sabit sıralı liste (0'lar dahil)</b><div class="muted xs">Katalogdaki tüm ${state.ctx.products.length} ürün, Ürünler sayfasındaki sırayla · ekran sıralaması etkilemez</div></div></div>
      <div class="grp">Panoya kopyala (sabit sıra, 0'lar dahil)</div>
      <div class="opt" data-x="copyQty">${icon('copy')}<div><b>Yalnızca adetler</b><div class="muted xs">Tablonuzdaki adet sütununa doğrudan yapıştırın</div></div></div>
      <div class="opt" data-x="copyBoth">${icon('copy')}<div><b>Ürün adı + adet</b><div class="muted xs">İki sütun olarak yapıştırılır</div></div></div>
    </div>`);
    wrap.appendChild(menu);
    menu.addEventListener('click', async (ev) => {
      const it = ev.target.closest('[data-x]');
      if (!it) return;
      const x = it.dataset.x;
      closeMenu();
      const btn = ctx.actions.querySelector('#xls');
      try {
        if (x === 'full') {
          busy(btn, true, 'Hazırlanıyor…');
          await exportProduction({ R, ctx: state.ctx, from, to, filterLabel: filterLabel(filter), includeZero, user: state.me.username, company: state.config.settings.companyName });
          toast('Excel indirildi', 'ok');
        } else if (x === 'fixed') {
          busy(btn, true, 'Hazırlanıyor…');
          await exportFixedList({ R, ctx: state.ctx, from, to, filterLabel: filterLabel(filter) });
          toast('Sabit sıralı liste indirildi', 'ok');
        } else if (x === 'copyQty') {
          await copyText(fixedValues().map((r) => r[1]).join('\n'), `${state.ctx.products.length} satır adet kopyalandı`);
        } else if (x === 'copyBoth') {
          await copyText(fixedValues().map((r) => `${r[0]}\t${r[1]}`).join('\n'), `${state.ctx.products.length} satır kopyalandı`);
        }
      } catch (err) { toast(err.message, 'err'); }
      busy(btn, false);
    });
  });
  const outside = (e) => { if (menu && !wrap.contains(e.target)) closeMenu(); };
  document.addEventListener('mousedown', outside);
  ctx.actions.querySelector('#printBtn').addEventListener('click', () => {
    if (!R) return;
    const rows = productionRows(R, state.ctx, { includeZero });
    document.getElementById('print').innerHTML = `<h1>${esc(state.config.settings.companyName ? state.config.settings.companyName + ' — ' : '')}Üretim / Sevk Listesi</h1>
      <p>${esc(rangeLabel(from, to))} · ${esc(filterLabel(filter))} · ${n(R.orders)} sipariş · ${n(R.campaignOrders)} kampanyalı sipariş</p>
      <table><thead><tr><th>#</th><th>Ürün</th><th class="num">Etiket</th><th class="num">Kampanya</th><th class="num">Gönderilecek</th><th class="box">✓</th></tr></thead><tbody>
      ${rows.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.product.name)}</td><td class="num">${n(r.labelUnits)}</td><td class="num">${r.campaignUnits ? '+' + n(r.campaignUnits) : ''}</td><td class="num"><b>${n(r.total)}</b></td><td class="box"></td></tr>`).join('')}
      <tr><td></td><td><b>TOPLAM</b></td><td class="num">${n(rows.reduce((s, r) => s + r.labelUnits, 0))}</td><td class="num">+${n(rows.reduce((s, r) => s + r.campaignUnits, 0))}</td><td class="num"><b>${n(rows.reduce((s, r) => s + r.total, 0))}</b></td><td></td></tr>
      </tbody></table>${R.unmatched.size ? `<p style="margin-top:10px">⚠ ${R.unmatched.size} eşleşmeyen ürün adı listede yok.</p>` : ''}`;
    window.print();
  });

  load();
  return () => document.removeEventListener('mousedown', outside);
}
