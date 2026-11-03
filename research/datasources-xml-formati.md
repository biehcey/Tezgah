# IntelliJ / DataGrip `dataSources.xml` formatı — araştırma notu

Ticket: "IntelliJ dataSources.xml formatı". Soru: Postgres veri kaynakları için `dataSources.xml` ve `dataSources.local.xml` dosyalarında hangi alanlar var ve bunlar Tezgah'ın bağlantı modeline nasıl eşlenir?

Tarih: 2026-11-03. Bu bir "throwaway" araştırma dalıdır, merge edilmez.

> **Güven notu.** JetBrains bu XML formatını resmî olarak belgelemiyor. Resmî belgeler yalnızca dosyaların *varlığını* ve *rolünü* anlatıyor. Element ve attribute adları GitHub'daki gerçek dosyalardan ve üç bağımsız üçüncü taraf içe aktarıcıdan (DBeaver, Tabularis, TablePro) alındı. Bu yüzden ayrıştırıcı esnek olmalı: bilinmeyen elementleri yok saymalı, eksik alanlara dayanıklı olmalı.

---

## 1. Dosya konumları

### 1.1 Proje düzeyi (`.idea/`)

| Dosya | İçerik | Kaynak |
|---|---|---|
| `<proje>/.idea/dataSources.xml` | Paylaşılan (VCS'e girebilen) tanım: ad, uuid, `group`, `read-only`, driver, `jdbc-url`, driver özellikleri | DataGrip Help, "Working with projects": *"dataSources.xml: settings of the project data sources"* [1] |
| `<proje>/.idea/dataSources.local.xml` | Kullanıcıya özel bilgi: `user-name`, `secret-storage`, şema görünürlüğü (introspection scope), `ssh-properties`, `ssl-config`, `auth-provider` | JetBrains blog: *"…dataSources.local.xml file where DataGrip stores schema visibility settings and some other information that can vary from user to user"* [2]; örnek dosyalar [6][7][8] |
| `<proje>/.idea/db-forest-config.xml` | Database Explorer'da kullanıcının oluşturduğu klasörlerin yapısı (`db-tree-configuration` bileşeni) | DataGrip Help 2026.2: *"db-forest-config.xml: configuration of the data sources folders you create in Database Explorer"* [1]; örnek [12] |
| `<proje>/.idea/sshConfigs.xml` | Yalnızca o projeye ait SSH yapılandırmaları ("Visible only for this project") | JetBrains Help, SSH Configurations [13]; datadock içe aktarıcısı önce bu yolu okuyor [11] |
| `<proje>/.idea/dataSources/` | Introspection önbelleği (uuid başına dosya/klasör). Bağlantı tanımı **değil**, içe aktarmada yok sayılmalı | Gözlem (`multifile-model="true"`). Birincil kaynakla doğrulanmadı |

Not: `.idea` dizini macOS ve Linux'ta varsayılan olarak gizlidir [1].

### 1.2 IDE-global (global data source'lar, SSH yapılandırmaları)

"Global" yapılan data source'lar aynı IDE kurulumundaki tüm projelerde görünür [3]. Bunlar IDE yapılandırma dizinindeki `options/` alt klasöründe tutulur.

Yapılandırma dizini (DataGrip Help, "Directories used by the IDE" [4]):

| OS | Yol |
|---|---|
| Windows | `%APPDATA%\JetBrains\<Ürün><Sürüm>`, ör. `C:\Users\X\AppData\Roaming\JetBrains\DataGrip2026.2` |
| macOS | `~/Library/Application Support/JetBrains/<Ürün><Sürüm>` |
| Linux | `~/.config/JetBrains/<Ürün><Sürüm>` |

`<Ürün>` değeri `DataGrip`, `IntelliJIdea`, `PyCharm`, `WebStorm` vb. olabilir. Database Tools eklentisi tüm bu IDE'lerde aynı formatı kullanır (örneklerde `created-in="WS-…"` ve `DB-…` gibi build önekleri görülüyor). Kullanıcının birden çok ürünü ve sürümü olabilir, dolayısıyla `JetBrains/*/options/` taranmalıdır. Tabularis de bunu yapıyor [10].

Bu dizinin altında:

- `options/dataSources.xml`: global tanımlar. Kök element `<project>` değil `<application>`, bileşen adı `dataSourceStorage` [9]
- `options/dataSources.local.xml`: global kullanıcıya özel kısım. Kök `<application>`, bileşen `dataSourceStorageLocal` [7]
- `options/sshConfigs.xml`: IDE düzeyindeki SSH yapılandırmaları (`<sshConfig id=… host=… port=… username=… authType=… keyPath=…>`) [5][10][11][15]
- `options/recentProjects.xml`: son açılan projelerin yolları. Proje `.idea/` dizinlerini bulmak için kullanılabilir (DBeaver ve Tabularis bunu yapıyor) [5][10]
- `c.kdbx` / `c.pwd`: KeePass parola veritabanı ve ana anahtarı (bkz. §5)

### 1.3 Hangi alan hangi dosyada?

İki dosya **aynı `uuid`** ile birleştirilir. Paylaşılan dosyada `<data-source source="LOCAL" name uuid>`, local dosyada `<data-source name uuid>` bulunur.

| Alan | `dataSources.xml` | `dataSources.local.xml` |
|---|---|---|
| `name`, `uuid` | ✔ | ✔ (tekrar) |
| `group` (klasör adı) | ✔ attribute | – |
| `read-only="true"` | ✔ attribute | – |
| `driver-ref`, `jdbc-driver`, `jdbc-url` | ✔ | – |
| `<driver-properties>` / `<property>` | ✔ | – |
| `<remarks>` (yorum) | ✔ | – |
| `user-name` | – | ✔ |
| `secret-storage` (parola saklama modu) | – | ✔ |
| `schema-mapping/introspection-scope` | – | ✔ |
| `ssh-properties` | – | ✔ |
| `ssl-config` | – | ✔ |
| `database-info` (sunucu sürümü önbelleği) | – | ✔ (yok sayılır) |

Bu ayrım, kullanıcıya özel ve gizli olan her şeyin local dosyada kaldığını gösteriyor. Bir forum gönderisinde, paylaşılan dosyaya elle eklenen `<ssh-properties>` bloğunun IDE tarafından silindiği bildiriliyor. JetBrains bunun için DBE-20104 numaralı özellik isteğini açmış [14].

---

## 2. Örnek XML (kısaltılmış)

**Proje `dataSources.xml`** (gerçek bir örnekten sadeleştirildi [8]):

```xml
<project version="4">
  <component name="DataSourceManagerImpl" format="xml" multifile-model="true">
    <data-source source="LOCAL" name="Raspi" group="Development"
                 uuid="542e51ce-…">
      <driver-ref>postgresql</driver-ref>
      <synchronize>true</synchronize>
      <jdbc-driver>org.postgresql.Driver</jdbc-driver>
      <jdbc-url>jdbc:postgresql://192.168.1.7:5432/postgres</jdbc-url>
      <working-dir>$ProjectFileDir$</working-dir>
    </data-source>
  </component>
</project>
```

**Global `options/dataSources.xml`**: `read-only` ve `group` attribute'ları ile `remarks` elementi aynı yerlerde [9]:

```xml
<application>
  <component name="dataSourceStorage" format="xml" multifile-model="true">
    <data-source source="LOCAL" name="SE MySQL" read-only="true"
                 group="Source Systems" uuid="6625d59c-…">
      <driver-ref>mysql.8</driver-ref>
      <remarks>Need to connect via openvpn first</remarks>
      <jdbc-url>jdbc:mysql://…:3306/secretescapes</jdbc-url>
    </data-source>
  </component>
</application>
```

**Proje `dataSources.local.xml`**: yeni format, SSH config referansı ve şema kapsamı [8]:

```xml
<project version="4">
  <component name="dataSourceStorageLocal" created-in="DB-253.29346.170">
    <data-source name="[MASTER]Raspi" uuid="6d279d07-…">
      <database-info product="PostgreSQL" version="15.14" dbms="POSTGRES" … />
      <secret-storage>master_key</secret-storage>
      <user-name>master</user-name>
      <schema-mapping>
        <introspection-scope>
          <node kind="database">
            <name qname="shortcuts_dev" />
            <name qname="shortcuts_prod" />
            <node kind="schema" qname="public" />
          </node>
        </introspection-scope>
      </schema-mapping>
      <ssh-properties>
        <enabled>true</enabled>
        <ssh-config-id>230b5f61-…</ssh-config-id>
      </ssh-properties>
    </data-source>
  </component>
</project>
```

**SSL** (`ssl-config`) [16]:

```xml
<ssl-config use-ide-store="true" use-java-store="true" use-system-store="true">
  <ca-cert>…\Root_CA.pem</ca-cert>
  <client-cert>…\client.crt</client-cert>
  <client-key>…\client.key</client-key>
  <enabled>true</enabled>
  <mode>VERIFY_FULL</mode>
</ssl-config>
```

Yollar makro içerebilir: `$PROJECT_DIR$/ssl-cert.pem`, `$USER_HOME$/Downloads/ca.pem` [17]. Bunlar içe aktarmada genişletilmelidir.

**Eski SSH formatı** (inline, ~2016–2020 sürümleri) [6][7]:

```xml
<ssh-properties>
  <enabled>true</enabled>
  <proxy-host>localhost</proxy-host>
  <proxy-port>2222</proxy-port>
  <secret-storage>master_key</secret-storage>
  <user>vagrant</user>
  <use-password>false</use-password>
  <private-key-path>$PROJECT_DIR$/support/vagrant.ppk</private-key-path>
</ssh-properties>
```

**`sshConfigs.xml`** (yeni format, `ssh-config-id` buraya bakar) [15]:

```xml
<sshConfig id="9fa087b6-…" host="193.168.1.34" port="22" username="time"
           authType="OPEN_SSH" keyPath="$USER_HOME$/.ssh/id_rsa"
           useOpenSSHConfig="true" nameFormat="DESCRIPTIVE" customName="…" />
```

Görülen `authType` değerleri `PASSWORD`, `OPEN_SSH` (ssh-agent / `~/.ssh/config`) ve key dosyası (`KEY_PAIR`; `keyPath` varsa key auth olarak ele alınmalı). Tabularis ve TablePro, `keyPath` varlığını key auth için en güvenilir işaret olarak kullanıyor [10][11].

**Eski introspection-scope formatı** (düz metin) [7]:

```xml
<introspection-scope>harbinger:pg_catalog,public</introspection-scope>
<resolve-scope>harbinger:public,reach-search</resolve-scope>
```

`db:şema1,şema2` biçiminde, birden çok veritabanı varsa `;` ile ayrılmış olabilir (tek örnekten çıkarım).

**Yeni introspection-scope formatı**:

- `<node kind="database" qname="@"><node kind="schema" qname="@"/></node>`: `@` varsayılan veritabanı veya şema anlamına gelir [17]. UI'daki "Default database / Current schema" seçeneğine karşılık geldiği çıkarımdır.
- `<node kind="database"><name qname="a"/><name qname="b"/>…`: birden çok veritabanı adı aynı alt kurala bağlanır [8].
- `<node kind="schema" negative="1"/>`: "hepsi" (negatif seçim, yani hiçbiri hariç değil) [16]. Anlamı örnekten çıkarım.

**Klasör ağacı** (`db-forest-config.xml`) [12]:

```xml
<component name="db-tree-configuration">
  <option name="data" value="----------------------------------------&#10;1:0:05e3931a-…&#10;2:0:c63fed39-…&#10;" />
</component>
```

Bu, satır tabanlı ve belgelenmemiş bir ağaç serileştirmesidir (`seviye:?:uuid`). Ayrıştırması kırılgandır, bu yüzden birincil klasör kaynağı olarak `group` attribute'u tercih edilmelidir.

---

## 3. JDBC URL biçimleri (pgjdbc)

pgjdbc belgesine göre [18]:

- `jdbc:postgresql:database`, `jdbc:postgresql://host/database`, `jdbc:postgresql://host:port/database`, `jdbc:postgresql://host:port/`
- Varsayılanlar: host `localhost`, port `5432`, veritabanı kullanıcı adıyla aynı.
- IPv6 köşeli parantez içinde yazılır: `jdbc:postgresql://[::1]:5740/db`.
- Çoklu host (failover) virgülle ayrılır: `jdbc:postgresql://h1:5432,h2:5433/db?targetServerType=primary`.
- URL'deki ayrılmış karakterler percent-encoded olur.
- İlgili parametreler: `user`, `password`, `ssl`, `sslmode` (`disable|allow|prefer|require|verify-ca|verify-full`, varsayılan `prefer`), `sslrootcert`, `sslcert`, `sslkey`, `sslpassword`, `currentSchema`, `targetServerType`, `ApplicationName`.

DataGrip'in "URL only" bağlantı tipinde URL düz metin saklanır ve parola URL içinde olabilir [3][19]. İçe aktarıcı `password=` parametresini **atmalı** ve kullanıcıyı uyarmalıdır.

SSL ayarları iki yerde olabilir: `ssl-config` elementi ve URL parametreleri (`sslmode=…`). Öncelik konusunda resmî bilgi bulunamadı. Önerilen kural: URL'de `sslmode` varsa o kullanılır, yoksa `ssl-config` (`enabled=true` ise `mode`, `mode` yoksa `prefer`), o da yoksa `prefer` (pgjdbc varsayılanı). `ssl-config` içindeki `mode` değerleri enum adlarıdır (`REQUIRE`, `VERIFY_CA`, `VERIFY_FULL`). Küçük harfe çevirip `_` → `-` dönüşümü yapılmalıdır (Tabularis'in yaptığı gibi [10]).

