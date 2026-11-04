# 09: Script çalıştırma: Transaction modu ve commit/rollback

Spec: [İlk dilim spec'i](../../ilk-dilim/spec.md) · Kararlar: ADR-0002, İfade bölme (wayfinder 05), İletişim (06), SELECT önizleme (09), Script ekranı (23)

**What to build:** Geliştirici editöre bir script yazar ve ▶ Çalıştır'a basar. İfadeler aynı bağlantıda, tek bir transaction içinde sırayla çalışır. Satır işaretleri ve sağ sütundaki ifade kartları canlı güncellenir. Hatada durulur ve hatalı satır tam konumunda işaretlenir. Script bitince karar kartı commit ya da rollback ister; hatadan sonra yalnızca Rollback vardır. SELECT kartları ilk 100 satırı gösterir. Çalışan script iptal edilebilir. Sekme kapanırsa transaction geri alınır.

**Blocked by:** 06

**Status:** ready-for-agent

- [ ] core lexer `--` yorumlarını, iç içe `/* */` yorumlarını, `'…'`, `E'…'`, `$tag$…$tag$`, `"ident"` ve `U&'…'` tanıyor; psql `\` meta komutlarını tanıyıp işaretliyor. İfade başına offset, metin ve ilk anahtar kelimeler çıkıyor. Yazımı bozuk ifade bölmeyi engellemiyor. Tablo tabanlı testler var.
- [ ] core hata konumu: `position` + ifade offset'i → satır/sütun; `position` yoksa ifadenin tamamı işaretleniyor. Birim testli.
- [ ] WebSocket çalıştırıcı pool'dan tek client alıp karara kadar tutuyor; `BEGIN` ile başlıyor. Olaylar: `started`, `done{rowCount, ms, komut, onizleme?}`, `error{sqlstate, mesaj, satir, sutun}`, `kararBekleniyor`, `bitti`. İstemci `commit`, `rollback` ve `iptal` gönderebiliyor. İptal `pg_cancel_backend` ile.
- [ ] Hata sonrası commit sunucuda reddediliyor. WS koparsa açık transaction geri alınıyor (ADR-0002).
- [ ] SELECT için satır sayısı ve en fazla 100 satırlık önizleme dönüyor; 100'den fazlası sunucudan çekilmiyor.
- [ ] Arayüz: CodeMirror 6 editörü yalnızca SQL renklendirmesiyle. Satır numarasının solunda ✓ / ✗ / ● / ○ / – işaretleri, hatalı satırda kırmızı zemin ve dalgalı alt çizgi. Editörün altında ▶ Çalıştır ve çalışırken ■ İptal. Sağ sütun (≈400px): tepede karar kartı, altında Log sekmesi ve ifade kartları (komut etiketi, satır, süre, etkilenen satır ya da SQLSTATE + mesaj, SELECT önizlemesi). Karta tıklayınca editör o satıra gidiyor.
- [ ] Server entegrasyon testleri (gerçek PG) başarı + commit, rollback, hata konumu, hata sonrası commit reddi, iptal ve kopmada rollback olay dizilerini sınıyor. Web testleri sahte WS olaylarından kartları ve işaretleri sınıyor.
