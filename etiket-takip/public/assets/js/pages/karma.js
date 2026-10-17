// Karma Ayıklama: karma etiket PDF'ini okur, siparişleri seçilen kategorilere göre ikiye ayırır
// ve iki ayrı PDF verir. Sayfalar hiç değiştirilmez (barkod, sıra, içerik aynen) — yalnızca ayrılır.
//   1. grup ("Sadece Şişe"): ürünlerinin HEPSİ seçilen kategorilerde olan siparişler
//   2. grup ("Kutulu"): geri kalan her sayfa (karışık siparişler, tanınmayan ürünler, okunamayan sayfalar)
// Dosyalar bu bilgisayarda işlenir; sunucuya hiçbir şey gönderilmez, siparişler kaydedilmez.
import { html, mount, icon, n, toast, busy, emptyState, storeTag, download, loadScript, personName } from '../core/ui.js';
import { state } from '../core/api.js';
import { readLabels } from '../core/labels.js';
import { computeOrder } from '../shared/calc.js';
import { classifyOrder, KIND_LABEL } from '../shared/karma.js';
import { karmaPref, saveKarmaPref } from '../core/karmapref.js';
import { fold } from '../shared/text.js';

export default async function karmaPage(ctx) {
  let kp = karmaPref();
  let read = null; // readLabels sonucu
  let rows = []; // { o, c, kind, auto, group, manual }
  const cats = [...new Set(state.config.products.filter((p) => p.active !== false).map((p) => (p.category || '').trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'tr'));
  const pname = (id) => state.ctx.label(id);
  const pcat = (id) => { const p = state.ctx.productsById.get(id); return (p && p.category) || ''; };

  ctx.setSub('Karma etiketleri kategoriye göre iki PDF\'e ayırır — sayfalar ve barkodlar değişmez');
  mount(ctx.el, html`<div class="stack">
    <div class="card"><div class="card-h"><h2>Ayıklama kriteri</h2><span class="sub">Seçilen kategorilerden başka ürün içermeyen siparişler 1. gruba ayrılır</span></div>
      <div class="card-b stack" style="gap:14px">
        <div class="f">Kategoriler<div class="row wrap" id="cats" style="gap:8px 16px;margin-top:6px">
          ${cats.length ? cats.map((c) => html`<label class="check"><input type="checkbox" name="cat" value="${c}" ${kp.cats.some((x) => fold(x) === fold(c)) ? 'checked' : ''}> ${c}</label>`)
            : html`<span class="muted small">Katalogda kategori yok — <a href="#/products">Ürünler & Sıra</a> sayfasından ürünlere kategori verin.</span>`}
        </div></div>
        <div class="row wrap" style="gap:12px">
          <label class="f">1. grup adı <span class="hint">yalnızca seçilen kategoriler</span><input class="input" id="nOnly" maxlength="40" value="${kp.only}" style="width:220px"></label>
          <label class="f">2. grup adı <span class="hint">geri kalan her şey</span><input class="input" id="nRest" maxlength="40" value="${kp.rest}" style="width:220px"></label>
        </div>
        <p class="muted small" style="margin:0">Bu ayar Kombinasyon Analizi'nde de kullanılır: “Karma Siparişler” satırı <b id="lblOnly">${kp.only}</b> ve <b id="lblRest">${kp.rest}</b> olarak ikiye ayrılır. Ayarlar bu tarayıcıda hatırlanır.</p>
      </div></div>
    <div class="card"><div class="card-b stack">
      <label class="drop" id="drop">
        <input type="file" id="file" accept="application/pdf,.pdf" multiple hidden>
        <div class="ic">${icon('upload')}</div>
        <b>Karma etiket PDF'ini buraya sürükleyin</b>
        <div class="muted">veya tıklayıp seçin · birden çok PDF atılırsa dosya adı sırasıyla birleştirilir · dosya bu bilgisayarda işlenir, siteye kaydedilmez</div>
      </label>
      <div id="prog" class="hidden"><div class="row small" style="margin-bottom:6px"><span id="progText">Okunuyor…</span></div><div class="progress"><i id="progBar" style="width:0"></i></div></div>
    </div></div>
    <div id="out"></div>
  </div>`);
  const $ = (s) => ctx.el.querySelector(s);

  // ------------------------------------------------------------- ayarlar
  const readCats = () => [...ctx.el.querySelectorAll('[name=cat]:checked')].map((x) => x.value);
  $('#cats').addEventListener('change', () => { saveKarmaPref({ cats: readCats() }); kp = karmaPref(); classify(); });
  const onName = () => {
    saveKarmaPref({ only: $('#nOnly').value, rest: $('#nRest').value }); kp = karmaPref();
    $('#lblOnly').textContent = kp.only; $('#lblRest').textContent = kp.rest;
    render();
  };
  $('#nOnly').addEventListener('change', onName);
  $('#nRest').addEventListener('change', onName);

  // ------------------------------------------------------------- dosya
  const drop = $('#drop');
  $('#file').addEventListener('change', (e) => { handle([...e.target.files]); e.target.value = ''; });
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => handle([...e.dataTransfer.files]));

  async function handle(files) {
    const pdfs = files.filter((f) => /\.pdf$/i.test(f.name) || f.type === 'application/pdf');
    if (!pdfs.length) return toast('PDF dosyası seçin', 'err');
    $('#prog').classList.remove('hidden');
    try {
      read = await readLabels(pdfs, { onProgress: (d, t) => { $('#progText').textContent = `Okunuyor… ${d}/${t} dosya`; $('#progBar').style.width = `${(d / t) * 100}%`; } });
      if (!read.pageList.length) throw new Error('PDF okunamadı' + (read.log[0] ? ': ' + read.log[0].msg : ''));
      rows = read.orders.map((o) => ({ o, c: computeOrder({ ...o, k: '_' }, state.ctx), manual: null }));
      classify();
    } catch (e) { toast(e.message, 'err'); }
    $('#prog').classList.add('hidden');
  }

  function classify() {
    for (const r of rows) {
      const { kind, group } = classifyOrder(r.c, state.ctx, kp.cats);
      // Kendi başına okunamayan "devam" sayfası (başı önceki PDF'te) hiçbir zaman 1. gruba alınmaz
      Object.assign(r, { kind: r.o.orphan ? 'empty' : kind, auto: r.o.orphan ? 'rest' : group });
      r.group = r.manual || r.auto;
    }
    render();
  }

  /** Sayfa numarası (pageList içinde, 1'den) → grup. Siparişe ait olmayan sayfalar (mükerrer/okunamayan) 2. gruba. */
  function pageGroups() {
    const g = new Array(read.pageList.length).fill('rest');
    for (const r of rows) if (r.group === 'only') for (const p of r.o.pageNos) g[p - 1] = 'only';
    return g;
  }

  function render() {
    if (!read) return mount($('#out'), '');
    const pg = pageGroups();
    const cnt = (grp) => rows.filter((r) => r.group === grp).length;
    const pages = (grp) => pg.filter((x) => x === grp).length;
    const loose = read.pageList.length - rows.reduce((s, r) => s + r.o.pageNos.length, 0);
    const kinds = {};
    for (const r of rows) if (r.group === 'rest') kinds[r.kind] = (kinds[r.kind] || 0) + 1;
    const unmatched = rows.filter((r) => r.kind === 'unmatched');
    const warns = read.log.filter((l) => l.type === 'error' || l.type === 'dup' || l.type === 'warn');
    mount($('#out'), html`<div class="stack">
      <div class="kpis">
        <div class="kpi"><div class="l">${icon('file')}Okunan</div><div class="v">${n(rows.length)}</div><div class="s">sipariş · ${n(read.pageList.length)} sayfa · ${n(read.fileList.length)} dosya</div></div>
        <div class="kpi hl"><div class="l">${icon('box')}${kp.only}</div><div class="v">${n(cnt('only'))}</div><div class="s">${n(pages('only'))} sayfa · yalnızca ${kp.cats.join(', ') || '—'}</div>
          <button class="btn sm primary" data-dl="only" style="margin-top:8px" ${pages('only') ? '' : 'disabled'}>${icon('download')}PDF indir</button></div>
        <div class="kpi"><div class="l">${icon('copy')}${kp.rest}</div><div class="v">${n(cnt('rest'))}</div><div class="s">${n(pages('rest'))} sayfa${loose ? ` (${n(loose)} sipariş dışı sayfa dahil)` : ''}</div>
          <button class="btn sm" data-dl="rest" style="margin-top:8px" ${pages('rest') ? '' : 'disabled'}>${icon('download')}PDF indir</button></div>
      </div>
      ${kp.cats.length ? '' : html`<div class="callout warn">${icon('alert')}<div class="c"><b>Kategori seçilmedi</b>Yukarıdan en az bir kategori seçin; seçilmezse bütün siparişler ${kp.rest} grubunda kalır.</div></div>`}
      <div class="callout info">${icon('info')}<div class="c"><b>${kp.rest} grubunda neler var</b>${Object.entries(kinds).map(([k, v]) => `${KIND_LABEL[k]}: ${n(v)}`).join(' · ') || '—'}${loose ? ` · sipariş dışı sayfa (mükerrer/okunamayan): ${n(loose)}` : ''}. Her sayfa iki dosyadan birinde, PDF'teki sırasıyla yer alır; toplam ${n(pages('only'))} + ${n(pages('rest'))} = ${n(read.pageList.length)} sayfa.</div></div>
      ${unmatched.length ? html`<div class="callout warn">${icon('alert')}<div class="c"><b>${n(unmatched.length)} siparişte tanınmayan ürün var — bunlar ${kp.rest} grubunda bırakıldı</b>Ürünü <a href="#/matching">Ürün Eşleştirme</a> sayfasından atayıp PDF'i yeniden atın, ya da aşağıdaki listede grubu elle değiştirin.</div></div>` : ''}
      ${warns.length ? html`<details class="card" style="padding:12px 16px"><summary class="small" style="cursor:pointer">Okuma notları (${warns.length})</summary><div class="small" style="margin-top:8px">${warns.map((l) => html`<div>${l.msg}</div>`)}</div></details>` : ''}
      <div class="card"><div class="card-h"><h2>Siparişler</h2><span class="sub">PDF sırasıyla · grubu değiştirmek için rozete tıklayın</span></div>
        <div class="tw"><table class="t"><thead><tr><th class="num">Sayfa</th><th>Sipariş</th><th>Ürünler</th><th>Grup</th></tr></thead><tbody>
          ${rows.map((r, i) => html`<tr>
            <td class="num muted small">${r.o.pageNos.join(', ')}</td>
            <td class="nowrap"><b>${r.o.orderNo || '—'}</b><div class="muted xs">${personName(r.o.recipient) || ''}</div><div>${storeTag(r.c.store, r.o.sender)}</div></td>
            <td class="small">${r.c.lines.filter((l) => !l.ignored && l.units).map((l) => html`<div><span class="q">${l.units}x</span> ${l.productId ? html`${pname(l.productId)} <span class="badge ${kp.cats.some((x) => fold(x) === fold(pcat(l.productId))) ? 'ok' : ''}">${pcat(l.productId) || 'kategorisiz'}</span>` : html`<span class="unm">⚠ ${l.raw}</span>`}</div>`)}</td>
            <td><button class="badge ${r.group === 'only' ? 'ok' : ''} click" data-flip="${i}" title="${KIND_LABEL[r.kind]}${r.manual ? ' · elle değiştirildi' : ''} — tıklayınca diğer gruba geçer">${r.group === 'only' ? kp.only : kp.rest}${r.manual ? ' ✎' : ''}</button><div class="muted xs">${KIND_LABEL[r.kind]}</div></td>
          </tr>`)}
        </tbody></table></div></div>
    </div>`);
  }

  $('#out').addEventListener('click', async (e) => {
    const flip = e.target.closest('[data-flip]');
    if (flip) {
      const r = rows[+flip.dataset.flip];
      const next = r.group === 'only' ? 'rest' : 'only';
      r.manual = next === r.auto ? null : next;
      r.group = next;
      return render();
    }
    const dl = e.target.closest('[data-dl]');
    if (dl) {
      busy(dl, true, 'Hazırlanıyor…');
      try { await save(dl.dataset.dl); } catch (err) { console.error(err); toast('PDF oluşturulamadı: ' + (err.message || err), 'err'); }
      busy(dl, false);
    }
  });

  /** Seçilen gruptaki sayfaları kaynak PDF'ten aynen kopyalar (yeniden çizilmez, barkod/sıra değişmez). */
  async function save(grp) {
    await loadScript('/assets/vendor/pdf-lib.min.js');
    const { PDFDocument } = window.PDFLib;
    const pg = pageGroups();
    const out = await PDFDocument.create();
    const srcs = new Map();
    // Sayfaları PDF'teki sırayla, ardışık aynı dosyadan gelenleri tek seferde kopyala
    let run = null;
    const flush = async () => {
      if (!run) return;
      if (!srcs.has(run.fi)) srcs.set(run.fi, await PDFDocument.load(await read.fileList[run.fi].arrayBuffer(), { ignoreEncryption: true }));
      const copied = await out.copyPages(srcs.get(run.fi), run.idx);
      for (const p of copied) out.addPage(p);
      run = null;
    };
    for (let i = 0; i < read.pageList.length; i++) {
      if (pg[i] !== grp) continue;
      const { fileIndex: fi, filePage } = read.pageList[i];
      if (run && run.fi !== fi) await flush();
      if (!run) run = { fi, idx: [] };
      run.idx.push(filePage - 1);
    }
    await flush();
    if (!out.getPageCount()) throw new Error('Bu grupta sayfa yok');
    const bytes = await out.save();
    const base = read.fileList.length === 1 ? read.fileList[0].name.replace(/\.pdf$/i, '') : 'Karma';
    // Dosya adında Türkçe harf kullanılmaz: bazı tarayıcılar/işletim sistemleri adı bozabiliyor
    const tr = { ç: 'c', Ç: 'C', ğ: 'g', Ğ: 'G', ı: 'i', İ: 'I', ö: 'o', Ö: 'O', ş: 's', Ş: 'S', ü: 'u', Ü: 'U' };
    const name = `${base} - ${grp === 'only' ? kp.only : kp.rest}.pdf`.replace(/[çÇğĞıİöÖşŞüÜ]/g, (c) => tr[c])
      .normalize('NFKD').replace(/[^\x20-\x7e]/g, '').replace(/[\\/:*?"<>|]+/g, '-');
    download(name, new Blob([bytes], { type: 'application/pdf' }));
    toast(`${name} indirildi (${out.getPageCount()} sayfa)`, 'ok');
  }
}
