# SSH tüneli yaşam döngüsü

Type: grilling
Status: resolved
Blocked by: 12

## Question

[SSH kütüphane araştırmasına](12-ssh-kutuphanesi.md) göre: bağlantı modelinde SSH ayarı hangi alanları taşır (host, port, kullanıcı, auth yöntemi, anahtar yolu, `~/.ssh/config` alias'ı?); tünel ne zaman açılır/kapanır (ilk hedef pool'uyla mı, son pool kapanınca mı); kopmada yeniden bağlanma ve çalışan script'e etkisi; host key ilk kez görüldüğünde onay akışı; passphrase/SSH şifresi keychain'de mi saklanır yoksa oturumluk mu sorulur?

## Answer

- **Model:** `ssh: { host, port (22), user, auth: "password" | "key" | "agent", keyPath?, agentPath? }`; alan yoksa tünel yok. Özel anahtar diskte yerinde kalır, yalnızca yolu saklanır. `agentPath` boşsa macOS'ta `SSH_AUTH_SOCK`, Windows'ta `\.\pipe\openssh-ssh-agent`; Pageant'ın değişken pipe adı için elle girilir.
- **ProxyJump ilk dilimde yok** (tek atlama); model ileride `jumps[]` alabilecek biçimde kalır.
- **Yaşam döngüsü:** tünel tembel açılır (o bağlantının ilk `pg` client'ının `stream` factory'sinde); son pool kapanınca (10 dk boşta) kapanır. Açılışta bağlantı yok.
- **Kopma:** `keepaliveInterval` 15 sn, `keepaliveCountMax` 3. Tünel kapanınca bağlantının tüm pool'ları atılır; sonraki istek tüneli yeniden açar; otomatik yeniden bağlanma veya script tekrarı yok. Çalışan/commit bekleyen script için ADR-0002 ile aynı sonuç: "Tünel koptu; transaction sunucuda geri alındı". `COMMIT` sırasında kopmada "Commit sonucu bilinmiyor". Autocommit'te kalan ifadeler çalıştırılmaz.
- **Host anahtarı:** `~/.ssh/known_hosts` salt okunur ve güvenilir; Tezgah deposu yapılandırma dizininde OpenSSH formatlı `known_hosts` (ikisi aynı saf core modülüyle ayrıştırılır). Eşleşme → sessizce devam. Bilinmeyen → bağlantı SHA256 parmak izli yapısal `hostKeyUnknown` hatasıyla biter; arayüz gösterir, onayda Tezgah deposuna yazılır ve yeniden denenir (el sıkışma açık tutulmaz). Uyuşmazlık → sert ret, "devam et" yok; çözüm bağlantı ayarlarındaki "kayıtlı host anahtarını unut" (ya da kullanıcının kendi `known_hosts`'unu düzeltmesi). prod için ek kural yok.
- **Sırlar:** SSH şifresi/passphrase ayrı keychain girdisinde: service `tezgah`, account `<connectionId>:ssh`. Formda "Keychain'e kaydet" (varsayılan açık); kapalıysa tünel ilk açıldığında sorulur ve Tezgah süreci boyunca yalnızca bellekte tutulur. Aynı seçenek DB şifresine de uygulanır (bkz. [ayar saklama](03-ayar-saklama.md) eki). Agent'ta sır yok. Keychain "Deny" ile "sır yok" ayrı gösterilir.
- Sözlüğe **Tünel** eklendi.

Grilling oturumunda (2026-11-03) kararlaştırıldı.
