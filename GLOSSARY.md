# Tezgah

PostgreSQL için kişisel, yerel çalışan bir veritabanı yönetim aracı.

## Bağlantılar

**Bağlantı**:
Kullanıcının kaydettiği, sunucu düzeyindeki giriş: nereye, hangi kullanıcıyla, hangi ortam etiketiyle ve gerekiyorsa hangi tünelden ulaşılacağı. Tek bir veritabanına bağlı değildir.
_Avoid_: Data source, sunucu, connection string

**Veritabanı seçimi**:
Bir bağlantı altında sunucudaki veritabanlarından kullanıcının görünür kıldıkları ve her birinde görünür kıldığı şemalar.
_Avoid_: Scope, filtre

**Hedef**:
Bir script'in çalıştığı yer: bir bağlantı ile o bağlantıdaki bir veritabanının çifti.
_Avoid_: Oturum, context

**Ortam etiketi**:
Bir bağlantının hangi ortamı temsil ettiğini söyleyen sabit kümeden bir değer (`local`, `dev`, `test`, `staging`, `prod`), kullanıcının değiştirebildiği bir renkle birlikte. Özel güvenlik davranışını yalnızca `prod` tetikler; etiket opsiyoneldir.
_Avoid_: Ortam, environment, tag

**Tünel**:
Bir bağlantının sunucuya bir SSH sunucusu üzerinden ulaşma yolu. Bağlantı başına en fazla bir tanedir; o bağlantının tüm hedefleri onu paylaşır.
_Avoid_: SSH bağlantısı, port forward

**Bağlantı testi**:
Bir Bağlantının henüz kaydedilmemiş ayarlarıyla sunucuya ulaşılabildiğinin, giriş yapılabildiğinin ve veritabanlarının listelenebildiğinin adım adım sınanması. Hiçbir şey kaydetmez ve script çalıştırmaz; script'i geri alarak çalıştıran Deneme modundan ayrıdır.
_Avoid_: Bağlantı denemesi, ping, sağlık kontrolü

**Oturumluk şifre**:
Keychain'e kaydedilmeyen bir Bağlantının, ilk bağlanmada şifre penceresinden sorulan ve Tezgah kapanana kadar yalnızca süreç belleğinde tutulan şifresi. Bağlantı kesilince ya da düşünce unutulmaz; yalnızca sunucu reddedince (`28P01`) unutulur ve yeniden sorulur.
_Avoid_: Geçici şifre, önbellekteki şifre

**İçe aktarma adayı**:
İçe aktarma sırasında dış kaynaklardan (IntelliJ data source'ları, `.pgpass` satırları) çıkarılan, henüz kaydedilmemiş olası Bağlantı. Aynı sunucuya giden birden çok kaynak tek adayda birleşir; kullanıcı önizlemede seçtiği adayları Bağlantı olarak kaydeder.
_Avoid_: Data source, kayıt, satır

## Konsol

**Sekme**:
Konsolda bir hedefe bağlı çalışma alanı: ya bir script editörü (*konsol sekmesi*) ya da bir Tablo sekmesi. Metni/tablosu ve hedefi diske yazılır, Tezgah açılınca geri gelir ama bağlanmaz. Yazma kilidi sekme başınadır.
_Avoid_: Pencere, konsol (tek başına), editör

**Tablo sekmesi**:
Editörsüz, tek bir tabloya filtreli/sayfalı göz atan ve PK'lı tabloda düzenlemeye izin veren Sekme. Her sayfa kısa ayrı bir sorgudur; açık transaction tutmaz.
_Avoid_: Tablo editörü, veri görünümü

**Bekleyen değişiklik**:
Tablo sekmesinde yapılmış ama henüz uygulanmamış hücre düzenlemesi, satır ekleme ya da silme. Diske yazılmaz; uygulanınca SQL'e çevrilip Transaction modunda bir script olarak çalışır.
_Avoid_: Taslak, dirty satır, pending edit

**Katalog önbelleği**:
Bir hedefin görünür şemalarındaki tablo, view ve kolonların sunucu belleğindeki kopyası; tamamlama ve tablo listesi bundan beslenir. Yalnızca kullanıcının o oturumdaki bir eylemiyle doldurulur; DDL'li script bitince ya da elle yenilenir.
_Avoid_: Metadata, şema önbelleği, introspection

## Script çalıştırma

**Transaction dışı komut**:
Postgres'in bir transaction bloğu içinde çalıştırmayı reddettiği komut (ör. `VACUUM`, `CREATE INDEX CONCURRENTLY`). Etkisi anında kalıcıdır, geri alınamaz.
_Avoid_: Özel komut, non-tx

**Çalıştırma modu**:
Bir script'in içeriğinden çıkarılan, nasıl çalışacağını belirleyen mod: *Transaction* (tüm ifadeler tek transaction'da, sonda commit veya rollback) *Autocommit* (script yalnızca transaction dışı komutlardan oluşur; her ifade anında kalıcı) ya da *Okuma* (tüm ifadeler okuma ifadesi; `BEGIN READ ONLY` ile çalışır, commit/rollback sorulmaz, transaction yalnızca sonuçtan daha fazla satır çekilebilsin diye açık kalır). Transaction dışı komutla diğer türleri karıştıran script çalıştırılamaz. Deneme modu bir çalıştırma modu değildir; Transaction modunun sonu her zaman rollback olan biçimidir.
_Avoid_: Transaction modu anahtarı, execution mode

