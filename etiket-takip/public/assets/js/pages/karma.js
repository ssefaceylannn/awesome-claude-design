// Karma Ayıklama: karma etiket PDF'ini okur, siparişleri seçilen kategorilere/ürünlere göre gruplar
// ve her grup için ayrı PDF verir. Sayfalar hiç değiştirilmez (barkod, sıra, içerik aynen) — yalnızca ayrılır.
//   1. grup ("Sadece Şişe"): ürünlerinin HEPSİ seçimde olan siparişler
//   2. grup ("Kutulu"): seçimdeki ürünün yanında seçim dışı ürün olanlar + tanınmayan/okunamayan her şey
//   3. grup ("Şişesiz", isteğe bağlı): seçimden hiç ürün olmayanlar (kapalıyken 2. gruptadır)
// Kural sitede saklanır (yönetici değiştirir); dosyalar bu bilgisayarda işlenir. Siteye kaydetmek için
// dosyalar Etiket Yükle'ye aktarılır (mükerrer kontrolü orada yapılır).
import { html, mount, icon, n, toast, busy, storeTag, download, loadScript, personName, multiSelect } from '../core/ui.js';
import { state, isAdmin } from '../core/api.js';
import { readLabels } from '../core/labels.js';
import { computeOrder } from '../shared/calc.js';
import { classifyOrder, productInRule, ruleEmpty, KIND_LABEL } from '../shared/karma.js';
import { karmaPref, saveKarma } from '../core/karmapref.js';
import { handOff } from '../core/handoff.js';
import { fold } from '../shared/text.js';

let last = null; // son okunan PDF (sayfadan çıkıp dönünce sonuç kaybolmasın): { read, manual: Map(i → grup) }

