# Spec: İlk dilim (bağlantı yönetimi + script çalıştırma)

Status: ready-for-agent

Kaynak: [İlk dilim haritası](map.md). Her karar ayrıntısıyla kendi ticket'ında; bu spec onları birleştirir. Terimler [GLOSSARY.md](../../GLOSSARY.md)'deki anlamlarıyla kullanılır (Bağlantı, Veritabanı seçimi, Hedef, Ortam etiketi, Tünel, İçe aktarma adayı, Transaction dışı komut, Çalıştırma modu, Deneme modu, Karar süresi, Çalıştırma kaydı). İlgili ADR'ler: ADR-0001 (yerel erişim anahtarı), ADR-0002 (kopmada rollback).

## Problem Statement

PostgreSQL ile çalışırken birçok sunucuya (local, dev, staging, prod; bazıları SSH arkasında) bağlanıyorum ve oralarda migration benzeri SQL script'leri çalıştırıyorum. IntelliJ'in veritabanı aracı ağır. Asıl daha büyük sorun şu: bir script'in hangi sunucuda ve hangi veritabanında çalışacağını her an net görmüyorum, prod'a yanlışlıkla yazma riski var, script yarıda hata verdiğinde neyin uygulanıp neyin uygulanmadığını anlamak zor ve `VACUUM` ya da `CREATE INDEX CONCURRENTLY` gibi komutlar transaction içinde patlıyor. Bağlantılarım IntelliJ'de ve `.pgpass`'ta duruyor; şifreleri düz dosyalarda tutmak istemiyorum.

## Solution

Tezgah, `npx` ile terminalden başlatılan, yalnızca `127.0.0.1`'de dinleyen ve tarayıcıda açılan kişisel bir araçtır. İlk dilim iki şey sunar:

1. **Bağlantı yönetimi**: klasörlenmiş bir bağlantı listesi, ortam etiketleri ve renkler, şifrelerin işletim sisteminin anahtar zincirinde saklanması, SSL ve SSH tüneli, "bağlantıyı test et", sunucudaki veritabanlarından görünür olanların ve şemaların seçilmesi, Cmd/Ctrl+K ile hızlı hedef değiştirme, IntelliJ `dataSources.xml` ve `.pgpass`'tan önizlemeli içe aktarma.
2. **Script çalıştırma**: tek bir SQL editörü ve büyük bir hedef başlığı. Script ifade ifade, aynı bağlantıda ve transaction içinde çalışır. İfade başına canlı durum gösterilir; hatada durulur ve hatalı satır işaretlenir. Sonunda süreli bir commit/rollback kararı istenir. Deneme modu ne değişeceğini gösterip her zaman geri alır. Transaction dışı komutlar tanınır ve Autocommit modunda çalışır. prod hedefleri varsayılan olarak salt okunurdur. Her çalıştırma bir Çalıştırma kaydına yazılır.

## User Stories

### Başlatma ve yerel güvenlik

1. Geliştirici olarak Tezgah'ı tek bir `npx` komutuyla başlatmak istiyorum, böylece imzalı bir kurulum paketine gerek kalmaz.
2. Geliştirici olarak `npx` ile ilk kurulumun native derleme yapmadan, sessiz ve hızlı bitmesini istiyorum, böylece makineye göre değişen gecikmeler ve araç zinciri diyalogları yaşamam.
3. Geliştirici olarak Tezgah açılınca tarayıcının kendiliğinden doğru adreste açılmasını ve terminalde de bu adresin yazmasını istiyorum, böylece tarayıcı açılmazsa adresi kopyalayabilirim.
4. Geliştirici olarak sunucunun yalnızca `127.0.0.1`'e bağlanmasını istiyorum, böylece ağdaki başka makineler Tezgah'a ulaşamaz.
5. Geliştirici olarak her açılışta yeni bir erişim anahtarı üretilmesini ve her isteğin bu anahtarla doğrulanmasını istiyorum, böylece makinedeki başka web sayfaları veritabanlarıma istek gönderemez.
6. Geliştirici olarak DNS rebinding ve CSRF saldırılarının engellenmesini istiyorum, böylece kötü niyetli bir site tarayıcım üzerinden Tezgah'ı kullanamaz.
7. Geliştirici olarak istersem sabit bir port seçebilmek istiyorum, böylece yer imleri ve alışkanlıklarım bozulmaz.
8. Geliştirici olarak Tezgah açıldığında hiçbir sunucuya bağlanılmamasını istiyorum, böylece yalnızca benim açtığım bağlantılar ağ trafiği oluşturur.

### Bağlantı listesi ve klasörler

9. Geliştirici olarak bağlantılarımı klasörler hâlinde gruplanmış bir listede görmek istiyorum, böylece çok sayıda sunucu arasında kaybolmam.
10. Geliştirici olarak klasörleri kenar çubuğundan ya da Ctrl+K komutuyla oluşturabilmek istiyorum.
11. Geliştirici olarak bir klasörü sağ tıkla yeniden adlandırabilmek ve silebilmek istiyorum; silinen klasördeki bağlantılar silinmemeli, "Klasörsüz" bölümüne taşınmalı.
12. Geliştirici olarak bir bağlantıyı sürükle-bırakla ya da menüdeki "Klasöre taşı" ile başka klasöre taşıyabilmek istiyorum.
13. Geliştirici olarak her bağlantı satırında ortam rengini, adını, tünel işaretini, bağlantı durumunu (bağlanıyor / bağlı / hata) ve `kullanıcı@host[:port]` bilgisini görmek istiyorum, böylece satırı açmadan nereye gittiğini bilirim.
14. Geliştirici olarak prod bağlantılarının listede kırmızı bir şeritle ayrışmasını istiyorum.
15. Geliştirici olarak mevcut hedefin hangi bağlantıda olduğunu listede görmek istiyorum.
16. Geliştirici olarak bağlantı menüsünden hedef yapma, bağlanma/yenileme, düzenleme, kopyalama, klasöre taşıma, şifresiz URL kopyalama, bağlantıyı kesme ve silme işlemlerini yapabilmek istiyorum.
17. Geliştirici olarak bir bağlantıyı kopyaladığımda "ad (kopya)" adıyla yanına yenisinin oluşmasını, sırların yeni kimlik altına kopyalanmasını ve formun açılmasını istiyorum, böylece benzer bir sunucuyu hızla eklerim.
18. Geliştirici olarak bir bağlantıyı silerken ayarın ve keychain'deki sırların silineceğini, Çalıştırma kayıtlarının kalacağını ve işlemin geri alınamayacağını söyleyen bir onay görmek istiyorum.
19. Geliştirici olarak "Bağlantıyı kes" ile o bağlantının pool'larını ve tünelini kapatabilmek istiyorum.

### Bağlantı formu

