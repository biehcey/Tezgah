# 16: prod'da deneme

Spec: [İlk dilim spec'i](../../ilk-dilim/spec.md) · Kararlar: prod hedefinde deneme modu (wayfinder 20)

**What to build:** Geliştirici prod hedefinde, yazma kilidi kapalıyken de deneme yapabilir. Deneme kalıcı bir şey yazamaz. Kapatılamayan bir şerit yan etkileri hatırlatır, kilit beklemesi 3 sn ile sınırlıdır.

**Blocked by:** 13, 14

**Status:** ready-for-agent

- [x] Deneme transaction'ı yazma kilidinden bağımsız olarak `BEGIN READ WRITE` ile açılıyor; pool ayarına dokunulmuyor. Sonu her zaman rollback; kullanıcının `COMMIT`'i zaten reddediliyor.
- [x] prod'da transaction başında `SET LOCAL lock_timeout = '3s'` uygulanıyor. `55P03`'te hatalı satır işaretleniyor ve "kilit alınamadı, prod trafiği bu satırları tutuyor" mesajı gösteriliyor. prod dışında uygulanmıyor. `statement_timeout` yok.
- [x] prod'da denemede başlığın altında sabit, kapatılamayan bir şerit: "Deneme prod'da çalışır: satır kilitleri alır, sequence'ler ilerler (`nextval` geri alınmaz), tetikleyici/FDW/dblink dış etkileri geri alınmaz."
- [x] Hiçbir onay ya da ad yazdırma yok.
- [x] Server testleri salt okunur prod'da denemenin çalıştığını ve veriyi değiştirmediğini, kilit çakışmasında `55P03` mesajını sınıyor.

## Comments

Uygulama notları (2026-11-06):

- **core**
  - `yazma-kilidi.ts`: `beginStatement(lock, { deneme })` denemede kilitten bağımsız olarak `BEGIN READ WRITE` döner. Pool'un `default_transaction_read_only` ayarına dokunulmaz.
  - `deneme.ts`: `denemeLockTimeout(envTag)` yalnızca prod'da `SET LOCAL lock_timeout = '3s'` döner. `LOCK_NOT_AVAILABLE` (`55P03`) ve `LOCK_NOT_AVAILABLE_MESSAGE` de burada.
- **server**: `lock_timeout` ifadesi `BEGIN` ve idle `SET LOCAL`'ın ardından çalışır. `lock_timeout` uygulanmış bir denemede `55P03` gelirse, `error` olayında ve kayıtta Postgres'in iletisi yerine sabit mesaj kullanılır. Satır ve konum her zamanki gibi işaretlenir. Kullanıcının `NOWAIT`'i de aynı mesajı alır; prod'da kilidi tutan yine trafiktir.
- **web**: Deneme prod hedefte başladıysa başlığın altında kapatılamayan `Deneme yan etki uyarısı` şeridi görünür. Şerit deneme sürerken ve bittikten sonra da kalır, normal çalıştırmada kalkar. Hedefin prod olup olmadığı çalıştırma başlarken kaydedilir; hedef sonradan değişirse şerit o çalıştırmaya göre kalır.
- **Testler**: Sahte Postgres testleri ifade sırasını, prod dışında `lock_timeout` uygulanmadığını ve `55P03` mesajını sınar. Gerçek Postgres testleri (`describePg`) salt okunur prod'da verinin değişmediğini ve `FOR UPDATE` tutan bir oturuma karşı 3 sn sonra gelen `55P03`'ü sınar. Bunlar bu makinede `TEZGAH_TEST_PG_URL` olmadığı için **çalıştırılmadı**.
