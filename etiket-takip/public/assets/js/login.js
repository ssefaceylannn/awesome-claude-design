// Giriş sayfası (bu dosya giriş kapısının dışında kalır; başka modül içe aktarmaz)
const form = document.getElementById('loginForm');
const msg = document.getElementById('loginMsg');
const btn = document.getElementById('loginBtn');
const show = (text, type = 'err') => {
  msg.innerHTML = '';
  if (!text) return;
  const d = document.createElement('div');
  d.className = 'callout ' + type;
  const c = document.createElement('div');
  c.className = 'c';
  c.textContent = text;
  d.appendChild(c);
  msg.appendChild(d);
};

fetch('/api/login').then((r) => r.json()).then((j) => {
  if (!j.configured) show('Henüz kullanıcı tanımlanmamış. Netlify → Project configuration → Environment variables bölümüne USERS değişkenini ekleyin.', 'warn');
}).catch(() => {});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(form);
  if (!fd.get('username') || !fd.get('password')) return show('Kullanıcı adı ve şifre gerekli.');
  btn.disabled = true;
  btn.textContent = 'Giriş yapılıyor…';
  try {
    const r = await fetch('/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: fd.get('username'), password: fd.get('password'), remember: !!fd.get('remember') }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Giriş başarısız');
    const next = new URLSearchParams(location.search).get('next');
    location.href = next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
  } catch (err) {
    show(err.message);
    btn.disabled = false;
    btn.textContent = 'Giriş yap';
  }
});
