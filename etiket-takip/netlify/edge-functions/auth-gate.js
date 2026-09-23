// Tüm sayfaları giriş yapmamış kullanıcılara kapatır.
import { COOKIE, getSecret, readCookie, verifyToken } from '../lib/auth.js';

export default async (request) => {
  const url = new URL(request.url);
  const env = (k) => globalThis.Netlify?.env?.get(k);
  const secret = await getSecret(env);
  const session = await verifyToken(readCookie(request.headers.get('cookie'), COOKIE), secret);
  if (session) return; // devam et

  if (url.pathname.startsWith('/api/')) {
    return new Response(JSON.stringify({ error: 'Oturum açmanız gerekiyor' }), {
      status: 401,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  }
  const next = url.pathname === '/' ? '' : `?next=${encodeURIComponent(url.pathname)}`;
  return Response.redirect(new URL('/login.html' + next, url), 302);
};

export const config = {
  path: '/*',
  excludedPath: ['/login.html', '/api/login', '/api/logout', '/assets/css/*', '/assets/js/login.js', '/favicon.svg'],
};
