// Ürün eşleştirme merkezi: etiketlerde görülen tüm ürün adları ve katalogdaki karşılıkları.
import { html, mount, icon, toast, n, trDate, emptyState, collator, modal, selTh, selTd, bulkBar, wireBulk } from '../core/ui.js';
import { api, state, isAdmin, saveSection } from '../core/api.js';
import { fold } from '../shared/text.js';
import { IGNORE, BUNDLE } from '../shared/matcher.js';
import { productForm } from './products.js';
import { refreshBadges } from '../app.js';

const FILTERS = [
  ['todo', 'Eşleşmeyen'],
  ['ambiguous', 'Belirsiz'],
  ['low', 'Düşük güven'],
  ['manual', 'Elle atanan'],
  ['auto', 'Otomatik'],
  ['bundle', 'Set (birden çok ürün)'],
  ['ignored', 'Yoksayılan'],
  ['all', 'Tümü'],
];

export default async function matchingPage(ctx) {
  const admin = isAdmin();
  let names = Object.entries((await api.get('labelnames')).names || {}).map(([key, v]) => ({ key, ...v }));
  let filter = ctx.params.f || null;
  let q = '';
  const sel = new Set();

  mount(ctx.actions, html`<a class="btn" href="#/products">${icon('box')}Ürün kataloğu</a>`);

  function classify(r) {
    if (r.ignored) return 'ignored';
    if (r.parts && r.parts.length) return 'bundle';
    if (r.method === 'manual') return 'manual';
    if (r.method === 'ambiguous') return 'ambiguous';
    if (!r.productId) return 'todo';
    if (r.confidence < 0.6) return 'low';
    return 'auto';
  }

  function render() {
    const products = state.config.products.filter((p) => p.active !== false);
    const pname = (id) => (state.ctx.productsById.get(id) || {}).name || '?';
    const rows = names.map((x) => ({ ...x, r: state.ctx.match(x.raw) })).map((x) => ({ ...x, cls: classify(x.r) }));
    const count = Object.fromEntries(FILTERS.map(([k]) => [k, k === 'all' ? rows.length : rows.filter((x) => x.cls === k).length]));
    if (!filter) filter = count.todo ? 'todo' : count.ambiguous ? 'ambiguous' : 'all';
    const ql = q.toLocaleLowerCase('tr-TR');
    const list = rows
      .filter((x) => (filter === 'all' || x.cls === filter) && (!ql || x.raw.toLocaleLowerCase('tr-TR').includes(ql) || (x.r.productId && pname(x.r.productId).toLocaleLowerCase('tr-TR').includes(ql))))
      .sort((a, b) => b.qty - a.qty || collator.compare(a.raw, b.raw));
    const unresolvedQty = rows.filter((x) => x.cls === 'todo' || x.cls === 'ambiguous').reduce((s, x) => s + x.qty, 0);
    ctx.setSub(`${rows.length} farklı etiket adı · ${count.todo + count.ambiguous} bekleyen`);

    mount(ctx.el, html`<div class="stack">
      <div class="kpis">
        <div class="kpi"><div class="l">Farklı etiket adı</div><div class="v">${n(rows.length)}</div><div class="s">Tüm mağazalardan</div></div>
        <div class="kpi"><div class="l">Otomatik eşleşen</div><div class="v">${n(count.auto + count.low)}</div><div class="s">${n(count.low)} tanesi düşük güvenli</div></div>
        <div class="kpi"><div class="l">Elle atanan</div><div class="v">${n(count.manual)}</div><div class="s">${n(count.ignored)} yoksayılan</div></div>
        <div class="kpi ${count.todo + count.ambiguous ? '' : 'hl'}"><div class="l">Bekleyen</div><div class="v">${n(count.todo + count.ambiguous)}</div><div class="s">${n(unresolvedQty)} adet üretim listesine girmiyor</div></div>
      </div>
      <div class="card" id="mCard">
        <div class="card-h" style="gap:12px">
          <div class="seg">${FILTERS.map(([k, l]) => html`<button data-f="${k}" class="${filter === k ? 'on' : ''}">${l} <span class="muted">${count[k]}</span></button>`)}</div>
          <span class="spacer"></span>
          <div class="search" style="width:260px;max-width:100%">${icon('search')}<input class="input sm" id="q" placeholder="Ad veya ürün ara…" value="${q}"></div>
        </div>
        <div class="tw"><table class="t"><thead><tr>${admin ? selTh() : ''}<th>Etiketteki ürün adı</th><th class="num">Toplam adet</th><th>Son görülme</th><th>Durum</th><th style="min-width:260px">Katalogdaki ürün</th><th>Çarpan</th><th></th></tr></thead><tbody>
        ${list.length ? list.slice(0, 500).map((x) => {
          const r = x.r;
          const al = state.config.aliases[x.key];
          const badge = {
            todo: html`<span class="badge err">Eşleşmedi</span>`,
            ambiguous: html`<span class="badge warn" title="${r.candidates.map(pname).join(' / ')}">Belirsiz</span>`,
            low: html`<span class="badge warn">Otomatik · %${Math.round(r.confidence * 100)}</span>`,
            auto: html`<span class="badge ok">Otomatik · %${Math.round(r.confidence * 100)}</span>`,
            manual: html`<span class="badge violet">Elle</span>`,
            ignored: html`<span class="badge">Yoksayıldı</span>`,
            bundle: html`<span class="badge info">Set · ${r.method === 'manual' ? 'elle' : 'otomatik'}</span>`,
          }[x.cls];
          const partsText = r.parts ? r.parts.map((pt) => `${pt.qty > 1 ? pt.qty + '× ' : ''}${pname(pt.productId)}`).join(' + ') : '';
          const autoRes = al ? null : r;
          return html`<tr>
            ${admin ? selTd(x.key, sel) : ''}
            <td><b>${x.raw}</b>${x.cls === 'ambiguous' ? html`<div class="xs unm">Adaylar: ${r.candidates.map(pname).join(' · ')}</div>` : ''}</td>
            <td class="num">${n(x.qty)}</td>
            <td class="small nowrap">${trDate(x.lastSeen)}</td>
            <td>${badge}</td>
            <td>${admin ? html`<select class="input sm" data-key="${x.key}">
                <option value="">${autoRes && autoRes.productId ? `Otomatik → ${pname(autoRes.productId)}` : autoRes && autoRes.parts ? `Otomatik → ${partsText}` : 'Otomatik (eşleşme yok)'}</option>
                <option value="${BUNDLE}" ${al && al.productId === BUNDLE ? 'selected' : ''}>＋ Birden çok ürün (set)…${al && al.productId === BUNDLE ? ' ' + partsText : ''}</option>
                ${r.candidates && r.candidates.length ? html`<optgroup label="Öneriler">${r.candidates.map((id) => html`<option value="${id}" ${al && al.productId === id ? 'selected' : ''}>${pname(id)}</option>`)}</optgroup>` : ''}
                <optgroup label="Tüm ürünler">${products.map((p) => html`<option value="${p.id}" ${al && al.productId === p.id && !(r.candidates || []).includes(p.id) ? 'selected' : ''}>${p.name}</option>`)}</optgroup>
                <option value="${IGNORE}" ${al && al.productId === IGNORE ? 'selected' : ''}>✕ Yoksay (ürün değil)</option>
              </select>${r.parts ? html`<div class="xs" style="margin-top:4px">→ <b>${partsText}</b></div>` : ''}` : r.productId ? html`<b>${pname(r.productId)}</b>` : r.parts ? html`<b>${partsText}</b>` : html`<span class="muted">—</span>`}</td>
            <td>${admin && al && al.productId !== IGNORE && al.productId !== BUNDLE ? html`<input class="input sm" type="number" min="1" max="1000" value="${al.multiplier || 1}" data-mult="${x.key}" style="width:70px" title="Etiketteki 1 adet kaç ürün sayılsın">` : r.multiplier > 1 ? html`×${r.multiplier}` : html`<span class="muted">×1</span>`}</td>
            <td class="num">${admin && !r.productId && !r.ignored ? html`<button class="btn sm" data-newp="${x.raw}" title="Bu adla katalogda yeni ürün oluştur">${icon('plus')}Ürün</button>` : ''}</td>
          </tr>`;
        }) : html`<tr><td colspan="8">${emptyState('link', filter === 'todo' ? 'Bekleyen eşleştirme yok' : 'Kayıt yok', filter === 'todo' ? 'Tüm etiket adları katalogdaki bir ürünle eşleşiyor.' : '')}</td></tr>`}
        </tbody></table></div>
        ${list.length > 500 ? html`<div class="card-f muted small">İlk 500 kayıt gösteriliyor, aramayı daraltın.</div>` : ''}
        ${admin ? bulkBar() : ''}
      </div>
      <div class="callout info">${icon('info')}<div class="c"><b>Otomatik eşleştirme nasıl çalışır?</b>
        Etiket adındaki “Ultra Natura”, “Hediyeli”, gramaj yazımı gibi ekler ayıklanır; ürünün eşleşme kelimelerinin <b>hepsi</b> geçiyorsa eşleşir. Birden çok ürün uyarsa daha fazla kelimesi tutan kazanır (“Detox Shot” ≠ “Detox Mix”). Eşit puanlı durumlar “Belirsiz” olarak buraya düşer. Elle yaptığınız atama her zaman önceliklidir ve geçmiş raporlar da hemen güncellenir.</div></div>
    </div>`);
    if (admin) wireBulk(ctx.el.querySelector('#mCard'), sel, [
      { id: 'assign', label: 'Ürüne ata', icon: 'link' },
      { id: 'ignore', label: 'Yoksay' },
      { id: 'auto', label: 'Otomatiğe döndür' },
    ], bulkAssign);
    const qi = ctx.el.querySelector('#q');
    qi.addEventListener('input', () => { q = qi.value; const pos = qi.selectionStart; render(); const q2 = ctx.el.querySelector('#q'); q2.focus(); q2.setSelectionRange(pos, pos); });
  }

  async function bulkAssign(a, keys) {
    let productId = a === 'ignore' ? IGNORE : '';
    if (a === 'assign') {
      const products = state.config.products.filter((p) => p.active !== false);
      const ok = await modal({
        title: `${keys.length} etiket adını ürüne ata`, size: 'sm',
        body: html`<label class="f">Katalogdaki ürün<select class="input" name="p">${products.map((p) => html`<option value="${p.id}">${p.name}</option>`)}</select></label>`,
        actions: [{ label: 'Vazgeç', value: 'cancel' }, { label: 'Ata', value: 'ok', variant: 'primary' }],
        onSubmit: (_, d) => { productId = d.querySelector('[name=p]').value; },
      });
      if (ok !== 'ok' || !productId) return false;
    }
    const aliases = { ...state.config.aliases };
    for (const k of keys) {
      if (!productId) delete aliases[k];
      else aliases[k] = { productId, multiplier: (aliases[k] && aliases[k].multiplier) || 1, by: state.me.username, at: new Date().toISOString() };
    }
    const pn = productId === IGNORE ? 'yoksay' : productId ? (state.ctx.productsById.get(productId) || {}).name : 'otomatik';
    await saveSection('aliases', aliases, `${keys.length} etiket adı → ${pn}`);
    refreshBadges();
    toast('Eşleştirmeler kaydedildi', 'ok');
    render();
  }

  /** Bir etiket adını birden çok ürüne (set) bağla */
  async function bundleForm(key, raw) {
    const products = state.config.products.filter((p) => p.active !== false);
    const cur = state.ctx.match(raw);
    let parts = cur.parts ? cur.parts.map((x) => ({ ...x })) : (cur.candidates || []).slice(0, 2).map((id) => ({ productId: id, qty: 1 }));
    while (parts.length < 2) parts.push({ productId: (products[parts.length] || products[0] || {}).id || '', qty: 1 });
    const draw = (d) => mount(d.querySelector('#parts'), parts.map((pt, i) => html`<div class="rule-row">
      <select class="input" data-pp="${i}">${products.map((p) => html`<option value="${p.id}" ${pt.productId === p.id ? 'selected' : ''}>${p.name}</option>`)}</select>
      <input class="input" type="number" min="1" value="${pt.qty}" data-pq="${i}" aria-label="Adet">
      <button type="button" class="btn icon ghost danger" data-pd="${i}" ${parts.length <= 1 ? 'disabled' : ''}>${icon('x')}</button></div>`));
    const res = await modal({
      title: 'Set / birleşik ürün',
      body: html`<p class="small" style="margin-bottom:10px"><b>${raw}</b></p>
        <p class="muted small" style="margin-bottom:12px">Etikette bu ad 1 adet yazıyorsa aşağıdaki ürünlerin her biri belirtilen adette sayılır. Etiketteki adet 3 ise hepsi 3 ile çarpılır.</p>
        <div id="parts"></div><button type="button" class="btn sm" id="addPart">${icon('plus')}Ürün ekle</button>`,
      actions: [{ label: 'Vazgeç', value: 'cancel' }, { label: 'Kaydet', value: 'save', variant: 'primary' }],
      onOpen: (d) => {
        draw(d);
        d.querySelector('#parts').addEventListener('change', (e) => {
          if (e.target.dataset.pp != null) parts[+e.target.dataset.pp].productId = e.target.value;
          if (e.target.dataset.pq != null) parts[+e.target.dataset.pq].qty = Math.max(1, parseInt(e.target.value, 10) || 1);
        });
        d.querySelector('#parts').addEventListener('click', (e) => { const b = e.target.closest('[data-pd]'); if (b && parts.length > 1) { parts.splice(+b.dataset.pd, 1); draw(d); } });
        d.querySelector('#addPart').addEventListener('click', () => { parts.push({ productId: (products[0] || {}).id || '', qty: 1 }); draw(d); });
      },
      onSubmit: async () => {
        const clean = parts.filter((x) => x.productId);
        if (!clean.length) throw new Error('En az bir ürün seçin');
        const aliases = { ...state.config.aliases, [key]: { productId: BUNDLE, parts: clean, by: state.me.username, at: new Date().toISOString() } };
        await saveSection('aliases', aliases, `${raw} → set: ${clean.map((x) => (state.ctx.productsById.get(x.productId) || {}).name).join(' + ')}`);
        refreshBadges();
      },
    });
    return res === 'save';
  }

  async function setAlias(key, productId, multiplier) {
    const aliases = { ...state.config.aliases };
    if (!productId) delete aliases[key];
    else aliases[key] = { productId, multiplier: multiplier || (aliases[key] && aliases[key].multiplier) || 1, by: state.me.username, at: new Date().toISOString() };
    const raw = (names.find((x) => x.key === key) || {}).raw || key;
    const pn = productId === IGNORE ? 'yoksay' : productId ? (state.ctx.productsById.get(productId) || {}).name : 'otomatik';
    await saveSection('aliases', aliases, `${raw} → ${pn}`);
    refreshBadges();
  }

  ctx.el.addEventListener('click', async (e) => {
    const f = e.target.closest('[data-f]');
    if (f) { filter = f.dataset.f; return render(); }
    const np = e.target.closest('[data-newp]');
    if (np) {
      if (await productForm(null, { presetName: np.dataset.newp })) {
        const r = state.ctx.match(np.dataset.newp);
        if (!r.productId) {
          const created = state.config.products[state.config.products.length - 1];
          await setAlias(fold(np.dataset.newp), created.id);
        }
        toast('Ürün oluşturuldu ve eşleştirildi', 'ok');
        render();
      }
    }
  });
  ctx.el.addEventListener('change', async (e) => {
    const s = e.target.closest('[data-key]');
    if (s && s.value === BUNDLE) {
      const row = names.find((x) => x.key === s.dataset.key);
      try { if (await bundleForm(s.dataset.key, row ? row.raw : s.dataset.key)) toast('Set kaydedildi', 'ok'); } catch (err) { toast(err.message, 'err'); }
      return render();
    }
    if (s) {
      try { await setAlias(s.dataset.key, s.value); toast('Eşleştirme kaydedildi', 'ok'); } catch (err) { toast(err.message, 'err'); }
      return render();
    }
    const m = e.target.closest('[data-mult]');
    if (m) {
      const al = state.config.aliases[m.dataset.mult];
      if (!al) return;
      try { await setAlias(m.dataset.mult, al.productId, Math.max(1, parseInt(m.value, 10) || 1)); toast('Çarpan kaydedildi', 'ok'); } catch (err) { toast(err.message, 'err'); }
      render();
    }
  });
  render();
}
