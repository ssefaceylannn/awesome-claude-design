// Code 128 barkod (kargo etiketlerindeki standart). Rakamlar C kümesiyle (2 hane/karakter),
// diğer karakterler B kümesiyle kodlanır. Çıktı: SVG metni. Harici kütüphane gerekmez.

// Her desen: çubuk/boşluk genişlikleri (modül cinsinden). 103-105 başlangıç, 106 bitiş.
const PATTERNS = ('212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 123122 123221 223211 221132 '
  + '221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 232121 111323 131123 131321 112313 132113 132311 211313 '
  + '231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 '
  + '314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 '
  + '111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 '
  + '114131 311141 411131 211412 211214 211232 2331112').split(' ');
const START_B = 104, START_C = 105, CODE_B = 100, CODE_C = 99, STOP = 106;

/** Metni Code 128 kod değerlerine çevirir (başlangıç + veri + sağlama + bitiş) */
export function code128Values(text) {
  const s = String(text);
  if (!s || /[^\x20-\x7e]/.test(s)) throw new Error('Barkod için geçersiz karakter');
  const digitRun = (i) => { let j = i; while (j < s.length && s[j] >= '0' && s[j] <= '9') j++; return j - i; };
  const vals = [];
  let set = null;
  let i = 0;
  while (i < s.length) {
    const run = digitRun(i);
    // En az 4 rakam (baştaysa/sondaysa 2) C kümesinde daha kısa
    const useC = run >= 4 || (run >= 2 && run === s.length - i && (i === 0 || set === 'C'));
    if (useC) {
      if (set !== 'C') { vals.push(set ? CODE_C : START_C); set = 'C'; }
      const pairs = Math.floor(run / 2);
      for (let k = 0; k < pairs; k++) { vals.push(+s.substr(i, 2)); i += 2; }
    } else {
      if (set !== 'B') { vals.push(set ? CODE_B : START_B); set = 'B'; }
      vals.push(s.charCodeAt(i) - 32);
      i++;
    }
  }
  let sum = vals[0];
  for (let k = 1; k < vals.length; k++) sum += vals[k] * k;
  vals.push(sum % 103, STOP);
  return vals;
}

/** Çubuk genişlikleri dizisi (1 = dar modül); sırayla çubuk, boşluk, çubuk… */
export function code128Widths(text) {
  return code128Values(text).flatMap((v) => PATTERNS[v].split('').map(Number));
}

/** SVG barkod; yükseklik ve genişlik CSS ile verilir */
export function barcodeSvg(text, { quiet = 10 } = {}) {
  const widths = code128Widths(text);
  const total = widths.reduce((a, b) => a + b, 0) + quiet * 2;
  let x = quiet, rects = '';
  widths.forEach((w, k) => { if (k % 2 === 0) rects += `<rect x="${x}" y="0" width="${w}" height="100"/>`; x += w; });
  return `<svg class="bc" viewBox="0 0 ${total} 100" preserveAspectRatio="none" role="img" aria-label="Barkod ${String(text).replace(/[<>&"]/g, '')}" shape-rendering="crispEdges"><g fill="#000">${rects}</g></svg>`;
}