20. Geliştirici olarak kısa bir formda ad, klasör, host, port, kullanıcı, şifre, başlangıç veritabanı ve ortam etiketi girerek bağlantı oluşturmak istiyorum.
21. Geliştirici olarak ortam etiketini sabit kümeden (`local`, `dev`, `test`, `staging`, `prod`) seçip rengini değiştirebilmek istiyorum; etiket opsiyonel olmalı.
22. Geliştirici olarak forma bir `postgres://` ya da `postgresql://` URL'i yapıştırıp alanların otomatik dolmasını istiyorum (host, port, kullanıcı, şifre, veritabanı, `sslmode`, `sslrootcert`, `sslcert`, `sslkey`).
23. Geliştirici olarak URL'deki tanınmayan parametrelerin "yok sayıldı" diye listelenmesini; çok host'lu URL'lerin, geçersiz `sslmode`'un ve başka şemaların ise reddedilmesini istiyorum.
24. Geliştirici olarak URL'in saklanmamasını ve URL'deki şifrenin şifre alanına gidip kaydedince keychain'e yazılmasını istiyorum.
25. Geliştirici olarak SSL/TLS ve SSH ayarlarının katlanır bölümlerde durmasını ve kapalıyken tek satırlık bir özet göstermesini istiyorum, böylece form kısa kalır.
26. Geliştirici olarak `sslmode`'u seçince modun ne yaptığını açıklayan bir satır görmek istiyorum; CA dosyası alanı yalnızca `require` ve üstü modlarda görünmeli.
27. Geliştirici olarak prod etiketli bir bağlantıda `sslmode` `verify-full` değilse "verify-full önerilir · Uygula" önerisini görmek istiyorum.
28. Geliştirici olarak SSH tünelini açıp host, port, kullanıcı ve kimlik doğrulama yöntemini (şifre / anahtar dosyası / agent) seçebilmek istiyorum.
29. Geliştirici olarak anahtar dosyasıyla kimlik doğrulamada yalnızca dosya yolunun saklanmasını ve özel anahtarın diskte yerinde kalmasını istiyorum.
30. Geliştirici olarak agent ile kimlik doğrulamada macOS'ta `SSH_AUTH_SOCK`'un, Windows'ta OpenSSH agent pipe'ının varsayılan olarak kullanılmasını; Pageant için pipe yolunu elle girebilmeyi istiyorum.
31. Geliştirici olarak her sır alanının (DB şifresi, SSH şifresi ya da passphrase) altında varsayılan açık bir "Keychain'e kaydet" seçeneği istiyorum; kapalıyken "her açılışta ilk bağlanmada sorulur, yalnızca bellekte" uyarısı görünmeli.
32. Geliştirici olarak kayıtlı bir sır varsa sır alanı yerine "keychain'de kayıtlı · değiştir" görmek istiyorum.
33. Geliştirici olarak bağlantıyı test etmeden de kaydedebilmek istiyorum; Kaydet test istememeli ve uyarı göstermemeli.

### Bağlantıyı test et

34. Geliştirici olarak "Bağlantıyı test et"in formdaki kaydedilmemiş değerlerle çalışmasını ve hiçbir şey kaydetmemesini istiyorum (host anahtarı onayı hariç).
35. Geliştirici olarak testin adım adım ilerlemesini istiyorum: sırlar, SSH tüneli, sunucuya ulaşma, TLS, kimlik doğrulama, veritabanlarını listeleme. İlk hatada durulmalı, kalan adımlar "çalıştırılmadı" diye gösterilmeli.
36. Geliştirici olarak her adımın sonucunu ait olduğu form bölümünde görmek istiyorum; hatalı bölüm kendiliğinden açılmalı ve ilgili alan kırmızı olmalı.
37. Geliştirici olarak hata satırlarında tek tıkla düzeltme düğmeleri istiyorum ("Port'u düzelt", "SSH tüneli ekle", "CA dosyası seç", "verify-ca dene", "postgres kullan", "Tekrar dene").
38. Geliştirici olarak `prefer` modunda şifresiz bağlantıya düşüldüğünde bunu uyarılı başarı olarak ve "require yap" önerisiyle görmek istiyorum.
39. Geliştirici olarak başarılı bir testte sunucu sürümünü ve veritabanı sayısını görmek istiyorum.
40. Geliştirici olarak keychain erişimini reddettiğimde ("Deny") bunun "sır yok" durumundan ayrı bir mesajla gösterilmesini istiyorum.

### SSH tüneli ve host anahtarı

41. Geliştirici olarak tünelin yalnızca ihtiyaç olduğunda açılmasını, son pool kapanınca kapanmasını ve yerel bir port açılmamasını istiyorum.
42. Geliştirici olarak `~/.ssh/known_hosts`'taki kayıtlı host anahtarlarına sessizce güvenilmesini istiyorum; Tezgah o dosyaya hiç yazmamalı.
43. Geliştirici olarak bilinmeyen bir host anahtarında SHA256 parmak izini görüp "Güven ve tekrar dene" ile onaylayabilmek istiyorum; onay Tezgah'ın kendi `known_hosts` dosyasına yazılmalı.
44. Geliştirici olarak host anahtarı uyuşmazlığında kayıtlı ve sunulan parmak izlerini alt alta görmek istiyorum; devam etme seçeneği olmamalı, yalnızca "Kayıtlı host anahtarını unut" sunulmalı.
45. Geliştirici olarak tünel koptuğunda o bağlantının tüm pool'larının atılmasını ve bir sonraki istekte tünelin yeniden açılmasını istiyorum; otomatik yeniden bağlanma ya da script tekrarı olmamalı.
46. Geliştirici olarak Windows'ta `ssh-agent` servisi kapalıysa hata mesajının bunu açıkça söylemesini istiyorum.

### Sırlar ve oturumluk şifre

47. Geliştirici olarak şifrelerin yalnızca işletim sisteminin anahtar zincirinde (macOS Keychain / Windows Credential Manager) saklanmasını ve diske hiçbir zaman düz metin şifre yazılmamasını istiyorum.
48. Geliştirici olarak keychain'e kaydedilmemiş bir bağlantı ilk açıldığında bağlantının adını, rengini ve `kullanıcı@host` bilgisini gösteren küçük bir şifre penceresi görmek istiyorum.
49. Geliştirici olarak oturumluk şifrenin Tezgah kapanana kadar bellekte kalmasını istiyorum; bağlantı düşse, kesilse ya da tünel kopsa bile yeniden sorulmamalı, yalnızca sunucu şifreyi reddedince (`28P01`) sorulmalı.
50. Geliştirici olarak şifre penceresinden şifreyi isteğe bağlı olarak keychain'e kaydedebilmek istiyorum (varsayılan kapalı, bağlantı ayarını değiştirir).

### Veritabanı seçimi ve hedef

51. Geliştirici olarak seçili bağlantının veritabanlarını listenin altındaki bir panelde görmek istiyorum; görünürler üstte, gizliler "Gizli (N)" altında.
52. Geliştirici olarak bir veritabanını ⭐ ile görünür ya da gizli yapabilmek istiyorum.
53. Geliştirici olarak her görünür veritabanının şemalarını çipler olarak açıp kapatabilmek istiyorum.
54. Geliştirici olarak yeni bir bağlantıda yalnızca başlangıç veritabanının görünür olmasını; `pg_catalog`, `information_schema` ve `pg_toast` şemalarının gizli, diğerlerinin görünür olmasını istiyorum.
55. Geliştirici olarak veritabanı listesinin şablonları içermemesini istiyorum.
56. Geliştirici olarak bağlanmamış bir bağlantıda kayıtlı Veritabanı seçiminin görünmesini ve hedefin bağlanmadan seçilebilmesini istiyorum; "Bağlan ve tüm veritabanlarını listele" düğmesi de olmalı.
57. Geliştirici olarak bağlantı hatasında panelde mesajla birlikte "Tekrar dene" ve "Düzenle" düğmelerini görmek istiyorum.
58. Geliştirici olarak paneldeki bir veritabanına tıklayınca onun editörün hedefi olmasını istiyorum.

