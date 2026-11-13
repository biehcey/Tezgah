# 05: Daha fazla satır

Spec: [İkinci dilim spec'i](../../ikinci-dilim/spec.md) · Kararlar: harita Q6

**What to build:** Sonuç grid'inde aşağı kaydırdıkça 500'er satır daha yüklenir. Bu yalnızca transaction açıkken (karar beklerken ya da Okuma'da) mümkündür; commit/rollback sonrasında yüklenen satırlar kalır, "daha fazla" kapanır ve sonuçta bu belirtilir. 100.000 satırda "Sınıra ulaşıldı, filtrele" mesajı çıkar.

**Blocked by:** 03, 04

**Status:** done (1cdf342)

- [x] server: SELECT ifadeleri ifade başına `WITHOUT HOLD` imleçle çalışıyor (`DECLARE tezgah_sonuc_<i>` + ilk `FETCH`); `MOVE FORWARD ALL` sayımı kaldırıldı, `rowCount` yalnızca imleç sonuna gelindiyse biliniyor.
- [x] Yeni istemci mesajı `dahaFazla{i}` → `FETCH` → `satirlar{i, satirlar, dahaVar, sinir?}`. Transaction kapalıyken (ya da hata almış, ya da script çalışırken) `uyari{tur: 'dahaFazla', i}` dönüyor. 100.000 sınırı sunucuda da uygulanıyor.
- [x] core çalıştırma görünümü `satirlar` olayını ekliyor; transaction kapanınca "daha fazla" kapanıyor ve not ekleniyor; sınırda mesaj.
- [x] web: sona yaklaşınca (son 100 satır) `dahaFazla` isteniyor; yüklenirken çift istek gitmiyor.
- [x] Testler: server'da ilk 500 + sonraki sayfa, commit sonrası ret, sınır (gerçek PG); core görünüm testleri; web'de kaydırmayla istek ve kapanma notu.

## Uygulama notları

- **Kesin `dahaVar`**: her çekişte bir satır fazla istenir, fazlası sunucuda tamponda kalıp sonraki sayfanın başına konur. Böylece tam 500 (ya da tam 100.000) satırlık sonuçta boş bir "daha fazla" sayfası olmaz. `sinir` yalnızca sınıra ulaşılıp devamı da varsa gelir.
- **Çekiş savepoint içinde** (`tezgah_sayfa`): hesaplanırken hata veren bir satır (ör. `1/(g-700)`) kullanıcının transaction'ını bozmaz. Savepoint'e geri sarılır, o sonuç kapanır ("Satırlar çekilemedi: …"); karar beklenirken yazılanlar commit edilebilir kalır, Okuma transaction'ı açık kalır.
- Karar beklenirken transaction hata almışsa (ifade hatası) imleçlerden satır çekilmez; görünüm bunu "Transaction hata aldı; daha fazla satır çekilemez" diye not eder.
- Kartta devamı olan sonucun satır sayısı `500+ satır` diye gösterilir (toplam bilinmiyor).
- **Testler**: sahte Postgres'e imleç taklidiyle `src/server/daha-fazla.test.ts` (sayfalama, ifade başına imleç, karar/commit sonrası ret, çalışırken ret, hatalı transaction, çekiş hatasında savepoint, 100.000 sınırı ve tam sınır). Gerçek PG testleri (`script-calistirici.test.ts` → "daha fazla satır": sonraki sayfa, commit sonrası ret, sınır, çekiş hatasından sonra commit) yazıldı ama `TEZGAH_TEST_PG_URL` olmadığından **koşturulamadı**.
