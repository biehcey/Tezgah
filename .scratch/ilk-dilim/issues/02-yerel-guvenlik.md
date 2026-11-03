# Yerel güvenlik: erişim anahtarı, CSRF, DNS rebinding

Type: grilling
Status: resolved
Blocked by: —

## Question

Rastgele erişim anahtarı tarayıcıya nasıl iletilir ve doğrulanır; CSRF ve DNS rebinding'e karşı nasıl korunulur?

## Answer

- Açılışta 32 bayt rastgele token, rastgele port (opsiyonel sabit port bayrağı). Yalnızca `127.0.0.1`'e bind.
- Tarayıcı `http://127.0.0.1:<port>/?t=<token>` ile açılır; terminale de bu URL basılır.
- Sunucu token'ı doğrular → `HttpOnly; SameSite=Strict; Path=/` cookie set eder → token'sız URL'e 302.
- Her istek (WS upgrade dahil) cookie'yi sabit zamanlı karşılaştırmayla doğrular.
- **Host** başlığı yalnızca `127.0.0.1:<port>` / `localhost:<port>` (DNS rebinding).
- Durum değiştiren istekler ve WS upgrade için **Origin** zorunlu ve aynı origin (CSRF).
- Hiçbir CORS başlığı gönderilmez.

Bkz. [ADR-0001](../../../docs/adr/0001-yerel-erisim-anahtari.md). Çizim oturumunda (2026-11-03) kararlaştırıldı.
