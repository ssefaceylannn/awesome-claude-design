// Kampanyalar: mağaza/platform kapsamı, ürün seçimi, kural, tarih.
import { html, mount, icon, modal, confirmDialog, toast, uid, trDate, today, addDays, emptyState, multiSelect, PLATFORMS, pLabel, pBadge, collator } from '../core/ui.js';
import { state, isAdmin, saveSection } from '../core/api.js';

export function campaignStatus(c) {
  const t = today();
  if (c.archived) return { k: 'archived', label: 'Arşiv', cls: '' };
  if (!c.active) return { k: 'paused', label: 'Durduruldu', cls: 'err' };
  if (c.start && c.start > t) return { k: 'planned', label: 'Planlandı', cls: 'info' };
  if (c.end && c.end < t) return { k: 'ended', label: 'Sona erdi', cls: '' };
  return { k: 'live', label: 'Yayında', cls: 'ok' };
}

const pn = (id) => (state.ctx.productsById.get(id) || { name: '(silinmiş ürün)' }).name;

export function describe(c) {
  const trig = (c.triggerProductIds || []).map(pn);
  const trigTxt = trig.length ? (trig.length <= 3 ? trig.join(', ') : `${trig.length} üründen`) : '(ürün seçilmedi)';
  const reward = c.rewardProductId ? `${c.rewardQty} adet ${pn(c.rewardProductId)} hediye` : `${c.rewardQty} adet aynı üründen ekstra`;
  const scope = c.countMode === 'sum' && c.rewardProductId && trig.length > 1 ? ' (seçili ürünlerin toplamı)' : trig.length > 1 ? ' (her ürün ayrı)' : '';
  return c.mode === 'once'
    ? `${trigTxt} en az ${c.minQty} adet olan siparişe bir kez ${reward}${scope}`
    : `${trigTxt} her ${c.minQty} adette ${reward}${scope}`;
}

function scopeText(c) {
  const pf = c.platforms && c.platforms.length ? c.platforms.map(pLabel).join(', ') : 'Tüm platformlar';
  const st = c.storeIds && c.storeIds.length ? state.config.stores.filter((s) => c.storeIds.includes(s.id)).map((s) => s.name).join(', ') : 'tüm mağazalar';
  return `${pf} · ${st}`;
}

