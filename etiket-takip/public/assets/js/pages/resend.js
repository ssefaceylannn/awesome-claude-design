// Yeniden gönderim: pazaryerindeki sipariş detayını yapıştır → ürünler otomatik bulunur →
// kontrol edip kaydet. Kayıt üretim listesine girer; kampanya uygulanmaz.
import { html, mount, personName, icon, n, trDate, toast, today, addDays, confirmDialog, busy, emptyState, storeTag } from '../core/ui.js';
import { api, state, isAdmin, fetchOrders, invalidateOrders } from '../core/api.js';
import { computeOrder } from '../shared/calc.js';
import { parseResendText, detectStore } from '../shared/resend.js';

const EXAMPLE = `Sipariş No: 10234567890
Alıcı: Ayşe Yılmaz
Ultra Natura Detox Shot Zencefilli 60ml
Adet: 2
Satış Tutarı:
₺199,00
Satıcı İndirim Tutarı:
₺49,50
Faturalanacak Tutar:
₺149,50`;

export default async function resendPage(ctx) {
  const stores = state.config.stores.filter((s) => s.active !== false);
  const products = state.config.products.filter((p) => p.active !== false);
  const pname = (id) => state.ctx.label(id);
  let rows = []; // { productId, qty, raw, qtyFound }
  let parsed = { orderNo: '', recipient: '', amounts: {} };

  ctx.setSub('Eksik / hasarlı ürün gönderimleri — üretim listesine eklenir, kampanya uygulanmaz');
  mount(ctx.el, html`<div class="stack">
    <div class="grid g-2" style="align-items:start">
      <div class="card"><div class="card-h"><h2>Sipariş detayını yapıştır</h2><span class="sub">Pazaryeri panelindeki sipariş sayfasını kopyalayın</span></div>
        <div class="card-b stack">
          <textarea class="input" id="txt" rows="12" placeholder="${EXAMPLE}"></textarea>
          <div class="form">
            <label class="f">Mağaza<select class="input" id="store"><option value="">Mağaza seçin…</option>${stores.map((s) => html`<option value="${s.id}">${s.name}</option>`)}</select></label>
            <label class="f">Gönderim tarihi<input class="input" type="date" id="date" value="${today()}"></label>
            <label class="f full">Not <span class="hint">Neden yeniden gönderiliyor? (isteğe bağlı)</span><input class="input" id="note" maxlength="300" placeholder="Örn. kargoda kırılmış, eksik ürün…"></label>
          </div>
          <div class="muted small">Ürün adları kataloğunuzla otomatik eşleştirilir. Adet “Adet: 2”, “2 Adet” veya “2x Ürün” biçimlerinden okunur; bulunamazsa 1 alınır.</div>
        </div></div>
      <div class="card"><div class="card-h"><h2>Gönderilecek ürünler</h2><span class="sub" id="sum"></span></div>
        <div id="found"></div>
        <div class="card-f row wrap"><button class="btn" id="add">${icon('plus')}Ürün ekle</button><span class="spacer"></span>
          <button class="btn ghost" id="clear">Temizle</button><button class="btn primary" id="save">${icon('check')}Yeniden gönderimi kaydet</button></div>
      </div>
    </div>
    <div class="card"><div class="card-h"><h2>Son 30 günün yeniden gönderimleri</h2></div><div id="list"><div class="loading"><div class="spin"></div></div></div></div>
  </div>`);
  const $ = (s) => ctx.el.querySelector(s);
  const store = () => stores.find((s) => s.id === $('#store').value) || null;

  // Satırı, seçili mağazanın marka kurallarıyla katalog ürününe eşle
  const matchLine = (line) => {
    const st = store();
    const c = computeOrder({ k: '_', sender: st ? st.name : '', items: [{ name: line, qty: 1 }] }, state.ctx);
    return c.lines.length === 1 && c.lines[0].productId ? c.lines[0].productId : null;
  };

  function parse() {
    const text = $('#txt').value;
    if (!$('#store').value) { const st = detectStore(text, stores); if (st) $('#store').value = st.id; }
    parsed = parseResendText(text, matchLine);
    rows = parsed.items.map((x) => ({ ...x }));
    draw();
  }

  function draw() {
    const a = parsed.amounts;
    const info = [parsed.orderNo && `Sipariş ${parsed.orderNo}`, parsed.recipient && personName(parsed.recipient), a.billed != null && `${n(a.billed)} TL`].filter(Boolean);
    $('#sum').textContent = info.join(' · ');
    mount($('#found'), rows.length ? html`<div class="tw"><table class="t"><thead><tr><th>Ürün</th><th class="num" style="width:110px">Adet</th><th style="width:44px"></th></tr></thead><tbody>
      ${rows.map((r, i) => html`<tr><td><select class="input sm" data-p="${i}">${products.map((p) => html`<option value="${p.id}" ${p.id === r.productId ? 'selected' : ''}>${pname(p.id)}</option>`)}</select>
        ${r.raw ? html`<div class="muted xs" style="margin-top:3px">Metinde: ${r.raw}${r.qtyFound ? '' : ' · adet bulunamadı, 1 alındı'}</div>` : ''}</td>
        <td class="num"><input class="input sm" type="number" min="1" max="9999" value="${r.qty}" data-q="${i}" style="width:80px;text-align:right"></td>
        <td><button class="btn sm ghost icon danger" data-x="${i}" title="Kaldır">${icon('trash')}</button></td></tr>`)}
      </tbody></table></div>`
      : html`<div class="card-b">${emptyState('refresh', 'Henüz ürün yok', $('#txt').value.trim() ? 'Metinde katalogla eşleşen ürün bulunamadı; “Ürün ekle” ile elle ekleyin.' : 'Soldaki alana sipariş detayını yapıştırın.')}</div>`);
  }

  let t;
  $('#txt').addEventListener('input', () => { clearTimeout(t); t = setTimeout(parse, 200); });
  $('#store').addEventListener('change', parse);
  $('#found').addEventListener('change', (e) => {
    if (e.target.dataset.p) rows[+e.target.dataset.p].productId = e.target.value;
    if (e.target.dataset.q) rows[+e.target.dataset.q].qty = Math.max(1, Math.min(9999, parseInt(e.target.value, 10) || 1));
  });
  $('#found').addEventListener('click', (e) => {
    const b = e.target.closest('[data-x]');
    if (b) { rows.splice(+b.dataset.x, 1); draw(); }
  });
  $('#add').addEventListener('click', () => {
    if (!products.length) return toast('Önce Ürünler sayfasından ürün ekleyin', 'err');
    rows.push({ productId: products[0].id, qty: 1, raw: '', qtyFound: true });
    draw();
  });
  $('#clear').addEventListener('click', () => { $('#txt').value = ''; $('#note').value = ''; rows = []; parsed = { orderNo: '', recipient: '', amounts: {} }; draw(); });
  $('#save').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const st = store();
    if (!st) return toast('Mağaza seçin', 'err');
    if (!rows.length) return toast('Gönderilecek ürün yok', 'err');
    const date = $('#date').value || today();
    const stamp = Date.now().toString(36).toUpperCase();
    const order = {
      orderNo: `YG-${parsed.orderNo ? parsed.orderNo + '-' : ''}${stamp}`.slice(0, 60),
      sender: st.name,
      platform: st.platform,
      recipient: parsed.recipient,
      platformOrderNo: parsed.orderNo,
      amount: parsed.amounts.billed || 0,
      source: 'resend',
      note: $('#note').value.trim(),
      file: 'Yeniden gönderim',
      date,
      items: rows.map((r) => ({ name: pname(r.productId), qty: r.qty, productId: r.productId })),
    };
    busy(btn, true, 'Kaydediliyor…');
    try {
      await api.post('import', { orders: [order], files: ['Yeniden gönderim'], pages: 0 });
      invalidateOrders();
      toast(`Yeniden gönderim kaydedildi · ${n(rows.reduce((s, r) => s + r.qty, 0))} ürün`, 'ok');
      $('#clear').click();
      loadList();
    } catch (err) { toast(err.message, 'err'); }
    busy(btn, false);
  });

  async function loadList() {
    try {
      const all = await fetchOrders(addDays(today(), -30), today());
      if (!ctx.isCurrent()) return;
      const list = all.filter((o) => o.source === 'resend').reverse();
      mount($('#list'), list.length ? html`<div class="tw"><table class="t"><thead><tr><th>Tarih</th><th>Mağaza</th><th>Sipariş no</th><th>Alıcı</th><th>Ürünler</th><th>Not</th><th>Kaydeden</th>${isAdmin() ? html`<th></th>` : ''}</tr></thead><tbody>
        ${list.map((o) => { const c = computeOrder(o, state.ctx); return html`<tr><td class="nowrap">${trDate(o.date)}</td><td>${storeTag(c.store, o.sender)}</td><td class="nowrap">${o.platformOrderNo || '—'}</td><td class="small">${personName(o.recipient) || '—'}</td>
          <td class="lines small">${c.lines.map((l) => html`<div><span class="q">${l.qty}x</span> ${l.productId ? pname(l.productId) : l.raw}</div>`)}</td><td class="small">${o.note || ''}</td><td class="small">${personName(o.by)}</td>
          ${isAdmin() ? html`<td><button class="btn sm ghost icon danger" data-del="${o.k}" data-d="${o.date}" title="Sil">${icon('trash')}</button></td>` : ''}</tr>`; })}
      </tbody></table></div>` : html`<div class="card-b">${emptyState('refresh', 'Kayıt yok', 'Son 30 günde yeniden gönderim kaydedilmemiş.')}</div>`);
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
