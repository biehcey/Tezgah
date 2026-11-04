# 17: SSH tüneli ve host anahtarı

Spec: [İlk dilim spec'i](../../ilk-dilim/spec.md) · Kararlar: SSH kütüphanesi (wayfinder 12), SSH tüneli yaşam döngüsü (17), npx ssh2 kurulumu (19), Bağlantı formu (24)

**What to build:** Geliştirici formun SSH bölümünde tüneli açar ve host, port, kullanıcı ve kimlik doğrulamayı (şifre / anahtar dosyası / agent) girer. Bağlantı, yerel port açılmadan SSH sunucusu üzerinden kurulur. Bilinmeyen bir host anahtarında SHA256 parmak izi gösterilir ve "Güven ve tekrar dene" ile onaylanır. Uyuşmazlıkta sert ret verilir ve yalnızca "Kayıtlı host anahtarını unut" sunulur. Tünel koparsa o bağlantının pool'ları atılır.

**Blocked by:** 04, 06

**Status:** ready-for-agent

- [ ] `ssh2@~1.17.0` devDependency ve tsup ile gömülü; kurulumda install script'i çalışmıyor. Lisans metinleri dağıtımda.
- [ ] Model: `ssh: { host, port=22, user, auth: password|key|agent, keyPath?, agentPath? }`. SSH sırrı keychain'de `<connectionId>:ssh` altında; "Keychain'e kaydet" seçeneği ve oturumluk istem burada da var.
- [ ] Tünel arayüzü `pg` `stream` factory'sini sağlıyor. ssh2 `forwardOut` kanalı `setNoDelay`/`connect`/`'connect'` sözleşmesine uyan bir Duplex sarmalayıcıyla veriliyor. Tünel tembel açılıyor, son pool kapanınca kapanıyor. `keepaliveInterval` 15 sn, `keepaliveCountMax` 3. Kopmada bağlantının tüm pool'ları atılıyor, otomatik yeniden bağlanma yok. TLS doğrulaması `checkServerIdentity(realHost)` ile. Kurucu (`core/baglanti-ssl`, ticket 05) bunu her zaman üretir; `realHost` olarak kullanıcının girdiği host verilmeli. Not: `pg` `host` IP değilse SNI'yi `host` ile ezer; tünelde `host` olarak `localhost` değil bir IP (`127.0.0.1`) verin ki SNI'ye göre yönlendiren sunucular (bulut proxy'leri, pooler'lar) bozulmasın.
- [ ] Agent varsayılanları: macOS'ta `SSH_AUTH_SOCK`, Windows'ta `\\.\pipe\openssh-ssh-agent`; Pageant için pipe yolu elle giriliyor. Windows'ta `ssh-agent` servisi kapalıysa mesaj bunu söylüyor.
- [ ] core known_hosts modülü OpenSSH biçimini (hashed `|1|` dahil) ayrıştırıyor, `eşleşti | bilinmiyor | uyuşmazlık` sonucunu veriyor, girdi ekliyor ve siliyor, SHA256 parmak izini hesaplıyor. Birim testli.
- [ ] Doğrulama önce kullanıcının `~/.ssh/known_hosts`'u (salt okunur), sonra Tezgah'ın kendi `known_hosts`'u ile yapılıyor. Bilinmeyen anahtar yapısal `hostKeyUnknown` hatası veriyor; onay REST'i Tezgah deposuna yazıp yeniden deniyor. Uyuşmazlık `hostKeyMismatch` veriyor ve devam yok. "Kayıtlı host anahtarını unut" SSH bölümünde.
- [ ] Bağlantıyı test et'in SSH adımı el sıkışmayı, host anahtarını ve SSH kimlik doğrulamasını sınıyor; host anahtarı kutusu bu adımın altında ve listeden bağlanırken de kullanılıyor.
- [ ] Tünel kopunca çalışan ya da karar bekleyen script'te "Tünel koptu; transaction sunucuda geri alındı" mesajı gösteriliyor; `COMMIT` sırasında kopmada "Commit sonucu bilinmiyor". Autocommit'te kalan ifadeler çalıştırılmıyor.
- [ ] Server testleri sahte tünelle pool atma ve host anahtarı akışlarını sınıyor. Duplex sözleşmesi opsiyonel bir ortam değişkeniyle gerçek bir sshd'ye karşı sınanıyor.
