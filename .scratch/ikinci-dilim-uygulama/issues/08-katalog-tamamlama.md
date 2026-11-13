# 08: Katalog önbelleği ve tamamlama

Spec: [İkinci dilim spec'i](../../ikinci-dilim/spec.md) · Kararlar: harita Q12

**What to build:** Kullanıcı bu oturumda bir hedefi eliyle seçince (panel / Ctrl+K) ya da sekmeyi ilk kez çalıştırınca o hedefin Katalog önbelleği yüklenir; editörde görünür şemaların tablo, view ve matview adları ile kolonları tipleriyle tamamlanır. `search_path`'in ilk şemasındaki tablolar öneksiz önerilir. Katalog "↻" ile ve DDL içeren bir script commit/autocommit ile bitince yenilenir. Geri gelen sekmeler kendiliğinden katalog okumaz.

**Blocked by:** 01

**Status:** done (523779e)

- [x] `@codemirror/autocomplete` doğrudan bağımlılık; editöre `lang-sql` `schema` + `defaultSchema` veriliyor ve katalog değişince yeniden yapılandırılıyor.
- [x] core dönüştürücü: katalog satırları + görünür şemalar + `defaultSchema` → `SQLNamespace` (kolon tipi `detail`'de, gerektiğinde tırnaklı adlar, fonksiyonlar yok); tablo arama filtresi. Birim testli.
- [x] server Katalog önbelleği: süreç belleğinde hedef başına; ilişkiler (`r|v|m|p|f`), kolonlar (`format_type`, tip OID, `attnotnull`, `atthasdef`, `attgenerated`), ilişki başına PK kolonları ve `reltuples`, tip OID → ad haritası ve kullanıcı tipleri; `defaultSchema` = `current_schemas(false)[1]`. Bağlantı kesilince/silinince ve Veritabanı seçimi değişince atılıyor. Kısa süreli client.
- [x] REST: katalog getir (yoksa okur; yalnızca kullanıcı eylemiyle çağrılır) ve yenile.
- [x] DDL içeren script commit/autocommit ile bitince sunucu önbelleği tazeliyor, `bitti.katalogYenilendi` true; arayüz yeniden çekiyor.
- [x] "INSERT olarak kopyala" (ticket 06) tip OID'lerini katalogdan da çözüyor (06 bittiyse).
- [x] Testler: core dönüştürücü; server'da içerik, görünür şema filtresi, DDL sonrası yenileme, açılışta sorgu gitmemesi; web'de katalogun yalnızca kullanıcı eylemiyle istenmesi ve editöre verilen yapılandırma.
