// Ürün kataloğu + üretim listesi sırası + eşleştirme kuralları.
import { html, mount, icon, modal, confirmDialog, toast, uid, n, esc, emptyState, sortable, collator, selTh, selTd, bulkBar, wireBulk, multiSelect } from '../core/ui.js';
import { api, state, isAdmin, saveSection } from '../core/api.js';
import { createMatcher, autoKeywords } from '../shared/matcher.js';
import { parseProductList, planCatalogReplace } from '../core/catalog.js';
import { brandRules, productExtraStores } from '../shared/calc.js';

let labelNames = null;
const has = (res, id) => res.productId === id || (res.parts || []).some((x) => x.productId === id);
async function getLabelNames() {
  if (!labelNames) labelNames = Object.values((await api.get('labelnames')).names || {});
  return labelNames;
}

/** Ürün düzenleme penceresi — kural değişikliğinin etkisini canlı gösterir */
export async function productForm(product, { presetName } = {}) {
  const isNew = !product;
  const p = product || { id: uid('p'), name: presetName || '', sku: '', brand: '', category: '', unit: 'adet', keywords: '', exclude: '', packMultiplier: false, active: true };
  const names = await getLabelNames().catch(() => []);
  const cats = [...new Set(state.config.products.map((x) => x.category).filter(Boolean))].sort(collator.compare);
  const brands = brandList();
  const noise = state.config.settings.noiseWords;
  let extraStores = productExtraStores(p, state.config.stores);

  const res = await modal({
    title: isNew ? 'Yeni ürün' : 'Ürünü düzenle',
    size: 'lg',
    body: html`<div class="grid g-2" style="align-items:start">
      <div class="form" style="grid-template-columns:1fr 1fr">
        <label class="f full">Ürün adı <span class="hint">Üretim listesinde ve Excel'de görünen ad</span><input class="input" name="name" value="${p.name}" maxlength="120" placeholder="Örn. Detox Shot"></label>
        <label class="f">Marka<input class="input" name="brand" value="${p.brand || ''}" list="brandList" maxlength="60" placeholder="Momordica, Ultra Natura…"><datalist id="brandList">${brands.map((c) => html`<option value="${c}">`)}</datalist></label>
        <label class="f">Kategori<input class="input" name="category" value="${p.category}" list="catList" maxlength="60" placeholder="Shot, Sirke, Toz…"><datalist id="catList">${cats.map((c) => html`<option value="${c}">`)}</datalist></label>
        <label class="f full">Stok kodu (SKU)<input class="input" name="sku" value="${p.sku}" maxlength="60"></label>
        <div class="f full">Ayrıca satıldığı mağazalar <span class="hint">Markası başka mağazalarla sınırlıysa bu ürün yine de seçilen mağazaların etiketlerinde eşleşir (ör. Power Vital Karadut Karamürver → Daily Organics)</span><div id="extraStores"></div></div>
        <label class="f full">Eşleşme kelimeleri <span class="hint">Boş bırakırsanız ürün adından otomatik üretilir. Tüm kelimeler etiket adında geçmeli. <b>/</b> = veya, her satır ayrı bir kural.</span>
          <textarea class="input" name="keywords" rows="3" placeholder="${autoKeywords(p.name || 'detox shot', noise)}">${p.keywords}</textarea></label>
        <label class="f full">Hariç kelimeler <span class="hint">Bu kelimelerden biri geçerse bu ürünle eşleşmez (boşlukla ayırın)</span><input class="input" name="exclude" value="${p.exclude}" placeholder="örn. mix set"></label>
        <label class="switch full"><input type="checkbox" name="packMultiplier" ${p.packMultiplier ? 'checked' : ''}> Paket adedini çarpan olarak uygula <span class="muted small">(“7'li”, “x 14” → adet × 7)</span></label>
        <label class="switch full"><input type="checkbox" name="active" ${p.active !== false ? 'checked' : ''}> Aktif (pasif ürünler eşleştirilmez)</label>
      </div>
      <div class="stack">
        <div class="fieldset" style="padding:12px">
          <h3 style="margin-bottom:8px">${icon('sparkle')} Eşleşme testi</h3>
          <input class="input" id="testName" placeholder="Etiketteki bir ürün adı yazın…">
          <div id="testRes" class="small" style="margin-top:8px"></div>
        </div>
        <div class="fieldset" style="padding:0">
          <div style="padding:10px 12px;border-bottom:1px solid var(--border)"><h3 id="hitTitle">Bu ürüne düşecek etiket adları</h3><div class="muted xs">Şimdiye kadar yüklenen etiketlerden, bu ayarlarla</div></div>
          <div id="hits" style="max-height:300px;overflow:auto"></div>
        </div>
      </div>
    </div>`,
    actions: [{ label: 'Vazgeç', value: 'cancel' }, { label: isNew ? 'Ürünü ekle' : 'Kaydet', value: 'save', variant: 'primary' }],
    onOpen: (d) => {
      multiSelect(d.querySelector('#extraStores'), {
        options: state.config.stores.map((st) => ({ id: st.id, label: st.name, color: st.color })),
        selected: extraStores,
        allLabel: 'Yok (yalnızca marka kuralı)',
        onChange: (v) => { extraStores = v; },
      });
      const read = () => {
        const f = (k) => d.querySelector(`[name=${k}]`);
        return { ...p, name: f('name').value.trim(), category: f('category').value.trim(), brand: f('brand').value.trim(), sku: f('sku').value.trim(), keywords: f('keywords').value.trim(), exclude: f('exclude').value.trim(), packMultiplier: f('packMultiplier').checked, active: f('active').checked };
      };
      const update = () => {
        const next = read();
        d.querySelector('[name=keywords]').placeholder = autoKeywords(next.name || 'detox shot', noise) || '';
        const list = isNew ? [...state.config.products, next] : state.config.products.map((x) => (x.id === p.id ? next : x));
        const cfg = { ...state.config, products: list };
        const m = createMatcher(cfg);
        const before = state.ctx.match;
        const nameOf = (id) => (list.find((x) => x.id === id) || {}).name || '?';
        const hits = [];
        for (const ln of names) {
          const r = m(ln.raw);
          const b = before(ln.raw);
          if (has(r, next.id) || has(b, next.id)) hits.push({ ln, r, b });
        }
        hits.sort((a, b) => b.ln.qty - a.ln.qty);
        d.querySelector('#hitTitle').textContent = `Bu ürüne düşecek etiket adları (${hits.filter((h) => has(h.r, next.id)).length})`;
        mount(d.querySelector('#hits'), hits.length ? html`<table class="t"><tbody>${hits.slice(0, 200).map(({ ln, r, b }) => {
          const gain = has(r, next.id) && !has(b, next.id);
          const loss = !has(r, next.id);
          return html`<tr><td class="small">${ln.raw}${gain ? html` <span class="badge ok">yeni</span>` : ''}${loss ? html` <span class="badge err">çıkacak → ${r.productId ? nameOf(r.productId) : 'eşleşmesiz'}</span>` : ''}${r.method === 'manual' ? html` <span class="badge violet">elle</span>` : ''}</td><td class="num small">${n(ln.qty)}</td></tr>`;
        })}</tbody></table>` : html`<div class="muted small" style="padding:14px">Eşleşen etiket adı yok.</div>`);
        const t = d.querySelector('#testName').value.trim();
        if (t) {
          const r = m(t);
          mount(d.querySelector('#testRes'), r.parts
            ? html`<span class="badge info">Set</span> <b>${r.parts.map((x) => nameOf(x.productId)).join(' + ')}</b> <span class="muted">— iki ayrı ürün olarak sayılır</span>`
            : r.productId
            ? html`<span class="badge ${r.productId === next.id ? 'ok' : 'info'}">${icon('check')} ${nameOf(r.productId)}</span> <span class="muted">${r.method === 'manual' ? 'elle eşleştirilmiş' : `güven %${Math.round(r.confidence * 100)}`}${r.multiplier > 1 ? ` · ×${r.multiplier}` : ''}</span>`
            : r.method === 'ambiguous'
              ? html`<span class="badge warn">Belirsiz</span> <span class="muted">${r.candidates.map(nameOf).join(' / ')} eşit puan aldı</span>`
              : html`<span class="badge err">Eşleşmedi</span>`);
        } else mount(d.querySelector('#testRes'), html`<span class="muted">Örn. “Ultra Natura Detox Shot Zencefilli 7'li”</span>`);
      };
      let t;
      d.addEventListener('input', () => { clearTimeout(t); t = setTimeout(update, 120); });
      d.addEventListener('change', update);
      update();
    },
    onSubmit: async (_, d) => {
      const f = (k) => d.querySelector(`[name=${k}]`);
      const next = { ...p, name: f('name').value.trim(), category: f('category').value.trim(), brand: f('brand').value.trim(), sku: f('sku').value.trim(), keywords: f('keywords').value.trim(), exclude: f('exclude').value.trim(), packMultiplier: f('packMultiplier').checked, active: f('active').checked, stores: extraStores };
      if (!next.name) throw new Error('Ürün adı gerekli');
      const dup = state.config.products.find((x) => x.id !== next.id && x.name.toLocaleLowerCase('tr-TR') === next.name.toLocaleLowerCase('tr-TR') && (x.brand || '').toLocaleLowerCase('tr-TR') === next.brand.toLocaleLowerCase('tr-TR'));
      if (dup) throw new Error(next.brand ? 'Bu markada bu adla bir ürün zaten var' : 'Bu adla bir ürün zaten var');
      const list = isNew ? [...state.config.products, next] : state.config.products.map((x) => (x.id === next.id ? next : x));
      await saveSection('products', list, `${isNew ? 'eklendi' : 'güncellendi'}: ${next.name}`);
      toast(isNew ? 'Ürün eklendi' : 'Ürün kaydedildi', 'ok');
    },
  });
  return res === 'save';
}

