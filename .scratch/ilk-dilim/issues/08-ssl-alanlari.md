# Bağlantı modelinde SSL/TLS

Type: grilling
Status: resolved
Blocked by: —

## Question

Bağlantı modeli SSL/TLS'i nasıl taşır?

## Answer

- Alanlar: `sslmode` (disable / prefer / require / verify-ca / verify-full) + opsiyonel CA, istemci sertifikası, anahtar dosya yolları.
- Yeni bağlantıda varsayılan `prefer`; `prod` etiketi seçilince `verify-full` önerilir.
- `pg` sürücüsünde bu modların tam eşlemesi ayrı research ticket'ında: [pg sürücüsünde sslmode davranışı](14-pg-sslmode.md).

Çizim oturumunda (2026-11-03) kararlaştırıldı.
