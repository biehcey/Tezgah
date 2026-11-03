# Araştırma: SSH kütüphanesi, kimlik doğrulama ve agent desteği

Ticket: "SSH: kütüphane, kimlik doğrulama ve agent desteği"
Tarih: 2026-11-03
Kapsam: Tezgah'ın (Node.js + TypeScript, `pg`, `npx` ile başlatılan, macOS + Windows) SSH tüneli için kütüphane seçimi. Kayıtlı her bağlantıda tek bir tünel olur ve o bağlantının veritabanı başına açılan `pg.Pool`'ları bu tüneli paylaşır.

Kaynaklar birincil: `mscdex/ssh2` README ve kaynak kodu (master, 2026-08), npm registry meta verisi, `brianc/node-postgres` kaynak kodu (master, `pg@8.23.1`), `cyjake/ssh-config` README ve issue'ları, OpenSSH `sshd(8)`, PuTTY kılavuzu, Microsoft Learn. Her iddianın yanında kaynağı var.

---

## TL;DR / Öneri

- **`ssh2` kullanılmalı** (`ssh2@1.17.0`). Node'da tünel, agent, ProxyJump zinciri ve host key doğrulaması için pratikte tek ciddi, saf JS seçenek bu. `tunnel-ssh` gibi paketler zaten bunun üzerine ince bir katman (`tunnel-ssh@5.2.0` yalnızca `ssh2`'ye bağımlı) ve yerel port açtıkları için tercih edilmemeli.
- **Yerel port açmaya gerek yok.** `pg`'nin `stream` seçeneği bir factory fonksiyonu da olabilir; her `Client` için çağrılır. Ama `forwardOut` kanalı doğrudan verilemez: `pg` önce eşzamanlı olarak `stream.setNoDelay()` ve `stream.connect(port, host)` çağırıp `'connect'` olayını bekliyor. Bu yüzden `connect()` içinde `forwardOut` yapan, `setNoDelay`/`setKeepAlive` metotlarını no-op olarak sağlayan ince bir `Duplex` sarmalayıcı yazılmalı (aşağıda taslak var).
- **Kimlik doğrulama:** password, private key (OpenSSH yeni format + bcrypt passphrase, ed25519, ecdsa, RSA rsa-sha2-256/512, PPK) ve agent kaynak kodunda çalışıyor. macOS'ta `agent: process.env.SSH_AUTH_SOCK`, Windows'ta `agent: '\\\\.\\pipe\\openssh-ssh-agent'` kullanılır. `ssh2` `SSH_AUTH_SOCK`'u kendiliğinden okumaz, bunu bizim vermemiz gerekir.
- **Pageant (dikkat):** yayımlanmış `1.17.0`'da `'pageant'` değeri hâlâ var, ama **master'da kaldırıldı** (2026-05-27, "lib,util: remove pageant support", güvenlik raporu #1498). Buna güvenmeyin. Güncel Pageant zaten Windows named pipe üzerinden dinliyor; o pipe yolu `agent`'a verilirse `OpenSSHAgent` olarak çalışır.
- **Host key:** `hostVerifier(key: Buffer)` ham key blob'unu verir (v1'den beri). `known_hosts` için bakımı süren bir kütüphane yok. Ayrıştırıcıyı (hashed `|1|` girdileri dahil) saf bir modül olarak kendimiz yazmalıyız. Küçük bir iş ve birim testine çok uygun.
- **`~/.ssh/config`:** `ssh-config@5.3.0` bakımda ve TypeScript tipleriyle geliyor. İçe aktarma/öneri için kullanılabilir, ancak `compute()` varsayılan olarak `Match exec` komutlarını shell'de **çalıştırıyor**. Mutlaka `{ matchExec: false }` geçilmeli. Bunu MVP'ye koymak şart değil, sonradan eklenebilir.
- **Native bağımlılıklar:** `ssh2`'nin `install` script'i bir `node-gyp` derlemesi deniyor, `cpu-features` (optional) da `node-gyp rebuild` yapıyor. İkisi de başarısız olursa kurulum yine başarılı biter ve saf JS/WASM yedeğe düşülür, fakat `npx` ile ilk kurulum yavaşlayabilir ve konsola derleme hataları yazılabilir. Bu bir engel değil, bir kozmetik/süre riski.

---

## 1. `forwardOut` stream'i `pg`'ye doğrudan verilebilir mi?

