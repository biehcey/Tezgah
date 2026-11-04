# 09: Script çalıştırma: Transaction modu ve commit/rollback

Spec: [İlk dilim spec'i](../../ilk-dilim/spec.md) · Kararlar: ADR-0002, İfade bölme (wayfinder 05), İletişim (06), SELECT önizleme (09), Script ekranı (23)

**What to build:** Geliştirici editöre bir script yazar ve ▶ Çalıştır'a basar. İfadeler aynı bağlantıda, tek bir transaction içinde sırayla çalışır. Satır işaretleri ve sağ sütundaki ifade kartları canlı güncellenir. Hatada durulur ve hatalı satır tam konumunda işaretlenir. Script bitince karar kartı commit ya da rollback ister; hatadan sonra yalnızca Rollback vardır. SELECT kartları ilk 100 satırı gösterir. Çalışan script iptal edilebilir. Sekme kapanırsa transaction geri alınır.

**Blocked by:** 06

**Status:** ready-for-agent

- [x] core lexer `--` yorumlarını, iç içe `/* */` yorumlarını, `'…'`, `E'…'`, `$tag$…$tag$`, `"ident"` ve `U&'…'` tanıyor; psql `\` meta komutlarını tanıyıp işaretliyor. İfade başına offset, metin ve ilk anahtar kelimeler çıkıyor. Yazımı bozuk ifade bölmeyi engellemiyor. Tablo tabanlı testler var.
- [x] core hata konumu: `position` + ifade offset'i → satır/sütun; `position` yoksa ifadenin tamamı işaretleniyor. Birim testli.
- [x] WebSocket çalıştırıcı pool'dan tek client alıp karara kadar tutuyor; `BEGIN` ile başlıyor. Olaylar: `started`, `done{rowCount, ms, komut, onizleme?}`, `error{sqlstate, mesaj, satir, sutun}`, `kararBekleniyor`, `bitti`. İstemci `commit`, `rollback` ve `iptal` gönderebiliyor. İptal `pg_cancel_backend` ile.
- [x] Hata sonrası commit sunucuda reddediliyor. WS koparsa açık transaction geri alınıyor (ADR-0002).
- [x] SELECT için satır sayısı ve en fazla 100 satırlık önizleme dönüyor; 100'den fazlası sunucudan çekilmiyor.
- [x] Arayüz: CodeMirror 6 editörü yalnızca SQL renklendirmesiyle. Satır numarasının solunda ✓ / ✗ / ● / ○ / – işaretleri, hatalı satırda kırmızı zemin ve dalgalı alt çizgi. Editörün altında ▶ Çalıştır ve çalışırken ■ İptal. Sağ sütun (≈400px): tepede karar kartı, altında Log sekmesi ve ifade kartları (komut etiketi, satır, süre, etkilenen satır ya da SQLSTATE + mesaj, SELECT önizlemesi). Karta tıklayınca editör o satıra gidiyor.
- [x] Server entegrasyon testleri (gerçek PG) başarı + commit, rollback, hata konumu, hata sonrası commit reddi, iptal ve kopmada rollback olay dizilerini sınıyor. Web testleri sahte WS olaylarından kartları ve işaretleri sınıyor.

## Comments

Uygulama notları (2026-11-04):

- **core** `ifade-bolme.ts` (`splitStatements`, `positionOf`), `hata-konumu.ts` (`errorLocation`: Postgres `position`'ı kod noktası sayar; "girdinin sonu" son karakteri işaretler), `script-calistirma.ts` (WS mesaj tipleri, `parseClientMessage`, arayüzün `applyEvent` görünümü). Kapanmamış blok yorumu ifadede kalır ki Postgres nedenini söylesin. İfade `start`'ı ilk anlamlı karakterdir; baştaki/sondaki yorumlar ifadeye dahil değil.
- **WS sözleşmesi.** İstemci → `run{target, script}`, `commit`, `rollback`, `iptal`. Sunucu → `started{i}`, `done{i, rowCount, ms, komut, onizleme?}`, `error{i, sqlstate, mesaj, satir, sutun, bas, bit, ms}` (`bas/bit` işaretlenecek betik aralığı), `kararBekleniyor{commitEdilebilir}`, `bitti{sonuc: commit|rollback|iptal|hata, mesaj?}`, `uyari{tur: commitReddedildi|mesgul|gecersizIstek}`. İstemci ifade indekslerini aynı betiği aynı core lexer'la bölerek eşler. Web her çalıştırma için bir WS açar; `bitti`'den önce koparsa "bağlantı koptu" gösterilir. `deneme`/`yazmaModu`/`bitis` alanları ticket 10/13/14'te eklenecek.
- **SELECT önizlemesi.** İlk kelimesi SELECT/VALUES/TABLE/WITH olan ifade `SAVEPOINT` + `DECLARE … NO SCROLL CURSOR` + `FETCH 100` + `MOVE FORWARD ALL` ile çalışır: satır sayısı tamdır, 100'den fazlası aktarılmaz. DECLARE 42/0A sınıfı hatayla düşerse (`SELECT … INTO` → 42601, veri değiştiren WITH → 0A000, yazım hatası) savepoint'e dönülür ve ifade düz çalıştırılır; iptal/kilit hatalarında yeniden çalıştırılmaz. Değerler metin olarak gelir (NULL `null`). Bilinen boşluk: `(SELECT …)` ve `… RETURNING` düz yoldan gider; tüm satırlar çekilir, istemciye 100 gider.
- **İptal** `pg_cancel_backend` ile, aynı hedefin pool'undan ikinci bir client üzerinden. İptal sonrası transaction otomatik geri alınır (`bitti{iptal}`); iptal sinyali geç varıp sonraki sorguyu vurmasın diye client pool'a dönmez, atılır. Client yalnızca COMMIT/ROLLBACK temiz bittiyse pool'a döner. Pool'daki 10 sn'lik `query_timeout` kaldırıldı: script ifadelerine süre yok; katalog sorguları `catalogQuery` ile süreli.
- **Ticket 10 için not:** karar beklenirken client süresiz tutuluyor; pool en fazla 3 client olduğundan aynı hedefte 3 bekleyen çalıştırma iptal ve panel sorgularını bekletir. Karar süresi bunu sınırlayacak.
- **Ticket 11 için not:** lexer meta komutları `meta: true` ile işaretliyor ama çalıştırıcı henüz reddetmiyor. `CREATE FUNCTION … BEGIN ATOMIC … END` gövdeleri iç `;`'lerden bölünüyor (psql 15+ bunu ayırt ediyor); gerekirse lexer'a eklenmeli.
- **Testler:** server entegrasyon testleri (`script-calistirici.test.ts`) gerçek PostgreSQL 18'e karşı koştu. Gerçek PG testleri Tezgah oturumlarını saydığından server projesinde dosyalar artık sıralı koşuyor (`fileParallelism: false`).
