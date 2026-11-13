# 11: Çalıştırma modu ve Autocommit

Spec: [İlk dilim spec'i](../../ilk-dilim/spec.md) · Kararlar: Transaction dışı komutlar (wayfinder 15), prod salt okunurluğu (07), ADR-0002 eki, Script ekranı (23)

**What to build:** Editör script'i yazılırken analiz eder ve Çalıştırma modunu (Transaction / Autocommit / Karışık) canlı bir rozetle gösterir. Transaction'ı Tezgah yönettiği için `BEGIN`, `COMMIT`, `ROLLBACK`, `SET … default_transaction_read_only` ve `\` meta komutları reddedilir. Yalnızca transaction dışı komutlardan oluşan script Autocommit modunda ifade ifade ve kalıcı olarak çalışır; kalıcı bir uyarı şeridi bunu söyler. Karışık script çalıştırılamaz.

**Blocked by:** 09

**Status:** done (9c71c3b)

- [x] core script analizi mod, transaction dışı ifadeler ve reddedilen ifadeleri döndürüyor. Desen tablosu spec'teki listenin tamamı; tek başına `ANALYZE` gibi negatif örnekler dahil. Tablo tabanlı testler var.
- [x] Analiz istemcide debounce ile, sunucuda da her çalıştırmada yapılıyor (istemciye güvenilmiyor); `analiz` olayı gönderiliyor.
- [x] Rozet: Transaction / Autocommit (turuncu) / Karışık (kırmızı). Karışık'ta Çalıştır devre dışı, transaction dışı ifadeler turuncu zemin ve ⚠ ile işaretli, "ayrı çalıştır" mesajı var. Reddedilen ifadeler işaretli.
- [x] Autocommit çalıştırıcı: ifadeler sırayla ve her biri kalıcı; hatada durulur; karar kartı yok. Sonuçta "X ifade kalıcı uygulandı · 1 hatalı · Y çalıştırılmadı" özeti. Başlığın altında "N ifade anında kalıcı uygulanır, geri alınamaz" şeridi. Çalıştırma öncesi onay yok.
- [x] Yedek: listede olmayan bir komut `25001` dönerse hatalı satır işaretleniyor ve "bu komut tek başına autocommit olarak çalıştırılmalı" mesajı gösteriliyor.
- [x] Autocommit'te WS koparsa çalışan ifade `pg_cancel_backend` ile iptal ediliyor ve kalanlar çalıştırılmıyor.
- [x] Server testleri (gerçek PG) `VACUUM` ve `CREATE INDEX CONCURRENTLY` script'ini, Karışık reddini ve `25001` yedeğini sınıyor.

## Comments

Uygulama notları (2026-11-05):

- **core** `calistirma-modu.ts`: `analyzeScript(statements)` → `{mod, transactionDisi, reddedilenler}`; `isNonTransactional`, `rejectionOf`, `blockReasons(script, statements)` (sunucu ve arayüz aynı ret metnini gösterir). Lexer'a `words` eklendi (ifadedeki tüm çıplak kelimeler): `DETACH PARTITION … CONCURRENTLY`, `ALTER DATABASE … SET TABLESPACE` ve tablo adsız `CLUSTER` 8 kelimelik `keywords`'ü ve `.`'yı aşıyor. Temkinli taraf: seçenekli `REINDEX (…)`, tırnaklı adlı `CLUSTER "T"` ve tüm `CREATE SUBSCRIPTION`'lar transaction dışı sayılır.
- **Reddedilenler** spec listesine ek olarak: `END`, `ABORT`, `PREPARE TRANSACTION` (transaction'ı bitirir), `RESET default_transaction_read_only` ve `SET SESSION CHARACTERISTICS` (pool'daki client'a sızar). `ROLLBACK TO SAVEPOINT` ve `COMMIT/ROLLBACK PREPARED` reddedilmez.
- **WS sözleşmesi**: her çalıştırmanın ilk olayı `analiz{mod, transactionDisi, reddedilenler}` (spec'te `transactionDisi` yok; arayüz işaretleme için kullanıyor). Reddedilen ifade ya da Karışık script'te sunucu hiçbir yere bağlanmadan `bitti{sonuc: reddedildi, mesaj}` döner. Autocommit sonu `bitti{sonuc: autocommit, ozet{uygulandi, hatali, calistirilmadi}}`; iptal/kopmada `bitti{iptal, ozet}`. İptal edilen ifade "hatalı" sayılır (Postgres 57014 döner). `25001` ipucu `applyEvent`'te `hata.ipucu` olarak eklenir. spec.md'deki WS listesi buna göre güncellenmeli.
- **server**: Autocommit transaction'sız, aynı client'ta sırayla çalışır; ilk hatada durur; karar kartı yok. Kopma/iptal: çalışan ifade `pg_cancel_backend` ile iptal edilir, kalanlar çalışmaz, client pool'a dönmez.
- **web**: analiz 200 ms debounce ile; Çalıştır'a basınca güncel metinle yeniden bakılır. Rozet `title="Çalıştırma modu"` (canlı bölge değil: her tuşta duyuru yapmasın). Karışık'ta transaction dışı ifadeler ⚠ + turuncu zemin; reddedilenler her zaman ⛔ + kırmızımsı zemin; nedenler editörün altında. Başlığın altında "N ifade anında kalıcı uygulanır, geri alınamaz" şeridi. Autocommit'te tarayıcı–sunucu bağlantısı koparsa "geri alındı" yerine "çalışan ifade iptal edildi" denir.
- **Bilinen boşluklar**: (1) GLOSSARY "Çalıştırma modu" iki mod tanımlıyor; spec ve bu ticket Karışık'ı üçüncü değer olarak kullanıyor. `/domain-modeling` ile hizalanmalı. (2) `inAutocommit` ile `inTransaction` client yaşam döngüsü kodunu (hata dinleyicisi, iptal, discard) tekrarlıyor; ortak bir oturum yardımcısına çıkarılabilir. (3) prod salt okunurluğu ticket 13'te.
- **Testler**: gerçek PG testleri (VACUUM + CREATE INDEX CONCURRENTLY, hatada durma ve özet, kopmada iptal, `DISCARD ALL` ile 25001 yedeği, Karışık ve ret) yazıldı ama bu ortamda `TEZGAH_TEST_PG_URL` olmadığından **koşturulamadı**.
