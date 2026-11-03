# Keychain kütüphanesi seçimi

Type: research
Status: resolved
Blocked by: —

## Question

macOS Keychain ve Windows Credential Manager'a erişim için hangi Node kütüphanesi kullanılmalı? `keytar` bakımda değil. Adaylar: `@napi-rs/keyring`, `keytar` çatalları, `cross-keychain` ve varsa diğerleri.

Karar için gereken olgular:
- `npx` ile kurulumda prebuilt binary var mı (macOS arm64/x64, Windows x64/arm64), derleme araç zinciri gerekir mi?
- Bakım durumu, son sürüm, indirme sayısı, lisans.
- macOS'ta erişim izni diyaloğu nasıl davranır (her okumada mı; "Always Allow" sonrası Node güncellenince ne olur)?
- Windows Credential Manager'daki boyut sınırı (~2.5 KB) ve hedef adı/kullanıcı adı eşlemesi.
- API: set/get/delete, servis+hesap modeli; `tezgah/<connectionId>` anahtarına nasıl eşlenir.

## Answer

Bulgular: `research/keychain-kutuphanesi` dalı, `research/keychain-kutuphanesi.md` (origin'e push'landı, merge edilmez).

- **Karar: `@napi-rs/keyring` (^2.1.2).** MIT, aktif bakım (son sürüm 2026-10-19, ~7,3 M haftalık indirme), Rust `keyring-rs` üstünde. macOS arm64/x64 ve Windows x64/arm64 prebuilt binary'leri `optionalDependencies` ile gelir: `npx` kurulumu toolchain'siz ve ek indirmesiz.
- Reddedilenler: `keytar` (arşiv, 2022; kurulumda GitHub'dan indirme / node-gyp'e düşme), keytar çatalları (ölü), `cross-keychain` (düz `file` backend'ine fallback → "diske düz metin şifre yok" kuralıyla çelişir).
- Eşleme: `new AsyncEntry("tezgah", connectionId)` → `setPassword` / `getPassword` / `deletePassword`. macOS: service=`tezgah`, account=`connectionId`. Windows: TargetName kütüphane varsayılanı `<connectionId>.tezgah` kabul edilir (`withTarget` kullanılmaz). [Ayar saklama](03-ayar-saklama.md)'daki `tezgah/<connectionId>` = "service `tezgah`, account `connectionId`" olarak okunur. Bu ilk sürümden sonra değiştirilmez.
- Windows sınırı 2560 bayt blob (UTF-16 → ~1280 karakter): keychain'de yalnızca şifre/passphrase, asla SSH özel anahtarı. Varsayılan `CRED_PERSIST_ENTERPRISE` roaming profilde credential'ı başka makinelere taşıyabilir; JS'ten değiştirilemiyor. Kabul edilen risk, README'de belirtilir.
- macOS: ACL çağıran `node` binary'sine bağlı. Developer ID imzalı Node'da "Always Allow"ın güncellemeden sonra korunması bekleniyor (çıkarım, Apple belgesi yok); ad-hoc imzalı Node'da güncellemeden sonra öğe başına bir kez istem. "Deny"/istem iptali, şifre-yok hatasından ayrı ele alınıp kullanıcıya gösterilmeli.
- Risk: `keyring-node` pratikte tek bakımcı; keychain zaten arayüz arkasında ([test stratejisi](10-test-stratejisi.md)), değiştirmek ucuz.
