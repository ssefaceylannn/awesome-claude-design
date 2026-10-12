// Kombinasyon analizi: yüklenen siparişlerde aynı ürün + adet bileşimleri (≥ eşik ayrı satır,
// kalanlar "Karma Siparişler"). Mağaza, tarih, yükleme ve yükleme saati ile süzülür.
// İkinci sekme: Trendyol "Gönderime Hazır" sayfasından kopyalanan grup metnini okur.
import { html, mount, icon, n, toast, busy, emptyState, rangeLabel, multiSelect, trDateTime, personName, modal } from '../core/ui.js';
import { api, state, fetchOrders, getRange } from '../core/api.js';
import { fold } from '../shared/text.js';
import { computeOrder } from '../shared/calc.js';
import { analyzeCombos, parseComboPaste, KARMA } from '../shared/combos.js';
import { rangePicker, storeFilters, filterLabel } from '../core/widgets.js';
import { exportTable } from '../core/excel.js';

const PREF = 'et-combos';
const loadPref = () => { try { return JSON.parse(localStorage.getItem(PREF) || '{}'); } catch { return {}; } };
const savePref = (p) => { try { localStorage.setItem(PREF, JSON.stringify({ ...loadPref(), ...p })); } catch { /* yok */ } };
const pad = (v) => String(v).padStart(2, '0');
const hhmm = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : `${pad(d.getHours())}:${pad(d.getMinutes())}`; };

