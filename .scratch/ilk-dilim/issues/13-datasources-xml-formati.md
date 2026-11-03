# IntelliJ dataSources.xml formatı

Type: research
Status: resolved
Blocked by: —

## Question

IntelliJ/DataGrip'in `dataSources.xml` (ve `dataSources.local.xml`) dosyalarından Postgres bağlantıları içe aktarılırken hangi alanlar bulunur ve Tezgah bağlantı modeline ([ayar saklama](03-ayar-saklama.md)) nasıl eşlenir?

Karar için gereken olgular:
- Dosyaların konumu (proje `.idea/`, IDE geneli `options/` vb.) ve ikisinin ayrımı (hangi alan hangisinde).
- JDBC URL biçimleri (`jdbc:postgresql://host:port/db?...`, çoklu host), kullanıcı, SSL ayarları, SSH tünel ayarları, klasör/grup, renk/etiket, şema seçimi (introspection scope) alanları.
- Şifreler: IntelliJ nerede saklar (KeePass, OS keychain, "do not save"); Tezgah okuyabilir mi, okumalı mı?
- Gerçek örnek dosya yapıları (resmi doküman veya açık kaynak örnekler).

## Answer

Bulgular ve önerilen alan eşleme tablosu: `research/datasources-xml-formati` dalı, `research/datasources-xml-formati.md` (origin'e push'landı, merge edilmez). JetBrains formatı resmî olarak belgelemiyor; element adları gerçek dosyalardan ve üç bağımsız içe aktarıcıdan (DBeaver, Tabularis, TablePro) çıkarıldı. Format sessizce değişebilir, ayrıştırıcı toleranslı olmalı.

- **Konumlar:** proje: `.idea/dataSources.xml` (paylaşılan: ad, `uuid`, `group`, `read-only`, `jdbc-url`) + `.idea/dataSources.local.xml` (kişisel: `user-name`, `secret-storage`, `introspection-scope`, `ssh-properties`, `ssl-config`), `uuid` ile birleştirilir. Global: `JetBrains/<Ürün><Sürüm>/options/` (`dataSources.xml`, `dataSources.local.xml`, `sshConfigs.xml`; kök `<application>`); Windows `%APPDATA%`, macOS `~/Library/Application Support`. Birden çok ürün/sürüm olabilir → tüm `JetBrains/*/options/` taranır.
- **SSH:** yeni format `ssh-properties` → yalnızca `ssh-config-id`; host/port/kullanıcı/`authType`/`keyPath` `sshConfigs.xml`'de. Eski format satır içi (`proxy-host`, `user`).
- **SSL/URL:** `ssl-config` (`mode`=`VERIFY_FULL` vb., `ca-cert`/`client-cert`/`client-key`) veya JDBC URL `sslmode`. Yollarda `$PROJECT_DIR$`/`$USER_HOME$` makroları genişletilir. JDBC URL pgjdbc kurallarıyla (virgüllü çoklu host, `[IPv6]`).
- **Eşlenebilir:** klasör ← `group` (bazen `group-name`; ikisi de denenir); `read-only="true"`; veritabanı seçimi ← `introspection-scope` (`@` = varsayılan, `negative="1"` = tümü).
- **Eşlenemez:** renk (yeri doğrulanamadı); ortam etiketi/"production" bayrağı IntelliJ'de yok; çoklu host'ta yalnızca ilki; driver özellikleri, `auth-provider`.
- **Şifreler:** macOS Keychain, Windows KeePass `c.kdbx` (Windows'ta native seçenek yok) veya hiç. Okumak teknik olarak mümkün (TablePro yapıyor) ama belgesiz ve kırılgan → öneri: **okuma**. "URL only" bağlantılarda URL'de düz şifre olabilir: içe aktarıcı onu atmalı ve uyarmalı.

Akışa dair kararlar (şifre kaynağı, ortam etiketi tahmini, `read-only` → `prod`?, çakışmalar): [İçe aktarma akışı](18-ice-aktarma-akisi.md).
