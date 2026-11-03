# Bağlantı ayarlarının saklanması

Type: grilling
Status: resolved
Blocked by: —

## Question

Bağlantı ayarları (klasörler, ortam etiketi, renk, veritabanı seçimi) nerede ve hangi formatta saklanır?

## Answer

- OS yapılandırma dizininde tek `tezgah.json`: macOS `~/Library/Application Support/Tezgah`, Windows `%APPDATA%\Tezgah`.
- İçerik: `version`, `folders[]` (iç içe, `parentId`), `connections[]`.
- Bağlantı alanları: `id` (uuid), ad, klasör, host, port, kullanıcı, başlangıç veritabanı, SSL ayarı, ortam etiketi + renk, SSH ayarı, veritabanı seçimi (görünür veritabanları ve her birinde görünür şemalar).
- Şifre yok; keychain'de `tezgah/<connectionId>` anahtarında.
- Atomik yazma (tmp + rename); şema migration'ı `version` ile.

Çizim oturumunda (2026-11-03) kararlaştırıldı.

### Ek: şifreyi kaydetmeme seçeneği (2026-11-03)

[SSH tüneli yaşam döngüsü](17-ssh-tunel-yasam-dongusu.md) kararıyla: DB şifresi ve SSH sırrı için "Keychain'e kaydet" seçeneği (varsayılan açık). Kapalıysa ilk bağlanmada sorulur, Tezgah süreci boyunca yalnızca bellekte tutulur, diske yazılmaz. SSH sırrı ayrı girdide: account `<connectionId>:ssh`. Onaylanan SSH host anahtarları yapılandırma dizinindeki ayrı `known_hosts` dosyasında.
