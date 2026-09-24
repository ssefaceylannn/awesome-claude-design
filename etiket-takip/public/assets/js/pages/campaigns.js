// Kampanyalar: kampanya türleri (hazır + sizin eklediğiniz), mağaza/platform kapsamı,
// "sadece bu ürünler / bu ürünler hariç" seçimi, koşul, çoklu hediye, toplu işlemler.
import { html, mount, icon, modal, confirmDialog, toast, uid, trDate, today, addDays, emptyState, multiSelect, PLATFORMS, pLabel, pBadge, collator, n, selTh, selTd, bulkBar, wireBulk } from '../core/ui.js';
import { state, isAdmin, saveSection } from '../core/api.js';
import { normCampaign } from '../shared/calc.js';

/** Hazır kampanya türleri. rule alanları formu doldurur. */
export const BUILTIN_TYPES = [
  { id: 'roundup2', name: 'Adedi çifte tamamla (1 alana 2, 3 alana 4 gider)', rule: { condition: 'qty', countMode: 'each', mode: 'roundup', minQty: 2, rewardSame: true, rewardQty: 1 } },
  { id: 'second_1tl', name: '2. ürün 1 TL (tek ürünlü, 1 adetlik siparişe +1 aynı üründen)', rule: { condition: 'qty', countMode: 'each', mode: 'once', minQty: 1, maxQty: 1, pureOnly: true, rewardSame: true, rewardQty: 1 } },
  { id: 'bogo', name: 'X alana Y bedava (aynı üründen)', rule: { condition: 'qty', countMode: 'each', mode: 'every', minQty: 2, rewardSame: true, rewardQty: 1 } },
  { id: 'gift_every', name: 'Her X adette hediye ürün', rule: { condition: 'qty', countMode: 'each', mode: 'every', minQty: 1, rewardSame: false, rewardQty: 1 } },
  { id: 'gift_once', name: 'En az X adet alana bir kez hediye', rule: { condition: 'qty', countMode: 'each', mode: 'once', minQty: 1, rewardSame: false, rewardQty: 1 } },
  { id: 'basket_once', name: 'Sepette toplam X adet → hediye (karışık ürünler)', rule: { condition: 'qty', countMode: 'sum', mode: 'once', minQty: 3, rewardSame: false, rewardQty: 1 } },
  { id: 'basket_every', name: 'Sepette her X adette hediye (karışık ürünler)', rule: { condition: 'qty', countMode: 'sum', mode: 'every', minQty: 3, rewardSame: false, rewardQty: 1 } },
  { id: 'basket_same', name: 'Karışık X adet alana en çok alınandan 1 bedava', rule: { condition: 'qty', countMode: 'sum', mode: 'every', minQty: 3, rewardSame: true, rewardQty: 1 } },
  { id: 'distinct', name: 'X farklı ürün alana hediye', rule: { condition: 'distinct', countMode: 'each', mode: 'once', minQty: 3, rewardSame: false, rewardQty: 1 } },
  { id: 'amount', name: 'Sipariş tutarı X TL ve üzeri → hediye', rule: { condition: 'amount', countMode: 'each', mode: 'once', minQty: 1, minAmount: 500, rewardSame: false, rewardQty: 1 } },
  { id: 'amount_every', name: 'Her X TL için hediye', rule: { condition: 'amount', countMode: 'each', mode: 'every', minQty: 1, minAmount: 500, rewardSame: false, rewardQty: 1 } },
  { id: 'every_order', name: 'Her siparişe hediye', rule: { condition: 'order', countMode: 'each', mode: 'once', minQty: 1, rewardSame: false, rewardQty: 1 } },
  { id: 'bundle', name: 'Hediye paketi (birden çok ürün birlikte)', rule: { condition: 'qty', countMode: 'sum', mode: 'once', minQty: 1, rewardSame: false, rewardQty: 1 } },
  { id: 'custom', name: 'Özel (tüm ayarlar serbest)', rule: null },
];
const COND_LABEL = { qty: 'Ürün adedi', distinct: 'Farklı ürün sayısı', amount: 'Sipariş tutarı (TL)', order: 'Her sipariş (koşulsuz)' };

export function campaignStatus(c) {
  const t = today();
  if (c.archived) return { k: 'archived', label: 'Arşiv', cls: '' };
  if (!c.active) return { k: 'paused', label: 'Durduruldu', cls: 'err' };
  if (c.start && c.start > t) return { k: 'planned', label: 'Planlandı', cls: 'info' };
  if (c.end && c.end < t) return { k: 'ended', label: 'Sona erdi', cls: '' };
  return { k: 'live', label: 'Yayında', cls: 'ok' };
}