### `pg` tarafı (kaynak: `packages/pg/lib/connection.js`, `client.js`, `stream.js`)

`Connection` constructor'ı:

```js
this.stream = config.stream || getStream(config.ssl)
if (typeof this.stream === 'function') {
  this.stream = this.stream(config)
}
```

`Client`, `new Connection({ stream: c.stream, ssl, sslNegotiation, keepAlive, ... })` ile kurulur (`client.js`). Yani `stream` olarak bir **fonksiyon** verilirse her yeni `Client` için ayrı ayrı çağrılır. `pg.Pool` her bağlantı için `new Client(options)` yaptığından factory doğal olarak havuzla uyumlu. Fonksiyona `Connection` config'i geçer (host/port bu config'te **yok**; onlar `connect(port, host)` ile ayrıca geliyor).

`Connection.connect(port, host)`:

```js
this.stream.setNoDelay(true)
this.stream.connect(port, host)
this.stream.once('connect', function () {
  if (self._keepAlive) self.stream.setKeepAlive(true, self._keepAliveInitialDelayMillis)
  self.emit('connect')
})
```

SSL açıksa `'data'` ile `S`/`N` yanıtı bekleniyor ve ardından `tls.connect({ socket: this.stream, ... })` (`getSecureStream`) çağrılıyor. `tls.connect` herhangi bir `Duplex` kabul ettiği için TLS, SSH kanalının üzerinde de çalışır. `connectionTimeoutMillis` dolarsa `con.stream.destroy(...)` çağrılıyor (`client.js`).

Factory **eşzamanlı** olduğu için içinde `await forwardOut(...)` yapılamaz.

### `ssh2` tarafı

README: `forwardOut(srcIP, srcPort, dstIP, dstPort, callback)`. Callback `(err, stream)` alır ve bu bir `Channel` (`Duplex`) nesnesidir. `Channel`'da `connect`, `setNoDelay` ve `setKeepAlive` yok.

### Sonuç

Doğrudan verilemez, ama yerel port da gerekmez. İnce bir sarmalayıcı yeterli:

```ts
import { Duplex } from 'node:stream';
import type { Client as SshClient, ClientChannel } from 'ssh2';

class SshForwardSocket extends Duplex {
  private ch?: ClientChannel;
  constructor(private ssh: SshClient) { super(); }
  setNoDelay() { return this; }            // pg çağırıyor; SSH kanalında anlamı yok
  setKeepAlive() { return this; }          // keepAlive: true verilirse çağrılır
  connect(port: number, host: string) {
    this.ssh.forwardOut('127.0.0.1', 0, host, port, (err, ch) => {
      if (err) return this.destroy(err);
      this.ch = ch;
      ch.on('data', (d) => { if (!this.push(d)) ch.pause(); });
      ch.on('end', () => this.push(null));
      ch.on('close', () => this.destroy());
      ch.on('error', (e) => this.destroy(e));
      this.emit('connect');
    });
    return this;
  }
  _read() { this.ch?.resume(); }
  _write(chunk: Buffer, enc: BufferEncoding, cb: (e?: Error | null) => void) { this.ch!.write(chunk, cb); }
  _final(cb: () => void) { this.ch?.end(); cb(); }
  _destroy(err: Error | null, cb: (e: Error | null) => void) { this.ch?.close(); cb(err); }
}

// Bağlantı başına tek tünel, veritabanı başına bir Pool:
new pg.Pool({ host: 'db.internal', port: 5432, database, user, password,
              stream: () => new SshForwardSocket(tunnel.client) });
```

Notlar:
- `host`/`port` hedef sunucunun (SSH sunucusunun gördüğü) adresi olarak `pg`'ye verilir ve `connect(port, host)` ile sarmalayıcıya ulaşır. `pg` bunlarla kendisi TCP açmaz.
- Factory, tünel hazır değilken çağrılırsa (ör. SSH koptuysa) `connect()` içinde hata verip `destroy(err)` etmeli. Pool bunu bağlantı hatası olarak görür.
- SSL + `sslmode=verify-full` kullanılırsa sertifika doğrulaması yine `host` üzerinden yapılır. Tünel durumunda bu doğru hedef adı olduğu için sorun yok.
- **Alternatif (önerilmez):** `net.createServer` ile `127.0.0.1:0`'da port açıp her bağlantıda `forwardOut` yapmak (`tunnel-ssh`'ın yaptığı budur). Çalışır, ama makinedeki her yerel süreç o porta bağlanabilir, port/yaşam döngüsü yönetimi de ek iş getirir. Stream yaklaşımı daha az hareketli parça içeriyor.

