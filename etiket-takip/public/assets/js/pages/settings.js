// Ayarlar, yedekleme ve işlem geçmişi.
import { html, mount, icon, toast, busy, download, trDateTime, today, confirmDialog, emptyState, MONTHS, n } from '../core/ui.js';
import { api, state, isAdmin, saveSection, invalidateOrders, reloadConfig } from '../core/api.js';
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
        <label class="btn">${icon('upload')}Yedekten geri yükle<input type="file" id="restore" accept=".json,application/json" hidden></label>
        <button class="btn" id="cleanup">${icon('refresh')}Eski kayıtları şimdi temizle</button>
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
        ${events.map((ev) => html`<tr><td class="nowrap small">${trDateTime(ev.at)}</td><td><b>${ev.user}</b></td><td><span class="badge ${/sil|temizlik/.test(ev.action) ? 'err' : ev.action === 'giriş' ? '' : ev.action.includes('ayar') ? 'violet' : 'ok'}">${ev.action}</span></td><td class="small">${ev.detail}</td></tr>`)}
      </tbody></table></div>` : emptyState('history', 'Bu ay kayıt yok', ''));
    } catch (err) { mount($('#audit'), html`<div class="card-b unm">${err.message}</div>`); }
  }
  $('#month').addEventListener('change', loadAudit);
  loadAudit();
}
