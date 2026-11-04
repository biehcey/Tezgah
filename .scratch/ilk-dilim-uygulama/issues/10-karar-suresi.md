# 10: Karar süresi

Spec: [İlk dilim spec'i](../../ilk-dilim/spec.md) · Kararlar: Commit bekleme zaman aşımı (wayfinder 21), Bağlantı ağacı (25)

**What to build:** Script bittikten sonra commit/rollback kararı süreyle sınırlıdır: prod'da 5 dk, diğerlerinde 30 dk. Son dakikada geri sayım görünür ve "Uzat" ile süre baştan başlar. Süre dolunca transaction geri alınır ve geç gelen commit reddedilir. Dizüstü uykuya geçse bile uzak sunucuda transaction açık kalmaz. Karar beklenirken hedef değiştirilemez.

**Blocked by:** 08, 09

**Status:** ready-for-agent

- [ ] core Karar süresi durum makinesi (enjekte zaman) `başlat`, `uzat`, `tik` ve `commit isteği` olaylarına göre kalan süreyi, geri sayım evresini ve "süre doldu" kararını üretiyor. Birim testli.
- [ ] Sunucu zamanlayıcısı yetkili. `BEGIN`'den hemen sonra `SET LOCAL idle_in_transaction_session_timeout` = süre + 1 dk. "Uzat" `SELECT 1` gönderiyor ve süreyi sıfırlıyor. Süre dolunca rollback yapılıyor ve "Süre doldu; transaction geri alındı" mesajı gösteriliyor, log korunuyor. Sonradan gelen commit reddediliyor.
- [ ] Uyanınca client'ın öldüğü görülürse pool onu atıyor ve "Oturum sunucuda zaman aşımına uğradı; transaction geri alındı" mesajı gösteriliyor.
- [ ] Karar kartında son 1 dakikada geri sayım ve "Uzat" var; süre dolunca düğmeler devre dışı.
- [ ] Karar beklenirken Veritabanı panelinden ve paletten hedef değiştirmek kapalı; paletin tepesinde uyarı var.
- [ ] Server testleri sahte saatle süre dolmasını, uzatmayı ve geç commit reddini sınıyor.

## Comments

Hedef kilidi için uygulama yönü (ticket 08'den, 2026-11-04):

- Kural core'da saf bir fonksiyon olsun (ör. `canChangeTarget(çalıştırmaDurumu)`) ve birim testiyle sınansın.
- Hedef her yerden (Veritabanı paneli, bağlantı menüsündeki "Hedef yap", palet) `App.chooseTarget` üzerinden değişiyor; kilit orada uygulanırsa hepsi birlikte kilitlenir.
- Palette *Hedefler*, *Gizli veritabanları* ve *Bu sunucuya giden mevcut bağlantı* grupları pasif olsun (`HizliGecis` `PaletteCommand.disabled` gibi pasif satırları zaten gezinmede atlıyor); tepede neden yazsın ("Commit/rollback kararı bekleniyor"). *Komutlar* ve Alt+Enter (listede göster) çalışmaya devam etsin.
- Web testi: karar beklerken palette hedef satırları pasif, uyarı görünür, Enter hedefi değiştirmez; panelde tıklama da değiştirmez.
