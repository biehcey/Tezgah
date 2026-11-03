# Script çalıştırma WebSocket'e bağlı; kopmada rollback

Script çalıştırma, sonunda commit/rollback kararı için transaction'ı açık tutar. Bu transaction, çalıştırmayı başlatan WebSocket bağlantısına bağlıdır: soket koparsa veya sekme kapanırsa sunucu rollback eder. Böylece sahipsiz kalmış, kilit tutan açık bir transaction (özellikle `prod`'da) asla oluşmaz; bedeli, yanlışlıkla kapanan bir sekmenin bekleyen değişiklikleri kaybetmesidir. "Kopsa da bekle, geri bağlanınca karar ver" alternatifi bu yüzden reddedildi.

## Ek: autocommit modu (2026-11-03)

Autocommit çalıştırma modunda (yalnızca transaction dışı komutlardan oluşan script) geri alınacak transaction yoktur. Kopmada çalışan ifade `pg_cancel_backend` ile iptal edilir ve kalan ifadeler çalıştırılmaz. Bedel: iptal edilen bir `CREATE INDEX CONCURRENTLY` geride INVALID bir index bırakabilir; Tezgah bunu ayrıca uyarmaz. "Çalışan ifade bitsin, yalnızca kalanlar dursun" alternatifi, sekmeyi kapatan kullanıcının haberi olmadan uzun bir işlemi sürdüreceği için reddedildi.
