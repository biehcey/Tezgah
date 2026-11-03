# Entegrasyon test stratejisi

Type: grilling
Status: resolved
Blocked by: —

## Question

Veritabanına, keychain'e ve SSH'a dokunan kod nasıl test edilir?

## Answer

- `src/core`: saf birim testleri (Vitest).
- `src/server`: gerçek Postgres'e karşı entegrasyon testleri; yalnızca `TEZGAH_TEST_PG_URL` tanımlıysa koşar, yoksa atlanır. Docker/testcontainers zorunlu değil (Windows).
- Keychain ve SSH bir arayüzün arkasında; testlerde sahte implementasyon.

Çizim oturumunda (2026-11-03) kararlaştırıldı.
