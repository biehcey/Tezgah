# İçe aktarma diyaloğunun yerleşimi

Type: prototype
Status: resolved
Blocked by: —

## Question

[İçe aktarma akışı: dataSources.xml ve .pgpass](18-ice-aktarma-akisi.md)'nda belirlenen sütun ve davranışlarla içe aktarma diyaloğu nasıl yerleşir: kaynak listesi (bulunan global JetBrains dizinleri, `.pgpass`), proje yolu girişi, birleşmiş adayların önizleme tablosu (mevcutla çakışanlar, `read-only` → `prod` önerisi, şifre kaynağı), aday başına seçim/atla ve klasör hedefi? İçe aktarılan bağlantı [Bağlantı formu](24-baglanti-formu.md)'na nasıl açılır, içe aktarma sonrası toplu test yapılır mı?

## Answer

**Varyant C: sonuç ağacı önizlemesi, sağda ayrıntı paneli.**

- **Açılış**: kenar çubuğundaki "⇩ İçe aktar" düğmesi ve Ctrl+K "İçe aktar" komutu ([Bağlantı ağacı, klasör etkileşimleri ve Cmd/Ctrl+K hızlı geçiş](25-baglanti-agaci-hizli-gecis.md)). Hiç bağlantı yokken boş listede "İçe aktar…" ve "Yeni bağlantı" düğmeleri. Diyalog açılır açılmaz kaynaklar taranır; ayrı bir "kaynak seç" adımı yok.
- **Kaynak şeridi** (üstte çipler): bulunan her global JetBrains kaynağı (ürün/sürüm) ve `.pgpass` birer çip, yanında aday sayısı. Tıklayınca açılır/kapanır, önizleme anında değişir. Okunamayan kaynak kırmızı ⚠ çip olur, hata mesajı üzerine gelince görünür, diğer kaynakları engellemez. "＋ Proje klasörü…" bir yol satırı açar (proje kökü ya da `.idea`, Tara ya da Enter); bulunamazsa çip hatalı olarak eklenir.
- **Sol taraf, sonuç ağacı**: başlık "Bağlantı listesi içe aktarmadan sonra böyle görünecek". Ticket 25'teki listeyle aynı bölümler (klasörler + Klasörsüz). Mevcut bağlantılar gri, "mevcut" etiketli; gelen adaylar yeşil zeminli, onay kutulu, "yeni"/"atlanacak" rozetli, düşecekleri klasörde. Henüz olmayan klasör "yeni klasör" rozetli. **Zaten var** olan aday eşleştiği mevcut bağlantının hemen altında, varsayılan seçili değil; işaretlenirse yinelenir ve "ad (2)" olur. Satırda ortam rengi, `kullanıcı@host`, tünel ⇄, şifre 🔑 (`.pgpass`'tan) ve uyarı sayısı ⚠N. prod adaylarında kırmızı sol şerit. Postgres dışı sürücüler en altta gri "Atlandı" bölümünde.
- **Sağ taraf, ayrıntı paneli**: soldan seçilen adayın ad (düzenlenebilir), içe aktar/yinele kutusu, klasör seçimi ("yeni klasör…" dahil), ortam etiketi (`read-only` kaynaklı `prod` önerisi gerekçesiyle), sunucu, şifre kaynağı (`.pgpass` satırı / "yok, ilk bağlanmada sorulur"), SSL, SSH, veritabanları (başlangıç işaretli), birleşen kaynaklar ve uyarıların tam metni. Toplu atama yok; düzenleme satır satır.
- **Bağlantı formu önizlemede açılmaz**: SSL ayrıntısı, SSH kimliği gibi ayrıntılar içe aktarmadan sonra [Bağlantı formu](24-baglanti-formu.md)'ndan düzenlenir. Sonuç penceresinde her satırda "Formda aç", tıklayınca diyalog kapanır ve form açılır.
- **Alt çubuk**: "İçe aktardıktan sonra test et" kutusu (varsayılan kapalı), "N yeni bağlantı", `İptal` / `İçe aktar`.
- **Sonuç penceresi**: "N eklendi, M atlandı"; keychain'e yazılamayan şifreler için "şifre kaydedilemedi: <ad>, …, ilk bağlanmada sorulur" ([İçe aktarma akışı](18-ice-aktarma-akisi.md)); yeni bağlantılar listesi (ad, klasör, test sonucu, "Formda aç"). Yeni bağlantılar listede bir sonraki içe aktarmaya kadar "yeni" rozetiyle görünür.
- **Toplu test** (kutu işaretliyse): içe aktarılan bağlantılar sırayla, kayıtlı değerlerle, formdaki 6 adımlık testle sınanır; sonuç hem sonuç penceresinde hem listede durum ikonu olarak (● / ⚠) görünür. Etkileşim isteyen hiçbir şey sorulmaz: bilinmeyen SSH host anahtarı "onay gerekli" uyarısıyla, şifresiz bağlantı "şifre yok, test atlandı" ile kalır; ikisi de formdan ya da ilk bağlanmada çözülür.
- **İç içe IntelliJ grupları** ([İçe aktarma akışı](18-ice-aktarma-akisi.md)'ndaki `/` ile bölme kararının yerine geçer; ticket 25'te klasörler tek düzey): `group` tam yol adıyla **tek bir klasör** olur (`Billing/Prod`), adayda "iç içe grup tek düzey klasöre" uyarısı; mevcut klasörle tam ad eşleşmesiyle birleşir.

Prototip: atılabilir `prototype/26-ice-aktarma-diyalogu` dalı, `.scratch/ilk-dilim/prototypes/26-ice-aktarma-diyalogu-PROTOTYPE.html` (varyantlar `?variant=A|B|C`, `?senaryo=normal|bos|keychain`).

Prototip oturumunda (2026-11-03) kararlaştırıldı. Varyantı kullanıcı seçti. Toplu test kutusu, formun yalnızca içe aktarmadan sonra açılması ve iç içe grupların tam yol adlı tek klasör olması C'nin prototipteki hâlinden geliyor; kullanıcı bunlara itiraz etmedi.
