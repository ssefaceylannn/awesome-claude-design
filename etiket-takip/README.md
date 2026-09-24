# Etiket Takip — Sipariş & Üretim Planlama Paneli

Trendyol, ikas ve Shopify mağazalarının kargo etiketi PDF'lerini okuyup; mağaza ve platforma göre ürün bazlı kampanyaları uygulayan, ürün adlarını katalogla otomatik eşleştiren ve **belirlediğiniz ürün sırasıyla** üretim/sevk listesini Excel olarak veren, çok kullanıcılı web uygulaması.

## Netlify'a kurulum (ilk sefer, ~10 dakika)

> Uygulama sunucu tarafı (giriş, ortak veri) kullandığı için **sürükle-bırak ile değil, GitHub bağlantısıyla** yayınlanmalıdır. Netlify'ın sürükle-bırak yüklemesi fonksiyonları çalıştırmaz.

1. **Netlify → Add new site → Import an existing project → GitHub** ve bu repoyu seçin.
   Ayarlar repodaki `netlify.toml` dosyasından otomatik gelir (base: `etiket-takip`, publish: `public`). Branch olarak bu kodun bulunduğu branch'i seçin.
2. **Project configuration → Environment variables** bölümüne iki değişken ekleyin:

   | Değişken | Değer |
   |---|---|
   | `USERS` | `kullanici:sifre:rol` biçiminde, virgülle ayrılmış. Örnek: `sami:GucluSifre!2026:admin, ayse:DepoSifre#44:personel, uretim:Uretim$9:izleyici` |
   | `AUTH_SECRET` | En az 32 karakterlik rastgele bir metin (oturum imzası için). Örnek üretmek için: `openssl rand -base64 32` |

3. **Deploys → Trigger deploy → Deploy site**. Yayın bitince site adresine girin; giriş ekranı gelir.

Kullanıcı eklemek, şifre veya rol değiştirmek için `USERS` değişkenini düzenleyip yeniden deploy etmeniz yeterli. Silinen kullanıcının açık oturumu hemen düşer.

### Roller

| | Yönetici (`admin`) | Personel (`personel`) | İzleyici (`izleyici`) |
|---|:-:|:-:|:-:|
| Genel bakış, üretim listesi, siparişler, arşiv, Excel | ✓ | ✓ | ✓ |
| Etiket yükleme, barkod kontrol | ✓ | ✓ | — |
| Mağaza, ürün, sıra, eşleştirme, kampanya düzenleme | ✓ | — | — |
| Silme, ayarlar, yedek, işlem geçmişi | ✓ | — | — |

## İlk kullanım

1. **Mağazalar:** 6 Trendyol, 3 ikas ve 1 Shopify mağazanızı ekleyin. “Etiketteki gönderici adları”, etiketin *Gönderici* alanında yazan addır (örn. `Ultra Natura Trendyol`). İlk etiket yüklemesinden sonra tanımsız göndericiler burada listelenir; tek tıkla mağaza yapabilir veya mevcut mağazaya bağlayabilirsiniz.
2. **Ürünler & Sıra:** Ürünlerinizi **üretim listesinde görmek istediğiniz sırayla** ekleyin (“Toplu ekle” ile her satıra bir ürün). Sırayı sürükleyerek veya sıra numarasını yazarak değiştirebilirsiniz. Excel'deki *Ürün | Gönderilecek Adet* tablosu bu sırayla oluşur.
3. **Kampanyalar:** Önce kampanya türünü seçin (X alana Y bedava, karışık sepet, X farklı ürün, sipariş tutarı, her siparişe hediye, hediye paketi…). Listede olmayan bir türü “Yeni tür” ile kendiniz ekleyebilirsiniz. Mağazaları “seçilenlerde geçerli” ya da “seçilenler hariç”, ürünleri “sadece seçilenlerde” ya da “seçilenler hariç” olarak seçin — **hiç ürün seçmezseniz kampanya tüm ürünlere uygulanır**. Birden çok hediye ürünü ve sipariş başına üst sınır verilebilir. “En fazla X adet” ve “Karışık siparişte uygulanmaz” ayarlarıyla “2. ürün 1 TL” gibi kampanyalar tanımlanır (hazır tür: yalnızca tek çeşit ürün içeren ve 1 adetlik siparişe +1 aynı üründen; 2 adet veya karışık siparişte ek ürün yok).
4. **Etiket Yükle:** PDF etiketlerini ve/veya Excel sipariş listelerini (.xlsx) sürükleyin — dosya sayısı sınırı yok (100–200+ PDF, birden çok Excel birlikte). Önizlemede yeni / mükerrer / devam etiketleri, eşleşmeyen ürün adları ve tanımsız mağazalar görünür; **Kaydet** ile kayıt alınır.
5. **Üretim Listesi:** Gün veya aralık seçip **Excel indir**.

