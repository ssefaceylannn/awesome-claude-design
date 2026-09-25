// Ayarlar, yedekleme ve işlem geçmişi.
import { html, mount, personName, icon, toast, busy, download, trDateTime, today, confirmDialog, emptyState, MONTHS, n, modal } from '../core/ui.js';
import { api, state, isAdmin, saveSection, invalidateOrders, reloadConfig, fetchOrders } from '../core/api.js';
import { isLegacyBackup, convertLegacy } from '../core/legacy.js';
import { refreshBadges } from '../app.js';
import { DEFAULT_NOISE } from '../shared/matcher.js';

export default async function settingsPage(ctx) {
  const admin = isAdmin();
  const s = state.config.settings;
  if (!admin) {
    mount(ctx.el, html`<div class="stack"><div class="callout info">${icon('shield')}<div class="c"><b>Ayarları yalnızca yöneticiler değiştirebilir</b>Kayıtlar ${s.retentionDays} gün saklanır. Tema için sol alttaki ay/güneş simgesini kullanabilirsiniz.</div></div></div>`);
    return;
  }
  const t = new Date();
  const months = Array.from({ length: 12 }, (_, i) => { const d = new Date(t.getFullYear(), t.getMonth() - i, 1); return { v: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, l: `${MONTHS[d.getMonth()]} ${d.getFullYear()}` }; });

  mount(ctx.el, html`<div class="stack">
    <div class="grid g-2">
      <div class="card"><div class="card-h"><h2>Genel</h2></div><div class="card-b">
        <form class="form" id="gen">
          <label class="f full">Şirket / panel adı <span class="hint">Kenar menüde ve Excel başlığında görünür</span><input class="input" name="companyName" value="${s.companyName}" maxlength="80" placeholder="Ultra Natura"></label>
          <label class="f">Kayıt saklama süresi (gün)<input class="input" type="number" name="retentionDays" min="30" max="3650" value="${s.retentionDays}"></label>
          <div class="f"><span>&nbsp;</span><button class="btn primary" type="submit">Kaydet</button></div>
          <p class="muted small full">Süresi dolan günlük kayıtlar her gün ilk yüklemede otomatik silinir. Varsayılan: 365 gün.</p>
        </form>
      </div></div>
      <div class="card"><div class="card-h"><h2>Eşleştirmede yok sayılan kelimeler</h2></div><div class="card-b">
        <form id="noise" class="stack" style="gap:10px">
          <p class="muted small">Etiket adlarında geçen ama ürünü belirlemeyen ekler (marka, “hediyeli”, “kampanyalı” vb.). Otomatik eşleşme kelimeleri üretilirken ve güven hesabında atlanır. Virgülle ayırın.</p>
          <textarea class="input" name="words" rows="5">${s.noiseWords.join(', ')}</textarea>
          <div class="row"><button class="btn primary" type="submit">Kaydet</button><button class="btn ghost" type="button" id="noiseReset">Varsayılana dön</button></div>
        </form>
      </div></div>
    </div>
    <div class="card"><div class="card-h"><h2>Yedekleme</h2><span class="sub">Tüm veriler Netlify Blobs'ta saklanır; ek güvence için düzenli yedek alın</span></div><div class="card-b stack">
      <div class="row wrap">
        <button class="btn primary" id="backup">${icon('download')}Tam yedek indir (JSON)</button>
        <label class="btn" title="Bu sitenin yedeği veya eski Kampanya Hesaplama yedeği (.json)">${icon('upload')}Yedekten geri yükle / eski sistemden aktar<input type="file" id="restore" accept=".json,application/json" hidden></label>
        <button class="btn" id="cleanup">${icon('refresh')}Eski kayıtları şimdi temizle</button>
        <button class="btn danger ghost" id="rmArchive">${icon('trash')}Aktarılan arşiv özetlerini kaldır</button>
      </div>
      <div id="bkStatus" class="small muted"></div>
    </div></div>
    <div class="card"><div class="card-h"><h2>İşlem geçmişi</h2><span class="sub">Giriş, yükleme, silme ve ayar değişiklikleri</span><span class="spacer"></span>
      <select class="input sm" id="month" style="width:auto">${months.map((m) => html`<option value="${m.v}">${m.l}</option>`)}</select></div>
      <div id="audit"><div class="loading"><div class="spin"></div></div></div></div>
  </div>`);
  const $ = (q) => ctx.el.querySelector(q);

  $('#gen').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      await saveSection('settings', { ...state.config.settings, companyName: f.companyName.value.trim(), retentionDays: Math.max(30, Math.min(3650, parseInt(f.retentionDays.value, 10) || 365)) }, 'genel ayarlar');
      toast('Ayarlar kaydedildi', 'ok');
    } catch (err) { toast(err.message, 'err'); }
  });
  $('#noise').addEventListener('submit', async (e) => {
    e.preventDefault();
    const words = [...new Set(e.target.words.value.split(/[,\n]/).map((w) => w.trim()).filter(Boolean))];
    try { await saveSection('settings', { ...state.config.settings, noiseWords: words }, 'yok sayılan kelimeler'); toast('Kaydedildi', 'ok'); } catch (err) { toast(err.message, 'err'); }
  });
  $('#noiseReset').addEventListener('click', () => { $('#noise').words.value = DEFAULT_NOISE.join(', '); });

  $('#backup').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    busy(btn, true, 'Yedek hazırlanıyor…');
    try {
      const head = await api.get('backup');
      const days = [];
      for (const [i, m] of head.months.entries()) {
        $('#bkStatus').textContent = `${m} indiriliyor (${i + 1}/${head.months.length})…`;
        days.push(...(await api.get('backup?month=' + m)).days);
      }
      const data = { app: 'etiket-takip', version: 2, exportedAt: new Date().toISOString(), exportedBy: state.me.username, config: head.config, labelnames: head.labelnames, days };
      download(`etiket-takip-yedek_${today()}.json`, new Blob([JSON.stringify(data)], { type: 'application/json' }));
      $('#bkStatus').textContent = `Yedek indirildi: ${days.length} gün, ${n(days.reduce((s, d) => s + d.orders.length, 0))} sipariş.`;
    } catch (err) { toast(err.message, 'err'); $('#bkStatus').textContent = ''; }
    busy(btn, false);
  });

  $('#restore').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    let data;
    try { data = JSON.parse(await file.text()); } catch { return toast('Dosya okunamadı', 'err'); }
    if (isLegacyBackup(data)) return importLegacy(data);
    if (data.app !== 'etiket-takip' || !Array.isArray(data.days)) return toast('Geçerli bir Etiket Takip yedeği değil', 'err');
    const total = data.days.reduce((s, d) => s + d.orders.length, 0);
    if (!(await confirmDialog(html`${trDateTime(data.exportedAt)} tarihli yedek geri yüklensin mi?<br><br><b>Ayarlar</b> (mağazalar, ürünler, kampanyalar, eşleştirmeler) yedektekiyle <b>değiştirilir</b>. <b>${n(total)} sipariş</b> mevcut kayıtlara eklenir; zaten var olan siparişler değişmez.`, { ok: 'Geri yükle', danger: true }))) return;
    try {
      $('#bkStatus').textContent = 'Ayarlar yükleniyor…';
      await api.post('restore', { config: data.config, labelnames: data.labelnames });
      let restored = 0;
      for (let i = 0; i < data.days.length; i += 5) {
        $('#bkStatus').textContent = `Günler yükleniyor ${Math.min(i + 5, data.days.length)}/${data.days.length}…`;
        restored += (await api.post('restore', { days: data.days.slice(i, i + 5) })).restored;
      }
      invalidateOrders();
      await reloadConfig();
      $('#bkStatus').textContent = `Geri yükleme tamamlandı: ${n(restored)} yeni sipariş eklendi.`;
      toast('Geri yükleme tamamlandı', 'ok');
    } catch (err) { toast(err.message, 'err'); }
  });

  // ---------------------------------------------------------------- eski sistem (Kampanya Hesaplama) aktarımı
  async function importLegacy(data) {
    const status = (t) => { $('#bkStatus').textContent = t; };
    let reorder = true;
    const conv = (ro) => convertLegacy(data, state.config, { reorderProducts: ro });
    let res = conv(true);
    const dates = res.days.map((d) => d.date);
    status('Mevcut kayıtlar kontrol ediliyor…');
    let existing = [];
    try { existing = dates.length ? await fetchOrders(dates[0], dates[dates.length - 1]) : []; } catch (err) { status(''); return toast(err.message, 'err'); }
    const realDays = new Set(existing.filter((o) => !o.summary).map((o) => o.date));
    const archDays = new Set(existing.filter((o) => o.summary).map((o) => o.date));
    const toImport = res.days.filter((d) => !realDays.has(d.date) && !archDays.has(d.date));
    const skippedReal = res.days.filter((d) => realDays.has(d.date)).map((d) => d.date);
    const skippedArch = res.days.filter((d) => archDays.has(d.date) && !realDays.has(d.date)).map((d) => d.date);
    const R = res.report;
    const sum = (k) => toImport.reduce((a, d) => a + ((d.totals && d.totals[k]) || 0), 0);
    status('');
    const ok = await modal({
      title: 'Eski sistemden aktarım', size: 'lg',
      body: html`<div class="stack small">
        <p>${trDateTime(data.savedAt)} tarihli <b>Kampanya Hesaplama</b> yedeği bulundu. Mevcut verileriniz <b>silinmez</b>; eksikler eklenir.</p>
        <div class="kpis">
          <div class="kpi"><div class="l">Aktarılacak gün</div><div class="v">${n(toImport.length)}</div><div class="s">${toImport.length ? `${toImport[0].date} – ${toImport[toImport.length - 1].date}` : ''}</div></div>
          <div class="kpi"><div class="l">Sipariş</div><div class="v">${n(sum('orders'))}</div><div class="s">${n(sum('adet'))} ürün + ${n(sum('bonus'))} kampanya</div></div>
          <div class="kpi"><div class="l">Mükerrer kontrolüne</div><div class="v">${n(R.legacyOrders)}</div><div class="s">eski sipariş numarası</div></div>
        </div>
        <ul style="margin:0;padding-left:18px;display:grid;gap:4px">
          <li><b>Mağazalar:</b> ${R.storesAdded.length} yeni${R.storesAdded.length ? ` (${R.storesAdded.join(', ')})` : ''}${R.storesUpdated.length ? ` · ${R.storesUpdated.length} farklı yazım mevcut mağazaya bağlandı (${R.storesUpdated.join(', ')})` : ''}</li>
          <li><b>Ürünler:</b> ${R.productsAdded} yeni ürün; mevcutlarda boş olan SKU/marka/kategori doldurulur; eski anahtar kelimeler eşleşme kuralı olarak eklenir${R.weakKeywords.length ? ` (${R.weakKeywords.length} çok genel kelime alınmadı: ${R.weakKeywords.join(' · ')})` : ''}.</li>
          <li><b>Kampanyalar:</b> ${R.campaigns.length} kural <b>durdurulmuş taslak</b> olarak eklenir; kontrol edip başlatmanız gerekir.${R.skippedRules.length ? ` Kampanyası olmayan: ${R.skippedRules.join(', ')}.` : ''}</li>
          <li><b>Günlük kayıtlar:</b> her gün, eski sistemin kaydettiği ürün ve kampanya adetleriyle “arşiv özeti” olarak eklenir (yeniden hesaplanmaz; sipariş detayı yoktur).</li>
          ${skippedReal.length ? html`<li class="unm"><b>${skippedReal.length} gün atlanacak</b> çünkü sitede bu günlerin siparişleri zaten var (çift sayılmasın diye): ${skippedReal.join(', ')}</li>` : ''}
          ${skippedArch.length ? html`<li class="muted">${skippedArch.length} gün daha önce aktarılmış, tekrar eklenmeyecek.</li>` : ''}
          ${R.legacyShortSkipped ? html`<li class="muted">${n(R.legacyShortSkipped)} kısa sipariş numarası (ikas/Shopify) mağaza bilgisi olmadığı için mükerrer kontrolüne alınmadı.</li>` : ''}
        </ul>
        <label class="switch"><input type="checkbox" id="reorder" checked> Ürün sırasını eski sistemdeki sıraya göre ayarla</label>
      </div>`,
      actions: [{ label: 'Vazgeç', value: 'cancel' }, { label: 'Aktarımı başlat', value: 'go', variant: 'primary' }],
      onSubmit: (_, d) => { reorder = d.querySelector('#reorder').checked; },
    });
    if (ok !== 'go') return;
    try {
      if (!reorder) res = conv(false);
      status('Mağazalar, ürünler ve kampanyalar kaydediliyor…');
      await saveSection('stores', res.config.stores, `eski sistemden ${R.storesAdded.length} mağaza`);
      await saveSection('products', res.config.products, `eski sistemden ${R.productsAdded} ürün${reorder ? ' + sıra' : ''}`);
      await saveSection('campaigns', res.config.campaigns, `eski sistemden ${R.campaigns.length} kampanya taslağı`);
      await api.post('restore', { labelnames: res.labelnames });
      const days = res.days.filter((d) => toImport.some((x) => x.date === d.date)).map((d) => ({ date: d.date, orders: d.orders }));
      for (let i = 0; i < days.length; i += 4) {
        status(`Günlük kayıtlar aktarılıyor ${Math.min(i + 4, days.length)}/${days.length}…`);
        await api.post('restore', { days: days.slice(i, i + 4) });
      }
      const CH = 25000;
      for (let i = 0; i < res.legacyIndex.length; i += CH) {
        status(`Eski sipariş numaraları ekleniyor ${n(Math.min(i + CH, res.legacyIndex.length))}/${n(res.legacyIndex.length)}…`);
        const last = i + CH >= res.legacyIndex.length;
        await api.post('legacy/index', { entries: res.legacyIndex.slice(i, i + CH), final: last, summary: `${days.length} gün, ${R.storesAdded.length} mağaza, ${R.productsAdded} ürün, ${R.campaigns.length} kampanya taslağı, ${res.legacyIndex.length} sipariş no` });
      }
      invalidateOrders();
      await reloadConfig();
      refreshBadges();
      status(`Aktarım tamamlandı: ${days.length} gün, ${n(sum('orders'))} sipariş. Kampanya taslaklarını Kampanyalar sayfasında kontrol edip başlatın.`);
      toast('Eski sistem verileri aktarıldı', 'ok');
    } catch (err) {
      toast(err.message, 'err');
      status('Aktarım yarıda kaldı: ' + err.message + ' — dosyayı tekrar seçerseniz kaldığı yerden devam eder (eklenenler tekrar eklenmez).');
    }
  }

  $('#rmArchive').addEventListener('click', async (e) => {
    if (!(await confirmDialog('Eski sistemden aktarılan tüm günlük arşiv özetleri silinsin mi? Sitede yüklenmiş gerçek siparişler etkilenmez.', { danger: true, ok: 'Arşivi kaldır' }))) return;
    const btn = e.currentTarget;
    busy(btn, true, 'Kaldırılıyor…');
    try { const r = await api.post('legacy/remove'); invalidateOrders(); toast(`${r.removed} arşiv kaydı kaldırıldı`, 'ok'); } catch (err) { toast(err.message, 'err'); }
    busy(btn, false);
  });

  $('#cleanup').addEventListener('click', async (e) => {
    if (!(await confirmDialog(`${state.config.settings.retentionDays} günden eski tüm kayıtlar kalıcı olarak silinsin mi?`, { danger: true, ok: 'Temizle' }))) return;
    const btn = e.currentTarget;
    busy(btn, true, 'Temizleniyor…');
    try {
      const { result } = await api.post('cleanup');
      invalidateOrders();
      toast(`${result.removedDays} günlük kayıt silindi (${result.cutoff} öncesi)`, 'ok');
    } catch (err) { toast(err.message, 'err'); }
    busy(btn, false);
  });

  async function loadAudit() {
    try {
      const { events } = await api.get('audit?month=' + $('#month').value);
      mount($('#audit'), events.length ? html`<div class="tw" style="max-height:520px"><table class="t"><thead><tr><th>Zaman</th><th>Kullanıcı</th><th>İşlem</th><th>Ayrıntı</th></tr></thead><tbody>
        ${events.map((ev) => html`<tr><td class="nowrap small">${trDateTime(ev.at)}</td><td><b>${personName(ev.user)}</b></td><td><span class="badge ${/sil|temizlik/.test(ev.action) ? 'err' : ev.action === 'giriş' ? '' : ev.action.includes('ayar') ? 'violet' : 'ok'}">${ev.action}</span></td><td class="small">${ev.detail}</td></tr>`)}
      </tbody></table></div>` : emptyState('history', 'Bu ay kayıt yok', ''));
    } catch (err) { mount($('#audit'), html`<div class="card-b unm">${err.message}</div>`); }
  }
  $('#month').addEventListener('change', loadAudit);
  loadAudit();
}
