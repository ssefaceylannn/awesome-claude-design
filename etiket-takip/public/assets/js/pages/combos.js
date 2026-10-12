// Kombinasyon analizi: yüklenen siparişlerde aynı ürün + adet bileşimleri (≥ eşik ayrı satır,
// kalanlar "Karma Siparişler"). Mağaza, tarih, yükleme ve yükleme saati ile süzülür.
// İkinci sekme: Trendyol "Gönderime Hazır" sayfasından kopyalanan grup metnini okur.
import { html, mount, icon, n, toast, busy, emptyState, rangeLabel, multiSelect, trDateTime, personName } from '../core/ui.js';
import { api, state, fetchOrders, getRange } from '../core/api.js';
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

  mount(ctx.actions, html`<button class="btn primary" id="xls">${icon('sheet')}Excel indir</button>`);
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
  $('#tFrom').addEventListener('change', (e) => { tFrom = e.target.value; compute(); });
  $('#tTo').addEventListener('change', (e) => { tTo = e.target.value; compute(); });
  $('#min').addEventListener('change', (e) => { min = Math.max(1, Math.min(999, parseInt(e.target.value, 10) || 10)); e.target.value = min; savePref({ min }); compute(); renderPaste(); });
  $('#rw').addEventListener('change', (e) => { includeRewards = e.target.checked; savePref({ rewards: includeRewards }); compute(); });

  // Seçili tarihlerdeki yüklemeler (saatleriyle) — yeniden çizilebilsin diye her seferinde yeni kap
  function drawBatches() {
    const host = $('#fBatch');
    host.innerHTML = '';
    const el = document.createElement('div');
    host.appendChild(el);
    const ids = new Set(orders.map((o) => o.batch).filter(Boolean));
    const list = batches.filter((b) => ids.has(b.id)).sort((a, b) => a.at.localeCompare(b.at));
    multiSelect(el, {
      options: list.map((b) => ({ id: b.id, label: `${trDateTime(b.at)} · ${personName(b.by)} · ${n(orders.filter((o) => o.batch === b.id).length)} sipariş`, group: (b.files || []).slice(0, 2).join(', ') || undefined })),
      selected: batchIds,
      allLabel: list.length ? `Tüm yüklemeler (${list.length})` : 'Yükleme yok',
      onChange: (v) => { batchIds = v; compute(); },
    });
  }

  async function load() {
    mount($('#body'), html`<div class="loading"><div class="spin"></div><span>Siparişler okunuyor…</span></div>`);
    try {
      const [o, b] = await Promise.all([fetchOrders(from, to), api.get('batches?limit=100').catch(() => ({ batches: [] }))]);
      if (!ctx.isCurrent()) return;
      orders = o.filter((x) => !x.summary);
      batches = b.batches || [];
      drawBatches();
      compute();
    } catch (e) { mount($('#body'), html`<div class="callout err">${icon('alert')}<div class="c">${e.message}</div></div>`); }
  }

  function selected() {
    return orders.filter((o) => {
      if (batchIds.length && !batchIds.includes(o.batch)) return false;
      if (tFrom || tTo) { const t = hhmm(o.at); if (!t || (tFrom && t < tFrom) || (tTo && t > tTo)) return false; }
      return true;
    });
  }

  function compute() {
    if (tab === 'auto') ctx.setSub(`${rangeLabel(from, to)} · ${filterLabel(filter)}`);
    const computed = [];
    for (const o of selected()) {
      const c = computeOrder(o, state.ctx);
      if (filter.storeIds.length && !(c.store && filter.storeIds.includes(c.store.id))) continue;
      if (filter.platforms.length && !filter.platforms.includes(c.platform)) continue;
      computed.push(c);
    }
    result = analyzeCombos(computed, state.ctx, { min, includeRewards });
    render();
  }

  function render() {
    const R = result;
    if (!R) return;
    if (!R.orders) return mount($('#body'), html`<div class="card">${emptyState('box', 'Sipariş yok', 'Tarih, mağaza veya yükleme seçimini değiştirin.')}</div>`);
    const inGroups = R.groups.reduce((s, g) => s + g.orders, 0);
    const unm = R.groups.concat(R.karma.groups).some((g) => g.parts.some((p) => p.id.startsWith('?')));
    mount($('#body'), html`<div class="stack">
      <div class="kpis">
        <div class="kpi"><div class="l">${icon('receipt')}Sipariş</div><div class="v">${n(R.orders)}</div><div class="s">${n(R.groups.length + R.karma.groups.length)} farklı bileşim</div></div>
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
  function renderPaste() {
    const text = $('#ptxt').value;
    if (!text.trim()) { pasted = null; return mount($('#pbody'), ''); }
    pasted = parseComboPaste(text);
    const { cards, unrecognized } = pasted;
    if (!cards.length) return mount($('#pbody'), html`<div class="callout warn">${icon('alert')}<div class="c"><b>Ayrıştırılabilir veri bulunamadı</b>Metni kontrol edin: “Ürün x2” satırları ve ardından “N sipariş” olmalı.</div></div>`);
    const rows = cards.filter((c) => !c.karma).sort((a, b) => b.total - a.total);
    const karma = cards.filter((c) => c.karma);
    const total = cards.reduce((s, c) => s + c.total, 0);
    mount($('#pbody'), html`<div class="stack">
      <div class="kpis"><div class="kpi"><div class="l">Toplam sipariş</div><div class="v">${n(total)}</div></div><div class="kpi"><div class="l">Farklı grup</div><div class="v">${n(cards.length)}</div></div></div>
      <div class="card"><div class="tw"><table class="t"><thead><tr><th>Ürün(ler)</th><th class="num">Sipariş sayısı</th></tr></thead><tbody>
        ${rows.map((c) => html`<tr><td>${c.combo}</td><td class="num big">${n(c.total)}</td></tr>`)}
        ${karma.map((c) => html`<tr style="background:var(--surface-2)"><td><b>${KARMA}</b></td><td class="num big">${n(c.total)}</td></tr>`)}
      </tbody></table></div></div>
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

  showTab();
  load();
}
