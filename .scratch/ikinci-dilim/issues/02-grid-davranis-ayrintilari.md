# Grid davranış ayrıntıları

Type: grilling
Status: resolved
Blocked by: 01

## Question

[01 Grid kütüphanesi seçimi](01-grid-kutuphanesi.md) kendi DOM grid'imizi seçti; kutudan gelmeyen davranışları biz tanımlıyoruz. Spec'e girmeden şunlar kararlaştırılmalı:

- Panoya kopyalamada NULL nasıl yazılır (boş, `NULL`, `\N`)? TSV dışında "INSERT olarak / CSV olarak kopyala" var mı?
- Çok hücreli yapıştırma (TSV → bekleyen değişiklikler, gerekirse yeni satırlar) bu dilimde mi?
- Uzun / çok satırlı `text`, `jsonb` değerler hücrede nasıl gösterilir (tek satır kırpma + tooltip/panel?); düzenleme `<input>` mı `<textarea>` mı, Enter/Shift+Enter anlamı?
- Sona ekleme için satır üst sınırı veya uyarı eşiği (bellek, tarayıcı yükseklik sınırı)?
- İlk sürümde kolon sanallaştırması gerekli mi, yoksa yalnızca satır?

## Answer

Grilling 2026-11-09 (Q1–Q9). ADR veya sözlük değişikliği yok (hepsi kolayca geri alınabilir).

- **Kopyalama (Q1):** Ctrl/Cmd+C seçili aralığı başlıksız TSV olarak kopyalar. NULL boş yazılır; sekme veya satır sonu içeren hücreler Excel tarzında tırnaklanır (`"…"`, içteki `"` → `""`). Başlıklarla kopyalama ve CSV olarak kopyalama kapsam dışı.
- **INSERT olarak kopyala (Q1, Q8):** sağ tık menüsünde. Q20'deki literal `'…'::tip` üreticisini kullanır, NULL → `NULL`. Konsol sonucunda tablo adı yer tutucudur (`INSERT INTO "tablo" (…)`), kolon adları sonuçtakilerdir; `::tip` eki yalnızca alan tip OID'si katalogdan çözülürse eklenir.
- **Çok hücreli yapıştırma (Q2, Q7, Q9):** bu dilimde, yalnızca Tablo sekmesinde; konsol sonuçlarında yok. TSV → bekleyen değişiklikler, saf `src/core/grid` dönüşümü.
  - Yapıştırma seçimin sol üst köşesinden başlar; kalan seçim yok sayılır, doldurma yok.
  - Taşan satırlar yeni satır olur; yeni satırda dokunulmayan kolonlar DEFAULT kalır (Q21).
  - Kolon taşarsa ya da salt okunur kolona (`bytea`, generated) denk gelirse yapıştırma tümden reddedilir ve hata gösterilir.
  - Boş hücre NULL olur; `NULL` metni düz metindir (`'NULL'`); tırnaklı hücreler kopyalama kuralına simetrik çözülür.
- **Gösterim (Q3):** sabit yükseklikli tek satır. Değer kolon genişliğinde `…` ile kırpılır, satır sonları `↵` ile gösterilir. Hücreye ilk 1000 karakter basılır, değerin tamamı bellekte kalır. Tooltip ve değer paneli yok; tam değer düzenleyiciden okunur (konsol sonuçlarında salt okunur açılır).
- **Düzenleyici (Q4):** hücrenin üstünde açılan, gerektiğinde büyüyen tek `<textarea>`.
  - Enter: kaydet ve aşağı in. Shift+Enter: yeni satır. Esc: vazgeç. Tab / Shift+Tab: kaydet ve sağa/sola geç.
  - F2 veya çift tık düzenlemeyi açar; seçili hücrede yazmaya başlamak da açar ve değeri değiştirir.
  - Ctrl/Cmd+Shift+N düzenleyicide de NULL yapar.
- **Satır sınırı (Q5):** konsol sonuçlarında ve Tablo sekmesinde sert sınır 100.000 satır. Sınıra ulaşınca "daha fazla" kapanır ve "Sınıra ulaşıldı, filtrele" mesajı çıkar. Sabit `src/core/grid`'de; tarayıcı yükseklik sınırının altında kaldığı için ölçekli kaydırma gerekmez.
- **Sanallaştırma (Q6):** yalnızca satır; kolon sanallaştırması ihtiyaç çıkarsa sonra. Kolon genişliği başlıktan sürükleyerek ayarlanır; ilk genişlik ilk sayfadan ölçülür (en fazla ~400 px); genişlik diske yazılmaz.