const pn = (id) => state.ctx.label(id);
const allTypes = () => [...BUILTIN_TYPES, ...(state.config.campaignTemplates || [])];

function productScope(c) {
  const names = c.triggerProductIds.map(pn);
  const list = names.length <= 3 ? names.join(', ') : `${names.length} ürün`;
  if (!names.length) return 'tüm ürünler';
  return c.productMode === 'exclude' ? `${list} hariç tüm ürünler` : list;
}

export function describe(raw) {
  const c = normCampaign(raw);
  const reward = c.rewards.map((r) => `${r.qty} adet ${r.productId ? pn(r.productId) : 'aynı üründen'}`).join(' + ');
  const scope = productScope(c);
  const every = c.mode === 'every';
  let s;
  if (c.condition === 'order') s = `${scope} içeren her siparişe ${reward}`;
  else if (c.condition === 'amount') s = every ? `${scope} içeren siparişlerde her ${n(c.minAmount)} TL için ${reward}` : `${n(c.minAmount)} TL ve üzeri siparişe (${scope}) bir kez ${reward}`;
  else if (c.condition === 'distinct') s = every ? `${scope} arasından her ${c.minQty} farklı ürün için ${reward}` : `${scope} arasından en az ${c.minQty} farklı ürün alana bir kez ${reward}`;
  else if (c.mode === 'roundup') s = `${scope}: adet ${c.minQty}'nin katına tamamlanır (eksik kalan kadar ${c.rewards.map((r) => (r.productId ? pn(r.productId) : 'aynı üründen')).join(' + ')} eklenir${c.countMode === 'sum' ? ', seçili ürünlerin toplamına göre' : c.triggerProductIds.length !== 1 ? ', her ürün ayrı' : ''})`;
  else if (c.countMode === 'sum') s = every ? `${scope} toplamında her ${c.minQty} adette ${reward}` : `${scope} toplamı en az ${c.minQty} adet olan siparişe bir kez ${reward}`;
  else s = every ? `${scope}: her ${c.minQty} adette ${reward}${c.triggerProductIds.length !== 1 ? ' (her ürün ayrı sayılır)' : ''}` : `${scope}: en az ${c.minQty} adet alana bir kez ${reward}${c.triggerProductIds.length !== 1 ? ' (her ürün ayrı)' : ''}`;
  if (c.maxQty) s += ` · ${c.maxQty} adetten fazla alınırsa uygulanmaz`;
  if (c.pureOnly) s += ' · karışık siparişte (başka ürün varsa) uygulanmaz';
  if (c.maxPerOrder) s += ` · sipariş başına en fazla ${c.maxPerOrder} adet`;
  return s;
}

function scopeText(raw) {
  const c = normCampaign(raw);
  const pf = c.platforms.length ? c.platforms.map(pLabel).join(', ') : 'Tüm platformlar';
  const names = state.config.stores.filter((s) => c.storeIds.includes(s.id)).map((s) => s.name).join(', ');
  const st = !c.storeIds.length ? 'tüm mağazalar' : c.storeMode === 'exclude' ? `${names} hariç` : names;
  return `${pf} · ${st}`;
}

async function saveTemplate(rule) {
  let name = '';
  const ok = await modal({
    title: 'Yeni kampanya türü',
    size: 'sm',
    body: html`<p class="muted small" style="margin-bottom:10px">Formdaki kural (koşul, uygulama şekli, adetler) bu adla kaydedilir; sonraki kampanyalarda “Kampanya türü” listesinden seçebilirsiniz.</p>
      <label class="f">Tür adı<input class="input" name="tname" maxlength="80" placeholder="Örn. 3 al 1 hediye kolonya"></label>
      <label class="f" style="margin-top:10px">Açıklama (isteğe bağlı)<input class="input" name="tdesc" maxlength="300"></label>`,
    actions: [{ label: 'Vazgeç', value: 'cancel' }, { label: 'Türü kaydet', value: 'save', variant: 'primary' }],
    onSubmit: async (_, d) => {
      name = d.querySelector('[name=tname]').value.trim();
      if (!name) throw new Error('Tür adı gerekli');
      if (allTypes().some((t) => t.name.toLocaleLowerCase('tr-TR') === name.toLocaleLowerCase('tr-TR'))) throw new Error('Bu adla bir tür zaten var');
      const t = { id: uid('t'), name, description: d.querySelector('[name=tdesc]').value.trim(), rule };
      await saveSection('campaignTemplates', [...(state.config.campaignTemplates || []), t], `kampanya türü eklendi: ${name}`);
    },
  });
  return ok === 'save' ? state.config.campaignTemplates[state.config.campaignTemplates.length - 1] : null;
}