## 2. Kimlik doğrulama yolları

Kaynak: `ssh2` README (`connect()` seçenekleri), `lib/client.js`, `lib/protocol/keyParser.js`, `lib/agent.js`.

| Yol | Durum | Kanıt |
|---|---|---|
| Password | Çalışır | README `password` seçeneği. `tryKeyboard: true` ile keyboard-interactive de denenir (`client.js`: `this.config.tryKeyboard = (cfg.tryKeyboard === true)`). Bazı sunucular password'ü yalnızca keyboard-interactive üzerinden kabul eder, bu yüzden `tryKeyboard` + `keyboard-interactive` olayında aynı şifreyle yanıt vermek akıllıca. |
| Private key, OpenSSH yeni format | Çalışır | `keyParser.js` `OpenSSH_Private.parse`: `kdfName === 'bcrypt'` destekleniyor (`bcrypt-pbkdf` bağımlılığı). Passphrase yoksa `'Encrypted private OpenSSH key detected, but no passphrase given'`, yanlışsa `'OpenSSH key integrity check failed -- bad passphrase?'` hatası verir. Bu hata metinleri UI'da "passphrase gerekli/yanlış" diye eşlenebilir. |
| Eski PEM (`BEGIN RSA PRIVATE KEY`, şifreli) | Çalışır | `OpenSSH_Old_Private.parse`, OpenSSL şifre listesiyle. |
| PPK (PuTTY) | Çalışır | README: `parseKey` "OpenSSH, RFC4716, or PPK format". |
| ed25519 / ecdsa-nistp256/384/521 | Çalışır | `keyParser.js` `ssh-ed25519`, `ecdsa-sha2-nistp*` dalları. ed25519 için Node'un `crypto` desteğine bakılıyor (`eddsaSupported`). Node ≥16'da var. |
| RSA, SHA-2 imza | Çalışır | `client.js` `getKeyAlgos`: sunucunun `server-sig-algs` uzantısına bakıp `rsa-sha2-256`, sonra `rsa-sha2-512` seçiyor. Yalnızca hiçbiri yoksa `ssh-rsa` (SHA-1) deneniyor. `ssh-rsa`'yı kapatmış modern OpenSSH sunucularıyla uyumlu. |
| FIDO/U2F (`sk-ssh-ed25519@openssh.com`, `sk-ecdsa-...`) | **Desteklenmiyor** | `client.js`, `keyParser.js` ve `agent.js` içinde `sk-` anahtar tipi geçmiyor. Bu anahtarlar ancak agent üzerinden de çalışmaz, çünkü imza tipi tanınmıyor. Bilinen kısıt olarak belgelenmeli. |
| `privateKey` dizi | Yalnızca ilki | `client.js`: dizi verilirse yalnızca ilk anahtar kullanılıyor. Birden çok `IdentityFile` denemek için `authHandler` fonksiyonu kullanılmalı. |

Varsayılan sıra (README `authHandler`): `None -> Password -> Private Key -> Agent (-> keyboard-interactive) -> Hostbased`. Kendi sıramızı `authHandler` dizisi/fonksiyonuyla verebiliriz.

### Agent: macOS ve Windows

`lib/agent.js` (master):

```js
const WINDOWS_PIPE_REGEX = /^[/\\][/\\]\.[/\\]pipe[/\\].+/;
function createAgent(path) {
  if (process.platform === 'win32' && !WINDOWS_PIPE_REGEX.test(path))
    return new CygwinAgent(path);
  return new OpenSSHAgent(path);
}
```

