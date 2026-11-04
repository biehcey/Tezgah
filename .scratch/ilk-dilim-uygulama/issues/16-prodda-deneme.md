# 16: prod'da deneme

Spec: [İlk dilim spec'i](../../ilk-dilim/spec.md) · Kararlar: prod hedefinde deneme modu (wayfinder 20)

**What to build:** Geliştirici prod hedefinde, yazma kilidi kapalıyken de deneme yapabilir. Deneme kalıcı bir şey yazamaz. Kapatılamayan bir şerit yan etkileri hatırlatır, kilit beklemesi 3 sn ile sınırlıdır.

**Blocked by:** 13, 14

**Status:** ready-for-agent

- [ ] Deneme transaction'ı yazma kilidinden bağımsız olarak `BEGIN READ WRITE` ile açılıyor; pool ayarına dokunulmuyor. Sonu her zaman rollback; kullanıcının `COMMIT`'i zaten reddediliyor.
- [ ] prod'da transaction başında `SET LOCAL lock_timeout = '3s'` uygulanıyor. `55P03`'te hatalı satır işaretleniyor ve "kilit alınamadı, prod trafiği bu satırları tutuyor" mesajı gösteriliyor. prod dışında uygulanmıyor. `statement_timeout` yok.
- [ ] prod'da denemede başlığın altında sabit, kapatılamayan bir şerit: "Deneme prod'da çalışır: satır kilitleri alır, sequence'ler ilerler (`nextval` geri alınmaz), tetikleyici/FDW/dblink dış etkileri geri alınmaz."
- [ ] Hiçbir onay ya da ad yazdırma yok.
- [ ] Server testleri salt okunur prod'da denemenin çalıştığını ve veriyi değiştirmediğini, kilit çakışmasında `55P03` mesajını sınıyor.