export default async function combosPage(ctx) {
  const pref = loadPref();
  let tab = pref.tab === 'paste' ? 'paste' : 'auto';
  let { from, to } = getRange();
  let filter = { storeIds: [], platforms: [] };
  let min = Math.max(1, +pref.min || 10);
  let includeRewards = !!pref.rewards;
  let batchIds = []; // boş = tüm yüklemeler
  let tFrom = '', tTo = '';
  let orders = [], batches = [], result = null, pasted = null;
  let dayOrders = []; // tarih aralığındaki siparişler (yükleme seçilmemişse analiz bunlarla yapılır)
  let again = 0; // seçilen yüklemelerde yeniden gelen (daha önce kaydedilmiş) sipariş sayısı
  let loadSeq = 0;
  let computedAll = []; // son hesaplanan siparişler (yazdırma mağaza mağaza buradan yapılır)

  mount(ctx.actions, html`<button class="btn" id="cprint">${icon('printer')}Yazdır</button><button class="btn icon" id="cprintSet" title="Yazdırma ayarları">${icon('settings')}</button><button class="btn primary" id="xls">${icon('sheet')}Excel indir</button>`);
  mount(ctx.el, html`<div class="stack">
    <div class="tabs card" style="padding:0 8px"><button data-tab="auto">${icon('box')} Yüklenen siparişlerden</button><button data-tab="paste">${icon('copy')} Metin yapıştır</button></div>
    <div id="autoBox">
      <div class="card"><div class="card-b row wrap" style="gap:12px">
        <div id="range"></div>
        <div id="fStores" style="width:220px"></div>
        <div id="fPf" style="width:170px"></div>
      </div>
      <div class="card-f row wrap" style="gap:12px;align-items:flex-end">
        <label class="f">Yükleme<div id="fBatch" style="width:280px"></div></label>
        <label class="f">Yükleme saati<div class="row" style="gap:6px"><input type="time" class="input sm" id="tFrom" style="width:110px"><span class="muted">–</span><input type="time" class="input sm" id="tTo" style="width:110px"></div></label>
        <label class="f">En az sipariş <span class="hint">altı karmaya</span><input type="number" class="input sm" id="min" min="1" max="999" value="${min}" style="width:90px"></label>
        <label class="check small" style="margin-bottom:6px"><input type="checkbox" id="rw" ${includeRewards ? 'checked' : ''}> Kampanya ürünlerini pakete dahil et</label>
      </div></div>
      <div id="body" style="margin-top:16px"></div>
    </div>
    <div id="pasteBox" class="hidden">
      <div class="card"><div class="card-h"><h2>Gönderime Hazır sayfasını yapıştır</h2><span class="sub">Trendyol'daki grup kartlarını (ürün x adet · N sipariş · Karma Siparişler) kopyalayın</span></div>
        <div class="card-b stack"><textarea class="input" id="ptxt" rows="8" placeholder="Zencefil Shot x2&#10;12 sipariş&#10;Coconut Mix x1 + Detox Mix x1&#10;10 sipariş&#10;Karma Siparişler 23 sipariş"></textarea></div></div>
      <div id="pbody" style="margin-top:16px"></div>
    </div>
  </div>`);
  const $ = (s) => ctx.el.querySelector(s);

  const showTab = () => {
    ctx.el.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    $('#autoBox').classList.toggle('hidden', tab !== 'auto');
    $('#pasteBox').classList.toggle('hidden', tab !== 'paste');
    if (tab === 'auto') ctx.setSub(`${rangeLabel(from, to)} · ${filterLabel(filter)}`);
    else ctx.setSub('Yapıştırılan grup metni');
  };
  ctx.el.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; savePref({ tab }); showTab(); }));

  rangePicker($('#range'), { onChange: (f, t) => { from = f; to = t; batchIds = []; load(); } });
  filter = storeFilters($('#fStores'), $('#fPf'), (f) => { filter = f; compute(); });
  $('#tFrom').addEventListener('change', (e) => { tFrom = e.target.value; pickOrders(); });
  $('#tTo').addEventListener('change', (e) => { tTo = e.target.value; pickOrders(); });
  $('#min').addEventListener('change', (e) => { min = Math.max(1, Math.min(999, parseInt(e.target.value, 10) || 10)); e.target.value = min; savePref({ min }); compute(); renderPaste(); });
  $('#rw').addEventListener('change', (e) => { includeRewards = e.target.checked; savePref({ rewards: includeRewards }); compute(); });

  // Seçili tarihlerdeki yüklemeler (saatleriyle) — yeniden çizilebilsin diye her seferinde yeni kap
  function drawBatches() {
    const host = $('#fBatch');
    host.innerHTML = '';
    const el = document.createElement('div');
    host.appendChild(el);
    const list = rangeBatches();
    multiSelect(el, {
      options: list.map((b) => ({ id: b.id, label: `${trDateTime(b.at)} · ${personName(b.by)} · ${n((b.orderCount || 0) + (b.refCount || 0))} sipariş${b.refCount ? ` (${n(b.refCount)} yeniden)` : ''}`, group: (b.files || []).slice(0, 2).join(', ') || undefined })),
      selected: batchIds,
      allLabel: list.length ? `Tüm yüklemeler (${list.length})` : 'Yükleme yok',
      onChange: (v) => { batchIds = v; pickOrders(); },
    });
  }
  const localYmd = (iso) => { const d = new Date(iso); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  // Tarih aralığında yapılmış ya da bu aralığa sipariş yazmış yüklemeler
  const rangeBatches = () => batches.filter((b) => { const d = localYmd(b.at); return (d >= from && d <= to) || (b.dates || []).some((x) => x >= from && x <= to); }).sort((a, b) => a.at.localeCompare(b.at));

  async function load() {
    mount($('#body'), html`<div class="loading"><div class="spin"></div><span>Siparişler okunuyor…</span></div>`);
    try {
      const [o, b] = await Promise.all([fetchOrders(from, to), api.get('batches?limit=100').catch(() => ({ batches: [] }))]);
      if (!ctx.isCurrent()) return;
      dayOrders = o.filter((x) => !x.summary);
      batches = b.batches || [];
      drawBatches();
      await pickOrders();
    } catch (e) { mount($('#body'), html`<div class="callout err">${icon('alert')}<div class="c">${e.message}</div></div>`); }
  }

  /**
   * Yükleme veya saat seçiliyse: o yüklemelerdeki TÜM siparişler — yeni olanlar ve daha önce (başka
   * yüklemede / başka gün) kaydedilmiş olup bu yüklemede yeniden gelenler. Hiçbiri iki kez sayılmaz.
   * Seçim yoksa: tarih aralığındaki siparişler.
   */
  async function pickOrders() {
    const seq = ++loadSeq;
    again = 0;
    if (!batchIds.length && !tFrom && !tTo) { orders = dayOrders; return compute(); }
    const chosen = rangeBatches().filter((b) => (!batchIds.length || batchIds.includes(b.id)) && (!(tFrom || tTo) || ((!tFrom || hhmm(b.at) >= tFrom) && (!tTo || hhmm(b.at) <= tTo))));
    if (!chosen.length) { orders = []; return compute(); }
    mount($('#body'), html`<div class="loading"><div class="spin"></div><span>Yüklemeler okunuyor…</span></div>`);
    try {
      const { refs } = await api.get('batch/refs?ids=' + chosen.map((b) => b.id).join(','));
      const dates = [...new Set(refs.map((r) => r.date))].sort();
      const lo = dates[0], hi = dates[dates.length - 1];
      const pool = dates.length ? await fetchOrders(lo, hi) : [];
      if (seq !== loadSeq || !ctx.isCurrent()) return;
      const byK = new Map(pool.map((o) => [o.k, o]));
      orders = refs.map((r) => byK.get(r.k)).filter((o) => o && !o.summary);
      again = refs.filter((r) => r.again && byK.has(r.k)).length;
      compute();
    } catch (e) { mount($('#body'), html`<div class="callout err">${icon('alert')}<div class="c">${e.message}</div></div>`); }
  }

  function compute() {
    if (tab === 'auto') ctx.setSub(`${rangeLabel(from, to)} · ${filterLabel(filter)}`);
    const computed = [];
    for (const o of orders) {
      const c = computeOrder(o, state.ctx);
      if (filter.storeIds.length && !(c.store && filter.storeIds.includes(c.store.id))) continue;
      if (filter.platforms.length && !filter.platforms.includes(c.platform)) continue;
      computed.push(c);
    }
    computedAll = computed;
    result = analyzeCombos(computed, state.ctx, { min, includeRewards });
    render();
    if (pasted) renderPaste();
  }

  function render() {
    const R = result;
    if (!R) return;
    if (!R.orders) return mount($('#body'), html`<div class="card">${emptyState('box', 'Sipariş yok', 'Tarih, mağaza veya yükleme seçimini değiştirin.')}</div>`);
    const inGroups = R.groups.reduce((s, g) => s + g.orders, 0);
    const unm = R.groups.concat(R.karma.groups).some((g) => g.parts.some((p) => p.id.startsWith('?')));
    mount($('#body'), html`<div class="stack">
      <div class="kpis">
        <div class="kpi"><div class="l">${icon('receipt')}Sipariş</div><div class="v">${n(R.orders)}</div><div class="s">${n(R.groups.length + R.karma.groups.length)} farklı bileşim${again ? ` · ${n(again)} yeniden yüklenen dahil` : ''}</div></div>
        <div class="kpi hl"><div class="l">${icon('box')}${min}+ siparişli bileşim</div><div class="v">${n(R.groups.length)}</div><div class="s">${n(inGroups)} sipariş</div></div>
        <div class="kpi"><div class="l">${icon('copy')}${KARMA}</div><div class="v">${n(R.karma.orders)}</div><div class="s">${n(R.karma.groups.length)} bileşim · ${n(R.karma.units)} ürün</div></div>
      </div>
      ${unm ? html`<div class="callout warn">${icon('alert')}<div class="c"><b>Eşleşmeyen ürün adı içeren bileşimler var (⚠)</b><a href="#/matching">Ürün Eşleştirme</a> sayfasından atayınca analiz kendiliğinden düzelir.</div></div>` : ''}
      <div class="card"><div class="tw"><table class="t"><thead><tr><th>Kombinasyon</th><th class="num">Sipariş</th><th class="num">Toplam ürün</th></tr></thead><tbody>
        ${R.groups.map((g) => html`<tr><td>${g.parts.map((p, i) => html`${i ? html`<span class="muted"> + </span>` : ''}<b>${p.name}</b> <span class="muted">x${p.qty}</span>`)}</td><td class="num big">${n(g.orders)}</td><td class="num">${n(g.units * g.orders)}</td></tr>`)}
        ${R.karma.orders ? html`<tr class="click" id="karmaRow" style="background:var(--surface-2)"><td><b>${KARMA}</b> <span class="muted small">— ${min} siparişten az olan ${n(R.karma.groups.length)} bileşim · ayrıntı için tıklayın</span></td><td class="num big">${n(R.karma.orders)}</td><td class="num">${n(R.karma.units)}</td></tr>` : ''}
      </tbody></table></div></div>
      ${R.karma.orders ? html`<div class="card hidden" id="karmaBox"><div class="card-h"><h2>${KARMA} ayrıntısı</h2><span class="sub">Karmaya düşen bileşimler ve ürün toplamları</span></div>
        <div class="grid g-main" style="padding:16px;align-items:start">
          <div class="tw"><table class="t"><thead><tr><th>Bileşim</th><th class="num">Sipariş</th></tr></thead><tbody>
            ${R.karma.groups.map((g) => html`<tr><td class="small">${g.label}</td><td class="num">${n(g.orders)}</td></tr>`)}</tbody></table></div>
          <div class="tw"><table class="t"><thead><tr><th>Ürün</th><th class="num">Adet</th></tr></thead><tbody>
            ${R.karma.products.map((p) => html`<tr><td class="small">${p.name}</td><td class="num"><b>${n(p.qty)}</b></td></tr>`)}</tbody></table></div>
        </div></div>` : ''}
    </div>`);
    const kr = $('#karmaRow');
    if (kr) kr.addEventListener('click', () => $('#karmaBox').classList.toggle('hidden'));
  }

  // ---------------------------------------------------------------- yapıştırma sekmesi
  // Trendyol kartındaki ürün adlarını katalogla eşleyip sitedeki bileşim anahtarına çevir
  function pasteKey(parts) {
    const pos = new Map(state.ctx.products.map((p, i) => [p.id, i]));
    const m = new Map();
    for (const p of parts) {
      const r = state.ctx.match(p.name);
      const id = r.productId || '?' + fold(p.name);
      m.set(id, (m.get(id) || 0) + p.qty * (r.productId ? r.multiplier || 1 : 1));
    }
    return [...m].sort((a, b) => (pos.get(a[0]) ?? 1e6) - (pos.get(b[0]) ?? 1e6) || a[0].localeCompare(b[0])).map(([id, q]) => `${id}*${q}`).join('+');
  }

  function renderPaste() {
    const text = $('#ptxt').value;
    if (!text.trim()) { pasted = null; return mount($('#pbody'), ''); }
    pasted = parseComboPaste(text);
    const { cards, unrecognized } = pasted;
    if (!cards.length) return mount($('#pbody'), html`<div class="callout warn">${icon('alert')}<div class="c"><b>Ayrıştırılabilir veri bulunamadı</b>Metni kontrol edin: “Ürün x2” satırları ve ardından “N sipariş” olmalı.</div></div>`);
    const rows = cards.filter((c) => !c.karma).sort((a, b) => b.total - a.total);
    const karma = cards.filter((c) => c.karma);
    const total = cards.reduce((s, c) => s + c.total, 0);
    // Sitedeki analizle karşılaştırma ("Yüklenen siparişlerden" sekmesindeki seçime göre)
    const cmp = result && result.orders ? new Map([...result.groups, ...result.karma.groups].map((g) => [g.key, g])) : null;
    const used = new Set();
    const cmpRows = cmp ? rows.map((c) => { const k = pasteKey(c.parts); used.add(k); const g = cmp.get(k); return { c, site: g ? g.orders : 0, unm: k.includes('?') }; }) : [];
    const onlySite = cmp ? [...cmp.values()].filter((g) => !used.has(g.key)).sort((a, b) => b.orders - a.orders) : [];
    const diffCell = (d) => html`<td class="num"><b class="${d ? 'unm' : ''}">${d > 0 ? '+' : ''}${n(d)}</b></td>`;
    mount($('#pbody'), html`<div class="stack">
      <div class="kpis"><div class="kpi"><div class="l">Trendyol: toplam sipariş</div><div class="v">${n(total)}</div><div class="s">${n(cards.length)} grup</div></div>
        ${cmp ? html`<div class="kpi"><div class="l">Site: toplam sipariş</div><div class="v">${n(result.orders)}</div><div class="s">${rangeLabel(from, to)} · ${filterLabel(filter)}${batchIds.length || tFrom || tTo ? ' · seçili yüklemeler' : ''}</div></div>
        <div class="kpi ${result.orders - total ? '' : 'hl'}"><div class="l">Fark</div><div class="v">${result.orders - total > 0 ? '+' : ''}${n(result.orders - total)}</div><div class="s">site − Trendyol</div></div>` : ''}</div>
      ${cmp ? '' : html`<div class="callout info">${icon('info')}<div class="c"><b>Siteyle karşılaştırmak için</b>“Yüklenen siparişlerden” sekmesinde aynı mağazayı ve yüklemeyi/saat aralığını seçin; bu tabloda her grubun sitedeki sayısı ve farkı görünür.</div></div>`}
      <div class="card"><div class="tw"><table class="t"><thead><tr><th>Ürün(ler)</th><th class="num">Trendyol</th>${cmp ? html`<th class="num">Site</th><th class="num">Fark</th>` : ''}</tr></thead><tbody>
        ${cmp ? cmpRows.map(({ c, site, unm }) => html`<tr><td>${c.combo}${unm ? html` <span class="badge warn" title="Bu addaki ürün katalogla eşleşmedi">ürün eşleşmedi</span>` : ''}</td><td class="num big">${n(c.total)}</td><td class="num">${n(site)}</td>${diffCell(site - c.total)}</tr>`)
          : rows.map((c) => html`<tr><td>${c.combo}</td><td class="num big">${n(c.total)}</td></tr>`)}
        ${karma.map((c) => html`<tr style="background:var(--surface-2)"><td><b>${KARMA}</b> <span class="muted small">(Trendyol'un kendi gruplaması)</span></td><td class="num big">${n(c.total)}</td>${cmp ? html`<td class="num">${n(result.karma.orders)} <span class="muted xs">(${min} altı)</span></td>${diffCell(result.karma.orders - c.total)}` : ''}</tr>`)}
      </tbody></table></div></div>
      ${onlySite.length ? html`<div class="card"><div class="card-h"><h2>Trendyol listesinde ayrı grup olarak görünmeyen site bileşimleri</h2><span class="sub">Trendyol bunları Karma Siparişler'e koymuş olabilir</span></div>
        <div class="tw"><table class="t"><tbody>${onlySite.map((g) => html`<tr><td class="small">${g.label}</td><td class="num">${n(g.orders)}</td></tr>`)}</tbody></table></div></div>` : ''}
      ${unrecognized.length ? html`<details class="card" style="padding:12px 16px"><summary class="small" style="cursor:pointer">Tanınamayan satırlar (${unrecognized.length})</summary><div class="small unm" style="white-space:pre-wrap;margin-top:8px">${unrecognized.join('\n')}</div></details>` : ''}
    </div>`);
  }
  let pt;
  $('#ptxt').addEventListener('input', () => { clearTimeout(pt); pt = setTimeout(renderPaste, 200); });

  // ---------------------------------------------------------------- Excel
  ctx.actions.querySelector('#xls').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    busy(btn, true, 'Hazırlanıyor…');
    try {
      if (tab === 'paste') {
        if (!pasted || !pasted.cards.length) throw new Error('Önce metni yapıştırın');
        const rows = pasted.cards.filter((c) => !c.karma).sort((a, b) => b.total - a.total).map((c) => [c.combo, c.total])
          .concat(pasted.cards.filter((c) => c.karma).map((c) => [KARMA, c.total]));
        await exportTable('siparis-gruplari.xlsx', 'Sipariş Grupları', [{ label: 'Ürün(ler)', width: 70 }, { label: 'Sipariş sayısı', width: 18, num: true }], rows);
      } else {
        if (!result || !result.orders) throw new Error('Gösterilecek sipariş yok');
        const rows = result.groups.map((g) => [g.label, g.orders, g.units * g.orders]);
        if (result.karma.orders) {
          rows.push([KARMA, result.karma.orders, result.karma.units]);
          for (const g of result.karma.groups) rows.push([`   ${g.label}`, g.orders, g.units * g.orders]);
        }
        const stamp = from === to ? from : `${from}_${to}`;
        await exportTable(`kombinasyonlar_${stamp}.xlsx`, `Kombinasyonlar ${rangeLabel(from, to)}`.slice(0, 31), [{ label: 'Kombinasyon', width: 70 }, { label: 'Sipariş', width: 12, num: true }, { label: 'Toplam ürün', width: 14, num: true }], rows);
      }
    } catch (err) { toast(err.message, 'err'); }
    busy(btn, false);
  });

  // ---------------------------------------------------------------- yazdırma (A4, mağaza mağaza)
  const PCOLS = [['products', 'Ürünler'], ['orders', 'Sipariş adedi'], ['units', 'Ürün adedi']];
  const printPref = () => {
    const p = loadPref().print || {};
    return { cols: Array.isArray(p.cols) && p.cols.length ? p.cols : ['products', 'orders', 'units'], orient: p.orient === 'landscape' ? 'landscape' : 'portrait', saved: !!loadPref().print };
  };
  async function printSettings() {
    const p = printPref();
    let ok = false;
    await modal({
      title: 'Yazdırma ayarları',
      size: 'sm',
      body: html`<div class="stack">
        <div class="f">Yazdırılacak sütunlar<div class="stack" style="gap:8px;margin-top:6px">${PCOLS.map(([k, l]) => html`<label class="check"><input type="checkbox" name="col" value="${k}" ${p.cols.includes(k) ? 'checked' : ''}> ${l}</label>`)}</div></div>
        <label class="f">Sayfa yönü<select class="input" name="orient"><option value="portrait" ${p.orient === 'portrait' ? 'selected' : ''}>Dikey (A4)</option><option value="landscape" ${p.orient === 'landscape' ? 'selected' : ''}>Yatay (A4)</option></select></label>
        <p class="muted small">Mağaza seçimi sayfanın üstündeki “mağazalar” kutusundan alınır; seçim yoksa her mağaza ayrı başlıkla yazdırılır. Ayarlar hatırlanır.</p>
      </div>`,
      actions: [{ label: 'Vazgeç', value: 'cancel' }, { label: 'Kaydet ve yazdır', value: 'ok', variant: 'primary', icon: 'printer' }],
      onSubmit: (_, d) => {
        const cols = [...d.querySelectorAll('[name=col]:checked')].map((x) => x.value);
        if (!cols.length) throw new Error('En az bir sütun seçin');
        savePref({ print: { cols, orient: d.querySelector('[name=orient]').value } });
        ok = true;
      },
    });
    return ok;
  }
  function doPrint() {
    if (tab !== 'auto') { tab = 'auto'; savePref({ tab }); showTab(); }
    if (!computedAll.length) return toast('Yazdırılacak sipariş yok', 'err');
    const p = printPref();
    const has = (k) => p.cols.includes(k);
    // Mağaza mağaza ayrı analiz (seçili mağazalar ya da verideki tüm mağazalar)
    const byStore = new Map();
    for (const c of computedAll) {
      const key = c.store ? c.store.id : '?' + (c.order.sender || '');
      if (!byStore.has(key)) byStore.set(key, { name: c.store ? c.store.name : (c.order.sender || 'Tanımsız mağaza'), list: [] });
      byStore.get(key).list.push(c);
    }
    const order = new Map(state.config.stores.map((st, i) => [st.id, i]));
    const sections = [...byStore.entries()].sort((a, b) => (order.get(a[0]) ?? 1e6) - (order.get(b[0]) ?? 1e6) || a[1].name.localeCompare(b[1].name, 'tr'))
      .map(([, v]) => ({ name: v.name, R: analyzeCombos(v.list, state.ctx, { min, includeRewards }) })).filter((x) => x.R.orders);
    const cells = (label, orders, units, karma) => html`<tr class="${karma ? 'karma' : ''}">${has('products') ? html`<td class="p">${label}</td>` : ''}${has('orders') ? html`<td class="num">${n(orders)}</td>` : ''}${has('units') ? html`<td class="num">${n(units)}</td>` : ''}</tr>`;
    const head = html`<tr>${has('products') ? html`<th class="p">Ürünler</th>` : ''}${has('orders') ? html`<th class="num">Sipariş adedi</th>` : ''}${has('units') ? html`<th class="num">Ürün adedi</th>` : ''}</tr>`;
    const scope = [rangeLabel(from, to), batchIds.length || tFrom || tTo ? 'seçili yüklemeler' + (tFrom || tTo ? ` ${tFrom || '…'}–${tTo || '…'}` : '') : ''].filter(Boolean).join(' · ');
    mount(document.getElementById('print'), html`<style>@page { size: A4 ${p.orient}; margin: 10mm }</style><div class="cprint ${has('products') ? '' : 'nop'}">
      <h1>Kombinasyon Listesi</h1><p>${scope} · ${min} siparişten az olan bileşimler “${KARMA}” satırında</p>
      ${sections.map((sc) => html`<section><h2>${sc.name} <small>${n(sc.R.orders)} sipariş</small></h2><table><thead>${head}</thead><tbody>
        ${sc.R.groups.map((g) => cells(g.label, g.orders, g.units * g.orders))}
        ${sc.R.karma.orders ? cells(KARMA, sc.R.karma.orders, sc.R.karma.units, true) : ''}
      </tbody></table></section>`)}
    </div>`);
    window.print();
  }
  ctx.actions.querySelector('#cprint').addEventListener('click', async () => { if (!printPref().saved && !(await printSettings())) return; doPrint(); });
  ctx.actions.querySelector('#cprintSet').addEventListener('click', async () => { if (await printSettings()) doPrint(); });

  showTab();
  load();
}
