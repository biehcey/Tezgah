# İçe aktarma akışı: dataSources.xml ve .pgpass

Type: grilling
Status: resolved
Blocked by: 13

## Question

[dataSources.xml araştırmasına](13-datasources-xml-formati.md) göre içe aktarma akışı nasıl işler?

- dataSources.xml: hangi alanlar eşlenir; eşlenemeyenler (desteklenmeyen sürücüler, bilinmeyen SSH ayarları) nasıl raporlanır; klasör/renk taşınır mı; şifreler nereden gelir?
- `.pgpass`: konum (`~/.pgpass`, `%APPDATA%\postgresql\pgpass.conf`, `PGPASSFILE`); `*` joker satırları bağlantıya mı dönüşür yoksa yalnızca şifre kaynağı mı olur; şifreler keychain'e kopyalanır mı?
- Çakışma: aynı host/port/kullanıcı/veritabanı zaten varsa ne olur (atla, birleştir, yinele)?
- Önizleme: içe aktarmadan önce liste gösterilip seçim yaptırılır mı?

## Answer

Grilling oturumunda (2026-11-03) kararlaştırıldı.

**Akış**
- Tek diyalog: kaynaklar taranır → **önizleme** (onay kutusu, hedef klasör, ortam etiketi, şifre kaynağı, uyarılar) → seçilenler tek atomik yazmayla `tezgah.json`'a. Önizlemesiz içe aktarma yok.
- Sonra şifreler keychain'e yazılır. Başarısız olan (ör. macOS "Deny") bağlantı şifresiz kalır, özette "şifre kaydedilemedi: <ad>" gösterilir; geri alma yok. Özet: "N eklendi, M atlandı".

**Kaynak keşfi** (tarayıcı dosya seçicisi tam yol vermediği için dosyaları sunucu okur)
- Global `JetBrains/*/options/` otomatik taranır, ürün/sürüm başına bir kaynak.
- Proje: kullanıcı klasör yolunu metin olarak girer (proje kökü veya `.idea`).
- `.pgpass`: `PGPASSFILE` → `~/.pgpass` / `%APPDATA%\postgresql\pgpass.conf`; yol elle de girilebilir.
- Sunucu yalnızca `dataSources*.xml`, `sshConfigs.xml`, `.pgpass`/`pgpass.conf` adlı dosyaları okur.

**Adaylar ve birleştirme**
- IntelliJ data source veritabanı düzeyinde, Bağlantı sunucu düzeyinde: kimlik anahtarı `(host, port, kullanıcı, SSH host/port/kullanıcı)` aynı olan kaynaklar **tek aday Bağlantı'ya birleştirilir**; Veritabanı seçimi `introspection-scope`'ların birleşimi, ad ilk kaynaktan (düzenlenebilir), başlangıç veritabanı birleşenlerden biri; "N kaynaktan birleştirildi" notu.
- `.pgpass`: joker olmayan (host/port/kullanıcı somut) satırlar da aday olur, aynı anahtarla gruplanır; `db` somutsa başlangıç veritabanı, değilse `postgres`. Joker satırlar yalnızca şifre kaynağı.
- Mevcut bağlantıyla aynı anahtar: varsayılan **atla** (satır "zaten var: <ad>", seçili değil); kullanıcı işaretlerse **yinele**. Birleştirme yok, kaynak `uuid`'i tutulmaz.

**Alan eşleme**
- Şifre: her aday için `.pgpass` libpq kuralıyla (ilk eşleşen, `*` joker) aranır; tünelli adayda uzak host adıyla. Bulunan şifre keychain'e kopyalanır; Tezgah çalışma zamanında `.pgpass` okumaz. IntelliJ şifreleri okunmaz; şifresizde ilk bağlanmada sorulur. URL'deki düz şifre atılır, uyarı verilir.
- Ortam etiketi: önizlemede düzenlenebilir; varsayılan boş, `read-only="true"` ise `prod` önceden doldurulur. Ada göre tahmin yok.
- Klasör: `group`/`group-name` `/` ile bölünüp iç içe klasör; mevcutlarla yol eşleşmesiyle birleşir, eksikler oluşturulur. Grupsuz proje kaynağı → proje klasörü adı; global ve `.pgpass` → klasörsüz. Satır bazında değiştirilebilir.
- SSH: `PASSWORD` → `password`, `KEY_PAIR` → `key` (`keyPath`; passphrase okunmaz), `OPEN_SSH`/agent → `agent`; eski satır içi format da okunur. Referans bulunamaz veya ProxyJump varsa aday görünür ama **seçili değil**, "tünel eşlenemedi" uyarısı, tünel boş.
- SSL: `ssl-config` (`VERIFY_FULL` → `verify-full` vb., `ca-cert`/`client-cert`/`client-key`) öncelikli; yoksa JDBC URL `sslmode`/`sslrootcert`; yoksa `prefer`. `$PROJECT_DIR$`/`$USER_HOME$` genişletilir; dosya yoksa uyarı (seçili kalır).

**Eşlenemeyenler**: ayrı rapor yok, satır uyarıları. Postgres dışı sürücüler "atlandı" bölümünde gri tek satır; çoklu host'ta yalnız ilki; `auth-provider`/driver özellikleri yok sayılır; bozuk XML kaynak düzeyinde hata, diğer kaynakları engellemez.

**Modül sınırı**: `src/core/import/` saf modüller: `dataSourcesXml` (metin → aday; IO yok), `pgpass` (ayrıştırma + libpq eşleme), gruplama (birleştirme + çakışma tespiti), SSH/SSL eşleme. Keşif ve okuma `src/server`'da. XML ayrıştırıcı `fast-xml-parser`. Birim testleri örnek XML/pgpass dosyalarıyla.

## Comments

- 2026-11-03: Klasör eşlemesindeki "`/` ile bölünüp iç içe klasör" kararı geçersiz. Ticket 25'te klasörler tek düzey; `group` tam yol adıyla tek klasör olur. Bkz. [İçe aktarma diyaloğunun yerleşimi](26-ice-aktarma-diyalogu.md).
