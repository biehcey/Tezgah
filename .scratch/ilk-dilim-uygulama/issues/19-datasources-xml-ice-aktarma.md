# 19: dataSources.xml'den içe aktarma

Spec: [İlk dilim spec'i](../../ilk-dilim/spec.md) · Kararlar: dataSources.xml formatı (wayfinder 13), İçe aktarma akışı (18), İçe aktarma diyaloğu (26)

**What to build:** İçe aktarma diyaloğu global JetBrains ürün/sürüm dizinlerini kendiliğinden tarar. Geliştirici "＋ Proje klasörü…" ile bir projenin yolunu ekleyebilir. IntelliJ data source'ları aynı sunucuya gidenler birleşerek aday olur. SSH ve SSL ayarları eşlenir, `read-only` kaynaklar için `prod` önerilir, Postgres dışı sürücüler "Atlandı" bölümünde görünür. Şifreler yalnızca `.pgpass`'tan gelir.

**Blocked by:** 05, 17, 18

**Status:** ready-for-agent

- [ ] core dataSources ayrıştırıcısı (`fast-xml-parser`, IO yok) `dataSources.xml`, `dataSources.local.xml` ve `sshConfigs.xml` metinlerini alıyor ve `uuid` ile birleştiriyor. Okuduğu alanlar: ad, `group`/`group-name`, `read-only`, `jdbc-url` (pgjdbc kuralları; çoklu host'ta yalnızca ilki, `[IPv6]`), `user-name`, `introspection-scope` (`@` = varsayılan, `negative="1"` = tümü), `ssh-properties` (yeni referans ve eski satır içi biçim), `ssl-config`. `$PROJECT_DIR$` ve `$USER_HOME$` makrolarını genişletiyor. Toleranslı; bozuk XML yalnızca o kaynakta hata veriyor.
- [ ] Eşleme:
  - SSH: `PASSWORD` → `password`, `KEY_PAIR` → `key` (passphrase okunmuyor), `OPEN_SSH`/agent → `agent`. ProxyJump ya da bulunamayan referans → tünel boş, aday seçilmemiş, "tünel eşlenemedi" uyarısı.
  - SSL: önce `ssl-config`, sonra JDBC `sslmode`/`sslrootcert`, en son `prefer`; dosya yoksa uyarı.
  - Ortam: `read-only="true"` → `prod` önerisi gerekçesiyle.
  - Klasör: `group`'un tam yolu tek düzey klasör olarak (iç içe ise uyarı); grupsuz proje kaynağı → proje klasörünün adı; global kaynak → klasörsüz.
  - JDBC URL'deki düz şifre atılıyor ve uyarı veriliyor. `auth-provider` ve sürücü özellikleri yok sayılıyor.
  - Birim testleri fixture XML'lerle (yeni ve eski SSH, makrolar, MySQL, ProxyJump, bozuk XML, iç içe grup).
- [ ] Şifre her aday için `.pgpass`'ta aranıyor; tünelli adayda uzak host adıyla. IntelliJ şifreleri okunmuyor.
- [ ] Tarama: global `JetBrains/*/options/` (macOS `~/Library/Application Support`, Windows `%APPDATA%`), ürün/sürüm başına bir kaynak; proje yolu (kök ya da `.idea`). Sunucu yalnızca `dataSources*.xml` ve `sshConfigs.xml` adlı dosyaları okuyor. Kökler testte enjekte ediliyor.
- [ ] Diyalog: JetBrains kaynak çipleri ve "＋ Proje klasörü…" yol satırı (Tara / Enter; bulunamazsa çip hatalı); "N kaynaktan birleştirildi" notu; en altta gri "Atlandı (Postgres değil)" bölümü; ayrıntı panelinde SSL ve SSH özetleri.
- [ ] Server testleri geçici dizindeki fixture JetBrains ve proje yapısıyla taramayı ve `.pgpass` ile birleştirmeyi sınıyor.