async function campaignForm(camp, { copy = false } = {}) {
  const isNew = !camp || copy;
  const base = camp
    ? { ...normCampaign(camp), templateId: camp.templateId || 'custom', ...(copy ? { id: uid('c'), name: camp.name + ' (kopya)', archived: false, createdAt: '', createdBy: '' } : {}) }
    : normCampaign({ id: uid('c'), name: '', note: '', active: true, archived: false, templateId: 'bogo', ...ruleToFields(BUILTIN_TYPES[0].rule), start: today(), end: '' });
  let c = { ...base, rewards: base.rewards.map((r) => ({ ...r })) };
  const products = state.config.products.filter((p) => p.active !== false || c.triggerProductIds.includes(p.id) || c.rewards.some((r) => r.productId === p.id));
  const stores = [...state.config.stores].sort((a, b) => collator.compare(pLabel(a.platform), pLabel(b.platform)) || collator.compare(a.name, b.name));
  const usedPf = PLATFORMS.filter((p) => stores.some((s) => s.platform === p.id) || c.platforms.includes(p.id));
  const typeOptions = () => html`<optgroup label="Hazır türler">${BUILTIN_TYPES.map((t) => html`<option value="${t.id}" ${c.templateId === t.id ? 'selected' : ''}>${t.name}</option>`)}</optgroup>
    ${(state.config.campaignTemplates || []).length ? html`<optgroup label="Eklediğiniz türler">${state.config.campaignTemplates.map((t) => html`<option value="${t.id}" ${c.templateId === t.id ? 'selected' : ''}>${t.name}</option>`)}</optgroup>` : ''}`;

  const res = await modal({
    title: isNew ? 'Yeni kampanya' : 'Kampanyayı düzenle',
    size: 'lg',
    body: html`<div class="stack">
      <div class="form">
        <label class="f full">Kampanya türü <span class="hint">Seçtiğiniz tür kuralı doldurur; sonra dilediğiniz gibi değiştirebilirsiniz.</span>
          <div class="row"><select class="input" name="templateId" style="flex:1">${typeOptions()}</select><button type="button" class="btn" id="saveType" title="Bu kuralı yeni tür olarak kaydet">${icon('plus')}Yeni tür</button></div></label>
        <label class="f full">Kampanya adı<input class="input" name="name" value="${c.name}" maxlength="120" placeholder="Örn. Trendyol Detox Shot 2 al 1 bedava"></label>
        <label class="f full">Açıklama <span class="hint">İsteğe bağlı iç not</span><input class="input" name="note" value="${c.note || ''}" maxlength="500"></label>
      </div>
      <fieldset class="fieldset"><legend>1 · Hangi mağazalarda?</legend>
        <div class="stack" style="gap:12px">
          <div><div class="small muted" style="margin-bottom:6px">Platform (hiçbiri seçilmezse tümü)</div>
            <div class="row wrap">${usedPf.map((p) => html`<label class="check"><input type="checkbox" name="pf" value="${p.id}" ${c.platforms.includes(p.id) ? 'checked' : ''}>${pBadge(p.id)}</label>`)}</div></div>
          <div><div class="row wrap" style="margin-bottom:6px"><span class="small muted">Mağaza</span>
            <div class="seg" data-seg="storeMode"><button type="button" data-v="include" class="${c.storeMode === 'include' ? 'on' : ''}">Seçilenlerde geçerli</button><button type="button" data-v="exclude" class="${c.storeMode === 'exclude' ? 'on' : ''}">Seçilenler hariç</button></div>
            <span class="muted xs">Hiçbiri seçilmezse tüm mağazalar</span></div>
            <div class="grid g-3" style="gap:6px" id="storeBox">${stores.map((s) => html`<label class="check" data-pf="${s.platform}"><input type="checkbox" name="st" value="${s.id}" ${c.storeIds.includes(s.id) ? 'checked' : ''}><span class="sdot" style="background:${s.color}"></span>${s.name}</label>`)}</div>
            ${stores.length ? '' : html`<div class="muted small">Henüz mağaza tanımlanmadı.</div>`}</div>
        </div>
      </fieldset>
      <fieldset class="fieldset"><legend>2 · Hangi ürünlerde?</legend>
        <div class="row wrap" style="margin-bottom:8px">
          <div class="seg" data-seg="productMode"><button type="button" data-v="include" class="${c.productMode === 'include' ? 'on' : ''}">Sadece seçilen ürünlerde</button><button type="button" data-v="exclude" class="${c.productMode === 'exclude' ? 'on' : ''}">Seçilen ürünler hariç</button></div>
          <span class="muted xs">Hiç ürün seçmezseniz kampanya <b>tüm ürünlere</b> uygulanır.</span></div>
        <div id="trig"></div>
      </fieldset>
      <fieldset class="fieldset"><legend>3 · Koşul</legend>
        <div class="form">
          <label class="f">Neye bakılsın?<select class="input" name="condition">${Object.entries(COND_LABEL).map(([k, l]) => html`<option value="${k}" ${c.condition === k ? 'selected' : ''}>${l}</option>`)}</select></label>
          <label class="f" data-show="qty distinct"><span>En az kaç <span data-lbl></span></span><input class="input" type="number" name="minQty" min="1" value="${c.minQty}"></label>
          <label class="f" data-show="amount">En az tutar (TL) <span class="hint">Tutar yalnızca Excel yüklemelerinde bulunur</span><input class="input" type="number" name="minAmount" min="0" step="0.01" value="${c.minAmount || ''}"></label>
          <label class="f" data-show="qty distinct amount">Uygulama şekli<select class="input" name="mode"><option value="every" ${c.mode === 'every' ? 'selected' : ''}>Katlanarak (her X'te bir)</option><option value="once" ${c.mode === 'once' ? 'selected' : ''}>Sipariş başına bir kez</option><option value="roundup" ${c.mode === 'roundup' ? 'selected' : ''}>Katına tamamla (X=2: 1→2, 3→4)</option></select></label>
          <label class="f" data-show="qty">Ürünler nasıl sayılsın?<select class="input" name="countMode"><option value="each" ${c.countMode !== 'sum' ? 'selected' : ''}>Her ürün ayrı sayılır</option><option value="sum" ${c.countMode === 'sum' ? 'selected' : ''}>Seçili ürünlerin toplamı (karışık sepet)</option></select></label>
          <label class="f" data-show="qty distinct">En fazla kaç <span class="hint">Bu sayıdan fazla alınırsa kampanya uygulanmaz · 0 = sınır yok</span><input class="input" type="number" name="maxQty" min="0" value="${c.maxQty || 0}"></label>
          <label class="f">Sipariş başına en fazla hediye <span class="hint">0 = sınır yok</span><input class="input" type="number" name="maxPerOrder" min="0" value="${c.maxPerOrder || 0}"></label>
          <label class="switch full"><input type="checkbox" name="pureOnly" ${c.pureOnly ? 'checked' : ''}> Karışık siparişte uygulanmaz <span class="muted small">(siparişte başka bir ürün de varsa hediye gönderilmez)</span></label>
        </div>
      </fieldset>
      <fieldset class="fieldset"><legend>4 · Eklenecek ürün(ler)</legend>
        <div id="rewards"></div>
        <button type="button" class="btn sm" id="addReward">${icon('plus')}Hediye ürünü ekle</button>
        <span class="muted xs" style="margin-left:8px">Birden fazla satır = hediye paketi</span>
      </fieldset>
      <fieldset class="fieldset"><legend>5 · Tarih ve durum</legend>
        <div class="form">
          <label class="f">Başlangıç <span class="hint">Sipariş tarihine göre</span><input class="input" type="date" name="start" value="${c.start || ''}"></label>
          <label class="f">Bitiş <span class="hint">Boş = süresiz</span><input class="input" type="date" name="end" value="${c.end || ''}"></label>
          <label class="switch full"><input type="checkbox" name="active" ${c.active ? 'checked' : ''}> Kampanya aktif</label>
        </div>
      </fieldset>
      <div class="callout ok">${icon('gift')}<div class="c"><b id="pvText"></b><div id="pvTable" class="small" style="margin-top:6px"></div></div></div>
    </div>`,
    actions: [{ label: 'Vazgeç', value: 'cancel' }, { label: isNew ? 'Kampanyayı oluştur' : 'Kaydet', value: 'save', variant: 'primary' }],
    onOpen: (d) => {
      const f = (k) => d.querySelector(`[name=${k}]`);
      const ms = multiSelect(d.querySelector('#trig'), {
        options: products.map((p) => ({ id: p.id, label: state.ctx.labelOf(p), group: p.category || 'Diğer' })).sort((a, b) => collator.compare(a.group, b.group)),
        selected: c.triggerProductIds,
        allLabel: 'Tüm ürünler',
        onChange: (v) => { c.triggerProductIds = v; preview(); },
      });
      const drawRewards = () => {
        mount(d.querySelector('#rewards'), c.rewards.map((r, i) => html`<div class="rule-row">
          <select class="input" data-rp="${i}"><option value="">Aynı üründen</option>${products.map((p) => html`<option value="${p.id}" ${r.productId === p.id ? 'selected' : ''}>${state.ctx.labelOf(p)}</option>`)}</select>
          <input class="input" type="number" min="1" value="${r.qty}" data-rq="${i}" aria-label="Adet">
          <button type="button" class="btn icon ghost danger" data-rd="${i}" ${c.rewards.length === 1 ? 'disabled' : ''} title="Kaldır">${icon('x')}</button></div>`));
      };
      const read = () => {
        c = {
          ...c,
          templateId: f('templateId').value,
          name: f('name').value.trim(),
          note: f('note').value.trim(),
          platforms: [...d.querySelectorAll('[name=pf]:checked')].map((x) => x.value),
          storeIds: [...d.querySelectorAll('[name=st]:checked')].map((x) => x.value),
          condition: f('condition').value,
          minQty: Math.max(1, parseInt(f('minQty').value, 10) || 1),
          minAmount: Math.max(0, parseFloat(f('minAmount').value) || 0),
          mode: f('mode').value,
          countMode: f('countMode').value,
          maxPerOrder: Math.max(0, parseInt(f('maxPerOrder').value, 10) || 0),
          maxQty: Math.max(0, parseInt(f('maxQty').value, 10) || 0),
          pureOnly: f('pureOnly').checked,
          start: f('start').value,
          end: f('end').value,
          active: f('active').checked,
        };
        return c;
      };
      const preview = () => {
        read();
        d.querySelectorAll('#storeBox [data-pf]').forEach((el) => { el.style.opacity = !c.platforms.length || c.platforms.includes(el.dataset.pf) ? 1 : 0.35; });
        d.querySelectorAll('[data-show]').forEach((el) => { el.style.display = el.dataset.show.split(' ').includes(c.condition) ? '' : 'none'; });
        d.querySelector('[data-lbl]').textContent = c.condition === 'distinct' ? 'farklı ürün' : c.mode === 'roundup' ? 'adet (kaçın katına tamamlansın)' : 'adet';
        d.querySelector('#pvText').textContent = describe(c) + '.';
        let sim = '';
        if (c.condition === 'qty' || c.condition === 'distinct') {
          const per = c.rewards.reduce((s, r) => s + r.qty, 0);
          const rows = [1, 2, 3, 4, 5, 6, 8, 10].map((q) => { let t = c.maxQty && q > c.maxQty ? 0 : c.mode === 'roundup' ? (c.minQty - (q % c.minQty)) % c.minQty : q < c.minQty ? 0 : c.mode === 'once' ? 1 : Math.floor(q / c.minQty); let r = t * per; if (c.maxPerOrder) r = Math.min(r, c.maxPerOrder); return [q, r]; });
          sim = html`${c.pureOnly ? html`<div class="xs" style="margin-bottom:6px">Yalnızca tek çeşit ürün içeren siparişler için (karışık siparişte +0):</div>` : ''}<div class="row wrap" style="gap:6px">${rows.map(([q, r]) => html`<span class="chip static">${q} ${c.condition === 'distinct' ? 'çeşit' : 'adet'} → <b class="${r ? 'gift' : 'muted'}">+${r}</b></span>`)}</div>`;
        }
        mount(d.querySelector('#pvTable'), html`${sim}<div class="muted xs" style="margin-top:6px">Kapsam: ${scopeText(c)} · ${c.start ? trDate(c.start) : 'başlangıç yok'} – ${c.end ? trDate(c.end) : 'süresiz'}</div>`);
      };
      const applyType = (tid) => {
        const t = allTypes().find((x) => x.id === tid);
        if (!t || !t.rule) return;
        const fl = ruleToFields(t.rule);
        f('condition').value = fl.condition; f('minQty').value = fl.minQty; f('minAmount').value = fl.minAmount || '';
        f('mode').value = fl.mode; f('countMode').value = fl.countMode; f('maxPerOrder').value = fl.maxPerOrder || 0;
        f('maxQty').value = fl.maxQty || 0; f('pureOnly').checked = !!fl.pureOnly;
        c.rewards = fl.rewards;
        if (tid === 'bundle' && c.rewards.length < 2) c.rewards.push({ productId: '', qty: 1 });
        drawRewards();
      };
      d.querySelector('[name=templateId]').addEventListener('change', (e) => { applyType(e.target.value); preview(); });
      d.querySelectorAll('[data-seg]').forEach((seg) => seg.addEventListener('click', (e) => {
        const b = e.target.closest('[data-v]');
        if (!b) return;
        c[seg.dataset.seg] = b.dataset.v;
        seg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
        preview();
      }));
      d.querySelector('#rewards').addEventListener('change', (e) => {
        if (e.target.dataset.rp != null) c.rewards[+e.target.dataset.rp].productId = e.target.value;
        if (e.target.dataset.rq != null) c.rewards[+e.target.dataset.rq].qty = Math.max(1, parseInt(e.target.value, 10) || 1);
        preview();
      });
      d.querySelector('#rewards').addEventListener('click', (e) => {
        const b = e.target.closest('[data-rd]');
        if (b && c.rewards.length > 1) { c.rewards.splice(+b.dataset.rd, 1); drawRewards(); preview(); }
      });
      d.querySelector('#addReward').addEventListener('click', () => { c.rewards.push({ productId: '', qty: 1 }); drawRewards(); preview(); });
      d.querySelector('#saveType').addEventListener('click', async () => {
        read();
        const t = await saveTemplate({ condition: c.condition, mode: c.mode, countMode: c.countMode, minQty: c.minQty, minAmount: c.minAmount, maxPerOrder: c.maxPerOrder, maxQty: c.maxQty, pureOnly: c.pureOnly, rewardSame: !c.rewards[0].productId, rewardQty: c.rewards[0].qty });
        if (t) { c.templateId = t.id; mount(f('templateId'), typeOptions()); f('templateId').value = t.id; toast('Kampanya türü eklendi', 'ok'); }
      });
      d.addEventListener('input', (e) => { if (!e.target.closest('#rewards')) preview(); });
      d.addEventListener('change', (e) => { if (!e.target.closest('#rewards') && e.target.name !== 'templateId') preview(); });
      drawRewards();
      preview();
      return ms;
    },
    onSubmit: async () => {
      const x = { ...c, rewards: c.rewards.map((r) => ({ ...r })) };
      if (!x.name) throw new Error('Kampanya adı gerekli');
      if (x.start && x.end && x.start > x.end) throw new Error('Bitiş tarihi başlangıçtan önce olamaz');
      if (x.condition === 'amount' && !x.minAmount) throw new Error('En az tutarı girin');
      // Eski sürümlerle uyumluluk alanları
      x.rewardProductId = x.rewards[0].productId;
      x.rewardQty = x.rewards[0].qty;
      if (isNew) { x.createdAt = new Date().toISOString(); x.createdBy = state.me.username; }
      const list = isNew ? [...state.config.campaigns, x] : state.config.campaigns.map((y) => (y.id === x.id ? x : y));
      await saveSection('campaigns', list, `${isNew ? 'oluşturuldu' : 'güncellendi'}: ${x.name}`);
      toast(isNew ? 'Kampanya oluşturuldu' : 'Kampanya kaydedildi', 'ok');
    },
  });
  return res === 'save';
}

