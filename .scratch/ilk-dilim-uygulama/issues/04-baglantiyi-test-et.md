# 04: Bağlantıyı test et

Spec: [İlk dilim spec'i](../../ilk-dilim/spec.md) · Kararlar: Bağlantı formu (wayfinder 24), Sunucu modeli (04), pg sslmode (14)

**What to build:** Geliştirici formda "Bağlantıyı test et"e basar. Formdaki kaydedilmemiş değerlerle adımlar sırayla koşar: sırlar → sunucuya ulaşma → TLS → kimlik doğrulama → veritabanlarını listeleme. İlk hatada durulur. Her adımın sonucu ait olduğu bölümde, tek tık düzeltme düğmeleriyle görünür; başarıda sunucu sürümü ve veritabanı sayısı gösterilir. Hiçbir şey kaydedilmez.

**Blocked by:** 02

**Status:** ready-for-agent

- [ ] Test servisi kaydedilmemiş değerleri alıyor ve adım listesi döndürüyor (`sirlar, ssh, ulasma, tls, kimlik, listeleme`). Her adım `basarili | uyari | hata | calistirilmadi` sonucunu, kodunu (SQLSTATE ya da yapısal), mesajını ve düzeltme önerisi kimliklerini taşıyor. `ssh` adımı tünel yokken atlanıyor.
- [ ] Sırlar adımı yalnızca keychain'den okunacak bir sır varsa koşuyor; "Deny" ile "sır yok" ayrı.
- [ ] Bu ticket'ta TLS yalnızca `disable` ve `prefer` (önce doğrulamasız SSL, yalnızca "server does not support SSL" hatasında bir kez düz bağlantı) destekliyor. `prefer`'de şifresiz düşüş, "require yap" önerisiyle uyarılı başarı oluyor. Diğer modlar ticket 05'te.
- [ ] Kimlik doğrulama başlangıç veritabanına giriş yapıyor (`28P01`, `3D000` vb. mesajlarıyla). Listeleme `pg_database`'i şablonlar hariç sorguluyor ve sürümle birlikte veritabanı sayısını döndürüyor.
- [ ] Formun tepesinde tek satırlık özet var; adım satırları ait oldukları bölümün altında. Hatalı bölüm kendiliğinden açılıyor ve ilgili alan kırmızı oluyor. Düzeltme düğmeleri var (ör. "Port'u düzelt", "postgres kullan", "Tekrar dene").
- [ ] Test hiçbir şey kaydetmiyor (ayar ya da keychain yazımı yok).
- [ ] Server entegrasyon testleri (gerçek PG) başarı, yanlış şifre, olmayan veritabanı ve ulaşılamayan port durumlarını sınıyor. Web testleri sonuçların bölümlere dağılmasını sınıyor.
