// Karma Ayıklama: etiket PDF'ini okur, siparişleri gruplar ve her grup için ayrı PDF verir.
// Sayfalar hiç değiştirilmez (barkod, sıra, içerik aynen) — yalnızca ayrılır. İki ölçüt:
//   Ürüne göre: 1. grup ("Sadece Şişe") ürünlerinin HEPSİ seçimde olanlar; 2. grup ("Kutulu") seçilen +
//     seçim dışı ürün olanlar ve tanınmayan/okunamayan her şey; 3. grup ("Şişesiz", isteğe bağlı)
//     seçimden hiç ürün olmayanlar (kapalıyken 2. gruptadır)
//   Şehre göre: alıcı ili seçilen illerden (varsayılan Düzce) olanlar / diğer şehirler (il okunamayanlar dahil)
// Kural sitede saklanır (yönetici değiştirir); dosyalar bu bilgisayarda işlenir. Siteye kaydetmek için
// dosyalar Etiket Yükle'ye aktarılır (mükerrer kontrolü orada yapılır).
import { html, mount, icon, n, toast, busy, storeTag, download, personName, multiSelect } from '../core/ui.js';
import { buildPdf } from '../core/pdfsplit.js';
import { printPdf } from '../core/pdfprint.js';
import { state, isAdmin } from '../core/api.js';
import { readLabels } from '../core/labels.js';
import { computeOrder } from '../shared/calc.js';
import { classifyOrder, classifyCity, productInRule, ruleEmpty, KIND_LABEL, CITY_KIND_LABEL } from '../shared/karma.js';
import { PROVINCES } from '../shared/cities.js';
import { karmaPref, saveKarma } from '../core/karmapref.js';
import { handOff } from '../core/handoff.js';
import { fold } from '../shared/text.js';

const MODE_KEY = 'et-split-mode';
// Son okunan PDF (sayfadan çıkıp dönünce sonuç kaybolmasın) ve ölçüte göre elle yapılan grup değişiklikleri
let last = null; // { read, manual: { product: Map, city: Map } }

