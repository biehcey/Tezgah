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

## Script çalıştırma

**Transaction dışı komut**:
Postgres'in bir transaction bloğu içinde çalıştırmayı reddettiği komut (ör. `VACUUM`, `CREATE INDEX CONCURRENTLY`). Etkisi anında kalıcıdır, geri alınamaz.
_Avoid_: Özel komut, non-tx

**Çalıştırma modu**:
Bir script'in içeriğinden çıkarılan, nasıl çalışacağını belirleyen mod: *Transaction* (tüm ifadeler tek transaction'da, sonda commit veya rollback) ya da *Autocommit* (script yalnızca transaction dışı komutlardan oluşur; her ifade anında kalıcı). İki türü karıştıran script çalıştırılamaz. Deneme modu bir çalıştırma modu değildir; Transaction modunun sonu her zaman rollback olan biçimidir.
_Avoid_: Transaction modu anahtarı, execution mode

**Deneme modu**:
Bir script'i Transaction modunda çalıştırıp sonunda her zaman geri alan, ne değişeceğini gösteren çalıştırma biçimi. Hiçbir şeyi kalıcı yazmaz; bu yüzden `prod` hedefinde yazma modu kapalıyken de kullanılabilir. Geri alınamayan yan etkileri (ilerleyen sequence'ler, dış sistemlere giden etkiler) vardır.
_Avoid_: Dry run, simülasyon, test çalıştırma

**Karar süresi**:
Transaction modunda script bittikten sonra commit veya rollback kararı için tanınan süre; dolunca transaction geri alınır.
_Avoid_: Zaman aşımı, timeout

**Çalıştırma kaydı**:
Bir script çalıştırmasının sonradan değiştirilmeyen kaydı: ne çalıştırıldı, hangi hedefte, nasıl sonuçlandı. Deneme modu ve hatalı çalıştırmalar da kaydedilir; çalıştırmanın döndürdüğü veriyi içermez.
_Avoid_: Geçmiş, log, audit log, denetim kaydı
