# prod hedefinde deneme modu

Type: grilling
Status: open
Blocked by: —

## Question

[prod salt okunurluk kararına](07-prod-salt-okunurluk.md) göre prod hedefi `default_transaction_read_only=on` ve `BEGIN READ ONLY` ile çalışır; bu durumda DML içeren bir [deneme](16-deneme-modu.md) Postgres tarafından reddedilir. prod'da deneme modu nasıl işler?

Seçenekler: (a) salt okunur modda deneme yalnızca okuyan ifadelere izin verir (pratikte işe yaramaz); (b) deneme, yazma kilidi açılmadan da read-write transaction açar çünkü sonu her zaman rollback'tir — bağlantı adı onayı istenir mi, istenmez mi?; (c) deneme yalnızca yazma kilidi açıkken kullanılabilir. Ayrıca: rollback'e rağmen deneme prod'da satır kilitleri alır ve tetikleyiciler/sequence'ler yan etki bırakır (`nextval` geri alınmaz) — bu kullanıcıya nasıl söylenir?
