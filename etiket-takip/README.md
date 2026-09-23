# Etiket Takip

Trendyol, ikas ve Shopify mağazalarının kargo etiketi PDF'lerini okuyan; mağaza ve platforma göre ürün bazlı kampanya uygulayan, sipariş / ürün / kampanya adetlerini hesaplayıp gün gün kaydeden statik web uygulaması. Sunucu gerekmez; Netlify'a doğrudan yüklenebilir.

## Netlify'a yükleme

**Sürükle-bırak:** Netlify → *Add new site* → *Deploy manually* → `etiket-takip` klasörünü sürükleyip bırakın.

**Repo bağlayarak:** Repoyu Netlify'a bağlayın. Kök dizindeki `netlify.toml` siteyi `etiket-takip` klasöründen yayınlar; build komutu yoktur.

## Özellikler

| Bölüm | Ne yapar |
|---|---|
| **Etiket Yükle** | Birden fazla PDF'i aynı anda okur. Her sayfadan platform, sipariş no, mağaza (Gönderici), alıcı, kargo firması, kargo barkodu ve `Nx Ürün` satırlarını çıkarır. Kayıt otomatik yapılır; yükleme geri alınabilir. |
| **Mükerrer kontrolü** | Aynı mağazaya ait aynı sipariş numarası, ister aynı dosyada ister aylar önce yüklenmiş olsun, ikinci kez hesaba katılmaz. Anahtar *mağaza + sipariş no*'dur; farklı ikas mağazalarındaki aynı numaralar (1001 gibi) karışmaz. |
| **Devamı etiketleri** | Üzerinde “Devamı” yazan etiket bir önceki etiketin devamı sayılır ve ürünleri o siparişe eklenir; ayrı sipariş olarak sayılmaz. “Devamı sonraki etikette” gibi ifadeler, sipariş numarası olmayan ürün sayfaları ve önceki yüklemede kalan siparişin devamı da doğru siparişe eklenir. |
| **Kampanyalar** | Platform (Tümü / Trendyol / ikas / Shopify) ve mağaza bazında, ürün bazlı. “Her X adede Y adet” (katlanır) ya da “sipariş başına bir kez”; aynı üründen veya farklı bir hediye üründen; başlangıç–bitiş tarihli. Yükleme anında otomatik uygulanır. |
| **Rapor** | Tarih aralığı + platform + mağaza filtresi. Sipariş adedi, etiketteki ürün adedi, kampanyalı sipariş adedi, kampanyayla eklenen ürün ve toplam gönderilecek ürün; mağaza bazında döküm; sipariş listesi. |
| **Toplama listesi** | Ürünler sürükle-bırak veya ▲▼ ile sıralanır, sıra kalıcıdır. Excel (CSV, Türkçe Excel uyumlu) ve Yazdır/PDF bu sırayla çıkar. |
| **Günler** | Son 30 gün grafiği ve gün gün tablo. Bir güne tıklayınca o günün raporu açılır. |
| **Barkod Okut** | USB/Bluetooth barkod okuyucu (klavye gibi çalışan) ile sipariş veya kargo barkodu okutulur; sipariş içeriği ve kampanya hediyeleri gösterilir, “kontrol edildi” işaretlenir. Destekleyen tarayıcılarda (Chrome/Android) kamera ile de okunur. |
| **Ayarlar** | Mağaza → platform düzeltme; farklı yazılmış ürün adlarını tek isimde birleştirme; saklama süresi (varsayılan 365 gün, eski kayıtlar otomatik silinir); JSON yedek al / geri yükle. |

## Veriler nerede?

Tüm kayıtlar **kullandığınız tarayıcının IndexedDB'sinde** tutulur (1 yıllık veri rahatça sığar). Sunucuya hiçbir şey gönderilmez. Bunun sonuçları:

- Başka bir bilgisayar veya tarayıcıda veriler görünmez. Taşımak için *Ayarlar → Yedek indir / Yedekten geri yükle* kullanın.
- Tarayıcı verilerini temizlemek kayıtları siler; **düzenli yedek alın**.

## Dosyalar

```
etiket-takip/
  index.html          arayüz
  css/app.css         stil (açık/koyu tema)
  js/parser.js        etiket ayrıştırıcı (pdf.js metninden sipariş çıkarır)
  js/db.js            IndexedDB katmanı
  js/app.js           uygulama mantığı
  vendor/             pdf.js 3.11 (çevrimdışı çalışır, CDN gerekmez)
```

## Etiket formatı

Ayrıştırıcı ekteki Trendyol etiket tasarımına göre yazıldı: sol üstte platform adı, sağ üstte sipariş numarası, `Gönderici` / `Alıcı` / `Adres` satırları, kargo firması ve barkodu, altta `1x Ürün adı` satırları. ikas ve Shopify etiketleri aynı tasarımda olduğu için aynı şekilde okunur. Farklı bir etiket okunamazsa yükleme sonucunda sayfa numarasıyla uyarı verilir.