## Ürün eşleştirme nasıl çalışır?

Mağazalarda aynı ürün farklı yazılabilir: `Ultra Natura Detox Shot Zencefilli 60ml Hediyeli`, `DETOKS SHOT 7'li`, `Organik Detox Mix Kampanyalı`… Eşleştirici:

- Küçük/büyük harf, Türkçe karakter ve noktalama farklarını yok sayar, birimleri birleştirir (`1 Lt` = `1000ml`, `500 ml` = `500ml`).
- Marka ve pazarlama eklerini (`Ultra Natura`, `Hediyeli`, `Kampanyalı`…) ayıklar. Liste *Ayarlar*dan düzenlenir.
- Ürünün **tüm** eşleşme kelimeleri etiket adında geçmelidir. `Detox Shot` = {detox, shot}, `Detox Mix` = {detox, mix}; bu yüzden ikisi asla karışmaz. `detox/detoks` gibi yazım farkları ve Türkçe ekler (`shotu`, `sirkesi`) tanınır.
- Birden fazla ürün uyarsa en çok kelimesi tutan (en özel) ürün kazanır. Eşit durumlar **Belirsiz** olarak *Ürün Eşleştirme* ekranına düşer.
- *Ürün Eşleştirme* ekranında yaptığınız elle atama her zaman önceliklidir. Ürün olmayan satırları (örn. “Kargo bedeli”) **Yoksay** yapabilirsiniz.
- **Birleşik adlar / setler:** Etiket adı katalogdaki iki farklı ürünün kelimelerini ayrı ayrı içeriyorsa (ör. “Daily Shake Ginger Shot”) otomatik olarak iki ürüne bölünür. Katalogda setin kendisi tanımlıysa o seçilir. *Ürün Eşleştirme → Birden çok ürün (set)* ile bir adı istediğiniz ürün ve adetlere elle bölebilirsiniz.
- İsteğe bağlı **paket çarpanı**: ürün ayarında açılırsa `7'li`, `x 14` gibi ifadeler adet × 7 olarak sayılır.
- Ürün düzenleme penceresi, kural değişikliğinin hangi etiket adlarını etkileyeceğini kaydetmeden önce gösterir.

Raporlar her açılışta güncel eşleştirme ve kampanya ayarlarıyla hesaplanır. Bir eşleştirmeyi düzelttiğinizde geçmiş günlerin raporları da düzelir.

## Excel ile yükleme

Pazaryeri/entegratör sipariş dışa aktarımları (.xlsx) doğrudan yüklenebilir. Sütunlar başlık adından bulunur: *Sipariş No, Paket No, Mağaza, Platform, Müşteri Adı, Şehir, İlçe, Kargo Firması, Kargo Takip No, PTT Barkod, Ürünler, Toplam Adet, Toplam Tutar, Platform Tarihi, Sipariş Durumu*. Ürünler hücresi `Ürün A, varyant x1, Ürün B x2` biçiminde ayrıştırılır; satır başına bir ürün olan listeler de desteklenir. İptal/iade durumundaki satırlar atlanır. Telefon ve adres sunucuya gönderilmez.

Excel'deki **Kargo Takip No**, etiket PDF'inin üstündeki numarayla aynıdır; bu yüzden aynı paket hem PDF hem Excel ile yüklenirse bir kez sayılır. Sipariş tarihi olarak dosya adındaki tarih (örn. `…_20260916_…`) veya Excel'deki platform tarihi seçilebilir.

## Toplu işlemler

Ürünler, mağazalar, kampanyalar, kampanya türleri, siparişler, ürün eşleştirme ve yükleme geçmişi tablolarında satırları işaretleyip toplu **silme** (ve duruma göre aktif/pasif yapma, kategori atama, ürüne atama, kontrol edildi işaretleme, bitirme/arşivleme) yapılabilir. Siparişlerde “filtrelenenlerin tümünü seç” ile sayfalar arası seçim yapılır.

