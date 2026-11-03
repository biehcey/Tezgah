# Transaction dışı komutlar ve karışık script

Type: grilling
Status: open
Blocked by: —

## Question

Transaction içinde çalışamayan komutlar (`CREATE/DROP INDEX CONCURRENTLY`, `REINDEX ... CONCURRENTLY`, `VACUUM`, `CREATE/DROP DATABASE`, `CREATE/DROP TABLESPACE`, `ALTER SYSTEM`, …) [lexer'ın](05-ifade-bolme.md) ilk anahtar kelimeleriyle nasıl tanınır, kesin liste nedir, ve bunları içeren bir script'te ne yapılır?

Seçenekler: (a) karışık script'i reddet, yalnızca tamamı transaction dışı olan script'e izin ver; (b) script'i segmentlere böl (transaction'lı blok / tek başına autocommit ifade), her segment sınırında commit/rollback onayı al; (c) başka. Ayrıca: hata durumunda daha önce autocommit ile çalışmış ifadelerin geri alınamayacağı kullanıcıya nasıl gösterilir; deneme modunda ve `prod` salt okunur modda bu komutlara ne olur?
