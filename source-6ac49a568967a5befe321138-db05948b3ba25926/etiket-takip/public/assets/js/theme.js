// Kayıtlı temayı sayfa çizilmeden uygula (satır içi betik yerine: içerik güvenlik politikası)
try { var t = localStorage.getItem('et-theme'); if (t) document.documentElement.dataset.theme = t; } catch (e) { /* yok */ }
// Netlify'ın önizleme/dal yayınlarında sayfaya eklediği araç çubuğunu ve "Netlify" rozetini kaldır.
// (Asıl kapatma yeri: Netlify → Project configuration → Deploy Previews → Netlify Drawer / toolbar.)
(function () {
  var bad = function (el) {
    if (!el || el.nodeType !== 1 || el.closest && el.closest('#app, #print, .login-wrap')) return false;
    var s = (el.tagName + ' ' + (el.id || '') + ' ' + (typeof el.className === 'string' ? el.className : '') + ' ' + (el.getAttribute('src') || '')).toLowerCase();
    return s.indexOf('netlify') >= 0;
  };
  var sweep = function (nodes) { for (var i = 0; i < nodes.length; i++) if (bad(nodes[i])) nodes[i].remove(); };
  try {
    new MutationObserver(function (list) { for (var i = 0; i < list.length; i++) sweep(list[i].addedNodes); })
      .observe(document.documentElement, { childList: true, subtree: true });
    document.addEventListener('DOMContentLoaded', function () { sweep(document.querySelectorAll('body > *, html > *')); });
  } catch (e) { /* yok */ }
})();
