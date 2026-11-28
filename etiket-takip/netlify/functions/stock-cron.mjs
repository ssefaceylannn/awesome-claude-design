// Zamanlanmış stok kontrolü: Türkiye saatiyle 07:00–17:59 arası 10 dakikada bir uyanır; yalnızca
// Stok Kontrol sayfasında belirlenen saatlerde (varsayılan 07:30, 09:00, 10:00, 13:00, 15:00, 16:30, 17:10)
// tabloyu okuyup günün siparişleriyle karşılaştırır. Tabloya yazmaz, stok düşmez.
import { runDueStockChecks } from './api.mjs';

export default async () => {
  try {
    console.log('stok kontrol:', JSON.stringify(await runDueStockChecks()));
  } catch (e) {
    console.error('stok kontrol hatası:', e.message);
  }
  return new Response('ok');
};

// Cron UTC'dir: 04:00–14:59 UTC = 07:00–17:59 Türkiye
export const config = { schedule: '*/10 4-14 * * *' };
