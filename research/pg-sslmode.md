# Araştırma: `pg` sürücüsünde `sslmode` davranışı

Ticket: "pg sürücüsünde sslmode davranışı" · Tarih: 2026-11-03 · İncelenen kaynak: `brianc/node-postgres` `master` (CHANGELOG'daki son sürüm `pg@8.23.0`).

## Kısa cevap

- `pg`, libpq'nun `sslmode` kavramını **kendisi uygulamaz**. Tek kararı `ssl` config'i verir: falsy ise düz TCP, truthy ise SSLRequest gönderir. Sunucu `N` (SSL yok) cevabını verirse bağlantı **hata ile biter**. Düz bağlantıya geri düşme (fallback) yoktur. Yani `prefer` desteklenmez. [1]
- `sslmode` yalnızca **connection string** (`pg-connection-string`) ve `PGSSLMODE` ortam değişkeni üzerinden yorumlanır. Varsayılan (uyumluluk modu kapalı) davranışta `prefer`/`require`/`verify-ca`, `verify-full` gibi davranır ve bir uyarı basılır. [2][3]
- Tezgah **connection string kullanmamalı**. Kendi alanlarından doğrudan `ssl: {...}` nesnesini kurmalı, `prefer` için fallback'i de kendisi yapmalıdır.

## 1. Kaynak bulguları

### 1.1 `pg` çekirdeği (`packages/pg/lib/connection.js`) [1]

- `ssl` truthy ise bağlantı açılınca SSLRequest gönderilir. Sunucunun ilk baytına göre:
  - `S` → TLS'e yükseltilir (`upgradeToSSL`).
  - `N` → stream kapatılır ve `"The server does not support SSL connections"` hatası verilir.
  - Diğer bayt → `"There was an error establishing an SSL connection"` hatası verilir.
- `upgradeToSSL(host)` sırası şöyledir:
  1. `options = { socket: stream, host }`
  2. `ssl !== true` ise `Object.assign(options, ssl)` uygulanır.
  3. `sslNegotiation === 'direct'` ise `ALPNProtocols = ['postgresql']` eklenir.
  4. **`net.isIP(host) === 0` ise `options.servername = host`.** Bu adım (2)'den sonra gelir. Bu yüzden `host` bir hostname ise kullanıcının verdiği `ssl.servername` **ezilir**. `host` bir IP ise (örn. `127.0.0.1`) kullanıcının değeri korunur.
- Buradaki `host`, `connect(port, host)`'a gelen config `host`'udur. Sonuçta seçenekler Node `tls.connect`'e iletilir (`stream.getSecureStream`).
- `config.stream` verilebilir (nesne ya da `config` alan bir fonksiyon). `pg` yine de `stream.connect(port, host)` çağırır. Bu yüzden ssh2 kanalı doğrudan verilecekse `connect` metodu sarmalanmalıdır (bkz. §3).

### 1.2 `ConnectionParameters` ve `PGSSLMODE` (`connection-parameters.js`) [3]

- `config.ssl` tanımsızsa `PGSSLMODE` okunur: `disable` → `false`, `prefer|require|verify-ca|verify-full` → `true` (tam doğrulama), `no-verify` → `{ rejectUnauthorized: false }`.
- `ssl: 'no-verify'` string'i de `{ rejectUnauthorized: false }` anlamına gelir.
- `sslnegotiation` (`PGSSLNEGOTIATION`) yalnızca `postgres` veya `direct` olabilir. `direct` + SSL kapalı → hata.
- Tezgah için önemli not: `ssl`'i her zaman açıkça (`false` ya da nesne) verirsek kullanıcının ortamındaki `PGSSLMODE` davranışı etkilemez.

### 1.3 `pg-connection-string` (`packages/pg-connection-string/index.js`) [2]

- `sslcert`/`sslkey`/`sslrootcert`/`sslmode` parametrelerinden biri varsa `config.ssl = {}` olur. Dosyalar `fs.readFileSync` ile okunur ve `cert`/`key`/`ca` alanlarına konur.
- **Varsayılan mod** (uyumluluk kapalı):
  - `disable` → `ssl = false`.
  - `prefer` / `require` / `verify-ca` / `verify-full` → hepsi ek ayarsız (`rejectUnauthorized` varsayılanı `true`, hostname kontrolü açık), yani **`verify-full` gibi** davranır.
  - `verify-full` dışındakiler için bir kez `process.emitWarning` basılır: *"SECURITY WARNING: The SSL modes 'prefer', 'require', and 'verify-ca' are treated as aliases for 'verify-full'. In the next major version (pg-connection-string v3.0.0 and pg v9.0.0), these modes will adopt standard libpq semantics…"*
  - `no-verify` → `rejectUnauthorized: false`.
- **`uselibpqcompat=true`** (connection string içinde) veya `parse(str, { useLibpqCompat: true })` ile libpq anlamları devreye girer. İkisi birlikte verilirse hata fırlatılır.
  - `disable` → `ssl = false`
  - `prefer` → `rejectUnauthorized: false`. **Fallback yine yoktur.** Sunucu SSL desteklemezse bağlantı hata verir.
  - `require` → `sslrootcert` varsa `checkServerIdentity = () => {}` (libpq'daki gibi verify-ca'ya döner), yoksa `rejectUnauthorized: false`.
  - `verify-ca` → `ca` zorunludur, yoksa "SECURITY WARNING… verify-ca requires specifying a CA with sslrootcert" hatası fırlatılır. Ardından `checkServerIdentity = () => {}` atanır.
  - `verify-full` → varsayılan Node doğrulaması kullanılır.
- `sslnegotiation=direct` ve SSL ayarlanmamışsa `ssl = true` yapılır.
- Uyarı ve uyumluluk modu, PR #3473 ("warn if non-standard ssl options are used", Temmuz 2025) ile eklendi [4]. Bunun hangi `pg-connection-string` 2.x sürümüyle yayınlandığı birincil kaynakta doğrulanamadı. Major sürümde (v3 / `pg@9`) varsayılan libpq semantiğine geçecek.
- node-postgres SSL sayfası da uyarır: connection string'de `sslmode`/`sslcert`… varsa bunlar `ssl` nesnesinin **yerine geçer** ve nesnedeki ek ayarlar kaybolur [5].

### 1.4 libpq anlamları (referans) [6]

| sslmode | Şifreleme | CA doğrulama | Hostname doğrulama |
|---|---|---|---|
| disable | yok | – | – |
| prefer | önce SSL dener, olmazsa düz bağlanır | yok | yok |
| require | zorunlu | yok (root cert dosyası varsa verify-ca gibi) | yok |
| verify-ca | zorunlu | var | yok |
| verify-full | zorunlu | var | var |

### 1.5 Node `tls` [7]

- `rejectUnauthorized` (varsayılan `true`): sertifika verilen CA'lara (`ca` yoksa Node'un kök deposuna) karşı doğrulanır.
- `checkServerIdentity(servername, cert)`: hostname kontrolünü yapar. Varsayılan `tls.checkServerIdentity`'dir ve yalnızca CA zinciri geçtikten sonra çağrılır. Kontrol edilen ad, **açıkça verildiyse `servername`**, değilse host'tur.
- `servername`: SNI değeridir ve IP olamaz.
- `socket`: herhangi bir Duplex stream olabilir. Bu durumda `host`/`port` yalnızca sertifika doğrulaması için kullanılır.

