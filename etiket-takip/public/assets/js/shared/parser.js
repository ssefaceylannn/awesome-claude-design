// Kargo etiketi ayrıştırıcı (pdf.js getTextContent çıktısından).
// Her sayfa → { platform, orderNo, store(gönderici), recipient, cargo, cargoCode, city, items[] }
// "Devamı" etiketleri önceki siparişle birleştirilir, aynı yüklemedeki tekrarlar ayıklanır.
export const PLATFORMS = ['trendyol', 'ikas', 'shopify', 'hepsiburada', 'n11', 'amazon', 'pazarama', 'çiçeksepeti'];
const CARGO_HINTS = ['kargo', 'express', 'hepsijet', 'aras', 'yurtiçi', 'mng', 'sürat', 'ups', 'dhl', 'kolay gelsin', 'sendeo', 'borusan'];

const lower = (s) => String(s || '').toLocaleLowerCase('tr-TR');
const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();

// "3x", "3 x", "3X", "3×" ile başlayan satır → ürün satırı
const QTY_RE = /^(\d{1,4})\s*[xX×]\s*(.*)$/;

// "devamı" işareti. "Devamı sonraki etikette" gibi ifadeler bir SONRAKİ
// etiketin bu etiketin devamı olduğunu; tek başına "Devamı" / "(devam)" ise
// BU etiketin bir öncekinin devamı olduğunu belirtir.
const CONT_NEXT_RE = /devam[ıi]?\s*(→|>|bir\s+sonraki|sonraki|arka|diğer|bir\s+sonra)|sonraki\s+etikette/;
const CONT_RE = /devam/;

/** pdf.js text items -> normalize edilmiş parçalar */
function normalizeItems(pdfItems, pageHeight) {
  const out = [];
  for (const it of pdfItems) {
    const str = clean(it.str);
    if (!str) continue;
    const t = it.transform || [1, 0, 0, 1, 0, 0];
    const rotated = Math.abs(t[1]) > 0.01 || Math.abs(t[2]) > 0.01;
    out.push({
      str,
      x: t[4],
      y: pageHeight - t[5], // yukarıdan aşağı
      size: Math.hypot(t[0], t[1]),
      w: +it.width || 0,
      rotated,
    });
  }
  return out;
}

/** Aynı yükseklikteki parçaları satırlara grupla */
function groupRows(items, tol) {
  tol = tol || 3.5;
  const sorted = items.slice().sort((a, b) => a.y - b.y || a.x - b.x);
  const rows = [];
  for (const it of sorted) {
    const row = rows.find((r) => Math.abs(r.y - it.y) <= tol);
    if (row) row.items.push(it);
    else rows.push({ y: it.y, items: [it] });
  }
  for (const r of rows) {
    r.items.sort((a, b) => a.x - b.x);
    r.x = r.items[0].x;
    r.text = clean(r.items.map((i) => i.str).join(' '));
    r.low = lower(r.text);
  }
  rows.sort((a, b) => a.y - b.y);
  return rows;
}

export function detectPlatform(text) {
  const l = lower(text);
  for (const p of PLATFORMS) if (l.includes(p)) return p;
  return '';
}

const BARE_QTY = /^(\d{1,4})\s*[xX×]$/;
const INLINE_QTY = /^(\d{1,4})\s*[xX×]\s+(.+)$/;

/**
 * Ad satırlarını (yukarıdan aşağı) adetlere ardışık bloklar hâlinde böl: her adet
 * kendi hücresindeki satırları alır, hiçbir adet adsız kalmaz. Adet hücrede üste,
 * ortaya ya da alta hizalı olabilir; sayfadaki tüm ürünlere en iyi uyan hizalama seçilir.
 * Eşit durumda satır arası boşluğun büyük olduğu yerden bölünür (iki ürün arası
 * boşluk, aynı adın alt satırına geçişten büyüktür).
 * Eski "en yakın adet" yöntemi, alta hizalı etikette "1x DetoxMix" + "Daily Shake
 * Ara Öğün Tozu (Kakao" satırlarını tek ürün sanıyordu.
 */