### Cmd/Ctrl+K hızlı geçiş

59. Geliştirici olarak Cmd/Ctrl+K ile tüm bağlantıların görünür veritabanlarını `bağlantı / veritabanı` biçiminde bulanık arayabilmek istiyorum; liste bağlanmadan gelmeli.
60. Geliştirici olarak prod satırlarında rozet ve mevcut hedefte işaret görmek istiyorum.
61. Geliştirici olarak Enter'a basınca mevcut editörün hedefinin değişmesini, Alt+Enter'a basınca seçimin listede gösterilmesini istiyorum.
62. Geliştirici olarak bağlı bağlantıların gizli veritabanlarını da arayabilmek ve seçince görünür yapabilmek istiyorum.
63. Geliştirici olarak paletten yeni bağlantı, yeni klasör, içe aktar ve "çalıştırma kayıtları klasörünü aç" komutlarını çalıştırabilmek istiyorum.
64. Geliştirici olarak palete bir `postgres://` URL'i yapıştırınca aynı host, port ve kullanıcıya giden mevcut bağlantıları görmek istiyorum; birini seçince URL'deki veritabanı hedef olmalı. Ayrıca "URL'den yeni bağlantı…" ile dolu bir form açılabilmeli.
65. Geliştirici olarak commit/rollback kararı bekleyen bir transaction varken hedef değiştirmenin kapalı olmasını ve paletin tepesinde bunun nedenini görmek istiyorum.

### İçe aktarma

66. Geliştirici olarak "İçe aktar" diyaloğu açılınca global JetBrains ürün/sürüm dizinlerinin ve `.pgpass`'ın otomatik taranmasını istiyorum.
67. Geliştirici olarak bir proje klasörünün yolunu (proje kökü ya da `.idea`) yazıp taratabilmek istiyorum.
68. Geliştirici olarak her kaynağı bir çip olarak açıp kapatabilmek ve önizlemenin anında değişmesini istiyorum; okunamayan kaynak hatasıyla birlikte gösterilmeli ve diğer kaynakları engellememeli.
69. Geliştirici olarak önizlemeyi bağlantı listemin içe aktarmadan sonraki hâli olarak görmek istiyorum: mevcutlar gri, gelenler yeşil ve onay kutulu, yeni klasörler rozetli.
70. Geliştirici olarak aynı sunucuya giden birden çok IntelliJ data source'unun tek bir İçe aktarma adayında birleşmesini, Veritabanı seçiminin bunların birleşimi olmasını ve "N kaynaktan birleştirildi" notunu görmek istiyorum.
71. Geliştirici olarak zaten var olan bir bağlantıyla aynı sunucuya giden adayın, o bağlantının altında ve varsayılan olarak seçilmemiş hâlde görünmesini istiyorum; işaretlersem "ad (2)" adıyla yinelenmeli.
72. Geliştirici olarak bir adayı seçip sağdaki panelde adını, klasörünü ve ortam etiketini düzenleyebilmek; sunucu, şifre kaynağı, SSL, SSH, veritabanları, kaynaklar ve uyarıları görebilmek istiyorum.
73. Geliştirici olarak IntelliJ'de `read-only` işaretli kaynaklar için ortam etiketinin gerekçesiyle birlikte `prod` olarak önceden doldurulmasını istiyorum.
74. Geliştirici olarak şifrelerin `.pgpass`'tan libpq kurallarıyla bulunup keychain'e kopyalanmasını ve hangi satırdan geldiğinin gösterilmesini istiyorum; IntelliJ şifreleri okunmamalı.
75. Geliştirici olarak JDBC URL'deki düz şifrenin atılmasını ve uyarı gösterilmesini istiyorum.
76. Geliştirici olarak `.pgpass`'ta host, port ve kullanıcısı somut olan satırların da aday olmasını; joker satırların yalnızca şifre kaynağı olmasını istiyorum.
77. Geliştirici olarak tüneli eşlenemeyen (ProxyJump ya da referansı bulunamayan) adayların uyarıyla, seçilmemiş ve tünelsiz görünmesini istiyorum.
78. Geliştirici olarak SSL ayarlarının `ssl-config`'ten ya da JDBC URL'den alınmasını, makroların genişletilmesini ve dosya bulunamazsa uyarı gösterilmesini istiyorum.
79. Geliştirici olarak Postgres dışı sürücülerin gri bir "Atlandı" bölümünde listelenmesini istiyorum.
80. Geliştirici olarak IntelliJ'deki iç içe grupların tek düzey, tam yol adlı bir klasöre (`Billing/Prod`) dönüşmesini ve bunun uyarıyla belirtilmesini istiyorum.
81. Geliştirici olarak "İçe aktardıktan sonra test et" seçeneğiyle içe aktarılan bağlantıların sırayla test edilmesini ve sonuçların hem sonuç penceresinde hem listede görünmesini istiyorum. Test hiçbir şey sormamalı; bilinmeyen host anahtarı ya da eksik şifre uyarı olarak kalmalı.
82. Geliştirici olarak sonuç penceresinde "N eklendi, M atlandı" özetini, keychain'e yazılamayan şifreleri ve her bağlantı için "Formda aç"ı görmek istiyorum.
83. Geliştirici olarak yeni içe aktarılan bağlantıları listede bir sonraki içe aktarmaya kadar "yeni" rozetiyle görmek istiyorum.

### Script editörü ve hedef başlığı

84. Geliştirici olarak script ekranının tepesinde hedefi (renk noktası, `bağlantı / veritabanı`, ortam etiketi rozeti) büyük bir başlık olarak görmek istiyorum, böylece nerede çalışacağımı asla karıştırmam.
85. Geliştirici olarak prod hedefinde başlık zemininin kırmızımsı olmasını ve uygulamanın ince kırmızı bir çerçeveyle sarılmasını istiyorum.
86. Geliştirici olarak başlıktaki "hedefi değiştir ▾" ile hızlı geçiş paletini açabilmek istiyorum.
87. Geliştirici olarak SQL renklendirmeli tek bir editörde script yazmak istiyorum.
88. Geliştirici olarak script'i yazarken Çalıştırma modunu (Transaction / Autocommit / Karışık) canlı bir rozet olarak görmek istiyorum.
89. Geliştirici olarak Karışık bir script'te Çalıştır düğmesinin devre dışı kalmasını, transaction dışı ifadelerin turuncu zemin ve ⚠ ile işaretlenmesini ve "ayrı çalıştır" mesajını görmek istiyorum.
90. Geliştirici olarak script'teki `BEGIN`, `COMMIT`, `ROLLBACK`, `SET … default_transaction_read_only` ifadelerinin ve psql `\` meta komutlarının reddedilmesini istiyorum, çünkü transaction'ı Tezgah yönetir.

### Script çalıştırma (Transaction modu)