async function campaignForm(camp, { copy = false } = {}) {
  const isNew = !camp || copy;
  const c = camp
    ? { ...camp, ...(copy ? { id: uid('c'), name: camp.name + ' (kopya)', archived: false, createdAt: '', createdBy: '' } : {}) }
    : { id: uid('c'), name: '', note: '', active: true, archived: false, storeIds: [], platforms: [], triggerProductIds: [], minQty: 2, rewardQty: 1, rewardProductId: '', countMode: 'each', mode: 'every', start: today(), end: '' };
  const products = state.config.products.filter((p) => p.active !== false || (c.triggerProductIds || []).includes(p.id) || c.rewardProductId === p.id);
  const stores = [...state.config.stores].sort((a, b) => collator.compare(pLabel(a.platform), pLabel(b.platform)) || collator.compare(a.name, b.name));
  let trig = [...c.triggerProductIds];

  const res = await modal({
    title: isNew ? 'Yeni kampanya' : 'Kampanyayı düzenle',
    size: 'lg',
    body: html`<div class="stack">
      <div class="form">
        <label class="f full">Kampanya adı<input class="input" name="name" value="${c.name}" maxlength="120" placeholder="Örn. Trendyol Detox Shot 2 al 1 bedava"></label>
        <label class="f full">Açıklama <span class="hint">İsteğe bağlı iç not</span><input class="input" name="note" value="${c.note}" maxlength="500"></label>
      </div>
      <fieldset class="fieldset"><legend>1 · Kapsam: hangi mağazalarda?</legend>
        <div class="stack" style="gap:12px">
          <div><div class="small muted" style="margin-bottom:6px">Platform (hiçbiri seçilmezse tümü)</div>
            <div class="row wrap">${PLATFORMS.filter((p) => stores.some((s) => s.platform === p.id) || (c.platforms || []).includes(p.id)).map((p) => html`<label class="check"><input type="checkbox" name="pf" value="${p.id}" ${c.platforms.includes(p.id) ? 'checked' : ''}>${pBadge(p.id)}</label>`)}</div></div>
          <div><div class="small muted" style="margin-bottom:6px">Mağaza (hiçbiri seçilmezse seçili platformlardaki tüm mağazalar)</div>
            <div class="grid g-3" style="gap:6px" id="storeBox">${stores.map((s) => html`<label class="check" data-pf="${s.platform}"><input type="checkbox" name="st" value="${s.id}" ${c.storeIds.includes(s.id) ? 'checked' : ''}><span class="sdot" style="background:${s.color}"></span>${s.name}</label>`)}</div>
            ${stores.length ? '' : html`<div class="muted small">Henüz mağaza tanımlanmadı — kampanya tüm mağazalara uygulanır.</div>`}</div>
        </div>
      </fieldset>
      <fieldset class="fieldset"><legend>2 · Kural</legend>
        <div class="form">
          <div class="f full">Kampanyalı ürün(ler)<div id="trig"></div></div>
          <label class="f">Kaç adet alınınca<input class="input" type="number" name="minQty" min="1" value="${c.minQty}"></label>
          <label class="f">Uygulama şekli<select class="input" name="mode"><option value="every" ${c.mode === 'every' ? 'selected' : ''}>Her X adette bir (katlanır: 4 alana 2 hediye)</option><option value="once" ${c.mode === 'once' ? 'selected' : ''}>Sipariş başına yalnız bir kez</option></select></label>
          <label class="f">Hediye / ekstra ürün<select class="input" name="rewardProductId"><option value="">Aynı üründen</option>${products.map((p) => html`<option value="${p.id}" ${c.rewardProductId === p.id ? 'selected' : ''}>${p.name}</option>`)}</select></label>
          <label class="f">Kaç adet eklenecek<input class="input" type="number" name="rewardQty" min="1" value="${c.rewardQty}"></label>
          <label class="f full" id="countModeWrap">Birden fazla ürün seçiliyse<select class="input" name="countMode"><option value="each" ${c.countMode !== 'sum' ? 'selected' : ''}>Her ürün ayrı sayılır</option><option value="sum" ${c.countMode === 'sum' ? 'selected' : ''}>Seçili ürünlerin toplamı sayılır (karışık sepet)</option></select></label>
        </div>
      </fieldset>
      <fieldset class="fieldset"><legend>3 · Tarih ve durum</legend>
        <div class="form">
          <label class="f">Başlangıç <span class="hint">Sipariş tarihine göre</span><input class="input" type="date" name="start" value="${c.start}"></label>
          <label class="f">Bitiş <span class="hint">Boş = süresiz</span><input class="input" type="date" name="end" value="${c.end}"></label>
          <label class="switch full"><input type="checkbox" name="active" ${c.active ? 'checked' : ''}> Kampanya aktif</label>
        </div>
      </fieldset>
      <div class="callout ok">${icon('gift')}<div class="c"><b id="pvText"></b><div id="pvTable" class="small" style="margin-top:6px"></div></div></div>
    </div>`,
    actions: [{ label: 'Vazgeç', value: 'cancel' }, { label: isNew ? 'Kampanyayı oluştur' : 'Kaydet', value: 'save', variant: 'primary' }],
    onOpen: (d) => {
      multiSelect(d.querySelector('#trig'), {
        options: products.map((p) => ({ id: p.id, label: p.name, group: p.category || 'Diğer' })).sort((a, b) => collator.compare(a.group, b.group)),
        selected: trig,
        allLabel: 'Ürün seçin…',
        onChange: (v) => { trig = v; preview(); },
      });
      const read = () => {
        const f = (k) => d.querySelector(`[name=${k}]`);
        return {
          ...c,
          name: f('name').value.trim(),
          note: f('note').value.trim(),
          platforms: [...d.querySelectorAll('[name=pf]:checked')].map((x) => x.value),
          storeIds: [...d.querySelectorAll('[name=st]:checked')].map((x) => x.value),
          triggerProductIds: trig,
          minQty: Math.max(1, parseInt(f('minQty').value, 10) || 1),
          rewardQty: Math.max(1, parseInt(f('rewardQty').value, 10) || 1),
          rewardProductId: f('rewardProductId').value,
          countMode: f('countMode').value,
          mode: f('mode').value,
          start: f('start').value,
          end: f('end').value,
          active: f('active').checked,
        };
      };
      const preview = () => {
        const x = read();
        const pfs = x.platforms;
        d.querySelectorAll('#storeBox [data-pf]').forEach((el) => { el.style.opacity = !pfs.length || pfs.includes(el.dataset.pf) ? 1 : 0.35; });
        d.querySelector('#countModeWrap').style.display = trig.length > 1 && x.rewardProductId ? '' : 'none';
        d.querySelector('#pvText').textContent = describe(x) + '.';
        const sim = [1, 2, 3, 4, 5, 6, 8, 10].map((q) => [q, q < x.minQty ? 0 : x.mode === 'once' ? x.rewardQty : Math.floor(q / x.minQty) * x.rewardQty]);
        mount(d.querySelector('#pvTable'), html`<div class="row wrap" style="gap:6px">${sim.map(([q, r]) => html`<span class="chip static">${q} adet → <b class="${r ? 'gift' : 'muted'}">+${r}</b></span>`)}</div>
          <div class="muted xs" style="margin-top:6px">Kapsam: ${scopeText(x)} · ${x.start ? trDate(x.start) : 'başlangıç yok'} – ${x.end ? trDate(x.end) : 'süresiz'}</div>`);
      };
      d.addEventListener('input', preview);
      d.addEventListener('change', preview);
      preview();
    },
    onSubmit: async (_, d) => {
      const f = (k) => d.querySelector(`[name=${k}]`);
      const x = {
        ...c,
        name: f('name').value.trim(),
        note: f('note').value.trim(),
        platforms: [...d.querySelectorAll('[name=pf]:checked')].map((el) => el.value),
        storeIds: [...d.querySelectorAll('[name=st]:checked')].map((el) => el.value),
        triggerProductIds: trig,
        minQty: Math.max(1, parseInt(f('minQty').value, 10) || 1),
        rewardQty: Math.max(1, parseInt(f('rewardQty').value, 10) || 1),
        rewardProductId: f('rewardProductId').value,
        countMode: f('countMode').value,
        mode: f('mode').value,
        start: f('start').value,
        end: f('end').value,
        active: f('active').checked,
      };
      if (!x.name) throw new Error('Kampanya adı gerekli');
      if (!x.triggerProductIds.length) throw new Error('En az bir kampanyalı ürün seçin');
      if (x.start && x.end && x.start > x.end) throw new Error('Bitiş tarihi başlangıçtan önce olamaz');
      if (isNew) { x.createdAt = new Date().toISOString(); x.createdBy = state.me.username; }
      const list = isNew ? [...state.config.campaigns, x] : state.config.campaigns.map((y) => (y.id === x.id ? x : y));
      await saveSection('campaigns', list, `${isNew ? 'oluşturuldu' : 'güncellendi'}: ${x.name}`);
      toast(isNew ? 'Kampanya oluşturuldu' : 'Kampanya kaydedildi', 'ok');
    },
  });
  return res === 'save';
}

