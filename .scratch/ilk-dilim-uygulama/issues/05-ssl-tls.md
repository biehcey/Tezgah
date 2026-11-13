# 05: SSL/TLS ayarları

Spec: [İlk dilim spec'i](../../ilk-dilim/spec.md) · Kararlar: SSL alanları (wayfinder 08), pg sslmode (14), Bağlantı formu (24)

**What to build:** Geliştirici formun katlanır SSL/TLS bölümünde `sslmode` ve CA, istemci sertifikası ve anahtar dosyalarını seçer. Tezgah bağlanırken ve test ederken libpq anlamına uygun davranır. prod bağlantıda `verify-full` önerilir.

**Blocked by:** 04

**Status:** done (19584a9)

- [x] Bağlantı modeline `sslmode` (varsayılan `prefer`) ile CA, sertifika ve anahtar yolları ekleniyor.
- [x] core SSL kurucusu `sslmode`, dosya içerikleri ve gerçek host'tan `pg` `ssl` nesnesini kuruyor: `disable` → `false`; `require` → doğrulamasız (CA varsa `verify-ca` gibi); `verify-ca` → CA zorunlu, host adı kontrolü yok; `verify-full` → `rejectUnauthorized`, `servername` ve `checkServerIdentity(realHost)`. `prefer` yeniden deneme kararı da saf bir fonksiyon. Connection string kullanılmıyor. Her mod için birim testleri var.
- [x] Kurucu, tünelli kullanım için de açık `checkServerIdentity(realHost)` üretiyor (ticket 17 buna dayanıyor).
- [x] Form: bölüm kapalıyken tek satır özet ve durum ikonu. Moda göre açıklama satırı; CA alanı yalnızca `require` ve üstünde. prod ve `verify-full` değilse "verify-full önerilir · Uygula" (kapalı özette ⚠).
- [x] Bağlantıyı test et'in TLS adımı tüm modları kullanıyor; düzeltme düğmeleri "CA dosyası seç" ve "verify-ca dene".
- [x] Ticket 03'te modelde tutulan URL SSL parametreleri artık alanlara bağlanıyor.
- **Dosyalar:** formda yol metin alanları (prototipteki gibi; tarayıcı dosya seçicisi yol vermiyor). Yol tam olmalı ya da `~/` ile başlamalı; sunucu `~/`'i ev dizinine çevirip dosyayı yalnızca test/bağlanma anında okur, içerik hiçbir yere yazılmaz ve web'e dönmez. Sertifika ile anahtar birlikte verilir. Yalnızca modun kullandığı yollar (`sslPathsUsed`: `disable` hiçbiri, `prefer` CA hariç) doğrulanır ve okunur; diğerleri saklanmaya devam eder, mod değişince kaybolmaz.
- **Ayar dosyası** sürüm 2: migration eski bağlantılara `prefer` ve boş yollar ekliyor.
- **TLS hataları:** doğrulanamayan zincir → CA alanı + "CA dosyası seç"; `verify-full`'da host adı uyuşmazlığı → "verify-ca dene" (modu değiştirip yeniden test eder); `verify-ca`'da CA yok → `caGerekli`; okunamayan dosya → ilgili alan (`ENOENT` vb.). "require yap" artık modu değiştiriyor. `sslmodeDesteklenmiyor` kaldırıldı.
- **URL kopyalama** varsayılan `sslmode=prefer`'i ve boş yolları yazmıyor.
- **Bağlanırken:** gerçek bağlantı açma (pool, ticket 06) henüz yok; o da `buildSslOptions` ve `shouldRetryWithoutSsl`'u kullanmalı.
- **Gerçek PG testleri** (`require`, `verify-full`) `TEZGAH_TEST_PG_URL` ile koşar; bu oturumda tanımlı değildi, koşturulmadı.
