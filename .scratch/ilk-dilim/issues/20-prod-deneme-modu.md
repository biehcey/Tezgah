        # prod hedefinde deneme modu

Type: grilling
Status: resolved
Blocked by: —

## Question

[prod salt okunurluk kararına](07-prod-salt-okunurluk.md) göre prod hedefi `default_transaction_read_only=on` ve `BEGIN READ ONLY` ile çalışır; bu durumda DML içeren bir [deneme](16-deneme-modu.md) Postgres tarafından reddedilir. prod'da deneme modu nasıl işler?

Seçenekler: (a) salt okunur modda deneme yalnızca okuyan ifadelere izin verir (pratikte işe yaramaz); (b) deneme, yazma kilidi açılmadan da read-write transaction açar çünkü sonu her zaman rollback'tir — bağlantı adı onayı istenir mi, istenmez mi?; (c) deneme yalnızca yazma kilidi açıkken kullanılabilir. Ayrıca: rollback'e rağmen deneme prod'da satır kilitleri alır ve tetikleyiciler/sequence'ler yan etki bırakır (`nextval` geri alınmaz) — bu kullanıcıya nasıl söylenir?

## Answer

**(b)**: prod'da deneme, yazma modu kapalıyken de `BEGIN READ WRITE` ile çalışır; sonu her zaman rollback olduğu için kalıcı yazma yapamaz.

- **Teknik**: pool'daki `default_transaction_read_only=on` yalnızca varsayılandır; denemenin transaction'ı `BEGIN READ WRITE` ile açılır, pool ayarına dokunulmaz. Kullanıcının `COMMIT`'i lexer'da reddedilir; procedure içi `COMMIT` açık blok içinde Postgres'te hata verir. Deneme rollback dışında bitemez.
- **Onay yok**: deneme hiçbir koşulda (yazma modu açık ya da kapalı) bağlantı adı yazdırmaz, tek tıklık onay da istemez. CLAUDE.md'deki "bağlantı adı yazdırılarak onay" kuralı commit edebilen çalıştırmalar için geçerlidir.
- **Uyarı**: prod çerçevesi içinde, deneme modunda kalıcı, kapatılamaz şerit — "Deneme prod'da çalışır: satır kilitleri alır, sequence'ler ilerler (`nextval` geri alınmaz), tetikleyici/FDW/dblink dış etkileri geri alınmaz." Sabit metin; katalogdan ifade bazlı yan etki tespiti reddedildi (ek sorgu, eksik kalır, dblink/fonksiyon içi etkileri yakalayamaz).
- **Kilit süresi**: deneme son ifadeden (veya hatadan) hemen sonra beklemeden rollback yapar; kilitler yalnızca çalışma süresince tutulur. prod'da transaction başında `SET LOCAL lock_timeout = '3s'`; `55P03`'te hatalı satır işaretlenir, "kilit alınamadı, prod trafiği bu satırları tutuyor" mesajı. `statement_timeout` yok (uzun sorguyu kullanıcı iptal eder). prod dışında lock_timeout uygulanmaz.
- Reddedilenler: (a) salt okunur deneme (DML'de işe yaramaz); (c) denemeyi yazma moduna bağlamak (prod'da "önce dene"yi zorlaştırır, kilidin amacı kalıcı yazmayı engellemek).
- Sözlüğe eklendi: **Deneme modu**.

Çalışma oturumunda (2026-11-03) kararlaştırıldı.
