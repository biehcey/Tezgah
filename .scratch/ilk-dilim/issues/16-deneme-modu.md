# Deneme modunda ne gösterilir

Type: prototype
Status: resolved
Blocked by: —

## Question

Deneme modu script'i transaction içinde çalıştırıp sonunda her zaman rollback eder. Kullanıcıya "değişiklikler" olarak ne gösterilir ve rollback edilecek transaction içinde nasıl toplanır?

Seçenekler: (a) yalnızca ifade başına etkilenen satır sayısı; (b) DML ifadelerine `RETURNING *` ekleyerek etkilenen satırların son hali (ifade yeniden yazma gerekir); (c) etkilenen tabloların PK üzerinden önce/sonra farkı; (d) karma. Sahte bir çalıştırma log ekranı prototipiyle hangisinin gerçekten işe yaradığı görülmeli. DDL ifadeleri deneme modunda nasıl gösterilir? ([Transaction dışı komut](15-transaction-disi-komutlar.md) içeren script deneme modunda zaten çalıştırılmaz.)

## Answer

**(c) Tablo bazlı önce/sonra farkı**, sürüme ve PK'ya bağlı olarak (b)'ye düşerek.

- **Ana görünüm (C)**: sonuç alanında iki sekme — *Değişiklikler* (varsayılan) ve *Çalıştırma logu*. Değişiklikler tabloya göre gruplanır; başlıkta `+N eklendi · ~N güncellendi · −N silindi`. UPDATE'te yalnızca değişen hücreler vurgulanır, eski değer üstü çizili yanında; INSERT yeşil, DELETE kırmızı/üstü çizili satır. Tablo başına ilk 100 satır ([SELECT önizleme kararıyla](09-script-select-onizleme.md) aynı sınır), kalanı "… N satır daha". SELECT sonuçları log sekmesinde.
- **Eski değerin kaynağı**: yalnızca PG18+ `RETURNING old.*, new.*`. Lexer DML ifadesinin sonuna bunu ekler. WHERE ayrıştırıp ön-SELECT ve geçici trigger yolları reddedildi (SQL ayrıştırma gerekir / kilit + yetki).
- **Yedek (B)**: sunucu PG18 öncesiyse veya tabloda PK yoksa o ifade için `RETURNING *` ile ifade başına önizleme gösterilir: UPDATE'te yeni hal, INSERT'te eklenen satır, DELETE'te silinen satır; eski değer yok. Kullanıcıya neden önce/sonra gösterilmediği kısa bir notla söylenir.
- **Satır sayısı** her durumda gösterilir (WS `done{rowCount}`); farklar ek bilgidir.
- **DDL**: rollback'ten önce katalogdan okunan tablo şeması farkı (ör. `+ kolon son_giris timestamptz NULL`), ilgili tablonun bölümünde.
- **Hata**: deneme hatada durur; banner'da hatalı satır ve SQLSTATE, altında hataya kadar çalışan ifadelerin farkı. Her durumda sonuç rollback.

Spec'e kalan uygulama ayrıntıları (karar değil): kullanıcının zaten `RETURNING` yazdığı ifadeler; aynı satıra birden fazla ifade dokunduğunda farkların birleştirilmesi (saf `src/core` modülü, PK anahtarlı); büyük DML'de 100 satırdan sonrasının sunucudan çekilmemesi (cursor); PK tespiti için katalog sorgusu.

Prototip: atılabilir `prototype/16-deneme-modu` dalı, `.scratch/ilk-dilim/prototypes/16-deneme-modu-PROTOTYPE.html` (varyantlar `?variant=A|B|C`, `?senaryo=hata`).

Çalışma oturumunda (2026-11-03) kararlaştırıldı.
