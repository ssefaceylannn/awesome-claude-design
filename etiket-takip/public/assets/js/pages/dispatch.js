// Günlük Dağıtım: OMS'den indirilen bütün etiket PDF'leri tek seferde atılır →
//   1. Seçilen ildeki (varsayılan Düzce) siparişler bütün dosyalardan en başta ayrılır → tek "PTT" paketi
//   2. Her kombinasyon PDF'i bir paket; karma PDF'leri ayıklama kuralına göre Sadece Şişe / Kutulu (/ Şişesiz)
//   3. Her pakete numara (P1, P2…) ve isteğe bağlı kapak sayfası (içerik, teslim alan, imza alanı)
//   4. Kaydet: siparişler siteye kaydedilir (mükerrerler sayılmaz) + hangi paket kime verildi kaydedilir
// KURAL: barkod PDF'inde yalnızca orijinal sayfalar vardır — aynen kopyalanır, yalnızca sıraları değişir, indirmeden
// önce kaynakla tek tek karşılaştırılır (core/pdfsplit.js). Kapak sayfaları barkod PDF'ine KONMAZ, ayrı dosyadır.
import { html, mount, icon, n, toast, busy, download, loadScript, today, trDate, trDateTime, personName, emptyState, confirmDialog } from '../core/ui.js';
import { buildPdf } from '../core/pdfsplit.js';
import { api, state, invalidateOrders } from '../core/api.js';
import { readLabels } from '../core/labels.js';
import { computeOrder } from '../shared/calc.js';
import { comboOf, analyzeCombos } from '../shared/combos.js';
import { classifyOrder, classifyCity } from '../shared/karma.js';
import { karmaPref } from '../core/karmapref.js';
import { refreshBadges } from '../app.js';


