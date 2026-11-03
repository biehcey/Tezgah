# Çalıştırma geçmişi ve denetim kaydı

Type: grilling
Status: resolved
Blocked by: —

## Question

İlk dilimde çalıştırılan script'lerin kaydı tutulur mu? Tutulursa: ne kaydedilir (script metni, hedef, çalıştırma modu, ifade başına sonuç, commit/rollback/deneme sonucu, süre), nerede saklanır ([Bağlantı ayarlarının saklanması](03-ayar-saklama.md)'ndaki yapılandırma dizini mi, ayrı dosya mı), ne kadar tutulur, arayüzde görüntülenir mi yoksa yalnızca dosya mı? `prod` hedefindeki commit'ler için ayrıca bir denetim kaydı gerekir mi?

## Answer

- **Tutulur**: her çalıştırma için bir **Çalıştırma kaydı**; deneme modu, hatalı ve iptal edilen çalıştırmalar dahil. prod için ayrı denetim kaydı yok; tek kullanıcılı araçta denetim kaydı = Çalıştırma kaydı.
- **İçerik**: tam script metni; hedef anlık kopyası (bağlantı `id`, o anki bağlantı adı, veritabanı, ortam etiketi); çalıştırma modu (Transaction / Autocommit) ve deneme mi; prod yazma kilidi açık mıydı; başlangıç/bitiş zamanı; sonuç (`commit`, `rollback`, `deneme-rollback`, `karar-suresi-doldu`, `kopma-rollback`, `hata`, `iptal`); ifade başına özet (başlangıç offset'i, süre, komut etiketi, etkilenen satır sayısı, hata kodu/mesajı/satırı).
- **Satır verisi asla yazılmaz**: SELECT önizlemesi ve deneme modu önce/sonra farkı kayda girmez.
- **Yer ve biçim**: yapılandırma dizininde `history/` altında aylık JSON Lines (`2026-11.jsonl`), satır başına `v` sürüm alanı. `tezgah.json`'a dokunulmaz; SQLite yok (native bağımlılık, npx kaygısı).
- **Yazma zamanı**: aynı `runId` ile iki satır: başlarken `başladı` (script, hedef, mod), bitişte `bitti` (sonuç + ifade özetleri). `bitti` satırı olmayan kaydın sonucu "bilinmiyor".
- **Yazma hatası**: çalıştırmayı engellemez; "Çalıştırma kaydı yazılamadı" uyarısı gösterilir, devam edilir.
- **Saklama**: süresiz, otomatik silme yok; aylık dosyalar elle silinebilir. Saklama ayarı sonraki iyileştirme.
- **Sırlar**: script metni maskelenmez (sezgisel maskeleme yanlış güven verir). `history/` düz metin ve kişisel olduğu belgelenir; dosyalar POSIX'te `0600` ile oluşturulur, Windows'ta `%APPDATA%` kullanıcıya özel.
- **Bağlantı silinince**: kayıtlar silinmez, değişmez kalır; ad ve etiket anlık kopya olduğundan okunabilir.
- **Arayüz**: ilk dilimde göz atma listesi yok; script ekranında yalnızca "Çalıştırma kayıtları klasörünü aç" bağlantısı. Göz atma arayüzü aynı biçimi okuyarak konsol diliminde.

Grilling oturumunda (2026-11-03) kararlaştırıldı.
