# 05: SSL/TLS ayarları

Spec: [İlk dilim spec'i](../../ilk-dilim/spec.md) · Kararlar: SSL alanları (wayfinder 08), pg sslmode (14), Bağlantı formu (24)

**What to build:** Geliştirici formun katlanır SSL/TLS bölümünde `sslmode` ve CA, istemci sertifikası ve anahtar dosyalarını seçer. Tezgah bağlanırken ve test ederken libpq anlamına uygun davranır. prod bağlantıda `verify-full` önerilir.

**Blocked by:** 04

**Status:** ready-for-agent

- [ ] Bağlantı modeline `sslmode` (varsayılan `prefer`) ile CA, sertifika ve anahtar yolları ekleniyor.
- [ ] core SSL kurucusu `sslmode`, dosya içerikleri ve gerçek host'tan `pg` `ssl` nesnesini kuruyor: `disable` → `false`; `require` → doğrulamasız (CA varsa `verify-ca` gibi); `verify-ca` → CA zorunlu, host adı kontrolü yok; `verify-full` → `rejectUnauthorized`, `servername` ve `checkServerIdentity(realHost)`. `prefer` yeniden deneme kararı da saf bir fonksiyon. Connection string kullanılmıyor. Her mod için birim testleri var.
- [ ] Kurucu, tünelli kullanım için de açık `checkServerIdentity(realHost)` üretiyor (ticket 17 buna dayanıyor).
- [ ] Form: bölüm kapalıyken tek satır özet ve durum ikonu. Moda göre açıklama satırı; CA alanı yalnızca `require` ve üstünde. prod ve `verify-full` değilse "verify-full önerilir · Uygula" (kapalı özette ⚠).
- [ ] Bağlantıyı test et'in TLS adımı tüm modları kullanıyor; düzeltme düğmeleri "CA dosyası seç" ve "verify-ca dene".
- [ ] Ticket 03'te modelde tutulan URL SSL parametreleri artık alanlara bağlanıyor.
