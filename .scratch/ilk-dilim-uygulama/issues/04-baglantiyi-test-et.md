# 04: Bağlantıyı test et

Spec: [İlk dilim spec'i](../../ilk-dilim/spec.md) · Kararlar: Bağlantı formu (wayfinder 24), Sunucu modeli (04), pg sslmode (14)

**What to build:** Geliştirici formda "Bağlantıyı test et"e basar. Formdaki kaydedilmemiş değerlerle adımlar sırayla koşar: sırlar → sunucuya ulaşma → TLS → kimlik doğrulama → veritabanlarını listeleme. İlk hatada durulur. Her adımın sonucu ait olduğu bölümde, tek tık düzeltme düğmeleriyle görünür; başarıda sunucu sürümü ve veritabanı sayısı gösterilir. Hiçbir şey kaydedilmez.

**Blocked by:** 02

**Status:** ready-for-agent

- [x] Test servisi kaydedilmemiş değerleri alıyor ve adım listesi döndürüyor (`sirlar, ssh, ulasma, tls, kimlik, listeleme`). Her adım `basarili | uyari | hata | calistirilmadi` sonucunu, kodunu (SQLSTATE ya da yapısal), mesajını ve düzeltme önerisi kimliklerini taşıyor. `ssh` adımı tünel yokken atlanıyor.
- [x] Sırlar adımı yalnızca keychain'den okunacak bir sır varsa koşuyor; "Deny" ile "sır yok" ayrı.
- [x] Bu ticket'ta TLS yalnızca `disable` ve `prefer` (önce doğrulamasız SSL, yalnızca "server does not support SSL" hatasında bir kez düz bağlantı) destekliyor. `prefer`'de şifresiz düşüş, "require yap" önerisiyle uyarılı başarı oluyor. Diğer modlar ticket 05'te.
- [x] Kimlik doğrulama başlangıç veritabanına giriş yapıyor (`28P01`, `3D000` vb. mesajlarıyla). Listeleme `pg_database`'i şablonlar hariç sorguluyor ve sürümle birlikte veritabanı sayısını döndürüyor.
- [x] Formun tepesinde tek satırlık özet var; adım satırları ait oldukları bölümün altında. Hatalı bölüm kendiliğinden açılıyor ve ilgili alan kırmızı oluyor. Düzeltme düğmeleri var (ör. "Port'u düzelt", "postgres kullan", "Tekrar dene").
- [x] Test hiçbir şey kaydetmiyor (ayar ya da keychain yazımı yok).
- [x] Server entegrasyon testleri (gerçek PG) başarı, yanlış şifre, olmayan veritabanı ve ulaşılamayan port durumlarını sınıyor. Web testleri sonuçların bölümlere dağılmasını sınıyor.

## Comments

Uygulama notları (2026-11-04):

- **Uç.** `POST /api/baglanti-testi`; gövde formdaki kaydedilmemiş değerler (`connectionId`, host, port, kullanıcı, veritabanı, `password?`, `savePassword`, `sslmode`). Kaydet'teki gibi: şifre verilmezse ve bağlantı kayıtlı + "Keychain'e kaydet" açıksa şifre keychain'den okunur. Yanıt `{ adimlar, sunucu }`; ayar ya da keychain yazımı yok.
- **Uygulanmayan adımlar listede yok.** `ssh` (tünel ticket 17'de) ve keychain okunmuyorsa `sirlar`. Keychain'de sır yoksa `sirlar` uyarıyla geçer (`sirYok`) ve şifresiz denenir; "Deny" hata (`reddedildi`) ve test durur.
- **Saf mantık** `src/core/baglanti-testi.ts`'te: girdi ayrıştırma, hata → adım/alan/öneri eşlemesi, `prefer` yeniden deneme kararı, adım planı, `TestRun` (kalanları "çalıştırılmadı" yapar), TLS sonucu. `src/server/baglanti-testi.ts` yalnızca TCP yoklaması, `pg` bağlantısı ve sorgu.
- **Ulaşma ayrı bir TCP yoklaması**; sonra `pg` bağlanır. Sunucu yanıt vermeden gelen bağlanma hatası SSL denendiyse TLS adımına, düz bağlantıda kimlik adımına yazılır.
- **Şifre `pg`'ye fonksiyon olarak veriliyor**; yalnızca sunucu isterse çağrılır ve şifre yoksa yapısal `sifreGerekli` döner. Böylece `pg` `.pgpass`'a bakmaz.
- **TLS:** `sslmode` modelde henüz yok (ticket 05); test URL'den gelen `sslmode`'u (yoksa `prefer`) kullanır. `disable`/`prefer` dışındaki modlar TLS adımında `sslmodeDesteklenmiyor` hatası verir. Formda geçici, katlanır bir SSL/TLS bölümü var (mod özeti ve TLS satırı); ticket 05 bunu gerçek alanlarla değiştirmeli ve "require yap" düğmesini bağlamalı. Sunucu `requireYap` önerisini zaten döndürüyor; formun uygulayamadığı öneriler gizleniyor, mesaj metni öneriyi söylüyor.
- **Düzeltme düğmeleri:** "Tekrar dene", "postgres kullan" (değiştirip yeniden test eder), "Host'u/Port'u/Kullanıcıyı/Veritabanını/Şifreyi düzelt" ve "Şifre gir" (alana odaklanır). Şifre düğmeleri "Keychain'e kaydet" kapalıyken gizli (oturumluk şifre ticket 07'de).
- **Gerçek PG testleri** `TEZGAH_TEST_PG_URL` ile koşuyor; yerelde SSL'siz gömülü Postgres 17'ye karşı geçti. `prefer` testi sunucunun SSL desteğine göre başarı ya da uyarılı düşüş bekliyor.
- **GLOSSARY:** "Bağlantı testi" terimi eklendi; Deneme modundan ayrımı tanımda.
- **Adım kodları** tipli: Tezgah'ın kendi kodları `TestCode` birliğinde (`TEST_CODES`); SQLSTATE ve Node kodları markalı `ExternalCode` olarak geçer. Yazım hatalı bir iç kod derleme hatası verir.