---

## 4. Ortam, renk ve salt okunurluk

- **Salt okunur:** `dataSources.xml` içinde `read-only="true"` attribute'u [9]. Resmî tanım: "Read-only" kutusu Data editor'da düzenlemeyi engeller, ancak driver desteklemiyorsa konsolda değişiklik mümkün olabilir [19].
- **Renk:** DataGrip'te data source rengi UI'dan ("Name" alanındaki daire veya Tools | Set Color) ayarlanır [3]. Rengin hangi dosyada ve hangi elementte saklandığı **birincil kaynakla doğrulanamadı**. GitHub'daki `dataSources*.xml` örneklerinde renk alanı görülmedi. Renk büyük olasılıkla workspace veya IDE düzeyindeki başka bir ayar dosyasında tutuluyor. İçe aktarmada güvenilir şekilde okunamaz.
- **Ortam / "production" bayrağı:** DataGrip'te Postgres data source'ları için ayrı bir ortam etiketi bulunamadı. Üretim ayrımı renk, read-only ve adlandırma veya grup adlarıyla (ör. `[PROD]`, `group="prod"`) yapılıyor. datadock içe aktarıcısı da ortamı grup adının ve data source adının önekinden sezgisel olarak türetiyor [11].

---

## 5. Parolalar

**IntelliJ nerede saklar?** (Settings › Appearance & Behavior › System Settings › Passwords [19][20]):

