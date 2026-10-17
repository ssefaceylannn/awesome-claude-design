// Sayfalar arası dosya aktarımı (ör. Karma Ayıklama → Etiket Yükle): dosyalar bellekte tutulur, bir kez alınır.
let pending = null;
export const handOff = (files) => { pending = files; };
export const takeHandOff = () => { const p = pending; pending = null; return p; };