export default async function karmaPage(ctx) {
  const admin = isAdmin();
  let saved = karmaPref();
  let rule = structuredClone(saved); // ekrandaki (henüz kaydedilmemiş olabilir) kural
  let read = last ? last.read : null;
  let rows = []; // { o, c, kind, auto, group, manual }
  const active = state.config.products.filter((p) => p.active !== false);
  const cats = [...new Set(active.map((p) => (p.category || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'tr'));
  const pname = (id) => state.ctx.label(id);
  const pcat = (id) => { const p = state.ctx.productsById.get(id); return (p && p.category) || ''; };
  const groups = () => ['only', 'rest', ...(rule.third ? ['none'] : [])];
  const dirty = () => JSON.stringify(rule) !== JSON.stringify(saved);

  ctx.setSub('Karma etiketleri kategoriye / ürüne göre ayrı PDF\'lere ayırır — sayfalar ve barkodlar değişmez');
  mount(ctx.el, html`<div class="stack">
    <div class="card"><div class="card-h"><h2>Ayıklama kuralı</h2><span class="sub">Seçilen kategori ve ürünlerden başka ürün içermeyen siparişler 1. gruba ayrılır</span></div>
      <div class="card-b stack" style="gap:14px">
        <div class="f">Kategoriler<div class="row wrap" id="cats" style="gap:8px 16px;margin-top:6px">
          ${cats.length ? cats.map((c) => html`<label class="check"><input type="checkbox" name="cat" value="${c}" ${rule.cats.some((x) => fold(x) === fold(c)) ? 'checked' : ''}> ${c}</label>`)
            : html`<span class="muted small">Katalogda kategori yok — <a href="#/products">Ürünler & Sıra</a> sayfasından ürünlere kategori verin.</span>`}
        </div></div>
        <div class="f">Ürünler <span class="hint">kategoriden bağımsız tek tek de seçilebilir; seçilen kategorilere ek olarak sayılır</span><div id="prods" style="max-width:520px;margin-top:6px"></div></div>
        <div class="row wrap" style="gap:12px;align-items:flex-end">
          <label class="f">1. grup adı <span class="hint">yalnızca seçilenler</span><input class="input" data-name="only" maxlength="40" value="${rule.names.only}" style="width:200px"></label>
          <label class="f">2. grup adı <span class="hint">seçilen + seçim dışı</span><input class="input" data-name="rest" maxlength="40" value="${rule.names.rest}" style="width:200px"></label>
          <label class="f">3. grup adı <span class="hint">seçilenden hiç yok</span><input class="input" data-name="none" maxlength="40" value="${rule.names.none}" style="width:200px"></label>
          <label class="check" style="margin-bottom:8px"><input type="checkbox" id="third" ${rule.third ? 'checked' : ''}> 3. grubu kullan</label>
        </div>
        <p class="muted small" style="margin:0" id="ruleNote"></p>
        <div class="row wrap" id="ruleBar"></div>
      </div></div>
    <div class="card"><div class="card-b stack">
      <label class="drop" id="drop">
        <input type="file" id="file" accept="application/pdf,.pdf" multiple hidden>
        <div class="ic">${icon('upload')}</div>
        <b>Karma etiket PDF'ini buraya sürükleyin</b>
        <div class="muted">veya tıklayıp seçin · birden çok PDF atılırsa dosya adı sırasıyla birleştirilir · dosya bu bilgisayarda işlenir</div>
      </label>
      <div id="prog" class="hidden"><div class="row small" style="margin-bottom:6px"><span id="progText">Okunuyor…</span></div><div class="progress"><i id="progBar" style="width:0"></i></div></div>
    </div></div>
    <div id="out"></div>
  </div>`);
  const $ = (s) => ctx.el.querySelector(s);

  // ------------------------------------------------------------- kural
  const prodOpts = active.map((p) => ({ id: p.id, label: state.ctx.labelOf(p), group: p.category || 'Kategorisiz' }))
    .sort((a, b) => (a.group === 'Kategorisiz') - (b.group === 'Kategorisiz') || a.group.localeCompare(b.group, 'tr') || a.label.localeCompare(b.label, 'tr'));
  multiSelect($('#prods'), { options: prodOpts, selected: rule.productIds.filter((id) => state.ctx.productsById.has(id)), allLabel: 'Ürün seçilmedi', onChange: (v) => { rule.productIds = v; changed(); } });
  function drawRuleBar() {
    const sel = [...rule.cats, ...rule.productIds];
    $('#ruleNote').textContent = `Kombinasyon Analizi'nde de bu kural kullanılır: “Karma Siparişler” satırı ${groups().map((g) => `“${rule.names[g]}”`).join(', ')} olarak ayrılır.`
      + (sel.length ? '' : ' Şu an hiçbir şey seçili değil: hiçbir sipariş 1. gruba ayrılmaz.');
    mount($('#ruleBar'), dirty()
      ? (admin ? html`<span class="badge warn">Kaydedilmemiş değişiklik</span><span class="spacer"></span><button class="btn sm ghost" id="ruleUndo">Vazgeç</button><button class="btn sm primary" id="ruleSave">${icon('check')}Kuralı sitede kaydet</button>`
        : html`<span class="badge warn">Bu değişiklik yalnızca şimdilik geçerli</span><span class="muted small">Kuralı kalıcı olarak yalnızca yönetici değiştirebilir.</span><span class="spacer"></span><button class="btn sm ghost" id="ruleUndo">Kayıtlı kurala dön</button>`)
      : html`<span class="muted small">${icon('check')} Kural sitede kayıtlı — her bilgisayarda aynı.</span>`);
  }
  function changed() { drawRuleBar(); classify(); }
  $('#cats').addEventListener('change', () => { rule.cats = [...ctx.el.querySelectorAll('[name=cat]:checked')].map((x) => x.value); changed(); });
  ctx.el.querySelectorAll('[data-name]').forEach((inp) => inp.addEventListener('input', () => {
    rule.names[inp.dataset.name] = inp.value.trim().slice(0, 40) || saved.names[inp.dataset.name];
    drawRuleBar(); render();
  }));
  $('#third').addEventListener('change', (e) => { rule.third = e.target.checked; changed(); });
  $('#ruleBar').addEventListener('click', async (e) => {
    // Vazgeç: sayfayı kayıtlı kuralla yeniden kur (okunan PDF ve elle değişiklikler korunur)
    if (e.target.closest('#ruleUndo')) return karmaPage(ctx);
    const b = e.target.closest('#ruleSave');
    if (!b) return;
    busy(b, true, 'Kaydediliyor…');
    try {
      await saveKarma(rule, `karma kuralı: ${[...rule.cats, ...rule.productIds.map(pname)].join(', ') || 'boş'}${rule.third ? ' · 3. grup açık' : ''}`);
      saved = karmaPref(); rule = structuredClone(saved);
      toast('Kural kaydedildi', 'ok'); drawRuleBar();
    } catch (err) { toast(err.message, 'err'); busy(b, false); }
  });

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
      const r = await readLabels(pdfs, { onProgress: (d, t) => { $('#progText').textContent = `Okunuyor… ${d}/${t} dosya`; $('#progBar').style.width = `${(d / t) * 100}%`; } });
      if (!r.pageList.length) throw new Error('PDF okunamadı' + (r.log[0] ? ': ' + r.log[0].msg : ''));
      read = r;
      last = { read, manual: new Map() };
      build();
    } catch (e) { toast(e.message, 'err'); }
    $('#prog').classList.add('hidden');
  }

  function build() {
    rows = read.orders.map((o, i) => ({ o, c: computeOrder({ ...o, k: '_' }, state.ctx), manual: last.manual.get(i) || null }));
    classify();
  }

  function classify() {
    if (!read) return;
    const valid = groups();
    rows.forEach((r, i) => {
      const { kind, group } = classifyOrder(r.c, state.ctx, rule);
      // Kendi başına okunamayan "devam" sayfası (başı önceki PDF'te) hiçbir zaman 1. gruba alınmaz
      Object.assign(r, { kind: r.o.orphan ? 'empty' : kind, auto: r.o.orphan ? 'rest' : group });
      if (r.manual && (!valid.includes(r.manual) || r.manual === r.auto)) { r.manual = null; last.manual.delete(i); }
      r.group = r.manual || r.auto;
    });
    render();
  }

  /** Sayfa numarası (pageList içinde, 1'den) → grup. Siparişe ait olmayan sayfalar (mükerrer/okunamayan) 2. gruba. */
  function pageGroups() {
    const g = new Array(read.pageList.length).fill('rest');
    for (const r of rows) if (r.group !== 'rest') for (const p of r.o.pageNos) g[p - 1] = r.group;
    return g;
  }

  const KPI_ICON = { only: 'box', rest: 'copy', none: 'gift' };
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
    const G = groups();
    const sub = { only: 'yalnızca seçilenler', rest: loose ? `${n(loose)} sipariş dışı sayfa dahil` : 'seçilen + seçim dışı', none: 'seçilenden hiç yok' };
    mount($('#out'), html`<div class="stack">
      <div class="kpis">
        <div class="kpi"><div class="l">${icon('file')}Okunan</div><div class="v">${n(rows.length)}</div><div class="s">sipariş · ${n(read.pageList.length)} sayfa · ${n(read.fileList.length)} dosya</div>
          <button class="btn sm" id="toSite" style="margin-top:8px" title="Dosyaları Etiket Yükle sayfasına aktarır; daha önce kaydedilmiş siparişler orada mükerrer olarak gösterilir">${icon('upload')}Siteye kaydet</button></div>
        ${G.map((g) => html`<div class="kpi ${g === 'only' ? 'hl' : ''}"><div class="l">${icon(KPI_ICON[g])}${rule.names[g]}</div><div class="v">${n(cnt(g))}</div><div class="s">${n(pages(g))} sayfa · ${sub[g]}</div>
          <button class="btn sm ${g === 'only' ? 'primary' : ''}" data-dl="${g}" style="margin-top:8px" ${pages(g) ? '' : 'disabled'}>${icon('download')}PDF indir</button></div>`)}
      </div>
      ${ruleEmpty(rule) ? html`<div class="callout warn">${icon('alert')}<div class="c"><b>Kategori ya da ürün seçilmedi</b>Yukarıdan seçim yapın; seçilmezse hiçbir sipariş 1. gruba ayrılmaz.</div></div>` : ''}
      <div class="callout info">${icon('info')}<div class="c"><b>${rule.names.rest} grubunda neler var</b>${Object.entries(kinds).map(([k, v]) => `${KIND_LABEL[k]}: ${n(v)}`).join(' · ') || '—'}${loose ? ` · sipariş dışı sayfa (mükerrer/okunamayan): ${n(loose)}` : ''}. Her sayfa dosyalardan yalnızca birinde, PDF'teki sırasıyla yer alır; toplam ${G.map((g) => n(pages(g))).join(' + ')} = ${n(read.pageList.length)} sayfa.</div></div>
      ${unmatched.length ? html`<div class="callout warn">${icon('alert')}<div class="c"><b>${n(unmatched.length)} siparişte tanınmayan ürün var — bunlar ${rule.names.rest} grubunda bırakıldı</b>Ürünü <a href="#/matching">Ürün Eşleştirme</a> sayfasından atayıp PDF'i yeniden atın, ya da aşağıdaki listede grubu elle değiştirin.</div></div>` : ''}
      ${warns.length ? html`<details class="card" style="padding:12px 16px"><summary class="small" style="cursor:pointer">Okuma notları (${warns.length})</summary><div class="small" style="margin-top:8px">${warns.map((l) => html`<div>${l.msg}</div>`)}</div></details>` : ''}
      <div class="card"><div class="card-h"><h2>Siparişler</h2><span class="sub">PDF sırasıyla · grubu değiştirmek için rozete tıklayın (sırayla diğer gruplara geçer)</span></div>
        <div class="tw"><table class="t"><thead><tr><th class="num">Sayfa</th><th>Sipariş</th><th>Ürünler</th><th>Grup</th></tr></thead><tbody>
          ${rows.map((r, i) => html`<tr>
            <td class="num muted small">${r.o.pageNos.join(', ')}</td>
            <td class="nowrap"><b>${r.o.orderNo || '—'}</b><div class="muted xs">${personName(r.o.recipient) || ''}</div><div>${storeTag(r.c.store, r.o.sender)}</div></td>
            <td class="small">${r.c.lines.filter((l) => !l.ignored && l.units).map((l) => html`<div><span class="q">${l.units}x</span> ${l.productId ? html`${pname(l.productId)} <span class="badge ${productInRule(l.productId, state.ctx, rule) ? 'ok' : ''}">${pcat(l.productId) || 'kategorisiz'}</span>` : html`<span class="unm">⚠ ${l.raw}</span>`}</div>`)}</td>
            <td><button class="badge ${r.group === 'only' ? 'ok' : r.group === 'none' ? 'info' : ''}" data-flip="${i}" title="${KIND_LABEL[r.kind]}${r.manual ? ' · elle değiştirildi' : ''} — tıklayınca diğer gruba geçer">${rule.names[r.group]}${r.manual ? ' ✎' : ''}</button><div class="muted xs">${KIND_LABEL[r.kind]}</div></td>
          </tr>`)}
        </tbody></table></div></div>
    </div>`);
  }

  $('#out').addEventListener('click', async (e) => {
    const flip = e.target.closest('[data-flip]');
    if (flip) {
      const i = +flip.dataset.flip;
      const r = rows[i];
      const G = groups();
      const next = G[(G.indexOf(r.group) + 1) % G.length];
      r.manual = next === r.auto ? null : next;
      if (r.manual) last.manual.set(i, r.manual); else last.manual.delete(i);
      r.group = next;
      return render();
    }
    if (e.target.closest('#toSite')) {
      handOff(read.fileList);
      toast('Dosyalar Etiket Yükle sayfasına aktarıldı — daha önce kaydedilenler orada mükerrer olarak gösterilir', 'ok');
      return ctx.navigate('upload');
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
    const name = `${base} - ${rule.names[grp]}.pdf`.replace(/[çÇğĞıİöÖşŞüÜ]/g, (c) => tr[c])
      .normalize('NFKD').replace(/[^\x20-\x7e]/g, '').replace(/[\\/:*?"<>|]+/g, '-');
    download(name, new Blob([bytes], { type: 'application/pdf' }));
    toast(`${name} indirildi (${out.getPageCount()} sayfa)`, 'ok');
  }

  drawRuleBar();
  if (read) build();
}
