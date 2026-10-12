// Yeniden gönderim: Trendyol sipariş listesini (ya da tek bir sipariş detayını) yapıştır →
// her sipariş için barkodlu gönderim etiketi (isim, sipariş no, mağaza + firma, ürünler, 734… kodu).
// İsteğe bağlı olarak üretim listesine "yeniden gönderim" olarak eklenir (kampanya uygulanmaz).
import { html, raw, mount, personName, icon, n, trDate, toast, today, addDays, confirmDialog, busy, emptyState, storeTag, modal } from '../core/ui.js';
import { api, state, isAdmin, fetchOrders, invalidateOrders } from '../core/api.js';
import { computeOrder } from '../shared/calc.js';
import { parseResendText, parseOrderList, detectStore, companyFor } from '../shared/resend.js';
import { barcodeSvg } from '../shared/barcode.js';

const SIZES = [{ id: '150', label: '100 × 150 mm', css: '100mm 150mm' }, { id: '100', label: '100 × 100 mm', css: '100mm 100mm' }];
const PREF = 'et-resend';
const loadPref = () => { try { return JSON.parse(localStorage.getItem(PREF) || '{}'); } catch { return {}; } };
const savePref = (p) => { try { localStorage.setItem(PREF, JSON.stringify(p)); } catch { /* yok */ } };

/** Tek etiket (ekranda önizleme ve yazdırma için aynı işaretleme) */
export function labelHtml(o, store, size) {
  let bc = '';
  if (o.code) {
    try { bc = html`<div class="pl-bc">${raw(barcodeSvg(o.code))}<div class="pl-code">${o.code}</div></div>`; } catch { bc = html`<div class="pl-bc pl-miss">Barkod oluşturulamadı: ${o.code}</div>`; }
  } else bc = html`<div class="pl-bc pl-miss">Kargo kodu (734…) bulunamadı</div>`;
  const company = companyFor(store);
  return html`<div class="plabel sz-${size}">
    <div class="pl-head"><div class="pl-name">${personName(o.recipient) || '—'}</div><div class="pl-no">${o.orderNo ? '#' + o.orderNo : ''}</div></div>
    <div class="pl-store"><span class="pl-sname">${store ? store.name : 'Mağaza seçilmedi'}</span>${company ? html`<span class="pl-comp">${company}</span>` : ''}</div>
    <div class="pl-items">${o.items.map((it) => html`<div class="pl-item"><b>${it.qty} ×</b> <span>${it.name}</span></div>`)}</div>
    ${bc}
  </div>`;
}

export default async function resendPage(ctx) {
  const stores = state.config.stores.filter((s) => s.active !== false);
  const pname = (id) => state.ctx.label(id);
  const pref = loadPref();
  let orders = []; // { orderNo, recipient, code, items:[{name, qty, productId?}], on }

  ctx.setSub('Barkodlu gönderim etiketi — isteğe bağlı olarak üretim listesine eklenir');
  mount(ctx.el, html`<div class="stack">
    <div class="card"><div class="card-h"><h2>Siparişleri yapıştır</h2><span class="sub">Trendyol satıcı panelindeki sipariş listesini (bir veya birden çok sipariş) kopyalayın</span></div>
      <div class="card-b stack">
        <textarea class="input" id="txt" rows="8" placeholder="#11613864400&#10;Sipariş Tarihi: …&#10;Ad Soyad&#10;2&#10;Ürün adı-image&#10;…&#10;7340037450818569"></textarea>
        <div class="resend-opts">
          <label class="f">Mağaza<select class="input" id="store"><option value="">Mağaza seçin…</option>${stores.map((s) => html`<option value="${s.id}" ${s.id === pref.store ? 'selected' : ''}>${s.name}${companyFor(s) ? ` — ${companyFor(s)}` : ''}</option>`)}</select></label>
          <label class="f">Etiket boyutu<select class="input" id="size">${SIZES.map((z) => html`<option value="${z.id}" ${z.id === (pref.size || '150') ? 'selected' : ''}>${z.label}</option>`)}</select></label>
          <label class="f">Gönderim tarihi<input class="input" type="date" id="date" value="${today()}"></label>
          <label class="f">Not <span class="hint">isteğe bağlı</span><input class="input" id="note" maxlength="300" placeholder="Örn. kargoda kırılmış"></label>
        </div>
        <div class="row wrap">
          <label class="check"><input type="checkbox" id="saveToo" ${pref.saveToo === false ? '' : 'checked'}> Üretim listesine de ekle</label>
          <span class="spacer"></span>
          <button class="btn ghost" id="clear">Temizle</button>
          <button class="btn primary" id="labelPrint">${icon('printer')}<span id="printLbl">Etiketleri yazdır</span></button>
        </div>
      </div></div>
    <div id="preview"></div>
    <div class="card"><div class="card-h"><h2>Son 30 günün yeniden gönderimleri</h2></div><div id="list"><div class="loading"><div class="spin"></div></div></div></div>
  </div>`);
  const $ = (s) => ctx.el.querySelector(s);
  const store = () => stores.find((s) => s.id === $('#store').value) || null;
  const size = () => $('#size').value;

  // Tek sipariş detayı (liste biçimi değilse): ürünler katalogla eşleştirilir
  const matchLine = (line) => {
    const st = store();
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
    draw();
  }

  function draw() {
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
          <div class="label-zoom">${labelHtml(o, st, size())}</div></div>`;
      })}</div></div></div>`);
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
  $('#txt').addEventListener('input', () => { clearTimeout(t); t = setTimeout(parse, 200); });
  $('#store').addEventListener('change', () => { savePref({ ...loadPref(), store: $('#store').value }); parse(); });
  $('#size').addEventListener('change', () => { savePref({ ...loadPref(), size: size() }); draw(); });
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
    const z = SIZES.find((x) => x.id === size()) || SIZES[0];
    mount(document.getElementById('print'), html`<style>@page { size: ${z.css}; margin: 0 }</style><div class="plabels">${on.map((o) => labelHtml(o, st, z.id))}</div>`);
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
