# 10: Tablo sekmesi: WHERE/ORDER BY ve Cmd/Ctrl+K araması

Spec: [İkinci dilim spec'i](../../ikinci-dilim/spec.md) · Kararlar: harita Q13, Q15, Q16

**What to build:** Tablo sekmesinde serbest `WHERE` ve `ORDER BY` kutuları (katalog tamamlamalı) ile filtrelenip sıralanır; kolon başlığına tıklamak `ORDER BY`'ı doldurur. Sorgu her zaman tek ifade olarak gider; hatalı filtrede Postgres hatası kutunun yanında görünür. Cmd/Ctrl+K'da tablo adı aranıp Tablo sekmesi açılabilir.

**Blocked by:** 09

**Status:** done

- [x] core: kullanıcı WHERE parantez içinde gömülüyor; kullanıcı ORDER BY varsa OFFSET'e düşülüyor; `;` sonrası boş olmayan metin reddediliyor; başlık tıklama döngüsü (artan → azalan → temiz). Birim testli.
- [x] Filtre/sıralama çubuğu: tek satırlık CodeMirror kutuları, katalog tamamlamalı; Enter uygular.
- [x] Hata: SQLSTATE, mesaj ve konum kutunun yanında; grid önceki sonuçla kalıyor.
- [x] WHERE/ORDER BY sekme kalıcılığına yazılıyor.
- [x] Cmd/Ctrl+K'ya "Tablolar" grubu: yalnızca önbelleği dolu hedeflerden; Enter Tablo sekmesi açıyor.
- [x] Testler: core; server'da çok ifadeli filtrenin reddi; web'de hata gösterimi, başlık tıklama, palette tablo araması.
