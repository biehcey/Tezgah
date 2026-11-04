# 02: İlk bağlantı: form, kaydetme, keychain, liste

Spec: [İlk dilim spec'i](../../ilk-dilim/spec.md) · Kararlar: Ayar saklama (wayfinder 03), Keychain kütüphanesi (11), Bağlantı formu (24), Bağlantı ağacı (25)

**What to build:** Geliştirici kısa formun Bağlantı bölümünü (ad, host, port, kullanıcı, şifre, başlangıç veritabanı, ortam etiketi ve renk) doldurup kaydeder. Bağlantı kenar çubuğundaki listede (henüz klasörsüz) görünür. Ayar OS yapılandırma dizinindeki `tezgah.json`'a atomik olarak yazılır, şifre ise anahtar zincirine. Bağlantı düzenlenebilir ve onayla silinebilir.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] Ayar deposu macOS `~/Library/Application Support/Tezgah`, Windows `%APPDATA%\Tezgah` altında sürümlü tek bir dosya kullanıyor (`version`, `folders[]`, `connections[]`). Yazma geçici dosya + rename ile; `version` migration kancası var. Yapılandırma dizini testte enjekte edilebiliyor.
- [ ] Bağlantı modelinde `id` (uuid), ad, klasör, host, port, kullanıcı, başlangıç veritabanı (varsayılan `postgres`), ortam etiketi (`local|dev|test|staging|prod` ya da yok) ve renk, sırların keychain'e kaydedilip kaydedilmeyeceği ve Veritabanı seçimi var. SSL ve SSH alanları sonraki ticket'larda eklenecek.
- [ ] Keychain arayüzünde `get/set/delete` işlemleri var; sonuç `bulundu | yok | reddedildi`. Gerçek implementasyon `@napi-rs/keyring` ile service `tezgah`, account `<connectionId>` kullanıyor; testlerde sahte implementasyon var. Diske hiçbir zaman şifre yazılmıyor.
- [ ] REST: bağlantı listele, oluştur, güncelle, sil. Sır değeri hiçbir zaman geri döndürülmüyor, yalnızca "kayıtlı mı" bilgisi dönüyor.
- [ ] Form: ortam etiketi sabit küme çipleriyle seçiliyor ve renk seçilebiliyor; prod'da kırmızı çerçeve var. Kayıtlı şifre varsa alan yerine "🔑 keychain'de kayıtlı · değiştir" görünüyor. Kaydet test istemiyor.
- [ ] Liste satırı: ortam rengi noktası, ad, altında `kullanıcı@host[:port]`; prod'da kırmızı sol şerit. Kenar çubuğu başlığında yeni bağlantı düğmesi var.
- [ ] Sil: "ayar ve keychain'deki sırlar silinir, Çalıştırma kayıtları kalır, geri alınamaz" onayı; ayar ve keychain girdisi siliniyor.
- [ ] Keychain "Deny" sonucu kullanıcıya "sır yok"tan ayrı bir mesajla gösteriliyor.
- [ ] Server testleri CRUD'ı, atomik yazmayı ve keychain sonuçlarını sahte keychain ile; web testleri formu ve listeyi sahte API ile sınıyor.
