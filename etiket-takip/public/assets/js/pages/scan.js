// Barkod kontrol: paketlenen siparişi okut, içeriğini göster, "kontrol edildi" işaretle.
import { html, mount, icon, n, pct, trDate, trDateTime, toast, addDays, storeTag, emptyState } from '../core/ui.js';
import { api, state, fetchOrders, getRange, patchCachedOrder, invalidateOrders } from '../core/api.js';
import { computeOrder } from '../shared/calc.js';
import { rangePicker } from '../core/widgets.js';

let audio;
function beep(ok) {
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = ok ? 'sine' : 'square';
    o.frequency.value = ok ? 880 : 200;
    g.gain.value = 0.08;
    o.connect(g); g.connect(audio.destination);
    o.start(); o.stop(audio.currentTime + (ok ? 0.12 : 0.4));
  } catch { /* ses yok */ }
}

export default async function scanPage(ctx) {
  let day = getRange().to;
  let orders = [];
  const pname = (id) => (state.ctx.productsById.get(id) || {}).name || '?';

  mount(ctx.el, html`<div class="stack">
    <div class="card"><div class="card-b stack">
      <div class="row wrap"><div id="picker"></div><span class="spacer"></span><span class="muted small">Seçili gün ve önceki 2 günün siparişlerinde aranır</span></div>
      <div class="scan-hero">
        <div class="search" style="flex:1">${icon('scan')}<input class="input lg" id="code" placeholder="Sipariş veya kargo barkodunu okutun…" autocomplete="off" style="padding-left:40px"></div>
        <button class="btn lg hidden" id="cam">${icon('camera')}Kamera</button>
      </div>
      <video class="cam hidden" id="video" playsinline muted></video>
      <div id="result"></div>
    </div></div>
    <div id="list"></div>
  </div>`);
  const $ = (s) => ctx.el.querySelector(s);
  const input = $('#code');
  rangePicker($('#picker'), { single: true, onChange: (f) => { day = f; load(); } });
  setTimeout(() => input.focus(), 50);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); const v = input.value.trim(); input.value = ''; if (v) scan(v); } });

  async function load() {
    ctx.setSub(trDate(day, true));
    try { orders = await fetchOrders(addDays(day, -2), day); } catch (e) { toast(e.message, 'err'); orders = []; }
    renderList();
  }

  function renderList() {
    const todays = orders.filter((o) => o.date === day);
    const done = todays.filter((o) => o.checked).length;
    const pending = todays.filter((o) => !o.checked);
    const recent = todays.filter((o) => o.checked).sort((a, b) => (b.checkedAt || '').localeCompare(a.checkedAt || '')).slice(0, 15);
    mount($('#list'), html`<div class="stack">
      <div class="card"><div class="card-b">
        <div class="row" style="margin-bottom:8px"><b>${n(done)} / ${n(todays.length)} sipariş kontrol edildi</b><span class="spacer"></span><span class="muted">%${pct(done, todays.length)}</span></div>
        <div class="progress" style="height:10px"><i style="width:${pct(done, todays.length)}%"></i></div>
      </div></div>
      <div class="grid g-2">
        <div class="card"><div class="card-h"><h2>Bekleyenler</h2><span class="sub">${n(pending.length)} sipariş</span></div>
          <div class="tw" style="max-height:480px"><table class="t"><tbody>${pending.length ? pending.map((o) => {
            const c = computeOrder(o, state.ctx);
            return html`<tr><td class="nowrap"><b>${o.no}</b><div class="muted xs">${o.cargoCode}</div></td><td>${storeTag(c.store, o.sender)}</td><td class="lines small">${c.lines.map((l) => html`<div><span class="q">${l.units}x</span> ${l.productId ? pname(l.productId) : l.raw}</div>`)}${c.rewards.map((r) => html`<div class="gift">+${r.qty} ${pname(r.productId)}</div>`)}</td></tr>`;
          }) : html`<tr><td>${emptyState('check', todays.length ? 'Hepsi kontrol edildi' : 'Bu gün için sipariş yok', '')}</td></tr>`}</tbody></table></div></div>
        <div class="card"><div class="card-h"><h2>Son okutulanlar</h2></div>
          <div class="tw" style="max-height:480px"><table class="t"><tbody>${recent.length ? recent.map((o) => html`<tr><td><b>${o.no}</b></td><td class="small muted">${o.checkedBy}</td><td class="small muted nowrap">${trDateTime(o.checkedAt).slice(11)}</td>
            <td class="num"><button class="btn sm ghost" data-undo="${o.k}" data-d="${o.date}">Geri al</button></td></tr>`) : html`<tr><td class="muted small" style="padding:16px">Henüz okutma yok</td></tr>`}</tbody></table></div></div>
      </div>
    </div>`);
  }

  async function scan(code) {
    const c = code.replace(/\s+/g, '');
    const alt = c.startsWith('#') ? c.slice(1) : '#' + c;
    const found = orders.filter((o) => o.cargoCode === c || o.no === c || o.no === alt || o.platformOrderNo === c || o.packageNo === c).sort((a, b) => b.date.localeCompare(a.date));
    const box = $('#result');
    if (!found.length) {
      beep(false);
      mount(box, html`<div class="scan-res nf"><h2>${icon('x')} Bulunamadı: ${c}</h2><p class="muted" style="margin-top:6px">Bu barkod ${trDate(addDays(day, -2))} – ${trDate(day)} arasındaki siparişlerde yok. Etiketin yüklendiğinden ve doğru günün seçili olduğundan emin olun.</p></div>`);
      return;
    }
    const o = found[0];
    const again = o.checked;
    let rec = o;
    if (!again) {
      try {
        rec = (await api.post('check', { date: o.date, k: o.k, checked: true })).order;
        patchCachedOrder(rec);
        Object.assign(o, rec);
      } catch (e) { toast(e.message, 'err'); }
    }
    beep(!again);
    const cc = computeOrder(rec, state.ctx);
    mount(box, html`<div class="scan-res ${again ? 'again' : 'ok'}">
      <div class="row wrap"><h2>${again ? html`${icon('alert')} Daha önce okutuldu` : html`${icon('check')} Kontrol edildi`} — ${rec.no}</h2><span class="spacer"></span>${storeTag(cc.store, rec.sender)}</div>
      <div class="muted small" style="margin-top:4px">${rec.recipient} · ${trDate(rec.date)}${again ? ` · ilk okutma ${rec.checkedBy}, ${trDateTime(rec.checkedAt)}` : ''}${found.length > 1 ? ` · ${found.length} eşleşme, en yenisi gösteriliyor` : ''}</div>
      <ul>${cc.lines.map((l) => html`<li><b>${l.units}×</b> ${l.productId ? pname(l.productId) : html`<span class="unm">${l.raw}</span>`}</li>`)}
      ${cc.rewards.map((r) => html`<li class="gift"><b>+${r.qty}×</b> ${pname(r.productId)} <span class="small">(${r.name})</span></li>`)}</ul>
    </div>`);
    renderList();
  }

  $('#list').addEventListener('click', async (e) => {
    const u = e.target.closest('[data-undo]');
    if (!u) return;
    try {
      const r = await api.post('check', { date: u.dataset.d, k: u.dataset.undo, checked: false });
      patchCachedOrder(r.order);
      const o = orders.find((x) => x.k === u.dataset.undo && x.date === u.dataset.d);
      if (o) Object.assign(o, r.order);
      renderList();
    } catch (err) { toast(err.message, 'err'); }
  });

  // Kamera (Chrome / Android)
  let stream = null, timer = null;
  const stopCam = () => { clearInterval(timer); if (stream) stream.getTracks().forEach((t) => t.stop()); stream = null; $('#video').classList.add('hidden'); };
  if ('BarcodeDetector' in window) {
    const btn = $('#cam');
    btn.classList.remove('hidden');
    btn.addEventListener('click', async () => {
      if (stream) return stopCam();
      try {
        const det = new window.BarcodeDetector({ formats: ['code_128', 'ean_13', 'ean_8', 'code_39', 'itf', 'qr_code'] });
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        const v = $('#video');
        v.srcObject = stream; v.classList.remove('hidden'); await v.play();
        let last = '', at = 0;
        timer = setInterval(async () => {
          try {
            const codes = await det.detect(v);
            if (codes.length && (codes[0].rawValue !== last || Date.now() - at > 3000)) { last = codes[0].rawValue; at = Date.now(); scan(last); }
          } catch { /* kare atla */ }
        }, 350);
      } catch (err) { stopCam(); toast('Kamera açılamadı: ' + err.message, 'err'); }
    });
  }

  invalidateOrders();
  load();
  return stopCam;
}
