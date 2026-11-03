# Bağlantı ağacı, klasör etkileşimleri ve Cmd/Ctrl+K hızlı geçiş

Type: prototype
Status: resolved
Blocked by: —

## Question

Sol bağlantı ağacı nasıl görünür ve davranır: klasör → bağlantı → veritabanı → şema düzeyleri, ortam rengi/rozeti, veritabanı seçiminin (görünür veritabanları ve şemalar) ağaçta nasıl yapıldığı ([Bağlantı formu ve "bağlantıyı test et" akışı](24-baglanti-formu.md) bunu forma koymadı), klasör oluşturma/yeniden adlandırma/silme ve sürükle-bırak, bağlantı kopyalama/silme? Cmd/Ctrl+K hızlı geçiş neyi arar (bağlantı, veritabanı, hedef), seçince ne olur (yeni script editörü mü, mevcut editörün hedefi mi) ve oraya ya da ağaca yapıştırılan `postgres://` URL dolu bağlantı formunu açar mı?

## Answer

**Varyant C: üstte bağlantı listesi, altta seçili bağlantının veritabanı paneli.**

- **Üst bölme (bağlantı listesi)**: klasörler katlanır bölüm başlıkları (ad + bağlantı sayısı), en altta "Klasörsüz" bölümü. Bağlantı satırı iki satırlık: ortam rengi noktası, ad, tünel işareti (⇄), durum (◌ bağlanıyor / ● bağlı / ⚠ hata); altında `kullanıcı@host[:port]`. prod bağlantılar solda kırmızı şeritli. Hedefin bağlantısında "● hedef".
- **Klasörler tek düzey** (iç içe yok). Oluşturma: kenar çubuğu başlığındaki düğme ve Ctrl+K komutu. Yeniden adlandırma/silme: başlıkta sağ tık. Klasör silinince içindeki bağlantılar silinmez, kök düzeye ("Klasörsüz") taşınır. Bağlantı sürükle-bırakla ya da menüdeki "Klasöre taşı" ile klasör değiştirir.
- **Alt panel (Veritabanı seçimi)**: seçili bağlantının veritabanları. Görünürler üstte (⭐), her birinin altında şemalar açılıp kapanan çipler olarak; gizliler "Gizli (N)" altında, ⭐ ile görünür yapılır. Satıra tıklamak o veritabanını editörün hedefi yapar. Şema çipleri ilk dilimde kalır (Veritabanı seçimi modeli tam olsun); hedef yine yalnızca bağlantı + veritabanı.
- **Varsayılan görünürlük**: yeni bağlantıda yalnızca başlangıç veritabanı; şemalarda `pg_catalog`, `information_schema`, `pg_toast` gizli, diğerleri görünür. `pg_database` listesi şablonları içermez.
- **Tembel bağlanma**: bağlanmamış bağlantıda panel kayıtlı seçimi gösterir (hedef seçilebilir, bağlanmadan bilinir) ve "Bağlan ve tüm veritabanlarını listele" düğmesi sunar. Hata panelde mesaj + "Tekrar dene" / "Düzenle". Panel başlığında yenile (⟳) ve bağlantı menüsü (⋯).
- **Bağlantı menüsü** (sağ tık / ⋯): hedef yap, bağlan/yenile, düzenle (form, [Bağlantı formu ve "bağlantıyı test et" akışı](24-baglanti-formu.md)), kopyala, klasöre taşı, URL'yi kopyala (şifresiz), bağlantıyı kes (pool'lar ve tünel kapanır), sil.
- **Kopyala**: hemen yanına "ad (kopya)" oluşturur, sırlar yeni `connectionId` altında keychain'e kopyalanır, form açılır.
- **Sil**: onay penceresi ("ayar ve keychain'deki sırlar silinir, Çalıştırma kayıtları kalır, geri alınamaz"); ad yazdırma yok.
- **Oturumluk şifre** (keychain'e kaydedilmemiş bağlantı, ör. prod): yalnızca ilk bağlanmada sorulur, Tezgah kapanana kadar bellekte kalır; bağlantı düşse, "Bağlantıyı kes" denilse ya da tünel kopsa da yeniden sorulmaz. Yeniden yalnızca Tezgah yeniden başlatılınca ya da sunucu şifreyi reddedince (`28P01`) sorulur (kullanıcı isteği).
- **Cmd/Ctrl+K hızlı geçiş**: tek arama kutusu, gruplu sonuçlar:
  - *Hedefler*: tüm bağlantıların görünür veritabanları `bağlantı / veritabanı` biçiminde, bulanık eşleşme; kayıtlı Veritabanı seçiminden geldiği için bağlanmadan listelenir. prod satırlarında rozet, şu anki hedef işaretli.
  - *Gizli veritabanları*: yalnızca bağlı bağlantılarda ve sorgu varken; seçilince görünür yapılır.
  - *Komutlar*: yeni bağlantı, yeni klasör, içe aktar, çalıştırma kayıtları klasörünü aç.
  - ↵ **mevcut editörün hedefini değiştirir** (ilk dilimde tek editör); Alt+↵ ağaçta gösterir. Commit/rollback bekleyen transaction varken hedef değiştirme kapalı, paletin tepesinde uyarı (ağaçtan hedef seçimi de aynı).
  - **`postgres://` URL yapıştırılınca**: aynı host/port/kullanıcıya giden mevcut bağlantılar "Bu sunucuya giden mevcut bağlantı" grubunda (seçince URL'deki veritabanı hedef olur); ayrıca "URL'den yeni bağlantı…" formu dolu açar (ayrıştırıcı ticket 24'teki saf modül). Geçersiz URL tek satır hata. Ağaca URL yapıştırma yok, giriş noktası palet.
- Kenar çubuğu başlığı: ⌘K, yeni bağlantı, yeni klasör, içe aktar düğmeleri. Script ekranının hedef başlığındaki "hedefi değiştir ▾" paleti açar ([Script çalıştırma ekranının yerleşimi](23-script-ekrani-yerlesimi.md)).

Prototip: atılabilir `prototype/25-baglanti-agaci` dalı, `.scratch/ilk-dilim/prototypes/25-baglanti-agaci-PROTOTYPE.html` (varyantlar `?variant=A|B|C`, `?senaryo=normal|karar`).

Prototip oturumunda (2026-11-03) kararlaştırıldı; varyant, şifre davranışı ve şema çipleri kullanıcıdan, diğer ayrıntılar kullanıcının itiraz etmediği önerilerden.
