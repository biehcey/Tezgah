# İfade bölme ve hata konumunu satıra eşleme

Type: grilling
Status: resolved
Blocked by: —

## Question

Script'i ifadelere bölmek için hazır parser mı, kendi lexer'ımız mı; Postgres hata konumu editörde satıra nasıl eşlenir?

## Answer

- `src/core` içinde **kendi lexer'ımız**: `--` ve iç içe `/* */` yorumlar, `'...'`, `E'...'` (ters bölü kaçışı), `$tag$...$tag$`, `"ident"`, `U&'...'`; psql `\` meta komutları tanınır ve reddedilir.
- Çıktı: ifade sınırları, başlangıç offset'leri, ilk anahtar kelimeler (komut tanıma için).
- libpg_query/pgsql-parser reddedildi: yazımı bozuk ifadede bölmeyi tamamen reddediyor, WASM ağırlığı var; bize yalnızca sınırlar lazım.
- Hata konumu: Postgres `position` (ifade içi karakter offset'i, 1 tabanlı) + ifade başlangıç offset'i → editör satır/sütun. `position` yoksa ifadenin tamamı işaretlenir.
- Tablo tabanlı birim testleriyle doğrulanır.

Çizim oturumunda (2026-11-03) kararlaştırıldı.