91. Geliştirici olarak script'in ifadelerinin aynı bağlantıda, tek bir transaction içinde sırayla çalışmasını istiyorum.
92. Geliştirici olarak her ifadenin durumunu canlı görmek istiyorum: satır numarasının solunda işaret (✓ / ✗ / ● çalışıyor / ○ sırada / – çalıştırılmadı) ve sağ sütunda ifade kartı (komut etiketi, satır, süre, etkilenen satır sayısı).
93. Geliştirici olarak hatada durulmasını, hatalı satırın kırmızı zemin ve dalgalı alt çizgiyle tam konumunda işaretlenmesini ve kartta SQLSTATE ile mesajın gösterilmesini istiyorum.
94. Geliştirici olarak SELECT ifadelerinin kartında satır sayısını ve ilk 100 satırlık önizlemeyi görmek istiyorum.
95. Geliştirici olarak bir ifade kartına tıklayınca editörün o satıra gitmesini istiyorum.
96. Geliştirici olarak çalışan bir script'i İptal ile durdurabilmek istiyorum.
97. Geliştirici olarak script bitince karar kartında Commit ve Rollback seçeneklerini görmek istiyorum.
98. Geliştirici olarak hatadan sonra yalnızca Rollback'in sunulmasını istiyorum, çünkü Postgres hatalı bir transaction'ı commit etmez.
99. Geliştirici olarak kararı beklerken Karar süresinin işlemesini istiyorum (prod'da 5 dk, diğerlerinde 30 dk); son dakikada geri sayım görünmeli ve sınırsız "Uzat" kullanılabilmeli.
100. Geliştirici olarak Karar süresi dolunca transaction'ın otomatik geri alınmasını, logun korunmasını ve süre dolduktan sonra gelen commit'in reddedilmesini istiyorum.
101. Geliştirici olarak dizüstü uykuya geçse bile uzak sunucuda kilit tutan bir transaction'ın saatlerce açık kalmamasını istiyorum.
102. Geliştirici olarak sekme kapanırsa ya da bağlantı koparsa bekleyen transaction'ın sunucuda geri alınmasını istiyorum, böylece sahipsiz ve kilit tutan bir transaction kalmaz.
103. Geliştirici olarak commit sırasında tünel koparsa "Commit sonucu bilinmiyor" mesajını görmek istiyorum.

### Autocommit modu

104. Geliştirici olarak yalnızca transaction dışı komutlardan oluşan bir script'in Autocommit modunda, ifade ifade ve her biri anında kalıcı olarak çalışmasını istiyorum.
105. Geliştirici olarak Autocommit script'lerinde "N ifade anında kalıcı uygulanır, geri alınamaz" diyen kalıcı bir uyarı şeridi görmek istiyorum; çalıştırmadan önce ayrıca onay istenmemeli.
106. Geliştirici olarak Autocommit'te hata ya da iptal sonrasında "X ifade kalıcı uygulandı · 1 hatalı · Y çalıştırılmadı" özetini görmek istiyorum.
107. Geliştirici olarak listede olmayan bir komut "transaction içinde çalışamaz" hatası (`25001`) verirse, hatalı satırın işaretlenmesini ve "bu komut tek başına autocommit olarak çalıştırılmalı" mesajını görmek istiyorum.
108. Geliştirici olarak Autocommit'te bağlantı koparsa çalışan ifadenin iptal edilmesini ve kalanların çalıştırılmamasını istiyorum.

### Deneme modu

109. Geliştirici olarak "Dene" ile script'i çalıştırıp sonunda her zaman geri alınmasını istiyorum, böylece ne değişeceğini kalıcı yazmadan görürüm.
110. Geliştirici olarak deneme sonucunda tabloya göre gruplanmış bir Değişiklikler sekmesi görmek istiyorum: başlıkta `+N eklendi · ~N güncellendi · −N silindi`, güncellemelerde yalnızca değişen hücreler vurgulu ve eski değer üstü çizili, eklenenler yeşil, silinenler kırmızı.
111. Geliştirici olarak PG18 öncesi sunucularda ya da PK'sız tablolarda ifade başına önizleme görmek ve neden önce/sonra farkı gösterilmediğini açıklayan bir not okumak istiyorum.
112. Geliştirici olarak DDL ifadelerinde tablonun şema farkını görmek istiyorum (ör. `+ kolon son_giris timestamptz NULL`).
113. Geliştirici olarak deneme hata verirse hatalı satırı, SQLSTATE'i ve hataya kadar çalışan ifadelerin farkını görmek istiyorum.
114. Geliştirici olarak transaction dışı komut içeren bir script'in deneme modunda çalıştırılmamasını ve bu ifadelerin işaretlenmesini istiyorum.
115. Geliştirici olarak SELECT sonuçlarının deneme modunda Log sekmesinde görünmesini istiyorum.

### prod hedefi

116. Geliştirici olarak prod etiketli bir hedefin varsayılan olarak salt okunur açılmasını ve yazma girişimlerinin Postgres tarafından reddedilmesini istiyorum.
117. Geliştirici olarak yazma modunu araç çubuğundaki düğmeyle tek tıkla açıp kapatabilmek istiyorum; durum 🔒 Salt okunur / 🔓 Yazma açık rozetiyle görünmeli ve çalıştırmadan önce ayrıca onay istenmemeli.
118. Geliştirici olarak yazma kilidinin editör ve hedef başına, oturum boyunca geçerli olmasını istiyorum.
119. Geliştirici olarak salt okunur prod'da transaction dışı komutların Postgres'e hiç gönderilmeden reddedilmesini istiyorum.
120. Geliştirici olarak prod'da deneme modunu yazma modu kapalıyken de kullanabilmek istiyorum, çünkü deneme hiçbir şeyi kalıcı yazmaz.
121. Geliştirici olarak prod'da denemede satır kilitleri, sequence'ler ve dış etkiler hakkında kapatılamayan bir uyarı şeridi görmek istiyorum.
122. Geliştirici olarak prod'da deneme kilit alamazsa 3 sn içinde hatalı satırın işaretlenmesini ve "kilit alınamadı, prod trafiği bu satırları tutuyor" mesajını görmek istiyorum.
123. Geliştirici olarak prod'da Autocommit çalıştırmasından sonra bağlantı ayarının pool'a sızmamasını istiyorum.

### Çalıştırma kaydı

124. Geliştirici olarak her çalıştırmanın (deneme, hatalı ve iptal edilenler dahil) bir Çalıştırma kaydına yazılmasını istiyorum, böylece prod'da neyi ne zaman çalıştırdığımı sonradan bulabilirim.
125. Geliştirici olarak kayıtta script metninin, hedefin anlık kopyasının, Çalıştırma modunun, yazma kilidi durumunun, zamanların, sonucun ve ifade başına özetin bulunmasını; satır verisinin ise asla bulunmamasını istiyorum.
126. Geliştirici olarak yarıda kalan bir çalıştırmanın kayıtta "sonuç bilinmiyor" olarak anlaşılabilmesini istiyorum.
127. Geliştirici olarak kayıt yazılamazsa çalıştırmanın engellenmemesini ve bir uyarı görmemi istiyorum.
128. Geliştirici olarak script ekranından "Çalıştırma kayıtları klasörünü aç" ile kayıtlara ulaşabilmek istiyorum.
129. Geliştirici olarak bir bağlantıyı sildiğimde onun Çalıştırma kayıtlarının değişmeden kalmasını istiyorum.

### Ayarlar ve platform

130. Geliştirici olarak bağlantı ayarlarımın işletim sisteminin yapılandırma dizininde tek bir dosyada, atomik olarak yazılmasını istiyorum, böylece çökme yarım bir dosya bırakmaz.
131. Geliştirici olarak Tezgah'ın macOS'ta ve Windows'ta aynı şekilde çalışmasını istiyorum.

## Implementation Decisions

### Paket ve katmanlar

- Workspace yok, tek npm paketi. Üç katman var: **core** (saf mantık; Node ya da DOM bağımlılığı yok), **server** (Node; `pg`, keychain, SSH, dosya sistemi) ve **web** (React + CodeMirror 6). core, server'ı ve web'i import edemez; bu sınır lint kuralıyla korunur.
- Build akışı:
  - Vite web'i, tsup server'ı derler.
  - `bin` server CLI'ına işaret eder; server derlenmiş web'i statik olarak servis eder.
  - Geliştirme sırasında Vite dev sunucusu ile `tsx watch` birlikte çalışır; Vite `/api` ve `/ws`'i proxy'ler.
  - Minimum Node 22 LTS.
- `ssh2@~1.17.0` sürümü sabitlenir ve devDependency olarak tutulur. tsup bunu server çıktısına gömer; native `.node` dosyaları ve `cpu-features` external bırakılır, böylece kurulumda hiçbir install script'i çalışmaz ve ssh2 her zaman JS / Node `crypto` yolunu kullanır. Gömülen paketlerin MIT lisans metinleri dağıtıma eklenir.
- Keychain kütüphanesi `@napi-rs/keyring` (^2.1.2).
- XML ayrıştırıcı `fast-xml-parser`.

### core modülleri (saf, derin, birim testli)

- **SQL lexer / ifade bölücü**: `--` yorumları, iç içe `/* */` yorumları, `'…'`, `E'…'`, `$tag$…$tag$`, `"ident"` ve `U&'…'` tanınır. psql `\` meta komutları tanınır ve reddedilir. Çıktısı ifade listesidir: her ifade için başlangıç/bitiş offset'i, metin ve ilk anahtar kelimeler. Yazımı bozuk bir ifade bölmeyi engellemez. libpg_query reddedildi.
- **Hata konumu eşleme**: Postgres'in `position` değeri (1 tabanlı, ifade içi) ve ifade başlangıç offset'inden editör satır/sütunu hesaplanır. `position` yoksa ifadenin tamamı işaretlenir.
- **Script analizi / Çalıştırma modu çıkarımı**:
  - Girdi: ifade listesi. Çıktı: mod (`transaction` | `autocommit` | `karisik`), transaction dışı ifadelerin listesi ve reddedilen ifadelerin listesi.
  - Reddedilenler: `BEGIN`/`START TRANSACTION`, `COMMIT`, `ROLLBACK`, `SET … default_transaction_read_only`, `\` meta komutları.
  - Transaction dışı komut deseni ilk anahtar kelimelere bakar: `VACUUM` (tek başına `ANALYZE` hariç); `CREATE/DROP DATABASE`; `CREATE/DROP TABLESPACE`; `ALTER SYSTEM`; `CREATE [UNIQUE] INDEX CONCURRENTLY`; `DROP INDEX CONCURRENTLY`; `REINDEX … CONCURRENTLY`; `REINDEX SCHEMA|DATABASE|SYSTEM`; tablo adsız `CLUSTER`; `ALTER TABLE … DETACH PARTITION … CONCURRENTLY`; `COMMIT/ROLLBACK PREPARED`; `CREATE/DROP SUBSCRIPTION`; `ALTER DATABASE … SET TABLESPACE`. Seçeneğe bağlı durumlar temkinli tarafta kalır.
  - Deneme modu için ek kural: transaction dışı ifade içeren bir script denemede çalıştırılamaz.
- **Deneme için DML yeniden yazımı**: PG18+ ve PK'lı tabloda DML ifadesinin sonuna `RETURNING old.*, new.*` eklenir. PG18 öncesinde ya da PK yoksa `RETURNING *` eklenir. Kullanıcının zaten `RETURNING` yazdığı ifadelerin nasıl ele alınacağı uygulamada belirlenir: kendi RETURNING'i korunur, fark o ifade için yedek önizlemeye düşer.
- **Deneme farkı birleştirme**: ifade başına dönen önce/sonra satırları PK anahtarıyla tablo bazında birleştirilir; aynı satıra birden fazla ifade dokunursa ilk "önce" ve son "sonra" alınır. Çıktıda tablo başına ekleme, güncelleme ve silme sayıları ile ilk 100 satır bulunur; güncellemelerde değişen kolonlar işaretlenir.
- **SSL seçenekleri kurucusu**: girdi `sslmode`, dosya içerikleri ve gerçek host adıdır; çıktı `pg`'nin `ssl` nesnesidir. Connection string kullanılmaz.
  - `disable` → `false`.
  - `require` → doğrulamasız; CA verilmişse `verify-ca` gibi davranır.
  - `verify-ca` → CA zorunlu, host adı kontrolü yok.
  - `verify-full` → `rejectUnauthorized`, `servername` gerçek host, `checkServerIdentity(realHost)`.
  - `prefer` için önce doğrulamasız SSL denenir; yalnızca "server does not support SSL" hatasında bir kez `ssl: false` ile yeniden denenir. Bu yeniden deneme kararı da core'da saf bir fonksiyondur.
  - SSH tünelinde host adı doğrulaması her zaman açık `checkServerIdentity(realHost)` ile yapılır.
- **Bağlantı URL'i**: `postgres://` ve `postgresql://` ayrıştırılır ve üretilir. Ayrıştırma sonucu alanlar, yok sayılan parametreler ya da ret nedeni olur (çok host, geçersiz `sslmode`, başka şema). Ters yönde şifresiz URL üretilir. libpq `anahtar=değer` dizisi desteklenmez.
- **known_hosts**: OpenSSH biçimi ayrıştırılır (hashed `|1|` girdileri dahil). Host, port ve anahtar verilince sonuç `eşleşti` | `bilinmiyor` | `uyuşmazlık` olur. Yeni girdi satırı üretilir, bir host'un girdisi silinir (unut) ve SHA256 parmak izi hesaplanır.
- **İçe aktarma** (IO yok, metin girer, aday çıkar):
  - *dataSources.xml ayrıştırıcı*: proje ve global `dataSources.xml`, `dataSources.local.xml` ve `sshConfigs.xml` metinlerini alır; data source'ları `uuid` ile birleştirir. Okuduğu alanlar: ad, `group`/`group-name`, `read-only`, `jdbc-url` (pgjdbc kurallarıyla; çoklu host'ta yalnızca ilki, `[IPv6]` desteklenir), `user-name`, `introspection-scope`, `ssh-properties` (yeni format referans, eski format satır içi), `ssl-config`. `$PROJECT_DIR$` ve `$USER_HOME$` makroları genişletilir. Bozuk XML yalnızca o kaynakta hata üretir; ayrıştırıcı toleranslıdır.
  - *pgpass*: ayrıştırma ve libpq eşleme kuralı (ilk eşleşen satır, `*` joker). Tünelli adayda uzak host adıyla eşlenir.
  - *Gruplama*: kimlik anahtarı `(host, port, kullanıcı, SSH host, SSH port, SSH kullanıcı)`. Aynı anahtarlı kaynaklar tek adayda birleşir; Veritabanı seçimi birleşimdir, ad ilk kaynaktan alınır. Mevcut Bağlantılarla aynı anahtar "zaten var" olarak işaretlenir.
  - *Alan eşleme*: SSH `PASSWORD` → `password`, `KEY_PAIR` → `key`, `OPEN_SSH`/agent → `agent`. ProxyJump ya da bulunamayan referans → tünel boş, seçilmemiş, uyarılı. SSL için `ssl-config` önceliklidir, sonra JDBC `sslmode`/`sslrootcert`, en son `prefer`. `read-only` → `prod` önerisi verilir. Klasör `group`'un tam yoludur (tek düzey, iç içe değil; iç içe ise uyarı). Grupsuz proje kaynağı proje klasörünün adını, global kaynaklar ve `.pgpass` klasörsüz alır. URL'deki düz şifre atılır ve uyarı verilir. Postgres dışı sürücüler "atlandı" olur.