function assignBlocks(qtys, lines) {
  const n = lines.length, k = qtys.length;
  // Satır i, satır i-1'in devamı olabilir mi? Önceki satırda bir sonraki kelimeye yer
  // varken alt satıra geçilmez: "DetoxMix" kısa bir satırdır, altındaki "Daily Shake…" yeni üründür.
  const limit = Math.max(...lines.map((l) => l.right));
  const wraps = lines.map((l, i) => {
    if (i === 0) return true;
    const prev = lines[i - 1];
    const word = l.text.split(' ')[0];
    const wordW = ((l.right - l.x) * (word.length + 1)) / Math.max(1, l.text.length);
    return prev.right + wordW > limit - 2;
  });
  const anchors = [(g) => g[0].y, (g) => (g[0].y + g[g.length - 1].y) / 2, (g) => g[g.length - 1].y];
  let best = null;
  for (const anchor of anchors) {
    // dp[j][i]: ilk j adete ilk i satırı dağıtmanın en düşük maliyeti
    const dp = Array.from({ length: k + 1 }, () => new Array(n + 1).fill(Infinity));
    const cut = Array.from({ length: k + 1 }, () => new Array(n + 1).fill(-1));
    dp[0][0] = 0;
    for (let j = 1; j <= k; j++) {
      for (let i = j; i <= n - (k - j); i++) {
        for (let s = j - 1; s < i; s++) {
          if (dp[j - 1][s] === Infinity) continue;
          const g = lines.slice(s, i);
          // Aynı satırdaki adet başka bir ürüne verilemez
          if (g.some((l) => l.sameRowQty && l.sameRowQty !== qtys[j - 1])) continue;
          const gap = s > 0 ? lines[s].y - lines[s - 1].y : 0;
          let c = dp[j - 1][s] + Math.abs(qtys[j - 1].y - anchor(g)) - gap * 0.01;
          for (let x = s + 1; x < i; x++) if (!wraps[x]) c += 100;
          if (c < dp[j][i]) { dp[j][i] = c; cut[j][i] = s; }
        }
      }
    }
    if (dp[k][n] === Infinity || (best && dp[k][n] >= best.cost)) continue;
    const groups = [];
    for (let j = k, i = n; j > 0; i = cut[j][i], j--) groups.unshift([qtys[j - 1], lines.slice(cut[j][i], i)]);
    best = { cost: dp[k][n], groups };
  }
  return best ? best.groups : [];
}

/**
 * Ürün satırlarını ayrıştır. Adet ("1x") ürün hücresinde üste, ortaya veya alta
 * hizalı olabilir; uzun adlar alt satırlara kayar. Satırlar assignBlocks ile adetlere
 * bölünür.
 */
function parseItems(rows, lastMetaRow, iFirstQty, warnings) {
  const firstY = rows[iFirstQty].y;
  const region = rows.filter((r, i) => i > lastMetaRow && (i >= iFirstQty || r.y >= firstY - 14));
  const qtys = [];
  const lines = [];
  for (const r of region) {
    const rest = [];
    let q = null;
    for (const it of r.items) {
      let m;
      if (!q && (m = it.str.match(BARE_QTY))) q = { qty: +m[1], y: it.y, x: it.x, name: '' };
      else if (!q && (m = it.str.match(INLINE_QTY))) { q = { qty: +m[1], y: it.y, x: it.x, name: '' }; rest.push({ ...it, str: m[2] }); }
      else rest.push(it);
    }
    // "1 x" iki ayrı parça olarak gelmiş olabilir
    if (!q && rest.length >= 2 && /^\d{1,4}$/.test(rest[0].str) && /^[xX×]$/.test(rest[1].str)) {
      q = { qty: +rest[0].str, y: rest[0].y, x: rest[0].x, name: '' };
      rest.splice(0, 2);
    }
    if (q) qtys.push(q);
    const text = clean(rest.map((it) => it.str).join(' '));
    if (text && !CONT_RE.test(lower(text))) {
      const right = Math.max(...rest.map((it) => it.x + (it.w || it.str.length * (it.size || 10) * 0.5)));
      lines.push({ text, y: r.y, x: rest[0].x, right, sameRowQty: q });
    }
  }
  if (!qtys.length) return [];
  qtys.sort((a, b) => a.y - b.y);
  lines.sort((a, b) => a.y - b.y);

  if (lines.length >= qtys.length) {
    for (const [q, group] of assignBlocks(qtys, lines)) q.name = clean(group.map((l) => l.text).join(' '));
  } else {
    for (const l of lines) {
      let best = l.sameRowQty;
      if (!best) {
        let bd = Infinity;
        for (const q of qtys) {
          const d = Math.abs(q.y - l.y) + (q.y > l.y ? 0.01 : 0); // eşitlikte üstteki adet
          if (d < bd) { bd = d; best = q; }
        }
      }
      best.name = clean(best.name + ' ' + l.text);
    }
  }
  for (const q of qtys) if (!q.name) warnings.push(q.qty + 'x satırında ürün adı okunamadı');
  return qtys.filter((q) => q.name).map((q) => ({ qty: q.qty, name: q.name }));
}

