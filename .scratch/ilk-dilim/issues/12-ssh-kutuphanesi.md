# SSH: kütüphane, kimlik doğrulama ve agent desteği

Type: research
Status: resolved
Blocked by: —

## Question

SSH tüneli için Node tarafında ne kullanılmalı (`ssh2` varsayılan aday) ve hangi kimlik doğrulama yolları macOS ile Windows'ta gerçekten çalışır?

Karar için gereken olgular:
- `ssh2` `forwardOut` stream'i `pg`'ye doğrudan verilebiliyor mu (`stream` seçeneği), yoksa yerel port mu açmak gerekir?
- Kimlik doğrulama: şifre, özel anahtar (+ passphrase; OpenSSH yeni formatı, ed25519), agent. Windows'ta OpenSSH agent named pipe'ı ve Pageant; macOS'ta `SSH_AUTH_SOCK`.
- `~/.ssh/config` okuma (Host alias, IdentityFile, ProxyJump) için hazır kütüphane var mı, gerekli mi?
- Bastion/ProxyJump zinciri `ssh2` ile nasıl kurulur?
- Host key doğrulama: `known_hosts` okuma/yazma desteği.
- Bakım durumu, native bağımlılıklar (opsiyonel `cpu-features` vb.) ve npx kurulumuna etkisi.

## Answer

Bulgular (Duplex sarmalayıcı taslağı dahil): `research/ssh-kutuphanesi` dalı, `research/ssh-kutuphanesi.md` (origin'e push'landı, merge edilmez).

- **Karar: `ssh2@~1.17.0`, sürüm sabitlenir.** `tunnel-ssh` reddedildi (yerel port açan ince katman).
- **Yerel port yok:** `pg`'nin `stream` seçeneği factory olarak her `Client` için çağrılır; `forwardOut` kanalı ince bir `Duplex` sarmalayıcıyla verilir (`pg` eşzamanlı `setNoDelay()` + `connect(port, host)` çağırıp `'connect'` bekliyor). Bu sözleşme belgesiz → entegrasyon testiyle korunur.
- **Auth:** password, keyboard-interactive, özel anahtar (OpenSSH yeni format + bcrypt passphrase, ed25519, ecdsa, PPK; RSA `rsa-sha2-256/512`). FIDO `sk-*` desteklenmez.
- **Agent:** macOS `agent: process.env.SSH_AUTH_SOCK` açıkça verilir. Windows `\\.\pipe\openssh-ssh-agent` çalışır ama `ssh-agent` servisi varsayılan kapalı → hata mesajı bunu söylemeli. **Pageant `'pageant'` dizesi 2026-05-27'de güvenlik raporu (#1498) sonrası kaldırıldı** (README hâlâ anıyor); Pageant'a named pipe ile `OpenSSHAgent` olarak bağlanılır.
- **Host key:** bakımı süren known_hosts kütüphanesi yok → `src/core`'da saf modül (hashed `|1|` girdiler dahil). `hostVerifier` ham key blob'u verir. Onaylanan anahtarlar Tezgah'ın kendi deposuna yazılır, `~/.ssh/known_hosts`'a değil (okunması ayrı soru, bkz. [SSH tüneli yaşam döngüsü](17-ssh-tunel-yasam-dongusu.md)).
- **ProxyJump:** `forwardOut` kanalı sonraki `Client`'a `sock` olarak verilerek N atlamalı zincir.
- **`~/.ssh/config`:** `ssh-config@5.3.0` bakımda ama `compute()` varsayılan `Match exec`'i shell'de çalıştırır → `{ matchExec: false }` zorunlu. Yalnızca içe aktarma amaçlı; ilk dilim için gerekli değil.
- **Native bağımlılıklar:** `ssh2`/`cpu-features` kurulumda `node-gyp` dener, başarısızsa JS/WASM'a düşer; kurulum başarılı biter ama `npx` ilk kurulumu yavaşlayabilir ve derleme hatası basabilir → [npx kurulumunda ssh2 native derleme davranışı](19-npx-ssh2-kurulum.md).