- **Çalıştırma kaydı satırları**: `başladı` ve `bitti` satırlarını sürümlü (`v`) JSON nesnesi olarak üretir. Ayrıca bir aylık dosyanın satırlarından, `bitti` satırı olmayan kayıtları "bilinmiyor" sonucu olarak çıkarır.
- **Karar süresi**: saf bir durum makinesidir. Girdileri ortam etiketi ve şimdiki zamandır. `başlat`, `uzat`, `tik` ve `commit isteği` olaylarına göre kalan süreyi, geri sayım evresini (son 1 dk) ve "süre doldu" kararını üretir. Süre prod'da 5 dk, diğerlerinde ve etiketsiz bağlantılarda 30 dk'dır.

### server

- **Yerel güvenlik** (ADR-0001):
  - Açılışta 32 baytlık rastgele bir token ve rastgele bir port üretilir; isteğe bağlı sabit port bayrağı vardır. Sunucu yalnızca `127.0.0.1`'e bağlanır.
  - Tarayıcı `?t=<token>` ile açılır. Sunucu token'ı `HttpOnly; SameSite=Strict; Path=/` cookie'ye çevirir ve 302 ile token'sız URL'e yönlendirir.
  - Her istek (WS upgrade dahil) cookie'yi sabit zamanlı karşılaştırmayla doğrular. `Host` yalnızca `127.0.0.1:<port>` ya da `localhost:<port>` olabilir. Durum değiştiren isteklerde ve WS upgrade'de aynı-origin `Origin` zorunludur. Hiçbir CORS başlığı gönderilmez.