const brandList = () => [...new Set(state.config.products.map((x) => x.brand).filter(Boolean))].sort(collator.compare);

/** Excel'den yapıştırılan liste: SKU | Marka | Ürün | Kategori. Kataloğu değiştirir ya da sona ekler. */
async function pasteList() {
  let plan = null;
  let mode = 'replace';
  const res = await modal({
    title: 'Ürün listesini yapıştır',
    size: 'lg',
    body: html`<div class="stack">
      <p class="muted small">Excel'de <b>SKU · Marka · Ürün · Kategori</b> sütunlarını seçip kopyalayın ve aşağıya yapıştırın (Kategori isteğe bağlı; başlık satırı varsa sütun sırası fark etmez). Ürünler <b>bu sırayla</b> listelenir; üretim listesi ve Excel de bu sırayı kullanır.</p>
      <div class="seg" id="pmode" role="tablist">
        <button type="button" class="on" data-m="replace">Kataloğu bu listeyle değiştir</button>
        <button type="button" data-m="append">Mevcut kataloğun sonuna ekle</button>
      </div>
      <textarea class="input" id="plist" rows="9" placeholder="IC-CCN-250ML&#9;Momordica&#9;Coconut Mix&#9;İçecek &amp; Mix&#10;IC-DTX-250ML&#9;Momordica&#9;DetoxMix&#9;İçecek &amp; Mix"></textarea>
      <div id="pprev"></div>
    </div>`,
    actions: [{ label: 'Vazgeç', value: 'cancel' }, { label: 'Kaydet', value: 'save', variant: 'primary' }],
    onOpen: (d) => {
      const ta = d.querySelector('#plist');
      const saveBtn = d.querySelector('.modal-f button[value=save]');
      let t;
      const draw = () => {
        const rows = parseProductList(ta.value);
        if (!rows.length) { plan = null; if (saveBtn) saveBtn.textContent = 'Kaydet'; return mount(d.querySelector('#pprev'), ''); }
        plan = planCatalogReplace(state.config.products, rows, state.config.settings.noiseWords, { mode });
        if (saveBtn) saveBtn.textContent = mode === 'append' ? `${plan.added.length} ürünü ekle` : `Kataloğu ${plan.products.length} ürünle değiştir`;
        const renamed = plan.kept.filter((k) => k.old.name !== k.row.name);
        const noBrand = rows.filter((r) => !r.brand).length;
        mount(d.querySelector('#pprev'), html`
          <div class="callout ${rows.repeats.length ? 'warn' : 'ok'}">${icon(rows.repeats.length ? 'alert' : 'check')}<div class="c">
            <b>${n(rows.lines)} satır yapıştırdınız → ${n(rows.length)} farklı ürün.</b>
            ${rows.repeats.length ? html`<br>${rows.repeats.length} satır listede ikinci kez geçiyor, bir kez alındı:
              <div class="small" style="margin-top:4px">${rows.repeats.map((r) => html`<div>${r.line}. satır = ${r.first}. satır · <b>${r.name}</b>${r.brand ? html` <span class="muted">(${r.brand})</span>` : ''}</div>`)}</div>` : ''}
            ${noBrand ? html`<br><span class="muted">${noBrand} satırda marka yok.</span>` : ''}
          </div></div>
          <div class="kpis" style="margin-top:10px">
            <div class="kpi"><div class="l">${mode === 'append' ? 'Kaydedince katalog' : 'Yeni katalog'}</div><div class="v">${plan.products.length}</div><div class="s">ürün</div></div>
            <div class="kpi"><div class="l">Zaten var (korunur)</div><div class="v">${plan.kept.length}</div><div class="s">${renamed.length ? `${renamed.length} tanesinin adı güncellenir` : 'geçmişi ve kampanyaları korunur'}</div></div>
            <div class="kpi"><div class="l">Yeni eklenecek</div><div class="v">${plan.added.length}</div></div>
            ${mode === 'replace' ? html`<div class="kpi"><div class="l">Katalogdan çıkacak</div><div class="v">${plan.removed.length + plan.merged}</div><div class="s">${plan.merged ? `${plan.merged} tanesi listedeki aynı ürünle birleşir` : 'listede olmayanlar'}</div></div>` : ''}
          </div>
          ${plan.removed.length ? html`<div class="callout warn" style="margin-top:10px">${icon('alert')}<div class="c"><b>Listede olmadığı için silinecek ${plan.removed.length} ürün:</b> ${plan.removed.map((p) => p.name).join(' · ')}</div></div>` : ''}
          ${plan.merged ? html`<details style="margin-top:10px"><summary class="small" style="cursor:pointer">Listedeki ürünle birleşecek ${plan.merged} eski kayıt (etiketleri ve kampanyaları listedeki ürüne geçer)</summary>
            <div class="small" style="margin-top:6px;max-height:200px;overflow:auto">${Object.entries(plan.remap).map(([o, nw]) => html`<div><span class="muted">${(state.config.products.find((p) => p.id === o) || {}).name}</span> → <b>${(plan.products.find((p) => p.id === nw) || {}).name}</b></div>`)}</div></details>` : ''}
          ${renamed.length ? html`<details style="margin-top:6px"><summary class="small" style="cursor:pointer">Adı güncellenecek ${renamed.length} ürün (etiketlerdeki eski adla da eşleşmeye devam eder)</summary>
            <div class="small" style="margin-top:6px;max-height:200px;overflow:auto">${renamed.map((k) => html`<div><span class="muted">${k.old.name}</span> → <b>${k.row.name}</b></div>`)}</div></details>` : ''}
          ${plan.added.length ? html`<details style="margin-top:6px"><summary class="small" style="cursor:pointer">Yeni eklenecek ${plan.added.length} ürün</summary><div class="small" style="margin-top:6px">${plan.added.map((r) => r.name).join(' · ')}</div></details>` : ''}
          ${plan.duplicates.length ? html`<div class="callout info" style="margin-top:10px">${icon('info')}<div class="c"><b>Farklı markalarda aynı adlı ürünler:</b> ${plan.duplicates.join(', ')}. Etiket hangi mağazadan geldiyse o mağazada satılan markanın ürünü sayılır (bkz. <b>Markalar</b>).</div></div>` : ''}`);
      };
      ta.addEventListener('input', () => { clearTimeout(t); t = setTimeout(draw, 200); });
      d.querySelector('#pmode').addEventListener('click', (e) => {
        const b = e.target.closest('[data-m]');
        if (!b) return;
        mode = b.dataset.m;
        d.querySelectorAll('#pmode [data-m]').forEach((x) => x.classList.toggle('on', x === b));
        draw();
      });
      ta.focus();
    },
    onSubmit: async () => {
      if (!plan || !plan.products.length) throw new Error('Önce listeyi yapıştırın');
      if (plan.mode === 'append' && !plan.added.length && !plan.kept.length) throw new Error('Eklenecek ürün yok');
      // Silinen/birleşen ürünlere bağlı kampanya ve eşleştirmeleri yeni kimliklere taşı
      const remap = plan.remap;
      const alive = new Set(plan.products.map((p) => p.id));
      const mapId = (id) => (remap[id] || id);
      const aliases = {};
      for (const [k, a] of Object.entries(state.config.aliases || {})) {
        if (a.productId === '__bundle') aliases[k] = { ...a, parts: (a.parts || []).map((x) => ({ ...x, productId: mapId(x.productId) })).filter((x) => alive.has(x.productId)) };
        else if (a.productId === '__ignore' || alive.has(mapId(a.productId))) aliases[k] = { ...a, productId: a.productId === '__ignore' ? a.productId : mapId(a.productId) };
      }
      const campaigns = (state.config.campaigns || []).map((c) => ({
        ...c,
        triggerProductIds: [...new Set((c.triggerProductIds || []).map(mapId))],
        rewardProductId: c.rewardProductId ? mapId(c.rewardProductId) : '',
        rewards: (c.rewards || []).map((r) => ({ ...r, productId: r.productId ? mapId(r.productId) : '' })),
      }));
      await saveSection('products', plan.products, plan.mode === 'append'
        ? `ürün listesi eklendi: ${plan.added.length} yeni, ${plan.kept.length} güncellendi`
        : `ürün listesi yapıştırıldı: ${plan.products.length} ürün (${plan.added.length} yeni, ${plan.removed.length + plan.merged} çıkarıldı)`);
      if (Object.keys(remap).length) {
        await saveSection('aliases', aliases, 'ürün listesi değişikliği: eşleştirmeler taşındı');
        await saveSection('campaigns', campaigns, 'ürün listesi değişikliği: kampanya ürünleri taşındı');
      }
      toast(`Katalog güncellendi: ${plan.products.length} ürün`, 'ok');
    },
  });
  return res === 'save';
}

