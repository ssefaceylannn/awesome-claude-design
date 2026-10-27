// Kombinasyon analizi: yüklenen siparişlerde aynı ürün + adet bileşimleri (≥ eşik ayrı satır,
// kalanlar "Karma Siparişler"). Mağaza, tarih, yükleme ve yükleme saati ile süzülür.
// İkinci sekme: Trendyol "Gönderime Hazır" sayfasından kopyalanan grup metnini okur.
import { html, raw, mount, icon, n, toast, busy, emptyState, rangeLabel, multiSelect, trDateTime, personName, modal } from '../core/ui.js';
import { api, state, fetchOrders, getRange } from '../core/api.js';
import { fold } from '../shared/text.js';
import { computeOrder } from '../shared/calc.js';
import { analyzeCombos, parseComboPaste, comboOf, KARMA } from '../shared/combos.js';
import { rangePicker, storeFilters, filterLabel } from '../core/widgets.js';
import { exportTable, lib as excelLib, save as excelSave } from '../core/excel.js';
import { paperById, paperPicker } from '../core/paper.js';
import { karmaPref, karmaLabel, karmaName, karmaSplitOn, setKarmaSplit } from '../core/karmapref.js';

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
  // boş = tüm yüklemeler; Etiket Yükle'den "kombinasyon listesini aç" ile gelinirse o yükleme seçili açılır
  let batchIds = ctx.params.batch && /^[0-9a-z-]{10,40}$/.test(ctx.params.batch) ? [ctx.params.batch] : [];
  let tFrom = '', tTo = '';
  let orders = [], batches = [], result = null, pasted = null;
  let dayOrders = []; // tarih aralığındaki siparişler (yükleme seçilmemişse analiz bunlarla yapılır)
  let again = 0; // seçilen yüklemelerde yeniden gelen (daha önce kaydedilmiş) sipariş sayısı
  // Yükleme seçilince varsayılan: yalnızca o yüklemede YENİ kaydedilen siparişler (mükerrerler sayılmaz)
  let withAgain = !!pref.again;
  let loadSeq = 0;
  let computedAll = []; // son hesaplanan siparişler (yazdırma mağaza mağaza buradan yapılır)
  let assigns = {}; // sipariş anahtarı (k) → { n: teslim alan, c, s, at, by } — sitede kayıtlı "kim yaptı"
  let assignSpan = ''; // yüklenen teslim kayıtlarının tarih aralığı
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
        <label class="check small" style="margin-bottom:6px" title="Yükleme ya da saat seçiliyken geçerlidir"><input type="checkbox" id="again" ${withAgain ? 'checked' : ''}> Yüklemede yeniden gelen (daha önce kaydedilmiş) siparişleri de say</label>
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
  $('#body').addEventListener('click', (e) => { const b = e.target.closest('#teslimSave'); if (b) saveTeslim(b); });
  $('#body').addEventListener('change', (e) => { if (e.target.id === 'teslimImport') { const f = [...e.target.files]; e.target.value = ''; importTeslim(f); } });
  $('#again').addEventListener('change', (e) => { withAgain = e.target.checked; savePref({ again: withAgain }); pickOrders(); });
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
   * Yükleme veya saat seçiliyse: o yüklemelerde YENİ kaydedilen siparişler. "Yeniden gelenleri de say"
   * işaretliyse daha önce (başka yüklemede / başka gün) kaydedilip bu yüklemede tekrar gelenler de eklenir.
   * Hiçbiri iki kez sayılmaz. Seçim yoksa: tarih aralığındaki siparişler.
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
      orders = refs.filter((r) => withAgain || !r.again).map((r) => byK.get(r.k)).filter((o) => o && !o.summary);
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
    loadAssigns();
  }

  // ---------------------------------------------------------------- teslim alan (kim yaptı)
  /** Görünen siparişlerin teslim kayıtları (tarih aralığı değiştiyse sunucudan) */
  async function loadAssigns(force = false) {
    const dates = computedAll.map((c) => c.order.date).filter(Boolean).sort();
    if (!dates.length) return drawTeslim();
    const span = `${dates[0]}|${dates[dates.length - 1]}`;
    if (!force && span === assignSpan) return drawTeslim();
    try {
      const { map } = await api.get(`assign?from=${dates[0]}&to=${dates[dates.length - 1]}`);
      assigns = map || {}; assignSpan = span;
    } catch (e) { toast('Teslim kayıtları okunamadı: ' + e.message, 'err'); }
    if (ctx.isCurrent()) drawTeslim();
  }
  /** Mağaza mağaza her kombinasyon satırı ve siparişleri (teslim listesi, sipariş bazında Excel ve içe aktarma aynı satırları kullanır) */
  function teslimLines(sections = printSections()) {
    const out = [];
    for (const sc of sections) {
      for (const g of sc.R.groups) out.push({ store: sc.name, label: g.label, key: g.key, karma: null, orders: g.orders, refs: g.refs });
      for (const x of karmaParts(sc.R.karma)) out.push({ store: sc.name, label: x.label, key: null, karma: x.key, orders: x.orders, refs: x.groups.flatMap((g) => g.refs) });
    }
    return out;
  }
  /**
   * Kombinasyon satırlarını teslim alana göre böler: siparişleri farklı kişilere yazılmış satır, her kişi için ayrı
   * satır olur (tek isim + o kişinin sipariş adedi — e-tablodaki açılır listeye uygun); isimsiz siparişler ayrı satırda.
   */
  function splitByName(lines) {
    const out = [];
    for (const l of lines) {
      const by = new Map();
      for (const o of l.refs) { const nm = (assigns[o.k] && assigns[o.k].n) || ''; if (!by.has(nm)) by.set(nm, []); by.get(nm).push(o); }
      const names = [...by.keys()].sort((a, b) => (a === '') - (b === '') || a.localeCompare(b, 'tr'));
      for (const nm of names) out.push({ ...l, name: nm, refs: by.get(nm), orders: by.get(nm).length });
    }
    return out;
  }
  /** Teslim kayıtlarını 4000'lik parçalar hâlinde gönderir (çok sipariş olsa da hepsi kaydedilir) */
  async function postAssign(items, summary, onProgress) {
    const tot = { set: 0, cleared: 0 };
    const CH = 4000;
    for (let i = 0; i < items.length; i += CH) {
      onProgress && onProgress(Math.min(i + CH, items.length), items.length);
      const part = await api.post('assign', { items: items.slice(i, i + CH), summary: items.length > CH ? `${summary} (${i / CH + 1}/${Math.ceil(items.length / CH)})` : summary });
      tot.set += part.set || 0; tot.cleared += part.cleared || 0;
    }
    return tot;
  }
  let teslimRows = [];
  const knownNames = () => { let a = []; try { a = JSON.parse(localStorage.getItem('et-names') || '[]'); } catch { /* yok */ } return [...new Set([...a, ...Object.values(assigns).map((x) => x.n)])].filter(Boolean).sort((x, y) => x.localeCompare(y, 'tr')); };
  function drawTeslim() {
    const box = $('#teslim');
    if (!box) return;
    teslimRows = splitByName(teslimLines());
    const done = teslimRows.filter((r) => r.name).length;
    mount(box, html`<div class="card-h"><h2>Teslim alanlar</h2><span class="sub">Her kombinasyonu kim aldı? Yazıp kaydedin — isim o satırdaki her siparişe işlenir. Aynı kombinasyonu birden fazla kişi aldıysa her kişi ayrı satırda görünür.</span><span class="spacer"></span>
        <span class="badge ${done === teslimRows.length ? 'ok' : ''}">${n(done)} / ${n(teslimRows.length)} satır</span></div>
      <datalist id="teslimNames">${knownNames().map((x) => html`<option value="${x}">`)}</datalist>
      <div class="tw"><table class="t"><thead><tr><th>Mağaza</th><th>Kombinasyon</th><th class="num">Sipariş</th><th>Teslim alan</th></tr></thead><tbody>
        ${teslimRows.map((r, i) => html`<tr${r.karma ? html` style="background:var(--surface-2)"` : ''}><td class="small nowrap">${r.store}</td><td class="small">${r.karma ? html`<b>${r.label}</b>` : r.label}</td><td class="num"><b>${n(r.orders)}</b></td>
          <td><input class="input sm" data-tr="${i}" list="teslimNames" maxlength="60" value="${r.name}" placeholder="Ad Soyad" style="width:220px"></td></tr>`)}
      </tbody></table></div>
      <div class="card-f row wrap" style="gap:8px">
        <span class="muted small">Doldurulmuş teslim listesi Excel'iniz varsa içe aktarın: site her satırı o günün siparişleriyle eşleştirir; sipariş adedi tutmayan satıra isim yazmaz.</span>
        <span class="spacer"></span>
        <label class="btn">${icon('upload')}Teslim listesi Excel'ini içe aktar<input type="file" id="teslimImport" accept=".xlsx" multiple hidden></label>
        <button class="btn primary" id="teslimSave">${icon('check')}Teslim alanları kaydet</button>
      </div>`);
  }
  async function saveTeslim(btn) {
    const items = []; const used = new Set(); let rowsChanged = 0;
    for (const inp of ctx.el.querySelectorAll('[data-tr]')) {
      const r = teslimRows[+inp.dataset.tr];
      const name = inp.value.trim();
      if (name === r.name) continue; // değişmedi
      rowsChanged++;
      if (name) used.add(name);
      for (const o of r.refs) items.push({ date: o.date, k: o.k, name, combo: r.label, store: r.store });
    }
    if (!items.length) return toast('Değişiklik yok', 'err');
    busy(btn, true, 'Kaydediliyor…');
    try {
      const res = await postAssign(items, `${rowsChanged} kombinasyon satırı · ${rangeLabel(from, to)}`, (d, t) => { btn.lastChild.textContent = `Kaydediliyor… ${n(d)}/${n(t)}`; });
      try { localStorage.setItem('et-names', JSON.stringify([...new Set([...knownNames(), ...used])].slice(-200))); } catch { /* yok */ }
      toast(`${n(res.set)} siparişe teslim alan yazıldı${res.cleared ? `, ${n(res.cleared)} siparişten silindi` : ''}`, 'ok');
      await loadAssigns(true);
    } catch (e) { toast(e.message, 'err'); }
    busy(btn, false);
  }

  function render() {
    const R = result;
    if (!R) return;
    if (!R.orders) return mount($('#body'), html`<div class="card">${emptyState('box', 'Sipariş yok', 'Tarih, mağaza veya yükleme seçimini değiştirin.')}</div>`);
    const inGroups = R.groups.reduce((s, g) => s + g.orders, 0);
    const unm = R.groups.concat(R.karma.groups).some((g) => g.parts.some((p) => p.id.startsWith('?')));
    mount($('#body'), html`<div class="stack">
      <div class="kpis">
        <div class="kpi"><div class="l">${icon('receipt')}Sipariş</div><div class="v">${n(R.orders)}</div><div class="s">${n(R.groups.length + R.karma.groups.length)} farklı bileşim${again ? (withAgain ? ` · ${n(again)} yeniden gelen dahil` : ` · ${n(again)} yeniden gelen (mükerrer) sayılmadı`) : ''}</div></div>
        <div class="kpi hl"><div class="l">${icon('box')}${min}+ siparişli bileşim</div><div class="v">${n(R.groups.length)}</div><div class="s">${n(inGroups)} sipariş</div></div>
        <div class="kpi"><div class="l">${icon('copy')}${KARMA}</div><div class="v">${n(R.karma.orders)}</div><div class="s">${R.karma.split ? R.karma.split.map((x) => `${karmaName(x.key, kp)} ${n(x.orders)}`).join(' · ') : `${n(R.karma.groups.length)} bileşim · ${n(R.karma.units)} ürün`}</div></div>
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
      <div class="card" id="teslim"></div>
    </div>`);
    drawTeslim();
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
        if (!computedAll.length) throw new Error('Gösterilecek sipariş yok');
        busy(btn, false);
        const kind = await askExcel();
        if (!kind) return;
        busy(btn, true, 'Hazırlanıyor…');
        if (kind === 'print') await xlsPrintLike(); else if (kind === 'orders') await xlsOrders(); else await xlsLog();
      }
    } catch (err) { toast(err.message, 'err'); }
    busy(btn, false);
  });

  // ---------------------------------------------------------------- teslim listesi içe aktarma
  // Doldurulmuş teslim listesi (TARİH · SAAT · MAĞAZA · KOMBİNASYON · SİPARİŞ ADEDİ · TESLİM ALAN) okunur; her satır o gün
  // o saatte yüklenen, o mağazanın siparişleriyle yeniden kurulan kombinasyon listesinde aranır. Sipariş adedi tutmayan
  // ya da bulunamayan satıra isim YAZILMAZ — kullanıcıya gösterilir (yanlış kişiye yazılmasın).
  const cellVal = (v) => (v && typeof v === 'object' && !(v instanceof Date) ? (v.result !== undefined ? v.result : v.richText ? v.richText.map((t) => t.text).join('') : v.text || '') : v);
  const ymdOf = (v) => {
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if (typeof v === 'number' && v > 20000) return new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 864e5).toISOString().slice(0, 10);
    const t = String(v || '').trim();
    let m = t.match(/(\d{1,2})[./](\d{1,2})[./](\d{4})/); if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    m = t.match(/(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
  };
  const timesOf = (v) => {
    const fmt = (mins) => `${pad(Math.floor(mins / 60) % 24)}:${pad(Math.round(mins % 60))}`;
    if (v instanceof Date) { const x = fmt(v.getUTCHours() * 60 + v.getUTCMinutes() + Math.round(v.getUTCSeconds() / 60)); return [x, x]; }
    if (typeof v === 'number' && v >= 0 && v < 1) { const x = fmt(Math.round(v * 1440)); return [x, x]; }
    const all = String(v || '').match(/\d{1,2}[:.]\d{2}/g);
    if (!all) return null;
    const norm = all.map((x) => { const [h, mm] = x.split(/[:.]/); return `${h.padStart(2, '0')}:${mm}`; });
    return [norm[0], norm[norm.length - 1]];
  };
  /** "Coconut Mix x1 + Detox Mix x2" → sitedeki bileşim anahtarı (ürün adları katalogla eşleştirilir) */
  function keyOfLabel(label) {
    const pos = new Map(state.ctx.products.map((p, i) => [p.id, i]));
    const byLabel = new Map(state.ctx.products.map((p) => [fold(state.ctx.label(p.id)), p.id]));
    const parts = [];
    for (const raw of String(label).split('+')) {
      const m = raw.trim().match(/^(.*?)\s*[x×]\s*(\d+)$/i);
      if (!m) return null;
      const id = byLabel.get(fold(m[1])) || state.ctx.match(m[1]).productId;
      if (!id) return null;
      const ex = parts.find((x) => x.id === id);
      if (ex) ex.q += +m[2]; else parts.push({ id, q: +m[2], name: state.ctx.label(id) });
    }
    return parts.sort((a, b) => (pos.get(a.id) ?? 1e6) - (pos.get(b.id) ?? 1e6) || a.name.localeCompare(b.name, 'tr')).map((x) => `${x.id}*${x.q}`).join('+');
  }
  async function importTeslim(files) {
    if (!files.length) return;
    const rows = [];
    try {
      const ExcelJS = await excelLib();
      for (const f of files) {
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(await f.arrayBuffer());
        wb.eachSheet((ws) => {
          let map = null;
          ws.eachRow((row, rn) => {
            const vals = row.values.slice(1).map(cellVal);
            if (!map) {
              const h = vals.map((v) => fold(String(v ?? '')).replace(/\s+/g, ' ').trim());
              if (h.includes('kombinasyon') && h.some((x) => x.startsWith('teslim'))) map = { date: h.indexOf('tarih'), time: h.indexOf('saat'), store: h.findIndex((x) => x.startsWith('magaza')), combo: h.indexOf('kombinasyon'), count: h.findIndex((x) => x.startsWith('siparis')), name: h.findIndex((x) => x.startsWith('teslim')) };
              return;
            }
            const g = (i) => (i >= 0 ? vals[i] : '');
            const name = String(g(map.name) ?? '').trim();
            const combo = String(g(map.combo) ?? '').trim();
            if (!combo) return;
            rows.push({ where: `${f.name} · ${rn}. satır`, date: ymdOf(g(map.date)), time: timesOf(g(map.time)), store: String(g(map.store) ?? '').trim(), combo, count: parseInt(g(map.count), 10) || null, name });
          });
        });
      }
    } catch (e) { return toast('Excel okunamadı: ' + e.message, 'err'); }
    if (!rows.length) return toast('Dosyada TARİH · SAAT · MAĞAZA · KOMBİNASYON · SİPARİŞ ADEDİ · TESLİM ALAN başlıkları bulunamadı', 'err');
    const withName = rows; // isimsiz satırlar da işlenir: pencerede isim yazılabilir
    const dates = [...new Set(withName.map((r) => r.date).filter(Boolean))].sort();
    if (!dates.length) return toast('TARİH sütunu okunamadı', 'err');
    toast('Siparişler okunuyor…');
    const shift = (d, k) => { const x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() + k); return localYmd(x.toISOString()); };
    let pool;
    try { pool = (await fetchOrders(shift(dates[0], -5), shift(dates[dates.length - 1], 1))).filter((o) => !o.summary && o.at); } catch (e) { return toast(e.message, 'err'); }
    const cc = new Map();
    const comp = (o) => { if (!cc.has(o.k)) cc.set(o.k, computeOrder(o, state.ctx)); return cc.get(o.k); };
    const storeKey = (x) => fold(x).replace(/[^a-z0-9]/g, '');
    const ok = [], bad = [], fix = []; // fix: siparişleri bulunan ama ismi eksik / adedi farklı satırlar (pencerede yazılır)
    const items = [];
    const seen = new Set();
    for (const r of withName) {
      if (!r.date) { bad.push({ r, why: 'tarih okunamadı' }); continue; }
      const sk = storeKey(r.store);
      // Saat verilmişse: o saatte kaydedilen yükleme(ler)in bütün yeni siparişleri (büyük yükleme dakika değişirken
      // kaydedilse de hepsi alınır); saat yoksa o gün yüklenen bütün yeni siparişler
      const dayOrders = pool.filter((o) => localYmd(o.at) === r.date);
      let picked = dayOrders;
      if (r.time) {
        const atTime = dayOrders.filter((o) => hhmm(o.at) >= r.time[0] && hhmm(o.at) <= r.time[1]);
        const bs = new Set(atTime.map((o) => o.batch).filter(Boolean));
        picked = bs.size ? dayOrders.filter((o) => bs.has(o.batch)) : atTime;
      }
      const cs = picked.map(comp)
        .filter((c) => { const nm = storeKey(c.store ? c.store.name : c.order.sender); return !sk || nm === sk || nm.includes(sk) || sk.includes(nm); });
      if (!cs.length) { bad.push({ r, why: 'o gün/saatte bu mağazanın yüklenen siparişi yok' }); continue; }
      // Liste kampanyasız ya da (ilk günlerdeki gibi) kampanya ürünleri dahil alınmış olabilir: ikisinde de aranır.
      // Sipariş adedi tutan ilk eşleşme kullanılır; hiçbiri tutmazsa satıra isim yazılmaz.
      const fc = fold(r.combo);
      const key = fc.startsWith('karma') ? null : keyOfLabel(r.combo);
      const findIn = (lines) => {
        const exact = lines.find((l) => fold(l.label) === fc);
        if (exact) return exact.refs;
        if (fc.startsWith('karma')) {
          const karmaLines = lines.filter((l) => l.karma);
          const named = karmaLines.find((l) => fc.includes(fold(karmaName(l.karma, kp))));
          return named ? named.refs : karmaLines.length ? karmaLines.flatMap((l) => l.refs) : null;
        }
        const hit = key && lines.find((l) => l.key === key);
        return hit ? hit.refs : null;
      };
      const tries = [includeRewards, !includeRewards].map((rw) => findIn(teslimLines([{ name: r.store, R: analyzeCombos(cs, state.ctx, { min, includeRewards: rw, ...splitOpt() }) }])));
      const found = tries.filter(Boolean);
      const refs = found.find((x) => r.count == null || x.length === r.count) || null;
      if (!found.length) { bad.push({ r, why: 'bu kombinasyon o yüklemede yok' }); continue; }
      if (!refs) { fix.push({ r, refs: found[0], why: 'adet farklı' }); continue; }
      if (!r.name) { fix.push({ r, refs, why: 'isim eksik' }); continue; }
      ok.push({ r, n: refs.length });
      for (const o of refs) { if (seen.has(o.k)) continue; seen.add(o.k); items.push({ date: o.date, k: o.k, name: r.name, combo: r.combo, store: r.store }); }
    }
    let go = false;
    const fixNames = new Map();
    await modal({
      title: 'Teslim listesi içe aktarma',
      size: 'lg',
      body: html`<div class="stack" style="gap:12px">
        <datalist id="impNames">${[...new Set([...knownNames(), ...rows.map((r) => r.name).filter(Boolean)])].sort((a, b) => a.localeCompare(b, 'tr')).map((x) => html`<option value="${x}">`)}</datalist>
        <div class="kpis"><div class="kpi hl"><div class="l">${icon('check')}Eşleşen satır</div><div class="v">${n(ok.length)}</div><div class="s">${n(items.length)} siparişe isim yazılacak</div></div>
          <div class="kpi"><div class="l">${icon('edit')}Kontrol edilecek</div><div class="v">${n(fix.length)}</div><div class="s">ismi eksik ya da adedi farklı — aşağıda yazın</div></div>
          <div class="kpi"><div class="l">${icon('alert')}Bulunamayan</div><div class="v">${n(bad.length)}</div><div class="s">sitede bu kombinasyon yok</div></div></div>
        ${fix.length ? html`<div><b class="small">İsmi eksik ya da adedi farklı satırlar</b> <span class="muted small">— isim yazarsanız sitede bulunan siparişlerin hepsine yazılır; boş bırakılan satır kaydedilmez</span>
          <div class="tw" style="max-height:340px;margin-top:6px"><table class="t"><thead><tr><th>Tarih · Mağaza</th><th>Kombinasyon</th><th class="num">Excel</th><th class="num">Site</th><th>Teslim alan</th></tr></thead><tbody>
          ${fix.map((x, i) => html`<tr><td class="small nowrap">${x.r.date ? trD(x.r.date) : ''}${x.r.time ? ' ' + x.r.time[0] : ''}<div class="muted xs">${x.r.store}</div></td><td class="small">${x.r.combo}</td>
            <td class="num ${x.why === 'adet farklı' ? 'unm' : ''}">${x.r.count ?? '—'}</td><td class="num"><b>${n(x.refs.length)}</b></td>
            <td><input class="input sm" data-fix="${i}" list="impNames" maxlength="60" value="${x.r.name}" placeholder="Ad Soyad" style="width:190px"></td></tr>`)}</tbody></table></div></div>` : ''}
        ${bad.length ? html`<details><summary class="small" style="cursor:pointer">Bulunamayan satırlar (${bad.length})</summary><div class="tw" style="max-height:220px;margin-top:6px"><table class="t"><tbody>
          ${bad.map(({ r, why }) => html`<tr><td class="small nowrap">${r.where}<div class="muted xs">${r.date ? trD(r.date) : ''} · ${r.store}</div></td><td class="small">${r.combo}</td><td class="small">${r.name}</td><td class="small unm">${why}</td></tr>`)}</tbody></table></div></details>` : ''}
      </div>`,
      actions: [{ label: 'Vazgeç', value: 'cancel' }, { label: 'Kaydet', value: 'ok', variant: 'primary', icon: 'check' }],
      onSubmit: (v, d) => {
        go = v === 'ok';
        if (go) d.querySelectorAll('[data-fix]').forEach((inp) => fixNames.set(+inp.dataset.fix, inp.value.trim()));
      },
    });
    if (!go) return;
    // Pencerede yazılan isimler: o satırın sitede bulunan siparişlerine
    let fixed = 0;
    fix.forEach((x, i) => {
      const name = fixNames.get(i);
      if (!name) return;
      fixed++;
      for (const o of x.refs) { if (seen.has(o.k)) continue; seen.add(o.k); items.push({ date: o.date, k: o.k, name, combo: x.r.combo, store: x.r.store }); }
    });
    if (!items.length) return toast('Kaydedilecek isim yok', 'err');
    try {
      toast('Kaydediliyor…');
      const res = await postAssign(items, `teslim listesi içe aktarma: ${ok.length + fixed} satır`);
      toast(`${n(res.set)} siparişe teslim alan yazıldı`, 'ok');
      await loadAssigns(true);
    } catch (e) { toast(e.message, 'err'); }
  }

  // ---------------------------------------------------------------- Excel biçimleri
  async function askExcel() {
    let pick = null;
    await modal({
      title: 'Excel indir',
      body: html`<div class="stack" style="gap:10px">
        <p class="muted small" style="margin:0">Mağaza seçimi, tarih ve yükleme seçimi sayfadakiyle aynıdır.</p>
        <div class="callout info">${icon('printer')}<div class="c"><b>Çıktıdaki gibi</b>Mağaza mağaza bölümler, yazdırma ayarlarındaki sütunlar (Ürünler / Sipariş adedi / Ürün adedi ve eklediğiniz boş sütunlar) ve karma satırları. Düzenleyip yazdırmak için.</div></div>
        <div class="callout info">${icon('sheet')}<div class="c"><b>Teslim listesi</b>Sütunlar: TARİH · SAAT · MAĞAZA · KOMBİNASYON · SİPARİŞ ADEDİ · TESLİM ALAN. Her mağazanın her kombinasyonu bir satır; tarih ve saat siparişlerin yüklendiği an; teslim alan sitede kayıtlıysa dolu gelir.</div></div>
        <div class="callout info">${icon('receipt')}<div class="c"><b>Sipariş bazında</b>Her sipariş bir satır: TARİH · SAAT · MAĞAZA · SİPARİŞ / BARKOD NO (734… / 275…) · PTT BARKOD · KOMBİNASYON · İÇERİK (siparişin kendi ürünleri) · TESLİM ALAN. Hangi siparişi kimin yaptığını bulmak için.</div></div>
      </div>`,
      actions: [{ label: 'Vazgeç', value: 'cancel' }, { label: 'Çıktıdaki gibi', value: 'print', icon: 'printer' }, { label: 'Sipariş bazında', value: 'orders', icon: 'receipt' }, { label: 'Teslim listesi', value: 'log', variant: 'primary', icon: 'sheet' }],
      onSubmit: (v) => { pick = v === 'cancel' ? null : v; },
    });
    return pick;
  }
  const fileStamp = () => (from === to ? from : `${from}_${to}`);
  const trD = (ymd) => ymd.split('-').reverse().join('.');
  /** Bir satırdaki siparişlerin yüklenme tarihi ve saati (hepsi aynıysa tek değer, değilse aralık) */
  function uploadedAt(list) {
    const ats = list.map((o) => o.at).filter(Boolean).sort();
    if (!ats.length) return ['', ''];
    const d1 = localYmd(ats[0]), d2 = localYmd(ats[ats.length - 1]);
    const t1 = hhmm(ats[0]), t2 = hhmm(ats[ats.length - 1]);
    return [d1 === d2 ? trD(d1) : `${trD(d1)} – ${trD(d2)}`, d1 === d2 && t1 === t2 ? t1 : `${t1} – ${t2}`];
  }
  /** Teslim listesi: TARİH · SAAT · MAĞAZA · KOMBİNASYON · SİPARİŞ ADEDİ · TESLİM ALAN (ilk satır başlık, yapıştırmaya hazır) */
  async function xlsLog() {
    const ExcelJS = await excelLib();
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Teslim Listesi', { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = [{ width: 14 }, { width: 14 }, { width: 26 }, { width: 60 }, { width: 16 }, { width: 22 }];
    const head = ws.getRow(1);
    head.values = ['TARİH', 'SAAT', 'MAĞAZA', 'KOMBİNASYON', 'SİPARİŞ ADEDİ', 'TESLİM ALAN'];
    head.font = { bold: true };
    let r = 2;
    // Birden fazla kişiye gitmiş kombinasyon: her kişi ayrı satır, tek isim (açılır listeye uygun)
    for (const l of splitByName(teslimLines())) {
      const [d, t] = uploadedAt(l.refs);
      ws.getRow(r++).values = [d, t, l.store, l.label, l.orders, l.name];
    }
    await excelSave(wb, `teslim-listesi_${fileStamp()}.xlsx`);
  }
  /** Sipariş bazında: her sipariş bir satır, numaraları ve teslim alanıyla */
  async function xlsOrders() {
    const ExcelJS = await excelLib();
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Sipariş Bazında', { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = [{ width: 13 }, { width: 9 }, { width: 24 }, { width: 22 }, { width: 18 }, { width: 18 }, { width: 40 }, { width: 56 }, { width: 22 }];
    const head = ws.getRow(1);
    head.values = ['TARİH', 'SAAT', 'MAĞAZA', 'SİPARİŞ / BARKOD NO', 'PTT BARKOD', 'PLATFORM SİPARİŞ NO', 'KOMBİNASYON', 'İÇERİK', 'TESLİM ALAN'];
    // İÇERİK: siparişin kendi ürünleri ve adetleri (karma satırlarında da gerçek içerik görünsün)
    const byK = new Map(computedAll.map((c) => [c.order.k, c]));
    const icerik = (o) => { const c = byK.get(o.k) || computeOrder(o, state.ctx); return comboOf(c, state.ctx).label; };
    head.font = { bold: true };
    let r = 2;
    for (const l of teslimLines()) {
      for (const o of l.refs.slice().sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')) || String(a.no).localeCompare(String(b.no)))) {
        const [d, t] = uploadedAt([o]);
        const a = assigns[o.k];
        // Uzun numaralar metin olarak yazılır (Excel 734… gibi 16 haneli sayıları bozmasın)
        ws.getRow(r++).values = [d, t, l.store, String(o.no || ''), String(o.cargoCode || ''), String(o.platformOrderNo || ''), l.label, icerik(o), a ? a.n : ''];
      }
    }
    ws.getColumn(4).numFmt = '@'; ws.getColumn(5).numFmt = '@'; ws.getColumn(6).numFmt = '@';
    await excelSave(wb, `siparis-bazinda_${fileStamp()}.xlsx`);
  }
  /** Çıktıdaki gibi: mağaza mağaza, yazdırma ayarlarındaki sütunlar ve boş sütunlar */
  async function xlsPrintLike() {
    const p = printPref();
    const ExcelJS = await excelLib();
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Kombinasyon Listesi');
    const cols = [...p.cols.map((k) => ({ k, label: PCOLS.find((c) => c[0] === k)[1], width: k === 'products' ? 60 : 16 })), ...p.extra.map((x) => ({ k: 'x', label: x.label, width: 10 + XW[x.w][1] * 1.5 }))];
    ws.columns = cols.map((c) => ({ width: c.width }));
    const thin = { style: 'thin', color: { argb: 'FF888888' } };
    const box = { top: thin, left: thin, bottom: thin, right: thin };
    const grey = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEEEEE' } };
    let r = 1;
    ws.mergeCells(r, 1, r, cols.length);
    ws.getCell(r, 1).value = 'Kombinasyon Listesi'; ws.getCell(r, 1).font = { bold: true, size: 14 }; r++;
    ws.mergeCells(r, 1, r, cols.length);
    ws.getCell(r, 1).value = `${rangeLabel(from, to)}${batchIds.length || tFrom || tTo ? ' · seçili yüklemeler' : ''} · ${min} siparişten az olan bileşimler “${KARMA}” satırında`; r += 2;
    for (const sc of printSections()) {
      ws.mergeCells(r, 1, r, cols.length);
      ws.getCell(r, 1).value = `${sc.name} — ${n(sc.R.orders)} sipariş`; ws.getCell(r, 1).font = { bold: true, size: 13 }; r++;
      const hr = ws.getRow(r++);
      cols.forEach((c, i) => { const cell = hr.getCell(i + 1); cell.value = c.label; cell.font = { bold: true }; cell.fill = grey; cell.border = box; cell.alignment = { wrapText: true }; });
      const put = (label, orders, units, karma) => {
        const row = ws.getRow(r++);
        cols.forEach((c, i) => {
          const cell = row.getCell(i + 1);
          cell.value = c.k === 'products' ? label : c.k === 'orders' ? orders : c.k === 'units' ? units : '';
          cell.border = box; cell.alignment = { wrapText: true };
          if (karma) { cell.font = { bold: true }; cell.fill = grey; }
        });
      };
      for (const g of sc.R.groups) put(g.label, g.orders, g.units * g.orders, false);
      for (const x of karmaParts(sc.R.karma)) put(x.label, x.orders, x.units, true);
      r++;
    }
    await excelSave(wb, `kombinasyon-listesi_${fileStamp()}.xlsx`);
  }

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
