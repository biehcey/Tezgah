# 15: Deneme: önce/sonra farkı ve DDL şema farkı

Spec: [İlk dilim spec'i](../../ilk-dilim/spec.md) · Kararlar: Deneme modu (wayfinder 16)

**What to build:** PG18+ sunucuda ve PK'lı tabloda deneme, tabloya göre gruplanmış bir önce/sonra farkı gösterir: `+N eklendi · ~N güncellendi · −N silindi`, değişen hücreler vurgulu, eski değer üstü çizili. DDL ifadelerinde tablonun şema farkı görünür. PG18 öncesinde ya da PK'sız tabloda nedenini söyleyen bir notla ticket 14'teki önizlemeye düşülür.

**Blocked by:** 14

**Status:** ready-for-agent

- [x] Sunucu sürümü ve tablo PK'sı katalogdan tespit ediliyor. PG18+ ve PK varsa `RETURNING old.*, new.*`, yoksa `RETURNING *` kullanılıyor.
- [x] core fark birleştirme: önce/sonra satırları PK anahtarıyla tablo başına birleştiriliyor. Aynı satıra birden fazla ifade dokunursa ilk "önce" ve son "sonra" alınıyor. Tablo başına sayılar, ilk 100 satır ve değişen kolonlar çıkıyor. Birim testli.
- [x] DDL: rollback'ten önce katalogdan ilgili tablonun şeması okunup farkı çıkarılıyor (ör. `+ kolon son_giris timestamptz NULL`) ve tablonun bölümünde gösteriliyor.
- [x] Arayüz: INSERT yeşil, DELETE kırmızı ve üstü çizili, UPDATE'te yalnızca değişen hücreler vurgulu. "… N satır daha" ve yedeğe düşüş notu var.
- [x] Server testleri, PG18 ise önce/sonra farkını, değilse yedeği sınıyor (sürüme göre koşullu).

## Comments

Uygulama notları (2026-11-05):

- **core**
  - `deneme.ts`:
    - `dmlTarget` / `ddlTargets` hedef tabloyu ifade başından okur (`ALTER TABLE`, `CREATE … TABLE`, `DROP TABLE`).
    - `withReturning(statement, anahtar)` PK verilince `RETURNING CASE … AS tezgah_tur, old.*, new.*` ekler. `tezgah_tur` değerleri: `I` eklendi, `D` silindi, `U` güncellendi.
    - `oldNewSelect` / `decodeOldNew` sarmalın sorgusunu ve sonucunu tutar. Toplam, eklenen ve silinen sayısı `count(*) FILTER … OVER ()` ile `LIMIT`'ten önce sayılır.
    - `tableInfoQuery` / `parseTableInfo` katalogdan oid, ad, PK ve kolonları tek JSON olarak okur. Sorgu parametresizdir; ad `to_regclass('"şema"."ad"')` ile çözülür.
    - Yedek nedenleri `FallbackReason` ile belirtilir: `surum`, `anahtar`, `returning`, `sarmal`. Notlar `FALLBACK_NOTES`'tadır.
  - `deneme-farki.ts`: `mergeChanges` satırları PK anahtarıyla tablo bazında birleştirir.
    - İlk "önce" ve son "sonra" alınır. PK'sı değişen satır yeni anahtarıyla izlenir. Eklenip silinen satır düşer; silinip aynı anahtarla eklenen satır güncellenmiş sayılır.
    - Tablo başına ilk 100 satır, `daha` ve değişen kolonlar çıkar.
    - DDL'in `sema` görüntüleri oid ile eşlenir ve `schemaDiff` ile `+ kolon … / − kolon … / ~ kolon a → b` satırlarına çevrilir. Tablo oluşturma, silme ve yeniden adlandırma da kapsanır.
    - Sunucudan çekilmeyen (100'den sonraki) satırlar birleştirilemez, sayılara eklenir. Böyle bir tabloya başka bir ifade de dokunduysa sayılar `yaklasik` olur; arayüzde `≈` ile gösterilir.
- **WS sözleşmesi**:
  - Ayrı bir `fark` olayı yerine `done{…, fark?, sema?, farkYok?}` gönderilir. Hataya kadar çalışan ifadelerin farkı böylece kendiliğinden gelir. spec.md'deki WS listesi buna göre güncellendi.
- **server**:
  - Denemede `SHOW server_version_num` `BEGIN`'den önce okunur.
  - DML için PG18+ ise tablo bilgisi okunur. PK varsa önce/sonra sarmalı çalışır; sarmal 42xxx/0A000 ile reddedilirse `RETURNING *` sarmalına, o da reddedilirse ifadenin düz çalıştırılmasına düşülür.
  - Tablo DDL'inde şema ifadeden önce okunur, sonra da hemen okunur. Hatadan sonra transaction iptal durumunda olduğundan katalog okunamaz.
  - Katalog okumaları `tezgah_katalog` savepoint'inde yapılır; beklenmedik bir hata kullanıcının transaction'ını bozmaz.
- **web**:
  - Değişiklikler sekmesinde her tablonun bir bölümü (`region`) var. Başlıkta `+N eklendi · ~N güncellendi · −N silindi` yazar.
  - Şema farkı listesi bulunur. Eklenen satırlar yeşil, silinenler kırmızı ve üstü çizili. Güncellenen satırda yalnızca değişen hücre vurgulanır ve eski değer `<del>` ile gösterilir. Fazlası "… N satır daha" ile söylenir.
  - Yedeğe düşen ifadeler ticket 14'teki kartla, nedenini söyleyen bir notla gösterilir.
- **Bilinen boşluklar**:
  - Tabloda `tezgah_tur` adlı bir kolon varsa sarmal 42702 ile reddedilir ve `sarmal` yedeğine düşülür. DML'de `old`/`new` takma adı kullanılırsa da aynısı olur.
  - `headTokens`, `ifade-bolme`'den ayrı küçük bir okuyucudur ve iç içe `/* */` yorumları desteklemez. Böyle bir yorum tablo adından önce gelirse fark yedeğe düşer.
  - Yedek kartları tablo bölümlerinin altında durur, script sırasında değil.
  - GLOSSARY'ye "Deneme farkı" ve "Yedek önizleme" terimleri eklenmeli (/domain-modeling).
- **Testler**:
  - core: `deneme-farki.test.ts`, `deneme.test.ts`.
  - server: sahte PG ile `deneme.test.ts`.
  - web: `ScriptEkrani.test.tsx`.
  - Gerçek PG testleri sürüme göre koşullu yazıldı ama `TEZGAH_TEST_PG_URL` olmadığından **koşturulamadı**. Ticket 14'ün testleri PK'sız (UNIQUE'li) tabloya taşındı; PK'lı tabloda PG18+ ise fark, değilse yedek sınanıyor.