/**
 * Tek bir etiket sayfasını ayrıştır.
 * @param {Array} pdfItems pdf.js textContent.items
 * @param {number} pageHeight sayfa yüksekliği (viewport.height)
 */
export function parsePage(pdfItems, pageHeight) {
  const items = normalizeItems(pdfItems, pageHeight);
  const flat = items.filter((i) => !i.rotated);
  const rotated = items.filter((i) => i.rotated);
  const rows = groupRows(flat);
  const allLow = lower(items.map((i) => i.str).join(' '));

  const res = {
    platform: '',
    orderNo: '',
    store: '',
    recipient: '',
    cargo: '',
    cargoCode: '',
    city: clean(rotated.map((r) => r.str).join(' ')),
    items: [],
    isContinuation: false,
    continuesNext: false,
    warnings: [],
  };

  const idx = (re) => rows.findIndex((r) => re.test(r.low));
  const iGon = idx(/^g[öo]nderici/);
  const iAli = idx(/^al[ıi]c[ıi]/);
  const iAdr = idx(/^adres/);

  // --- Başlık (Gönderici satırının üstü) ---
  const headerRows = iGon >= 0 ? rows.slice(0, iGon) : rows.slice(0, 2);
  const headerItems = headerRows.flatMap((r) => r.items);
  if (headerItems.length) {
    const big = headerItems.slice().sort((a, b) => b.size - a.size)[0];
    res.platform = detectPlatform(headerItems.map((i) => i.str).join(' ')) || lower(big.str);
    // Sipariş no: başlıktaki, platform adı olmayan, en çok rakam içeren parça
    const cands = headerItems
      .filter((i) => i !== big && !detectPlatform(i.str) && /[0-9]/.test(i.str))
      .map((i) => ({ s: i.str.replace(/^(sipariş|siparis|order)\s*(no)?\s*[:#]?\s*/i, '').trim(), d: (i.str.match(/\d/g) || []).length }))
      .sort((a, b) => b.d - a.d);
    if (cands.length) res.orderNo = cands[0].s.replace(/\s+/g, '');
  }

  const restOf = (row, labelRe) => clean(row.text.replace(labelRe, ''));
  if (iGon >= 0) res.store = restOf(rows[iGon], /^g[öo]nderici\s*:?/i);
  if (iAli >= 0) res.recipient = restOf(rows[iAli], /^al[ıi]c[ıi]\s*:?/i);

  // --- Ürünler ---
  let iFirstQty = rows.findIndex((r) => QTY_RE.test(r.text));
  const afterAddr = Math.max(iAdr, iAli, iGon);

  // --- Kargo firması ve kargo barkodu (adres ile ürünler arası) ---
  const midEnd = iFirstQty >= 0 ? iFirstQty : rows.length;
  let lastMetaRow = afterAddr; // kargo adı / barkodu satırı: ürün bölgesi bundan sonra başlar
  for (let i = afterAddr + 1; i < midEnd; i++) {
    const r = rows[i];
    if (!res.cargo && CARGO_HINTS.some((h) => r.low.includes(h)) && !/^\d+$/.test(r.text.replace(/\s/g, ''))) {
      res.cargo = r.text;
      lastMetaRow = i;
    }
    const code = r.items.find((it) => /^[0-9A-Z]{8,}$/.test(it.str.replace(/\s/g, '')));
    if (code && i > afterAddr) { res.cargoCode = code.str.replace(/\s/g, ''); lastMetaRow = i; }
  }

  if (iFirstQty >= 0) res.items = parseItems(rows, lastMetaRow, iFirstQty, res.warnings);

  // --- Devam işaretleri ---
  if (CONT_RE.test(allLow)) {
    if (CONT_NEXT_RE.test(allLow)) res.continuesNext = true;
    else res.isContinuation = true;
  }

  if (!res.orderNo && !res.isContinuation) res.warnings.push('Sipariş numarası bulunamadı');
  if (!res.items.length) res.warnings.push('Ürün satırı bulunamadı');
  return res;
}

/**
 * Bir PDF'teki sayfaları siparişlere çevir. "Devamı" sayfaları bir önceki
 * siparişle birleştirilir; aynı PDF içinde tekrar eden sipariş no'lar ayıklanır.
 * @returns {{orders: Array, log: Array}}
 */
export function combinePages(pages) {
  const orders = [];
  const log = [];
  let prev = null;
  pages.forEach((p, i) => {
    const pageNo = i + 1;
    // Devam sayfası: kendisi "Devamı" diyor, önceki "devamı sonraki etikette" diyor
    // ya da başlığı olmayan (sipariş no'suz) ama ürün içeren bir sayfa.
    const mergeIntoPrev =
      prev &&
      (p.isContinuation ||
        (!p.orderNo && p.items.length > 0) ||
        (prev._continuesNext && (!p.orderNo || p.orderNo === prev.orderNo)));
    const where = p.file ? `${p.file} / sayfa ${p.filePage}` : `Sayfa ${pageNo}`;

    if (mergeIntoPrev && prev.dupSink) {
      prev._continuesNext = p.continuesNext;
      log.push({ page: pageNo, type: 'dup', orderNo: prev.orderNo, msg: `${where}: mükerrer ${prev.orderNo} siparişinin devamı, hesaba katılmadı.` });
      return;
    }
    if (mergeIntoPrev) {
      if (p.orderNo && prev.orderNo && p.orderNo !== prev.orderNo) {
        log.push({ page: pageNo, type: 'warn', msg: `${where}: devam etiketi (${p.orderNo}) önceki siparişle (${prev.orderNo}) farklı numaralı; yine de birleştirildi.` });
      }
      prev.items = prev.items.concat(p.items);
      prev.pages.push(pageNo);
      prev._continuesNext = p.continuesNext;
      log.push({ page: pageNo, type: 'cont', orderNo: prev.orderNo, msg: `${where}: ${prev.orderNo} siparişinin devamı olarak eklendi (${p.items.length} kalem).` });
      return;
    }
    if (!p.orderNo && p.isContinuation && p.items.length) {
      // Önceki dosyada / önceki yüklemede kalmış siparişin devamı
      orders.push({ orphan: true, orderNo: '', store: p.store, platform: p.platform, items: p.items.slice(), pages: [pageNo], file: p.file, warnings: [] });
      prev = null;
      return;
    }
    if (!p.orderNo) {
      log.push({ page: pageNo, type: 'error', msg: `${where}: sipariş numarası okunamadı, atlandı.` });
      return;
    }
    const dup = orders.find((o) => o.orderNo === p.orderNo && o.store === p.store);
    if (dup) {
      log.push({ page: pageNo, type: 'dup', orderNo: p.orderNo, msg: `${where}: ${p.orderNo} aynı yüklemede tekrar ediyor, hesaba katılmadı.` });
      // mükerrer sayfanın devam sayfaları da mükerrer sayılır
      prev = { dupSink: true, orderNo: p.orderNo, _continuesNext: p.continuesNext };
      return;
    }
    const o = {
      orderNo: p.orderNo,
      platform: p.platform,
      store: p.store,
      recipient: p.recipient,
      cargo: p.cargo,
      cargoCode: p.cargoCode,
      city: p.city,
      items: p.items.slice(),
      pages: [pageNo],
      file: p.file,
      date: p.date,
      startsAsContinuation: !!p.isContinuation,
      warnings: p.warnings.slice(),
      _continuesNext: p.continuesNext,
    };
    orders.push(o);
    prev = o;
  });
  for (const o of orders) {
    delete o._continuesNext;
    // Aynı ürün birden fazla satırda geldiyse topla
    const m = new Map();
    for (const it of o.items) m.set(it.name, (m.get(it.name) || 0) + it.qty);
    o.items = [...m].map(([name, qty]) => ({ name, qty }));
  }
  return { orders, log };
}

/** Dosya adından tarih çıkar: "..._23.09.2026_1351.pdf" → "2026-09-23" */
export function dateFromFileName(name) {
  const m = String(name).match(/(\d{1,2})[.\-_](\d{1,2})[.\-_](\d{4})/);
  if (m) {
    const d = m[1].padStart(2, '0'), mo = m[2].padStart(2, '0');
    if (+mo >= 1 && +mo <= 12 && +d >= 1 && +d <= 31) return `${m[3]}-${mo}-${d}`;
  }
  // "batch_..._20260916_0934.xlsx" gibi yyyymmdd biçimi
  const c = String(name).match(/(?:^|[^0-9])(20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])(?:[^0-9]|$)/);
  return c ? `${c[1]}-${c[2]}-${c[3]}` : '';
}