export default async function dispatchPage(ctx) {
  const rule = karmaPref();
  let read = null; // readLabels sonucu
  let packets = []; // { no, kind, label, store, pages:[pageIdx], orders:[row], assignee }
  let dry = null; // { new, dup, merge, error } kayıt öncesi kontrol
  let savedId = null; // kaydedildiyse dağıtım kaydı
  let savedSig = ''; // kaydedilen teslim alanlar (sonradan değişirse dağıtım kaydı yenilenir)
  const sig = () => packets.map((p) => p.assignee).join('|');
  let names = [];

  ctx.setSub('Bütün etiket PDF\'lerini tek seferde atın: Düzce ayrılır, karma bölünür, her paket numaralanır ve kime verildiği kaydedilir');
  mount(ctx.el, html`<div class="stack">
    <div class="card"><div class="card-b stack">
      <label class="drop" id="drop">
        <input type="file" id="file" accept="application/pdf,.pdf" multiple hidden>
        <div class="ic">${icon('upload')}</div>
        <b>OMS'den indirilen bütün etiket PDF'lerini buraya sürükleyin</b>
        <div class="muted">kombinasyon PDF'leri ve karma PDF'leri birlikte · ${rule.cities.join(', ') || 'seçilen il'} siparişleri bütün dosyalardan ayrı pakete alınır · barkod sayfaları değişmez</div>
      </label>
      <div id="prog" class="hidden"><div class="row small" style="margin-bottom:6px"><span id="progText">Okunuyor…</span></div><div class="progress"><i id="progBar" style="width:0"></i></div></div>
    </div></div>
    <div id="out"></div>
    <div class="grid g-main" style="align-items:start">
      <div class="card"><div class="card-h"><h2>Sipariş kimde?</h2><span class="sub">Sipariş ya da kargo numarasıyla: hangi pakette, kime verilmiş</span></div>
        <div class="card-b stack"><div class="row" style="gap:8px"><input class="input" id="q" placeholder="Sipariş no / barkod (en az 6 hane)" inputmode="numeric" style="flex:1"><button class="btn" id="qBtn">${icon('search')}Ara</button></div><div id="qOut"></div></div></div>
      <div class="card"><div class="card-h"><h2>Bugünkü dağıtımlar</h2><span class="sub">${trDate(today())}</span></div><div id="hist"><div class="loading"><div class="spin"></div></div></div></div>
    </div>
  </div>`);
  const $ = (s) => ctx.el.querySelector(s);

  // ------------------------------------------------------------- geçmiş ve arama
  async function loadHistory() {
    try {
      const [{ list }, f] = await Promise.all([api.get('dispatch?date=' + today()), api.get('dispatch?no=')]);
      names = f.names || [];
      fillNames();
      if (!ctx.isCurrent()) return;
      mount($('#hist'), list.length ? html`<div class="tw"><table class="t"><tbody>${list.slice().reverse().map((r) => html`
        <tr><td class="nowrap small">${trDateTime(r.at).slice(11)}<div class="muted xs">${personName(r.by)}</div></td>
          <td class="small">${r.packets.map((p) => html`<div><b>P${p.no}</b> ${p.label} <span class="muted">· ${n(p.orders.length)} sipariş</span> → <b>${p.assignee || '—'}</b></div>`)}</td></tr>`)}</tbody></table></div>`
        : emptyState('history', 'Bugün henüz dağıtım kaydedilmedi', ''));
    } catch (e) { mount($('#hist'), html`<div class="card-b unm">${e.message}</div>`); }
  }
  function fillNames() {
    let dl = document.getElementById('dispatchNames');
    if (!dl) { dl = document.createElement('datalist'); dl.id = 'dispatchNames'; ctx.el.appendChild(dl); }
    mount(dl, html`${['PTT', ...names.filter((x) => x !== 'PTT')].map((x) => html`<option value="${x}">`)}`);
  }
  async function search() {
    const q = $('#q').value.replace(/\s+/g, '');
    if (q.length < 6) return toast('En az 6 hane yazın', 'err');
    mount($('#qOut'), html`<div class="loading"><div class="spin"></div></div>`);
    try {
      const { hits } = await api.get('dispatch?no=' + encodeURIComponent(q));
      mount($('#qOut'), hits.length ? html`<div class="stack" style="gap:6px">${hits.map((h) => html`<div class="callout ok">${icon('check')}<div class="c"><b>P${h.no} · ${h.assignee || 'teslim alan yazılmamış'}</b>${h.label} · ${trDateTime(h.at)} · kaydeden ${personName(h.by)}</div></div>`)}</div>`
        : html`<div class="callout warn">${icon('alert')}<div class="c"><b>Bulunamadı</b>Son 90 günün dağıtımlarında bu numara yok.</div></div>`);
    } catch (e) { mount($('#qOut'), html`<div class="unm">${e.message}</div>`); }
  }
  $('#qBtn').addEventListener('click', search);
  $('#q').addEventListener('keydown', (e) => { if (e.key === 'Enter') search(); });

  // ------------------------------------------------------------- dosya
  const drop = $('#drop');
  $('#file').addEventListener('change', (e) => { handle([...e.target.files]); e.target.value = ''; });
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => handle([...e.dataTransfer.files]));

  // Sipariş tarihi Etiket Yükle'deki seçimi izler (varsayılan bugün; "dosya adındaki tarih" seçiliyse o)
  const dateMode = () => { try { return localStorage.getItem('et-datemode') || 'today'; } catch { return 'today'; } };

  async function handle(files) {
    const pdfs = files.filter((f) => /\.pdf$/i.test(f.name) || f.type === 'application/pdf');
    if (!pdfs.length) return toast('PDF dosyası seçin', 'err');
    $('#prog').classList.remove('hidden');
    try {
      const r = await readLabels(pdfs, { manualDate: dateMode() === 'file' ? undefined : today(), onProgress: (d, t) => { $('#progText').textContent = `Okunuyor… ${d}/${t} dosya`; $('#progBar').style.width = `${(d / t) * 100}%`; } });
      if (!r.pageList.length) throw new Error('PDF okunamadı' + (r.log[0] ? ': ' + r.log[0].msg : ''));
      read = r; savedId = null;
      build();
      $('#progText').textContent = 'Kayıtlarla karşılaştırılıyor…';
      dry = { new: 0, dup: 0, merge: 0, error: 0 };
      for (let k = 0; k < read.orders.length; k += 1000) {
        const x = await api.post('import', { orders: read.orders.slice(k, k + 1000), dryRun: true });
        for (const it of x.results) dry[it.status] = (dry[it.status] || 0) + 1;
      }
      render();
    } catch (e) { toast(e.message, 'err'); }
    $('#prog').classList.add('hidden');
  }

  /** Paketleri kur: önce il, sonra dosya dosya (kombinasyon → tek paket, karma → kurala göre gruplar) */
  function build() {
    const rows = read.orders.map((o) => {
      const c = computeOrder({ ...o, k: '_' }, state.ctx);
      const fi = read.pageList[o.pageNos[0] - 1].fileIndex;
      return { o, c, fi, city: classifyCity(o.city, rule), combo: comboOf(c, state.ctx) };
    });
    const byFile = read.fileList.map((f, fi) => {
      const list = rows.filter((r) => r.fi === fi);
      const combos = new Set(list.filter((r) => r.city.group !== 'in').map((r) => r.combo.key));
      return { f, fi, list, karma: /karma/i.test(f.name) || combos.size > 1 };
    });
    const out = [];
    const owner = new Array(read.pageList.length).fill(null); // sayfa → paket
    const storeOf = (list) => { const s = [...new Set(list.map((r) => (r.c.store ? r.c.store.name : r.o.sender)).filter(Boolean))]; return s.length === 1 ? s[0] : s.length ? `${s.length} mağaza` : ''; };
    const add = (kind, label, list, fi, extraPages = []) => {
      if (!list.length && !extraPages.length) return null;
      const p = { kind, label, store: storeOf(list), orders: list, pages: [], fi, assignee: kind === 'city' ? 'PTT' : '' };
      for (const r of list) for (const pg of r.o.pageNos) owner[pg - 1] = p;
      for (const pg of extraPages) owner[pg] = p;
      out.push(p);
      return p;
    };
    for (const F of byFile) {
      const rest = F.list.filter((r) => r.city.group !== 'in');
      // Bu dosyanın siparişe ait olmayan sayfaları (mükerrer/okunamayan) dosyanın kendi paketinde kalır
      const mine = new Set(F.list.flatMap((r) => r.o.pageNos.map((x) => x - 1)));
      const loose = read.pageList.map((pg, i) => (pg.fileIndex === F.fi && !mine.has(i) ? i : -1)).filter((i) => i >= 0);
      if (!F.karma) {
        add('combo', rest[0] ? rest[0].combo.label : F.f.name, rest, F.fi, loose);
        continue;
      }
      const g = { only: [], rest: [], none: [] };
      for (const r of rest) g[r.o.orphan ? 'rest' : classifyOrder(r.c, state.ctx, rule).group].push(r);
      add('only', `Karma – ${rule.names.only}`, g.only, F.fi);
      const pr = add('rest', `Karma – ${rule.names.rest}`, g.rest, F.fi, loose);
      if (!pr && loose.length) add('rest', `Karma – ${rule.names.rest}`, [], F.fi, loose);
      add('none', `Karma – ${rule.names.none}`, g.none, F.fi);
    }
    // İl paketi en sonda (PTT'ye ayrı verilir)
    add('city', `${rule.cities.join(', ') || 'Seçilen il'} (PTT)`, rows.filter((r) => r.city.group === 'in'), -1);
    for (let i = 0; i < owner.length; i++) if (owner[i]) owner[i].pages.push(i);
    // Önceki seçilen kişiler (aynı dosya + tür) korunur
    const prev = new Map(packets.map((p) => [`${p.kind}|${p.fi}`, p.assignee]));
    packets = out.map((p, i) => ({ ...p, no: i + 1, assignee: prev.get(`${p.kind}|${p.fi}`) || p.assignee }));
  }

  const KIND_BADGE = { combo: '', only: 'ok', rest: 'warn', none: 'info', city: 'err' };
  function render() {
    if (!read) return mount($('#out'), '');
    const total = packets.reduce((s, p) => s + p.pages.length, 0);
    const unmatched = packets.filter((p) => p.kind !== 'combo' && p.kind !== 'city').flatMap((p) => p.orders).filter((r) => r.c.lines.some((l) => !l.ignored && l.units && !l.productId));
    const nocity = packets.flatMap((p) => p.orders).filter((r) => r.city.kind === 'nocity');
    const warns = read.log.filter((l) => l.type === 'error' || l.type === 'warn');
    mount($('#out'), html`<div class="stack">
      <div class="kpis">
        <div class="kpi"><div class="l">${icon('file')}Okunan</div><div class="v">${n(read.orders.length)}</div><div class="s">sipariş · ${n(read.pageList.length)} sayfa · ${n(read.fileList.length)} dosya</div></div>
        <div class="kpi hl"><div class="l">${icon('box')}Paket</div><div class="v">${n(packets.length)}</div><div class="s">toplam ${n(total)} barkod sayfası</div></div>
        <div class="kpi"><div class="l">${icon('check')}Siteye kayıt</div><div class="v">${n(dry ? dry.new : 0)}</div><div class="s">yeni sipariş${dry && dry.dup ? ` · ${n(dry.dup)} daha önce kaydedilmiş (tekrar sayılmaz)` : ''}${dry && dry.merge ? ` · ${n(dry.merge)} devam` : ''}</div></div>
      </div>
      ${total !== read.pageList.length ? html`<div class="callout err">${icon('alert')}<div class="c"><b>Sayfa sayısı tutmuyor (${n(total)} / ${n(read.pageList.length)})</b>Lütfen bu PDF'leri bana iletin; bu durumda yazdırmayın.</div></div>` : ''}
      ${unmatched.length ? html`<div class="callout warn">${icon('alert')}<div class="c"><b>${n(unmatched.length)} karma siparişte tanınmayan ürün var — “${rule.names.rest}” paketinde bırakıldı</b><a href="#/matching">Ürün Eşleştirme</a>'den atayıp PDF'leri yeniden atabilirsiniz.</div></div>` : ''}
      ${nocity.length ? html`<div class="callout warn">${icon('alert')}<div class="c"><b>${n(nocity.length)} etikette il okunamadı</b>Bunlar kendi paketlerinde kaldı; ${rule.cities.join(', ')} olup olmadığını kontrol edin.</div></div>` : ''}
      ${warns.length ? html`<details class="card" style="padding:12px 16px"><summary class="small" style="cursor:pointer">Okuma notları (${warns.length})</summary><div class="small" style="margin-top:8px">${warns.map((l) => html`<div>${l.msg}</div>`)}</div></details>` : ''}
      <div class="card"><div class="card-h"><h2>Paketler</h2><span class="sub">Her paketi kimin aldığını yazın · isimler önceki dağıtımlardan önerilir</span></div>
        <div class="tw"><table class="t"><thead><tr><th>Paket</th><th>İçerik</th><th class="num">Sipariş</th><th class="num">Sayfa</th><th>Teslim alan</th><th></th></tr></thead><tbody>
          ${packets.map((p, i) => html`<tr>
            <td class="nowrap"><b style="font-size:1.25rem">P${p.no}</b></td>
            <td><span class="badge ${KIND_BADGE[p.kind]}">${p.kind === 'combo' ? 'Kombinasyon' : p.kind === 'city' ? 'PTT' : 'Karma'}</span> <b>${p.label}</b>${p.store ? html` <span class="muted small">· ${p.store}</span>` : ''}
              ${p.kind !== 'combo' ? html`<div class="muted xs">${summary(p).slice(0, 4).map((g) => `${g.label} (${g.orders})`).join(' · ')}${summary(p).length > 4 ? ` · +${summary(p).length - 4} bileşim` : ''}</div>` : html`<div class="muted xs">${read.fileList[p.fi].name}</div>`}</td>
            <td class="num big">${n(p.orders.length)}</td><td class="num">${n(p.pages.length)}</td>
            <td><input class="input sm" data-as="${i}" list="dispatchNames" value="${p.assignee}" placeholder="Ad Soyad" maxlength="60" style="width:170px"></td>
            <td class="nowrap"><button class="btn sm ghost" data-one="${i}" title="Yalnızca bu paketin PDF'i">${icon('download')}</button></td></tr>`)}
        </tbody></table></div>
        <div class="card-f row wrap" style="gap:8px">
          <span class="muted small">${savedId ? html`${icon('check')} Kaydedildi — paketler ve teslim alanlar kayıtlı.` : 'Kaydedince siparişler siteye eklenir ve hangi paketin kime verildiği kaydedilir.'}</span>
          <span class="spacer"></span>
          <button class="btn" id="list">${icon('printer')}Zimmet listesi (A4)</button>
          <button class="btn" id="covers" title="Her paket için bir kapak sayfası (paket no, içerik, teslim alan, imza) — barkod PDF'inden ayrı dosya">${icon('file')}Kapak sayfaları (ayrı PDF)</button>
          <button class="btn primary" id="go">${icon('download')}${savedId ? 'Barkod PDF\'ini tekrar indir' : 'Kaydet ve barkod PDF\'ini indir'}</button>
        </div></div>
    </div>`);
  }
  const sumCache = new WeakMap();
  function summary(p) {
    if (!sumCache.has(p)) { const R = analyzeCombos(p.orders.map((r) => r.c), state.ctx, { min: 1 }); sumCache.set(p, R.groups.map((g) => ({ label: g.label, orders: g.orders }))); }
    return sumCache.get(p);
  }

  $('#out').addEventListener('input', (e) => { const i = e.target.dataset.as; if (i != null) packets[+i].assignee = e.target.value.trim(); });
  $('#out').addEventListener('click', async (e) => {
    const one = e.target.closest('[data-one]');
    if (one) { busy(one, true, ''); try { await makePdf([packets[+one.dataset.one]]); } catch (err) { toast(err.message, 'err'); } busy(one, false); return; }
    if (e.target.closest('#list')) return printList();
    const cv = e.target.closest('#covers');
    if (cv) {
      busy(cv, true, 'Hazırlanıyor…');
      try { if (savedId && sig() !== savedSig) await saveDispatch(); await makeCovers(packets); } catch (err) { toast(err.message, 'err'); }
      busy(cv, false);
      return;
    }
    const go = e.target.closest('#go');
    if (!go) return;
    busy(go, true, 'Hazırlanıyor…');
    try {
      if (savedId && sig() !== savedSig) await saveDispatch(); // yalnızca teslim alan düzeltildi
      if (!savedId) {
        const empty = packets.filter((p) => !p.assignee);
        if (empty.length && !(await confirmDialog(`${empty.map((p) => 'P' + p.no).join(', ')} için teslim alan yazılmadı. Yine de kaydedilsin mi?`, { title: 'Teslim alan eksik', ok: 'Kaydet' }))) throw new Error('Vazgeçildi');
        await saveAll(go);
      }
      await makePdf(packets);
    } catch (err) { if (err.message !== 'Vazgeçildi') toast(err.message, 'err'); }
    busy(go, false);
    render();
  });

  async function saveAll(btn) {
    // 1) Siparişler (mükerrerler sunucuda ayıklanır, tekrar sayılmaz)
    let batchId = null;
    const counts = { new: 0, dup: 0 };
    for (let k = 0; k < read.orders.length; k += 400) {
      btn.lastChild.textContent = `Kaydediliyor… ${Math.min(k + 400, read.orders.length)}/${read.orders.length}`;
      const part = await api.post('import', { orders: read.orders.slice(k, k + 400), files: read.files, pages: read.pages, batchId });
      batchId = part.batchId;
      counts.new += part.counts.new || 0; counts.dup += part.counts.dup || 0;
    }
    invalidateOrders();
    await saveDispatch();
    toast(`${n(counts.new)} yeni sipariş kaydedildi${counts.dup ? `, ${n(counts.dup)} mükerrer sayılmadı` : ''} · dağıtım kaydedildi`, 'ok');
    refreshBadges && refreshBadges();
  }
  // Dağıtım kaydı (teslim alan düzeltilince yeniden kaydedilir; aramada en yenisi önce görünür)
  async function saveDispatch() {
    const r = await api.post('dispatch', { date: today(), files: read.files, packets: packets.map((p) => ({ no: p.no, label: `${p.label}${p.store ? ' · ' + p.store : ''}`, kind: p.kind, assignee: p.assignee, pages: p.pages.length, orders: p.orders.map((x) => x.o.orderNo).filter(Boolean) })) });
    if (savedId) toast('Teslim alan düzeltmesi kaydedildi', 'ok');
    savedId = r.id; savedSig = sig();
    loadHistory();
  }

  // ------------------------------------------------------------- PDF
  const stamp = () => today().split('-').reverse().join('.');
  /** Barkod PDF'i: yalnızca orijinal sayfalar, paket sırasıyla (içerik değişmez, indirmeden önce doğrulanır) */
  async function makePdf(list) {
    const refs = list.flatMap((p) => p.pages.map((i) => read.pageList[i]));
    const bytes = await buildPdf(read.fileList, refs);
    const name = list.length === 1 ? `P${list[0].no} - ${asciiName(list[0].label)} - ${stamp()}.pdf` : `Dagitim - ${stamp()} - ${list.length} paket.pdf`;
    download(name, new Blob([bytes], { type: 'application/pdf' }));
    toast(`${name} indirildi — ${n(refs.length)} sayfa, hepsi kaynakla birebir aynı`, 'ok');
  }
  /** Kapak sayfaları: ayrı, yeni bir PDF (barkod PDF'ine eklenmez). Boyut paketin ilk etiketiyle aynı. */
  async function makeCovers(list) {
    await loadScript('/assets/vendor/pdf-lib.min.js');
    const { PDFDocument } = window.PDFLib;
    const out = await PDFDocument.create();
    const srcs = new Map();
    const src = async (fi) => { if (!srcs.has(fi)) srcs.set(fi, await PDFDocument.load(await read.fileList[fi].arrayBuffer(), { ignoreEncryption: true })); return srcs.get(fi); };
    const at = new Date().toISOString();
    for (const p of list) {
      const first = read.pageList[p.pages[0]];
      const fp = (await src(first.fileIndex)).getPage(first.filePage - 1).getSize();
      const img = await out.embedPng(await coverPng(p, fp.width, fp.height, at));
      out.addPage([fp.width, fp.height]).drawImage(img, { x: 0, y: 0, width: fp.width, height: fp.height });
    }
    download(`Kapaklar - ${stamp()} - ${list.length} paket.pdf`, new Blob([await out.save()], { type: 'application/pdf' }));
  }
  const asciiName = (s) => { const tr = { ç: 'c', Ç: 'C', ğ: 'g', Ğ: 'G', ı: 'i', İ: 'I', ö: 'o', Ö: 'O', ş: 's', Ş: 'S', ü: 'u', Ü: 'U' }; return s.replace(/[çÇğĞıİöÖşŞüÜ]/g, (c) => tr[c]).normalize('NFKD').replace(/[^\x20-\x7e]/g, '').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80); };

  /** Kapak sayfası (siyah-beyaz, termal yazıcıya uygun) → PNG */
  async function coverPng(p, wPt, hPt, at) {
    const S = 4; // pt başına piksel (≈ 288 dpi)
    const W = Math.round(wPt * S), H = Math.round(hPt * S);
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    const u = Math.min(W, H) / 100; // ölçek birimi
    g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#000'; g.strokeStyle = '#000';
    g.lineWidth = u * 0.8; g.strokeRect(u * 2, u * 2, W - u * 4, H - u * 4);
    const font = (px, bold) => { g.font = `${bold ? '700' : '400'} ${px}px Arial, Helvetica, sans-serif`; };
    const wrap = (text, x, y, maxW, px, bold, maxLines = 3) => {
      font(px, bold);
      const words = String(text).split(/\s+/); let line = ''; let lines = 0;
      for (let i = 0; i < words.length; i++) {
        const t = line ? line + ' ' + words[i] : words[i];
        if (g.measureText(t).width > maxW && line) {
          if (++lines >= maxLines) { g.fillText(line + ' …', x, y); return y + px * 1.2; }
          g.fillText(line, x, y); y += px * 1.2; line = words[i];
        } else line = t;
      }
      if (line) { g.fillText(line, x, y); y += px * 1.2; }
      return y;
    };
    const L = u * 6, R = W - u * 6, maxW = R - L;
    g.textBaseline = 'top';
    font(u * 22, true); g.fillText(`P${p.no}`, L, u * 5);
    font(u * 4, false); g.textAlign = 'right'; g.fillText(trDateTime(at), R, u * 7); g.fillText(`${n(p.orders.length)} sipariş · ${n(p.pages.length)} etiket`, R, u * 12.5); g.textAlign = 'left';
    let y = u * 30;
    y = wrap(p.label, L, y, maxW, u * 6.2, true, 2);
    if (p.store) { font(u * 4.2, false); g.fillText(p.store, L, y); y += u * 6; }
    g.lineWidth = u * 0.4; g.beginPath(); g.moveTo(L, y); g.lineTo(R, y); g.stroke(); y += u * 2.5;
    // İçerik: bileşimler (sığdığı kadar)
    const sum = summary(p);
    const bottom = H - u * 30;
    font(u * 4, false);
    for (let i = 0; i < sum.length; i++) {
      if (y + u * 5 > bottom) { g.fillText(`+ ${sum.length - i} bileşim daha`, L, y); y += u * 5; break; }
      const cnt = `${sum[i].orders}`;
      font(u * 4, true); g.textAlign = 'right'; g.fillText(cnt, R, y); g.textAlign = 'left';
      font(u * 4, false);
      let t = sum[i].label; while (g.measureText(t).width > maxW - u * 10 && t.length > 4) t = t.slice(0, -2);
      g.fillText(t === sum[i].label ? t : t + '…', L, y); y += u * 5;
    }
    // Teslim alan + imza
    const yb = H - u * 26;
    font(u * 4, false); g.fillText('Teslim alan', L, yb);
    font(u * 7, true); g.fillText(p.assignee || '……………………………', L, yb + u * 5);
    font(u * 4, false); g.fillText('İmza', L, yb + u * 15);
    g.lineWidth = u * 0.4; g.beginPath(); g.moveTo(L + u * 12, yb + u * 19); g.lineTo(R, yb + u * 19); g.stroke();
    const blob = await new Promise((res) => cv.toBlob(res, 'image/png'));
    return new Uint8Array(await blob.arrayBuffer());
  }

  // ------------------------------------------------------------- zimmet listesi (A4)
  function printList() {
    const box = document.getElementById('print');
    mount(box, html`<style>@page { size: 210mm 297mm; margin: 12mm }</style><div class="cprint" style="--fs:11pt;--pad:6px">
      <h1>Günlük Dağıtım · Zimmet Listesi</h1><p class="sub">${trDateTime(new Date().toISOString())} · ${n(read.orders.length)} sipariş · ${n(packets.length)} paket</p>
      <table><thead><tr><th class="num" style="width:9%">Paket</th><th class="p">İçerik</th><th class="num" style="width:10%">Sipariş</th><th class="num" style="width:9%">Etiket</th><th style="width:20%">Teslim alan</th><th style="width:17%">İmza</th></tr></thead><tbody>
        ${packets.map((p) => html`<tr><td class="num"><b>P${p.no}</b></td><td class="p"><b>${p.label}</b>${p.store ? ` · ${p.store}` : ''}${p.kind !== 'combo' ? html`<div style="font-size:.8em">${summary(p).slice(0, 6).map((g) => `${g.label} (${g.orders})`).join(' · ')}${summary(p).length > 6 ? ` · +${summary(p).length - 6}` : ''}</div>` : ''}</td><td class="num">${n(p.orders.length)}</td><td class="num">${n(p.pages.length)}</td><td>${p.assignee}</td><td style="height:2.2em"></td></tr>`)}
      </tbody></table></div>`);
    window.addEventListener('afterprint', () => { box.innerHTML = ''; }, { once: true });
    window.print();
  }

  loadHistory();
}