- **Ayar deposu**:
  - Ayarlar OS yapılandırma dizininde (macOS `~/Library/Application Support/Tezgah`, Windows `%APPDATA%\Tezgah`) sürümlü tek bir dosyada tutulur.
  - İçerik: `version`, `folders[]` (tek düzey; `parentId` yok, ticket 25 ticket 03'ü geçersiz kılar) ve `connections[]`.
  - Bağlantı alanları: `id` (uuid), ad, klasör, host, port, kullanıcı, başlangıç veritabanı (varsayılan `postgres`), SSL (`sslmode` ve CA, sertifika ve anahtar yolları), ortam etiketi ve renk, sırların keychain'e kaydedilip kaydedilmeyeceği, `ssh` (yoksa tünel yok: `host`, `port` = 22, `user`, `auth: password|key|agent`, `keyPath?`, `agentPath?`; ileride `jumps[]` eklenebilecek biçimde) ve Veritabanı seçimi (görünür veritabanları ve her birinin görünür şemaları).
  - Yazma atomiktir (geçici dosya + rename); şema migration'ı `version` ile yapılır.
  - Onaylanan host anahtarları aynı dizindeki ayrı bir `known_hosts` dosyasına, Çalıştırma kayıtları `history/` altındaki aylık JSONL dosyalarına yazılır (POSIX'te `0600`).
- **Keychain arayüzü**: `get`, `set` ve `delete` işlemleri vardır; sonuç `bulundu` | `yok` | `reddedildi` olur. Gerçek implementasyon service `tezgah` ve account `<connectionId>` (DB şifresi) ya da `<connectionId>:ssh` (SSH sırrı) kullanır; bu adlandırma ilk sürümden sonra değiştirilmez. Keychain'de yalnızca şifre ya da passphrase durur, asla özel anahtar (Windows'ta 2560 bayt sınırı var). Oturumluk sırlar süreç belleğindeki bir haritada tutulur ve yalnızca `28P01`'de silinir.
- **Tünel arayüzü**: bir Bağlantı için `pg`'nin `stream` factory'sini sağlar. Gerçek implementasyon ssh2'dir:
  - Tünel tembel açılır; `forwardOut` kanalı, `pg`'nin beklediği `setNoDelay`/`connect`/`'connect'` sözleşmesine uyan ince bir `Duplex` sarmalayıcıyla verilir. Yerel port açılmaz.
  - `keepaliveInterval` 15 sn, `keepaliveCountMax` 3'tür. Tünel kapanınca o bağlantının tüm pool'ları atılır.
  - Host anahtarı önce kullanıcının `known_hosts`'u (salt okunur), sonra Tezgah'ın kendi deposuyla doğrulanır. Bilinmeyen anahtar, SHA256 parmak izini taşıyan yapısal bir `hostKeyUnknown` hatası, uyuşmazlık da `hostKeyMismatch` hatası üretir; el sıkışma açık tutulmaz.
  - Agent varsayılanları: macOS'ta `SSH_AUTH_SOCK`, Windows'ta `\\.\pipe\openssh-ssh-agent`. Pageant'a named pipe ile bağlanılır. FIDO `sk-*` anahtarları desteklenmez.
- **Pool yönetimi**: Hedef başına tembel bir `pg.Pool` açılır (en fazla 3 client, 10 dk boşta kalınca kapanır). Bir bağlantının tüm pool'ları tek tüneli paylaşır. prod hedefinin pool'u `options: -c default_transaction_read_only=on` ile açılır.
- **Veritabanı listeleme**: başlangıç veritabanından `pg_database` sorgulanır (şablonlar hariç); şemalar `pg_namespace`'ten alınır.
- **Bağlantıyı test et**: kaydedilmemiş form değerleriyle çalışan bir servistir. Adımlar sırayla koşar: `sirlar`, `ssh`, `ulasma`, `tls`, `kimlik`, `listeleme`. Her adımın sonucu `basarili` | `uyari` | `hata` | `calistirilmadi` olur ve kodu (SQLSTATE ya da yapısal hata), mesajı ve düzeltme önerisi kimlikleriyle döner. Hiçbir şey kaydedilmez; host anahtarı onayı ayrı bir uç noktadır.
- **Script çalıştırıcı** (WebSocket; ADR-0002):
  - Pool'dan tek bir client alınır ve çalıştırma ile karar dahil her şey bitene kadar tutulur.
  - **Transaction modu**:
    - Transaction `BEGIN READ ONLY` (salt okunur prod) ya da `BEGIN` ile açılır.
    - Hemen ardından `SET LOCAL idle_in_transaction_session_timeout` = Karar süresi + 1 dk ayarlanır.
    - İfadeler sırayla çalışır; ilk hatada durulur.
    - Son ifadeden sonra sunucu taraflı Karar süresi zamanlayıcısı başlar. "Uzat" `SELECT 1` gönderir ve zamanlayıcıyı sıfırlar. Süre dolunca rollback yapılır ve sonra gelen commit reddedilir.
  - **Deneme**: transaction prod'da da `BEGIN READ WRITE` ile açılır; prod'da ayrıca `SET LOCAL lock_timeout = '3s'` uygulanır. DML yeniden yazılır, DDL için rollback öncesinde katalogdan şema farkı okunur. Son ifadeden ya da hatadan hemen sonra rollback yapılır. Büyük DML'de 100 satırdan fazlası sunucudan çekilmez (cursor).
  - **Autocommit**:
    - Salt okunur prod'da sunucuya hiç gitmeden reddedilir.
    - prod yazma modunda client'a `SET default_transaction_read_only = off` uygulanır ve çalıştırma bitince client pool'a dönmez, yok edilir.
    - Hatada durulur.
  - **Kopma**: WS koparsa Transaction modunda rollback yapılır; Autocommit'te çalışan ifade `pg_cancel_backend` ile iptal edilir ve kalanlar çalıştırılmaz. Tünel koparsa da aynı sonuç olur ve mesaj "Tünel koptu; transaction sunucuda geri alındı" olur. `COMMIT` sırasında kopmada "Commit sonucu bilinmiyor" döner.
  - **İptal**: `pg_cancel_backend` ile yapılır.
  - **Yetki**: script analizini (mod, reddedilen ifadeler) istemciye güvenmeden sunucu da yapar.
- **Çalıştırma kaydı yazıcı**: her çalıştırmada `başladı` ve `bitti` satırlarını ekler. Yazma hatası çalıştırmayı durdurmaz, istemciye uyarı olayı gönderir. Kayıttaki sonuç değerleri: `commit`, `rollback`, `deneme-rollback`, `karar-suresi-doldu`, `kopma-rollback`, `hata`, `iptal`.
- **İçe aktarma servisi**:
  - Kaynaklar şuralarda aranır: global `JetBrains/*/options/`, kullanıcının girdiği proje yolu (kök ya da `.idea`) ve `.pgpass` (sırasıyla `PGPASSFILE`, `~/.pgpass`, `%APPDATA%\postgresql\pgpass.conf`; yol elle de girilebilir).
  - Sunucu yalnızca `dataSources*.xml`, `sshConfigs.xml`, `.pgpass` ve `pgpass.conf` adlı dosyaları okur.
  - Akış: önce önizleme (adaylar, atlananlar, kaynak hataları) döner, sonra seçilenler `tezgah.json`'a tek bir atomik yazmayla eklenir. Ardından şifreler keychain'e yazılır; başarısız olanlar sonuçta listelenir, geri alma yapılmaz.
  - Kaynak `uuid`'leri saklanmaz.
- **Yaşam döngüsü**: açılışta hiçbir sunucuya bağlanılmaz.

### API sözleşmesi

- **REST/JSON**:
  - Bağlantılar: listele, oluştur, güncelle, sil, kopyala, bağlantıyı kes.
  - Klasörler: oluştur, yeniden adlandır, sil.
  - Sırlar: kaydet ve sil (değer asla geri döndürülmez; yalnızca "kayıtlı mı" bilgisi döner) ve oturumluk şifre ver.
  - Ayrıca: bağlantıyı test et, host anahtarını onayla ve unut, veritabanı ve şema listesi, Veritabanı seçimini güncelle, URL ayrıştır, içe aktarma (tara, önizle, uygula), Çalıştırma kayıtları klasörünü aç.
- **WebSocket** (script çalıştırma):
  - İstemci → sunucu: `run{target, script, deneme, yazmaModu}`, `commit`, `rollback`, `uzat`, `iptal`.
  - Sunucu → istemci:
    - `analiz{mod, reddedilenler}`
    - `started{i}`
    - `done{i, rowCount, ms, komut, onizleme?}`
    - `error{i, sqlstate, mesaj, satir, sutun}`
    - `fark{tablolar}` (yalnızca denemede)
    - `kararBekleniyor{bitis}`
    - `geriSayim`
    - `bitti{sonuc, ozet}`
    - `uyari{tur}` (ör. Çalıştırma kaydı yazılamadı)
  - Her olay ifade indeksiyle gelir; satır/sütun core'daki eşleme ile sunucuda hesaplanır.

### web

- **Ana yerleşim**:
  - Sol kenar çubuğu (ticket 25 varyant C): üstte klasörlü bağlantı listesi, altta seçili bağlantının Veritabanı paneli.
  - Sağda script ekranı (ticket 23 varyant B): üstte hedef başlığı, solda CodeMirror editörü (yalnızca SQL renklendirme, otomatik tamamlama yok), sağda yaklaşık 400 px genişliğinde bir sütun.
  - Sağ sütunun tepesinde karar kartı, altında sekmeler (denemede *Değişiklikler* + *Log*, normal çalıştırmada yalnızca *Log*) ve ifade kartları var.
  - Başlığın altında tam genişlikte uyarı şeritleri durur: Autocommit uyarısı ve prod'da deneme yan etki uyarısı.
- **Editör süslemeleri**: ifade başına satır işareti, hatalı satır vurgusu ve Karışık script'teki transaction dışı ifade vurgusu. Analiz debounce ile her değişiklikte core analizörüyle istemcide de yapılır.
- **Bağlantı formu** (ticket 24 varyant C): kısa tek sütunlu form, katlanır SSL ve SSH bölümleri, URL'den doldurma ve test sonuçlarının ait oldukları bölümlerde gösterilmesi.
- **Host anahtarı kutusu ve oturumluk şifre penceresi**: hem formda hem listeden bağlanırken kullanılan ortak bileşenler.
- **Cmd/Ctrl+K paleti**: Hedefler, Gizli veritabanları, Komutlar ve URL eşleşmeleri gruplarını gösterir. Karar bekleyen bir transaction varken hedef değiştirme kapalıdır.
- **İçe aktarma diyaloğu** (ticket 26 varyant C): üstte kaynak çipleri, solda önizleme olarak sonuç ağacı, sağda aday ayrıntı paneli, altta "İçe aktardıktan sonra test et" kutusu ve sonrasında sonuç penceresi.
- **API istemci katmanı**: web'in sunucuyla tek konuşma noktasıdır (REST + WS olay akışı). Bileşenler sunucuyu yalnızca bunun üzerinden görür; testlerde sahte bir implementasyonla değiştirilir.

## Testing Decisions

- **İyi test**: yalnızca modülün dış davranışını sınar (girdi → çıktı, istek → yanıt ya da olay dizisi, kullanıcı etkileşimi → ekranda görünen). İç sınıflar, özel fonksiyonlar ya da çağrı sıraları test edilmez; uygulama değişince testler kırılmamalı.
- **Üç test sınırı** (seam):
  1. **core genel arayüzleri: Vitest birim testleri.**
     - Tablo tabanlı testler: lexer (yorum ve tırnak türleri, dollar-quote, bozuk girdi), hata konumu, Çalıştırma modu ve reddedilenler (desen tablosundaki her komut ve tek başına `ANALYZE` gibi negatif örnekler), SSL nesnesi (her `sslmode`, tünelli ve tünelsiz), `prefer` yeniden deneme kararı, URL ayrıştırma/üretme, known_hosts (hashed girdi, uyuşmazlık, unutma), Karar süresi durum makinesi (enjekte zaman), deneme farkı birleştirme, Çalıştırma kaydı satırları.
     - İçe aktarma ayrıştırıcıları örnek `dataSources.xml`, `dataSources.local.xml`, `sshConfigs.xml` ve `.pgpass` fixture metinleriyle sınanır: yeni ve eski SSH biçimi, makrolar, bozuk XML, MySQL sürücüsü, ProxyJump, joker satırlar, birleştirme ve çakışma.
  2. **server: HTTP REST + WebSocket dış sınırında entegrasyon testleri.**
     - Sunucu test içinde başlatılır. Gerçek Postgres yalnızca `TEZGAH_TEST_PG_URL` tanımlıysa kullanılır, yoksa bu testler atlanır; Docker/testcontainers zorunlu değil.
     - Keychain, Tünel, saat ve dosya kökleri (yapılandırma dizini, ev dizini, JetBrains kökleri, `PGPASSFILE`) enjekte edilir; testlerde sahte keychain, sahte tünel, sahte saat ve geçici dizinler kullanılır.
     - Sınanacak davranışlar:
       - Yerel güvenlik: token → cookie, yanlış `Host` ya da `Origin` ile ret, WS upgrade doğrulaması.
       - Bağlantı ve klasör CRUD'ı, atomik yazma, keychain sonuçları (`reddedildi` dahil).
       - Bağlantıyı test et adımları.
       - Script çalıştırma olay dizileri: başarı, hata konumu, iptal, commit, rollback, hata sonrası commit reddi, Karar süresi dolması ve uzatma (sahte saat), kopmada rollback, Autocommit, `25001` yedeği.
       - prod: salt okunur ret, yazma modu, Autocommit client'ının yok edilmesi, denemede `BEGIN READ WRITE`, `lock_timeout`.
       - Deneme farkı: PG18 varsa önce/sonra, yoksa yedek önizleme.
       - Çalıştırma kaydı dosyaları.
       - İçe aktarma: geçici dizindeki fixture dosyalarla tara, önizle, uygula; keychain hatasının sonuca yansıması.
     - ssh2 ile `pg` arasındaki belgesiz `stream` sözleşmesi (Duplex sarmalayıcı) ayrı bir entegrasyon testiyle korunur. Bu test gerçek bir SSH sunucusu gerektirdiğinde yalnızca opsiyonel bir ortam değişkeniyle koşar.
  3. **web: bileşen testleri.** Vitest + Testing Library + jsdom kullanılır; seam, API istemci katmanıdır ve testte sahte bir implementasyonla değiştirilir. Kullanıcı gözünden sınanacaklar:
     - Hedef başlığı ve prod çerçevesi.
     - Çalıştırma modu rozeti ve Karışık script'te devre dışı Çalıştır.
     - Sahte WS olay dizisinden ifade kartlarının ve satır işaretlerinin güncellenmesi.
     - Karar kartı (hata sonrası yalnızca Rollback, geri sayım, "Uzat", süre doldu).
     - Yazma kilidi rozeti ve tek tık geçiş.
     - Deneme Değişiklikler sekmesi.
     - Bağlantı formu: URL'den doldurma, test sonuçlarının bölümlere dağılması, düzeltme düğmeleri, keychain seçeneği.
     - Host anahtarı kutusu.
     - Bağlantı listesi ve klasör işlemleri, Veritabanı paneli (⭐, şema çipleri, tıkla = hedef).
     - Cmd/Ctrl+K paleti (arama, Enter / Alt+Enter, URL yapıştırma, karar beklerken kapalı).
     - İçe aktarma diyaloğu (kaynak çipleri, sonuç ağacı, zaten var / yinele, ayrıntı paneli, test et kutusu, sonuç penceresi).
     - CodeMirror'ın kendi davranışı test edilmez; yalnızca Tezgah'ın eklediği süslemelerin hangi satırlara uygulandığı sınanır.
- **Önceki örnek (prior art)**: repoda henüz kod ve test yok. Arayüz testlerinde senaryo ve veri için prototip dallarındaki senaryolar referans alınabilir: deneme modu, script ekranı, bağlantı formu, bağlantı ağacı ve içe aktarma diyaloğu prototiplerinin `?senaryo=` durumları.

## Out of Scope

- Sekmeli/geçmişli SQL konsolu, şema bilen otomatik tamamlama, tablo görünümü, düzenlenebilir grid, ALTER TABLE önizlemesi (sonraki dilimler).
- Tam sonuç grid'i; script içinde SELECT için yalnızca satır sayısı ve 100 satırlık önizleme var.
- Çalıştırma kayıtlarına göz atma arayüzü ve saklama süresi ayarı.
- `pg_blocking_pids` ile "N oturumu bekletiyorsun" göstergesi.
- Karar süresi ayarı (sabit değerler).
- SSH ProxyJump / çok atlamalı tünel; `~/.ssh/config`'ten içe aktarma.
- libpq `anahtar=değer` bağlantı dizisinden doldurma.
- IntelliJ şifrelerini okuma; IntelliJ renklerini taşıma.
- PG17 direct SSL (`sslnegotiation`).
- Birden çok editör ya da sekme (ilk dilimde tek editör).
- Şema tasarımı, ER diyagramı, Postgres dışı veritabanları.

## Further Notes

- **Uygulama sırası** (her adım tek başına test edilebilir):
  1. İskelet: paket yapısı, build/dev, yerel güvenlik, boş arayüz.
  2. Ayar deposu, keychain ve bağlantı/klasör CRUD'ı; bağlantı listesi ve form (SSL dahil, SSH hariç); bağlantıyı test et.
  3. Pool yönetimi, veritabanı ve şema listeleme, Veritabanı paneli, hedef seçimi, Cmd/Ctrl+K.
  4. core lexer ve script analizi; Transaction modunda script çalıştırma, hata konumu, karar kartı, Karar süresi, kopmada rollback, Çalıştırma kaydı.
  5. prod: salt okunurluk ve yazma kilidi; Autocommit modu.
  6. Deneme modu (fark, yedek önizleme, DDL şema farkı, prod'da deneme).
  7. SSH tüneli: Duplex sarmalayıcı, host anahtarı akışı, agent; formun SSH bölümü.
  8. İçe aktarma: core ayrıştırıcılar, ardından tarama, önizleme, uygulama ve diyalog.
- **Bilinen riskler**:
  - `pg`'nin `stream` factory sözleşmesi belgesiz.
  - `@napi-rs/keyring` pratikte tek bakımcılı; keychain bir arayüzün arkasında olduğu için değiştirmek ucuz.
  - JetBrains formatı belgesiz ve sessizce değişebilir.
  - Windows'ta `CRED_PERSIST_ENTERPRISE` roaming profilde sırları başka makinelere taşıyabilir; README'de belirtilir.
  - macOS keychain ACL'i çağıran `node` binary'sine bağlı; Node güncellemesinden sonra istem tekrarlanabilir.
- **README'de belgelenecekler**: prod salt okunurluğu bir kaza önleyicidir, güvenlik sınırı değildir; Çalıştırma kayıtları düz metindir ve script'teki sırlar maskelenmez; iptal edilen `CREATE INDEX CONCURRENTLY` INVALID index bırakabilir; Windows credential roaming riski.
- **Prototipler** (atılabilir dallar, yalnızca görsel referans): `prototype/16-deneme-modu`, `prototype/23-script-ekrani`, `prototype/24-baglanti-formu`, `prototype/25-baglanti-agaci`, `prototype/26-ice-aktarma-diyalogu`.
- **Araştırma bulguları** (merge edilmeyen dallar): `research/keychain-kutuphanesi`, `research/ssh-kutuphanesi`, `research/datasources-xml-formati`, `research/pg-sslmode`.
