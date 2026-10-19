// Kombinasyon analizi: yüklenen siparişlerde aynı ürün + adet bileşimleri (≥ eşik ayrı satır,
// kalanlar "Karma Siparişler"). Mağaza, tarih, yükleme ve yükleme saati ile süzülür.
// İkinci sekme: Trendyol "Gönderime Hazır" sayfasından kopyalanan grup metnini okur.
import { html, raw, mount, icon, n, toast, busy, emptyState, rangeLabel, multiSelect, trDateTime, personName, modal } from '../core/ui.js';
import { api, state, fetchOrders, getRange } from '../core/api.js';
import { fold } from '../shared/text.js';
import { computeOrder } from '../shared/calc.js';
import { analyzeCombos, parseComboPaste, KARMA } from '../shared/combos.js';
import { rangePicker, storeFilters, filterLabel } from '../core/widgets.js';
import { exportTable } from '../core/excel.js';
import { paperById, paperPicker } from '../core/paper.js';
import { karmaPref, karmaLabel, karmaSplitOn, setKarmaSplit } from '../core/karmapref.js';

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
  const kp = karmaPref(); // karma ayrımı: "Sadece Şişe" / "Kutulu" (/ "Şişesiz") — kural Karma Ayıklama sayfasında
  let splitOn = karmaSplitOn();
  const splitOpt = () => ({ karmaRule: splitOn ? kp : null });
  /** Karma satır(lar)ı: ayrım açıksa "Karma Siparişler – Sadece Şişe" ve "– Kutulu", değilse tek satır */
  const karmaParts = (K) => (K.split ? K.split.filter((x) => x.orders).map((x) => ({ ...x, label: karmaLabel(x.key, kp) }))
    : K.orders ? [{ key: 'all', label: KARMA, orders: K.orders, units: K.units, groups: K.groups }] : []);

  mount(ctx.actions, html`<button class="btn" id="cprint">${icon('printer')}Yazdır</button><button class="btn" id="cprintSet" title="Yazdırma sayfa düzeni">${icon('settings')}Sayfa düzeni</button><button class="btn primary" id="xls">${icon('sheet')}Excel indir</button>`);
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
        <label class="check small" style="margin-bottom:6px" title="Kategoriler ve grup adları Karma Ayıklama sayfasından değiştirilir"><input type="checkbox" id="ksplit" ${splitOn ? 'checked' : ''}> Karmayı ayır: ${['only', 'rest', ...(kp.third ? ['none'] : [])].map((k, i) => html`${i ? ' / ' : ''}<b>${kp.names[k]}</b>`)} <a href="#/karma" class="muted">(kural: Etiket Ayıklama)</a></label>
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
  $('#ksplit').addEventListener('change', (e) => { splitOn = e.target.checked; setKarmaSplit(splitOn); compute(); });

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
    result = analyzeCombos(computed, state.ctx, { min, includeRewards, ...splitOpt() });
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
        <div class="kpi"><div class="l">${icon('copy')}${KARMA}</div><div class="v">${n(R.karma.orders)}</div><div class="s">${R.karma.split ? R.karma.split.map((x) => `${kp.names[x.key]} ${n(x.orders)}`).join(' · ') : `${n(R.karma.groups.length)} bileşim · ${n(R.karma.units)} ürün`}</div></div>
      </div>
      ${unm ? html`<div class="callout warn">${icon('alert')}<div class="c"><b>Eşleşmeyen ürün adı içeren bileşimler var (⚠)</b><a href="#/matching">Ürün Eşleştirme</a> sayfasından atayınca analiz kendiliğinden düzelir.</div></div>` : ''}
      <div class="card"><div class="tw"><table class="t"><thead><tr><th>Kombinasyon</th><th class="num">Sipariş</th><th class="num">Toplam ürün</th></tr></thead><tbody>
        ${R.groups.map((g) => html`<tr><td>${g.parts.map((p, i) => html`${i ? html`<span class="muted"> + </span>` : ''}<b>${p.name}</b> <span class="muted">x${p.qty}</span>`)}</td><td class="num big">${n(g.orders)}</td><td class="num">${n(g.units * g.orders)}</td></tr>`)}
        ${karmaParts(R.karma).map((x) => html`<tr class="click karmaRow" style="background:var(--surface-2)"><td><b>${x.label}</b> <span class="muted small">— ${min} siparişten az olan ${n(x.groups.length)} bileşim · ayrıntı için tıklayın</span></td><td class="num big">${n(x.orders)}</td><td class="num">${n(x.units)}</td></tr>`)}
      </tbody></table></div></div>
      ${R.karma.orders ? html`<div class="card hidden" id="karmaBox"><div class="card-h"><h2>${KARMA} ayrıntısı</h2><span class="sub">Karmaya düşen bileşimler ve ürün toplamları</span></div>
        <div class="grid g-main" style="padding:16px;align-items:start">
          <div class="tw"><table class="t"><thead><tr><th>Bileşim</th><th class="num">Sipariş</th></tr></thead><tbody>
            ${karmaParts(R.karma).map((x) => html`${R.karma.split ? html`<tr style="background:var(--surface-2)"><td class="small"><b>${x.label}</b></td><td class="num"><b>${n(x.orders)}</b></td></tr>` : ''}${x.groups.map((g) => html`<tr><td class="small">${g.label}</td><td class="num">${n(g.orders)}</td></tr>`)}`)}</tbody></table></div>
          <div class="tw"><table class="t"><thead><tr><th>Ürün</th><th class="num">Adet</th></tr></thead><tbody>
            ${R.karma.products.map((p) => html`<tr><td class="small">${p.name}</td><td class="num"><b>${n(p.qty)}</b></td></tr>`)}</tbody></table></div>
        </div></div>` : ''}
    </div>`);
    ctx.el.querySelectorAll('.karmaRow').forEach((kr) => kr.addEventListener('click', () => $('#karmaBox').classList.toggle('hidden')));
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
        for (const x of karmaParts(result.karma)) {
          rows.push([x.label, x.orders, x.units]);
          for (const g of x.groups) rows.push([`   ${g.label}`, g.orders, g.units * g.orders]);
        }
        const stamp = from === to ? from : `${from}_${to}`;
        await exportTable(`kombinasyonlar_${stamp}.xlsx`, `Kombinasyonlar ${rangeLabel(from, to)}`.slice(0, 31), [{ label: 'Kombinasyon', width: 70 }, { label: 'Sipariş', width: 12, num: true }, { label: 'Toplam ürün', width: 14, num: true }], rows);
      }
    } catch (err) { toast(err.message, 'err'); }
    busy(btn, false);
  });

  // ---------------------------------------------------------------- yazdırma (A4, mağaza mağaza)
  // Sayfa düzeni ayarları hatırlanır; önizleme ve çıktı aynı HTML/CSS ile üretilir.
  const PCOLS = [['products', 'Ürünler'], ['orders', 'Sipariş adedi'], ['units', 'Ürün adedi']];
  const PADS = { s: ['Sıkı', 3], m: ['Normal', 6], l: ['Geniş', 10] };
  // Elle doldurulacak boş sütunlar (ör. personel zimmeti: İsim, İmza); başlıkları kullanıcı yazar
  const XW = { s: ['Dar', 6], m: ['Orta', 9], l: ['Geniş', 13] };
  const cleanExtra = (a) => (Array.isArray(a) ? a : []).slice(0, 8)
    .map((x) => ({ label: String((x && x.label) || '').trim().slice(0, 40), w: XW[x && x.w] ? x.w : 'm' }));
  const printPref = () => {
    const raw = loadPref().print;
    const p = raw || {};
    return {
      cols: Array.isArray(p.cols) && p.cols.length ? PCOLS.map(([k]) => k).filter((k) => p.cols.includes(k)) : ['products', 'orders', 'units'],
      // Önceki sürümün dikey/yatay seçimi A4 kâğıt boyutuna çevrilir
      paper: paperById(p.paper || (p.orient === 'landscape' ? 'a4l' : 'a4p')).id,
      pw: +p.pw >= 20 && +p.pw <= 92 ? +p.pw : null, // ürün sütunu genişliği (%), önizlemede sürüklenir
      fs: Math.min(24, Math.max(6, +p.fs || 13)),
      pad: PADS[p.pad] ? p.pad : 'm',
      margin: Math.min(25, Math.max(0, p.margin == null ? 12 : +p.margin)),
      newPage: !!p.newPage,
      title: p.title !== false,
      extra: cleanExtra(p.extra).filter((x) => x.label),
      saved: !!raw,
    };
  };
  /** Mağaza mağaza bölümler (seçili mağazalar ya da verideki tüm mağazalar) */
  function printSections() {
    const byStore = new Map();
    for (const c of computedAll) {
      const key = c.store ? c.store.id : '?' + (c.order.sender || '');
      if (!byStore.has(key)) byStore.set(key, { name: c.store ? c.store.name : (c.order.sender || 'Tanımsız mağaza'), list: [] });
      byStore.get(key).list.push(c);
    }
    const order = new Map(state.config.stores.map((st, i) => [st.id, i]));
    return [...byStore.entries()].sort((a, b) => (order.get(a[0]) ?? 1e6) - (order.get(b[0]) ?? 1e6) || a[1].name.localeCompare(b[1].name, 'tr'))
      .map(([, v]) => ({ name: v.name, R: analyzeCombos(v.list, state.ctx, { min, includeRewards, ...splitOpt() }) })).filter((x) => x.R.orders);
  }
  /** Çıktı içeriği: yalnızca seçilen sütunlar (kaldırılan sütunun başlığı da hücreleri de yok) */
  function printHtml(p, { preview = false } = {}) {
    const has = (k) => p.cols.includes(k);
    const extra = (p.extra || []).filter((x) => x.label);
    const nums = p.cols.filter((k) => k !== 'products').length;
    // Boş sütun varsa ürün sütunu daha dar başlar; önizlemede sürüklenerek ayarlanır
    const pw = has('products') && nums + extra.length ? (p.pw || (extra.length ? Math.max(30, 56 - 6 * extra.length - 4 * nums) : nums === 1 ? 75 : 62)) : null;
    // Boş sütun varken tüm genişlikler yüzde: ürün sütunundan kalan pay, sayı ve boş sütunlara ağırlıklarıyla bölünür
    const wts = [...p.cols.filter((k) => k !== 'products').map(() => 8), ...extra.map((x) => XW[x.w][1])];
    const share = (w) => `${(((100 - (pw || 0)) * w) / wts.reduce((a, b) => a + b, 0)).toFixed(2)}%`;
    const numW = extra.length ? raw(`style="width:${share(8)}"`) : '';
    const xcells = (tag) => extra.map((x) => tag === 'th'
      ? html`<th class="x" style="width:${share(XW[x.w][1])}">${x.label}</th>`
      : html`<td class="x"></td>`);
    const row = (label, orders, units, karma) => html`<tr class="${karma ? 'karma' : ''}">${has('products') ? html`<td class="p">${label}</td>` : ''}${has('orders') ? html`<td class="num">${n(orders)}</td>` : ''}${has('units') ? html`<td class="num">${n(units)}</td>` : ''}${xcells('td')}</tr>`;
    const head = html`<tr>${has('products') ? html`<th class="p" ${pw ? raw(`style="width:${pw}%"`) : ''}>Ürünler${preview && nums + extra.length ? html`<span class="cw" data-cw title="Sürükleyerek sütun genişliğini ayarlayın"></span>` : ''}</th>` : ''}${has('orders') ? html`<th class="num" ${numW}>Sipariş adedi</th>` : ''}${has('units') ? html`<th class="num" ${numW}>Ürün adedi</th>` : ''}${xcells('th')}</tr>`;
    const scope = [rangeLabel(from, to), batchIds.length || tFrom || tTo ? 'seçili yüklemeler' + (tFrom || tTo ? ` ${tFrom || '…'}–${tTo || '…'}` : '') : ''].filter(Boolean).join(' · ');
    const style = `--fs:${p.fs}pt;--pad:${PADS[p.pad][1]}px`;
    return html`<div class="cprint ${has('products') ? '' : 'nop'} ${pw ? 'pw' : ''} cols-${nums}" style="${style}">
      ${p.title ? html`<h1>Kombinasyon Listesi</h1><p class="sub">${scope} · ${min} siparişten az olan bileşimler “${KARMA}” satırında</p>` : ''}
      ${printSections().map((sc, i) => html`<section class="${p.newPage && i ? 'newpage' : ''}"><h2>${sc.name} <small>${n(sc.R.orders)} sipariş</small></h2><table><thead>${head}</thead><tbody>
        ${sc.R.groups.map((g) => row(g.label, g.orders, g.units * g.orders))}
        ${karmaParts(sc.R.karma).map((x) => row(x.label, x.orders, x.units, true))}
      </tbody></table></section>`)}
    </div>`;
  }
  async function printSettings() {
    if (!computedAll.length) { toast('Önizleme için sipariş yok; tarih ya da mağaza seçimini değiştirin', 'err'); return false; }
    let p = printPref();
    let ok = false;
    let paperId = p.paper;
    let pw = p.pw;
    let extra = cleanExtra(p.extra);
    const read = (d) => ({
      extra: extra.filter((x) => x.label),
      cols: [...d.querySelectorAll('[name=col]:checked')].map((x) => x.value),
      paper: paperId,
      pw,
      fs: +d.querySelector('[name=fs]').value,
      pad: d.querySelector('[name=pad]').value,
      margin: +d.querySelector('[name=margin]').value,
      newPage: d.querySelector('[name=newPage]').checked,
      title: d.querySelector('[name=title]').checked,
    });
    await modal({
      title: 'Sayfa düzeni',
      size: 'lg',
      body: html`<div class="print-setup">
        <div class="stack" style="gap:14px">
          <div class="f">Sütunlar<div class="row wrap" style="gap:14px;margin-top:6px">${PCOLS.map(([k, l]) => html`<label class="check"><input type="checkbox" name="col" value="${k}" ${p.cols.includes(k) ? 'checked' : ''}> ${l}</label>`)}</div></div>
          <div class="f">Boş sütunlar <span class="hint">kâğıtta elle doldurulur — ör. barkodu teslim alan personelin adı ve imzası</span><div id="pExtra" style="margin-top:6px"></div></div>
          <div class="f">Kâğıt boyutu <span class="hint">A4, etiket ya da kendi eklediğiniz ölçü</span><div id="pPaper"></div></div>
          <label class="f">Yazı boyutu <span class="hint" id="fsV">${p.fs} punto</span><input type="range" name="fs" min="6" max="24" step="0.5" value="${p.fs}"></label>
          <label class="f">Satır aralığı<select class="input" name="pad">${Object.entries(PADS).map(([k, [l]]) => html`<option value="${k}" ${p.pad === k ? 'selected' : ''}>${l}</option>`)}</select></label>
          <label class="f">Kenar boşluğu <span class="hint" id="mgV">${p.margin} mm</span><input type="range" name="margin" min="0" max="25" step="1" value="${p.margin}"></label>
          <button type="button" class="btn sm ghost" id="pwReset">Sütun genişliğini sıfırla</button>
          <label class="check"><input type="checkbox" name="title" ${p.title ? 'checked' : ''}> Başlık ve tarih satırı</label>
          <label class="check"><input type="checkbox" name="newPage" ${p.newPage ? 'checked' : ''}> Her mağaza yeni sayfada başlasın</label>
          <p class="muted small">Sütunlar her zaman kâğıt genişliğine sığar; ürün sütununun genişliğini önizlemede başlığın sağ kenarını tutup sürükleyerek ayarlayın. Uzun ürün adları alt satıra geçer, satırlar gerekirse sonraki sayfaya devam eder. Mağaza seçimi sayfanın üstündeki kutudan alınır. Ayarlar hatırlanır.</p>
        </div>
        <div><div class="muted small" style="margin-bottom:6px" id="pvInfo">Önizleme · 1. sayfa</div><div class="sheet-wrap" id="pv"></div></div>
      </div>`,
      actions: [{ label: 'Vazgeç', value: 'cancel' }, { label: 'Kaydet', value: 'save' }, { label: 'Kaydet ve yazdır', value: 'ok', variant: 'primary', icon: 'printer' }],
      onOpen: (d) => {
        const pv = d.querySelector('#pv');
        const draw = () => {
          const q = read(d);
          const pp = paperById(q.paper);
          d.querySelector('#fsV').textContent = `${q.fs} punto`;
          d.querySelector('#mgV').textContent = `${q.margin} mm`;
          const show = { ...q, cols: q.cols.length ? q.cols : ['products'] };
          const px = 96 / 25.4;
          const zoom = Math.min(0.75, Math.max(0.2, (pv.clientWidth - 28) / (pp.w * px)), 620 / (pp.h * px));
          d.querySelector('#pvInfo').textContent = `Önizleme · 1. sayfa · ${pp.w} × ${pp.h} mm`;
          mount(pv, html`<div class="sheet" style="width:${pp.w}mm;height:${pp.h}mm;padding:${q.margin}mm;zoom:${zoom}">${printHtml(show, { preview: true })}</div>`);
        };
        // Boş sütun listesi: başlık yaz, genişlik seç, sırala, sil
        const ex = d.querySelector('#pExtra');
        const drawExtra = () => {
          const has = (l) => extra.some((x) => x.label.toLocaleLowerCase('tr-TR') === l.toLocaleLowerCase('tr-TR'));
          mount(ex, html`<div class="stack" style="gap:6px">
            ${extra.map((x, i) => html`<div class="row xcol" style="gap:6px" data-i="${i}">
              <input class="input sm" data-x="label" value="${x.label}" maxlength="40" placeholder="Sütun başlığı" style="flex:1 1 auto;min-width:90px;width:auto">
              <select class="input sm" data-x="w" title="Sütun genişliği" style="width:86px;flex:none">${Object.entries(XW).map(([k, [l]]) => html`<option value="${k}" ${x.w === k ? 'selected' : ''}>${l}</option>`)}</select>
              <button type="button" class="btn icon sm ghost" data-x="up" title="Sola al" ${i ? '' : 'disabled'}>↑</button>
              <button type="button" class="btn icon sm ghost" data-x="down" title="Sağa al" ${i < extra.length - 1 ? '' : 'disabled'}>↓</button>
              <button type="button" class="btn icon sm danger" data-x="del" title="Sütunu kaldır">${icon('trash')}</button>
            </div>`)}
            <div class="row wrap" style="gap:6px">
              ${['İsim', 'İmza'].filter((l) => !has(l)).map((l) => html`<button type="button" class="btn sm" data-x="preset" data-l="${l}">${icon('plus')} ${l}</button>`)}
              ${extra.length < 8 ? html`<button type="button" class="btn sm ghost" data-x="new">${icon('plus')} Yeni sütun</button>` : ''}
            </div>
          </div>`);
        };
        ex.addEventListener('input', (ev) => {
          const r = ev.target.closest('[data-i]'); if (!r) return;
          const x = extra[+r.dataset.i];
          if (ev.target.dataset.x === 'label') x.label = ev.target.value.slice(0, 40);
          if (ev.target.dataset.x === 'w') x.w = ev.target.value;
        });
        ex.addEventListener('click', (ev) => {
          const b = ev.target.closest('button[data-x]'); if (!b) return;
          const i = b.closest('[data-i]') ? +b.closest('[data-i]').dataset.i : -1;
          const a = b.dataset.x;
          if (a === 'preset') extra.push({ label: b.dataset.l, w: b.dataset.l === 'İmza' ? 'l' : 'm' });
          else if (a === 'new') extra.push({ label: '', w: 'm' });
          else if (a === 'del') extra.splice(i, 1);
          else if (a === 'up' && i > 0) [extra[i - 1], extra[i]] = [extra[i], extra[i - 1]];
          else if (a === 'down' && i < extra.length - 1) [extra[i + 1], extra[i]] = [extra[i], extra[i + 1]];
          else return;
          drawExtra(); draw();
          if (a === 'new') [...ex.querySelectorAll('[data-x="label"]')].pop()?.focus();
        });
        drawExtra();
        paperPicker(d.querySelector('#pPaper'), { selected: paperId, onChange: (np) => { paperId = np.id; draw(); } });
        d.querySelector('#pwReset').addEventListener('click', () => { pw = null; draw(); });
        // Ürün sütununun sağ kenarını sürükle → genişlik (%)
        pv.addEventListener('pointerdown', (ev) => {
          if (!ev.target.closest('[data-cw]')) return;
          ev.preventDefault();
          const table = ev.target.closest('table');
          const move = (mv) => {
            const r = table.getBoundingClientRect();
            pw = Math.round(Math.max(20, Math.min(92, ((mv.clientX - r.left) / r.width) * 100)));
            pv.querySelectorAll('.cprint th.p').forEach((th) => { th.style.width = pw + '%'; });
          };
          const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); draw(); };
          window.addEventListener('pointermove', move);
          window.addEventListener('pointerup', up);
        });
        d.addEventListener('input', (ev) => { if (!ev.target.closest('#pPaper')) draw(); });
        d.addEventListener('change', (ev) => { if (!ev.target.closest('#pPaper')) draw(); });
        requestAnimationFrame(draw);
      },
      onSubmit: (v, d) => {
        const q = read(d);
        if (!q.cols.length && !q.extra.length) throw new Error('En az bir sütun seçin');
        savePref({ print: q });
        ok = v === 'ok';
      },
    });
    return ok;
  }
  function doPrint() {
    if (tab !== 'auto') { tab = 'auto'; savePref({ tab }); showTab(); }
    if (!computedAll.length) return toast('Yazdırılacak sipariş yok', 'err');
    const p = printPref();
    const box = document.getElementById('print');
    const pp = paperById(p.paper);
    mount(box, html`<style>@page { size: ${pp.w}mm ${pp.h}mm; margin: ${p.margin}mm }</style>${printHtml(p)}`);
    // Çıktı sayfada kalmasın: sonra tarayıcıdan (Ctrl+P) basılırsa eski ayarlı liste çıkmasın
    window.addEventListener('afterprint', () => { box.innerHTML = ''; }, { once: true });
    window.print();
  }
  ctx.actions.querySelector('#cprint').addEventListener('click', async () => { if (!printPref().saved && !(await printSettings())) return; doPrint(); });
  ctx.actions.querySelector('#cprintSet').addEventListener('click', async () => { if (await printSettings()) doPrint(); });

  showTab();
  load();
}
