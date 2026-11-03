# Transaction dışı komutlar ve karışık script

Type: grilling
Status: resolved
Blocked by: —

## Question

Transaction içinde çalışamayan komutlar (`CREATE/DROP INDEX CONCURRENTLY`, `REINDEX ... CONCURRENTLY`, `VACUUM`, `CREATE/DROP DATABASE`, `CREATE/DROP TABLESPACE`, `ALTER SYSTEM`, …) [lexer'ın](05-ifade-bolme.md) ilk anahtar kelimeleriyle nasıl tanınır, kesin liste nedir, ve bunları içeren bir script'te ne yapılır?

Seçenekler: (a) karışık script'i reddet, yalnızca tamamı transaction dışı olan script'e izin ver; (b) script'i segmentlere böl (transaction'lı blok / tek başına autocommit ifade), her segment sınırında commit/rollback onayı al; (c) başka. Ayrıca: hata durumunda daha önce autocommit ile çalışmış ifadelerin geri alınamayacağı kullanıcıya nasıl gösterilir; deneme modunda ve `prod` salt okunur modda bu komutlara ne olur?

## Answer

- **Çalıştırma modu script içeriğinden çıkarılır** (kullanıcı anahtarı yok), editör çubuğunda canlı rozet olarak gösterilir (lexer debounce ile her değişiklikte çalışır):
  - **Transaction**: transaction dışı komut yok; tek transaction, sonda commit/rollback.
  - **Autocommit** (turuncu rozet): script'in *tamamı* transaction dışı komutlardan oluşuyor; ifadeler sırayla, her biri anında kalıcı; hatada durulur; commit/rollback çubuğu yok.
  - **Karışık**: çalıştırılamaz; çalıştır düğmesi devre dışı, transaction dışı ifadeler işaretlenir, "ayrı çalıştır" mesajı. Segmentlere bölme (b) ve yeniden sıralama (c) reddedildi: karmaşık ara durumlar / anlam değişikliği.
- **Tanıma**: `src/core`'da lexer'ın ilk anahtar kelimeleri üzerinde desen tablosu:
  `VACUUM` (tek başına `ANALYZE` hariç); `CREATE/DROP DATABASE`; `CREATE/DROP TABLESPACE`; `ALTER SYSTEM`; `CREATE [UNIQUE] INDEX CONCURRENTLY`; `DROP INDEX CONCURRENTLY`; `REINDEX … CONCURRENTLY`; `REINDEX SCHEMA|DATABASE|SYSTEM`; tablo adsız `CLUSTER`; `ALTER TABLE … DETACH PARTITION … CONCURRENTLY`; `COMMIT PREPARED` / `ROLLBACK PREPARED`; `CREATE/DROP SUBSCRIPTION`; `ALTER DATABASE … SET TABLESPACE`.
  Seçeneğe bağlı durumlar (ör. subscription `create_slot`) temkinli tarafta: her zaman transaction dışı sayılır.
  **Yedek**: listede olmayan komut SQLSTATE `25001` dönerse hatalı satır işaretlenir ve "bu komut tek başına autocommit olarak çalıştırılmalı" mesajı gösterilir.
- **Deneme modu**: transaction dışı komut içeren script deneme modunda çalıştırılmaz (ifadeler işaretlenir); yani autocommit modunda deneme yok. Atlama reddedildi: sonraki ifadeler yanıltıcı sonuç verir.
- **prod**: salt okunur modda transaction dışı komutlar Tezgah tarafında, Postgres'e gitmeden reddedilir. Yazma modunda her çalıştırmada yine bağlantı adı yazdırılır + "bu ifadeler geri alınamaz" uyarısı ve ifade listesi. Teknik: autocommit client'ına `SET default_transaction_read_only = off`; çalıştırma bitince client pool'a dönmez, **yok edilir** (ayar sızmaz).
- **prod dışı onay**: autocommit modunda çalıştırmadan önce tek tıklık onay — "N ifade anında kalıcı olarak uygulanacak, geri alınamaz" + ifade listesi. Hata/iptal sonrası log özeti: "X ifade kalıcı uygulandı · 1 hatalı · Y çalıştırılmadı".
- **Kopma**: autocommit modunda WS koparsa çalışan ifade `pg_cancel_backend` ile iptal edilir, kalanlar çalıştırılmaz. İptal edilen `CREATE INDEX CONCURRENTLY` INVALID index bırakabilir; ayrıca uyarı yok, yalnızca dokümante edilir. Bkz. [ADR-0002](../../../docs/adr/0002-kopmada-rollback.md) eki.
- Sözlüğe eklendi: **Transaction dışı komut**, **Çalıştırma modu**.

Çalışma oturumunda (2026-11-03) kararlaştırıldı.
