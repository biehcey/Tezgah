# 14: Deneme modu: her zaman rollback ve ifade başına önizleme

Spec: [İlk dilim spec'i](../../ilk-dilim/spec.md) · Kararlar: Deneme modu (wayfinder 16), Transaction dışı komutlar (15), Script ekranı (23)

**What to build:** Geliştirici ⟲ Dene'ye basar. Script Transaction modunda çalışır ve sonunda her zaman geri alınır. Değişiklikler sekmesinde her DML ifadesi için `RETURNING *` önizlemesi görünür: UPDATE'te yeni hâl, INSERT'te eklenen, DELETE'te silinen satır. Transaction dışı komut içeren script denemede çalıştırılmaz.

**Blocked by:** 11

**Status:** ready-for-agent

- [x] `run{deneme: true}`: son ifadeden ya da hatadan hemen sonra beklemeden rollback yapılıyor; karar kartı yerine "deneme geri alındı" özeti gösteriliyor.
- [x] core DML yeniden yazımı INSERT/UPDATE/DELETE'e `RETURNING *` ekliyor; kullanıcı zaten `RETURNING` yazmışsa ifadeye dokunulmuyor ve kendi sonucu gösteriliyor. Birim testli.
- [x] İfade başına en fazla 100 satır; fazlası sunucudan çekilmiyor. Satır sayısı her durumda gösteriliyor.
- [x] Sekmeler: denemede *Değişiklikler* (varsayılan) + *Log*, normal çalıştırmada yalnızca *Log*. SELECT sonuçları Log'da.
- [x] Transaction dışı ifade içeren script denemede reddediliyor ve ifadeler işaretleniyor.
- [x] Hata durumunda banner'da hatalı satır ve SQLSTATE, altında hataya kadar olan önizlemeler; sonuç her durumda rollback.
- [x] Server testleri verinin değişmeden kaldığını ve önizleme olaylarını sınıyor.

## Comments

Uygulama notları (2026-11-05):

- **core** `deneme.ts`: `withReturning(statement)` → `{text, degistirir}`. INSERT/UPDATE/DELETE'in sonuna `RETURNING *` eklenir. `words`'te RETURNING varsa metne dokunulmaz; önizleme kullanıcının kendi sonucudur. CTE ile başlayan DML (`WITH d AS (DELETE …) SELECT`) yeniden yazılmaz ve önizlemesi olmaz, çünkü ana ifadeyi bulmak SQL ayrıştırması gerektirir. `DML_VERBS` hem DML listesi hem başlıktaki fiillerdir. `runBlockReasons(script, statements, lock, { deneme, analysis })`: denemede transaction dışı her ifade, satırıyla birlikte engel sayılır (`DENEME_NON_TRANSACTIONAL_MESSAGE`). Bu durumda Autocommit kilit nedeni eklenmez.
- **WS sözleşmesi**:
  - `run{…, deneme}`: yalnızca açıkça `true` verilirse deneme sayılır.
  - `done{…, degisiklik?}`: DML'in RETURNING satırlarıdır ve `onizleme`'den ayrı tutulur (SELECT'ler `onizleme` ile Log'a gider).
  - `bitti{sonuc: 'deneme'}`: hata olsa da sonuç budur; hata `error` olayında gelir.
  - Kayıtta sonuç `deneme-rollback`, `deneme: true`.
- **server**:
  - DML savepoint içinde `WITH tezgah_onizleme AS (<dml>) SELECT count(*) OVER (), * FROM tezgah_onizleme LIMIT 100` ile çalışır. Veri değiştiren CTE her durumda sonuna kadar çalışır. LIMIT yalnızca istemciye giden satırları kısar; toplam sayı sunucuda sayılır. Hata konumundan sarmal öneki düşülür.
  - **Yedek**: sarmal 42xxx/0A000 ile reddedilirse (ör. kurallı tablo) savepoint'e geri sarılır ve ifade *kullanıcının yazdığı gibi* çalışır. Eklenen `RETURNING *` kural yüzünden yanlış hata verebileceği için gönderilmez; bu durumda yalnızca satır sayısı görünür. Kullanıcının kendi RETURNING'i varsa satırların tamamı çekilir, ilk 100'ü gösterilir.
  - Son ifadeden, hatadan ya da kopmadan hemen sonra ROLLBACK yapılır; karar kartı ve Karar süresi yok.
  - İmleç ve değişiklik sarmalı ortak `withWrapper` savepoint yardımcısını kullanır.
- **web**:
  - Araç çubuğunda `⟲ Dene` düğmesi var.
  - Sekmeler: denemede *Değişiklikler* (varsayılan) ve *Log*, normal çalıştırmada yalnızca *Log*.
  - Değişiklikler sekmesinde hata banner'ı (`Satır N · SQLSTATE · mesaj`) ve her DML için önizleme vardır. Başlık `<KOMUT> · satır N · X satır güncellendi/eklendi/silindi` biçimindedir; 100 satırı aşınca "ilk 100 satır gösteriliyor" yazar.
  - Log'da DML kartı yalnızca satır sayısını gösterir.
  - Karar kartındaki sonuç "Deneme geri alındı; hiçbir şey kalıcı yazılmadı" ya da "Deneme hatada durdu; geri alındı" olur.
  - Karışık script'te transaction dışı ifadeler önceki gibi işaretlidir.
  - Autocommit script'inde editörde işaret ya da liste yok, çünkü Çalıştır'ın önünde bir engel yok. Dene kapalıdır; nedeni düğmenin `title`'ında yazar.
- **Bilinen boşluklar**:
  - Salt okunur prod'da Dene açık, ama transaction hâlâ `BEGIN READ ONLY` ile açıldığından DML 25006 ile düşer. `BEGIN READ WRITE` ticket 16'da gelecek.
  - Sarmal, çalışma zamanında bir tetikleyici ya da fonksiyon içinden 42xxx/0A000 ile reddedilirse ifade iki kez çalışır. Veri savepoint ile geri alınır ama sequence'ler iki kez ilerler. İmleç yolu da önceden böyleydi.
  - spec.md'deki WS listesi (`run`, `done`, `bitti`) bu sözleşmeye göre güncellenmeli.
- **Testler**:
  - core: `deneme.test.ts`, `yazma-kilidi.test.ts`, `script-calistirma.test.ts`.
  - server, sahte PG ile: `src/server/deneme.test.ts`. Sahte PG'ye sorgu başına sonuç döndüren `resultFor` eklendi.
  - web: `ScriptEkrani.test.tsx`.
  - Gerçek PG testleri yazıldı ama `TEZGAH_TEST_PG_URL` olmadığından **koşturulamadı**: verinin değişmemesi, 150 satırlık UPDATE'te 100 satır ve tam sayı, kullanıcının RETURNING'i, hatada önizleme ve geri alma.
