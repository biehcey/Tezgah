# Spec: İkinci dilim (sekmeli konsol, geçmiş, tamamlama, Tablo sekmesi, düzenlenebilir grid, ALTER, bekletme göstergesi)

Status: ready-for-agent

Kaynak: [İkinci dilim haritası](map.md) (grilling 2026-11-09, Q1–Q25), [01 Grid kütüphanesi seçimi](issues/01-grid-kutuphanesi.md), [02 Grid davranış ayrıntıları](issues/02-grid-davranis-ayrintilari.md), [Araştırma](../oneriler/arastirma.md) 1.1–1.7. Terimler [GLOSSARY.md](../../GLOSSARY.md)'deki anlamlarıyla kullanılır: Hedef, Veritabanı seçimi, Ortam etiketi, Sekme, Tablo sekmesi, Bekleyen değişiklik, Katalog önbelleği, Çalıştırma modu (Transaction / Autocommit / Okuma), Deneme modu, Deneme farkı, Yazma kilidi, Karar süresi, Çalıştırma kaydı. İlgili ADR'ler: ADR-0002 (tek client, kopmada rollback), ADR-0003 (konsol = sekmeli Script editörü), ADR-0004 (Okuma modu). İlk dilimin [spec'i](../ilk-dilim/spec.md) ve prod kuralları değişmeden geçerlidir; bu dilim onları genişletir.

## Problem Statement

İlk dilimle bağlantılarımı yönetip script çalıştırabiliyorum, ama günlük işin çoğu script değil, sorgu: bir tabloya bakmak, birkaç SELECT'i yan yana denemek, dünkü sorguyu bulmak, bir satırdaki bir değeri düzeltmek. Bugün Tezgah'ta tek bir editör var; her SELECT karar kartı açıyor ve commit/rollback soruyor; sonuçtan yalnızca ilk 100 satırı görüyorum ve daha fazlasını çekemiyorum. Tablo ve kolon adlarını ezbere yazıyorum. Bir tabloya göz atmak için her seferinde `SELECT * … LIMIT` yazıyorum ve kaç satır olduğunu bilmiyorum. Bir hücreyi düzeltmek için `UPDATE`'i elle yazıyorum, PK'yı yanlış yazarsam fazla satır değiştirme riski var. Yeni bir kolon eklerken `ALTER TABLE`'ın tabloyu yeniden yazıp yazmayacağını önceden bilmiyorum. Çalıştırma kayıtları diskte duruyor ama arayüzde göremiyorum. Prod'da karar beklerken açık transaction'ımın başka oturumları kilitle beklettiğini fark etmiyorum.

## Solution

Script ekranı **sekmeli konsola** dönüşür (ADR-0003): her sekme bugünkü Script editörünün aynısıdır, kendi hedefi, Yazma kilidi, Çalıştırma modu, karar kartı ve Deneme modu vardır. Sekmeler diske yazılır ve Tezgah açılınca geri gelir, ama hiçbir yere bağlanmaz.

- **Okuma modu** (ADR-0004): yalnızca okuyan script'ler karar kartı açmadan `BEGIN READ ONLY` ile çalışır. Sonuçlar editörün altında, SELECT başına bir sonuç sekmesinde, sanallaştırılmış bir grid'de açılır; kaydırdıkça 500'er satır daha çekilir.
- **Sorgu geçmişi**: Çalıştırma kayıtlarına filtrelenebilir, aranabilir bir yan panelden (Ctrl/Cmd+Alt+E) göz atılır; çift tık kaydı yeni sekmede açar.
- **Şema bilen tamamlama**: kullanıcının açtığı hedefin görünür şemalarındaki tablo, view ve kolonlar editörde tamamlanır.
- **Tablo sekmesi**: veritabanı panelinden ya da Cmd/Ctrl+K'dan açılan, editörsüz, `≈ N satır` başlıklı, serbest `WHERE` / `ORDER BY` kutulu, sayfalı tablo görünümü. Her sayfa kısa, ayrı, salt okunur bir sorgudur.
- **Düzenlenebilir grid**: PK'lı tabloda Tablo sekmesi düzenlenebilir. Değişiklikler Bekleyen değişiklik olarak birikir; üretilen SQL sürekli önizlenir. "Uygula" bu SQL'i mevcut Script çalıştırıcıyla Transaction modunda çalıştırır (karar kartı, Karar süresi, Çalıştırma kaydı). "Dene" Deneme modunda gösterir, "Konsola aktar" yeni konsol sekmesine taşır.
- **ALTER TABLE kolon ekleme**: Tablo sekmesinde "+ Kolon" formu, canlı `ADD COLUMN` önizlemesi ve tabloyu yeniden yazacak ya da hata verecek durumlar için engellemeyen uyarılar.
- **"Bekletiyorsun" göstergesi**: karar beklerken ya da Okuma transaction'ı açıkken karar kartında "⚠ N oturumu bekletiyorsun" ve bekletilen oturumların listesi.

## User Stories

### Sekmeli konsol

1. Geliştirici olarak birden çok konsol sekmesi açabilmek istiyorum, böylece farklı hedeflerde ve farklı işlerde aynı anda çalışabilirim.
2. Geliştirici olarak her sekmenin kendi hedefi olmasını istiyorum, böylece bir sekmede dev'de, diğerinde prod'da çalışırken karışıklık olmaz.
3. Geliştirici olarak her sekmede bugünkü Script editörünün tüm davranışlarını (Çalıştırma modu rozeti, ifade kartları, hata işareti, karar kartı, Deneme modu, Autocommit uyarısı) görmek istiyorum, böylece öğrendiğim tek bir çalıştırma modeli olur.
4. Geliştirici olarak aktif sekmenin hedef başlığının ve prod kırmızı çerçevesinin sekmeye göre değişmesini istiyorum, böylece hangi sekmede nereye yazdığımı her an görürüm.
5. Geliştirici olarak sekme başlıklarında hedefin ortam rengini görmek istiyorum, böylece prod sekmesini başlıktan ayırt ederim.
6. Geliştirici olarak sekmeleri kapatabilmek ve yenisini açabilmek istiyorum.
7. Geliştirici olarak sekmelerin metninin ve hedefinin (bağlantı, veritabanı, şema) diske yazılmasını ve Tezgah'ı yeniden açınca geri gelmesini istiyorum, böylece yarım kalan işim kaybolmaz.
8. Geliştirici olarak geri gelen sekmelerin hiçbir sunucuya kendiliğinden bağlanmamasını istiyorum, böylece "açılışta bağlantı yok" kuralı korunur.
9. Geliştirici olarak sekme bilgilerinin `tezgah.json`'dan ayrı saklanmasını istiyorum, böylece bağlantı ayarlarım sık değişen sekme içeriğiyle birlikte yazılmaz.
10. Geliştirici olarak bir sekmenin hedefi silinmiş bir bağlantıya işaret ediyorsa sekmenin açılmasını ama hedefsiz görünmesini istiyorum, böylece metnim kaybolmaz.
11. Geliştirici olarak veritabanı panelinden ya da Cmd/Ctrl+K'dan seçtiğim hedefin aktif sekmenin hedefi olmasını istiyorum.
12. Geliştirici olarak karar bekleyen bir sekmede hedef değiştirmenin kapalı olmasını istiyorum (ilk dilimdeki kural sekme başına).
13. Geliştirici olarak karar bekleyen ya da Okuma transaction'ı açık bir sekmeyi kapatınca transaction'ın geri alınmasını istiyorum (ADR-0002).

### Yazma kilidi (sekme ve hedef başına)

14. Geliştirici olarak Yazma kilidinin sekme ve hedef başına olmasını istiyorum, böylece bir prod sekmesinde yazmayı açmam başka bir prod sekmesini yazılabilir yapmaz.
15. Geliştirici olarak sekmenin hedefi değişince Yazma kilidinin kapanmasını istiyorum.
16. Geliştirici olarak Yazma kilidinin diske yazılmamasını ve geri gelen sekmede her zaman kapalı (🔒) olmasını istiyorum, böylece dünkü açık kilit bugün beni yakalamaz.

### Okuma modu

17. Geliştirici olarak yalnızca `SELECT`, `TABLE`, `VALUES`, `SHOW`, ANALYZE'sız `EXPLAIN` ve DML içermeyen `WITH` ifadelerinden oluşan bir script'in Okuma modunda çalışmasını istiyorum, böylece her SELECT'te commit/rollback sorulmaz.
18. Geliştirici olarak Okuma modunun ortam etiketinden bağımsız olmasını istiyorum; prod'da da, dev'de de aynı şekilde `BEGIN READ ONLY` ile çalışmalı.
19. Geliştirici olarak Çalıştırma modu rozetinde "Okuma" yazmasını istiyorum, böylece script'in nasıl çalışacağını önceden bilirim.
20. Geliştirici olarak Okuma modunda karar kartı görmemek istiyorum.
21. Geliştirici olarak Okuma transaction'ının yalnızca sonuçlardan daha fazla satır çekebileyim diye açık kalmasını, sekmede yeniden çalıştırınca, sekmeyi kapatınca, soket kopunca ya da Karar süresi dolunca rollback ile kapanmasını istiyorum.
22. Geliştirici olarak Okuma modundaki bir ifade yazmaya çalışırsa (ör. `SELECT nextval(...)`, `25006`) hatanın yanında "Transaction modunda çalıştır" düğmesi görmek istiyorum, böylece tek tıkla karar kartlı çalıştırmaya geçerim.
23. Geliştirici olarak Okuma modunun bir okuma ifadesiyle yazma ifadesini karıştıran script'te devreye girmemesini istiyorum; böyle bir script Transaction modunda çalışmalı.

### Sonuç grid'i ve sonuç sekmeleri

24. Geliştirici olarak script'teki her SELECT'in sonucunu editörün altında kendi sonuç sekmesinde görmek istiyorum.
25. Geliştirici olarak yeniden çalıştırınca eski sonuç sekmelerinin silinmesini istiyorum, böylece eski ve yeni sonuçlar karışmaz.
26. Geliştirici olarak sağ sütunun (karar kartı + zaman çizelgesi) bugünkü gibi kalmasını istiyorum.
27. Geliştirici olarak ilk sayfada 500 satır görmek ve kaydırdıkça 500'er satır daha yüklenmesini istiyorum, böylece büyük sonuçlara bakabilirim.
28. Geliştirici olarak daha fazla satırın yalnızca transaction açıkken (karar beklerken ya da Okuma'da) çekilebilmesini; commit/rollback sonrasında yüklenen satırların kalmasını, "daha fazla"nın kapanmasını ve bunun sonuçta yazmasını istiyorum.
29. Geliştirici olarak sonuçta en fazla 100.000 satır yüklenmesini, sınıra ulaşınca "Sınıra ulaşıldı, filtrele" mesajını görmek istiyorum, böylece tarayıcı kilitlenmez.
30. Geliştirici olarak grid'de klavyeyle gezinmek (oklar, Home/End, PageUp/PageDown) ve fare ya da Shift ile aralık seçmek istiyorum.
31. Geliştirici olarak Ctrl/Cmd+C ile seçili aralığı başlıksız TSV olarak kopyalamak istiyorum: NULL boş yazılmalı, sekme ya da satır sonu içeren hücreler Excel tarzında tırnaklanmalı.
32. Geliştirici olarak sağ tıkla "INSERT olarak kopyala" seçebilmek istiyorum; konsol sonucunda tablo adı yer tutucu olmalı, `::tip` eki yalnızca tip katalogdan çözülürse eklenmeli.
33. Geliştirici olarak uzun ya da çok satırlı değerlerin tek satırda kırpılmış (`…`) ve satır sonlarının `↵` ile gösterilmesini istiyorum, böylece satır yükseklikleri sabit kalır.
34. Geliştirici olarak bir hücrenin tam değerini düzenleyiciyi açarak okuyabilmek istiyorum; konsol sonuçlarında düzenleyici salt okunur açılmalı.
35. Geliştirici olarak NULL'un boş metinden görsel olarak ayrışmasını istiyorum.
36. Geliştirici olarak kolon genişliğini başlıktan sürükleyerek ayarlayabilmek istiyorum; ilk genişlik ilk sayfadan ölçülmeli ve en fazla ~400 px olmalı.
37. Geliştirici olarak Postgres'in döndürdüğü değerleri ham metin olarak görmek istiyorum (tarih, sayı, json yeniden biçimlenmeden).

### Pool sınırı

38. Geliştirici olarak aynı hedefte en fazla 5 açık oturum olmasını ve sınırı aşan çalıştırmanın beklemeden "Bu hedefte N açık oturum var: Sekme X, Y…" hatası vermesini istiyorum, böylece bir sekmenin sessizce kuyrukta asılı kalmasını yaşamam.
39. Geliştirici olarak bu hatadaki sekme adlarına tıklayıp o sekmeye geçebilmek istiyorum, böylece hangisinin transaction'ı tuttuğunu kapatabilirim.
40. Geliştirici olarak katalog, tablo sayfası ve izleme sorgularının oturum tutmamasını (kısa süreli client) istiyorum, böylece sınır yalnızca sekmelerimin açık transaction'larıyla dolar.

### Sorgu geçmişi

41. Geliştirici olarak Ctrl+Alt+E / Cmd+Alt+E ile konsolda açılıp kapanan bir geçmiş paneli istiyorum.
42. Geliştirici olarak geçmişin varsayılan olarak aktif sekmenin hedefine göre filtrelenmesini istiyorum.
43. Geliştirici olarak tüm hedeflere geçebilmek, metin araması yapabilmek, sonuca (başarılı / hata / deneme / rollback) ve tarih aralığına göre filtreleyebilmek istiyorum.
44. Geliştirici olarak her kayıtta zamanı, hedefi (ortam rengiyle), sonucu ve script'in başını görmek istiyorum.
45. Geliştirici olarak sonucu bilinmeyen kayıtların (bitti satırı olmayan) "bilinmiyor" diye görünmesini istiyorum.
46. Geliştirici olarak bir kayda çift tıklayınca metninin yeni bir sekmede, kaydın hedefiyle açılmasını istiyorum, böylece mevcut sekmemin metnini ezmem.
47. Geliştirici olarak geçmişin yeniden eskiye sayfa sayfa yüklenmesini istiyorum, böylece aylarca biriken kayıtlar paneli yavaşlatmaz.
48. Geliştirici olarak hedefi artık var olmayan bir kaydı açınca metnin hedefsiz bir sekmede açılmasını istiyorum.

### Şema bilen tamamlama

49. Geliştirici olarak editörde görünür şemalardaki tablo, view ve materialized view adlarının tamamlanmasını istiyorum.
50. Geliştirici olarak bir tablonun kolonlarının tipleriyle birlikte tamamlanmasını istiyorum.
51. Geliştirici olarak `search_path`'in ilk şemasındaki tabloların öneksiz, diğerlerinin `şema.` ile tamamlanmasını istiyorum.
52. Geliştirici olarak yalnızca Veritabanı seçiminde görünür kıldığım şemaların tamamlamaya girmesini istiyorum.
53. Geliştirici olarak katalogun yalnızca bu oturumda elimle hedef seçtiğimde (panel / Ctrl+K) ya da sekmeyi ilk çalıştırdığımda okunmasını istiyorum; geri gelen sekmeler kendiliğinden katalog okumamalı.
54. Geliştirici olarak aynı hedefe bağlı sekmelerin aynı Katalog önbelleğini paylaşmasını istiyorum, böylece katalog her sekmede yeniden okunmaz.
55. Geliştirici olarak DDL içeren bir script commit ya da autocommit ile bitince katalogun yenilenmesini istiyorum, böylece yeni tablom hemen tamamlanır.
56. Geliştirici olarak katalogu "↻" ile elle yenileyebilmek istiyorum, böylece başka bir araçla yapılan şema değişikliklerini de görürüm.

### Tablo sekmesi

57. Geliştirici olarak veritabanı panelinde bir şema çipine tıklayınca o şemanın tablo listesini filtre kutusuyla görmek istiyorum.
58. Geliştirici olarak Cmd/Ctrl+K'da tablo adı arayıp tabloyu açabilmek istiyorum.
59. Geliştirici olarak bir tabloyu açınca editörsüz bir Tablo sekmesinde ilk sayfayı görmek istiyorum.
60. Geliştirici olarak Tablo sekmesi başlığında `≈ N satır` görmek istiyorum; tablo hiç analiz edilmediyse "≈ bilinmiyor" yazmalı, `0` değil.
61. Geliştirici olarak serbest `WHERE` ve `ORDER BY` kutularına SQL yazabilmek ve bu kutularda da tamamlama almak istiyorum.
62. Geliştirici olarak kolon başlığına tıklayınca `ORDER BY` kutusunun dolmasını istiyorum.
63. Geliştirici olarak filtre kutusuna birden fazla ifade ya da `;` yazarak tabloya başka bir şey yaptıramamak istiyorum; sorgu tek ifade olarak gönderilmeli.
64. Geliştirici olarak Tablo sekmesinin her ortamda `BEGIN READ ONLY` ile okumasını istiyorum.
65. Geliştirici olarak her sayfanın kısa, ayrı bir sorgu olmasını ve Tablo sekmesinin açık transaction tutmamasını istiyorum, böylece prod'da vacuum ufkunu tutmam.
66. Geliştirici olarak varsayılan sıralamanın PK'ya göre olmasını ve PK'lı tabloda sayfaların keyset ile çekilmesini istiyorum, böylece derin sayfalar da hızlı ve tutarlı olur.
67. Geliştirici olarak PK'sız tabloda ya da kendi `ORDER BY`'ımla sayfaların `OFFSET` ile çekilmesini ve sayfalar arası tutarlılığın garanti olmadığını söyleyen bir not görmek istiyorum.
68. Geliştirici olarak Tablo sekmesinin (hedef, tablo, filtre, sıralama) diske yazılmasını, açılışta geri gelmesini ama bağlanmamasını istiyorum.
69. Geliştirici olarak geri gelen bir Tablo sekmesini açtığımda "Yükle" gibi açık bir eylemle verinin çekilmesini istiyorum.
70. Geliştirici olarak filtrem hatalıysa Postgres hatasını kutunun yanında görmek istiyorum.

### Düzenlenebilir grid

71. Geliştirici olarak PK'lı bir tablonun Tablo sekmesinde hücreleri düzenleyebilmek istiyorum.
72. Geliştirici olarak PK'sız tabloda düzenlemenin kapalı olmasını ve nedenini görmek istiyorum.
73. Geliştirici olarak konsol sonuçlarının her zaman salt okunur olmasını istiyorum.
74. Geliştirici olarak F2, çift tık ya da yazmaya başlayarak düzenleyiciyi açmak; Enter ile kaydedip aşağı inmek, Shift+Enter ile yeni satır eklemek, Esc ile vazgeçmek, Tab / Shift+Tab ile kaydedip yana geçmek istiyorum.
75. Geliştirici olarak Ctrl/Cmd+Shift+N ya da sağ tıkla bir hücreyi NULL yapabilmek istiyorum; NULL ile boş metin ayrı olmalı.
76. Geliştirici olarak tüm tipleri (json ve diziler dahil) ham metin olarak düzenlemek istiyorum; dönüşümü Postgres yapmalı.
77. Geliştirici olarak `bytea` ve generated kolonların salt okunur olmasını istiyorum.
78. Geliştirici olarak satır ekleyebilmek ve silebilmek istiyorum; yeni satırda dokunmadığım kolonlar INSERT'e girmemeli, böylece DEFAULT'ları çalışır.
79. Geliştirici olarak değişen hücreleri, eklenen ve silinecek satırları grid'de işaretli görmek istiyorum.
80. Geliştirici olarak Tablo sekmesinde çok hücreli TSV yapıştırabilmek istiyorum: yapıştırma seçimin sol üst köşesinden başlamalı, boş hücre NULL olmalı, taşan satırlar yeni satır olmalı, taşan ya da salt okunur kolona denk gelen yapıştırma tümden reddedilmeli.
81. Geliştirici olarak sağ sütunda bekleyen değişiklikleri ve üretilen SQL'i sürekli görmek istiyorum, böylece neyin çalışacağını tam olarak bilirim.
82. Geliştirici olarak üretilen `UPDATE`'in yalnızca değişen kolonları içermesini ve `WHERE`'in tüm PK kolonlarını kullanmasını istiyorum.
83. Geliştirici olarak değerlerin `'…'::tip` literal olarak yazılmasını istiyorum, böylece önizlemede gördüğüm, kayda geçen ve konsola aktarılan SQL aynı olur.
84. Geliştirici olarak her ifadenin tam 1 satır etkilemesini istiyorum; etkilemezse çalıştırma durmalı, satır işaretlenmeli ve "satır değişmiş ya da silinmiş" denmeli.
85. Geliştirici olarak aynı hücreye yaptığım birden çok düzenlemenin tek değişiklikte birleşmesini ve ekleyip sildiğim bir satırın SQL üretmemesini istiyorum.
86. Geliştirici olarak SQL'in DELETE → UPDATE → INSERT sırasıyla üretilmesini istiyorum.
87. Geliştirici olarak "Uygula" ile üretilen script'in bu sekmede Transaction modunda çalışmasını, karar kartı, Karar süresi ve Çalıştırma kaydıyla, ek onay olmadan ilerlemesini istiyorum.
88. Geliştirici olarak "Dene" ile değişiklikleri Deneme modunda (PG18'de önce/sonra farkıyla) görmek istiyorum.
89. Geliştirici olarak "Konsola aktar" ile üretilen SQL'i aynı hedefte yeni bir konsol sekmesine taşıyabilmek istiyorum, böylece elle değiştirip çalıştırabilirim.
90. Geliştirici olarak prod'da 🔒 iken "Uygula"nın devre dışı olmasını ve yanında tek tıklık Yazma kilidi düğmesi görmek istiyorum; "Dene" kilitliyken de kullanılabilmeli.
91. Geliştirici olarak commit sonrasında sayfanın yeniden çekilmesini ve bekleyen değişikliklerin temizlenmesini istiyorum.
92. Geliştirici olarak rollback ya da hata sonrasında bekleyen değişikliklerin kalmasını istiyorum, böylece düzeltip yeniden deneyebilirim.
93. Geliştirici olarak bekleyen değişikliklerin diske yazılmamasını; bekleyen değişiklik varken sekmeyi kapatırsam uyarı görmek istiyorum.
94. Geliştirici olarak Tablo sekmesinde de "INSERT olarak kopyala"nın gerçek tablo adı ve kolon tipleriyle çalışmasını istiyorum.

### ALTER TABLE kolon ekleme

95. Geliştirici olarak Tablo sekmesi başlığındaki "+ Kolon" ile ad, tip, NULL / NOT NULL ve varsayılan ifade girerek kolon ekleyebilmek istiyorum.
96. Geliştirici olarak tip kutusunda yaygın tiplerin ve katalogdaki kullanıcı tiplerinin tamamlanmasını istiyorum.
97. Geliştirici olarak `ALTER TABLE "şema"."tablo" ADD COLUMN …` önizlemesinin her tuşta güncellenmesini istiyorum.
98. Geliştirici olarak "Uygula / Dene / Konsola aktar"ın düzenlenebilir grid'deki gibi çalışmasını istiyorum; "Dene" DDL şema farkını göstermeli.
99. Geliştirici olarak volatile bir varsayılan ifade (ör. `clock_timestamp()`, `random()`) girdiğimde "tablo yeniden yazılır" uyarısı görmek istiyorum.
100. Geliştirici olarak boş olmayan bir tabloya varsayılansız NOT NULL kolon eklerken "hata verecek" uyarısı görmek istiyorum.
101. Geliştirici olarak bu uyarıların beni engellememesini istiyorum; yine de çalıştırabilmeliyim.

### "Bekletiyorsun" göstergesi

102. Geliştirici olarak karar beklerken açık transaction'ımın kilitle beklettiği oturum sayısını karar kartında "⚠ N oturumu bekletiyorsun" olarak görmek istiyorum, böylece prod'da kararımı geciktirmem.
103. Geliştirici olarak Okuma modunda transaction açıkken de aynı göstergeyi görmek istiyorum.
104. Geliştirici olarak göstergenin üzerine gelince bekletilen oturumların listesini (pid, kullanıcı, uygulama, bekleme türü, sorgunun başı, süre) görmek istiyorum.
105. Geliştirici olarak yetkim olmadığı için ayrıntısı gelmeyen alanların "görünmüyor" diye yazmasını istiyorum; sayı yine doğru olmalı.
106. Geliştirici olarak göstergenin transaction kapanınca kaybolmasını istiyorum.

## Implementation Decisions

### Genel

- Katman sınırı değişmez: core saf (Node/DOM yok), server Node, web React + CodeMirror 6. Yeni saf mantığın tamamı core'dadır ve birim testlidir.
- Konsol ayrı bir çalıştırma modeli değildir (ADR-0003). Her konsol sekmesi kendi Script çalıştırma oturumunu (bugünkü `runScript` tutamacı = bir WS bağlantısı) tutar; ADR-0002'deki "tek client, kopmada rollback" sekme başına geçerlidir. Sekme kapatma, tutamacın kapanmasıdır.
- Yeni bağımlılık: `@tanstack/react-virtual` (^3.14.26). `@codemirror/autocomplete` doğrudan bağımlılık olarak eklenir (şimdi yalnızca `lang-sql`'in alt bağımlılığı).

### core: Çalıştırma modu (genişleme)

- `RunMode` kümesi `transaction | autocommit | okuma | karisik` olur. Okuma: script'teki tüm ifadeler okuma ifadesidir. Okuma ifadesi: ilk anahtar kelimesi `SELECT`, `TABLE`, `VALUES`, `SHOW` olan; `ANALYZE` seçeneği olmayan `EXPLAIN`; içinde `INSERT`/`UPDATE`/`DELETE`/`MERGE` geçmeyen `WITH`. `SELECT … INTO` ve `SELECT … FOR UPDATE/SHARE` okuma sayılmaz (temkinli taraf). Boş script Okuma değildir.
- Okuma ifadeleri ile yazma ifadelerinin karışımı Transaction modudur. Transaction dışı komut kuralları değişmez.
- Desen yanılırsa Postgres `25006` (read_only_sql_transaction) döner; bu kod core'da sabit olarak tanınır ve arayüze "Transaction modunda çalıştır" önerisi olarak yansır.
- Deneme modu Okuma script'inde anlamsızdır; Okuma script'inde "Dene" devre dışıdır.

### core: Script çalıştırma sözleşmesi (genişleme)

- `run` mesajına iki isteğe bağlı alan eklenir:
  - `zorlaTransaction`: içerik Okuma çıksa da Transaction modunda çalıştır (25006 sonrası düğme). Yalnızca Okuma → Transaction yönünde etkilidir; sunucu yine kendi analizini yapar.
  - `beklenenSatir`: `1` ise her ifadenin etkilediği satır sayısı tam 1 olmalıdır; değilse o ifade hata sayılır (SQLSTATE yok, ayrı bir hata türü `satirSayisi` ve "Satır değişmiş ya da silinmiş (N satır etkilendi)" mesajı), çalıştırma durur ve karar kartı yalnızca Rollback sunar. Yalnızca Tablo sekmesinin ürettiği script'lerde kullanılır.
- Yeni istemci mesajı: `dahaFazla{i}` — `i`. ifadenin sonucundan 500 satır daha.
- Sonuç olayları:
  - SELECT için `done.onizleme` ilk 500 satırı, kolon adlarıyla birlikte kolon tip OID'lerini ve `dahaVar` bayrağını taşır. Deneme önizlemeleri 100 satırda kalır.
  - Yeni sunucu olayı `satirlar{i, satirlar, dahaVar}`: `dahaFazla` yanıtı.
  - Yeni sunucu olayı `okumaAcik{kalanMs}`: Okuma script'i bitti, transaction yalnızca daha fazla satır için açık; karar sorulmaz.
  - Yeni sunucu olayı `bekletilenler{oturumlar}`: bkz. bekletme göstergesi.
  - `bitti` olayına `katalogYenilendi` bayrağı eklenir (DDL'li script commit/autocommit ile bitti, sunucu önbelleği tazeledi).
- Arayüzün çalıştırma görünümü (`applyEvent`) sonuç sekmelerini, yüklü satırları, "daha fazla" durumunu ("transaction kapandı, daha fazla satır çekilemez" notu dahil) ve 100.000 satır sınırını taşır.

### core: grid (yeni, saf)

- Sabitler: sayfa boyu 500, sert sınır 100.000 satır, hücreye basılan en fazla 1000 karakter, ilk kolon genişliği en fazla ~400 px.
- **Seçim ve gezinme**: aktif hücre + dikdörtgen aralık; ok, Shift+ok, Home/End, Ctrl+Home/End, PageUp/PageDown, Tab/Shift+Tab olaylarının yeni seçimi ürettiği saf durum fonksiyonları.
- **Hücre gösterimi**: değer → tek satır metin (satır sonu `↵`, 1000 karakter kırpma), NULL ayrı bir durum.
- **TSV**: aralık → başlıksız TSV (NULL boş; sekme, satır sonu ya da `"` içeren hücre `"…"` içinde, `"` → `""`) ve TSV → hücre matrisi (simetrik çözümleme; boş hücre NULL; `NULL` metni düz metin).
- **SQL literal üretici**: değer + tip adı → `'…'::tip` (tek tırnak ikilenir), NULL → `NULL`; tanımlayıcı tırnaklama. "INSERT olarak kopyala" ve Bekleyen değişiklik SQL'i aynı üreticiyi kullanır. Konsol sonucunda tablo adı yer tutucu `"tablo"`dur; tip adı yalnızca OID katalogdan çözülürse yazılır.
- **Bekleyen değişiklik deposu**: girdi tablo meta verisi (kolonlar, tipler, PK, salt okunur kolonlar) ve yüklü satırlar; olaylar hücre düzenle, NULL yap, satır ekle, satır sil, silmeyi geri al, TSV yapıştır; çıktılar hücre/satır işaretleri ve üretilen script. Kurallar:
  - Aynı hücreye çoklu düzenleme tek değişiklikte birleşir; orijinal değere dönen hücre değişiklikten düşer.
  - Eklenip silinen satır SQL üretmez; silinen satırdaki düzenlemeler düşer (silmeyi geri almak onları getirmez); silinecek satır düzenlenmez.
  - Eklenen satırlar grid'de yüklü satırların ardından, eklenme sırasıyla görünür; dokunulmayan hücreleri `DEFAULT` yazar.
  - Sıra DELETE → UPDATE → INSERT. `UPDATE "s"."t" SET <yalnızca değişen kolonlar> WHERE <tüm PK kolonları = orijinal PK değerleri>`; `DELETE … WHERE <PK>`; `INSERT` yalnızca dokunulan kolonlarla (hiçbiri dokunulmadıysa `DEFAULT VALUES`).
  - Yapıştırma sol üst köşeden başlar; taşan satırlar (grid'in yüklü + eklenen satırlarının ötesi) yeni satır; kolon taşması, salt okunur kolona ya da silinecek satıra denk gelme tüm yapıştırmayı reddeder (hata nedeniyle).
  - Her üretilen ifadenin hangi Bekleyen değişikliğe ait olduğu bilinir; hata gelen ifade indeksi satır işaretine çevrilir.

### core: Tablo sayfası SQL'i (yeni, saf)

- Girdi: şema, tablo, kolon listesi, PK kolonları, kullanıcı `WHERE` metni, kullanıcı `ORDER BY` metni, önceki sayfanın son PK değerleri ya da offset. Çıktı: tek ifade metni + parametre dizisi.
- Kullanıcı `ORDER BY` boşsa ve PK varsa keyset: `WHERE (<kullanıcı WHERE>) AND (pk1, pk2…) > ($1, $2…) ORDER BY pk1, pk2… LIMIT 500`. Aksi hâlde `ORDER BY <kullanıcınınki ya da PK ya da yok> LIMIT 500 OFFSET n` ve sonuçta "sayfalar arası tutarlılık garanti değil" notu.
- Kullanıcı `WHERE`'i olduğu gibi parantez içinde gömülür (`ORDER BY` listesi parantezsiz); sondaki `;` ve yorum atılır ki satır yorumu sorgunun devamını yutmasın. Tek ifade garantisini Postgres'in extended protocol'ü verir (çok ifade reddedilir), core ayrıca `;` sonrası boş olmayan metni ve psql `\` komutunu reddeder.
- Uygulanan filtre, ilk sayfası gelince sekmeye (ve diske) yazılır; reddedilen filtre kutuda kalır ama yazılmaz.
- `reltuples` gösterim kuralı: `-1` → "≈ bilinmiyor", aksi hâlde yuvarlanmış `≈ N satır`.
- Kolon başlığına tık → `ORDER BY "kolon"`, ikinci tık `DESC`, üçüncü tık temizler.

### core: Katalog → tamamlama (yeni, saf)

- Girdi: katalog satırları (şema, ilişki adı, tür `r|v|m|p|f`, kolon adı, `format_type` tipi) + Veritabanı seçimindeki görünür şemalar + `defaultSchema`. Çıktı: `@codemirror/lang-sql`'in `SQLNamespace` nesnesi; kolon tamamlamalarında tip `detail` olarak.
- Fonksiyonlar tamamlamaya girmez. Tanımlayıcılar gerektiğinde tırnaklı önerilir.
- Tablo listesi ve Cmd/Ctrl+K tablo araması aynı katalogdan, aynı modüldeki filtre fonksiyonuyla beslenir.

### core: ALTER kolon ekleme (yeni, saf)

- Girdi: şema, tablo, var olan kolonlar, kolon adı, tip metni, NOT NULL, varsayılan ifade metni. Çıktı: `ALTER TABLE "s"."t" ADD COLUMN "ad" tip [NOT NULL] [DEFAULT …];` (ad her zaman tırnaklı; tip ve varsayılan olduğu gibi) ve alan başına doğrulama hataları (boş ad/tip, var olan kolon adı — büyük/küçük harf duyarlı, tip ya da varsayılan kendi içinde kapanmıyor: dizge/yorum dışı `;`, satır yorumu ya da kapanmamış dizge/yorum ALTER'ın kalanını bozar). Hata varken de önizleme üretilir; Uygula/Dene/Konsola aktar kapalı kalır.
- Lint (engellemez): (a) varsayılan ifadede geçen fonksiyon adları ifade bölücünün lexer'ıyla çıkarılır (`Statement.calls`: ardından `(` gelen çıplak ad küçük harfle, tırnaklı ad olduğu gibi; şema öneki atılır); sunucudan gelen oynaklık bilgisinde biri `v` (volatile) ise "Tablo yeniden yazılır" uyarısı; (b) NOT NULL + varsayılan yok + tabloda satır var ise "Boş olmayan tabloda hata verecek" uyarısı. Satır var: filtresiz ilk sayfa kesin söyler; filtre hiçbir satırı tutmadıysa ya da sayfa yüklenmediyse `reltuples` tahminine bakılır (filtreli boş sayfada tahmin bilinmiyorsa var sayılır).
- Tip önerileri: sabit yaygın tip listesi (`text`, `varchar(n)`, `integer`, `bigint`, `numeric`, `boolean`, `date`, `timestamptz`, `uuid`, `jsonb`, …) + katalogdaki kullanıcı tipleri.

### core: Geçmiş filtresi (yeni, saf)

- Girdi: Çalıştırma kayıtları (ilk dilimdeki `parseRecords` çıktısı) + filtre (hedef ya da tümü, metin araması, sonuç kümesi, tarih aralığı). Çıktı: yeniden eskiye sıralı kayıtlar.
- Sonuç eşlemesi: *başarılı* = `commit`, Autocommit başarısı ve `okuma`; *hata* = `hata`, `iptal`; *deneme* = `deneme-rollback`; *rollback* = `rollback`, `karar-suresi-doldu`, `kopma-rollback`. "bilinmiyor" ayrı gösterilir, filtresi yoktur (her zaman görünür).
- Çalıştırma kaydına yeni sonuç değeri `okuma` eklenir (Okuma script'i rollback ile kapandı). Kayıt sürümü `v` değişmez; eski okuyucular bilinmeyen değeri yalnızca gösterir.

### core: Sekme kalıcılığı (yeni, saf)

- Sürümlü biçim: sekme listesi (sıra), aktif sekme kimliği; her sekme için kimlik, tür (`konsol` | `tablo`), hedef (bağlantı id, veritabanı, şema; boş olabilir); konsol sekmesinde metin; Tablo sekmesinde şema, tablo, `WHERE`, `ORDER BY`. Yazma kilidi, sonuçlar ve Bekleyen değişiklikler biçimde yoktur.
- Ayrıştırıcı toleranslıdır: bozuk sekme atlanır, kalanlar geri gelir.
- Şema seçimi `search_path`'i değiştirmez; hedefin tanımı bağlantı + veritabanıdır, şema panel ve Tablo sekmesi bağlamıdır.

### server

- **Pool**: hedef başına en fazla 5 client (3'ten). Script çalıştırmalar sınırı aşarsa beklemeden yapısal `havuzDolu` hatasıyla döner (bitti/hata olayında kod); arayüz mesajı kendi bildiği açık sekmelerle kurar. Katalog, tablo sayfası, oynaklık ve bekletme sorguları kısa süreli client kullanır; havuz doluysa (pool'un tüm client'ları — oturumlar + kısa süreli yer — kullanımda) bekletme tiki kuyrukta beklemeden atlanır, diğerleri hata döner. Kısa süreli client'ın bağlantısı sorgu sürerken düşerse süreç çökmez: sorgu hatayla döner, client pool'a dönmez.
- **Script çalıştırıcı**:
  - Okuma modu: `BEGIN READ ONLY` (ortamdan bağımsız) + `SET LOCAL idle_in_transaction_session_timeout` (Karar süresi + 1 dk). Son ifadeden sonra `okumaAcik` gönderilir ve Karar süresi zamanlayıcısı başlar; dolunca rollback. Yeni `run`, soket kapanması ya da kopma rollback yapar. Çalıştırma kaydı sonucu `okuma`.
  - SELECT ifadeleri (tüm modlarda) ifade başına `WITHOUT HOLD` imleçle çalışır: `DECLARE … CURSOR`, ilk `FETCH 500`. İmleç transaction açıkken (karar beklerken ya da Okuma'da) yaşar; `dahaFazla{i}` yalnızca o sırada `FETCH 500` yapar, aksi hâlde uyarı döner. 100.000 satır sınırı sunucuda da uygulanır. `MOVE FORWARD ALL` ile satır sayısı sayımı kaldırılır; `rowCount` yalnızca imleç sonuna gelindiyse bilinir.
  - Autocommit modunda SELECT olmadığından imleç yoktur.
  - `beklenenSatir` seçeneği her ifadenin `rowCount`'unu denetler.
  - DDL içeren script commit ya da autocommit ile bitince o hedefin Katalog önbelleği yeniden okunur, `bitti.katalogYenilendi` true olur.
- **Bekletme izleyicisi**: transaction karar beklerken ya da Okuma'da açıkken, 5 sn'de bir (ilk tik karar/Okuma başladıktan 5 sn sonra) kısa süreli client ile `SELECT pid, usename, application_name, wait_event_type, left(query, 200) AS sorgu, floor(extract(epoch FROM now() - query_start))::int AS sure_sn FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid)) ORDER BY pid` (`$1` = çalıştırmanın backend pid'i; süre bekletilen oturumun sorgusu başlayalı geçen saniye). Sonuç (süre dahil; bekletilen varken her tikte) değişince `bekletilenler{oturumlar}` gönderilir; transaction kapanınca izleme durur, son gönderilen liste boş değilse boş liste gönderilir. NULL alanlar olduğu gibi, Postgres'in yetkisiz kullanıcıya verdiği `<insufficient privilege>` sorgu metni de NULL olarak iletilir. İptal/sonlandırma yok.
- **Katalog önbelleği**: süreç belleğinde hedef başına. İçerik: görünür şemaların tablo/view/matview/partitioned/foreign ilişkileri ve kolonları (`format_type` tipi, tip OID, `attnotnull`, `atthasdef`, `attgenerated`), ilişki başına PK kolonları ve `reltuples`, ayrıca görünür şemalar + `pg_catalog` için tip OID → ad haritası ve kullanıcı tipleri. `defaultSchema` = `current_schemas(false)[1]`. Önbellek yalnızca istemcinin açık isteğiyle (kullanıcı eylemi) doldurulur; bağlantı kesilince/silinince ve Veritabanı seçimi değişince atılır.
- **Tablo sayfası**: kısa süreli client, `BEGIN READ ONLY`, core'un ürettiği tek ifade extended protocol ile (parametreli), `COMMIT`. `RAW_TYPES` ile ham metin. Açık imleç/transaction tutmaz; Çalıştırma kaydına yazılmaz.
- **Çalıştırma kayıtları okuyucu**: aylık JSONL dosyalarını yeniden eskiye okur, core filtresini uygular, sayfa + sonraki imleç döndürür.
- **Sekme deposu**: OS yapılandırma dizininde `tezgah.json` dışında bir konsol dizini; atomik yazma (geçici dosya + rename), POSIX'te `0600`. İçerik core'daki kalıcılık biçimidir.

### API sözleşmesi (eklenenler)

- **REST**:
  - `GET /api/calistirma-kayitlari` (filtre parametreleri + sayfa imleci) → kayıtlar, sonraki imleç.
  - Katalog: hedef için getir (önbellekte yoksa okur; yalnızca kullanıcı eylemiyle çağrılır) ve yenile (↻).
  - Tablo sayfası (`POST …/veritabanlari/:db/tablo-sayfasi`, tipler `core/tablo-sayfasi.ts`'te): hedef, şema, tablo, `WHERE`, `ORDER BY`, `sonraki` imleci (ilk sayfada `null`; keyset değerleri ya da offset'i sunucu üretir) → kolonlar, kolon tip OID'leri, katalogdaki PK kolonları (`pk`; boşsa düzenleme kapalı), katalogdaki üretilmiş kolonlar (`uretilmis`; salt okunur), satırlar, `sonraki` imleci (son sayfada `null`), tutarlılık notu, ilk sayfada `satirTahmini` (`reltuples`) ya da 400: Postgres hatası (SQLSTATE, mesaj, konum) ya da çok ifadeli filtrenin reddi; hata bir filtre kutusundaysa `kutu` (`where` | `orderBy`) ve `kutuKonumu` (kutunun metnindeki 1 tabanlı konum; kutudan hemen sonraki `)`/`LIMIT`'e düşen yarım ifade hatası kutunun sonu sayılır).
  - Fonksiyon oynaklığı (`POST …/veritabanlari/:db/fonksiyon-oynakligi`, tipler `core/kolon-ekle.ts`'te): `{ fonksiyonlar }` (en fazla 100 ad) → `{ oynaklik }`, ad başına `i|s|v` (ALTER lint'i için; `pg_proc`, şema ayırt edilmez, aşırı yüklemelerden en oynak olanı; katalogda olmayan ad yanıtta yok). Boş listede hedefe bağlanılmaz; geçersiz gövde 400, hedef hatası 502.
  - Konsol sekmeleri: oku ve yaz (tüm biçim; arayüz değişikliklerde debounce ile yazar).
- **WebSocket**: `run`'a `zorlaTransaction?`, `beklenenSatir?`; yeni istemci mesajı `dahaFazla{i}`; yeni sunucu olayları `satirlar`, `okumaAcik`, `bekletilenler`; `done.onizleme`'ye tip OID'leri ve `dahaVar`; `bitti`'ye `katalogYenilendi` ve `havuzDolu` kodu; `analiz.mod`'a `okuma`.
- **ApiClient** bu uçları ve olayları kapsayacak biçimde genişler; web sunucuyu yine yalnızca bunun üzerinden görür.

### web

- **Konsol yerleşimi**: hedef başlığının üstünde sekme şeridi (konsol ve Tablo sekmeleri, ortam rengi, kapat, yeni). Konsol sekmesi: solda editör, altında sonuç sekmeleri ve grid; sağda bugünkü sağ sütun (karar kartı + zaman çizelgesi). Geçmiş paneli Ctrl/Cmd+Alt+E ile açılır kapanır.
- **Sonuç grid'i**: kendi DOM grid'imiz + `@tanstack/react-virtual`, yalnızca satır sanallaştırması, sabit satır yüksekliği. `role="grid"`, toplam bilinmezken `aria-rowcount="-1"`, `aria-rowindex`/`aria-colindex`/`aria-selected`, roving tabindex. Sona yaklaşınca `dahaFazla` (konsol) ya da sonraki sayfa (Tablo sekmesi) istenir. Davranışın kendisi core/grid'dedir; bileşen olayları core'a iletir ve sonucu çizer.
- **Düzenleyici**: hücrenin üstünde açılan, büyüyen tek `<textarea>`; tuşlar US-74/75'teki gibi. Düzenleyiciden çıkmak (başka hücreye tıklama, odağın gitmesi) dokunulan değeri kaydeder; yalnızca Esc vazgeçer. Dokunulmadan kapatılan kutu kaydedilmez (NULL boş metne dönmez). Düzenleme kapalıyken (konsol sonucu, PK'sız tablo, Uygula sürerken) tam değer salt okunur açılır ve nedeni kutunun altında yazar.
- **Tablo sekmesi**: başlık (tablo adı, `≈ N satır`, "+ Kolon", ↻), filtre/sıralama çubuğu (CodeMirror tek satırlık, katalog tamamlamalı), düzenlenebilir tabloda grid'in üstünde "Satır ekle" (eklenen satıra gider) ve kısayol ipucu, grid (sağ tık: NULL yap, Satır ekle, Satırları sil / Silmeyi geri al, INSERT olarak kopyala); sağ sütunda Bekleyen değişiklikler + SQL önizlemesi + Uygula/Dene/Konsola aktar + karar kartı. "+ Kolon" formu aynı sağ sütunda (PK'sız tabloda da) açılır; açıkken bekleyen değişiklik listesinin yerini alır, kendi Uygula/Dene/Konsola aktar çubuğu vardır, ALTER `beklenenSatir` olmadan çalışır. Formu açmak hedefin katalogunu (yoksa) ister (kullanıcı tipleri); tip kutusu `<datalist>` ile önerir; oynaklık varsayılan ifadede yeni ad görülünce 300 ms duraklamadan sonra sorulur. Commit sonrası form kapanır, `katalogYenilendi` ise arayüz katalogu yeniden çeker, sayfa yeniden çekilir; bekleyen grid değişiklikleri kalır. Rollback/hata/Dene sonrası form değerleriyle kalır.
- **Veritabanı paneli**: şema çipine tıklayınca tablo listesi (filtre kutulu) açılır; listeden tıklama Tablo sekmesi açar. Cmd/Ctrl+K'ya "Tablolar" grubu eklenir (yalnızca önbelleği dolu hedeflerden).
- **Tamamlama**: editöre katalogdan üretilen `SQLNamespace` ile `lang-sql` `schema` + `defaultSchema` verilir; katalog değişince yeniden yapılandırılır.
- **Bekletme göstergesi**: karar kartında (ve Okuma açıkken kartın yerindeki ince durum satırında) "⚠ N oturumu bekletiyorsun"; üzerine gelince liste; NULL alanlar "görünmüyor".

## Testing Decisions

- **İyi test**: yalnızca dış davranışı sınar (girdi → çıktı, istek → yanıt / olay dizisi, kullanıcı etkileşimi → ekranda görünen). İç durum, özel fonksiyonlar ve çağrı sıraları test edilmez.
- **Test sınırları**: ilk dilimin üç sınırı aynen kullanılır, yeni sınır eklenmez (kullanıcıyla doğrulandı).
  1. **core genel arayüzleri: Vitest tablo testleri.**
     - Çalıştırma modu: her okuma deseni, ANALYZE'lı EXPLAIN, DML'li `WITH`, `SELECT INTO`, `FOR UPDATE`, karışık script, boş script.
     - grid: seçim/gezinme olayları, gösterim kırpması, TSV kopyalama ve geri çözümleme (tırnak, sekme, satır sonu, NULL, `NULL` metni), literal üretici (tırnak ikileme, NULL, tipsiz), Bekleyen değişiklik deposu (birleştirme, orijinale dönüş, eklenip silinen, sıra DELETE → UPDATE → INSERT, DEFAULT kolonlar, `DEFAULT VALUES`, çok kolonlu PK, yapıştırma taşması ve salt okunur kolonda ret, ifade → değişiklik eşlemesi).
     - Tablo sayfası SQL'i: keyset (tek ve çok kolonlu PK), kullanıcı ORDER BY ile OFFSET, PK'sız tablo, boş WHERE, `;` reddi, `reltuples = -1`, başlık tıklama döngüsü.
     - Katalog → `SQLNamespace`: görünür şema filtresi, `defaultSchema`, tırnak gerektiren adlar, tablo arama filtresi.
     - ALTER: SQL üretimi, doğrulama, iki lint kuralı.
     - Geçmiş filtresi: sonuç eşlemesi, "bilinmiyor", metin araması, tarih aralığı, hedef filtresi.
     - Sekme kalıcılığı: gidiş-dönüş, bozuk girdinin atlanması, Yazma kilidinin biçimde olmaması.
     - Çalıştırma görünümü: `satirlar`, `okumaAcik`, `bekletilenler` olayları, transaction kapanınca "daha fazla"nın kapanması, 100.000 sınırı.
  2. **server: HTTP REST + WS dış sınırında entegrasyon testleri.** Sahte Postgres yeterli olan yerlerde o, imleç/transaction/kilit davranışında `TEZGAH_TEST_PG_URL` varsa gerçek Postgres; saat, keychain ve dizinler enjekte.
     - Okuma: `BEGIN READ ONLY`, karar olmadan `okumaAcik`, yeniden çalıştırmada/soket kapanmada/Karar süresinde rollback (sahte saat), 25006 + `zorlaTransaction`.
     - İmleç: ilk 500, `dahaFazla` ile sonraki sayfa, commit sonrası `dahaFazla` reddi, 100.000 sınırı.
     - `beklenenSatir`: 0 ve 2 satır etkileyen ifadede durma ve hata türü.
     - Pool: 6. açık çalıştırmada `havuzDolu`; katalog isteğinin sınırı doldurmaması.
     - Katalog: içerik, görünür şema filtresi, DDL commit sonrası `katalogYenilendi`, açılışta hiçbir sorgu gitmemesi.
     - Tablo sayfası: keyset/OFFSET, `BEGIN READ ONLY`, çok ifadeli filtrenin reddi, prod'da da okuma, kayda yazılmama.
     - Bekletme: gerçek PG'de ikinci bir client ile kilit bekletip `bekletilenler` olayı; transaction kapanınca boş liste.
     - Çalıştırma kayıtları ucu: geçici dizindeki çok aylık JSONL fixture'larıyla sayfalama ve filtre; `okuma` sonucu.
     - Sekme deposu: atomik yazma, gidiş-dönüş.
  3. **web: bileşen testleri** (Vitest + Testing Library + jsdom), seam `ApiClient` sahtesidir. Grid jsdom'da `@tanstack/react-virtual`'ın `initialRect` (ya da enjekte `observeElementRect`) seçeneğiyle ve sabit satır yüksekliğiyle çizilir.
     - Sekmeler: açma/kapama, hedefin sekmeye göre değişmesi, geri gelen sekmede kilidin kapalı olması ve hiçbir API çağrısı yapılmaması, `havuzDolu` mesajındaki sekme bağlantıları.
     - Okuma rozeti, karar kartının çıkmaması, 25006 düğmesi.
     - Sonuç sekmeleri, kaydırınca `dahaFazla`, kapanan transaction notu, sınır mesajı.
     - Grid: gezinme, aralık seçimi, Ctrl/Cmd+C (pano sahtesi), "INSERT olarak kopyala", düzenleyici tuşları, NULL kısayolu, yapıştırma ve reddi, işaretler.
     - Tablo sekmesi: `≈ N satır`/"≈ bilinmiyor", filtre hatası, başlık tıklama, PK'sız tabloda düzenlemenin kapalı olması, SQL önizlemesi, prod 🔒'da Uygula devre dışı + Dene açık, commit sonrası yeniden çekme, rollback sonrası bekleyenlerin kalması, kapatma uyarısı, Konsola aktar.
     - "+ Kolon": canlı önizleme ve lint uyarıları.
     - Geçmiş paneli: kısayol, varsayılan hedef filtresi, çift tıkla yeni sekme.
     - Tamamlama: katalogun yalnızca kullanıcı eylemiyle istenmesi; CodeMirror'ın kendi tamamlama davranışı test edilmez, yalnızca editöre verilen yapılandırma.
     - Bekletme göstergesi: sayı, liste, "görünmüyor".
- **Prior art**: core'da `calistirma-modu`, `deneme-farki`, `calistirma-kaydi`, `ifade-bolme` testleri (tablo tabanlı); server'da `script-calistirici.test.ts`, `deneme.test.ts`, `calistirma-kayitlari.test.ts`, `yazma-kilidi.test.ts` (sahte Postgres, `describePg`, test soketi `waitFor`); web'de `ScriptEkrani.test.tsx`, `VeritabaniPaneli.test.tsx`, `HizliGecis.test.tsx` (sahte API, sahte çalıştırmalar).

## Out of Scope

- Araştırmanın 2., 3. ve 4. bölümleri: imleçteki ifadeyi çalıştırma, `RAISE NOTICE` gösterimi, dışa aktarma, EXPLAIN görselleştirme, oturum paneli vb.
- Sonuç sekmesi sabitleme; konsol sonuçlarını düzenleme; tamamlamada fonksiyonlar.
- Kolon başına filtre arayüzü; `WITH HOLD` imleç.
- Kolon silme, yeniden adlandırma, tip değiştirme; `bytea` düzenleme.
- Bekletilen oturumları iptal etme ya da sonlandırma (araştırma 3.2).
- Grid: CSV olarak ya da başlıklarla kopyalama, doldurma, değer paneli, tooltip, kolon sanallaştırması, kolon genişliğini diske yazma.
- Şema seçimine göre `search_path` ayarlama.
- Şema tasarımı, ER diyagramı, Postgres dışı veritabanları.

## Further Notes

- **Uygulama sırası** (harita kararı: araştırma başlık sırası 1.1 → 1.7; her ticket tek başına test edilebilir):
  1. core grid temeli (seçim/gezinme, gösterim, TSV, literal üretici) + salt okunur grid bileşeni.
  2. 1.1a Sekmeler ve sekme kalıcılığı; Yazma kilidinin sekme + hedef başına olması; pool 5 ve `havuzDolu`.
  3. 1.1b Okuma modu (core + sunucu + rozet + 25006 düğmesi).
  4. 1.1c Sonuç sekmeleri, 500'lük imleç sayfaları, `dahaFazla`, 100.000 sınırı, INSERT olarak kopyala.
  5. 1.2 Sorgu geçmişi (uç + core filtre + panel; `okuma` sonuç değeri).
  6. 1.3 Katalog önbelleği + tamamlama + DDL sonrası yenileme.
  7. 1.4 Tablo sekmesi (tablo listesi, Cmd/Ctrl+K tablo araması, sayfa SQL'i, `reltuples`).
  8. 1.5 Düzenlenebilir grid (Bekleyen değişiklik deposu, `beklenenSatir`, Uygula/Dene/Konsola aktar, yapıştırma).
  9. 1.6 "+ Kolon" (ALTER üretici, oynaklık ucu, lint).
  10. 1.7 Bekletme göstergesi.
- **Bilinen riskler**: aralık seçimi, gezinme, pano ve kolon boyutlandırma bizim kodumuz (iş yükü); odaklı hücre kaydırmayla DOM'dan çıkınca odak kaybı; uzun Okuma transaction'ları prod'da vacuum ufkunu Karar süresi kadar tutabilir (Karar süresi prod'da 5 dk ile sınırlı); `pg_blocking_pids` sık çağrıda maliyetli olabilir (5 sn aralık); sona eklemede bellek büyümesi (100.000 sınırı).
- **ADR ve sözlük**: ADR-0003, ADR-0004 ve GLOSSARY güncellemeleri (Sekme, Okuma modu, Tablo sekmesi, Bekleyen değişiklik, Katalog önbelleği, sekme + hedef başına Yazma kilidi) bu spec'ten önce yazıldı; uygulama sırasında yeni terim çıkarsa sözlüğe eklenir.
- **README'de belgelenecekler**: Okuma modunun yanılabileceği ve Postgres'in `25006` ile koruduğu; Tablo sekmesi `OFFSET` sayfalarının tutarlılık garantisi olmadığı; sekme dosyalarının düz metin olduğu (script'teki sırlar maskelenmez).
- **Araştırma bulguları**: `research/grid-kutuphanesi` dalı (merge edilmez).
