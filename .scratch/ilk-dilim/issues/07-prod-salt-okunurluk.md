# prod salt okunurluğu ve onay akışı

Type: grilling
Status: resolved
Blocked by: —

## Question

`prod` etiketli bağlantılarda salt okunurluk nasıl uygulanır ve yazma için onay akışı nasıldır?

## Answer

- Katman 1 (Postgres): `prod` hedefinin pool'unda `options: -c default_transaction_read_only=on`; script `BEGIN READ ONLY` ile başlar. Yazmayı Postgres reddeder.
- Katman 2 (arayüz): "yazma modunu aç" bağlantı adının yazılmasını ister; kilit yalnızca o editör/hedef için, oturum boyunca açık. Yazma modunda her çalıştırmadan önce yine bağlantı adı yazdırılır.
- Lexer kullanıcı script'indeki `SET ... default_transaction_read_only`, `BEGIN`, `COMMIT`, `ROLLBACK` ifadelerini tanır ve reddeder (transaction'ı Tezgah yönetir).
- Bu bir **kaza önleyici**dir, güvenlik sınırı değildir.

Çizim oturumunda (2026-11-03) kararlaştırıldı.