export default async function karmaPage(ctx) {
  const admin = isAdmin();
  let saved = karmaPref();
  let rule = structuredClone(saved); // ekrandaki (henüz kaydedilmemiş olabilir) kural
  let mode = 'product';
  try { if (localStorage.getItem(MODE_KEY) === 'city') mode = 'city'; } catch { /* yok */ }
  let read = last ? last.read : null;
  let rows = []; // { o, c, kind, auto, group, manual, province }
  const active = state.config.products.filter((p) => p.active !== false);
  const cats = [...new Set(active.map((p) => (p.category || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'tr'));
  const pname = (id) => state.ctx.label(id);
  const pcat = (id) => { const p = state.ctx.productsById.get(id); return (p && p.category) || ''; };
  const dirty = () => JSON.stringify(rule) !== JSON.stringify(saved);
  // Ölçüte göre gruplar, adları ve "geri kalan" grup
  const groups = () => (mode === 'city' ? ['in', 'out'] : ['only', 'rest', ...(rule.third ? ['none'] : [])]);
  const restKey = () => (mode === 'city' ? 'out' : 'rest');
  const cityLabel = () => (rule.cities.length ? (rule.cities.length <= 3 ? rule.cities.join(', ') : `${rule.cities.slice(0, 2).join(', ')} +${rule.cities.length - 2} il`) : 'Seçilen iller');
  const gname = (g) => (g === 'in' ? cityLabel() : g === 'out' ? 'Diğer şehirler' : rule.names[g]);
  const kindLabel = (k) => (mode === 'city' ? CITY_KIND_LABEL[k] : KIND_LABEL[k]);

  ctx.setSub('Etiketleri ürüne ya da şehre göre ayrı PDF\'lere ayırır — sayfalar ve barkodlar değişmez');
  mount(ctx.el, html`<div class="stack">
    <div class="tabs card" style="padding:0 8px"><button data-mode="product">${icon('box')} Ürüne göre (karma)</button><button data-mode="city">${icon('store')} Şehre göre</button></div>
    <div class="card"><div class="card-h"><h2>Ayıklama kuralı</h2><span class="sub" id="ruleSub"></span></div>
      <div class="card-b stack" style="gap:14px">
        <div class="stack" id="ruleProd" style="gap:14px">
          <div class="f">Kategoriler<div class="row wrap" id="cats" style="gap:8px 16px;margin-top:6px">
            ${cats.length ? cats.map((c) => html`<label class="check"><input type="checkbox" name="cat" value="${c}" ${rule.cats.some((x) => fold(x) === fold(c)) ? 'checked' : ''}> ${c}</label>`)
              : html`<span class="muted small">Katalogda kategori yok — <a href="#/products">Ürünler & Sıra</a> sayfasından ürünlere kategori verin.</span>`}
          </div></div>
          <div class="f">Ürünler <span class="hint">kategoriden bağımsız tek tek de seçilebilir; seçilen kategorilere ek olarak sayılır</span><div id="prods" style="max-width:520px;margin-top:6px"></div></div>
          <div class="f">Karma ayırma yapılacak mağazalar <span class="hint">Günlük Dağıtım ve Kombinasyon Analizi yalnızca bu mağazaların karmasını ayırır; diğerlerinin karması tek paket kalır</span><div id="kstores" style="max-width:520px;margin-top:6px"></div></div>
          <div class="row wrap" style="gap:12px;align-items:flex-end">
            <label class="f">1. grup adı <span class="hint">yalnızca seçilenler</span><input class="input" data-name="only" maxlength="40" value="${rule.names.only}" style="width:200px"></label>
            <label class="f">2. grup adı <span class="hint">seçilen + seçim dışı</span><input class="input" data-name="rest" maxlength="40" value="${rule.names.rest}" style="width:200px"></label>
            <label class="f">3. grup adı <span class="hint">seçilenden hiç yok</span><input class="input" data-name="none" maxlength="40" value="${rule.names.none}" style="width:200px"></label>
            <label class="check" style="margin-bottom:8px"><input type="checkbox" id="third" ${rule.third ? 'checked' : ''}> 3. grubu kullan</label>
          </div>
        </div>
        <div class="stack" id="ruleCity" style="gap:10px">
          <div class="f">İl <span class="hint">etiketteki alıcı adresinin ili; birden çok il seçilebilir</span><div id="cities" style="max-width:420px;margin-top:6px"></div></div>
        </div>
        <p class="muted small" style="margin:0" id="ruleNote"></p>
        <div class="row wrap" id="ruleBar"></div>
      </div></div>
    <div class="card"><div class="card-b stack">
      <label class="drop" id="drop">
        <input type="file" id="file" accept="application/pdf,.pdf" multiple hidden>
        <div class="ic">${icon('upload')}</div>
        <b>Etiket PDF'ini buraya sürükleyin</b>
        <div class="muted">veya tıklayıp seçin · birden çok PDF atılırsa dosya adı sırasıyla birleştirilir · dosya bu bilgisayarda işlenir</div>
      </label>
      <div id="prog" class="hidden"><div class="row small" style="margin-bottom:6px"><span id="progText">Okunuyor…</span></div><div class="progress"><i id="progBar" style="width:0"></i></div></div>
    </div></div>
    <div id="out"></div>
  </div>`);
  const $ = (s) => ctx.el.querySelector(s);

  // ------------------------------------------------------------- ölçüt
  function showMode() {
    ctx.el.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
    $('#ruleProd').classList.toggle('hidden', mode !== 'product');
    $('#ruleCity').classList.toggle('hidden', mode !== 'city');
    $('#ruleSub').textContent = mode === 'city' ? 'Alıcısı seçilen ilde olan siparişler ayrı PDF\'e ayrılır' : 'Seçilen kategori ve ürünlerden başka ürün içermeyen siparişler 1. gruba ayrılır';
  }
  ctx.el.querySelector('.tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-mode]');
    if (!b || b.dataset.mode === mode) return;
    mode = b.dataset.mode;
    try { localStorage.setItem(MODE_KEY, mode); } catch { /* yok */ }
    showMode(); drawRuleBar(); classify();
  });

  // ------------------------------------------------------------- kural
  const prodOpts = active.map((p) => ({ id: p.id, label: state.ctx.labelOf(p), group: p.category || 'Kategorisiz' }))
    .sort((a, b) => (a.group === 'Kategorisiz') - (b.group === 'Kategorisiz') || a.group.localeCompare(b.group, 'tr') || a.label.localeCompare(b.label, 'tr'));
  multiSelect($('#prods'), { options: prodOpts, selected: rule.productIds.filter((id) => state.ctx.productsById.has(id)), allLabel: 'Ürün seçilmedi', onChange: (v) => { rule.productIds = v; changed(); } });
  const storeOpts = state.config.stores.filter((st) => st.active !== false).map((st) => ({ id: st.id, label: st.name, color: st.color }));
  multiSelect($('#kstores'), { options: storeOpts, selected: rule.storeIds, allLabel: 'Mağaza seçilmedi', onChange: (v) => { rule.storeIds = storeOpts.map((o) => o.id).filter((x) => v.includes(x)); changed(); } });
  multiSelect($('#cities'), { options: PROVINCES.map((p) => ({ id: p, label: p })), selected: rule.cities.filter((c) => PROVINCES.includes(c)), allLabel: 'İl seçilmedi', onChange: (v) => { rule.cities = PROVINCES.filter((p) => v.includes(p)); changed(); } });
  function drawRuleBar() {
    if (mode === 'city') {
      $('#ruleNote').textContent = rule.cities.length ? `İki PDF çıkar: “${cityLabel()}” ve “Diğer şehirler”. İli okunamayan etiket “Diğer şehirler”de kalır ve uyarı verilir.` : 'Şu an il seçili değil: hiçbir sipariş ayrılmaz.';
    } else {
      const sel = [...rule.cats, ...rule.productIds];
      $('#ruleNote').textContent = `Kombinasyon Analizi'nde de bu kural kullanılır: “Karma Siparişler” satırı ${['only', 'rest', ...(rule.third ? ['none'] : [])].map((g) => `“${rule.names[g]}”`).join(', ')} olarak ayrılır.`
        + (sel.length ? '' : ' Şu an hiçbir şey seçili değil: hiçbir sipariş 1. gruba ayrılmaz.');
    }
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
      const sname = (sid) => (state.config.stores.find((st) => st.id === sid) || {}).name || sid;
      await saveKarma(rule, `ayıklama kuralı: ${[...rule.cats, ...rule.productIds.map(pname)].join(', ') || 'ürün seçimi boş'}${rule.third ? ' · 3. grup açık' : ''} · mağazalar: ${rule.storeIds.map(sname).join(', ') || '—'} · il: ${rule.cities.join(', ') || '—'}`);
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
      last = { read, manual: { product: new Map(), city: new Map() } };
      build();
    } catch (e) { toast(e.message, 'err'); }
    $('#prog').classList.add('hidden');
  }

  function build() {
    rows = read.orders.map((o) => ({ o, c: computeOrder({ ...o, k: '_' }, state.ctx) }));
    classify();
  }

  function classify() {
    if (!read) return;
    const valid = groups();
    const manual = last.manual[mode];
    rows.forEach((r, i) => {
      let kind, group;
      if (mode === 'city') {
        ({ kind, group, province: r.province } = classifyCity(r.o.city, rule));
      } else {
        ({ kind, group } = classifyOrder(r.c, state.ctx, rule));
        // Kendi başına okunamayan "devam" sayfası (başı önceki PDF'te) hiçbir zaman 1. gruba alınmaz
        if (r.o.orphan) { kind = 'empty'; group = 'rest'; }
      }
      Object.assign(r, { kind, auto: group, manual: manual.get(i) || null });
      if (r.manual && (!valid.includes(r.manual) || r.manual === r.auto)) { r.manual = null; manual.delete(i); }
      r.group = r.manual || r.auto;
    });
    render();
  }

  /** Sayfa numarası (pageList içinde, 1'den) → grup. Siparişe ait olmayan sayfalar (mükerrer/okunamayan) geri kalan gruba. */
  function pageGroups() {
    const g = new Array(read.pageList.length).fill(restKey());
    for (const r of rows) for (const p of r.o.pageNos) g[p - 1] = r.group;
    return g;
  }

  const KPI_ICON = { only: 'box', rest: 'copy', none: 'gift', in: 'store', out: 'copy' };
  function render() {
    if (!read) return mount($('#out'), '');
    const pg = pageGroups();
    const cnt = (grp) => rows.filter((r) => r.group === grp).length;
    const pages = (grp) => pg.filter((x) => x === grp).length;
    const loose = read.pageList.length - rows.reduce((s, r) => s + r.o.pageNos.length, 0);
    const rest = restKey();
    const kinds = {};
    for (const r of rows) if (r.group === rest) kinds[r.kind] = (kinds[r.kind] || 0) + 1;
    const unmatched = mode === 'product' ? rows.filter((r) => r.kind === 'unmatched') : [];
    const nocity = mode === 'city' ? rows.filter((r) => r.kind === 'nocity') : [];
    const warns = read.log.filter((l) => l.type === 'error' || l.type === 'dup' || l.type === 'warn');
    const G = groups();
    const looseTxt = loose ? `${n(loose)} sipariş dışı sayfa dahil` : '';
    const sub = { only: 'yalnızca seçilenler', rest: looseTxt || 'seçilen + seçim dışı', none: 'seçilenden hiç yok', in: 'alıcısı seçilen ilde', out: looseTxt || 'başka illere giden' };
    const empty = mode === 'city' ? !rule.cities.length : ruleEmpty(rule);
    mount($('#out'), html`<div class="stack">
      <div class="kpis">
        <div class="kpi"><div class="l">${icon('file')}Okunan</div><div class="v">${n(rows.length)}</div><div class="s">sipariş · ${n(read.pageList.length)} sayfa · ${n(read.fileList.length)} dosya</div>
          <button class="btn sm" id="toSite" style="margin-top:8px" title="Dosyaları Etiket Yükle sayfasına aktarır; daha önce kaydedilmiş siparişler orada mükerrer olarak gösterilir">${icon('upload')}Siteye kaydet</button></div>
        ${G.map((g, gi) => html`<div class="kpi ${gi === 0 ? 'hl' : ''}"><div class="l">${icon(KPI_ICON[g])}${gname(g)}</div><div class="v">${n(cnt(g))}</div><div class="s">${n(pages(g))} sayfa · ${sub[g]}</div>
          <div class="row" style="gap:6px;margin-top:8px"><button class="btn sm ${gi === 0 ? 'primary' : ''}" data-dl="${g}" ${pages(g) ? '' : 'disabled'}>${icon('download')}PDF indir</button><button class="btn sm" data-pr="${g}" ${pages(g) ? '' : 'disabled'} title="Dosya açmadan doğrudan yazdır">${icon('printer')}Yazdır</button></div></div>`)}
      </div>
      ${empty ? html`<div class="callout warn">${icon('alert')}<div class="c"><b>${mode === 'city' ? 'İl seçilmedi' : 'Kategori ya da ürün seçilmedi'}</b>Yukarıdan seçim yapın; seçilmezse hiçbir sipariş ayrılmaz.</div></div>` : ''}
      <div class="callout info">${icon('info')}<div class="c"><b>${gname(rest)} grubunda neler var</b>${Object.entries(kinds).map(([k, v]) => `${kindLabel(k)}: ${n(v)}`).join(' · ') || '—'}${loose ? ` · sipariş dışı sayfa (mükerrer/okunamayan): ${n(loose)}` : ''}. Her sayfa dosyalardan yalnızca birinde, PDF'teki sırasıyla yer alır; toplam ${G.map((g) => n(pages(g))).join(' + ')} = ${n(read.pageList.length)} sayfa.</div></div>
      ${unmatched.length ? html`<div class="callout warn">${icon('alert')}<div class="c"><b>${n(unmatched.length)} siparişte tanınmayan ürün var — bunlar ${gname(rest)} grubunda bırakıldı</b>Ürünü <a href="#/matching">Ürün Eşleştirme</a> sayfasından atayıp PDF'i yeniden atın, ya da aşağıdaki listede grubu elle değiştirin.</div></div>` : ''}
      ${nocity.length ? html`<div class="callout warn">${icon('alert')}<div class="c"><b>${n(nocity.length)} etikette il okunamadı — bunlar “Diğer şehirler”de bırakıldı</b>Aşağıdaki listede “İl okunamadı” yazanları kontrol edip gerekirse rozete tıklayarak gruba alın.</div></div>` : ''}
      ${warns.length ? html`<details class="card" style="padding:12px 16px"><summary class="small" style="cursor:pointer">Okuma notları (${warns.length})</summary><div class="small" style="margin-top:8px">${warns.map((l) => html`<div>${l.msg}</div>`)}</div></details>` : ''}
      <div class="card"><div class="card-h"><h2>Siparişler</h2><span class="sub">PDF sırasıyla · grubu değiştirmek için rozete tıklayın (sırayla diğer gruplara geçer)</span></div>
        <div class="tw"><table class="t"><thead><tr><th class="num">Sayfa</th><th>Sipariş</th><th>Şehir</th><th>Ürünler</th><th>Grup</th></tr></thead><tbody>
          ${rows.map((r, i) => html`<tr>
            <td class="num muted small">${r.o.pageNos.join(', ')}</td>
            <td class="nowrap"><b>${r.o.orderNo || '—'}</b><div class="muted xs">${personName(r.o.recipient) || ''}</div><div>${storeTag(r.c.store, r.o.sender)}</div></td>
            <td class="small">${r.o.city || html`<span class="unm">—</span>`}</td>
            <td class="small">${r.c.lines.filter((l) => !l.ignored && l.units).map((l) => html`<div><span class="q">${l.units}x</span> ${l.productId ? html`${pname(l.productId)}${mode === 'product' ? html` <span class="badge ${productInRule(l.productId, state.ctx, rule) ? 'ok' : ''}">${pcat(l.productId) || 'kategorisiz'}</span>` : ''}` : html`<span class="unm">⚠ ${l.raw}</span>`}</div>`)}</td>
            <td><button class="badge ${r.group === G[0] ? 'ok' : r.group === 'none' ? 'info' : ''}" data-flip="${i}" title="${kindLabel(r.kind)}${r.manual ? ' · elle değiştirildi' : ''} — tıklayınca diğer gruba geçer">${gname(r.group)}${r.manual ? ' ✎' : ''}</button><div class="muted xs">${kindLabel(r.kind)}</div></td>
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
      if (r.manual) last.manual[mode].set(i, r.manual); else last.manual[mode].delete(i);
      r.group = next;
      return render();
    }
    if (e.target.closest('#toSite')) {
      handOff(read.fileList);
      toast('Dosyalar Etiket Yükle sayfasına aktarıldı — daha önce kaydedilenler orada mükerrer olarak gösterilir', 'ok');
      return ctx.navigate('upload');
    }
    const pr = e.target.closest('[data-pr]');
    if (pr) {
      busy(pr, true, '');
      try { const pg = pageGroups(); await printPdf(await buildPdf(read.fileList, read.pageList.filter((_, i) => pg[i] === pr.dataset.pr))); } catch (err) { toast(err.message, 'err'); }
      busy(pr, false);
      return;
    }
    const dl = e.target.closest('[data-dl]');
    if (dl) {
      busy(dl, true, 'Hazırlanıyor…');
      try { await save(dl.dataset.dl); } catch (err) { console.error(err); toast('PDF oluşturulamadı: ' + (err.message || err), 'err'); }
      busy(dl, false);
    }
  });

  /** Seçilen gruptaki sayfalar kaynak PDF'ten aynen kopyalanır (içerik değişmez; indirmeden önce doğrulanır). */
  async function save(grp) {
    const pg = pageGroups();
    const refs = read.pageList.filter((_, i) => pg[i] === grp);
    const bytes = await buildPdf(read.fileList, refs);
    const base = read.fileList.length === 1 ? read.fileList[0].name.replace(/\.pdf$/i, '') : 'Etiketler';
    // Dosya adında Türkçe harf kullanılmaz: bazı tarayıcılar/işletim sistemleri adı bozabiliyor
    const tr = { ç: 'c', Ç: 'C', ğ: 'g', Ğ: 'G', ı: 'i', İ: 'I', ö: 'o', Ö: 'O', ş: 's', Ş: 'S', ü: 'u', Ü: 'U' };
    const name = `${base} - ${gname(grp)}.pdf`.replace(/[çÇğĞıİöÖşŞüÜ]/g, (c) => tr[c])
      .normalize('NFKD').replace(/[^\x20-\x7e]/g, '').replace(/[\\/:*?"<>|]+/g, '-');
    download(name, new Blob([bytes], { type: 'application/pdf' }));
    toast(`${name} indirildi (${refs.length} sayfa, kaynakla birebir aynı)`, 'ok');
  }

  showMode();
  drawRuleBar();
  if (read) build();
}