function ruleToFields(r) {
  return {
    condition: r.condition || 'qty', mode: r.mode || 'every', countMode: r.countMode || 'each',
    minQty: r.minQty || 1, minAmount: r.minAmount || 0, maxPerOrder: r.maxPerOrder || 0, maxQty: r.maxQty || 0, pureOnly: !!r.pureOnly,
    rewards: [{ productId: '', qty: r.rewardQty || 1 }],
    ...(r.rewardSame === false ? { rewards: [{ productId: (state.config.products[0] || {}).id || '', qty: r.rewardQty || 1 }] } : {}),
  };
}

export default async function campaignsPage(ctx) {
  const admin = isAdmin();
  let tab = 'current';
  let q = '';
  const sel = new Set();
  const tsel = new Set();
  if (admin) {
    mount(ctx.actions, html`<button class="btn primary" id="add">${icon('plus')}Yeni kampanya</button>`);
    ctx.actions.querySelector('#add').addEventListener('click', async () => {
      if (!state.config.products.length) return toast('Önce Ürünler sayfasından ürün ekleyin', 'err');
      if (await campaignForm()) render();
    });
  }
  const TABS = [
    ['current', 'Yayında & planlı', (s) => s.k === 'live' || s.k === 'planned'],
    ['ended', 'Sona eren', (s) => s.k === 'ended'],
    ['paused', 'Durdurulan', (s) => s.k === 'paused'],
    ['archived', 'Arşiv', (s) => s.k === 'archived'],
    ['all', 'Tümü', () => true],
  ];

  async function bulkUpdate(ids, fn, summary) {
    const set = new Set(ids);
    await saveSection('campaigns', state.config.campaigns.map((c) => (set.has(c.id) ? fn(c) : c)), summary);
  }

  function render() {
    const all = state.config.campaigns.map((c) => ({ c, s: campaignStatus(c) }));
    const counts = Object.fromEntries(TABS.map(([k, , f]) => [k, all.filter((x) => f(x.s)).length]));
    const templates = state.config.campaignTemplates || [];
    const ql = q.toLocaleLowerCase('tr-TR');
    const list = tab === 'types' ? [] : all
      .filter((x) => TABS.find((t) => t[0] === tab)[2](x.s))
      .filter((x) => !ql || (x.c.name + ' ' + describe(x.c)).toLocaleLowerCase('tr-TR').includes(ql))
      .sort((a, b) => (b.c.start || '').localeCompare(a.c.start || ''));
    ctx.setSub(`${counts.current} yayında/planlı · ${all.length} toplam`);
    mount(ctx.el, html`<div class="stack">
      <div class="card" id="cCard">
        <div class="tabs">${TABS.map(([k, l]) => html`<button data-tab="${k}" class="${tab === k ? 'on' : ''}">${l} <span class="muted">${counts[k]}</span></button>`)}
          <button data-tab="types" class="${tab === 'types' ? 'on' : ''}">Kampanya türleri <span class="muted">${BUILTIN_TYPES.length + templates.length}</span></button></div>
        ${tab === 'types' ? html`<div class="tw"><table class="t"><thead><tr>${admin ? selTh() : ''}<th>Tür</th><th>Kural</th><th>Kaynak</th></tr></thead><tbody>
          ${BUILTIN_TYPES.filter((t) => t.rule).map((t) => html`<tr>${admin ? html`<td class="sel"></td>` : ''}<td><b>${t.name}</b></td><td class="small muted">${COND_LABEL[t.rule.condition]} · ${t.rule.mode === 'once' ? 'bir kez' : t.rule.mode === 'roundup' ? 'katına tamamla' : 'katlanarak'}${t.rule.condition === 'qty' ? ` · ${t.rule.countMode === 'sum' ? 'toplam' : 'ürün başına'}` : ''}${t.rule.pureOnly ? ' · karışıkta yok' : ''}${t.rule.maxQty ? ` · en fazla ${t.rule.maxQty}` : ''}</td><td><span class="badge">Hazır</span></td></tr>`)}
          ${templates.map((t) => html`<tr>${admin ? selTd(t.id, tsel) : ''}<td><b>${t.name}</b>${t.description ? html`<div class="muted xs">${t.description}</div>` : ''}</td><td class="small muted">${COND_LABEL[t.rule.condition]} · ${t.rule.mode === 'once' ? 'bir kez' : t.rule.mode === 'roundup' ? 'katına tamamla' : 'katlanarak'}${t.rule.pureOnly ? ' · karışıkta yok' : ''}${t.rule.maxQty ? ` · en fazla ${t.rule.maxQty}` : ''} · en az ${t.rule.condition === 'amount' ? n(t.rule.minAmount) + ' TL' : t.rule.minQty} · +${t.rule.rewardQty} ${t.rule.rewardSame ? 'aynı üründen' : 'hediye ürün'}</td><td><span class="badge violet">Sizin</span></td></tr>`)}
          </tbody></table></div>
          <div class="card-f small muted">Yeni tür eklemek için kampanya formunda kuralı ayarlayıp “Yeni tür” düğmesine basın. Hazır türler silinemez.</div>
          ${admin ? bulkBar() : ''}` : html`
        <div class="card-h"><div class="search" style="width:280px;max-width:100%">${icon('search')}<input class="input sm" id="q" placeholder="Kampanya ara…" value="${q}"></div></div>
        <div class="tw"><table class="t"><thead><tr>${admin ? selTh() : ''}<th>Kampanya</th><th>Kural</th><th>Kapsam</th><th>Tarih</th><th>Durum</th><th></th></tr></thead><tbody>
        ${list.length ? list.map(({ c, s }) => {
          const nc = normCampaign(c);
          return html`<tr>
          ${admin ? selTd(c.id, sel) : ''}
          <td><b>${c.name}</b>${c.note ? html`<div class="muted xs">${c.note}</div>` : ''}${c.createdBy ? html`<div class="muted xs">${c.createdBy} · ${trDate((c.createdAt || '').slice(0, 10))}</div>` : ''}</td>
          <td class="small" style="max-width:360px">${describe(c)}</td>
          <td class="small"><div class="row wrap" style="gap:4px">${nc.platforms.length ? nc.platforms.map((p) => pBadge(p)) : html`<span class="badge">Tüm platformlar</span>`}</div>
            <div class="muted xs" style="margin-top:4px">${!nc.storeIds.length ? 'Tüm mağazalar' : (nc.storeMode === 'exclude' ? 'Hariç: ' : '') + state.config.stores.filter((x) => nc.storeIds.includes(x.id)).map((x) => x.name).join(', ')}</div></td>
          <td class="small nowrap">${c.start ? trDate(c.start) : '—'}<br><span class="muted">${c.end ? trDate(c.end) : 'süresiz'}</span></td>
          <td><span class="badge ${s.cls}"><span class="dot"></span>${s.label}</span></td>
          <td class="num nowrap">${admin ? html`
            <button class="btn sm ghost icon" data-a="edit" data-id="${c.id}" title="Düzenle">${icon('edit')}</button>
            <button class="btn sm ghost icon" data-a="copy" data-id="${c.id}" title="Kopyala">${icon('copy')}</button>` : ''}</td>
        </tr>`;
        }) : html`<tr><td colspan="7">${emptyState('tag', 'Kampanya yok', admin ? '“Yeni kampanya” ile mağaza ve ürün bazlı kampanya tanımlayın.' : '')}</td></tr>`}
        </tbody></table></div>${admin ? bulkBar() : ''}`}
      </div>
      <div class="callout info">${icon('info')}<div class="c"><b>Kampanyalar nasıl hesaplanır?</b>
        Her siparişe, siparişin tarihinde geçerli olan ve mağazasını/platformunu kapsayan kampanyalar uygulanır; eklenen adetler üretim listesine “Kampanya” olarak yazılır.
        Toplu işlemlerde <b>Bitir</b> kampanyayı bugünden sonrası için kapatır (geçmiş raporlar değişmez); <b>Durdur</b> tüm tarihlerde devre dışı bırakır; <b>Arşivle</b> yalnızca listeden gizler.</div></div>
    </div>`);

    const card = ctx.el.querySelector('#cCard');
    const qi = ctx.el.querySelector('#q');
    if (qi) qi.addEventListener('input', () => { q = qi.value; const p = qi.selectionStart; render(); const q2 = ctx.el.querySelector('#q'); q2.focus(); q2.setSelectionRange(p, p); });
    if (!admin) return;
    if (tab === 'types') {
      wireBulk(card, tsel, [{ id: 'del', label: 'Sil', icon: 'trash', danger: true }], async (a, ids) => {
        if (!(await confirmDialog(`${ids.length} kampanya türü silinsin mi? Bu türle oluşturulmuş kampanyalar etkilenmez.`, { danger: true, ok: 'Sil' }))) return false;
        await saveSection('campaignTemplates', templates.filter((t) => !ids.includes(t.id)), `${ids.length} kampanya türü silindi`);
        toast('Silindi'); render();
      });
      return;
    }
    wireBulk(card, sel, [
      { id: 'end', label: 'Bitir' },
      { id: 'pause', label: 'Durdur' },
      { id: 'start', label: 'Başlat' },
      { id: 'archive', label: 'Arşivle', icon: 'archive' },
      { id: 'unarchive', label: 'Arşivden çıkar' },
      { id: 'del', label: 'Sil', icon: 'trash', danger: true },
    ], async (a, ids) => {
      const t = today();
      if (a === 'del') {
        if (!(await confirmDialog(`${ids.length} kampanya kalıcı olarak silinsin mi? Geçmiş raporlardaki kampanya adetleri de kaybolur. Geçmişi korumak için “Bitir” veya “Arşivle” kullanın.`, { danger: true, ok: 'Kalıcı olarak sil' }))) return false;
        await saveSection('campaigns', state.config.campaigns.filter((c) => !ids.includes(c.id)), `${ids.length} kampanya silindi`);
      } else if (a === 'pause') {
        if (!(await confirmDialog(`${ids.length} kampanya durdurulsun mu? Durdurulan kampanya geçmiş tarihler dahil hiçbir raporda hesaplanmaz.`, { danger: true, ok: 'Durdur' }))) return false;
        await bulkUpdate(ids, (c) => ({ ...c, active: false }), `${ids.length} kampanya durduruldu`);
      } else if (a === 'start') await bulkUpdate(ids, (c) => ({ ...c, active: true }), `${ids.length} kampanya başlatıldı`);
      else if (a === 'end') await bulkUpdate(ids, (c) => ({ ...c, end: c.start && c.start > addDays(t, -1) ? c.start : t }), `${ids.length} kampanya bitirildi`);
      else if (a === 'archive') await bulkUpdate(ids, (c) => ({ ...c, archived: true }), `${ids.length} kampanya arşivlendi`);
      else if (a === 'unarchive') await bulkUpdate(ids, (c) => ({ ...c, archived: false }), `${ids.length} kampanya arşivden çıkarıldı`);
      toast('Güncellendi', 'ok');
      render();
    });
  }

  ctx.el.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-tab]');
    if (t) { tab = t.dataset.tab; sel.clear(); tsel.clear(); return render(); }
    const b = e.target.closest('[data-a]');
    if (!b) return;
    const c = state.config.campaigns.find((x) => x.id === b.dataset.id);
    if (!c) return;
    if (b.dataset.a === 'edit' && (await campaignForm(c))) render();
    if (b.dataset.a === 'copy' && (await campaignForm(c, { copy: true }))) render();
  });
  render();
}
