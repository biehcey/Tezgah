# Backend ↔ arayüz iletişimi

Type: grilling
Status: resolved
Blocked by: —

## Question

REST mi WebSocket mi; ifade sonuçları canlı nasıl loglanır, transaction sonu kararı nasıl alınır?

## Answer

- CRUD (bağlantılar, klasörler, keychain, içe aktarma, veritabanı/şema listeleri): REST/JSON.
- **Script çalıştırma: WebSocket.** İfade başına olaylar: `started`, `done{rowCount, ms}`, `error{position}`. Sonda transaction açık bekler; istemci `commit` / `rollback` gönderir. İptal `pg_cancel_backend` ile.
- **WS koparsa veya sekme kapanırsa açık transaction rollback edilir.**

Bkz. [ADR-0002](../../../docs/adr/0002-kopmada-rollback.md). Çizim oturumunda (2026-11-03) kararlaştırıldı.