- **macOS:** `agent: process.env.SSH_AUTH_SOCK` → `OpenSSHAgent` (UNIX socket, `net.Socket`). `ssh2` `SSH_AUTH_SOCK`'u **kendiliğinden okumuyor** (kaynakta geçmiyor), bu yüzden değeri bizim vermemiz gerekiyor. macOS'ta launchd her oturum için `SSH_AUTH_SOCK` sağlar; `npx`'in başlatıldığı terminal bu değişkeni devralır. 1Password/Secretive gibi agent'lar da yalnızca farklı bir socket yolu kullanır, onlarla da aynı şekilde çalışır.
- **Windows OpenSSH agent:** `\\.\pipe\openssh-ssh-agent` → regex'e uyuyor → `OpenSSHAgent` (Node `net` named pipe'a bağlanabiliyor). 2018'de eklendi ("Agent: assume Windows pipe path is an ssh-agent socket", issue #748/#892). Pipe adı Win32-OpenSSH'tan geliyor (ssh2 #892'de alıntılanıyor). Microsoft Learn'e göre **`ssh-agent` servisi varsayılan olarak devre dışı**, yani kullanıcının `Set-Service ssh-agent -StartupType Automatic; Start-Service ssh-agent` çalıştırması gerekiyor. Pipe yoksa UI bunu açıklamalı.
- **Windows'ta `SSH_AUTH_SOCK` varsa** (ör. Git Bash'in ssh-agent'ı) bu bir Cygwin/MSYS socket dosyasıdır → `CygwinAgent` seçilir. Yedek olarak desteklenir ama birincil yol değil.
- **Pageant:**
  - Yayımlanmış `ssh2@1.17.0` (2025-08-20) README'si: "Windows users: set to 'pageant' for authenticating with Pageant". Bu sürüm bunu paketle gelen `pagent.exe` yardımcısı ile yapıyor.
  - Master'da `lib,util: remove pageant support` commit'i (2026-05-27) bu yolu kaldırdı. Tetikleyici, yardımcıdaki bellek taşması raporu (issue #1498, "Potential Windows Pageant helper OOB write"). README hâlâ `PageantAgent`'tan bahsediyor ama `lib/agent.js` artık dışa aktarmıyor. Bir sonraki sürümde `'pageant'` değeri büyük olasılıkla `CygwinAgent` yoluna düşüp hata verecek.
  - **Çözüm:** PuTTY kılavuzu (9.3.3) Pageant'ın Windows named pipe'ı üzerinden dinlediğini, Windows OpenSSH'ın da aynı mekanizmayı kullandığını söylüyor. Pageant `--openssh-config <dosya>` ile bu pipe yolunu içeren bir `IdentityAgent` satırı yazabiliyor. Bu pipe yolu `agent`'a verildiğinde `OpenSSHAgent` olarak çalışır. Pipe adı kullanıcıya özgü ve sabit değil, bu yüzden `--openssh-config` dosyasından ya da kullanıcıdan okunmalı. `'pageant'` dizesine hiç güvenmeyin.
- Agent'tan RSA imzası: `AgentProtocol` `sign` için `hash: 'sha256'|'sha512'` bayraklarını (`SSH_AGENT_RSA_SHA2_256/512`) gönderiyor, yani agent'taki RSA anahtarlarıyla da SHA-2 imza alınıyor.

## 3. `~/.ssh/config` okuma

- **`ssh-config`** (`cyjake/ssh-config`), `5.3.0`, son yayın 2026-09-11. TypeScript tipleriyle geliyor (`lib/ssh-config.d.ts`), çalışma zamanı bağımlılığı yok (npm `dependencies` boş).
  - `SSHConfig.parse(text).compute(host)` → `HostName`, `User`, `Port`, `IdentityFile` (her zaman dizi), `ProxyJump` vb. ssh_config(5)'teki "first obtained value wins" kuralına uyar.
  - `compute(host, { ignoreCase: true })` direktif adlarını OpenSSH gibi küçük harfe çevirir.
  - **Güvenlik:** README'ye göre "`Match exec` criteria are evaluated by default to match OpenSSH behavior". Issue #107 bunun `spawnSync({shell:true})` ile yapıldığını belirtiyor. Tezgah'ta `{ matchExec: false }` **zorunlu**.
  - `Include`: v5.3.0 (#121) çok yollu `Include` satırlarını yalnızca *tokenize* ediyor. README'de dosyaların açılıp birleştirildiğine dair bir şey yok, yani `Include` ile gelen dosyaları kendimiz okuyup eklememiz gerekebilir. Kullanmadan önce doğrulanmalı.
  - `%h`, `%r`, `~` gibi token genişletmeleri yapılıyor mu, README söylemiyor. `IdentityFile ~/.ssh/id_ed25519` için `~` genişletmesini kendimiz yapmalıyız (Windows'ta `os.homedir()`).
- **Değer mi?** Evet, ama "içe aktarma / öneri" olarak: kullanıcı bir Host alias'ı seçer, `HostName/User/Port/IdentityFile/ProxyJump` forma doldurulur ve bağlantı Tezgah'ın kendi kaydına dönüşür. Çalışma zamanında `~/.ssh/config`'i canlı uygulamaya (OpenSSH semantiğini tam taklit etmeye) değmez: `Match`, `Include`, token'lar, `CanonicalizeHostname` gibi kenar durumlar çok. Bu, CLAUDE.md'deki "`dataSources.xml` ve `.pgpass` içe aktarma" ile aynı kategoride, saf bir içe aktarma modülü olur.

## 4. Bastion / ProxyJump zinciri

README ("Connection hopping") deseni: ilk `Client` ile `forwardOut('127.0.0.1', 12345, '10.1.1.40', 22, ...)` yapılır, dönen stream ikinci `Client`'a `sock` olarak verilir:

```js
conn1.forwardOut('127.0.0.1', 12345, '10.1.1.40', 22, (err, stream) => {
  conn2.connect({ sock: stream, username: 'user2', password: 'password2' });
});
```

- `sock` README'de "A ReadableStream to use for communicating with the server instead of creating and using a new TCP connection (useful for connection hopping)" diye tanımlanıyor. `client.js`: `const sock = this._sock = (cfg.sock || new Socket());`. Verilen stream'de DNS/`connect()` yapılmaz ve stream bağlı kabul edilir.
- `ProxyJump a,b,c` → zincir halinde N `Client`; her biri bir öncekinin `forwardOut` kanalını `sock` alır. Her atlamanın kendi `hostVerifier`'ı ve kendi kimlik doğrulaması olmalı (OpenSSH de böyle davranır). Kapatırken sondan başa `end()` çağrılmalı. README örneği de dıştakini kapatıyor (`conn1.end(); // close parent (and this) connection`).
- `ProxyCommand` desteklenmemeli (keyfi komut çalıştırma). İçe aktarmada görülürse kullanıcıya uyarı verilmeli.

## 5. Host key doğrulama ve `known_hosts`

- `ssh2` `hostVerifier(key[, callback])`: `true`/`false` döndürür veya async olarak `callback(true|false)` çağırır. `hostHash` verilmezse **ham key Buffer'ı** geçiyor (v1 kırıcı değişiklikleri, issue #935: "hostVerifier() receives a raw key Buffer when no valid hostHash is set, and it runs on every handshake"; `client.js` ile doğrulandı). Bu buffer SSH wire-format public key blob'u, yani `known_hosts` satırındaki base64 alanın decode edilmiş hâli. Doğrudan `Buffer.equals` ile karşılaştırılabilir. Tip adı da blob'un içinde (ilk string). Parmak izi `SHA256:` + `base64(sha256(blob))` (padding'siz) ile OpenSSH'takiyle aynı şekilde gösterilebilir.
- Callback hostname almıyor. Hangi host/port için doğrulama yapıldığını closure ile biz bağlamalıyız (zincirdeki her atlama için ayrı).
- **Kütüphane durumu:** npm'de `known_hosts@1.0.3` (2016) ve `known-hosts@0.1.0` (2014) var. İkisi de terk edilmiş ve hashed girdileri, `@revoked`/`@cert-authority`'yi ya da `[host]:port`'u desteklediklerine dair bir işaret yok. **Kullanılmamalı.**
- **Kendi ayrıştırıcımız** (saf modül, birim testli). `sshd(8)` "SSH_KNOWN_HOSTS FILE FORMAT":
  - Satır: `[marker] hostpatterns keytype base64key [comment]`; `#` ve boş satırlar yok sayılır.
  - Marker: `@cert-authority` (bu kapsamda yok sayılabilir), `@revoked` (eşleşirse kesin red).
  - Hostpatterns: virgüllü liste, `*`/`?` joker, `!` olumsuzlama. Standart dışı port `[host]:port`.
  - Hashed: `|1|base64(salt)|base64(HMAC-SHA1(salt, hostname))`. Satır başına tek hashed isim, joker yok. Doğrulama: her `|1|` girdisi için `HMAC-SHA1(salt, "host"` veya `"[host]:port")` hesaplanır ve karşılaştırılır. Node `crypto.createHmac('sha1', salt)` yeterli.
- **Yazma politikası (öneri):** `~/.ssh/known_hosts`'a **yazmayın**. Okuyun (OpenSSH ile zaten güvenilmiş host'ları sessizce kabul etmek için), yeni/onaylanan anahtarları Tezgah'ın kendi deposuna (ör. uygulama config dizininde `known_hosts` biçiminde, istenirse hashed) yazın. Kullanıcının OpenSSH dosyasını bozma ya da biçimini değiştirme riski böylece ortadan kalkar. Akış: bilinmeyen anahtar → UI'da parmak iziyle TOFU onayı; *değişmiş* anahtar → kırmızı uyarı ve varsayılan red (prod etiketli bağlantıda hiç geçilemesin).

## 6. Bakım durumu, native bağımlılıklar, `npx` etkisi

- **Bakım:** `ssh2` sürümleri `1.15.0` (2023-12), `1.16.0` (2024-09), `1.17.0` (2025-08-20). Master'da 2026-05 ve 2026-08'de commit'ler var (Node <16 desteğinin bırakılması, nan güncellemesi, Pageant'ın kaldırılması). Tek bakımcı (mscdex) olmasına rağmen aktif. Yayımlanmamış kırıcı değişiklikler var (Node ≥16, Pageant yok). Sürümü `~1.17.0` gibi sabitleyip yükseltmeyi bilinçli yapmak gerekiyor.
- **Bağımlılıklar** (`registry.npmjs.org/ssh2/latest`): `asn1`, `bcrypt-pbkdf`. Optional: `nan`, `cpu-features@~0.0.10`. `engines: node >=10.16.0` (master'da ≥16).
- **Kurulum script'leri:**
  - `ssh2` `install: node install.js` → `lib/protocol/crypto` içinde `node-gyp rebuild` dener. Başarısız olursa `Failed to build optional crypto binding` yazar ama `process.exit(0)` ile çıkar (yalnızca `CI_CHECK_FAIL=ssh2` iken 1).
  - `cpu-features` `install: node buildcheck.js > buildcheck.gypi && node-gyp rebuild` (optional bağımlılık, başarısızlığı npm yok sayar). Son yayın 2024-05.
- **Binding yoksa ne olur:** `lib/protocol/crypto.js` binding'i `try/require` ile yüklüyor (`bindingAvailable: !!binding`). Yoksa AES-GCM/CTR Node `crypto` ile, `chacha20-poly1305@openssh.com` ise JS + WASM poly1305 (`crypto/poly1305.js`) ile çalışıyor. `cpu-features` yalnızca varsayılan cipher sırasını ayarlamak için kullanılıyor (`constants.js`). İşlevsel bir kayıp yok, yalnızca biraz performans farkı var. Tünelde Postgres trafiği için önemsiz.
- **`npx` etkisi:** Build araçları (Python + C++ toolchain; Windows'ta VS Build Tools, macOS'ta Xcode CLT) yoksa ilk `npx` kurulumunda node-gyp denemeleri birkaç saniye ile onlarca saniye sürebilir ve konsola uzun hata çıktısı basabilir. Kurulum yine de başarılı olur. Prebuilt binary yok. Seçenekler:
  1. Olduğu gibi kabul etmek (en basiti). README'de "derleme uyarıları normaldir" notu.
  2. Paketi yayımlarken `ssh2`'yi bundle edip install script'ini çalıştırmamak (`bundleDependencies`; npm bundle edilmiş bağımlılıkların install script'lerini yine de çalıştırabilir, denenmeli). Alternatif olarak yayın öncesi bir bundler (esbuild) ile `ssh2`'yi tek dosyaya gömmek: `require('./crypto/build/Release/sshcrypto.node')` ve `require('cpu-features')` zaten `try` içinde, bunları external/boş bırakmak yeterli. Bu, `npx` deneyimini en temiz yapan yol. Bir prototiple doğrulanmalı.
- **Alternatif değerlendirme, sistem `ssh` ikilisini çağırmak:** `ssh -W host:port bastion` alt sürecinin stdin/stdout'u bir Duplex'e sarılıp `pg`'ye `stream` olarak verilebilir. `~/.ssh/config`, `ProxyJump`, agent, Pageant, FIDO anahtarları ve `known_hosts` "bedavaya" gelir. Windows 10+ ve macOS'ta OpenSSH istemcisi yerleşik. Dezavantajları: şifre/passphrase girişi için `SSH_ASKPASS` düzeneği gerekir, her `pg` bağlantısı ayrı bir `ssh` süreci demektir (ya da `ControlMaster` gerekir ama Windows OpenSSH'ta ControlMaster yok), hata mesajları stderr ayrıştırmaya kalır, ortam etiketi ve onay akışları üzerinde kontrol azalır. MVP için `ssh2` daha uygun. Bu yol, FIDO anahtarı gibi `ssh2`'nin desteklemediği durumlar için ileride bir "gelişmiş: sistem ssh kullan" seçeneği olarak tutulabilir.

## 7. Öneri ve uyarılar

**Öneri:**
1. `ssh2@~1.17.0` kullanılsın. Bağlantı başına tek `Client` (tünel), `keepaliveInterval` (ör. 15000) açık olsun (varsayılan **kapalı**: `client.js` `keepaliveInterval` varsayılanı 0, `keepaliveCountMax` 3), `readyTimeout` varsayılanı 20000 ms.
2. `pg`'ye `stream: () => new SshForwardSocket(tunnel)` factory'si verilsin. Yerel port açılmasın.
3. Kimlik doğrulama sırası kendi `authHandler`'ımızla belirlensin: agent (macOS `SSH_AUTH_SOCK`; Windows `\\.\pipe\openssh-ssh-agent` veya kullanıcının verdiği Pageant pipe'ı) → key dosyası (+ passphrase anahtar zincirinde) → password/keyboard-interactive (şifre anahtar zincirinde).
4. `known_hosts` okuma/eşleme (hashed dahil) ve parmak izi hesaplama saf bir modül olarak yazılsın. Onaylanan anahtarlar Tezgah'ın kendi deposuna kaydedilsin.
5. ProxyJump, `sock` ile N atlamalı zincir olarak kurulsun ve her atlama ayrı doğrulansın.
6. `~/.ssh/config`, `ssh-config` + `matchExec: false` ile yalnızca içe aktarma kaynağı olarak kullanılsın (MVP sonrası).

**Uyarılar:**
- `'pageant'` dize değeri master'da kaldırıldı. Kullanılmamalı, Pageant'a named pipe yoluyla bağlanılmalı.
- FIDO/`sk-*` anahtarlar `ssh2`'de çalışmaz.
- `ssh2` `SSH_AUTH_SOCK`'u kendisi okumaz. Windows'ta `ssh-agent` servisi varsayılan olarak kapalıdır.
- `ssh2`'nin yayımlanmamış master'ı kırıcı (Node ≥16, Pageant yok). Sürüm sabitlenmeli.
- Native derleme denemeleri `npx` ilk açılışını yavaşlatıp gürültü üretebilir. Bundling ile önlenip önlenemeyeceği bir prototiple doğrulanmalı.
- `SshForwardSocket` sarmalayıcısı `pg`'nin iç sözleşmesine (`setNoDelay`, `connect`, `'connect'` olayı) dayanıyor. Bu sözleşme belgelenmemiş (node-postgres.com Client sayfasında `stream` yok). `pg` sürümü yükseltildiğinde bir entegrasyon testiyle korunmalı.

## Kaynaklar

- ssh2 README: https://github.com/mscdex/ssh2 (raw: https://raw.githubusercontent.com/mscdex/ssh2/master/README.md)
- ssh2 kaynak: `lib/client.js`, `lib/agent.js`, `lib/protocol/keyParser.js`, `lib/protocol/crypto.js`, `lib/protocol/constants.js`, `install.js` (master, 2026-08)
- ssh2 commit "lib,util: remove pageant support" (2026-05-27); issue #1498 (Pageant helper OOB), #935 (v1 kırıcı değişiklikler), #748/#892 (Windows named pipe agent)
- npm registry: https://registry.npmjs.org/ssh2/latest, `npm view ssh2 time`, `npm view cpu-features`, `npm view tunnel-ssh`, `npm view ssh-config`
- node-postgres: `packages/pg/lib/connection.js`, `client.js`, `stream.js` (https://github.com/brianc/node-postgres), `pg@8.23.1`
- ssh-config: https://github.com/cyjake/ssh-config README; issue #107 (Match exec), #121 (Include tokenize)
- OpenSSH sshd(8) SSH_KNOWN_HOSTS FILE FORMAT: https://man.openbsd.org/sshd.8
- PuTTY kılavuzu 9.3.3 (Pageant + Windows OpenSSH named pipe, `--openssh-config`): https://the.earth.li/~sgtatham/putty/latest/htmldoc/Chapter9.html
- Microsoft Learn, OpenSSH key management (ssh-agent servisi varsayılan kapalı): https://learn.microsoft.com/en-us/windows-server/administration/openssh/openssh_keymanagement
