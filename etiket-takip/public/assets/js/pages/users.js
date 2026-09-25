// Kullanıcılar: Netlify ortam değişkeninden okunur (yalnızca yönetici).
import { html, mount, personName, initials, icon, emptyState } from '../core/ui.js';
import { api, state } from '../core/api.js';

const ROLES = [
  { id: 'admin', label: 'Yönetici', desc: 'Her şey: mağaza, ürün, eşleştirme, kampanya, ayarlar, silme işlemleri' },
  { id: 'personel', label: 'Personel', desc: 'Etiket yükleme, barkod kontrol, tüm raporlar ve Excel çıktıları' },
  { id: 'izleyici', label: 'İzleyici', desc: 'Yalnızca görüntüleme ve Excel indirme (ör. üretim sorumlusu, muhasebe)' },
];
const MATRIX = [
  ['Genel bakış, üretim listesi, siparişler, arşiv', 1, 1, 1],
  ['Excel / yazdırma', 1, 1, 1],
  ['Etiket yükleme', 1, 1, 0],
  ['Barkod kontrol', 1, 1, 0],
  ['Mağaza / ürün / kampanya / eşleştirme düzenleme', 1, 0, 0],
  ['Yükleme ve sipariş silme', 1, 0, 0],
  ['Ayarlar, yedek, işlem geçmişi', 1, 0, 0],
];

export default async function usersPage(ctx) {
  const { users } = await api.get('users');
  ctx.setSub(`${users.length} kullanıcı`);
  mount(ctx.el, html`<div class="stack">
    ${(state.warnings || []).length ? html`<div class="callout warn">${icon('shield')}<div class="c"><b>Güvenlik uyarısı</b>Netlify'da <code>AUTH_SECRET</code> tanımlı değil. Oturumlar şu an kullanıcı listesinden türetilen bir anahtarla imzalanıyor; en az 32 karakterlik rastgele bir <code>AUTH_SECRET</code> ekleyin.</div></div>` : ''}
    <div class="grid">
      <div class="card"><div class="card-h"><h2>Tanımlı kullanıcılar</h2></div>
        <div class="tw"><table class="t"><thead><tr><th>Kullanıcı adı</th><th>Rol</th><th></th></tr></thead><tbody>
          ${users.length ? users.map((u) => html`<tr><td><div class="row"><div class="avatar" style="width:28px;height:28px;font-size:.72rem">${initials(u.username)}</div><b>${personName(u.username)}</b>${u.username === state.me.username ? html`<span class="badge info">siz</span>` : ''}</div></td>
            <td><span class="badge ${u.role === 'admin' ? 'violet' : u.role === 'personel' ? 'ok' : ''}">${(ROLES.find((r) => r.id === u.role) || {}).label || u.role}</span></td><td class="muted small">${(ROLES.find((r) => r.id === u.role) || {}).desc || ''}</td></tr>`) : html`<tr><td colspan="3">${emptyState('users', 'Kullanıcı yok', '')}</td></tr>`}
        </tbody></table></div></div>
    </div>
    <div class="card"><div class="card-h"><h2>Rol yetkileri</h2></div><div class="tw"><table class="t"><thead><tr><th>Yetki</th>${ROLES.map((r) => html`<th class="num">${r.label}</th>`)}</tr></thead><tbody>
      ${MATRIX.map(([l, ...v]) => html`<tr><td>${l}</td>${v.map((x) => html`<td class="num">${x ? html`<span class="gift">${icon('check')}</span>` : html`<span class="muted">—</span>`}</td>`)}</tr>`)}
    </tbody></table></div></div>
  </div>`);
}
