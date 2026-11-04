# 11: Çalıştırma modu ve Autocommit

Spec: [İlk dilim spec'i](../../ilk-dilim/spec.md) · Kararlar: Transaction dışı komutlar (wayfinder 15), prod salt okunurluğu (07), ADR-0002 eki, Script ekranı (23)

**What to build:** Editör script'i yazılırken analiz eder ve Çalıştırma modunu (Transaction / Autocommit / Karışık) canlı bir rozetle gösterir. Transaction'ı Tezgah yönettiği için `BEGIN`, `COMMIT`, `ROLLBACK`, `SET … default_transaction_read_only` ve `\` meta komutları reddedilir. Yalnızca transaction dışı komutlardan oluşan script Autocommit modunda ifade ifade ve kalıcı olarak çalışır; kalıcı bir uyarı şeridi bunu söyler. Karışık script çalıştırılamaz.

**Blocked by:** 09

**Status:** ready-for-agent

- [ ] core script analizi mod, transaction dışı ifadeler ve reddedilen ifadeleri döndürüyor. Desen tablosu spec'teki listenin tamamı; tek başına `ANALYZE` gibi negatif örnekler dahil. Tablo tabanlı testler var.
- [ ] Analiz istemcide debounce ile, sunucuda da her çalıştırmada yapılıyor (istemciye güvenilmiyor); `analiz` olayı gönderiliyor.
- [ ] Rozet: Transaction / Autocommit (turuncu) / Karışık (kırmızı). Karışık'ta Çalıştır devre dışı, transaction dışı ifadeler turuncu zemin ve ⚠ ile işaretli, "ayrı çalıştır" mesajı var. Reddedilen ifadeler işaretli.
- [ ] Autocommit çalıştırıcı: ifadeler sırayla ve her biri kalıcı; hatada durulur; karar kartı yok. Sonuçta "X ifade kalıcı uygulandı · 1 hatalı · Y çalıştırılmadı" özeti. Başlığın altında "N ifade anında kalıcı uygulanır, geri alınamaz" şeridi. Çalıştırma öncesi onay yok.
- [ ] Yedek: listede olmayan bir komut `25001` dönerse hatalı satır işaretleniyor ve "bu komut tek başına autocommit olarak çalıştırılmalı" mesajı gösteriliyor.
- [ ] Autocommit'te WS koparsa çalışan ifade `pg_cancel_backend` ile iptal ediliyor ve kalanlar çalıştırılmıyor.
- [ ] Server testleri (gerçek PG) `VACUUM` ve `CREATE INDEX CONCURRENTLY` script'ini, Karışık reddini ve `25001` yedeğini sınıyor.
