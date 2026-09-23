// Mağazalar: ekle / düzenle, etiketteki gönderici adlarıyla eşleştir.
import { html, mount, icon, modal, confirmDialog, toast, uid, PLATFORMS, pLabel, pBadge, n, today, addDays, $, emptyState, collator } from '../core/ui.js';
import { state, isAdmin, saveSection, fetchOrders } from '../core/api.js';
import { fold } from '../shared/text.js';

const COLORS = ['#f97316', '#ea580c', '#dc2626', '#db2777', '#9333ea', '#7c3aed', '#4f46e5', '#2563eb', '#0891b2', '#0d9488', '#16a34a', '#65a30d', '#ca8a04', '#64748b'];

export async function storeForm(store, { presetSender } = {}) {
  const s = store || { id: uid('s'), name: presetSender || '', platform: guessPlatform(presetSender), senders: presetSender ? [presetSender] : [], color: COLORS[state.config.stores.length % COLORS.length], code: '', note: '', active: true };
  const isNew = !store;
  const res = await modal({
    title: isNew ? 'Yeni mağaza' : 'Mağazayı düzenle',
    body: html`<div class="form">
      <label class="f full">Mağaza adı<input class="input" name="name" value="${s.name}" placeholder="Örn. Ultra Natura Trendyol 2" maxlength="80"></label>
      <label class="f">Platform<select class="input" name="platform">${PLATFORMS.map((p) => html`<option value="${p.id}" ${p.id === s.platform ? 'selected' : ''}>${p.label}</option>`)}</select></label>
      <label class="f">Kısa kod <span class="hint">Raporlarda kısaltma (isteğe bağlı)</span><input class="input" name="code" value="${s.code}" maxlength="20" placeholder="TY2"></label>
      <label class="f full">Etiketteki gönderici adları <span class="hint">Etiketin “Gönderici” alanında yazan ad. Her satıra bir tane; mağaza bu adlarla tanınır.</span>
        <textarea class="input" name="senders" rows="3" placeholder="Ultra Natura Trendyol">${s.senders.join('\n')}</textarea></label>
      <div class="f full">Renk<div class="row wrap" id="colors" style="gap:6px">${COLORS.map((c) => html`<button type="button" class="btn icon sm" data-c="${c}" style="background:${c};border-color:${c === s.color ? 'var(--text)' : c};box-shadow:${c === s.color ? '0 0 0 2px var(--surface) inset' : 'none'}" aria-label="${c}"></button>`)}</div><input type="hidden" name="color" value="${s.color}"></div>
      <label class="f full">Not<textarea class="input" name="note" rows="2" maxlength="500">${s.note}</textarea></label>
      <label class="switch full"><input type="checkbox" name="active" ${s.active ? 'checked' : ''}> Aktif</label>
    </div>`,
    actions: [{ label: 'Vazgeç', value: 'cancel' }, { label: isNew ? 'Mağazayı ekle' : 'Kaydet', value: 'save', variant: 'primary' }],
    onOpen: (d) => {
      d.querySelector('#colors').addEventListener('click', (e) => {
        const b = e.target.closest('[data-c]');
        if (!b) return;
        d.querySelector('[name=color]').value = b.dataset.c;
        d.querySelectorAll('#colors [data-c]').forEach((x) => { const on = x === b; x.style.borderColor = on ? 'var(--text)' : x.dataset.c; x.style.boxShadow = on ? '0 0 0 2px var(--surface) inset' : 'none'; });
      });
      const name = d.querySelector('[name=name]');
      const senders = d.querySelector('[name=senders]');
      name.addEventListener('input', () => { if (isNew && !senders.dataset.touched) senders.value = name.value; });
      senders.addEventListener('input', () => { senders.dataset.touched = 1; });
    },
    onSubmit: async (_, d) => {
      const f = (k) => d.querySelector(`[name=${k}]`);
      const next = {
        ...s,
        name: f('name').value.trim(),
        platform: f('platform').value,
        code: f('code').value.trim(),
        senders: [...new Set(f('senders').value.split('\n').map((x) => x.trim()).filter(Boolean))],
        color: f('color').value,
        note: f('note').value.trim(),
        active: f('active').checked,
      };
      if (!next.name) throw new Error('Mağaza adı gerekli');
      if (!next.senders.length) next.senders = [next.name];
      // Aynı gönderici adı başka mağazada olmasın
      for (const snd of next.senders) {
        const other = state.config.stores.find((x) => x.id !== next.id && (x.senders || []).some((y) => fold(y) === fold(snd)));
        if (other) throw new Error(`“${snd}” zaten “${other.name}” mağazasına tanımlı`);
      }
      const list = isNew ? [...state.config.stores, next] : state.config.stores.map((x) => (x.id === next.id ? next : x));
      await saveSection('stores', list, `${isNew ? 'eklendi' : 'güncellendi'}: ${next.name}`);
      toast(isNew ? 'Mağaza eklendi' : 'Mağaza kaydedildi', 'ok');
    },
  });
  return res === 'save';
}

