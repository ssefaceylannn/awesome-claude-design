// Ürün kataloğu + üretim listesi sırası + eşleştirme kuralları.
import { html, mount, icon, modal, confirmDialog, toast, uid, n, esc, emptyState, sortable, collator } from '../core/ui.js';
import { api, state, isAdmin, saveSection } from '../core/api.js';
import { createMatcher, autoKeywords } from '../shared/matcher.js';

let labelNames = null;
async function getLabelNames() {
  if (!labelNames) labelNames = Object.values((await api.get('labelnames')).names || {});
  return labelNames;
}

/** Ürün düzenleme penceresi — kural değişikliğinin etkisini canlı gösterir */
export async function productForm(product, { presetName } = {}) {
  const isNew = !product;
  const p = product || { id: uid('p'), name: presetName || '', sku: '', category: '', unit: 'adet', keywords: '', exclude: '', packMultiplier: false, active: true };
  const names = await getLabelNames().catch(() => []);
  const cats = [...new Set(state.config.products.map((x) => x.category).filter(Boolean))].sort(collator.compare);
  const noise = state.config.settings.noiseWords;

  const res = await modal({
    title: isNew ? 'Yeni ürün' : 'Ürünü düzenle',
    size: 'lg',
    body: html`<div class="grid g-2" style="align-items:start">
      <div class="form" style="grid-template-columns:1fr 1fr">
        <label class="f full">Ürün adı <span class="hint">Üretim listesinde ve Excel'de görünen ad</span><input class="input" name="name" value="${p.name}" maxlength="120" placeholder="Örn. Detox Shot"></label>
        <label class="f">Kategori<input class="input" name="category" value="${p.category}" list="catList" maxlength="60" placeholder="Shot, Sirke, Toz…"><datalist id="catList">${cats.map((c) => html`<option value="${c}">`)}</datalist></label>
        <label class="f">Stok kodu (SKU)<input class="input" name="sku" value="${p.sku}" maxlength="60"></label>
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
      const read = () => {
        const f = (k) => d.querySelector(`[name=${k}]`);
        return { ...p, name: f('name').value.trim(), category: f('category').value.trim(), sku: f('sku').value.trim(), keywords: f('keywords').value.trim(), exclude: f('exclude').value.trim(), packMultiplier: f('packMultiplier').checked, active: f('active').checked };
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
          if (r.productId === next.id || b.productId === next.id) hits.push({ ln, r, b });
        }
        hits.sort((a, b) => b.ln.qty - a.ln.qty);
        d.querySelector('#hitTitle').textContent = `Bu ürüne düşecek etiket adları (${hits.filter((h) => h.r.productId === next.id).length})`;
        mount(d.querySelector('#hits'), hits.length ? html`<table class="t"><tbody>${hits.slice(0, 200).map(({ ln, r, b }) => {
          const gain = r.productId === next.id && b.productId !== next.id;
          const loss = r.productId !== next.id;
          return html`<tr><td class="small">${ln.raw}${gain ? html` <span class="badge ok">yeni</span>` : ''}${loss ? html` <span class="badge err">çıkacak → ${r.productId ? nameOf(r.productId) : 'eşleşmesiz'}</span>` : ''}${r.method === 'manual' ? html` <span class="badge violet">elle</span>` : ''}</td><td class="num small">${n(ln.qty)}</td></tr>`;
        })}</tbody></table>` : html`<div class="muted small" style="padding:14px">Eşleşen etiket adı yok.</div>`);
        const t = d.querySelector('#testName').value.trim();
        if (t) {
          const r = m(t);
          mount(d.querySelector('#testRes'), r.productId
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
      const next = { ...p, name: f('name').value.trim(), category: f('category').value.trim(), sku: f('sku').value.trim(), keywords: f('keywords').value.trim(), exclude: f('exclude').value.trim(), packMultiplier: f('packMultiplier').checked, active: f('active').checked };
      if (!next.name) throw new Error('Ürün adı gerekli');
      const dup = state.config.products.find((x) => x.id !== next.id && x.name.toLocaleLowerCase('tr-TR') === next.name.toLocaleLowerCase('tr-TR'));
      if (dup) throw new Error('Bu adla bir ürün zaten var');
      const list = isNew ? [...state.config.products, next] : state.config.products.map((x) => (x.id === next.id ? next : x));
      await saveSection('products', list, `${isNew ? 'eklendi' : 'güncellendi'}: ${next.name}`);
      toast(isNew ? 'Ürün eklendi' : 'Ürün kaydedildi', 'ok');
    },
  });
  return res === 'save';
}

async function bulkAdd() {
  const res = await modal({
    title: 'Toplu ürün ekle',
    body: html`<p class="muted small" style="margin-bottom:10px">Her satıra bir ürün yazın. İsterseniz kategoriyi <b>|</b> ile ekleyin. Ürünler bu sırayla listenin sonuna eklenir.</p>
      <textarea class="input" name="bulk" rows="12" placeholder="Detox Shot | Shot&#10;Detox Mix | Toz&#10;Zencefil Shot | Shot&#10;Sultan Sirkesi 500ml | Sirke"></textarea>`,
    actions: [{ label: 'Vazgeç', value: 'cancel' }, { label: 'Ekle', value: 'save', variant: 'primary' }],
    onSubmit: async (_, d) => {
      const have = new Set(state.config.products.map((p) => p.name.toLocaleLowerCase('tr-TR')));
      const add = [];
      for (const line of d.querySelector('[name=bulk]').value.split('\n')) {
        const [name, category = ''] = line.split('|').map((x) => x.trim());
        if (!name || have.has(name.toLocaleLowerCase('tr-TR'))) continue;
        have.add(name.toLocaleLowerCase('tr-TR'));
        add.push({ id: uid('p'), name, category, sku: '', unit: 'adet', keywords: '', exclude: '', packMultiplier: false, active: true });
      }
      if (!add.length) throw new Error('Eklenecek yeni ürün yok');
      await saveSection('products', [...state.config.products, ...add], `${add.length} ürün toplu eklendi`);
      toast(`${add.length} ürün eklendi`, 'ok');
    },
  });
  return res === 'save';
}

export default async function productsPage(ctx) {
  const admin = isAdmin();
  if (admin) {
    mount(ctx.actions, html`<button class="btn" id="bulk">${icon('copy')}Toplu ekle</button><button class="btn primary" id="add">${icon('plus')}Ürün ekle</button>`);
    ctx.actions.querySelector('#add').addEventListener('click', async () => { if (await productForm()) render(); });
    ctx.actions.querySelector('#bulk').addEventListener('click', async () => { if (await bulkAdd()) render(); });
  }
  labelNames = null;
  const names = await getLabelNames().catch(() => []);
  let q = '';
  let cat = '';

  function render() {
    const all = state.config.products;
    const counts = new Map();
    for (const ln of names) {
      const m = state.ctx.match(ln.raw);
      if (m.productId) counts.set(m.productId, (counts.get(m.productId) || 0) + 1);
    }
    const cats = [...new Set(all.map((p) => p.category).filter(Boolean))].sort(collator.compare);
    const ql = q.toLocaleLowerCase('tr-TR');
    const filtered = all.filter((p) => (!cat || p.category === cat) && (!ql || [p.name, p.sku, p.category, p.keywords].join(' ').toLocaleLowerCase('tr-TR').includes(ql)));
    const canDrag = admin && !q && !cat;
    ctx.setSub(`${all.length} ürün · ${all.filter((p) => p.active !== false).length} aktif`);
    mount(ctx.el, html`<div class="stack">
      <div class="callout info">${icon('info')}<div class="c"><b>Bu liste = üretim listesi sırası</b>Excel'deki “Ürün | Gönderilecek Adet” tablosu buradaki sırayla oluşur. ${admin ? 'Satırları tutamaçtan sürükleyin veya sıra numarasını değiştirin; sıra anında kaydedilir.' : ''}</div></div>
      <div class="card">
        <div class="card-h">
          <div class="search" style="width:280px;max-width:100%">${icon('search')}<input class="input sm" id="q" placeholder="Ürün, SKU, kelime ara…" value="${q}"></div>
          <select class="input sm" id="cat" style="width:auto"><option value="">Tüm kategoriler</option>${cats.map((c) => html`<option ${c === cat ? 'selected' : ''}>${c}</option>`)}</select>
          <span class="spacer"></span>${!canDrag && admin ? html`<span class="muted xs">Sıralamak için aramayı/filtreyi temizleyin</span>` : ''}
        </div>
        <div class="tw"><table class="t"><thead><tr>${canDrag ? html`<th></th>` : ''}<th>Sıra</th><th>Ürün</th><th>Kategori</th><th>Eşleşme kuralı</th><th class="num">Etiket adı</th><th>Durum</th><th></th></tr></thead>
        <tbody id="rows">${filtered.length ? filtered.map((p) => {
          const pos = all.indexOf(p) + 1;
          return html`<tr data-id="${p.id}">
            ${canDrag ? html`<td class="grip" title="Sürükle">${icon('grip')}</td>` : ''}
            <td class="pos">${canDrag ? html`<input class="input sm" type="number" min="1" max="${all.length}" value="${pos}" data-pos="${p.id}">` : html`<span class="muted">${pos}</span>`}</td>
            <td><b>${p.name}</b>${p.sku ? html`<div class="muted xs">${p.sku}</div>` : ''}</td>
            <td>${p.category ? html`<span class="badge">${p.category}</span>` : html`<span class="muted">—</span>`}</td>
            <td class="small">${p.keywords ? html`<code>${p.keywords.replace(/\n/g, ' ‖ ')}</code>` : html`<span class="muted">otomatik: ${autoKeywords(p.name, state.config.settings.noiseWords)}</span>`}${p.exclude ? html`<div class="xs unm">hariç: ${p.exclude}</div>` : ''}${p.packMultiplier ? html` <span class="badge info">×paket</span>` : ''}</td>
            <td class="num">${n(counts.get(p.id) || 0)}</td>
            <td>${p.active !== false ? html`<span class="badge ok"><span class="dot"></span>Aktif</span>` : html`<span class="badge">Pasif</span>`}</td>
            <td class="num nowrap">${admin ? html`<button class="btn sm ghost icon" data-edit="${p.id}" title="Düzenle">${icon('edit')}</button><button class="btn sm ghost icon danger" data-del="${p.id}" title="Sil">${icon('trash')}</button>` : ''}</td>
          </tr>`;
        }) : html`<tr><td colspan="8">${emptyState('box', all.length ? 'Sonuç yok' : 'Katalog boş', admin && !all.length ? html`“Ürün ekle” veya “Toplu ekle” ile ürünlerinizi <b>üretim listesinde görmek istediğiniz sırayla</b> girin.` : '')}</td></tr>`}</tbody></table></div>
      </div>
    </div>`);
    const qi = ctx.el.querySelector('#q');
    qi.addEventListener('input', () => { q = qi.value; const pos = qi.selectionStart; render(); const n2 = ctx.el.querySelector('#q'); n2.focus(); n2.setSelectionRange(pos, pos); });
    ctx.el.querySelector('#cat').addEventListener('change', (e) => { cat = e.target.value; render(); });
    if (canDrag) sortable(ctx.el.querySelector('#rows'), (ids) => saveOrder(ids));
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
      const usedIn = state.config.campaigns.filter((c) => (c.triggerProductIds || []).includes(p.id) || c.rewardProductId === p.id);
      if (!(await confirmDialog(html`<b>${p.name}</b> silinsin mi?<br><br>Bu ürüne eşleşen etiket satırları “eşleşmeyen” olur ve geçmiş raporlarda görünmez.${usedIn.length ? html`<br><br><span class="unm">${usedIn.length} kampanyada kullanılıyor: ${usedIn.map((c) => c.name).join(', ')}</span>` : ''}<br><br>Geçici olarak devre dışı bırakmak için “Pasif” yapabilirsiniz.`, { danger: true, ok: 'Sil' }))) return;
      await saveSection('products', state.config.products.filter((x) => x.id !== p.id), `silindi: ${p.name}`);
      toast('Ürün silindi');
      render();
    }
  });
  render();
}

export { esc };
