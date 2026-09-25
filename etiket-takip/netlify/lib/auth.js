// Oturum jetonu + kullanıcı listesi. Yalnızca Web Crypto kullanır; hem Edge
// Function (Deno) hem Netlify Functions (Node) içinde çalışır.
//
// Kullanıcılar Netlify ortam değişkeni USERS ile tanımlanır:
//   kullanici:sifre:rol   (virgül, noktalı virgül veya satır sonu ile ayrılır)
//   rol: admin | personel | izleyici   (yazılmazsa personel)
// Örnek: sami:GucluSifre1:admin, ayse:Sifre2:personel, muhasebe:Sifre3:izleyici

export const COOKIE = 'et_session';
export const ROLES = ['admin', 'personel', 'izleyici'];

const enc = new TextEncoder();
const dec = new TextDecoder();

const b64u = (buf) => {
  let s = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromB64u = (s) => {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
};

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64u(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}

/** Sabit zamanlı karşılaştırma */
export function safeEqual(a, b) {
  a = String(a);
  b = String(b);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

/** AUTH_SECRET yoksa USERS değerinden türetilir (kullanıcılar değişince oturumlar düşer). */
export async function getSecret(env) {
  const s = env('AUTH_SECRET');
  if (s && s.length >= 16) return s;
  const u = env('USERS');
  if (!u) return null;
  return b64u(await crypto.subtle.digest('SHA-256', enc.encode('etiket-takip:' + u)));
}

/** Şifrenin kısa parmak izi (oturuma yazılır; şifre değişirse eski oturumlar geçersiz olur) */
export async function passwordTag(password, secret) {
  return (await hmac(secret, 'pw:' + password)).slice(0, 16);
}

export async function signToken(payload, secret) {
  const body = b64u(enc.encode(JSON.stringify(payload)));
  return body + '.' + (await hmac(secret, body));
}

export async function verifyToken(token, secret) {
  if (!token || !secret) return null;
  const [body, sig] = String(token).split('.');
  if (!body || !sig) return null;
  if (!safeEqual(await hmac(secret, body), sig)) return null;
  try {
    const p = JSON.parse(dec.decode(fromB64u(body)));
    if (!p.exp || p.exp < Date.now()) return null;
    return p;
  } catch {
    return null;
  }
}

export function parseUsers(str) {
  const users = [];
  for (const raw of String(str || '').split(/[\n,;]+/)) {
    const line = raw.trim();
    if (!line) continue;
    const first = line.indexOf(':');
    if (first <= 0) continue;
    const username = line.slice(0, first).trim().toLocaleLowerCase('tr-TR');
    let rest = line.slice(first + 1);
    let role = 'personel';
    const last = rest.lastIndexOf(':');
    if (last >= 0 && ROLES.includes(rest.slice(last + 1).trim().toLowerCase())) {
      role = rest.slice(last + 1).trim().toLowerCase();
      rest = rest.slice(0, last);
    }
    if (!rest) continue;
    users.push({ username, password: rest, role });
  }
  return users;
}

export function readCookie(header, name) {
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) { try { return decodeURIComponent(part.slice(i + 1).trim()); } catch { return null; } }
  }
  return null;
}