/** Markalar: ürün sayısı ve (isteğe bağlı) yalnızca satıldığı mağazalar */
async function brandsDialog() {
  const rules = { ...brandRules(state.config) };
  const brands = brandList();
  const stores = state.config.stores || [];
  const res = await modal({
    title: 'Markalar',
    size: 'lg',
    body: html`<div class="stack">
      <p class="muted small">Bir marka yalnızca belirli mağazalarda satılıyorsa o mağazaları seçin. O markanın ürünleri diğer mağazaların etiketlerinde <b>hiç aday olmaz</b>; böylece farklı markalardaki aynı adlı ürünler (ör. iki “Karamürver ve Karadut Özü”) karışmaz. Boş bırakılan marka tüm mağazalarda sayılır.</p>
      ${brands.length ? html`<div class="tw"><table class="t"><thead><tr><th>Marka</th><th class="num">Ürün</th><th>Yalnızca şu mağazalarda satılır</th></tr></thead><tbody>
        ${brands.map((b) => html`<tr><td><b>${b}</b></td><td class="num">${state.config.products.filter((p) => p.brand === b).length}</td><td><div data-brand="${b}"></div></td></tr>`)}
      </tbody></table></div>` : emptyState('box', 'Henüz marka yok', 'Ürünlere marka girin ya da “Listeyi yapıştır” ile SKU · Marka · Ürün listesini yapıştırın.')}
    </div>`,
    actions: [{ label: 'Vazgeç', value: 'cancel' }, { label: 'Kaydet', value: 'save', variant: 'primary' }],
    onOpen: (d) => {
      d.querySelectorAll('[data-brand]').forEach((el) => {
        const b = el.dataset.brand;
        multiSelect(el, { options: stores.map((s) => ({ id: s.id, label: s.name, color: s.color })), selected: rules[b] || [], allLabel: 'Tüm mağazalar', onChange: (v) => { rules[b] = v; } });
      });
    },
    onSubmit: async () => {
      const clean = Object.fromEntries(brands.map((b) => [b, rules[b] || []]));
      await saveSection('settings', { ...state.config.settings, brandStores: clean }, 'marka → mağaza kuralları');
      toast('Markalar kaydedildi', 'ok');
    },
  });
  return res === 'save';
}

