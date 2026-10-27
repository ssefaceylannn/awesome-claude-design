// Yeniden gönderim: Trendyol sipariş listesini (ya da tek bir sipariş detayını) yapıştır →
// her sipariş için barkodlu gönderim etiketi (isim, sipariş no, mağaza + firma, ürünler, 734… kodu).
// İsteğe bağlı olarak üretim listesine "yeniden gönderim" olarak eklenir (kampanya uygulanmaz).
import { html, raw, mount, personName, icon, n, trDate, toast, today, addDays, confirmDialog, busy, emptyState, storeTag, modal } from '../core/ui.js';
import { api, state, isAdmin, fetchOrders, invalidateOrders } from '../core/api.js';
import { computeOrder } from '../shared/calc.js';
import { parseResendText, parseOrderList, detectStore, companyFor } from '../shared/resend.js';
import { paperById, paperPicker } from '../core/paper.js';
import { renderLabel, fitLabels, openDesigner } from '../core/labeldesign.js';

const PREF = 'et-resend';
const loadPref = () => { try { return JSON.parse(localStorage.getItem(PREF) || '{}'); } catch { return {}; } };
const savePref = (p) => { try { localStorage.setItem(PREF, JSON.stringify(p)); } catch { /* yok */ } };

// Önceki sürümdeki "150"/"100" seçimi yeni kâğıt kimliklerine
const OLD_SIZE = { 150: 'l100x150', 100: 'l100x100' };