## Mükerrer ve devam etiketleri

- Aynı **mağaza + sipariş numarası** ikinci kez yüklenirse (aynı dosyada ya da aylar sonra) hesaba katılmaz. Farklı mağazalardaki aynı numaralar (ör. ikas'ta `1001`) karışmaz.
- Üzerinde “Devamı” yazan etiket bir önceki etiketin devamı sayılır; ürünleri o siparişe eklenir, ayrı sipariş sayılmaz. Önceki yüklemede kalmış bir siparişin devamı da doğru siparişe eklenir.
- Aynı anda birden fazla personel yükleme yapsa bile aynı sipariş iki kez yazılmaz.

## Üretim listesi: sıralama, filtre, sabit liste

Ekranda sütun başlıklarına tıklayarak veya sıralama kutusundan sıralayabilir; ürün adı, kategori ve “sadece kampanyalı” ile filtreleyebilirsiniz (yalnızca ekranı etkiler). **Excel indir** menüsünde:
- **Detaylı rapor** — üretim listesi + mağaza/kampanya/sipariş sayfaları
- **Sabit sıralı liste (0'lar dahil)** — katalogdaki tüm ürünler, Ürünler sayfasındaki sırayla; ilk satır başlık, başka tabloya yapıştırmak için satırlar hiç kaymaz
- **Panoya kopyala** — aynı sırayla yalnızca adetler veya ürün + adet

## Eski sistemden (Kampanya Hesaplama) aktarım

*Ayarlar → Yedekten geri yükle / eski sistemden aktar* ile eski JSON yedeği seçilir. Mevcut veriler silinmez:
- Mağazalar, ürünler (SKU, marka, kategori, sıra) ve eski anahtar kelimeler eklenir; çok genel kelimeler (“one size” gibi) alınmaz.
- Kampanya kuralları **durdurulmuş taslak** olarak eklenir; kontrol edip başlatın.
- Her gün, eski sistemin kaydettiği ürün ve kampanya adetleriyle **arşiv özeti** olarak eklenir (günlük toplamlar birebir korunur, kampanyalar yeniden hesaplanmaz). Sitede zaten siparişi olan günler çift sayılmasın diye atlanır.
- Eski sipariş numaraları mükerrer kontrolüne eklenir; eski bir etiket tekrar yüklenirse sayılmaz.
- Aynı yedeği tekrar seçmek bir şeyi çiftlemez. *Aktarılan arşiv özetlerini kaldır* ile arşiv geri alınabilir.

## Veriler

- Veriler Netlify Blobs'ta tutulur; tüm kullanıcılar aynı veriyi görür. PDF'ler tarayıcıda okunur, sunucuya yalnızca sipariş bilgileri gönderilir.
- Kayıtlar gün gün saklanır ve varsayılan olarak **365 gün** tutulur; süre *Ayarlar*dan değiştirilebilir.
- *Ayarlar → Tam yedek indir* ile tüm veriyi JSON olarak alın; aynı ekrandan geri yükleyebilirsiniz.
- Giriş, yükleme, silme ve ayar değişiklikleri *İşlem geçmişi*nde kullanıcı adıyla tutulur. 5 hatalı girişte hesap 5 dakika kilitlenir.

## Klasör yapısı

```
etiket-takip/
  netlify.toml                    Netlify ayarları
  package.json                    bağımlılık: @netlify/blobs
  netlify/edge-functions/         giriş kapısı (tüm sayfaları korur)
  netlify/functions/api.mjs       API: giriş, ayarlar, içe aktarma, raporlar, yedek
  netlify/lib/                    oturum imzası, Blobs erişimi
  public/                         arayüz (index.html, login.html, assets/)
  public/assets/js/shared/        tarayıcı ve sunucunun ortak kullandığı mantık
                                  (etiket ayrıştırıcı, eşleştirici, kampanya hesabı)
  scripts/dev-server.mjs          Netlify olmadan yerel çalıştırma
  scripts/test.mjs                çekirdek mantık testleri
```

## Yerelde çalıştırma

```bash
cd etiket-takip
npm install
npm test          # eşleştirme, kampanya, oturum testleri
npm run dev       # http://localhost:8888  (admin / admin123)
```

Yerel sunucu, verileri `.dev-data/` klasöründe tutan resmi Netlify Blobs test sunucusunu kullanır.
