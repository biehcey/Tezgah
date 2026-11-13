# 10: Karar süresi

Spec: [İlk dilim spec'i](../../ilk-dilim/spec.md) · Kararlar: Commit bekleme zaman aşımı (wayfinder 21), Bağlantı ağacı (25)

**What to build:** Script bittikten sonra commit/rollback kararı süreyle sınırlıdır: prod'da 5 dk, diğerlerinde 30 dk. Son dakikada geri sayım görünür ve "Uzat" ile süre baştan başlar. Süre dolunca transaction geri alınır ve geç gelen commit reddedilir. Dizüstü uykuya geçse bile uzak sunucuda transaction açık kalmaz. Karar beklenirken hedef değiştirilemez.

**Blocked by:** 08, 09

**Status:** done (5e13a08)

- [x] core Karar süresi durum makinesi (enjekte zaman) `başlat`, `uzat`, `tik` ve `commit isteği` olaylarına göre kalan süreyi, geri sayım evresini ve "süre doldu" kararını üretiyor. Birim testli.
- [x] Sunucu zamanlayıcısı yetkili. `BEGIN`'den hemen sonra `SET LOCAL idle_in_transaction_session_timeout` = süre + 1 dk. "Uzat" `SELECT 1` gönderiyor ve süreyi sıfırlıyor. Süre dolunca rollback yapılıyor ve "Süre doldu; transaction geri alındı" mesajı gösteriliyor, log korunuyor. Sonradan gelen commit reddediliyor.
- [x] Uyanınca client'ın öldüğü görülürse pool onu atıyor ve "Oturum sunucuda zaman aşımına uğradı; transaction geri alındı" mesajı gösteriliyor.
- [x] Karar kartında son 1 dakikada geri sayım ve "Uzat" var; süre dolunca düğmeler devre dışı.
- [x] Karar beklenirken Veritabanı panelinden ve paletten hedef değiştirmek kapalı; paletin tepesinde uyarı var.
- [x] Server testleri sahte saatle süre dolmasını, uzatmayı ve geç commit reddini sınıyor.

## Comments

Hedef kilidi için uygulama yönü (ticket 08'den, 2026-11-04):

- Kural core'da saf bir fonksiyon olsun (ör. `canChangeTarget(çalıştırmaDurumu)`) ve birim testiyle sınansın.
- Hedef her yerden (Veritabanı paneli, bağlantı menüsündeki "Hedef yap", palet) `App.chooseTarget` üzerinden değişiyor; kilit orada uygulanırsa hepsi birlikte kilitlenir.
- Palette *Hedefler*, *Gizli veritabanları* ve *Bu sunucuya giden mevcut bağlantı* grupları pasif olsun (`HizliGecis` `PaletteCommand.disabled` gibi pasif satırları zaten gezinmede atlıyor); tepede neden yazsın ("Commit/rollback kararı bekleniyor"). *Komutlar* ve Alt+Enter (listede göster) çalışmaya devam etsin.
- Web testi: karar beklerken palette hedef satırları pasif, uyarı görünür, Enter hedefi değiştirmez; panelde tıklama da değiştirmez.

Uygulama notları (2026-11-05):

- **core** `karar-suresi.ts`: `decisionDurationMs` (prod 5 dk, diğerleri 30 dk), `serverIdleTimeoutMs` (+1 dk), `startDecision` (başlat), `extendDecision` (uzat; süre dolduysa `null`), `decisionStatus` (tik: `kalanMs`, evre `bekliyor | geriSayim | doldu`), `commitRequest` (commit isteği; bitiş anı dahil red), `formatRemaining` (`m:ss`). Hedef kilidi `script-calistirma.ts`'te `targetLock(runView)`: nedeni ya da `null`.
- **WS sözleşmesi** spec'teki `kararBekleniyor{bitis}` + `geriSayim` yerine: `kararBekleniyor{commitEdilebilir, kalanMs}` ve "Uzat"ın yanıtı `uzatildi{kalanMs}`; istemci → `uzat`. Mutlak `bitis` yerine kalan süre gider; arayüz geri sayımı olayın geldiği andan yerel saatle kurar (iki saatin farkı önemsizleşir; ağ gecikmesi kadar geride kalır). Yetkili sayaç sunucudadır. `bitti.sonuc`'a `sureDoldu` eklendi. spec.md'deki WS listesi buna göre güncellenmeli.
- **server**: `BEGIN`'den sonra `SET LOCAL idle_in_transaction_session_timeout` = süre + 1 dk. Zamanlayıcı enjekte `Clock` ile (`now()` eklendi; sahte saatte `jump` uykuyu taklit eder: zaman ilerler, zamanlayıcı çalışmaz). Her karar isteği sunucu saatiyle ayrıca sınanır; zamanlayıcı geç kalsa da süresi geçen commit/uzat reddedilir ve transaction geri alınır. "Uzat" süreyi isteğin geldiği andan yeniden başlatır, sonra `SELECT 1` gönderir (hatadan sonraki `25P02` yok sayılır; başka hata client'ın öldüğü sayılır). Karar beklenirken client ölürse karar beklenmez: `bitti{hata}` hemen gider, client atılır; neden `25P03` ise "Oturum sunucuda zaman aşımına uğradı; transaction geri alındı".
- **web**: karar kartında son 1 dakikada `role="timer"` geri sayım ve "Uzat"; yerel süre dolunca düğmeler kapalı ("geri alınıyor…"), sunucunun `bitti{sureDoldu}`'si gelince mesaj; log kalır.
- **Hedef kilidi** yalnızca karar beklenirken değil, script çalışırken de geçerli ("Script çalışıyor"): açık transaction'ın hedefi `BEGIN`'den itibaren başlıktakiyle aynı kalmalı. Kilit `App.chooseTarget`'ta; panel satırları `aria-disabled` (odaklanabilir kalır, Alt+Enter gösterebilsin), bağlantı menüsünde "Hedef yap" pasif, palette hedef satırları pasif ama gezinilebilir (Enter/tıklama seçmez, Alt+Enter gösterir), tepede neden yazar; Komutlar çalışır.
- **Bilinen boşluklar**: (1) Karar beklenirken bağlantı formu açılırsa (palette "Yeni bağlantı", "Düzenle") script ekranı kapanır ve transaction ADR-0002 gereği geri alınır; uyarı yok. (2) Glossary'de Postgres'in yedek `idle_in_transaction_session_timeout`'u için terim yok; testlerde ve mesajda "zaman aşımı" geçiyor (mesaj wayfinder 21'deki metin). `/domain-modeling` ile ele alınmalı. (3) Dizüstü uyanınca hiçbir istek gelmezse Node zamanlayıcısı geç çalışabilir; transaction en fazla Postgres'in +1 dk'lık yedeğine kadar açık kalır.
- **Testler**: server testleri gerçek PostgreSQL 17'ye karşı koştu (sahte saatle dolma, uzatma, hata sonrası uzatma, geç commit, uyku, Postgres tarafı zaman aşımı, prod 5 dk).