export default async function productsPage(ctx) {
  const admin = isAdmin();
  if (admin) {
    mount(ctx.actions, html`<button class="btn" id="brands">${icon('tag')}Markalar</button><button class="btn" id="paste">${icon('sheet')}Listeyi yapıştır</button><button class="btn primary" id="add">${icon('plus')}Ürün ekle</button>`);
    ctx.actions.querySelector('#paste').addEventListener('click', async () => { if (await pasteList()) render(); });
    ctx.actions.querySelector('#add').addEventListener('click', async () => { if (await productForm()) render(); });
    ctx.actions.querySelector('#brands').addEventListener('click', async () => { if (await brandsDialog()) render(); });
  }
  labelNames = null;
  const names = await getLabelNames().catch(() => []);
  let q = '';
  let cat = '';
  let brand = '';
  const sel = new Set();

  function render() {
    const all = state.config.products;
    const counts = new Map();
    for (const ln of names) {
      const m = state.ctx.match(ln.raw);
      for (const id of m.parts ? m.parts.map((x) => x.productId) : m.productId ? [m.productId] : []) counts.set(id, (counts.get(id) || 0) + 1);
    }
    const cats = [...new Set(all.map((p) => p.category).filter(Boolean))].sort(collator.compare);
    const brands = brandList();
    const rules = brandRules(state.config);
    const storeName = (id) => (state.config.stores.find((s) => s.id === id) || {}).name || '?';
    const ql = q.toLocaleLowerCase('tr-TR');
    const filtered = all.filter((p) => (!cat || p.category === cat) && (!brand || (brand === '-' ? !p.brand : p.brand === brand)) && (!ql || [p.name, p.sku, p.brand, p.category, p.keywords].join(' ').toLocaleLowerCase('tr-TR').includes(ql)));
    const canDrag = admin && !q && !cat && !brand;
    ctx.setSub(`${all.length} ürün · ${all.filter((p) => p.active !== false).length} aktif`);
    mount(ctx.el, html`<div class="stack">
      <div class="callout info">${icon('info')}<div class="c"><b>Bu liste = üretim listesi sırası</b>Excel'deki “Ürün | Gönderilecek Adet” tablosu buradaki sırayla oluşur. ${admin ? 'Satırları tutamaçtan sürükleyin veya sıra numarasını değiştirin; sıra anında kaydedilir.' : ''}</div></div>
      <div class="card" id="pCard">
        <div class="card-h">
          <div class="search" style="width:280px;max-width:100%">${icon('search')}<input class="input sm" id="q" placeholder="Ürün, SKU, kelime ara…" value="${q}"></div>
          <select class="input sm" id="brand" style="width:auto"><option value="">Tüm markalar</option>${brands.map((b) => html`<option value="${b}" ${b === brand ? 'selected' : ''}>${b}</option>`)}${all.some((p) => !p.brand) ? html`<option value="-" ${brand === '-' ? 'selected' : ''}>(Markasız)</option>` : ''}</select>
          <select class="input sm" id="cat" style="width:auto"><option value="">Tüm kategoriler</option>${cats.map((c) => html`<option ${c === cat ? 'selected' : ''}>${c}</option>`)}</select>
          <span class="spacer"></span>${!canDrag && admin ? html`<span class="muted xs">Sıralamak için aramayı/filtreyi temizleyin</span>` : ''}
        </div>
        <div class="tw"><table class="t"><thead><tr>${admin ? selTh() : ''}${canDrag ? html`<th></th>` : ''}<th>Sıra</th><th>Ürün</th><th>Marka</th><th class="hide-m">Kategori</th><th class="num hide-m" title="Bu ürüne eşleşen farklı etiket adı sayısı">Etiket adı</th><th>Durum</th><th></th></tr></thead>
        <tbody id="rows">${filtered.length ? filtered.map((p) => {
          const pos = all.indexOf(p) + 1;
          return html`<tr data-id="${p.id}">
            ${admin ? selTd(p.id, sel) : ''}
            ${canDrag ? html`<td class="grip" title="Sürükle">${icon('grip')}</td>` : ''}
            <td class="pos">${canDrag ? html`<input class="input sm" type="number" min="1" max="${all.length}" value="${pos}" data-pos="${p.id}">` : html`<span class="muted">${pos}</span>`}</td>
            <td><b>${p.name}</b>${p.sku ? html`<div class="muted xs">${p.sku}</div>` : ''}</td>
            <td class="small">${p.brand ? html`${p.brand}${(rules[p.brand] || []).length ? html`<div class="muted xs" title="Bu marka yalnızca bu mağazalarda sayılır">yalnız: ${rules[p.brand].map(storeName).join(', ')}</div>` : ''}` : html`<span class="muted">—</span>`}</td>
            <td class="hide-m">${p.category ? html`<span class="badge">${p.category}</span>` : html`<span class="muted">—</span>`}</td>
            <td class="num hide-m">${counts.get(p.id) ? n(counts.get(p.id)) : html`<span class="muted" title="Henüz bu ürüne eşleşen etiket yok">0</span>`}${p.packMultiplier ? html` <span class="badge info">×paket</span>` : ''}</td>
            <td>${p.active !== false ? html`<span class="badge ok"><span class="dot"></span>Aktif</span>` : html`<span class="badge">Pasif</span>`}</td>
            <td class="num nowrap">${admin ? html`<button class="btn sm ghost icon" data-edit="${p.id}" title="Düzenle">${icon('edit')}</button><button class="btn sm ghost icon danger" data-del="${p.id}" title="Sil">${icon('trash')}</button>` : ''}</td>
          </tr>`;
        }) : html`<tr><td colspan="9">${emptyState('box', all.length ? 'Sonuç yok' : 'Katalog boş', admin && !all.length ? html`Excel'deki ürün listenizi (SKU · Marka · Ürün · Kategori) <b>“Listeyi yapıştır”</b> ile tek seferde ekleyin.` : '')}</td></tr>`}</tbody></table></div>
        ${admin ? bulkBar() : ''}
      </div>
    </div>`);
    if (admin) wireBulk(ctx.el.querySelector('#pCard'), sel, [
      { id: 'brand', label: 'Marka ata' },
      { id: 'cat', label: 'Kategori ata' },
      { id: 'on', label: 'Aktif yap' },
      { id: 'off', label: 'Pasif yap' },
      { id: 'del', label: 'Sil', icon: 'trash', danger: true },
    ], bulkAction);
    const qi = ctx.el.querySelector('#q');
    qi.addEventListener('input', () => { q = qi.value; const pos = qi.selectionStart; render(); const n2 = ctx.el.querySelector('#q'); n2.focus(); n2.setSelectionRange(pos, pos); });
    ctx.el.querySelector('#cat').addEventListener('change', (e) => { cat = e.target.value; render(); });
    ctx.el.querySelector('#brand').addEventListener('change', (e) => { brand = e.target.value; render(); });
    if (canDrag) sortable(ctx.el.querySelector('#rows'), (ids) => saveOrder(ids));
  }

  const usedInCampaigns = (ids) => state.config.campaigns.filter((c) => (c.triggerProductIds || []).some((x) => ids.includes(x)) || ids.includes(c.rewardProductId) || (c.rewards || []).some((r) => ids.includes(r.productId)));

  async function bulkAction(a, ids) {
    const set = new Set(ids);
    const list = state.config.products;
    if (a === 'del') {
      const used = usedInCampaigns(ids);
      if (!(await confirmDialog(html`<b>${ids.length} ürün</b> silinsin mi?<br><br>Bu ürünlere eşleşen etiket satırları “eşleşmeyen” olur ve geçmiş raporlarda görünmez.${used.length ? html`<br><br><span class="unm">${used.length} kampanyada kullanılıyor: ${used.slice(0, 5).map((c) => c.name).join(', ')}${used.length > 5 ? '…' : ''}</span>` : ''}`, { danger: true, ok: `${ids.length} ürünü sil` }))) return false;
      await saveSection('products', list.filter((p) => !set.has(p.id)), `${ids.length} ürün toplu silindi`);
    } else if (a === 'on' || a === 'off') {
      await saveSection('products', list.map((p) => (set.has(p.id) ? { ...p, active: a === 'on' } : p)), `${ids.length} ürün ${a === 'on' ? 'aktif' : 'pasif'} yapıldı`);
    } else if (a === 'cat' || a === 'brand') {
      const field = a === 'cat' ? 'category' : 'brand';
      const label = a === 'cat' ? 'Kategori' : 'Marka';
      let val = null;
      const opts = [...new Set(list.map((p) => p[field]).filter(Boolean))];
      const ok = await modal({
        title: `${ids.length} ürüne ${label.toLocaleLowerCase('tr-TR')} ata`, size: 'sm',
        body: html`<label class="f">${label}<input class="input" name="c" list="bulkOpts" placeholder="Boş = kaldır"><datalist id="bulkOpts">${opts.map((c) => html`<option value="${c}">`)}</datalist></label>`,
        actions: [{ label: 'Vazgeç', value: 'cancel' }, { label: 'Uygula', value: 'ok', variant: 'primary' }],
        onSubmit: (_, d) => { val = d.querySelector('[name=c]').value.trim(); },
      });
      if (ok !== 'ok') return false;
      await saveSection('products', list.map((p) => (set.has(p.id) ? { ...p, [field]: val } : p)), `${ids.length} ürüne ${label.toLocaleLowerCase('tr-TR')}: ${val || '(yok)'}`);
    }
    toast('Güncellendi', 'ok');
    render();
  }

  async function saveOrder(ids) {
    const map = new Map(state.config.products.map((p) => [p.id, p]));
    const list = ids.map((id) => map.get(id)).filter(Boolean);
    if (list.every((p, i) => p === state.config.products[i])) return;
    try {
      await saveSection('products', list, 'sıra değiştirildi');
      toast('Sıra kaydedildi', 'ok');
    } catch (e) { toast(e.message, 'err'); }
    render();
  }

  ctx.el.addEventListener('change', (e) => {
    const inp = e.target.closest('[data-pos]');
    if (!inp) return;
    const ids = state.config.products.map((p) => p.id).filter((id) => id !== inp.dataset.pos);
    const to = Math.min(ids.length, Math.max(0, (parseInt(inp.value, 10) || 1) - 1));
    ids.splice(to, 0, inp.dataset.pos);
    saveOrder(ids);
  });
  ctx.el.addEventListener('click', async (e) => {
    const ed = e.target.closest('[data-edit]');
    if (ed) { if (await productForm(state.config.products.find((p) => p.id === ed.dataset.edit))) render(); return; }
    const dl = e.target.closest('[data-del]');
    if (dl) {
      const p = state.config.products.find((x) => x.id === dl.dataset.del);
      const usedIn = usedInCampaigns([p.id]);
      if (!(await confirmDialog(html`<b>${p.name}</b> silinsin mi?<br><br>Bu ürüne eşleşen etiket satırları “eşleşmeyen” olur ve geçmiş raporlarda görünmez.${usedIn.length ? html`<br><br><span class="unm">${usedIn.length} kampanyada kullanılıyor: ${usedIn.map((c) => c.name).join(', ')}</span>` : ''}<br><br>Geçici olarak devre dışı bırakmak için “Pasif” yapabilirsiniz.`, { danger: true, ok: 'Sil' }))) return;
      await saveSection('products', state.config.products.filter((x) => x.id !== p.id), `silindi: ${p.name}`);
      toast('Ürün silindi');
      render();
    }
  });
  render();
}

export { esc };
