# 17: SSH tüneli ve host anahtarı

Spec: [İlk dilim spec'i](../../ilk-dilim/spec.md) · Kararlar: SSH kütüphanesi (wayfinder 12), SSH tüneli yaşam döngüsü (17), npx ssh2 kurulumu (19), Bağlantı formu (24)

**What to build:** Geliştirici formun SSH bölümünde tüneli açar ve host, port, kullanıcı ve kimlik doğrulamayı (şifre / anahtar dosyası / agent) girer. Bağlantı, yerel port açılmadan SSH sunucusu üzerinden kurulur. Bilinmeyen bir host anahtarında SHA256 parmak izi gösterilir ve "Güven ve tekrar dene" ile onaylanır. Uyuşmazlıkta sert ret verilir ve yalnızca "Kayıtlı host anahtarını unut" sunulur. Tünel koparsa o bağlantının pool'ları atılır.

**Blocked by:** 04, 06

**Status:** ready-for-agent

- [x] `ssh2@~1.17.0` devDependency ve tsup ile gömülü; kurulumda install script'i çalışmıyor. Lisans metinleri dağıtımda.
- [x] Model: `ssh: { host, port=22, user, auth: password|key|agent, keyPath?, agentPath? }`. SSH sırrı keychain'de `<connectionId>:ssh` altında; "Keychain'e kaydet" seçeneği ve oturumluk istem burada da var.
- [x] Tünel arayüzü `pg` `stream` factory'sini sağlıyor. ssh2 `forwardOut` kanalı `setNoDelay`/`connect`/`'connect'` sözleşmesine uyan bir Duplex sarmalayıcıyla veriliyor. Tünel tembel açılıyor, son pool kapanınca kapanıyor. `keepaliveInterval` 15 sn, `keepaliveCountMax` 3. Kopmada bağlantının tüm pool'ları atılıyor, otomatik yeniden bağlanma yok. TLS doğrulaması `checkServerIdentity(realHost)` ile. Kurucu (`core/baglanti-ssl`, ticket 05) bunu her zaman üretir; `realHost` olarak kullanıcının girdiği host verilmeli. Not: `pg` `host` IP değilse SNI'yi `host` ile ezer; tünelde `host` olarak `localhost` değil bir IP (`127.0.0.1`) verin ki SNI'ye göre yönlendiren sunucular (bulut proxy'leri, pooler'lar) bozulmasın.
- [x] Agent varsayılanları: macOS'ta `SSH_AUTH_SOCK`, Windows'ta `\\.\pipe\openssh-ssh-agent`; Pageant için pipe yolu elle giriliyor. Windows'ta `ssh-agent` servisi kapalıysa mesaj bunu söylüyor.
- [x] core known_hosts modülü OpenSSH biçimini (hashed `|1|` dahil) ayrıştırıyor, `eşleşti | bilinmiyor | uyuşmazlık` sonucunu veriyor, girdi ekliyor ve siliyor, SHA256 parmak izini hesaplıyor. Birim testli.
- [x] Doğrulama önce kullanıcının `~/.ssh/known_hosts`'u (salt okunur), sonra Tezgah'ın kendi `known_hosts`'u ile yapılıyor. Bilinmeyen anahtar yapısal `hostKeyUnknown` hatası veriyor; onay REST'i Tezgah deposuna yazıp yeniden deniyor. Uyuşmazlık `hostKeyMismatch` veriyor ve devam yok. "Kayıtlı host anahtarını unut" SSH bölümünde.
- [x] Bağlantıyı test et'in SSH adımı el sıkışmayı, host anahtarını ve SSH kimlik doğrulamasını sınıyor; host anahtarı kutusu bu adımın altında ve listeden bağlanırken de kullanılıyor.
- [x] Tünel kopunca çalışan ya da karar bekleyen script'te "Tünel koptu; transaction sunucuda geri alındı" mesajı gösteriliyor; `COMMIT` sırasında kopmada "Commit sonucu bilinmiyor". Autocommit'te kalan ifadeler çalıştırılmıyor.
- [x] Server testleri sahte tünelle pool atma ve host anahtarı akışlarını sınıyor. Duplex sözleşmesi opsiyonel bir ortam değişkeniyle gerçek bir sshd'ye karşı sınanıyor.

## Comments

Uygulama notları (2026-11-06):

- **core**
  - `known-hosts.ts`: OpenSSH `known_hosts` ayrıştırma. Hashed `|1|`, `[host]:port`, `!` olumsuzlama ve `*`/`?` globları desteklenir. `@revoked` uyuşmazlık sayılır, `@cert-authority` atlanır. Aynı türde farklı anahtar uyuşmazlıktır; yalnızca başka türlerde kayıt varsa sonuç `bilinmiyor` ve `digerTurler`. Hash fonksiyonları dışarıdan verilir (`KnownHostsCrypto`), böylece core `node:` almaz.
  - `ssh-tuneli.ts`: agent yolu çözümleme, ssh2 hatalarının sınıflanması (Windows'ta "ssh-agent servisi" mesajı), `hostKeyUnknown`/`hostKeyMismatch` hataları.
  - `baglanti.ts`: `ssh` modeli. Ayar sürümü 3; göçte `ssh: null` eklenir.
- **server**
  - `tunel.ts`: Duplex sarmalayıcı (`TunnelSocket`). Tünel kopunca soketler `tunelKoptu` koduyla yok edilir.
  - `havuzlar.ts`: tünel tembel açılır ve bağlantının pool'ları arasında paylaşılır. Kopmada bütün pool'lar atılır; son pool kapanınca tünel kapanır.
  - `host-anahtarlari.ts`: kullanıcının dosyası salt okunur, Tezgah'ın dosyası `<configDir>/known_hosts` (0600). REST uçları `POST /api/host-anahtarlari` ve `POST /api/host-anahtarlari/unut`. Onay ucu yalnızca yazar; yeniden deneme istemcide yapılır (form testi baştan koşar, listeden bağlanmada istek tekrarlanır).
  - `ssh2-baglayici.ts`: keepalive 15 sn ve 3 deneme, `readyTimeout` 20 sn. keyboard-interactive'de şifre yalnızca tek ve gizli bir isteme verilir; birden çok istem (ör. OTP) yanıtsız kalır.
  - Gömme: ssh2 ve bağımlılıkları tsup ile gömülür, `cpu-features`/`.node` dışarıda kalır. `dist/server/THIRD_PARTY_LICENSES.txt` üretilir.
- **web**
  - Katlanır "SSH tüneli" bölümü ve `HostAnahtariKutusu`. Kutu formda SSH adımının altında, listeden bağlanırken pencere olarak açılır.
  - Uyuşmazlık kaydı kullanıcının `~/.ssh/known_hosts` dosyasındaysa "unut" düğmesi yoktur; Tezgah o dosyayı değiştirmediği için `ssh-keygen -R` önerilir.
  - Keychain kapalıyken formdaki sır yalnızca teste gider. Listeden bağlanırken `SifrePenceresi` SSH şifresini ya da passphrase'i sorar.
- **Testler**
  - core birim testleri ve sahte tünelle server testleri yazıldı.
  - ssh2 bağlayıcısı süreç içi bir ssh2 `Server`'a karşı sınanır.
  - Gerçek sshd sözleşme testi (`TEZGAH_TEST_SSH_URL` + `TEZGAH_TEST_SSH_PG_URL`) bu makinede ortam değişkeni olmadığı için **çalıştırılmadı**.
