# Script çalıştırma WebSocket'e bağlı; kopmada rollback

Script çalıştırma, sonunda commit/rollback kararı için transaction'ı açık tutar. Bu transaction, çalıştırmayı başlatan WebSocket bağlantısına bağlıdır: soket koparsa veya sekme kapanırsa sunucu rollback eder. Böylece sahipsiz kalmış, kilit tutan açık bir transaction (özellikle `prod`'da) asla oluşmaz; bedeli, yanlışlıkla kapanan bir sekmenin bekleyen değişiklikleri kaybetmesidir. "Kopsa da bekle, geri bağlanınca karar ver" alternatifi bu yüzden reddedildi.
