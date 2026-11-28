// Stok Kontrol (yalnızca bilgi): Google E-Tablolar "KALAN" sayfasındaki stokla seçilen siparişlerin
// ihtiyacını karşılaştırır. Tabloya hiçbir şey yazılmaz, sitede de tabloda da stok düşülmez.
import { html, mount, icon, n, toast, busy, emptyState, rangeLabel, trDateTime, personName, multiSelect, storeTag, modal, today } from '../core/ui.js';
import { api, state, fetchOrders, getRange, isAdmin, saveSection } from '../core/api.js';
import { computeOrder } from '../shared/calc.js';
import { parseCsv } from '../shared/csv.js';
import { parseStockRows, matchStock, checkStock, DEFAULT_STOCK_TIMES, STOCK_TIME_RANGE } from '../shared/stock.js';
import { rangePicker } from '../core/widgets.js';
import { exportSheets } from '../core/excel.js';

const PREF = 'et-stock';
const loadPref = () => { try { return JSON.parse(localStorage.getItem(PREF) || '{}'); } catch { return {}; } };
const savePref = (p) => { try { localStorage.setItem(PREF, JSON.stringify({ ...loadPref(), ...p })); } catch { /* yok */ } };

export default async function stockPage(ctx) {
  let { from, to } = getRange();
  const pref = loadPref();
  let includeRewards = pref.rewards !== false;
  let view = 'short';
  let batchIds = [];
  let sheet = null; // { items, fetchedAt, tab }
  let dayOrders = [], batches = [], R = null, stock = null;

  mount(ctx.actions, html`<button class="btn" id="reload">${icon('refresh')}Tabloyu yeniden oku</button>
    <button class="btn primary" id="xls">${icon('sheet')}Excel indir</button>`);
  mount(ctx.el, html`<div class="stack">
    <div class="callout info">${icon('info')}<div class="c"><b>Yalnızca bilgi amaçlıdır</b>Stoklar Google E-Tablolar'daki “KALAN” sayfasından <b>yalnızca okunur</b>. Tabloya hiçbir şey yazılmaz; ne tablodan ne siteden stok düşülür.</div></div>
    <div id="link"></div>
    <div id="runs"></div>
    <div class="card"><div class="card-b row wrap" style="gap:12px">
      <div id="range"></div>
      <div id="fBatch" style="width:300px;max-width:100%"></div>
      <label class="switch small"><input type="checkbox" id="rw" ${includeRewards ? 'checked' : ''}> Kampanya hediyelerini de say</label>
    </div></div>
    <div id="body"></div>
  </div>`);
  const $ = (s) => ctx.el.querySelector(s);

  rangePicker($('#range'), { onChange: (f, t) => { from = f; to = t; batchIds = []; loadOrders(); } });
  $('#rw').addEventListener('change', (e) => { includeRewards = e.target.checked; savePref({ rewards: includeRewards }); compute(); });
  ctx.actions.querySelector('#reload').addEventListener('click', async (e) => { busy(e.currentTarget, true, 'Okunuyor…'); loadRuns(); await loadSheet(); busy(ctx.actions.querySelector('#reload'), false); compute(); });
  ctx.actions.querySelector('#xls').addEventListener('click', exportXls);

  // ---------------------------------------------------------------- tablo bağlantısı
  function drawLink() {
    const ref = state.config.settings.stockSheet;
    const admin = isAdmin();
    if (ref && ref.id) {
      mount($('#link'), html`<div class="row wrap small muted" style="gap:10px">${icon('sheet')}
        <span>Stok tablosu: <a href="https://docs.google.com/spreadsheets/d/${ref.id}/edit" target="_blank" rel="noopener noreferrer">Google E-Tablolar’da aç</a> · sayfa <b>${ref.tab}</b>${sheet ? html` · okundu ${trDateTime(sheet.fetchedAt)} · ${n(sheet.items.length)} satır` : ''}</span>
        ${admin ? html`<a href="#" id="editLink">Bağlantıyı değiştir</a>` : ''}</div>`);
      const ed = $('#editLink');
      if (ed) ed.addEventListener('click', (e) => { e.preventDefault(); linkForm(ref); });
    } else linkForm(null);
  }
  function linkForm(ref) {
    if (!isAdmin()) {
      mount($('#link'), html`<div class="callout warn">${icon('alert')}<div class="c"><b>Stok tablosu bağlanmamış</b>Bir yöneticinin bu sayfada Google E-Tablolar bağlantısını girmesi gerekiyor.</div></div>`);
      return;
    }
    mount($('#link'), html`<div class="card"><div class="card-b stack" style="gap:10px">
      <b>Stok tablosunu bağla</b>
      <div class="muted small">Tablonun bağlantısını yapıştırın. Tablo “Bağlantıya sahip olan herkes <b>görüntüleyebilir</b>” olarak paylaşılmış olmalı. Site tabloyu yalnızca okur; düzenleme izni gerekmez ve kullanılmaz.</div>
      <div class="row wrap" style="gap:8px">
        <input class="input" id="lnk" style="flex:1;min-width:260px" placeholder="https://docs.google.com/spreadsheets/d/…" value="${ref ? `https://docs.google.com/spreadsheets/d/${ref.id}/edit` : ''}">
        <input class="input" id="tab" style="width:120px" placeholder="Sayfa adı" value="${ref ? ref.tab : 'KALAN'}">
        <button class="btn primary" id="saveLink">${icon('check')}Kaydet</button>
        ${ref ? html`<button class="btn" id="cancelLink">Vazgeç</button>` : ''}
      </div>
      <label class="f">Otomatik kontrol saatleri <span class="muted xs">(virgülle ayırın · ${STOCK_TIME_RANGE[0]}–${STOCK_TIME_RANGE[1]} arası · boş bırakılırsa otomatik kontrol yapılmaz)</span>
        <input class="input" id="times" value="${(state.config.settings.stockTimes || DEFAULT_STOCK_TIMES).join(', ')}"></label>
      </div></div>`);
    $('#saveLink').addEventListener('click', async (e) => {
      const m = $('#lnk').value.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]{20,100})/);
      if (!m) return toast('Geçerli bir Google E-Tablolar bağlantısı yapıştırın', 'err');
      busy(e.currentTarget, true, 'Kaydediliyor…');
      try {
        const times = $('#times').value.split(/[,;\s]+/).map((t) => t.trim()).filter(Boolean);
        const bad = times.filter((t) => !/^\d{1,2}[:.]\d\d$/.test(t) || t.replace('.', ':').padStart(5, '0') < STOCK_TIME_RANGE[0] || t.replace('.', ':').padStart(5, '0') > STOCK_TIME_RANGE[1]);
        if (bad.length) { busy($('#saveLink'), false); return toast(`Geçersiz saat: ${bad.join(', ')} (${STOCK_TIME_RANGE[0]}–${STOCK_TIME_RANGE[1]} arası, ör. 07:30)`, 'err'); }
        await saveSection('settings', { ...state.config.settings, stockSheet: { id: m[1], tab: $('#tab').value.trim() || 'KALAN' }, stockTimes: times }, 'stok tablosu bağlantısı ve kontrol saatleri');
        toast('Kaydedildi', 'ok');
        loadRuns();
        await loadSheet();
        compute();
      } catch (err) { toast(err.message, 'err'); busy($('#saveLink'), false); }
    });
    const c = $('#cancelLink');
    if (c) c.addEventListener('click', drawLink);
  }

  // ---------------------------------------------------------------- otomatik kontroller (bugün)
  let runs = null;
  async function loadRuns() {
    if (!state.config.settings.stockSheet) { mount($('#runs'), ''); return; }
    try { runs = await api.get('stock/runs?date=' + today()); drawRuns(); }
    catch (e) { mount($('#runs'), html`<div class="muted small">Otomatik kontroller okunamadı: ${e.message}</div>`); }
  }
  function drawRuns() {
    if (!runs) return;
    const now = new Date();
    const hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const slots = [...new Set([...runs.times, ...Object.keys(runs.runs)])].sort();
    mount($('#runs'), html`<div class="card"><div class="card-b stack" style="gap:10px">
      <div class="row wrap" style="gap:8px"><b>Bugünkü otomatik kontroller</b><span class="muted xs">Site, sayfa kapalıyken de bu saatlerde tabloyu okur ve günün siparişleriyle karşılaştırır (kampanya hediyeleri dahil). Tabloya yazmaz, stok düşmez.</span></div>
      <div class="row wrap" style="gap:8px">${slots.length ? slots.map((t) => {
        const r = runs.runs[t];
        const late = (+hm.slice(0, 2) * 60 + +hm.slice(3)) - (+t.slice(0, 2) * 60 + +t.slice(3));
        if (!r) return html`<span class="badge ${late >= 30 ? 'warn' : ''}" title="${late >= 30 ? 'Bu saatte kontrol yapılmadı (ör. o sırada tablo bağlı değildi ya da saat sonradan eklendi)' : late >= 0 ? 'Birkaç dakika içinde yapılır' : 'Henüz saati gelmedi'}">${t} · ${late >= 30 ? 'yapılmadı' : late >= 0 ? 'sırada' : 'bekliyor'}</span>`;
        if (!r.ok) return html`<span class="badge warn" title="${r.error || ''}">${t} · ${r.skipped ? 'atlandı' : 'okunamadı'}</span>`;
        const shortN = r.rows.filter((x) => x.short > 0).length;
        return html`<button class="btn sm ${shortN ? '' : 'ghost'}" data-run="${t}" title="Ayrıntı için tıklayın">${icon(shortN ? 'alert' : 'check')}${t} · ${shortN ? `${shortN} ürün yetmiyor · ${n(r.blockedCount)} sipariş çıkmaz` : `stok yeterli · ${n(r.total)} sipariş`}</button>`;
      }) : html`<span class="muted small">Otomatik kontrol saati tanımlı değil.</span>`}</div>
    </div></div>`);
    $('#runs').querySelectorAll('[data-run]').forEach((b) => b.addEventListener('click', () => showRun(b.dataset.run)));
  }
  function showRun(t) {
    const r = runs.runs[t];
    const short = r.rows.filter((x) => x.short > 0);
    modal({
      title: `Otomatik kontrol · ${runs.date.split('-').reverse().join('.')} ${t}`,
      size: 'lg',
      body: html`<div class="stack">
        <div class="muted small">Okunma: ${trDateTime(r.at)} · tablo ${n(r.sheetRows)} satır · ${n(r.total)} sipariş, ${n(r.okCount)} çıkabilir, <b>${n(r.blockedCount)} çıkmaz</b>${r.unmatchedOrders ? ` · ${n(r.unmatchedOrders)} siparişte eşleşmeyen ürün` : ''}</div>
        <div class="tw"><table class="t"><thead><tr><th>Yetmeyen ürün</th><th class="num">Gereken</th><th class="num">Stok</th><th class="num">Eksik</th></tr></thead><tbody>
          ${short.length ? short.map((x) => html`<tr><td><b>${x.name}</b> <span class="muted xs">${x.sku}</span></td><td class="num">${n(x.need)}</td><td class="num">${n(x.stock)}</td><td class="num"><b style="color:var(--danger)">${n(x.short)}</b></td></tr>`) : html`<tr><td colspan="4" class="muted">Stok bütün siparişlere yetiyordu</td></tr>`}
        </tbody></table></div>
        ${r.blocked.length ? html`<div class="tw" style="max-height:340px;overflow:auto"><table class="t"><thead><tr><th>Yükleme</th><th>Mağaza</th><th>Sipariş no</th><th>Yetmeyen</th></tr></thead><tbody>
          ${r.blocked.map((b) => html`<tr><td class="nowrap small">${trDateTime(b.at)}</td><td class="small">${b.store}</td><td><b>${b.no}</b></td><td class="small" style="color:var(--danger)">${b.short.map((s) => `${s.name}: ${n(s.need)} gerekli, ${n(s.left)} kaldı`).join(' · ')}</td></tr>`)}
        </tbody></table></div>` : ''}
      </div>`,
      actions: [{ label: 'Excel indir', value: 'xls', icon: 'sheet' }, { label: 'Kapat', value: 'close', variant: 'primary' }],
      onSubmit: async (v) => {
        if (v !== 'xls') return true;
        await exportSheets(`stok-kontrol-${runs.date}-${t.replace(':', '')}.xlsx`, [
          { title: 'Ürünler', columns: [{ label: 'Ürün', width: 46 }, { label: 'SKU', width: 18 }, { label: 'Gereken', num: true, width: 11 }, { label: 'Stok (KALAN)', num: true, width: 13 }, { label: 'Sipariş sonrası', num: true, width: 14 }, { label: 'Eksik', num: true, width: 10 }, { label: 'Sipariş', num: true, width: 10 }],
            rows: r.rows.map((x) => [x.name, x.sku, x.need, x.stock, x.after, x.short, x.orders]) },
          { title: 'Çıkmayacak siparişler', columns: [{ label: 'Yükleme', width: 17 }, { label: 'Mağaza', width: 22 }, { label: 'Sipariş no', width: 20 }, { label: 'Yetmeyen', width: 70 }],
            rows: r.blocked.map((b) => [trDateTime(b.at), b.store, b.no, b.short.map((s) => `${s.name}: ${s.need} gerekli, ${s.left} kaldı`).join(' · ')]) },
          { title: 'Tabloda bulunamayan', columns: [{ label: 'Ürün', width: 46 }, { label: 'Sitedeki SKU', width: 18 }, { label: 'Gereken', num: true, width: 11 }],
            rows: r.notInSheet.map((x) => [x.name, x.sku, x.need]) },
        ], `Otomatik stok kontrol · ${runs.date} ${t} · yalnızca bilgi amaçlı`);
        return false;
      },
    });
  }

  // ---------------------------------------------------------------- veri
  async function loadSheet() {
    sheet = null; stock = null;
    try {
      const r = await api.get('stock');
      if (r.configured) {
        const items = parseStockRows(parseCsv(r.csv));
        sheet = { items, fetchedAt: r.fetchedAt, tab: r.tab };
        stock = matchStock(state.config.products, items);
      }
      drawLink();
    } catch (e) {
      drawLink();
      mount($('#body'), html`<div class="callout err">${icon('alert')}<div class="c"><b>Stok tablosu okunamadı</b>${e.message}</div></div>`);
      return false;
    }
    return true;
  }

  async function loadOrders() {
    mount($('#body'), html`<div class="loading"><div class="spin"></div><span>Siparişler okunuyor…</span></div>`);
    try {
      const [o, b] = await Promise.all([fetchOrders(from, to), api.get('batches?limit=100').catch(() => ({ batches: [] }))]);
      if (!ctx.isCurrent()) return;
      dayOrders = o.filter((x) => !x.summary);
      batches = b.batches || [];
      drawBatches();
      compute();
    } catch (e) { mount($('#body'), html`<div class="callout err">${icon('alert')}<div class="c">${e.message}</div></div>`); }
  }

  function drawBatches() {
    const host = $('#fBatch');
    host.innerHTML = '';
    const el = document.createElement('div');
    host.appendChild(el);
    const present = new Set(dayOrders.map((o) => o.batch).filter(Boolean));
    const list = batches.filter((b) => present.has(b.id)).sort((a, b) => a.at.localeCompare(b.at));
    multiSelect(el, {
      options: list.map((b) => ({ id: b.id, label: `${trDateTime(b.at)} · ${personName(b.by)} · ${n(dayOrders.filter((o) => o.batch === b.id).length)} sipariş` })),
      selected: batchIds,
      allLabel: list.length ? `Tüm yüklemeler (${list.length})` : 'Tüm siparişler',
      onChange: (v) => { batchIds = v; compute(); },
    });
  }

  /** Yükleme sırası: ilk yüklenen sipariş stoktan önce pay alır */
  function orderedComputed() {
    const at = new Map(batches.map((b) => [b.id, b.at]));
    const list = dayOrders.filter((o) => !batchIds.length || batchIds.includes(o.batch));
    return list.map((o, i) => ({ o, i, t: String(at.get(o.batch) || o.at || o.date || '') }))
      .sort((a, b) => a.t.localeCompare(b.t) || a.i - b.i)
      .map((x) => computeOrder(x.o, state.ctx));
  }

  function compute() {
    if (!stock) {
      if (!state.config.settings.stockSheet) mount($('#body'), '');
      return;
    }
    R = checkStock(orderedComputed(), stock, { includeRewards });
    render();
  }

  // ---------------------------------------------------------------- görünüm
  const pname = (id) => state.ctx.label(id);
  const needText = (b) => b.short.map((s) => `${pname(s.productId)}: ${n(s.need)} gerekli, ${n(s.left)} kaldı`).join(' · ');
  const contents = (c) => [...c.lines.filter((l) => l.productId && !l.ignored).map((l) => `${pname(l.productId)} ×${l.units}`),
    ...(includeRewards ? c.rewards.filter((r) => r.productId).map((r) => `🎁 ${pname(r.productId)} ×${r.qty}`) : [])].join(', ');

  function render() {
    ctx.setSub(`${rangeLabel(from, to)}${batchIds.length ? ` · ${batchIds.length} yükleme` : ''}`);
    const shortRows = R.rows.filter((r) => r.short > 0);
    const rows = view === 'short' ? shortRows : R.rows;
    const notIn = [...R.notInSheet].map(([id, u]) => ({ id, u })).sort((a, b) => b.u - a.u);
    const tabs = [['short', `Yetmeyen ürünler (${shortRows.length})`], ['all', `Tüm ürünler (${R.rows.length})`], ['blocked', `Çıkmayacak siparişler (${n(R.blocked.length)})`], ['missing', `Tabloda bulunamayan (${notIn.length})`]];
    mount($('#body'), html`<div class="stack">
      <div class="kpis">
        <div class="kpi"><div class="l">${icon('receipt')}Sipariş</div><div class="v">${n(R.total)}</div><div class="s">${rangeLabel(from, to)}</div></div>
        <div class="kpi"><div class="l">${icon('check')}Stokla çıkabilir</div><div class="v">${n(R.ok)}</div><div class="s">ilk yüklenenden başlayarak</div></div>
        <div class="kpi ${R.blocked.length ? 'hl' : ''}"><div class="l">${icon('alert')}Çıkmayacak sipariş</div><div class="v">${n(R.blocked.length)}</div><div class="s">en az bir ürünü yetmiyor</div></div>
        <div class="kpi"><div class="l">${icon('box')}Yetmeyen ürün</div><div class="v">${n(shortRows.length)}</div><div class="s">toplam ${n(shortRows.reduce((s, r) => s + r.short, 0))} adet eksik</div></div>
      </div>
      ${R.unmatchedOrders ? html`<div class="callout warn">${icon('alert')}<div class="c"><b>${n(R.unmatchedOrders)} siparişte katalogla eşleşmeyen ürün adı var</b>Bu satırlar stok kontrolüne girmez — <a href="#/matching">Ürün Eşleştirme</a>.</div></div>` : ''}
      <div class="card">
        <div class="tabs">${tabs.map(([k, l]) => html`<button data-v="${k}" class="${view === k ? 'on' : ''}">${l}</button>`)}</div>
        ${view === 'short' || view === 'all' ? html`<div class="tw"><table class="t"><thead><tr><th>Ürün</th><th class="hide-m">SKU</th><th class="num">Gereken</th><th class="num">Stok (KALAN)</th><th class="num">Sipariş sonrası</th><th class="num">Eksik</th><th class="num hide-m">Sipariş</th></tr></thead><tbody>
          ${rows.length ? rows.map((r) => html`<tr>
            <td><b>${pname(r.productId)}</b></td><td class="hide-m muted small">${r.sku}</td>
            <td class="num">${n(r.need)}</td><td class="num">${n(r.stock)}</td>
            <td class="num ${r.after < 0 ? 'neg' : ''}">${r.after < 0 ? html`<b style="color:var(--danger)">${n(r.after)}</b>` : n(r.after)}</td>
            <td class="num big">${r.short ? html`<b style="color:var(--danger)">${n(r.short)}</b>` : html`<span class="badge ok">Yeterli</span>`}</td>
            <td class="num hide-m">${n(r.orders)}</td></tr>`)
          : html`<tr><td colspan="7">${emptyState('check', view === 'short' ? 'Stok bütün siparişlere yetiyor' : 'Bu seçimde sipariş yok', '')}</td></tr>`}
          </tbody></table></div>` : ''}
        ${view === 'blocked' ? html`<div class="tw"><table class="t"><thead><tr><th class="num">#</th><th>Yükleme</th><th>Mağaza</th><th>Sipariş no</th><th>İçerik</th><th>Yetmeyen</th></tr></thead><tbody>
          ${R.blocked.length ? R.blocked.slice(0, 500).map((b, i) => html`<tr>
            <td class="num muted">${i + 1}</td><td class="nowrap small">${trDateTime(b.c.order.at)}</td><td>${storeTag(b.c.store, b.c.order.sender)}</td>
            <td class="nowrap"><b>${b.c.order.no}</b></td><td class="small">${contents(b.c)}</td><td class="small" style="color:var(--danger)">${needText(b)}</td></tr>`)
          : html`<tr><td colspan="6">${emptyState('check', 'Bütün siparişler stokla çıkabiliyor', '')}</td></tr>`}
          </tbody></table>${R.blocked.length > 500 ? html`<div class="muted small" style="padding:10px">İlk 500 sipariş gösteriliyor; tamamı Excel’de.</div>` : ''}</div>` : ''}
        ${view === 'missing' ? html`<div class="tw"><table class="t"><thead><tr><th>Ürün</th><th class="hide-m">Sitedeki SKU</th><th class="num">Gereken</th></tr></thead><tbody>
          ${notIn.length ? notIn.map((x) => { const p = state.ctx.productsById.get(x.id); return html`<tr><td><b>${pname(x.id)}</b></td><td class="hide-m muted small">${(p && p.sku) || '—'}</td><td class="num">${n(x.u)}</td></tr>`; })
          : html`<tr><td colspan="3">${emptyState('check', 'Siparişlerdeki bütün ürünler tabloda bulundu', '')}</td></tr>`}
          </tbody></table><div class="muted small" style="padding:10px">Bu ürünler tablodaki SKU ya da ürün adıyla eşleşmedi; stok kontrolüne girmez. Ürünler sayfasında SKU’yu tablodakiyle aynı yazın.</div></div>` : ''}
      </div>
      <div class="muted xs">Hesap: siparişler yükleme sırasıyla sıralanır; her sipariş ürünlerinin hepsi stokta kalmışsa “çıkabilir” sayılır ve o adetler ayrılır, bir ürünü bile yetmiyorsa “çıkmaz” sayılır ve hiçbir şey ayırmaz (kısmi gönderim yok). Bu ayrım yalnızca ekranda yapılır.</div>
    </div>`);
    $('#body').querySelectorAll('[data-v]').forEach((b) => b.addEventListener('click', () => { view = b.dataset.v; render(); }));
  }

  async function exportXls() {
    if (!R) return;
    const btn = ctx.actions.querySelector('#xls');
    busy(btn, true, 'Hazırlanıyor…');
    try {
      await exportSheets(`stok-kontrol-${from}${to !== from ? '_' + to : ''}.xlsx`, [
        { title: 'Ürünler', columns: [{ label: 'Ürün', width: 46 }, { label: 'SKU', width: 18 }, { label: 'Gereken', num: true, width: 11 }, { label: 'Stok (KALAN)', num: true, width: 13 }, { label: 'Sipariş sonrası', num: true, width: 14 }, { label: 'Eksik', num: true, width: 10 }, { label: 'Sipariş', num: true, width: 10 }],
          rows: R.rows.map((r) => [pname(r.productId), r.sku, r.need, r.stock, r.after, r.short, r.orders]) },
        { title: 'Çıkmayacak siparişler', columns: [{ label: 'Yükleme', width: 17 }, { label: 'Mağaza', width: 22 }, { label: 'Sipariş no', width: 20 }, { label: 'İçerik', width: 60 }, { label: 'Yetmeyen', width: 60 }],
          rows: R.blocked.map((b) => [trDateTime(b.c.order.at), b.c.store ? b.c.store.name : b.c.order.sender, b.c.order.no, contents(b.c), needText(b)]) },
        { title: 'Tabloda bulunamayan', columns: [{ label: 'Ürün', width: 46 }, { label: 'Sitedeki SKU', width: 18 }, { label: 'Gereken', num: true, width: 11 }],
          rows: [...R.notInSheet].map(([id, u]) => [pname(id), (state.ctx.productsById.get(id) || {}).sku || '', u]) },
      ], `Stok kontrol · ${rangeLabel(from, to)} · yalnızca bilgi amaçlı`);
      toast('Excel indirildi', 'ok');
    } catch (e) { toast(e.message, 'err'); }
    busy(btn, false);
  }

  drawLink();
  loadRuns();
  await loadSheet();
  loadOrders();
}