- **In native keychain:** macOS Keychain veya Linux'ta GNOME Keyring/KWallet. Resmî sayfaya göre bu seçenek **Windows'ta yok** [20].
- **In KeePass:** `c.kdbx` dosyası, ana parola ile korunur (isteğe bağlı olarak PGP ile). Windows'taki fiilî yol budur. Dosya varsayılan olarak IDE yapılandırma dizinindedir, ana anahtar `c.pwd` içinde tutulur [21].
- **Do not save:** parola her bağlantıda sorulur.
- Data source düzeyinde "Save password" seçenekleri de var: Never / Until restart / Forever [19].
- `dataSources.local.xml` içindeki `<secret-storage>` bu modu kaydeder. Gözlenen değerler `master_key` ve `forget` [6][8][22].
- DataGrip'in kendi parola deposu yoktur: *"DataGrip does not have its own password store. It either uses the native password management system or KeePass."* [3]
- Paylaşılan veya kopyalanan XML parola içermez (URL'e gömülmemişse) [3].

**Üçüncü taraf okuyabilir mi?** Teknik olarak **evet**. TablePro bunu yapıyor [21]:

- Anahtar adı `IntelliJ Platform DB — <data-source-uuid>`.
- SSH için `IntelliJ Platform SshConfigPassword — <host>:<port> <ssh-config-id>`.
- macOS'ta önce Keychain'e bakıyor (bu da kullanıcıya Keychain izin penceresi açtırır). Ardından `c.kdbx` dosyasını, `c.pwd` içindeki ana anahtarı IntelliJ'in gömülü sabit AES anahtarıyla çözerek açıyor.

**Tezgah bunu yapmalı mı?** **Hayır** (öneri):

1. Bu, başka bir uygulamanın gizli deposunu, belgelenmemiş bir şifreleme düzeniyle (gömülü sabit anahtar) açmak demektir. Her IntelliJ sürümünde kırılabilir ve güvenlik açısından kötü bir örnektir.
2. Windows'ta `c.pwd` farklı şekilde (DPAPI veya ana parola) korunabilir. Kod yolu her OS için ayrı ayrı ele alınmalıdır.
3. Tabularis ve datadock da parolaları kasıtlı olarak içe aktarmıyor. datadock'un mesajı: *"Passwords live in the DataGrip keychain and cannot be read. … asks for them the first time you connect."* [10][11]
4. Tezgah'ın "uygulama kimseye kendiliğinden bağlanmaz / gizli veriyi düz metin tutmaz" ilkesine en uygun yol budur.

**Kullanıcının yapması gereken:** İçe aktarma sonrasında her bağlantı "parola yok" durumunda gelir. Kullanıcı ilk bağlantıda parolayı girer ve Tezgah bunu OS anahtar zincirine yazar. Alternatif olarak `.pgpass` içe aktarması (ayrı ticket) parolaları sağlayabilir. SSH key passphrase'leri için de aynı kural geçerlidir.

---

## 6. Önerilen alan eşlemesi

| Tezgah alanı | IntelliJ kaynağı | Not |
|---|---|---|
| `id` | **yeni uuid** üret; IntelliJ `uuid` değerini `importedFrom` vb. olarak sakla | Tekrar içe aktarmada eşleştirme ve tekilleştirme için yararlı |
| `name` | `data-source/@name` | Boşsa URL'den `user@host/db` üret |
| `folder` / `parentId` | `data-source/@group` (bazı içe aktarıcılar `@group-name` okuyor, ikisi de denenmeli) | Grup adında `/` varsa iç içe klasör olarak yorumla. Baştaki görünmez karakterleri (U+200B görüldü [23]) temizle. `db-forest-config.xml` isteğe bağlı ve kırılgan |
| `host` | `jdbc-url` (ilk host) | IPv6 `[...]` destekle. Eski SSH formatında `proxy-host` DB host'u değil, SSH host'udur |
| `port` | `jdbc-url` | Yoksa 5432 |
| `user` | `dataSources.local.xml` → `user-name`; yoksa URL `?user=` | |
| initial database | `jdbc-url` path kısmı | Yoksa kullanıcı adı (pgjdbc kuralı) veya `postgres` |
| SSL `sslmode` | URL `sslmode` > `ssl-config/mode` (enabled=true) > `prefer` | `allow` Tezgah'ta yok, `prefer` olarak eşle |
| SSL CA / cert / key | `ssl-config/ca-cert`, `client-cert`, `client-key`; ya da URL `sslrootcert`, `sslcert`, `sslkey` | `$PROJECT_DIR$`, `$USER_HOME$` makrolarını genişlet |
| ortam etiketi | **eşlenemez**; sezgisel öneri: grup veya ad içinde `prod`, `stag`, `test`, `dev`, `local` ara | Kullanıcı önizlemede onaylamalı. Varsayılan `dev`, localhost ise `local` |
| renk | **eşlenemez**; etiketin varsayılan rengi | |
| salt okunur | `@read-only="true"` | Tezgah'ta `prod` zaten varsayılan salt okunur. `read-only=true` ise etiket ne olursa olsun salt okunur bayrağını taşı |
| SSH etkin | `ssh-properties/enabled = true` | |
| SSH host / port / user | Yeni: `ssh-config-id` → `.idea/sshConfigs.xml`, sonra `JetBrains/*/options/sshConfigs.xml` içinde `sshConfig[@id]`'nin `host`, `port`, `username` değerleri. Eski: `proxy-host`, `proxy-port`, `user` | id bulunamazsa SSH'i "eksik" olarak işaretle |
| SSH auth | `authType` (`PASSWORD`, `OPEN_SSH`, key) + `keyPath`; eski: `use-password`, `private-key-path` | Yalnızca key yolu alınır, passphrase alınmaz |
| görünür veritabanları ve şemalar | `schema-mapping/introspection-scope` (yeni) veya düz metin `introspection-scope` (eski) | `@` → başlangıç veritabanı veya `public`. `negative="1"` → tümü. Ayrıştırılamazsa varsayılan: yalnızca başlangıç veritabanı, tüm şemalar |
| (yok sayılır) | `driver-ref` ≠ `postgresql*` olan kayıtlar | Postgres dışı kaynakları atla, sayısını raporla |

`driver-ref` gerçek dosyalarda `postgresql` olarak görülüyor [8][9]. Redshift, Greenplum, CockroachDB gibi türevler farklı ref'lerle gelebilir. Kapsamlı liste doğrulanmadı. Güvenli yol: `driver-ref` `postgresql` ile başlıyorsa **veya** `jdbc-url` `jdbc:postgresql:` ile başlıyorsa kaydı kabul et.

## 7. Eşlenemeyenler ve bilinçli olarak alınmayanlar

- **Parolalar** (DB ve SSH, key passphrase dahil): bilinçli olarak alınmaz, bkz. §5.
- **Renk:** saklama yeri doğrulanamadı.
- **Ortam etiketi:** IntelliJ'de karşılığı yok. Yalnızca sezgisel tahmin yapılabilir.
- **Çoklu host / failover:** Tezgah modeli tek host. İlk host alınır, diğerleri uyarıyla atılır.
- **Driver ve bağlantı özellikleri** (`<property>`, `targetServerType`, `currentSchema`, `ApplicationName`, `vm-options`, `working-dir`), `auth-provider` (pgpass, Kerberos, AWS IAM vb.), transaction/session modları, `remarks`: Tezgah modelinde alan yok. `remarks` ileride not alanı olarak eklenebilir.
- **SSH zinciri / jump host**, `useOpenSSHConfig` ile `~/.ssh/config` çözümlemesi: tek seviyeli SSH dışında kalanlar alınmaz.
- **`db-forest-config.xml` ağacı:** belgelenmemiş biçim. Yalnızca `group` kullanılır.
- **Introspection önbelleği** (`.idea/dataSources/`): ilgisiz.

## 8. Uygulama için öneriler (kısa)

- Ayrıştırıcı saf bir modül olmalı. Girdi olarak dosya içerikleri (`dataSources.xml`, `dataSources.local.xml`, `sshConfigs.xml` listesi) alınır, çıktı olarak "içe aktarma önizleme kayıtları" ve uyarılar üretilir. Dosya sistemi taraması ayrı tutulur. Birim testleri için fixture olarak §2'deki varyantlar kullanılabilir: yeni/eski SSH, yeni/eski scope, global `<application>` kökü, URL-only parola.
- Dosya bulma: (a) kullanıcının seçtiği proje klasörü (`.idea/`) ve (b) `JetBrains/*/options/` taraması, isteğe bağlı olarak `recentProjects.xml` üzerinden projeler.
- `uuid` birleştirmesi: paylaşılan ve local kayıtları birleştir. Yalnızca local'de olan kayıt (paylaşılanı silinmiş) atlanır.

---

## Kaynaklar

1. DataGrip Help 2026.2, *Working with projects*: https://www.jetbrains.com/help/datagrip/2026.2/working-with-projects.html (2025.2 sürümü: https://www.jetbrains.com/help/datagrip/2025.2/working-with-projects.html)
2. JetBrains DataGrip blog, *Copy and share data sources in DataGrip* (2018): https://blog.jetbrains.com/datagrip/2018/05/21/copy-and-share-data-sources-in-datagrip/ (alıntı arama özetinden; sayfa doğrudan 403 döndü)
3. DataGrip Help, *Data sources* / *Moving data sources*: https://www.jetbrains.com/help/datagrip/managing-data-sources.html, https://www.jetbrains.com/help/datagrip/moving-your-data-sources-onto-another-computer.html
4. DataGrip Help, *Directories used by the IDE*: https://www.jetbrains.com/help/datagrip/directories-used-by-the-ide-to-store-settings-caches-plugins-and-logs.html
5. DBeaver, DataGrip içe aktarıcı sabitleri: https://github.com/dbeaver/dbeaver/blob/devel/plugins/org.jkiss.dbeaver.ui.config.migration/src/org/jkiss/dbeaver/ui/config/migration/datagrip/DataGripConfigXMLConstant.java
6. wikimedia/mediawiki-vagrant, `support/idea-dist/dataSources.local.xml` (eski inline SSH)
7. joedaniels29/IntelliJIdea2016.2, `options/dataSources.local.xml` (global, `<application>` kökü, eski scope)
8. bebert64/nix-configs, `programs/datagrip/datasources/perso/dataSources{,.local}.xml` (Postgres, yeni format, `ssh-config-id`, çoklu DB scope)
9. robin-patel-se/sql_files, `settings/options/dataSources.xml` (global, `group`, `read-only`, `remarks`)
10. TabularisDB/tabularis, `src-tauri/src/connection_import/datagrip.rs`
11. deviumbe/datadock, `src/main/io/datagrip.ts`
12. Zhanasyl08/Assigment-OOP, `db-forest-config.xml`
13. JetBrains Help, *SSH Configurations* ("Visible only for this project" → `.idea`): https://www.jetbrains.com/help/rider/Settings_Tools_SSH_Configurations.html
14. JetBrains forum, *Include SSH properties in shared dataSources.xml?* (DBE-20104): https://intellij-support.jetbrains.com/hc/en-us/community/posts/17320715077650 (arama özetinden; sayfa 403)
15. jstrp/jetbrain_setting, `options/sshConfigs.xml`; xs-repositories/IDEA-Settings-Repository-Windows, `sshConfigs.xml`
16. LP1994/web-project-template, `.idea/dataSources.local.xml` (`ssl-config` + `mode`)
17. allanpichardo/music-search, `.idea/dataSources.local.xml` (Postgres, `qname="@"`, `$PROJECT_DIR$`); MesutEmpire/PharmaTrack (`$USER_HOME$`)
18. pgjdbc, *Connecting to the database*: https://jdbc.postgresql.org/documentation/use/
19. DataGrip Help, *Data Sources and Drivers dialog*: https://www.jetbrains.com/help/datagrip/data-sources-and-drivers-dialog.html
20. IntelliJ IDEA Help, *Passwords*: https://www.jetbrains.com/help/idea/reference-ide-settings-password-safe.html
21. TableProApp/TablePro, `apple/TablePro/Core/Services/Export/ForeignApp/JetBrains/JetBrainsCredentialStore.swift`
22. aws-samples/sagemaker-ssh-helper, `dataSources.local.xml` (`secret-storage` = `forget`)
23. HangarMC/Hangar, `.idea/dataSources.xml` (`group="​backend"`, baştaki sıfır genişlikli boşluk)