function guessPlatform(sender) {
  const f = fold(sender || '');
  for (const p of PLATFORMS) if (f.includes(fold(p.label))) return p.id;
  return 'trendyol';
}

export default async function storesPage(ctx) {
  const admin = isAdmin();
  if (admin) {
    mount(ctx.actions, html`<button class="btn primary" id="add">${icon('plus')}Mağaza ekle</button>`);
    ctx.actions.querySelector('#add').addEventListener('click', async () => { if (await storeForm()) render(); });
  }
  let recent = [];
  try { recent = await fetchOrders(addDays(today(), -29), today()); } catch (e) { toast(e.message, 'err'); }

  function render() {
    const stores = state.config.stores;
    const counts = new Map();
    const unknown = new Map();
    for (const o of recent) {
      const s = state.ctx.resolveStore(o.sender);
      if (s) counts.set(s.id, (counts.get(s.id) || 0) + 1);
      else { const k = fold(o.sender); const u = unknown.get(k) || { sender: o.sender, platform: o.platform, n: 0 }; u.n++; unknown.set(k, u); }
    }
    ctx.setSub(`${stores.length} mağaza · ${stores.filter((s) => s.active !== false).length} aktif`);
    const byPf = PLATFORMS.map((p) => ({ p, list: stores.filter((s) => s.platform === p.id).sort((a, b) => collator.compare(a.name, b.name)) })).filter((g) => g.list.length);

    mount(ctx.el, html`<div class="stack">
      ${unknown.size ? html`<div class="card">
        <div class="card-h"><span class="badge warn">${icon('alert')} ${unknown.size}</span><h2>Tanımsız göndericiler</h2><span class="sub">Son 30 günün etiketlerinde görülen ama hiçbir mağazaya bağlı olmayan gönderici adları</span></div>
        <div class="tw"><table class="t"><thead><tr><th>Etiketteki gönderici</th><th>Algılanan platform</th><th class="num">Sipariş (30 gün)</th><th></th></tr></thead><tbody>
        ${[...unknown.values()].sort((a, b) => b.n - a.n).map((u) => html`<tr><td><b>${u.sender || '(boş)'}</b></td><td>${pBadge(u.platform)}</td><td class="num">${n(u.n)}</td>
          <td class="num">${admin ? html`<div class="row" style="justify-content:flex-end;gap:6px"><select class="input sm" data-link="${u.sender}" style="width:auto"><option value="">Mevcut mağazaya bağla…</option>${stores.map((s) => html`<option value="${s.id}">${s.name}</option>`)}</select>
            <button class="btn sm primary" data-new="${u.sender}">${icon('plus')}Yeni mağaza</button></div>` : ''}</td></tr>`)}
        </tbody></table></div></div>` : ''}
      ${stores.length ? byPf.map((g) => html`<div class="card">
        <div class="card-h">${pBadge(g.p.id)}<h2>${g.p.label}</h2><span class="sub">${g.list.length} mağaza</span></div>
        <div class="tw"><table class="t"><thead><tr><th>Mağaza</th><th>Etiketteki gönderici adları</th><th class="num">Sipariş (30 gün)</th><th>Durum</th><th></th></tr></thead><tbody>
          ${g.list.map((s) => html`<tr>
            <td><div class="row" style="gap:10px"><span class="sdot" style="background:${s.color};width:12px;height:12px"></span><div><b>${s.name}</b>${s.code ? html` <span class="badge">${s.code}</span>` : ''}${s.note ? html`<div class="muted xs">${s.note}</div>` : ''}</div></div></td>
            <td><div class="row wrap" style="gap:4px">${(s.senders || []).map((x) => html`<span class="chip static">${x}</span>`)}</div></td>
            <td class="num">${n(counts.get(s.id) || 0)}</td>
            <td>${s.active !== false ? html`<span class="badge ok"><span class="dot"></span>Aktif</span>` : html`<span class="badge">Pasif</span>`}</td>
            <td class="num">${admin ? html`<button class="btn sm ghost icon" data-edit="${s.id}" title="Düzenle">${icon('edit')}</button><button class="btn sm ghost icon danger" data-del="${s.id}" title="Sil">${icon('trash')}</button>` : ''}</td>
          </tr>`)}
        </tbody></table></div></div>`) : html`<div class="card">${emptyState('store', 'Henüz mağaza yok', admin ? 'Sağ üstten “Mağaza ekle” ile Trendyol, ikas ve Shopify mağazalarınızı tanımlayın.' : 'Yönetici henüz mağaza tanımlamadı.')}</div>`}
      <div class="callout info">${icon('info')}<div class="c"><b>Mağaza nasıl tanınır?</b>Etiketteki “Gönderici” alanı, mağazanın gönderici adlarından biriyle karşılaştırılır (büyük/küçük harf ve Türkçe karakter farkı önemsizdir). Kampanyalar ve raporlar mağaza bazında buna göre ayrılır.</div></div>
    </div>`);
  }
  render();

  ctx.el.addEventListener('click', async (e) => {
    const ed = e.target.closest('[data-edit]');
    if (ed) { if (await storeForm(state.config.stores.find((s) => s.id === ed.dataset.edit))) render(); return; }
    const nw = e.target.closest('[data-new]');
    if (nw) { if (await storeForm(null, { presetSender: nw.dataset.new })) render(); return; }
    const dl = e.target.closest('[data-del]');
    if (dl) {
      const s = state.config.stores.find((x) => x.id === dl.dataset.del);
      if (!(await confirmDialog(html`“${s.name}” silinsin mi? Bu mağazanın geçmiş siparişleri “Tanımsız” görünür ve mağazaya özel kampanyalar uygulanmaz. Geçici olarak durdurmak için düzenleyip “Pasif” yapabilirsiniz.`, { danger: true, ok: 'Sil' }))) return;
      await saveSection('stores', state.config.stores.filter((x) => x.id !== s.id), `silindi: ${s.name}`);
      toast('Mağaza silindi');
      render();
    }
  });
  ctx.el.addEventListener('change', async (e) => {
    const sel = e.target.closest('[data-link]');
    if (!sel || !sel.value) return;
    const list = state.config.stores.map((s) => (s.id === sel.value ? { ...s, senders: [...new Set([...(s.senders || []), sel.dataset.link])] } : s));
    const s = list.find((x) => x.id === sel.value);
    await saveSection('stores', list, `gönderici bağlandı: ${sel.dataset.link} → ${s.name}`);
    toast(`“${sel.dataset.link}” → ${s.name}`, 'ok');
    render();
  });
}

export { pLabel };