## 2. `prefer` için ne yapmalı?

`pg` fallback yapmaz. Seçenekler:

1. **Önerilen: iki aşamalı deneme.** Önce `ssl: { rejectUnauthorized: false, ...ca/cert/key }` ile bağlanılır. Hata mesajı `The server does not support SSL connections` ise (sunucu `N` döndü) aynı bağlantı `ssl: false` ile **bir kez** yeniden denenir.
   - Yalnızca bu hata türünde geri düşülür. Kimlik doğrulama veya ağ hatalarında geri düşülmez.
   - SSH tünelinde yeniden deneme yeni bir forward/kanal açmayı gerektirir.
   - Sonuçta hangi modda bağlanıldığı (SSL / düz) UI'da gösterilmeli. Sonraki pool bağlantılarına seçilen mod hatırlanarak uygulanmalı ki her bağlantıda iki tur atılmasın.
2. Alternatif olarak `prefer`'i `require` gibi ele almak (fallback yok). Daha güvenlidir ama SSL'siz yerel/dev sunucularda kullanıcıyı şaşırtır. Yeni bağlantıların varsayılanı `prefer` olduğu için 1. seçenek daha doğrudur.

Not: libpq'da da `prefer` MITM'e karşı koruma sağlamaz (doğrulama yoktur). Bu yüzden `prod` etiketli bağlantıda `prefer` seçilirse uyarı gösterilmeli.

## 3. SSH tüneli ve `verify-full`

TCP eşi gerçek DB host'u olmadığı için hostname kontrolünün gerçek ada (`dbHost`) göre yapılması gerekir.

- **Yerel port forward** (`host: '127.0.0.1'`, `port: <yerel>`): `host` bir IP olduğu için `pg`, `servername`'i ezmez. Bu yüzden `ssl: { servername: dbHost, ... }` yeterlidir. Node da hostname kontrolünü açıkça verilen `servername` ile yapar.
- **ssh2 forwarded stream** (`config.stream`): `pg`'ye `host: dbHost` verilebilir, çünkü TCP için kullanılmaz. Bu durumda `pg` `servername = dbHost` atar ve doğrulama otomatik doğru olur. Ancak `pg`, `stream.connect(port, host)` çağırdığı için kanal, `connect`'i `'connect'` olayı yayan bir sarmalayıcıyla verilmelidir.
- **Her iki durumda sağlam yol:** `pg`'nin `servername` mantığına bağımlı kalmamak için `checkServerIdentity`'yi açıkça yazmak:

  ```ts
  checkServerIdentity: (_name, cert) => tls.checkServerIdentity(dbHost, cert)
  ```

  Ayrıca `servername: dbHost` verilmeli (SNI, bulut sağlayıcılarda doğru sertifikanın seçilmesi için gerekebilir). `dbHost` bir IP ise `servername` verilmez. `tls.checkServerIdentity` IP'yi SAN içindeki IP girdilerine karşı kontrol eder.