**Deneme modu**:
Bir script'i Transaction modunda çalıştırıp sonunda her zaman geri alan, ne değişeceğini gösteren çalıştırma biçimi. Hiçbir şeyi kalıcı yazmaz; bu yüzden `prod` hedefinde yazma modu kapalıyken de kullanılabilir. Geri alınamayan yan etkileri (ilerleyen sequence'ler, dış sistemlere giden etkiler) vardır.
_Avoid_: Dry run, simülasyon, test çalıştırma

**Deneme farkı**:
Deneme modunda değişen satırların ve tablo şemalarının, tabloya göre gruplanmış önce/sonra görünümü. Satırlar PK ile eşlenir; aynı satıra birden çok ifade dokunursa ilk "önce" ile son "sonra" karşılaştırılır. PG18+ sunucu ve PK'lı tablo gerektirir; yoksa Yedek önizlemeye düşülür.
_Avoid_: Diff, değişiklik raporu

**Yedek önizleme**:
Deneme farkı alınamayan bir DML ifadesinin, ifade başına `RETURNING *` satırlarıyla gösterilmesi (UPDATE'te yeni hâl, INSERT'te eklenen, DELETE'te silinen satır). Neden düşüldüğü (eski sunucu, PK yok, ifadenin kendi `RETURNING`'i) yanında yazar.
_Avoid_: Fallback, basit önizleme

**Yazma kilidi**:
`prod` hedefinin salt okunur (🔒) ya da yazma modunda (🔓) olma durumu. Sekme ve hedef başınadır; sekmenin hedefi değişince ya da sekme diskten geri gelince kapalıdır ve tek tıkla değişir. Salt okunurken yazmayı Postgres reddeder; Autocommit script'i hiç gönderilmez. Bir kaza önleyicidir, güvenlik sınırı değildir.
_Avoid_: Salt okunur mod, read-only toggle, yazma izni

**Karar süresi**:
Transaction modunda script bittikten sonra commit veya rollback kararı için tanınan süre; dolunca transaction geri alınır. Okuma modunda aynı süre, karar sorulmadan açık kalan Okuma transaction'ının ömrüdür.
_Avoid_: Zaman aşımı, timeout

**Açık oturum**:
Bir sekmenin hedefte client tutan çalıştırması: script çalışıyor, karar bekliyor ya da Okuma transaction'ı açık. Hedef başına en fazla 5 açık oturum olabilir; sınırı aşan çalıştırma beklemeden reddedilir. Katalog okuma, iptal gibi kısa süreli sorgular açık oturum sayılmaz. Hedefin eş anlamlısı değildir.
_Avoid_: Bağlantı, client, session

**Çalıştırma kaydı**:
Bir script çalıştırmasının sonradan değiştirilmeyen kaydı: ne çalıştırıldı, hangi hedefte, nasıl sonuçlandı. Deneme modu ve hatalı çalıştırmalar da kaydedilir; çalıştırmanın döndürdüğü veriyi içermez.
_Avoid_: Geçmiş, log, audit log, denetim kaydı
