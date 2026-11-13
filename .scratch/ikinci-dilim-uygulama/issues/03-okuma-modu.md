# 03: Okuma modu

Spec: [İkinci dilim spec'i](../../ikinci-dilim/spec.md) · Kararlar: ADR-0004, harita Q5

**What to build:** Yalnızca okuyan script'ler karar kartı açmadan çalışır. Rozet "Okuma" der; script ortam etiketinden bağımsız `BEGIN READ ONLY` ile çalışır. Transaction yalnızca sonuçtan daha fazla satır çekilebilsin diye açık kalır; yeniden çalıştırma, sekme kapama, soket kopması ya da Karar süresinin dolmasıyla rollback olur. Desen yanılıp Postgres `25006` döndürürse hatanın yanında "Transaction modunda çalıştır" düğmesi çıkar.

**Blocked by:** None (can start immediately)

**Status:** done (bdb9ff8)

- [x] core Çalıştırma modu `okuma`: tüm ifadeler `SELECT`, `TABLE`, `VALUES`, `SHOW`, ANALYZE'sız `EXPLAIN` ya da DML'siz `WITH`. `SELECT … INTO`, `FOR UPDATE/SHARE`, okuma + yazma karışımı ve boş script Okuma değil. Tablo tabanlı birim testleri.
- [x] server: Okuma'da `BEGIN READ ONLY` + `SET LOCAL idle_in_transaction_session_timeout`; son ifadeden sonra `okumaAcik{kalanMs}` olayı ve Karar süresi zamanlayıcısı; süre dolunca, yeni `run`'da ve soket kapanınca rollback. Sunucu analizi istemciye güvenmiyor.
- [x] `run` mesajında `zorlaTransaction`: Okuma çıkan script'i Transaction modunda çalıştırıyor (yalnızca bu yönde etkili).
- [x] `25006` hatasında "Transaction modunda çalıştır" düğmesi; tıklayınca `zorlaTransaction` ile yeniden çalıştırıyor.
- [x] Okuma'da karar kartı yok, yerinde ince bir durum satırı (transaction açık, kalan süre). Okuma script'inde "Dene" devre dışı.
- [x] Çalıştırma kaydı sonuç değeri `okuma` (sürüm `v` değişmiyor).
- [x] Testler: server'da olay dizisi, üç rollback yolu (sahte saat), 25006 + `zorlaTransaction` (gerçek PG); web'de rozet, kartın çıkmaması, düğme.

**Notlar (uygulama):**

- **Testler**: core desen tablosu, sözleşme ve engel testleri; sunucuda `src/server/okuma-modu.test.ts` (sahte PG + sahte saat: olay dizisi, Karar süresi / yeni `run` / soket kapanması / bağlantı kopması ile rollback, hatada hemen rollback, `zorlaTransaction`). Gerçek PG testleri (`READ ONLY`, 25006 + `zorlaTransaction`, kopmada rollback) yazıldı ama `TEZGAH_TEST_PG_URL` olmadığından **koşturulamadı**.
- Salt SELECT/SHOW ile "karar bekleyen transaction" kuran eski testler yazan bir ifadeye (`UPDATE t SET a = 1`, `SET LOCAL …`) çevrildi; aksi hâlde Okuma'ya düşüyorlardı.
- Okuma'da hata alan transaction hemen geri alınır (satır çekilemez); `bitti.sonuc` `okuma`, kayıt `hata`. Sunucu Okuma script'inde Denemeyi de reddeder.
- Bilinen sınırlar: arayüz her çalıştırmada yeni soket açtığından yeniden çalıştırmada eski Okuma'nın geri alınması (soket kapanması) ile yeni oturumun alınması yarışır; hedef 5 oturumdayken anlık `havuzDolu` görülebilir. Zorlanmış çalıştırma sürerken editör rozeti "Okuma" kalır (karar kartı sunucunun bildirdiği Transaction moduna göre çıkar).
