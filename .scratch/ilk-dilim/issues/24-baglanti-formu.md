# Bağlantı formu ve "bağlantıyı test et" akışı

Type: prototype
Status: resolved
Blocked by: —

## Question

Bağlantı formu hangi alanları hangi grupta gösterir (genel, SSL [Bağlantı modelinde SSL/TLS](08-ssl-alanlari.md), SSH [SSH tüneli yaşam döngüsü](17-ssh-tunel-yasam-dongusu.md), ortam etiketi/renk, klasör)? "Keychain'e kaydet" kutusu, oturumluk şifre istemi ve bilinmeyen host anahtarı parmak izi onayı nasıl görünür? "Bağlantıyı test et" neyi sınar (tünel, TLS, kimlik doğrulama, `pg_database` listeleme) ve adım adım hata nasıl raporlanır?

## Answer

**Varyant C: kısa tek sütun form, test sonucu ait olduğu bölümün içinde.**

- **Yerleşim**: üstte ad + ortam rengi/rozeti; prod'da kırmızı çerçeve. *Bağlantı* bölümü her zaman açık: URL, ad, klasör, host/port, kullanıcı, şifre, başlangıç veritabanı, ortam etiketi (sabit küme çipleri + renk seçici). *SSL/TLS* ve *SSH tüneli* katlanır bölümler; kapalıyken tek satır özet (`prefer`, `deploy@bastion · key`, `kapalı`) ve durum ikonu. Altta `Bağlantıyı test et` solda, `İptal` / `Kaydet` sağda.
- **SSL bölümü**: `sslmode` seçimi + moda göre tek satırlık açıklama; CA dosyası yalnızca `require` ve üstünde; istemci sertifikası/anahtarı opsiyonel. prod seçili ve `verify-full` değilse "verify-full önerilir · Uygula" (kapalı bölüm özetinde de ⚠).
- **SSH bölümü**: aç/kapa kutusu; host/port, kullanıcı, kimlik doğrulama segmenti `şifre | anahtar dosyası | agent`; anahtarda yol + passphrase, agent'ta opsiyonel pipe/soket yolu (Pageant için). "Kayıtlı host anahtarını unut" bu bölümde.
- **Sırlar**: her sır alanının (DB şifresi, SSH şifresi/passphrase) altında "Keychain'e kaydet" (varsayılan açık); kapalıyken uyarı satırı "her açılışta ilk bağlanmada sorulur, yalnızca bellekte". Kayıtlı sır varsa alan yerine "🔑 keychain'de kayıtlı · değiştir".
- **URL'den doldurma** (kullanıcı isteği): Bağlantı bölümünün ilk satırı. `postgres://` / `postgresql://` URL yapıştırınca (ya da Host alanına yapıştırılınca) host, port, kullanıcı, şifre, veritabanı, `sslmode`, `sslrootcert`, `sslcert`, `sslkey` alanlara dağıtılır; tanınmayan parametreler "yok sayıldı" diye listelenir; çok host'lu URL, geçersiz `sslmode` ve başka şema reddedilir. URL saklanmaz; şifre şifre alanına gider, Kaydet'te keychain'e. Ters yönde "URL'yi kopyala (şifresiz)". Ayrıştırıcı ve üretici saf `src/core` modülü (birim testli); sürücüye yine connection string verilmez ([pg sürücüsünde sslmode davranışı](14-pg-sslmode.md)). İlk dilimde yalnızca URL biçimi; libpq `anahtar=değer` dizisi yok.
- **"Bağlantıyı test et"**: formdaki **kaydedilmemiş** değerlerle çalışır, hiçbir şey kaydetmez (keychain'e yazmaz, host anahtarı onayı hariç). Adımlar sırayla, ilk hatada durur, kalanlar "çalıştırılmadı":
  1. *Sırlar*: yalnızca keychain'den okunacak sır varsa; "Deny" ile "sır yok" ayrı mesaj.
  2. *SSH tüneli*: yalnızca tünel açıksa; el sıkışma + host anahtarı + SSH kimlik doğrulaması.
  3. *Sunucuya ulaşma*: TCP (tünelden ya da doğrudan).
  4. *TLS*: `sslmode`'a göre; `prefer`'de şifresiz düşüş **uyarılı başarı** (⚠, "require yap" önerisi).
  5. *Kimlik doğrulama*: başlangıç veritabanına giriş (SQLSTATE + mesaj; ör. `28P01`, `3D000`).
  6. *Veritabanlarını listeleme*: `pg_database`; başarıda sunucu sürümü + veritabanı sayısı.
- **Sonuç gösterimi**: formun tepesinde tek satır özet (başarılı / uyarıyla / hangi adımda başarısız); her adımın satırı ait olduğu bölümün altında (Sırlar, ulaşma, kimlik doğrulama, listeleme → Bağlantı; TLS → SSL; tünel → SSH). Hatalı bölüm kendiliğinden açılır, ilgili alan kırmızı. Hata satırlarında tek tık düzeltme düğmeleri (ör. "Port'u düzelt", "SSH tüneli ekle", "CA dosyası seç", "verify-ca dene", "postgres kullan", "Tekrar dene").
- **Host anahtarı**: bilinmeyen anahtarda SSH adımının altında SHA256 parmak izi kutusu, "Güven ve tekrar dene" / "Vazgeç"; onay Tezgah `known_hosts`'una yazılır ve test baştan koşar. Uyuşmazlıkta kayıtlı ve sunulan parmak izleri alt alta, devam seçeneği yok, yalnızca "Kayıtlı host anahtarını unut" ([SSH tüneli yaşam döngüsü](17-ssh-tunel-yasam-dongusu.md)). Aynı kutu formdan değil bağlantı açılırken de (ağaçtan) kullanılır.
- **Veritabanı seçimi formda değil**: test yalnızca listelenebildiğini doğrular; görünür veritabanları/şemalar ağaçta seçilir.
- **Testsiz kaydetme serbest**: Kaydet test istemez, uyarı da yok.
- **Oturumluk şifre istemi** (keychain'e kaydedilmeyen bağlantı ilk açılırken): küçük pencere; bağlantı adı/rengi, `kullanıcı@host`, şifre alanı, "Tezgah kapanana kadar bellekte tutulur, diske yazılmaz" notu ve varsayılan kapalı "Keychain'e kaydet (bağlantı ayarını değiştirir)" kutusu; `İptal` / `Bağlan`.

Prototip: atılabilir `prototype/24-baglanti-formu` dalı, `.scratch/ilk-dilim/prototypes/24-baglanti-formu-PROTOTYPE.html` (varyantlar `?variant=A|B|C`, `?senaryo=...`).

Prototip oturumunda (2026-11-03) kararlaştırıldı; varyant ve URL isteği kullanıcıdan, diğer ayrıntılar kullanıcının onayladığı önerilerden.
