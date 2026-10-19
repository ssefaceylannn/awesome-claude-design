// Türkiye'nin 81 ili ve etiketteki adresten il bulma ("ŞEHITKAMIL / GAZIANTEP" → "Gaziantep").
import { fold } from './text.js';

export const PROVINCES = ['Adana', 'Adıyaman', 'Afyonkarahisar', 'Ağrı', 'Aksaray', 'Amasya', 'Ankara', 'Antalya', 'Ardahan', 'Artvin', 'Aydın',
  'Balıkesir', 'Bartın', 'Batman', 'Bayburt', 'Bilecik', 'Bingöl', 'Bitlis', 'Bolu', 'Burdur', 'Bursa', 'Çanakkale', 'Çankırı', 'Çorum',
  'Denizli', 'Diyarbakır', 'Düzce', 'Edirne', 'Elazığ', 'Erzincan', 'Erzurum', 'Eskişehir', 'Gaziantep', 'Giresun', 'Gümüşhane', 'Hakkari',
  'Hatay', 'Iğdır', 'Isparta', 'İstanbul', 'İzmir', 'Kahramanmaraş', 'Karabük', 'Karaman', 'Kars', 'Kastamonu', 'Kayseri', 'Kilis',
  'Kırıkkale', 'Kırklareli', 'Kırşehir', 'Kocaeli', 'Konya', 'Kütahya', 'Malatya', 'Manisa', 'Mardin', 'Mersin', 'Muğla', 'Muş',
  'Nevşehir', 'Niğde', 'Ordu', 'Osmaniye', 'Rize', 'Sakarya', 'Samsun', 'Şanlıurfa', 'Siirt', 'Sinop', 'Şırnak', 'Sivas', 'Tekirdağ',
  'Tokat', 'Trabzon', 'Tunceli', 'Uşak', 'Van', 'Yalova', 'Yozgat', 'Zonguldak'];
const BY_KEY = new Map(PROVINCES.map((p) => [fold(p).replace(/\s+/g, ''), p]));
// Kısaltılmış / eski yazımlar
for (const [k, v] of Object.entries({ kmaras: 'Kahramanmaraş', maras: 'Kahramanmaraş', afyon: 'Afyonkarahisar', icel: 'Mersin', urfa: 'Şanlıurfa', antep: 'Gaziantep', hakkari: 'Hakkari', hakkâri: 'Hakkari' })) BY_KEY.set(k, v);

/** Etiketteki şehir metninden il adı ("" = bulunamadı). Önce "/" sonrası, sonra son kelime(ler) denenir. */
export function provinceOf(text) {
  const s = String(text || '').trim();
  if (!s) return '';
  const parts = s.split('/').map((x) => x.trim()).filter(Boolean);
  const cands = [parts[parts.length - 1] || '', ...parts.slice(0, -1).reverse()];
  for (const c of cands) {
    const k = fold(c).replace(/[^a-z]/g, '');
    if (BY_KEY.has(k)) return BY_KEY.get(k);
    const words = fold(c).split(/[^a-z]+/).filter(Boolean);
    for (let i = words.length - 1; i >= 0; i--) if (BY_KEY.has(words[i])) return BY_KEY.get(words[i]);
  }
  return '';
}