export default async function campaignsPage(ctx) {
  const admin = isAdmin();
  let tab = 'current';
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

  function render() {
    const all = state.config.campaigns.map((c) => ({ c, s: campaignStatus(c) }));
    const counts = Object.fromEntries(TABS.map(([k, , f]) => [k, all.filter((x) => f(x.s)).length]));
    const list = all.filter((x) => TABS.find((t) => t[0] === tab)[2](x.s)).sort((a, b) => (b.c.start || '').localeCompare(a.c.start || ''));
    ctx.setSub(`${counts.current} yayında/planlı · ${all.length} toplam`);
    mount(ctx.el, html`<div class="stack">
      <div class="card">
        <div class="tabs">${TABS.map(([k, l]) => html`<button data-tab="${k}" class="${tab === k ? 'on' : ''}">${l} <span class="muted">${counts[k]}</span></button>`)}</div>
        <div class="tw"><table class="t"><thead><tr><th>Kampanya</th><th>Kural</th><th>Kapsam</th><th>Tarih</th><th>Durum</th><th></th></tr></thead><tbody>
        ${list.length ? list.map(({ c, s }) => html`<tr>
          <td><b>${c.name}</b>${c.note ? html`<div class="muted xs">${c.note}</div>` : ''}${c.createdBy ? html`<div class="muted xs">${c.createdBy} · ${trDate((c.createdAt || '').slice(0, 10))}</div>` : ''}</td>
          <td class="small" style="max-width:340px">${describe(c)}</td>
          <td class="small"><div class="row wrap" style="gap:4px">${c.platforms.length ? c.platforms.map((p) => pBadge(p)) : html`<span class="badge">Tüm platformlar</span>`}</div>
            <div class="muted xs" style="margin-top:4px">${c.storeIds.length ? state.config.stores.filter((x) => c.storeIds.includes(x.id)).map((x) => x.name).join(', ') : 'Tüm mağazalar'}</div></td>
          <td class="small nowrap">${c.start ? trDate(c.start) : '—'}<br><span class="muted">${c.end ? trDate(c.end) : 'süresiz'}</span></td>
          <td><span class="badge ${s.cls}"><span class="dot"></span>${s.label}</span></td>
          <td class="num nowrap">${admin ? html`
            <button class="btn sm ghost icon" data-a="edit" data-id="${c.id}" title="Düzenle">${icon('edit')}</button>
            <button class="btn sm ghost icon" data-a="copy" data-id="${c.id}" title="Kopyala">${icon('copy')}</button>
            ${s.k === 'live' ? html`<button class="btn sm ghost" data-a="end" data-id="${c.id}" title="Bugün itibarıyla bitir">Bitir</button>` : ''}
            <button class="btn sm ghost" data-a="toggle" data-id="${c.id}">${c.active ? 'Durdur' : 'Başlat'}</button>
            <button class="btn sm ghost icon" data-a="${c.archived ? 'unarchive' : 'archive'}" data-id="${c.id}" title="${c.archived ? 'Arşivden çıkar' : 'Arşivle'}">${icon('archive')}</button>
            <button class="btn sm ghost icon danger" data-a="del" data-id="${c.id}" title="Sil">${icon('trash')}</button>` : ''}</td>
        </tr>`) : html`<tr><td colspan="6">${emptyState('tag', 'Kampanya yok', admin ? '“Yeni kampanya” ile mağaza ve ürün bazlı kampanya tanımlayın.' : '')}</td></tr>`}
        </tbody></table></div>
      </div>
      <div class="callout info">${icon('info')}<div class="c"><b>Kampanyalar nasıl hesaplanır?</b>
        Her siparişe, siparişin tarihinde geçerli olan ve mağazasını/platformunu kapsayan kampanyalar uygulanır; eklenen adetler üretim listesine “Kampanya” olarak yazılır.
        <b>Bitir</b> kampanyayı bugünden sonrası için kapatır, geçmiş raporlar değişmez. <b>Durdur</b> kampanyayı tüm tarihlerde devre dışı bırakır (hatalı kampanyalar için). <b>Arşiv</b> yalnızca listeden gizler.</div></div>
    </div>`);
  }

  ctx.el.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-tab]');
    if (t) { tab = t.dataset.tab; return render(); }
    const b = e.target.closest('[data-a]');
    if (!b) return;
    const c = state.config.campaigns.find((x) => x.id === b.dataset.id);
    if (!c) return;
    const a = b.dataset.a;
    if (a === 'edit') { if (await campaignForm(c)) render(); return; }
    if (a === 'copy') { if (await campaignForm(c, { copy: true })) render(); return; }
    let next = { ...c };
    let summary = '';
    if (a === 'end') { next.end = addDays(today(), -1) < (c.start || '') ? c.start : today(); summary = `bitirildi: ${c.name}`; }
    if (a === 'toggle') {
      if (c.active && !(await confirmDialog(html`“${c.name}” durdurulsun mu? Durdurulan kampanya <b>geçmiş tarihler dahil</b> hiçbir raporda hesaplanmaz. Yalnızca bugünden sonrasını kapatmak için “Bitir” kullanın.`, { ok: 'Durdur', danger: true }))) return;
      next.active = !c.active; summary = `${next.active ? 'başlatıldı' : 'durduruldu'}: ${c.name}`;
    }
    if (a === 'archive' || a === 'unarchive') { next.archived = a === 'archive'; summary = `${a === 'archive' ? 'arşivlendi' : 'arşivden çıkarıldı'}: ${c.name}`; }
    if (a === 'del') {
      if (!(await confirmDialog(html`“${c.name}” kalıcı olarak silinsin mi? Geçmiş raporlardaki kampanya adetleri de kaybolur. Geçmişi korumak için “Bitir” veya “Arşivle” kullanın.`, { ok: 'Kalıcı olarak sil', danger: true }))) return;
      await saveSection('campaigns', state.config.campaigns.filter((x) => x.id !== c.id), `silindi: ${c.name}`);
      toast('Kampanya silindi');
      return render();
    }
    await saveSection('campaigns', state.config.campaigns.map((x) => (x.id === c.id ? next : x)), summary);
    toast('Kampanya güncellendi', 'ok');
    render();
  });
  render();
}