export default async function resendPage(ctx) {
  const stores = state.config.stores.filter((s) => s.active !== false);
  const pname = (id) => state.ctx.label(id);
  const pref = loadPref();
  let paper = paperById(OLD_SIZE[pref.size] || pref.size || 'l100x150', 'l100x150');
  let orders = []; // { orderNo, recipient, code, items:[{name, qty, productId?}], on }

  ctx.setSub('Barkodlu gönderim etiketi — isteğe bağlı olarak üretim listesine eklenir');
  mount(ctx.el, html`<div class="stack">
    <div class="card"><div class="card-h"><h2>Siparişleri yapıştır</h2><span class="sub">Trendyol satıcı panelindeki sipariş listesini (bir veya birden çok sipariş) kopyalayın</span></div>
      <div class="card-b stack">
        <textarea class="input" id="txt" rows="8" placeholder="#11613864400&#10;Sipariş Tarihi: …&#10;Ad Soyad&#10;2&#10;Ürün adı-image&#10;…&#10;7340037450818569"></textarea>
        <div class="resend-opts">
          <label class="f">Mağaza<select class="input" id="store"><option value="">Mağaza seçin…</option>${stores.map((s) => html`<option value="${s.id}" ${s.id === pref.store ? 'selected' : ''}>${s.name}${companyFor(s) ? ` — ${companyFor(s)}` : ''}</option>`)}</select></label>
          <div class="f">Etiket kâğıdı<div id="paper"></div></div>
          <label class="f">Gönderim tarihi<input class="input" type="date" id="date" value="${today()}"></label>
          <label class="f">Not <span class="hint">isteğe bağlı</span><input class="input" id="note" maxlength="300" placeholder="Örn. kargoda kırılmış"></label>
        </div>
        <div class="row wrap">
          <label class="check"><input type="checkbox" id="saveToo" ${pref.saveToo === false ? '' : 'checked'}> Üretim listesine de ekle</label>
          <span class="spacer"></span>
          <button class="btn ghost" id="clear">Temizle</button>
          <button class="btn" id="design">${icon('edit')}Etiket tasarımı</button>
          <button class="btn primary" id="labelPrint">${icon('printer')}<span id="printLbl">Etiketleri yazdır</span></button>
        </div>
      </div></div>
    <div id="preview"></div>
    <div class="card"><div class="card-h"><h2>Son 30 günün yeniden gönderimleri</h2></div><div id="list"><div class="loading"><div class="spin"></div></div></div></div>
  </div>`);
  const $ = (s) => ctx.el.querySelector(s);
  const store = () => stores.find((s) => s.id === $('#store').value) || null;
  // Seçilen kâğıt, değiştirilene kadar hatırlanır
  const picker = paperPicker($('#paper'), { selected: paper.id, onChange: (p) => { paper = p; savePref({ ...loadPref(), size: p.id }); draw(); } });
  const zoomFor = (p) => Math.min(0.72, 260 / (p.w * 96 / 25.4));

  // Tek sipariş detayı (liste biçimi değilse): ürünler katalogla eşleştirilir
  const matchCache = new Map(); // mağaza|satır → ürün (her tuşta aynı satırlar yeniden eşleştirilmesin)
  const matchLine = (line) => {
    const st = store();
    const ck = (st ? st.id : '') + '|' + line;
    if (matchCache.has(ck)) return matchCache.get(ck);
    const r = matchLineRaw(line, st);
    matchCache.set(ck, r);
    return r;
  };
  const matchLineRaw = (line, st) => {
    const c = computeOrder({ k: '_', sender: st ? st.name : '', items: [{ name: line, qty: 1 }] }, state.ctx);
    return c.lines.length === 1 && c.lines[0].productId ? c.lines[0].productId : null;
  };

  function parse() {
    const text = $('#txt').value;
    if (!$('#store').value) { const st = detectStore(text, stores); if (st) $('#store').value = st.id; }
    const list = parseOrderList(text);
    if (list.length) orders = list.map((o) => ({ ...o, on: true }));
    else if (text.trim()) {
      const r = parseResendText(text, matchLine);
      const code = (text.match(/\b734\d{9,}\b/) || [''])[0];
      orders = [{ orderNo: r.orderNo, recipient: r.recipient, code, amounts: r.amounts, items: r.items.map((x) => ({ name: pname(x.productId), qty: x.qty, productId: x.productId })), on: true }];
    } else orders = [];
    // Okunan siparişler değişmediyse (ör. metnin sonuna boşluk) önizleme yeniden çizilmez
    if (sigNow() === lastSig) return;
    draw();
  }
  let lastSig = ''; // son çizilen önizlemenin imzası (her çizimde güncellenir)
  const sigNow = () => JSON.stringify([orders, $('#store').value, paper.id, $('#txt').value.trim() ? 1 : 0]);

  function draw() {
    lastSig = sigNow();
    const st = store();
    const on = orders.filter((o) => o.on);
    $('#printLbl').textContent = on.length ? `${on.length} etiketi yazdır` : 'Etiketleri yazdır';
    if (!orders.length) {
      mount($('#preview'), $('#txt').value.trim() ? html`<div class="callout warn">${icon('alert')}<div class="c"><b>Sipariş okunamadı</b>Metinde “#11…” ile başlayan sipariş ya da katalogla eşleşen ürün bulunamadı.</div></div>` : '');
      return;
    }
    mount($('#preview'), html`<div class="card"><div class="card-h"><h2>Önizleme</h2><span class="sub">${n(orders.length)} sipariş · ${n(orders.reduce((s, o) => s + o.items.reduce((a, it) => a + it.qty, 0), 0))} ürün</span></div>
      <div class="card-b"><div class="label-grid">${orders.map((o, i) => {
        const c = computeOrder({ k: '_', sender: st ? st.name : '', source: 'resend', items: o.items }, state.ctx);
        const unm = c.lines.filter((l) => !l.productId && !l.ignored).length;
        return html`<div class="label-cell ${o.on ? '' : 'off'}">
          <div class="row" style="gap:8px;margin-bottom:8px"><label class="check"><input type="checkbox" data-on="${i}" ${o.on ? 'checked' : ''}> Yazdır</label><span class="spacer"></span>
            ${!o.code ? html`<span class="badge err">Barkod yok</span>` : ''}${!o.items.length ? html`<span class="badge err">Ürün yok</span>` : unm ? html`<span class="badge warn" title="Üretim listesinde eşleşmeyen ürün olarak görünür; Ürün Eşleştirme'den atayın">${unm} ürün eşleşmedi</span>` : html`<span class="badge ok">${icon('check')} Ürünler eşleşti</span>`}
            <button class="btn sm ghost icon" data-edit="${i}" title="Düzenle">${icon('edit')}</button></div>
          <div class="label-zoom" style="zoom:${zoomFor(paper)}">${renderLabel(o, st, paper)}</div></div>`;
      })}</div></div></div>`);
    fitLabels($('#preview'));
  }

  async function editOrder(i) {
    const o = orders[i];
    await modal({
      title: 'Etiketi düzenle',
      body: html`<div class="form">
        <label class="f">Alıcı<input class="input" name="recipient" value="${o.recipient}" maxlength="120"></label>
        <label class="f">Sipariş no<input class="input" name="orderNo" value="${o.orderNo}" maxlength="40"></label>
        <label class="f full">Kargo kodu (barkod)<input class="input" name="code" value="${o.code}" maxlength="40"></label>
        <label class="f full">Ürünler <span class="hint">Her satıra “adet × ürün adı”</span><textarea class="input" name="items" rows="5">${o.items.map((it) => `${it.qty} × ${it.name}`).join('\n')}</textarea></label>
      </div>`,
      actions: [{ label: 'Vazgeç', value: 'cancel' }, { label: 'Kaydet', value: 'save', variant: 'primary' }],
      onSubmit: (_, d) => {
        const f = (k) => d.querySelector(`[name=${k}]`).value.trim();
        const code = f('code').replace(/\s+/g, '');
        if (code && /[^\x20-\x7e]/.test(code)) throw new Error('Kargo kodunda geçersiz karakter var');
        const items = f('items').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
          const m = l.match(/^(\d{1,4})\s*[×x*]\s*(.+)$/i);
          const name = (m ? m[2] : l).trim();
          const prev = o.items.find((it) => it.name === name);
          return { name, qty: m ? +m[1] : 1, ...(prev && prev.productId ? { productId: prev.productId } : {}) };
        });
        orders[i] = { ...o, recipient: f('recipient'), orderNo: f('orderNo').replace(/^#/, ''), code, items };
      },
    });
    draw();
  }

  let t;
  $('#txt').addEventListener('input', () => { clearTimeout(t); t = setTimeout(parse, 400); });
  $('#store').addEventListener('change', () => { savePref({ ...loadPref(), store: $('#store').value }); parse(); });
  $('#design').addEventListener('click', async () => {
    const sample = orders.find((o) => o.on) || null;
    await openDesigner({ paperId: paper.id, sample, store: store(), onSave: (p) => { paper = p; savePref({ ...loadPref(), size: p.id }); picker.set(p.id); } });
    draw();
  });
  $('#saveToo').addEventListener('change', () => savePref({ ...loadPref(), saveToo: $('#saveToo').checked }));
  $('#preview').addEventListener('change', (e) => { if (e.target.dataset.on) { orders[+e.target.dataset.on].on = e.target.checked; draw(); } });
  $('#preview').addEventListener('click', (e) => { const b = e.target.closest('[data-edit]'); if (b) editOrder(+b.dataset.edit); });
  $('#clear').addEventListener('click', () => { $('#txt').value = ''; $('#note').value = ''; orders = []; draw(); });

  $('#labelPrint').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const st = store();
    const on = orders.filter((o) => o.on);
    if (!st) return toast('Mağaza seçin', 'err');
    if (!on.length) return toast('Yazdırılacak sipariş yok', 'err');
    if ($('#saveToo').checked) {
      const date = $('#date').value || today();
      const note = $('#note').value.trim();
      const stamp = Date.now().toString(36).toUpperCase();
      const list = on.filter((o) => o.items.length).map((o, k) => ({
        // Aynı gün aynı sipariş tekrar yazdırılırsa ikinci kez sayılmaz
        orderNo: (o.orderNo ? `YG-${o.orderNo}-${date.replace(/-/g, '')}` : `YG-${stamp}-${k + 1}`).slice(0, 60),
        sender: st.name, platform: st.platform, recipient: o.recipient, platformOrderNo: o.orderNo, cargoCode: o.code,
        amount: (o.amounts && o.amounts.billed) || 0, source: 'resend', note, file: 'Yeniden gönderim', date,
        items: o.items.map((it) => ({ name: it.name, qty: it.qty, ...(it.productId ? { productId: it.productId } : {}) })),
      }));
      busy(btn, true, 'Kaydediliyor…');
      try {
        const r = await api.post('import', { orders: list, files: ['Yeniden gönderim etiketi'], pages: 0 });
        invalidateOrders();
        toast(`Üretim listesine eklendi: ${n(r.counts.new)} yeni${r.counts.dup ? ` · ${n(r.counts.dup)} zaten kayıtlıydı` : ''}`, 'ok');
        loadList();
      } catch (err) { busy(btn, false); return toast(err.message, 'err'); }
      busy(btn, false);
    }
    const box = document.getElementById('print');
    mount(box, html`<style>@page { size: ${paper.w}mm ${paper.h}mm; margin: 0 }</style><div class="plabels">${on.map((o) => renderLabel(o, st, paper))}</div>`);
    fitLabels(box); // sığmayan ürün listesi/isim kendi alanına sığacak kadar küçülür
    window.addEventListener('afterprint', () => { box.innerHTML = ''; }, { once: true });
    window.print();
  });

  async function loadList() {
    try {
      const all = await fetchOrders(addDays(today(), -30), today());
      if (!ctx.isCurrent()) return;
      const list = all.filter((o) => o.source === 'resend').reverse();
      mount($('#list'), list.length ? html`<div class="tw"><table class="t"><thead><tr><th>Tarih</th><th>Mağaza</th><th>Sipariş no</th><th>Alıcı</th><th>Ürünler</th><th>Kargo kodu</th><th>Kaydeden</th>${isAdmin() ? html`<th></th>` : ''}</tr></thead><tbody>
        ${list.map((o) => { const c = computeOrder(o, state.ctx); return html`<tr><td class="nowrap">${trDate(o.date)}</td><td>${storeTag(c.store, o.sender)}</td><td class="nowrap">${o.platformOrderNo || '—'}</td><td class="small">${personName(o.recipient) || '—'}</td>
          <td class="lines small">${c.lines.map((l) => html`<div><span class="q">${l.qty}x</span> ${l.productId ? pname(l.productId) : html`<span class="unm">${l.raw} ⚠</span>`}</div>`)}${o.note ? html`<div class="muted xs">${o.note}</div>` : ''}</td>
          <td class="small nowrap">${o.cargoCode || '—'}</td><td class="small">${personName(o.by)}</td>
          ${isAdmin() ? html`<td><button class="btn sm ghost icon danger" data-del="${o.k}" data-d="${o.date}" title="Sil">${icon('trash')}</button></td>` : ''}</tr>`; })}
      </tbody></table></div>` : html`<div class="card-b">${emptyState('refresh', 'Kayıt yok', 'Son 30 günde üretim listesine eklenen yeniden gönderim yok.')}</div>`);
    } catch (err) { mount($('#list'), html`<div class="card-b unm">${err.message}</div>`); }
  }
  $('#list').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-del]');
    if (!b) return;
    if (!(await confirmDialog('Bu kayıt üretim listesinden de çıkar.', { title: 'Yeniden gönderimi sil', ok: 'Sil', danger: true }))) return;
    try {
      await api.del(`order?date=${b.dataset.d}&k=${encodeURIComponent(b.dataset.del)}`);
      invalidateOrders();
      toast('Silindi', 'ok');
      loadList();
    } catch (err) { toast(err.message, 'err'); }
  });

  draw();
  loadList();
}