## 4. Postgres 17 direct SSL (`sslnegotiation=direct`)

`pg@8.22.0` ile destekleniyor [8][5]. Config: `sslnegotiation: 'direct'` (ya da `PGSSLNEGOTIATION`). SSL zorunludur, ALPN `postgresql` gönderilir ve SSLRequest turu atlanır. Sunucunun PG17+ olması gerekir. `prefer` ile birlikte anlamsızdır, yalnızca SSL açık modlarda kullanılabilir. Tezgah için şimdilik gereksiz, ileride gelişmiş bir seçenek olarak eklenebilir.

## 5. Eşleme tablosu (Tezgah alanları → `pg` config)

`ca`, `cert`, `key` alanları, dosya yolları verilmişse bağlantı anında `fs.readFileSync` ile okunur (yol yoksa alan eklenmez). `realHost` = kullanıcının girdiği DB host'udur (tünelde de gerçek ad).

| Tezgah `sslmode` | `pg` config | Notlar |
|---|---|---|
| `disable` | `ssl: false` | `PGSSLMODE`'u da etkisizleştirir. |
| `prefer` | 1. deneme: `ssl: { rejectUnauthorized: false, ca?, cert?, key? }`. Hata `"The server does not support SSL connections"` ise 2. deneme: `ssl: false` | Fallback'i Tezgah yapar. Hangi modla bağlanıldığı gösterilir. `prod` ise uyarı verilir. |
| `require` | `ssl: { rejectUnauthorized: false, cert?, key? }`. CA verilmişse `verify-ca` satırı uygulanır. | libpq ile aynı: CA dosyası varsa verify-ca gibi davranır. |
| `verify-ca` | `ssl: { rejectUnauthorized: true, ca (zorunlu), cert?, key?, checkServerIdentity: () => undefined }` | CA yoksa form doğrulamasında reddedilir (`pg-connection-string` de hata fırlatıyor). |
| `verify-full` | `ssl: { rejectUnauthorized: true, ca?, cert?, key?, servername: realHost (IP değilse), checkServerIdentity: (_, c) => tls.checkServerIdentity(realHost, c) }` | CA yoksa sistem/Node kök deposu kullanılır. Tünelde de gerçek host doğrulanır. |

Her bağlantıda: `connectionString` **kullanılmaz** (uyarı mesajları ve `ssl` nesnesinin ezilmesi sorunları ortadan kalkar). `ssl` her zaman açıkça verilir.

## 6. Öneri

1. SSL config'i, saf ve birim testli bir modülde (`buildSslConfig(conn, realHost) → { ssl, fallbackToPlain: boolean }`) üretin. Dosya okuma bu modülün dışında, enjekte edilen bir okuyucuyla yapılsın.
2. Yukarıdaki tabloyu birebir uygulayın. `pg-connection-string`'in `sslmode` yorumuna ve `uselibpqcompat`'a bağımlı olmayın, çünkü bunlar `pg@9`'da değişecek. Kendi `ssl` nesnemiz sürüm değişikliğinden etkilenmez.
3. `prefer` için tek seferlik, yalnızca "server does not support SSL" hatasına bağlı düz bağlantı fallback'i yapın ve sonucu UI'da gösterin.
4. `verify-full`'da (tünelli ya da tünelsiz) her zaman açık `checkServerIdentity(realHost)` ve uygun durumda `servername` kullanın.
5. `sslnegotiation=direct`'i şimdilik kapsam dışı bırakın.

## Kaynaklar

1. `pg/lib/connection.js`: https://github.com/brianc/node-postgres/blob/master/packages/pg/lib/connection.js
2. `pg-connection-string/index.js`: https://github.com/brianc/node-postgres/blob/master/packages/pg-connection-string/index.js
3. `pg/lib/connection-parameters.js`: https://github.com/brianc/node-postgres/blob/master/packages/pg/lib/connection-parameters.js
4. PR #3473 "warn if non-standard ssl options are used" (brianc/node-postgres, Temmuz 2025). Kesin yayın sürümü doğrulanamadı.
5. node-postgres SSL dokümanı: https://node-postgres.com/features/ssl
6. libpq SSL desteği: https://www.postgresql.org/docs/current/libpq-ssl.html
7. Node.js `tls`: https://nodejs.org/api/tls.html (`tls.connect` seçenekleri, `tls.checkServerIdentity`)
8. node-postgres CHANGELOG: https://github.com/brianc/node-postgres/blob/master/CHANGELOG.md (`pg@8.22.0` direct SSL, `pg@8.4.0` connection string'de sslmode, `pg@8.0.0` `rejectUnauthorized` varsayılanı `true`)
