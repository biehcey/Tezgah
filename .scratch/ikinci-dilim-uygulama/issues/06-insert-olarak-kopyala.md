# 06: INSERT olarak kopyala

Spec: [İkinci dilim spec'i](../../ikinci-dilim/spec.md) · Kararlar: [02 Grid davranış ayrıntıları](../../ikinci-dilim/issues/02-grid-davranis-ayrintilari.md) Q1, Q8

**What to build:** Sonuç grid'inde seçili satırlar sağ tık menüsündeki "INSERT olarak kopyala" ile panoya `INSERT INTO "tablo" (…) VALUES (…)` olarak kopyalanır. Değerler literal `'…'::tip`, NULL `NULL`. Konsol sonucunda tablo adı yer tutucudur; `::tip` eki yalnızca tip OID'si çözülürse yazılır.

**Blocked by:** 04

**Status:** done (f63c085)

- [x] core SQL literal üreticisi: değer + tip adı → `'…'::tip` (tek tırnak ikileniyor), NULL → `NULL`, tipsiz değer → `'…'`; tanımlayıcı tırnaklama. Bekleyen değişiklik SQL'i (ticket 11) aynı üreticiyi kullanacak. Birim testli.
- [x] Tip OID → ad: yaygın yerleşik tipler core'da sabit bir haritada; diğerleri isteğe bağlı bir eşleme parametresiyle (ticket 08 katalogdan dolduracak).
- [x] Grid'e sağ tık menüsü ekleniyor.
- [x] Testler: core literal ve INSERT üretimi; web'de menüden pano içeriği.
