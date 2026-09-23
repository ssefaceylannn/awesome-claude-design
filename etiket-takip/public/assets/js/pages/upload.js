// Etiket yükleme: PDF oku → önizle (mükerrer / devam / eşleşme / kampanya) → kaydet.
import { html, mount, icon, toast, n, trDate, trDateTime, today, confirmDialog, busy, emptyState, storeTag, rangeLabel } from '../core/ui.js';
import { api, state, isAdmin, invalidateOrders, setRange } from '../core/api.js';
import { readLabels } from '../core/labels.js';
import { computeOrder } from '../shared/calc.js';
import { storeForm } from './stores.js';
import { refreshBadges } from '../app.js';

const ST = {
  new: html`<span class="badge ok">Yeni</span>`,
  dup: html`<span class="badge warn">Mükerrer</span>`,
  merge: html`<span class="badge info">Devam etiketi</span>`,
  error: html`<span class="badge err">Hata</span>`,
};

export default async function uploadPage(ctx) {
  const admin = isAdmin();
  let pending = null; // { read, results }
  let dateMode = sessionStorage.getItem('et-datemode') || 'file';
  let manualDate = today();
  let statusFilter = 'all';

  mount(ctx.el, html`<div class="stack">
    <div class="card"><div class="card-b stack">
      <label class="drop" id="drop">
        <input type="file" id="file" accept="application/pdf,.pdf" multiple hidden>
        <div class="ic">${icon('upload')}</div>
        <b>Etiket PDF'lerini buraya sürükleyin</b>
        <div class="muted">veya tıklayıp seçin · birden fazla dosya ve mağaza aynı anda yüklenebilir</div>
      </label>
      <div class="row wrap bottom">
        <label class="f">Sipariş tarihi<select class="input" id="dateMode" style="width:auto">
          <option value="file">Dosya adındaki tarih (yoksa bugün)</option><option value="today">Bugün</option><option value="manual">Seçeceğim tarih</option></select></label>
        <label class="f" id="mdWrap"><span>Tarih</span><input type="date" class="input" id="md" value="${manualDate}"></label>
        <span class="spacer"></span>
        <span class="muted small">PDF'ler bu bilgisayarda okunur; sunucuya yalnızca sipariş bilgileri gönderilir.</span>
      </div>
      <div id="prog" class="hidden"><div class="row small" style="margin-bottom:6px"><span id="progText">Okunuyor…</span></div><div class="progress"><i id="progBar" style="width:0"></i></div></div>
    </div></div>
    <div id="preview"></div>
    <div class="card"><div class="card-h"><h2>Yükleme geçmişi</h2><span class="sub">Kim, ne zaman, hangi dosyaları yükledi</span></div><div class="card-b flush" id="history">${html`<div class="loading"><div class="spin"></div></div>`}</div></div>
  </div>`);

  const $ = (s) => ctx.el.querySelector(s);
  $('#dateMode').value = dateMode;
  const syncDate = () => { $('#mdWrap').classList.toggle('hidden', dateMode !== 'manual'); };
  syncDate();
  $('#dateMode').addEventListener('change', (e) => { dateMode = e.target.value; sessionStorage.setItem('et-datemode', dateMode); syncDate(); });
  $('#md').addEventListener('change', (e) => { manualDate = e.target.value || today(); });
  const drop = $('#drop');
  $('#file').addEventListener('change', (e) => { handle([...e.target.files]); e.target.value = ''; });
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => handle([...e.dataTransfer.files]));

  async function handle(files) {
    if (!files || !files.length) return;
    const prog = $('#prog');
    prog.classList.remove('hidden');
    try {
      const md = dateMode === 'manual' ? manualDate : dateMode === 'today' ? today() : '';
      const read = await readLabels(files, {
        manualDate: md,
        onProgress: (d, t) => { $('#progText').textContent = `${d}/${t} dosya okundu`; $('#progBar').style.width = `${(d / t) * 100}%`; },
      });
      if (!read.files.length) throw new Error('PDF dosyası seçilmedi');
      $('#progText').textContent = 'Kayıtlarla karşılaştırılıyor…';
      const { results } = await api.post('import', { orders: read.orders, dryRun: true });
      pending = { read, results };
      statusFilter = 'all';
      renderPreview();
    } catch (e) {
      toast(e.message, 'err');
    } finally {
      prog.classList.add('hidden');
      $('#progBar').style.width = '0';
    }
  }

  function renderPreview() {
    const el = $('#preview');
    if (!pending) return mount(el, '');
    const { read, results } = pending;
    const rows = results.map((r) => ({ r, o: read.orders[r.i], c: computeOrder({ ...read.orders[r.i], k: String(r.i) }, state.ctx) }));
    const newRows = rows.filter((x) => x.r.status === 'new');
    const count = (s) => rows.filter((x) => x.r.status === s).length;
    const units = newRows.reduce((s, x) => s + x.c.lines.reduce((a, l) => a + (l.ignored ? 0 : l.units), 0), 0);
    const extra = newRows.reduce((s, x) => s + x.c.rewards.reduce((a, r) => a + r.qty, 0), 0);
    const campOrders = newRows.filter((x) => x.c.rewards.length).length;
    const unknown = new Map();
    const unmatched = new Map();
    for (const x of rows) {
      if (x.r.status !== 'new' && x.r.status !== 'merge') continue;
      if (!x.c.store && x.o.sender) unknown.set(x.o.sender, (unknown.get(x.o.sender) || 0) + 1);
      for (const l of x.c.lines) if (!l.productId && !l.ignored) unmatched.set(l.raw, (unmatched.get(l.raw) || 0) + l.units);
    }
    const dates = [...new Set(newRows.map((x) => x.o.date))].sort();
    const list = rows.filter((x) => statusFilter === 'all' || x.r.status === statusFilter);
    const pname = (id) => (state.ctx.productsById.get(id) || {}).name;
    const canSave = newRows.length || count('merge');

    mount(el, html`<div class="card">
      <div class="card-h"><h2>Önizleme</h2><span class="sub">${read.files.length} dosya · ${read.pages} etiket sayfası · ${dates.length ? rangeLabel(dates[0], dates[dates.length - 1]) : ''}</span>
        <span class="spacer"></span>
        <button class="btn" id="cancel">Vazgeç</button>
        <button class="btn primary" id="save" ${canSave && state.me.role !== 'izleyici' ? '' : 'disabled'}>${icon('check')}Kaydet · ${n(newRows.length)} yeni sipariş</button></div>
      <div class="card-b stack">
        <div class="kpis">
          <div class="kpi hl"><div class="l">Yeni sipariş</div><div class="v">${n(newRows.length)}</div><div class="s">${n(units)} ürün adedi</div></div>
          <div class="kpi"><div class="l">Kampanyalı sipariş</div><div class="v">${n(campOrders)}</div><div class="s">+${n(extra)} ürün eklenecek</div></div>
          <div class="kpi"><div class="l">Toplam gönderilecek</div><div class="v">${n(units + extra)}</div><div class="s">etiket + kampanya</div></div>
          <div class="kpi"><div class="l">Mükerrer (sayılmaz)</div><div class="v">${n(count('dup'))}</div><div class="s">daha önce yüklenmiş</div></div>
          <div class="kpi"><div class="l">Devam etiketi</div><div class="v">${n(count('merge') + newRows.filter((x) => x.o.pages > 1).length)}</div><div class="s">önceki etikete eklendi</div></div>
        </div>
        ${unknown.size ? html`<div class="callout warn">${icon('store')}<div class="c"><b>${unknown.size} gönderici hiçbir mağazaya bağlı değil</b>
          Bu siparişler “Tanımsız” mağaza olarak kaydedilir ve mağazaya özel kampanyalar uygulanmaz. Mağazayı sonradan tanımlarsanız raporlar otomatik düzelir.
          <div class="row wrap" style="margin-top:8px">${[...unknown].map(([s, c]) => html`<span class="chip static"><b>${s}</b>&nbsp;· ${c} sipariş</span>${admin ? html`<button class="btn sm" data-addstore="${s}">${icon('plus')}Mağaza olarak ekle</button>` : ''}`)}</div></div></div>` : ''}
        ${unmatched.size ? html`<div class="callout warn">${icon('link')}<div class="c"><b>${unmatched.size} ürün adı katalogla eşleşmedi</b>
          Kaydedebilirsiniz; <a href="#/matching">Ürün Eşleştirme</a> sayfasında atadığınızda üretim listesi otomatik güncellenir.
          <div class="row wrap" style="margin-top:8px;gap:6px">${[...unmatched].slice(0, 12).map(([nm, q]) => html`<span class="chip static">${nm} · ${q}</span>`)}${unmatched.size > 12 ? html`<span class="muted small">+${unmatched.size - 12} daha</span>` : ''}</div></div></div>` : ''}
        ${read.log.length ? html`<details><summary class="small muted" style="cursor:pointer">Okuma günlüğü (${read.log.length})</summary><div class="stack small" style="gap:4px;margin-top:8px">${read.log.map((l) => html`<div class="${l.type === 'error' || l.type === 'warn' ? 'unm' : 'muted'}">• ${l.msg}</div>`)}</div></details>` : ''}
      </div>
      <div class="tabs">${[['all', 'Tümü', rows.length], ['new', 'Yeni', newRows.length], ['dup', 'Mükerrer', count('dup')], ['merge', 'Devam', count('merge')], ['error', 'Hatalı', count('error')]].filter(([k, , c]) => k === 'all' || c).map(([k, l, c]) => html`<button data-sf="${k}" class="${statusFilter === k ? 'on' : ''}">${l} <span class="muted">${c}</span></button>`)}</div>
      <div class="tw" style="max-height:560px"><table class="t"><thead><tr><th>Durum</th><th>Tarih</th><th>Sipariş no</th><th>Mağaza</th><th>Etiketteki ürün → katalog</th><th>Kampanya</th><th>Not</th></tr></thead><tbody>
      ${list.map(({ r, o, c }) => html`<tr>
        <td>${ST[r.status]}</td><td class="nowrap">${trDate(o.date)}</td>
        <td class="nowrap"><b>${o.orderNo || '—'}</b>${o.pages > 1 ? html` <span class="badge info">${o.pages} etiket</span>` : ''}</td>
        <td>${storeTag(c.store, o.sender)}</td>
        <td class="lines small">${c.lines.map((l) => html`<div><span class="q">${l.qty}x</span> ${l.raw} ${l.ignored ? html`<span class="muted">(yoksayılır)</span>` : l.productId ? html`<span class="muted">→</span> <b>${pname(l.productId)}</b>${l.mult > 1 ? html` <span class="badge info">×${l.mult}</span>` : ''}` : html`<span class="badge err">eşleşmedi</span>`}</div>`)}</td>
        <td class="small">${c.rewards.length ? c.rewards.map((rw) => html`<div class="gift">+${rw.qty} ${pname(rw.productId)}</div>`) : html`<span class="muted">—</span>`}</td>
        <td class="small muted">${r.note || (o.warnings || []).join(', ')}</td>
      </tr>`)}
      </tbody></table></div>
    </div>`);

    el.querySelector('#cancel').addEventListener('click', () => { pending = null; renderPreview(); });
    el.querySelector('#save').addEventListener('click', save);
    el.querySelectorAll('[data-sf]').forEach((b) => b.addEventListener('click', () => { statusFilter = b.dataset.sf; renderPreview(); }));
    el.querySelectorAll('[data-addstore]').forEach((b) => b.addEventListener('click', async () => { if (await storeForm(null, { presetSender: b.dataset.addstore })) renderPreview(); }));
  }

  async function save() {
    const btn = $('#save');
    busy(btn, true, 'Kaydediliyor…');
    try {
      const { read } = pending;
      const r = await api.post('import', { orders: read.orders, files: read.files, pages: read.pages });
      invalidateOrders();
      const dates = [...new Set(r.results.filter((x) => x.status === 'new').map((x) => read.orders[x.i].date))].sort();
      pending = null;
      mount($('#preview'), html`<div class="callout ok">${icon('check')}<div class="c"><b>${n(r.counts.new)} yeni sipariş kaydedildi</b>
        ${n(r.counts.dup)} mükerrer etiket hesaba katılmadı${r.counts.merge ? `, ${n(r.counts.merge)} devam etiketi mevcut siparişlere eklendi` : ''}.
        <div class="row wrap" style="margin-top:10px">${dates.length ? html`<button class="btn primary sm" id="goProd">${icon('factory')}Üretim listesini aç</button>` : ''}<button class="btn sm" id="again">Yeni yükleme</button></div></div></div>`);
      const gp = $('#goProd');
      if (gp) gp.addEventListener('click', () => { setRange(dates[0], dates[dates.length - 1]); ctx.navigate('production'); });
      $('#again').addEventListener('click', () => mount($('#preview'), ''));
      toast('Kayıt tamamlandı', 'ok');
      loadHistory();
      refreshBadges();
    } catch (e) {
      toast(e.message, 'err');
      busy(btn, false);
    }
  }

  async function loadHistory() {
    try {
      const { batches } = await api.get('batches?limit=40');
      mount($('#history'), batches.length ? html`<div class="tw"><table class="t"><thead><tr><th>Zaman</th><th>Kullanıcı</th><th>Dosyalar</th><th>Sipariş tarihi</th><th class="num">Yeni</th><th class="num">Mükerrer</th><th class="num">Devam</th><th class="num">Adet</th><th></th></tr></thead><tbody>
        ${batches.map((b) => html`<tr><td class="nowrap">${trDateTime(b.at)}</td><td>${b.by}</td>
          <td class="small">${b.files.slice(0, 3).map((f) => html`<div>${f}</div>`)}${b.files.length > 3 ? html`<div class="muted">+${b.files.length - 3} dosya</div>` : ''}</td>
          <td class="small nowrap">${b.dates.length ? rangeLabel(b.dates[0], b.dates[b.dates.length - 1]) : '—'}</td>
          <td class="num"><b>${n(b.counts.new)}</b></td><td class="num">${n(b.counts.dup)}</td><td class="num">${n(b.counts.merge)}</td><td class="num">${n(b.units)}</td>
          <td class="num nowrap">${b.dates.length ? html`<button class="btn sm ghost" data-open="${b.dates[0]}|${b.dates[b.dates.length - 1]}">Rapor</button>` : ''}${admin && b.orderCount ? html`<button class="btn sm ghost icon danger" data-undo="${b.id}" data-n="${b.orderCount}" title="Bu yüklemeyi geri al">${icon('trash')}</button>` : ''}</td></tr>`)}
        </tbody></table></div>` : emptyState('history', 'Henüz yükleme yapılmadı', ''));
    } catch (e) { mount($('#history'), html`<div class="card-b unm">${e.message}</div>`); }
  }
  $('#history').addEventListener('click', async (e) => {
    const o = e.target.closest('[data-open]');
    if (o) { const [f, t] = o.dataset.open.split('|'); setRange(f, t); return ctx.navigate('production'); }
    const u = e.target.closest('[data-undo]');
    if (u) {
      if (!(await confirmDialog(`Bu yüklemedeki ${u.dataset.n} sipariş silinsin mi? Bu işlem geri alınamaz. (Önceki siparişlere eklenmiş devam etiketleri geri alınmaz.)`, { danger: true, ok: 'Yüklemeyi sil' }))) return;
      try {
        const r = await api.del('batch?id=' + encodeURIComponent(u.dataset.undo));
        invalidateOrders();
        toast(`${r.removed} sipariş silindi`);
        loadHistory();
      } catch (err) { toast(err.message, 'err'); }
    }
  });
  loadHistory();
}
