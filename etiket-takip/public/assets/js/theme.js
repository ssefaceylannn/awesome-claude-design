// Kayıtlı temayı sayfa çizilmeden uygula (satır içi betik yerine: içerik güvenlik politikası)
try { var t = localStorage.getItem('et-theme'); if (t) document.documentElement.dataset.theme = t; } catch (e) { /* yok */ }
