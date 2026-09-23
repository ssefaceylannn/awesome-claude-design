/* Etiket Takip — uygulama mantığı */
(function () {
  'use strict';

  // ------------------------------------------------------------------ yardımcılar
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nf = new Intl.NumberFormat('tr-TR');
  const n = (v) => nf.format(v || 0);
  const pad = (v) => String(v).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = () => ymd(new Date());
  const parseYmd = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (s, k) => { const d = parseYmd(s); d.setDate(d.getDate() + k); return ymd(d); };
  const DAYS = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];
  const trDate = (s, withDay) => { if (!s) return ''; const [y, m, d] = s.split('-'); return `${d}.${m}.${y}` + (withDay ? ' ' + DAYS[parseYmd(s).getDay()] : ''); };
  const trDateTime = (iso) => { const d = new Date(iso); return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const lower = (s) => String(s || '').toLocaleLowerCase('tr-TR').trim();
  const collator = new Intl.Collator('tr-TR');
  const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const orderId = (store, orderNo) => `${lower(store)}|${orderNo}`;

  const PLATFORM_LABEL = { trendyol: 'Trendyol', ikas: 'ikas', shopify: 'Shopify', hepsiburada: 'Hepsiburada', n11: 'n11', amazon: 'Amazon', pazarama: 'Pazarama', 'çiçeksepeti': 'ÇiçekSepeti' };
  const pLabel = (p) => PLATFORM_LABEL[p] || p || '—';
  const pBadge = (p) => `<span class="badge p-${esc(p)}">${esc(pLabel(p))}</span>`;

  function toast(msg, ms) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove('show'), ms || 2600);
  }

  function download(name, content, mime) {
    const blob = content instanceof Blob ? content : new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  // Türkçe Excel ; ayırıcı ve UTF-8 BOM ile doğru açar
  function toCsv(rows) {
    const cell = (v) => {
      const s = String(v == null ? '' : v);
      return /[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    return '﻿' + rows.map((r) => r.map(cell).join(';')).join('\r\n');
  }

  // ------------------------------------------------------------------ durum
  const state = {
    retention: 365,
    campaigns: [],
    aliases: {}, // etiketteki ad -> raporda görünen ad
    productOrder: [], // raporda görünen adların sırası
    stores: {}, // mağaza adı -> { platform, detected }
    knownProducts: [], // etiketlerde görülen ham ürün adları
    lastOrderId: null, // bir sonraki yüklemedeki "devamı" sayfaları için
    lastBatchId: null,
  };
  const canon = (name) => state.aliases[name] || name;
  const platformOf = (o) => (state.stores[o.store] && state.stores[o.store].platform) || o.platform || '';

  async function loadState() {
    const [retention, campaigns, aliases, productOrder, stores, knownProducts, lastOrderId] = await Promise.all([
      DB.kvGet('retention', 365), DB.kvGet('campaigns', []), DB.kvGet('aliases', {}), DB.kvGet('productOrder', []),
      DB.kvGet('stores', {}), DB.kvGet('knownProducts', []), DB.kvGet('lastOrderId', null),
    ]);
    Object.assign(state, { retention, campaigns, aliases, productOrder, stores, knownProducts, lastOrderId });
  }
  const save = (key) => DB.kvSet(key, state[key]);

  // ------------------------------------------------------------------ kampanyalar
  function campaignApplies(c, o) {
    if (!c.active) return false;
    if (c.start && o.date < c.start) return false;
    if (c.end && o.date > c.end) return false;
    if (c.platform && c.platform !== '*' && platformOf(o) !== c.platform) return false;
    if (c.store && c.store !== '*' && o.store !== c.store) return false;
    return true;
  }

  function applyCampaigns(o) {
    const applied = [];
    for (const c of state.campaigns) {
      if (!campaignApplies(c, o)) continue;
      const target = lower(c.product);
      const qty = o.items.filter((it) => lower(canon(it.name)) === target).reduce((s, it) => s + it.qty, 0);
      const buy = Math.max(1, +c.buyQty || 1);
      const get = Math.max(1, +c.getQty || 1);
      if (qty < buy) continue;
      const extra = c.mode === 'once' ? get : Math.floor(qty / buy) * get;
      if (extra > 0) applied.push({ campaignId: c.id, campaign: c.name, product: c.giftProduct || c.product, qty: extra });
    }
    o.applied = applied;
    return o;
  }

  const describeCampaign = (c) => {
    const gift = c.giftProduct ? `${c.getQty} adet “${c.giftProduct}” hediye` : `${c.getQty} adet daha`;
    return c.mode === 'once'
      ? `En az ${c.buyQty} adet “${c.product}” içeren siparişe bir kez ${gift}`
      : `Her ${c.buyQty} adet “${c.product}” için ${gift}`;
  };

  // ------------------------------------------------------------------ sekmeler
  const renderers = {};
  let currentView = 'import';
  function show(view) {
    currentView = view;
    $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === view));
    $$('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + view));
    if (renderers[view]) renderers[view]();
    if (view === 'scan') setTimeout(() => $('#scanInput').focus(), 50);
    try { localStorage.setItem('et-view', view); } catch (_) {}
  }
  $$('.tab').forEach((t) => t.addEventListener('click', () => show(t.dataset.view)));

  // ================================================================== YÜKLEME
  if (window.pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';

  const dropZone = $('#dropZone');
  $('#fileInput').addEventListener('change', (e) => { handleFiles(e.target.files); e.target.value = ''; });
  ['dragenter', 'dragover'].forEach((ev) => dropZone.addEventListener(ev, (e) => { e.preventDefault(); dropZone.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => dropZone.addEventListener(ev, (e) => { e.preventDefault(); dropZone.classList.remove('over'); }));
  dropZone.addEventListener('drop', (e) => handleFiles(e.dataTransfer.files));
  $('#dateMode').addEventListener('change', (e) => { $('#manualDateWrap').hidden = e.target.value !== 'manual'; });
  $('#manualDate').value = today();

  async function readPdfPages(file, fileDate) {
    const doc = await pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const pages = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const vp = page.getViewport({ scale: 1 });
      const tc = await page.getTextContent();
      const p = LabelParser.parsePage(tc.items, vp.height);
      p.file = file.name;
      p.filePage = i;
      p.date = fileDate;
      pages.push(p);
    }
    await doc.destroy();
    return pages;
  }

  async function handleFiles(fileList) {
    const files = Array.from(fileList || []).filter((f) => /\.pdf$/i.test(f.name) || f.type === 'application/pdf');
    if (!files.length) return toast('PDF dosyası seçilmedi');
    if (!window.pdfjsLib) return toast('PDF okuyucu yüklenemedi, sayfayı yenileyin');
    files.sort((a, b) => collator.compare(a.name, b.name));
    const manual = $('#dateMode').value === 'manual' ? $('#manualDate').value : '';
    toast('Etiketler okunuyor…', 10000);

    const log = [];
    let pages = [];
    for (const f of files) {
      const d = manual || LabelParser.dateFromFileName(f.name) || today();
      try {
        pages = pages.concat(await readPdfPages(f, d));
      } catch (err) {
        console.error(err);
        log.push({ type: 'error', msg: `${f.name}: okunamadı (${err.message || err})` });
      }
    }
    const combined = LabelParser.combinePages(pages);
    log.push(...combined.log);

    const batchId = uid('b');
    const importedAt = new Date().toISOString();
    const toSave = [];
    const rows = [];
    const newIds = [];
    let lastId = state.lastOrderId;
    const seenProducts = new Set(state.knownProducts);
    let storesChanged = false;

    for (const o of combined.orders) {
      o.items.forEach((it) => seenProducts.add(it.name));

      if (o.orphan) {
        // Önceki yüklemede kalmış siparişin devamı
        const target = lastId && (toSave.find((x) => x.id === lastId) || (await DB.get('orders', lastId)));
        if (target) {
          mergeItems(target, o.items);
          target.pages = (target.pages || 0) + o.pages.length;
          applyCampaigns(target);
          if (!toSave.includes(target)) toSave.push(target);
          rows.push({ status: 'merged', o: target, note: 'Devam etiketi önceki yüklemedeki siparişe eklendi' });
          log.push({ type: 'cont', msg: `${o.file}: başlıksız devam etiketi ${target.orderNo} siparişine eklendi.` });
        } else {
          log.push({ type: 'error', msg: `${o.file}: devam etiketi hangi siparişe ait bulunamadı, atlandı.` });
        }
        continue;
      }

      const id = orderId(o.store, o.orderNo);
      const inBatch = toSave.find((x) => x.id === id);
      const existing = inBatch || (await DB.get('orders', id));
      if (existing) {
        if (o.startsAsContinuation) {
          mergeItems(existing, o.items);
          existing.pages = (existing.pages || 0) + o.pages.length;
          applyCampaigns(existing);
          if (!inBatch) toSave.push(existing);
          rows.push({ status: 'merged', o: existing, note: 'Önceki etiketin devamı, siparişe eklendi' });
          log.push({ type: 'cont', msg: `${o.orderNo}: devam etiketi mevcut siparişe eklendi.` });
        } else {
          rows.push({ status: 'dup', o: { ...o, date: existing.date }, note: `Daha önce ${trDate(existing.date)} tarihinde kaydedilmiş` });
          log.push({ type: 'dup', msg: `${o.orderNo} (${o.store}) daha önce ${trDate(existing.date)} tarihinde kaydedilmiş, tekrar hesaplanmadı.` });
        }
        lastId = existing.id;
        continue;
      }

      if (!state.stores[o.store] && o.store) {
        state.stores[o.store] = { platform: o.platform, detected: o.platform };
        storesChanged = true;
      }
      const rec = {
        id,
        orderNo: o.orderNo,
        store: o.store,
        platform: o.platform,
        recipient: o.recipient,
        cargo: o.cargo,
        cargoCode: o.cargoCode,
        city: o.city,
        date: o.date,
        items: o.items,
        pages: o.pages.length,
        file: o.file,
        batchId,
        importedAt,
        checked: false,
      };
      applyCampaigns(rec);
      toSave.push(rec);
      newIds.push(id);
      lastId = id;
      rows.push({ status: o.pages.length > 1 ? 'newcont' : 'new', o: rec, note: o.warnings.join(', ') });
    }

    if (toSave.length) await DB.putMany('orders', toSave);
    state.knownProducts = [...seenProducts];
    state.lastOrderId = lastId;
    await Promise.all([save('knownProducts'), save('lastOrderId'), storesChanged ? save('stores') : null]);

    const newOrders = toSave.filter((x) => newIds.includes(x.id));
    const batch = {
      id: batchId,
      importedAt,
      files: files.map((f) => f.name),
      orderIds: newIds,
      dates: [...new Set(newOrders.map((x) => x.date))].sort(),
      newCount: newIds.length,
      dupCount: rows.filter((r) => r.status === 'dup').length,
      mergedCount: rows.filter((r) => r.status === 'merged').length,
      pageCount: pages.length,
      itemQty: newOrders.reduce((s, x) => s + sumQty(x.items), 0),
    };
    await DB.put('batches', batch);
    state.lastBatchId = batchId;

    renderImportResult(batch, rows, log);
    renderBatches();
    if (batch.dates.length) { $('#repFrom').value = batch.dates[0]; $('#repTo').value = batch.dates[batch.dates.length - 1]; }
    toast(`${batch.newCount} yeni sipariş kaydedildi` + (batch.dupCount ? `, ${batch.dupCount} mükerrer atlandı` : ''));
  }

  const sumQty = (items) => (items || []).reduce((s, it) => s + (+it.qty || 0), 0);
  function mergeItems(target, items) {
    for (const it of items) {
      const ex = target.items.find((x) => x.name === it.name);
      if (ex) ex.qty += it.qty;
      else target.items.push({ name: it.name, qty: it.qty });
    }
  }

  const STATUS = {
    new: '<span class="badge ok">Yeni</span>',
    newcont: '<span class="badge info">Yeni · devamlı</span>',
    merged: '<span class="badge info">Devam eklendi</span>',
    dup: '<span class="badge warn">Mükerrer</span>',
  };

  function renderImportResult(batch, rows, log) {
    $('#importResult').hidden = false;
    const newRows = rows.filter((r) => r.status === 'new' || r.status === 'newcont');
    const campOrders = newRows.filter((r) => r.o.applied && r.o.applied.length).length;
    const extra = newRows.reduce((s, r) => s + sumQty(r.o.applied), 0);
    $('#importKpis').innerHTML = [
      kpi('Okunan etiket (sayfa)', batch.pageCount),
      kpi('Yeni sipariş', batch.newCount, '', 'accent'),
      kpi('Ürün adedi', batch.itemQty),
      kpi('Kampanyalı sipariş', campOrders, extra ? `+${n(extra)} ürün eklendi` : ''),
      kpi('Mükerrer (sayılmadı)', batch.dupCount),
      kpi('Devam etiketi', rows.filter((r) => r.status === 'merged' || r.status === 'newcont').length),
    ].join('');
    $('#importLog').innerHTML = log.map((l) => `<div class="${esc(l.type)}">${esc(l.msg)}</div>`).join('');
    $('#importTable').innerHTML =
      `<thead><tr><th>Durum</th><th>Tarih</th><th>Sipariş no</th><th>Mağaza</th><th>Ürünler</th><th>Kampanya</th><th>Not</th></tr></thead><tbody>` +
      (rows.map((r) => `<tr><td>${STATUS[r.status]}</td><td>${trDate(r.o.date)}</td><td>${esc(r.o.orderNo)}</td>
        <td>${pBadge(platformOf(r.o))} ${esc(r.o.store)}</td><td>${itemsHtml(r.o.items)}</td><td>${appliedHtml(r.o.applied)}</td>
        <td class="muted small">${esc(r.note || '')}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">Sipariş bulunamadı</td></tr>') +
      '</tbody>';
  }

  const itemsHtml = (items) => (items || []).map((it) => `<div><b>${it.qty}x</b> ${esc(it.name)}</div>`).join('');
  const appliedHtml = (ap) => (ap && ap.length ? ap.map((a) => `<div class="gift">+${a.qty} ${esc(a.product)}</div>`).join('') : '<span class="muted">—</span>');
  const kpi = (label, value, sub, cls) =>
    `<div class="kpi ${cls || ''}"><div class="label">${esc(label)}</div><div class="value">${typeof value === 'number' ? n(value) : esc(value)}</div>${sub ? `<div class="sub">${esc(sub)}</div>` : ''}</div>`;

  $('#btnGoReport').addEventListener('click', () => show('report'));
  $('#btnUndoImport').addEventListener('click', async () => {
    if (!state.lastBatchId) return;
    await undoBatch(state.lastBatchId);
    $('#importResult').hidden = true;
  });

  async function undoBatch(id) {
    const b = await DB.get('batches', id);
    if (!b) return;
    if (!confirm(`${b.newCount} siparişlik yükleme silinsin mi?\n(${b.files.join(', ')})\n\nNot: Önceki siparişlere eklenmiş devam etiketleri geri alınmaz.`)) return;
    await DB.delMany('orders', b.orderIds);
    await DB.del('batches', id);
    toast('Yükleme geri alındı');
    renderBatches();
  }

  async function renderBatches() {
    const batches = (await DB.getAll('batches')).sort((a, b) => b.importedAt.localeCompare(a.importedAt)).slice(0, 30);
    $('#batchTable').innerHTML =
      `<thead><tr><th>Yükleme zamanı</th><th>Dosya</th><th>Sipariş tarihi</th><th class="num">Yeni</th><th class="num">Mükerrer</th><th class="num">Ürün</th><th></th></tr></thead><tbody>` +
      (batches.map((b) => `<tr><td>${trDateTime(b.importedAt)}</td><td class="small">${b.files.map(esc).join('<br>')}</td>
        <td>${b.dates.map((d) => trDate(d)).join(', ') || '—'}</td><td class="num">${n(b.newCount)}</td><td class="num">${n(b.dupCount)}</td><td class="num">${n(b.itemQty)}</td>
        <td class="num"><button class="btn sm" data-open="${esc(b.dates[0] || '')}|${esc(b.dates[b.dates.length - 1] || '')}">Rapor</button>
        <button class="btn sm danger ghost" data-undo="${esc(b.id)}">Sil</button></td></tr>`).join('') ||
        '<tr><td colspan="7" class="empty">Henüz yükleme yok</td></tr>') + '</tbody>';
  }
  $('#batchTable').addEventListener('click', (e) => {
    const u = e.target.closest('[data-undo]');
    if (u) return undoBatch(u.dataset.undo);
    const o = e.target.closest('[data-open]');
    if (o) {
      const [f, t] = o.dataset.open.split('|');
      if (f) { $('#repFrom').value = f; $('#repTo').value = t || f; }
      show('report');
    }
  });
  renderers.import = renderBatches;

  // ================================================================== RAPOR
  const repFrom = $('#repFrom'), repTo = $('#repTo');
  repFrom.value = repTo.value = today();
  $$('.quick .chip').forEach((b) => b.addEventListener('click', () => {
    const t = today();
    const r = b.dataset.range;
    if (r === 'today') { repFrom.value = repTo.value = t; }
    if (r === 'yesterday') { repFrom.value = repTo.value = addDays(t, -1); }
    if (r === 'week') { repFrom.value = addDays(t, -6); repTo.value = t; }
    if (r === 'month') { repFrom.value = t.slice(0, 8) + '01'; repTo.value = t; }
    renderReport();
  }));
  [repFrom, repTo, $('#repPlatform'), $('#repStore')].forEach((el) => el.addEventListener('change', renderReport));
  $('#orderSearch').addEventListener('input', () => renderOrderTable());

  let report = null; // son hesaplanan rapor

  function fillFilterSelects() {
    const plats = [...new Set(Object.values(state.stores).map((s) => s.platform).filter(Boolean))].sort();
    const selP = $('#repPlatform'), selS = $('#repStore');
    const pv = selP.value, sv = selS.value;
    selP.innerHTML = `<option value="*">Tümü</option>` + plats.map((p) => `<option value="${esc(p)}">${esc(pLabel(p))}</option>`).join('');
    selP.value = plats.includes(pv) ? pv : '*';
    const stores = Object.keys(state.stores).filter((s) => selP.value === '*' || state.stores[s].platform === selP.value).sort(collator.compare);
    selS.innerHTML = `<option value="*">Tümü</option>` + stores.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
    selS.value = stores.includes(sv) ? sv : '*';
  }

  function aggregate(orders) {
    const products = new Map();
    const stores = new Map();
    const camps = new Map();
    const R = { orders: orders.length, qty: 0, extra: 0, campOrders: 0, checked: 0 };
    const prod = (name) => {
      if (!products.has(name)) products.set(name, { name, qty: 0, extra: 0, orders: new Set() });
      return products.get(name);
    };
    for (const o of orders) {
      const q = sumQty(o.items), ex = sumQty(o.applied);
      R.qty += q; R.extra += ex;
      if (o.applied && o.applied.length) R.campOrders++;
      if (o.checked) R.checked++;
      for (const it of o.items) { const p = prod(canon(it.name)); p.qty += it.qty; p.orders.add(o.id); }
      for (const a of o.applied || []) {
        const p = prod(canon(a.product)); p.extra += a.qty;
        const c = camps.get(a.campaign) || { name: a.campaign, orders: 0, qty: 0 };
        c.orders++; c.qty += a.qty; camps.set(a.campaign, c);
      }
      const sk = o.store || '—';
      const s = stores.get(sk) || { store: sk, platform: platformOf(o), orders: 0, qty: 0, extra: 0, campOrders: 0 };
      s.orders++; s.qty += q; s.extra += ex; if (ex) s.campOrders++;
      stores.set(sk, s);
    }
    R.products = [...products.values()];
    R.stores = [...stores.values()].sort((a, b) => collator.compare(a.platform, b.platform) || collator.compare(a.store, b.store));
    R.camps = [...camps.values()];
    return R;
  }

  function orderedProducts(list) {
    const idx = new Map(state.productOrder.map((p, i) => [p, i]));
    return list.slice().sort((a, b) => {
      const ia = idx.has(a.name) ? idx.get(a.name) : Infinity, ib = idx.has(b.name) ? idx.get(b.name) : Infinity;
      return ia - ib || collator.compare(a.name, b.name);
    });
  }

  async function renderReport() {
    fillFilterSelects();
    let from = repFrom.value || today(), to = repTo.value || from;
    if (from > to) [from, to] = [to, from];
    const plat = $('#repPlatform').value, store = $('#repStore').value;
    let orders = await DB.ordersBetween(from, to);
    orders = orders.filter((o) => (plat === '*' || platformOf(o) === plat) && (store === '*' || o.store === store));
    orders.sort((a, b) => a.date.localeCompare(b.date) || (a.importedAt || '').localeCompare(b.importedAt || ''));
    report = { from, to, plat, store, orders, agg: aggregate(orders) };
    const A = report.agg;
    const rate = A.orders ? Math.round((A.campOrders / A.orders) * 100) : 0;
    $('#repKpis').innerHTML = [
      kpi('Sipariş adedi', A.orders, `${A.stores.length} mağaza`),
      kpi('Ürün adedi (etiket)', A.qty, A.orders ? `sipariş başına ${(A.qty / A.orders).toLocaleString('tr-TR', { maximumFractionDigits: 2 })}` : ''),
      kpi('Kampanyalı sipariş', A.campOrders, `siparişlerin %${rate}'i`),
      kpi('Kampanyayla eklenen ürün', A.extra),
      kpi('Toplam gönderilecek ürün', A.qty + A.extra, 'etiket + kampanya', 'accent'),
      kpi('Barkodla kontrol edilen', A.checked, `${n(A.orders - A.checked)} sipariş kaldı`),
    ].join('');
    renderProductTable();
    $('#storeTable').innerHTML =
      `<thead><tr><th>Mağaza</th><th class="num">Sipariş</th><th class="num">Ürün</th><th class="num">Kamp. sip.</th><th class="num">+Ürün</th><th class="num">Toplam</th></tr></thead><tbody>` +
      (A.stores.map((s) => `<tr><td>${pBadge(s.platform)} ${esc(s.store)}</td><td class="num">${n(s.orders)}</td><td class="num">${n(s.qty)}</td>
        <td class="num">${n(s.campOrders)}</td><td class="num">${n(s.extra)}</td><td class="num"><b>${n(s.qty + s.extra)}</b></td></tr>`).join('') ||
        '<tr><td colspan="6" class="empty">Kayıt yok</td></tr>') + '</tbody>' +
      (A.stores.length > 1 ? `<tfoot><tr><td>Toplam</td><td class="num">${n(A.orders)}</td><td class="num">${n(A.qty)}</td><td class="num">${n(A.campOrders)}</td><td class="num">${n(A.extra)}</td><td class="num">${n(A.qty + A.extra)}</td></tr></tfoot>` : '');
    $('#campTable').innerHTML =
      `<thead><tr><th>Kampanya</th><th class="num">Sipariş</th><th class="num">Eklenen ürün</th></tr></thead><tbody>` +
      (A.camps.map((c) => `<tr><td>${esc(c.name)}</td><td class="num">${n(c.orders)}</td><td class="num">${n(c.qty)}</td></tr>`).join('') ||
        '<tr><td colspan="3" class="empty">Bu aralıkta kampanya uygulanmadı</td></tr>') + '</tbody>';
    renderOrderTable();
  }
  renderers.report = renderReport;

  function renderProductTable() {
    const list = orderedProducts(report ? report.agg.products : []);
    const A = report.agg;
    $('#productTable').innerHTML =
      `<thead><tr><th>Sıra</th><th>#</th><th>Ürün</th><th class="num">Etiket adedi</th><th class="num">Kampanya (+)</th><th class="num">Toplam gönderilecek</th><th class="num">Sipariş</th></tr></thead><tbody>` +
      (list.map((p, i) => `<tr draggable="true" data-name="${esc(p.name)}">
        <td class="handle"><span title="Sürükle">⋮⋮</span><button type="button" data-move="up" aria-label="Yukarı">▲</button><button type="button" data-move="down" aria-label="Aşağı">▼</button></td>
        <td class="muted">${i + 1}</td><td><b>${esc(p.name)}</b></td><td class="num">${n(p.qty)}</td>
        <td class="num">${p.extra ? `<span class="gift">+${n(p.extra)}</span>` : '<span class="muted">—</span>'}</td>
        <td class="num"><b>${n(p.qty + p.extra)}</b></td><td class="num">${n(p.orders.size)}</td></tr>`).join('') ||
        '<tr><td colspan="7" class="empty">Seçili aralıkta kayıt yok. “Etiket Yükle” sekmesinden PDF yükleyin ya da tarihi değiştirin.</td></tr>') +
      '</tbody>' +
      (list.length ? `<tfoot><tr><td></td><td></td><td>Toplam</td><td class="num">${n(A.qty)}</td><td class="num">+${n(A.extra)}</td><td class="num">${n(A.qty + A.extra)}</td><td class="num">${n(A.orders)}</td></tr></tfoot>` : '');
  }

  // --- ürün sırası: sürükle-bırak ve ▲▼
  function moveProduct(name, beforeName) {
    const shown = orderedProducts(report.agg.products).map((p) => p.name);
    const all = state.productOrder.slice();
    shown.forEach((s) => { if (!all.includes(s)) all.push(s); });
    const from = all.indexOf(name);
    if (from < 0) return;
    all.splice(from, 1);
    const to = beforeName == null ? all.length : all.indexOf(beforeName);
    all.splice(to < 0 ? all.length : to, 0, name);
    state.productOrder = all;
    save('productOrder');
    renderProductTable();
  }
  const ptab = $('#productTable');
  ptab.addEventListener('click', (e) => {
    const b = e.target.closest('[data-move]');
    if (!b) return;
    const tr = b.closest('tr');
    const names = $$('tbody tr[data-name]', ptab).map((r) => r.dataset.name);
    const i = names.indexOf(tr.dataset.name);
    if (b.dataset.move === 'up' && i > 0) moveProduct(names[i], names[i - 1]);
    if (b.dataset.move === 'down' && i < names.length - 1) moveProduct(names[i + 1], names[i]);
  });
  let dragName = null;
  ptab.addEventListener('dragstart', (e) => {
    const tr = e.target.closest('tr[data-name]');
    if (!tr) return;
    dragName = tr.dataset.name;
    tr.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragName);
  });
  ptab.addEventListener('dragover', (e) => {
    if (!dragName) return;
    e.preventDefault();
    $$('.drop-before', ptab).forEach((r) => r.classList.remove('drop-before'));
    const tr = e.target.closest('tr[data-name]');
    if (tr) tr.classList.add('drop-before');
  });
  ptab.addEventListener('drop', (e) => {
    e.preventDefault();
    const tr = e.target.closest('tr[data-name]');
    const src = dragName;
    dragName = null;
    if (src && tr && tr.dataset.name !== src) moveProduct(src, tr.dataset.name);
    else renderProductTable();
  });
  ptab.addEventListener('dragend', () => { dragName = null; $$('.dragging,.drop-before', ptab).forEach((r) => r.classList.remove('dragging', 'drop-before')); });

  $('#sortPreset').addEventListener('change', (e) => {
    const v = e.target.value;
    e.target.value = '';
    if (!report) return;
    const shown = report.agg.products;
    let first;
    if (v === 'alpha') first = shown.map((p) => p.name).sort(collator.compare);
    else if (v === 'qty') first = shown.slice().sort((a, b) => b.qty + b.extra - (a.qty + a.extra)).map((p) => p.name);
    else return;
    state.productOrder = first.concat(state.productOrder.filter((p) => !first.includes(p)));
    save('productOrder');
    renderProductTable();
    toast('Sıra kaydedildi');
  });

  const rangeLabel = () => (report.from === report.to ? trDate(report.from) : `${trDate(report.from)} - ${trDate(report.to)}`);
  const filterLabel = () => [report.plat !== '*' ? pLabel(report.plat) : '', report.store !== '*' ? report.store : ''].filter(Boolean).join(' / ') || 'Tüm mağazalar';
  const fileStamp = () => (report.from === report.to ? report.from : `${report.from}_${report.to}`);

  $('#btnCsvProducts').addEventListener('click', () => {
    if (!report) return;
    const A = report.agg;
    const rows = [
      ['Tarih', rangeLabel()], ['Kapsam', filterLabel()],
      ['Sipariş adedi', A.orders], ['Ürün adedi (etiket)', A.qty], ['Kampanyalı sipariş', A.campOrders], ['Kampanyayla eklenen ürün', A.extra], ['Toplam gönderilecek ürün', A.qty + A.extra],
      [],
      ['Sıra', 'Ürün', 'Etiket Adedi', 'Kampanya Ekstra', 'Toplam Gönderilecek', 'Sipariş Sayısı'],
      ...orderedProducts(A.products).map((p, i) => [i + 1, p.name, p.qty, p.extra, p.qty + p.extra, p.orders.size]),
      ['', 'TOPLAM', A.qty, A.extra, A.qty + A.extra, A.orders],
    ];
    download(`urun-listesi_${fileStamp()}.csv`, toCsv(rows), 'text/csv;charset=utf-8');
  });

  $('#btnCsvOrders').addEventListener('click', () => {
    if (!report) return;
    const rows = [['Tarih', 'Sipariş No', 'Platform', 'Mağaza', 'Alıcı', 'Kargo', 'Kargo Barkodu', 'Ürün', 'Adet', 'Tür', 'Kampanya', 'Kontrol']];
    for (const o of report.orders) {
      for (const it of o.items) rows.push([trDate(o.date), o.orderNo, pLabel(platformOf(o)), o.store, o.recipient, o.cargo, o.cargoCode, canon(it.name), it.qty, 'Etiket', '', o.checked ? 'Evet' : '']);
      for (const a of o.applied || []) rows.push([trDate(o.date), o.orderNo, pLabel(platformOf(o)), o.store, o.recipient, o.cargo, o.cargoCode, canon(a.product), a.qty, 'Kampanya', a.campaign, o.checked ? 'Evet' : '']);
    }
    download(`siparisler_${fileStamp()}.csv`, toCsv(rows), 'text/csv;charset=utf-8');
  });

  $('#btnPrint').addEventListener('click', () => {
    if (!report) return;
    const A = report.agg;
    $('#printArea').innerHTML = `<h1>Toplama listesi — ${esc(rangeLabel())}</h1>
      <p>${esc(filterLabel())} · ${n(A.orders)} sipariş · ${n(A.qty)} ürün + ${n(A.extra)} kampanya = <b>${n(A.qty + A.extra)} ürün</b> · ${n(A.campOrders)} kampanyalı sipariş</p>
      <table><thead><tr><th>#</th><th>Ürün</th><th class="num">Etiket</th><th class="num">Kampanya</th><th class="num">Toplam</th><th class="box">✓</th></tr></thead><tbody>
      ${orderedProducts(A.products).map((p, i) => `<tr><td>${i + 1}</td><td>${esc(p.name)}</td><td class="num">${n(p.qty)}</td><td class="num">${p.extra ? '+' + n(p.extra) : ''}</td><td class="num"><b>${n(p.qty + p.extra)}</b></td><td class="box"></td></tr>`).join('')}
      </tbody></table>`;
    window.print();
  });

  function renderOrderTable() {
    if (!report) return;
    const q = lower($('#orderSearch').value);
    const list = report.orders.filter((o) => !q || lower([o.orderNo, o.store, o.recipient, o.cargoCode, ...o.items.map((i) => i.name)].join(' ')).includes(q));
    const shown = list.slice(0, 500);
    $('#orderTable').innerHTML =
      `<thead><tr><th>Tarih</th><th>Sipariş no</th><th>Mağaza</th><th>Alıcı</th><th>Ürünler</th><th>Kampanya</th><th>Kontrol</th></tr></thead><tbody>` +
      (shown.map((o) => `<tr class="clickable" data-id="${esc(o.id)}"><td>${trDate(o.date)}</td><td>${esc(o.orderNo)}${o.pages > 1 ? ` <span class="badge info" title="Devam etiketli">${o.pages} etiket</span>` : ''}</td>
        <td>${pBadge(platformOf(o))} ${esc(o.store)}</td><td>${esc(o.recipient)}</td><td>${itemsHtml(o.items)}</td><td>${appliedHtml(o.applied)}</td>
        <td>${o.checked ? '<span class="badge ok">✓</span>' : '<span class="muted">—</span>'}</td></tr>`).join('') ||
        '<tr><td colspan="7" class="empty">Sipariş yok</td></tr>') + '</tbody>' +
      (list.length > shown.length ? `<tfoot><tr><td colspan="7" class="muted">İlk 500 sipariş gösteriliyor (toplam ${n(list.length)}). Tamamı için “Siparişleri indir”.</td></tr></tfoot>` : '');
  }
  $('#orderTable').addEventListener('click', (e) => { const tr = e.target.closest('tr[data-id]'); if (tr) openOrder(tr.dataset.id); });

  async function openOrder(id) {
    const o = await DB.get('orders', id);
    if (!o) return;
    const dlg = $('#orderDialog');
    $('#orderDialogBody').innerHTML = `<h2>Sipariş ${esc(o.orderNo)}</h2><dl>
      <dt>Tarih</dt><dd>${trDate(o.date, true)}</dd>
      <dt>Mağaza</dt><dd>${pBadge(platformOf(o))} ${esc(o.store)}</dd>
      <dt>Alıcı</dt><dd>${esc(o.recipient)} ${o.city ? `<span class="muted">· ${esc(o.city)}</span>` : ''}</dd>
      <dt>Kargo</dt><dd>${esc(o.cargo)} ${esc(o.cargoCode)}</dd>
      <dt>Etiket</dt><dd>${o.pages || 1} sayfa · ${esc(o.file || '')}</dd>
      <dt>Ürünler</dt><dd>${itemsHtml(o.items)}</dd>
      <dt>Kampanya</dt><dd>${appliedHtml(o.applied)}</dd>
      <dt>Kontrol</dt><dd>${o.checked ? 'Kontrol edildi · ' + trDateTime(o.checkedAt) : 'Kontrol edilmedi'}</dd></dl>`;
    dlg.returnValue = '';
    dlg.showModal();
    dlg.onclose = async () => {
      if (dlg.returnValue === 'delete' && confirm(`${o.orderNo} numaralı sipariş silinsin mi?`)) {
        await DB.del('orders', o.id);
        toast('Sipariş silindi');
        if (renderers[currentView]) renderers[currentView]();
      }
    };
  }

  $('#btnReapply').addEventListener('click', async () => {
    if (!report || !report.orders.length) return toast('Bu aralıkta sipariş yok');
    if (!confirm(`${trDate(report.from)} - ${trDate(report.to)} aralığındaki ${report.orders.length} siparişe güncel kampanyalar yeniden uygulansın mı?`)) return;
    report.orders.forEach(applyCampaigns);
    await DB.putMany('orders', report.orders);
    toast('Kampanyalar yeniden uygulandı');
    renderReport();
  });

  // ================================================================== GÜNLER
  async function renderDays() {
    const days = new Map();
    await DB.forEach('orders', (o) => {
      const d = days.get(o.date) || { date: o.date, orders: 0, qty: 0, extra: 0, camp: 0, stores: new Set() };
      const ex = sumQty(o.applied);
      d.orders++; d.qty += sumQty(o.items); d.extra += ex; if (ex) d.camp++; d.stores.add(o.store);
      days.set(o.date, d);
    });
    const list = [...days.values()].sort((a, b) => b.date.localeCompare(a.date));
    const t = today();
    const bars = [];
    for (let i = 29; i >= 0; i--) {
      const d = addDays(t, -i);
      bars.push(days.get(d) || { date: d, orders: 0, qty: 0, extra: 0 });
    }
    const max = Math.max(1, ...bars.map((b) => b.orders));
    $('#dayChart').innerHTML = bars.map((b) => `<div class="bar" data-day="${b.date}" title="${trDate(b.date, true)}: ${n(b.orders)} sipariş, ${n(b.qty + b.extra)} ürün">
      <b>${b.orders || ''}</b><i style="height:${(b.orders / max) * 100}%"></i><span>${b.date.slice(8)}.${b.date.slice(5, 7)}</span></div>`).join('');
    const tot = list.reduce((s, d) => s + d.orders, 0);
    $('#daysInfo').textContent = list.length ? `${list.length} gün · ${n(tot)} sipariş · en eski kayıt ${trDate(list[list.length - 1].date)} · saklama ${state.retention} gün` : '';
    $('#daysTable').innerHTML =
      `<thead><tr><th>Tarih</th><th class="num">Sipariş</th><th class="num">Ürün</th><th class="num">Kamp. sipariş</th><th class="num">+Ürün</th><th class="num">Toplam ürün</th><th class="num">Mağaza</th><th></th></tr></thead><tbody>` +
      (list.map((d) => `<tr class="clickable" data-day="${d.date}"><td>${trDate(d.date, true)}</td><td class="num">${n(d.orders)}</td><td class="num">${n(d.qty)}</td>
        <td class="num">${n(d.camp)}</td><td class="num">${n(d.extra)}</td><td class="num"><b>${n(d.qty + d.extra)}</b></td><td class="num">${d.stores.size}</td>
        <td class="num"><button class="btn sm">İncele</button></td></tr>`).join('') || '<tr><td colspan="8" class="empty">Henüz kayıt yok</td></tr>') + '</tbody>';
  }
  renderers.days = renderDays;
  const openDay = (e) => {
    const el = e.target.closest('[data-day]');
    if (!el) return;
    repFrom.value = repTo.value = el.dataset.day;
    show('report');
  };
  $('#daysTable').addEventListener('click', openDay);
  $('#dayChart').addEventListener('click', openDay);

  // ================================================================== BARKOD
  const scanInput = $('#scanInput');
  $('#scanDate').value = today();
  $('#scanDate').addEventListener('change', renderScanTable);
  scanInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); const v = scanInput.value.trim(); scanInput.value = ''; if (v) handleScan(v); }
  });

  let audioCtx = null;
  function beep(ok) {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.frequency.value = ok ? 880 : 220; o.type = ok ? 'sine' : 'square';
      g.gain.value = 0.08; o.connect(g); g.connect(audioCtx.destination);
      o.start(); o.stop(audioCtx.currentTime + (ok ? 0.12 : 0.35));
    } catch (_) {}
  }

  async function handleScan(code) {
    const c = code.replace(/\s+/g, '');
    let found = await DB.byIndex('orders', 'cargoCode', c);
    if (!found.length) found = await DB.byIndex('orders', 'orderNo', c);
    if (!found.length && /^#?\d+$/.test(c)) found = await DB.byIndex('orders', 'orderNo', c.startsWith('#') ? c.slice(1) : '#' + c);
    const box = $('#scanResult');
    if (!found.length) {
      beep(false);
      box.innerHTML = `<div class="scan-card nf"><h3>Bulunamadı: ${esc(c)}</h3><p>Bu barkoda ait kayıtlı sipariş yok. Etiketin PDF'i yüklendi mi?</p></div>`;
      return;
    }
    const now = new Date().toISOString();
    const html = [];
    let anyAgain = false;
    for (const o of found) {
      const again = o.checked;
      anyAgain = anyAgain || again;
      if (!again) { o.checked = true; o.checkedAt = now; await DB.put('orders', o); }
      html.push(`<div class="scan-card ${again ? 'again' : 'ok'} mt"><h3>${again ? 'Daha önce okutuldu' : '✓ Kontrol edildi'} — ${esc(o.orderNo)}</h3>
        <div>${pBadge(platformOf(o))} ${esc(o.store)} · ${esc(o.recipient)} · ${trDate(o.date)}${again ? ` · ilk okutma ${trDateTime(o.checkedAt)}` : ''}</div>
        <ul>${o.items.map((it) => `<li><b>${it.qty}x</b> ${esc(canon(it.name))}</li>`).join('')}
        ${(o.applied || []).map((a) => `<li class="gift"><b>+${a.qty}x</b> ${esc(canon(a.product))} (${esc(a.campaign)})</li>`).join('')}</ul></div>`);
    }
    beep(!anyAgain);
    box.innerHTML = html.join('');
    if (found[0].date !== $('#scanDate').value) $('#scanDate').value = found[0].date;
    renderScanTable();
  }

  async function renderScanTable() {
    const d = $('#scanDate').value || today();
    const orders = await DB.ordersBetween(d, d);
    const done = orders.filter((o) => o.checked).length;
    $('#scanKpis').innerHTML = [kpi('Sipariş', orders.length), kpi('Kontrol edilen', done, '', 'accent'), kpi('Kalan', orders.length - done)].join('');
    orders.sort((a, b) => (a.checked - b.checked) || collator.compare(a.store, b.store));
    $('#scanTable').innerHTML =
      `<thead><tr><th>Durum</th><th>Sipariş no</th><th>Kargo barkodu</th><th>Mağaza</th><th>Ürünler</th></tr></thead><tbody>` +
      (orders.map((o) => `<tr class="clickable" data-id="${esc(o.id)}"><td>${o.checked ? '<span class="badge ok">✓ Kontrol</span>' : '<span class="badge warn">Bekliyor</span>'}</td>
        <td>${esc(o.orderNo)}</td><td>${esc(o.cargoCode)}</td><td>${pBadge(platformOf(o))} ${esc(o.store)}</td><td>${itemsHtml(o.items)}${appliedHtml(o.applied).includes('gift') ? appliedHtml(o.applied) : ''}</td></tr>`).join('') ||
        '<tr><td colspan="5" class="empty">Bu gün için kayıt yok</td></tr>') + '</tbody>';
  }
  $('#scanTable').addEventListener('click', (e) => { const tr = e.target.closest('tr[data-id]'); if (tr) openOrder(tr.dataset.id); });
  renderers.scan = renderScanTable;

  // Kamera ile okuma (destekleyen tarayıcılarda: Chrome/Android, Edge)
  if ('BarcodeDetector' in window) {
    const btn = $('#btnCamera');
    btn.hidden = false;
    let stream = null, timer = null;
    const stop = () => { clearInterval(timer); if (stream) stream.getTracks().forEach((t) => t.stop()); stream = null; $('#camVideo').hidden = true; btn.textContent = 'Kamerayla okut'; };
    btn.addEventListener('click', async () => {
      if (stream) return stop();
      try {
        const det = new BarcodeDetector({ formats: ['code_128', 'ean_13', 'ean_8', 'code_39', 'itf', 'qr_code', 'upc_a'] });
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        const v = $('#camVideo');
        v.srcObject = stream; v.hidden = false; await v.play();
        btn.textContent = 'Kamerayı kapat';
        let last = '', lastAt = 0;
        timer = setInterval(async () => {
          try {
            const codes = await det.detect(v);
            if (codes.length) {
              const val = codes[0].rawValue;
              if (val !== last || Date.now() - lastAt > 3000) { last = val; lastAt = Date.now(); handleScan(val); }
            }
          } catch (_) {}
        }, 350);
      } catch (err) {
        stop();
        toast('Kamera açılamadı: ' + (err.message || err));
      }
    });
  }

  // ================================================================== KAMPANYALAR
  const form = $('#campForm');
  const knownPlatforms = () => [...new Set(['trendyol', 'ikas', 'shopify', ...Object.values(state.stores).map((s) => s.platform).filter(Boolean)])];
  const canonProducts = () => [...new Set(state.knownProducts.map(canon))].sort(collator.compare);

  function fillCampaignForm() {
    const ps = form.elements.platform, ss = form.elements.store;
    const pv = ps.value || '*', sv = ss.value || '*';
    ps.innerHTML = `<option value="*">Tüm platformlar</option>` + knownPlatforms().map((p) => `<option value="${esc(p)}">${esc(pLabel(p))}</option>`).join('');
    ps.value = pv;
    const stores = Object.keys(state.stores).filter((s) => pv === '*' || state.stores[s].platform === pv).sort(collator.compare);
    ss.innerHTML = `<option value="*">Tüm mağazalar</option>` + stores.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
    ss.value = stores.includes(sv) ? sv : '*';
    $('#productList').innerHTML = canonProducts().map((p) => `<option value="${esc(p)}">`).join('');
    updateCampPreview();
  }
  form.elements.platform.addEventListener('change', fillCampaignForm);
  form.addEventListener('input', updateCampPreview);

  function readForm() {
    const f = form.elements;
    return {
      id: f.id.value || uid('c'),
      name: f.name.value.trim(),
      platform: f.platform.value,
      store: f.store.value,
      product: f.product.value.trim(),
      buyQty: Math.max(1, parseInt(f.buyQty.value, 10) || 1),
      getQty: Math.max(1, parseInt(f.getQty.value, 10) || 1),
      mode: f.mode.value,
      giftProduct: f.giftProduct.value.trim(),
      start: f.start.value,
      end: f.end.value,
      active: f.active.checked,
    };
  }
  function updateCampPreview() {
    const c = readForm();
    if (!c.product) { $('#campPreview').textContent = ''; return; }
    const scope = [c.platform === '*' ? 'tüm platformlar' : pLabel(c.platform), c.store === '*' ? 'tüm mağazalar' : c.store].join(' / ');
    const ex = [1, 2, 3, 4, 5].map((q) => {
      if (q < c.buyQty) return `${q} adet → +0`;
      return `${q} adet → +${c.mode === 'once' ? c.getQty : Math.floor(q / c.buyQty) * c.getQty}`;
    }).join(' · ');
    $('#campPreview').textContent = `${describeCampaign(c)} (${scope}). Örnek: ${ex}`;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const c = readForm();
    if (c.start && c.end && c.start > c.end) return toast('Başlangıç tarihi bitişten sonra olamaz');
    const i = state.campaigns.findIndex((x) => x.id === c.id);
    if (i >= 0) state.campaigns[i] = c; else state.campaigns.push(c);
    await save('campaigns');
    resetCampForm();
    renderCampaigns();
    toast('Kampanya kaydedildi. Yeni yüklemelerde otomatik uygulanır.');
  });
  function resetCampForm() {
    form.reset();
    form.elements.id.value = '';
    $('#campFormTitle').textContent = 'Yeni kampanya';
    fillCampaignForm();
  }
  $('#btnCampCancel').addEventListener('click', resetCampForm);

  function renderCampaigns() {
    fillCampaignForm();
    const t = today();
    $('#campListTable').innerHTML =
      `<thead><tr><th>Durum</th><th>Kampanya</th><th>Kapsam</th><th>Kural</th><th>Tarih</th><th></th></tr></thead><tbody>` +
      (state.campaigns.map((c) => {
        const live = c.active && (!c.start || c.start <= t) && (!c.end || c.end >= t);
        const status = !c.active ? '<span class="badge">Pasif</span>' : live ? '<span class="badge ok">Aktif</span>' : '<span class="badge warn">Tarih dışı</span>';
        return `<tr data-id="${esc(c.id)}"><td>${status}</td><td><b>${esc(c.name)}</b></td>
          <td>${c.platform === '*' ? 'Tüm platformlar' : pBadge(c.platform)}<br><span class="small muted">${c.store === '*' ? 'Tüm mağazalar' : esc(c.store)}</span></td>
          <td class="small">${esc(describeCampaign(c))}</td>
          <td class="small">${c.start ? trDate(c.start) : '…'} – ${c.end ? trDate(c.end) : '…'}</td>
          <td class="num"><button class="btn sm" data-act="edit">Düzenle</button> <button class="btn sm" data-act="toggle">${c.active ? 'Durdur' : 'Başlat'}</button> <button class="btn sm danger ghost" data-act="del">Sil</button></td></tr>`;
      }).join('') || '<tr><td colspan="6" class="empty">Henüz kampanya yok</td></tr>') + '</tbody>';
  }
  $('#campListTable').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const id = b.closest('tr').dataset.id;
    const c = state.campaigns.find((x) => x.id === id);
    if (!c) return;
    if (b.dataset.act === 'edit') {
      const f = form.elements;
      f.id.value = c.id; f.name.value = c.name; f.platform.value = c.platform; fillCampaignForm(); f.store.value = c.store;
      f.product.value = c.product; f.buyQty.value = c.buyQty; f.getQty.value = c.getQty; f.mode.value = c.mode;
      f.giftProduct.value = c.giftProduct || ''; f.start.value = c.start || ''; f.end.value = c.end || ''; f.active.checked = c.active;
      $('#campFormTitle').textContent = 'Kampanyayı düzenle';
      updateCampPreview();
      form.scrollIntoView({ behavior: 'smooth' });
      return;
    }
    if (b.dataset.act === 'toggle') c.active = !c.active;
    if (b.dataset.act === 'del') {
      if (!confirm(`“${c.name}” kampanyası silinsin mi? (Geçmiş siparişlere uygulanmış kayıtlar korunur.)`)) return;
      state.campaigns = state.campaigns.filter((x) => x.id !== id);
    }
    await save('campaigns');
    renderCampaigns();
  });
  renderers.campaigns = renderCampaigns;

  // ================================================================== AYARLAR
  function renderSettings() {
    const stores = Object.keys(state.stores).sort(collator.compare);
    const plats = knownPlatforms();
    $('#storesTable').innerHTML =
      `<thead><tr><th>Mağaza (Gönderici)</th><th>Etiketten algılanan</th><th>Platform</th></tr></thead><tbody>` +
      (stores.map((s) => `<tr><td><b>${esc(s)}</b></td><td>${pBadge(state.stores[s].detected)}</td>
        <td><select data-store="${esc(s)}">${plats.map((p) => `<option value="${esc(p)}"${p === state.stores[s].platform ? ' selected' : ''}>${esc(pLabel(p))}</option>`).join('')}</select></td></tr>`).join('') ||
        '<tr><td colspan="3" class="empty">Etiket yüklendikçe mağazalar burada listelenir</td></tr>') + '</tbody>';
    const prods = state.knownProducts.slice().sort(collator.compare);
    $('#aliasTable').innerHTML =
      `<thead><tr><th>Etiketteki ad</th><th>Raporda görünen ad</th></tr></thead><tbody>` +
      (prods.map((p) => `<tr><td>${esc(p)}</td><td><input data-alias="${esc(p)}" value="${esc(state.aliases[p] || '')}" placeholder="${esc(p)}" list="productList"></td></tr>`).join('') ||
        '<tr><td colspan="2" class="empty">Etiket yüklendikçe ürünler burada listelenir</td></tr>') + '</tbody>';
    $('#productList').innerHTML = canonProducts().map((p) => `<option value="${esc(p)}">`).join('');
    $('#retention').value = state.retention;
    DB.kvGet('lastBackup', null).then((d) => { $('#lastBackupInfo').textContent = d ? `Son yedek: ${trDateTime(d)}` : 'Henüz yedek alınmadı.'; });
  }
  renderers.settings = renderSettings;

  $('#storesTable').addEventListener('change', async (e) => {
    const s = e.target.dataset.store;
    if (!s) return;
    state.stores[s].platform = e.target.value;
    await save('stores');
    toast('Platform güncellendi');
  });
  $('#aliasTable').addEventListener('change', async (e) => {
    const p = e.target.dataset.alias;
    if (p == null) return;
    const v = e.target.value.trim();
    if (v && v !== p) state.aliases[p] = v; else delete state.aliases[p];
    await save('aliases');
    toast('Ürün adı kaydedildi');
  });
  $('#btnSaveRetention').addEventListener('click', async () => {
    const v = Math.min(3650, Math.max(30, parseInt($('#retention').value, 10) || 365));
    state.retention = v;
    await save('retention');
    const removed = await DB.pruneBefore(addDays(today(), -v));
    toast(`Saklama süresi ${v} gün` + (removed ? ` · ${removed} eski sipariş silindi` : ''));
  });

  $('#btnBackup').addEventListener('click', async () => {
    const [orders, batches, kv] = await Promise.all([DB.getAll('orders'), DB.getAll('batches'), DB.getAll('kv')]);
    const data = { app: 'etiket-takip', version: 1, exportedAt: new Date().toISOString(), orders, batches, kv };
    download(`etiket-takip-yedek_${today()}.json`, JSON.stringify(data), 'application/json');
    await DB.kvSet('lastBackup', data.exportedAt);
    renderSettings();
  });
  $('#restoreInput').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (data.app !== 'etiket-takip' || !Array.isArray(data.orders)) throw new Error('Geçersiz yedek dosyası');
      if (!confirm(`${data.orders.length} sipariş içeren yedek (${trDateTime(data.exportedAt)}) geri yüklensin mi?\nMevcut kayıtlarla birleştirilir; aynı siparişler yedekteki haliyle güncellenir.`)) return;
      await DB.putMany('orders', data.orders);
      await DB.putMany('batches', data.batches || []);
      await DB.putMany('kv', (data.kv || []).filter((k) => k.key !== 'lastBackup'));
      await loadState();
      toast('Yedek geri yüklendi');
      renderSettings();
    } catch (err) {
      toast('Geri yükleme başarısız: ' + err.message);
    }
  });
  $('#btnWipe').addEventListener('click', async () => {
    if (!confirm('TÜM siparişler, kampanyalar ve ayarlar silinecek. Emin misiniz?')) return;
    if (prompt('Onaylamak için SİL yazın') !== 'SİL') return toast('İptal edildi');
    await Promise.all([DB.clear('orders'), DB.clear('batches'), DB.clear('kv')]);
    await loadState();
    toast('Tüm veriler silindi');
    renderSettings();
  });

  // ================================================================== açılış
  async function updateStorageInfo() {
    try {
      if (navigator.storage && navigator.storage.persist) await navigator.storage.persist();
      if (navigator.storage && navigator.storage.estimate) {
        const e = await navigator.storage.estimate();
        const mb = (e.usage || 0) / 1048576;
        $('#storageInfo').textContent = `Veriler bu tarayıcıda · ${mb < 1 ? mb.toFixed(2) : mb.toFixed(1)} MB kullanılıyor`;
      }
    } catch (_) {}
  }

  (async function init() {
    try {
      await loadState();
      const removed = await DB.pruneBefore(addDays(today(), -state.retention));
      if (removed) toast(`${removed} eski sipariş (${state.retention} günden eski) silindi`);
    } catch (err) {
      console.error(err);
      alert('Veritabanı açılamadı. Tarayıcınız gizli modda olabilir ya da depolamaya izin vermiyor olabilir.\n\n' + err.message);
      return;
    }
    let view = 'import';
    try { view = localStorage.getItem('et-view') || 'import'; } catch (_) {}
    show(renderers[view] ? view : 'import');
    updateStorageInfo();
  })();
})();
