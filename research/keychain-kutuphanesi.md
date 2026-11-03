# Araştırma: Keychain kütüphanesi seçimi

Tarih: 2026-11-03 · Bilet: "Keychain kütüphanesi seçimi"

**Soru:** Tezgah, bağlantı şifrelerini macOS Keychain ve Windows Credential Manager'da `tezgah/<connectionId>` anahtarıyla saklayacak. Bunun için hangi Node kütüphanesi kullanılmalı? Seçilen kütüphanenin `npx` ile build toolchain olmadan kurulabilmesi gerekiyor.

## Kısa cevap

**`@napi-rs/keyring`** (MIT). Rust `keyring-rs` ekosisteminin N-API bağlaması. macOS arm64/x64 ve Windows x64/arm64 için önceden derlenmiş binary'ler npm'de `optionalDependencies` olarak geliyor. Aktif olarak bakımı yapılıyor ve indirme sayısı en yüksek aday bu. Bulgu ve kaynaklar aşağıda.

## Adaylar: karşılaştırma

Veriler npm registry'den (`registry.npmjs.org/<paket>`, `api.npmjs.org/downloads/point/last-week/<paket>`) ve GitHub REST API'den (`/repos/<owner>/<repo>`) 2026-11-03'te alındı.

| Paket | Son sürüm (tarih) | Haftalık indirme | Lisans | Repo durumu | Prebuilt dağıtımı |
|---|---|---|---|---|---|
| `@napi-rs/keyring` | 2.1.2 (2026-10-19) | ~7,30 M | MIT | `Brooooooklyn/keyring-node`, arşivli değil, son push 2026-10-28 | npm `optionalDependencies` (platform paketleri) |
| `keytar` | 7.9.0 (2022-02-17) | ~3,97 M | MIT | `atom/node-keytar` **arşivlendi** (`archived: true`, son push 2022-12-12) | Kurulumda `prebuild-install` ile GitHub Releases'tan indirme; yoksa `node-gyp` |
| `cross-keychain` | 1.1.0 (2025-10-07) | ~91 B | MIT | `magarcia/cross-keychain`, arşivli değil, son push 2026-04-13, 17 yıldız | `@napi-rs/keyring`'i optional dep olarak kullanıyor; olmazsa CLI/dosya fallback |
| `keytar-forked` (shiftkey) | 7.10.0 (2025-02-04) | ~220 | MIT | `shiftkey/node-keytar`, son push 2025-02-04, 7 yıldız | keytar ile aynı (`prebuild-install`) |
| `@postman/node-keytar` | 7.9.3 (2023-03-13) | ~1 B | MIT | fork, 2023'ten beri sürüm yok | keytar ile aynı |

`@napi-rs/keyring` sürüm geçmişinde 2025–2026 boyunca düzenli yayın var: 1.1.7 (2025-05), 1.2.0 (2025-09), 1.3.0 (2026-04), 2.0.0 (2026-08-31), 2.1.0, 2.1.1 ve 2.1.2 (2026-10-19).

### Prebuilt binary'ler (`npx` için kritik)

- **`@napi-rs/keyring` 2.1.2:** `optionalDependencies` alanında `-darwin-arm64`, `-darwin-x64`, `-win32-x64-msvc`, `-win32-arm64-msvc` (ayrıca ia32, linux, freebsd) platform paketleri var. Her biri `os`/`cpu` alanlarıyla etiketli; örneğin `@napi-rs/keyring-win32-arm64-msvc` → `os: ["win32"], cpu: ["arm64"]`, `main: keyring.win32-arm64-msvc.node`. npm yalnızca eşleşen paketi indiriyor. Kurulum script'i, `node-gyp` ve ağdan ek binary indirme yok. N-API `napi3` kullanıldığı için Node ABI sürümünden bağımsız (`engines.node: ">= 10"`). Kaynak: npm registry `@napi-rs/keyring` ve platform paketlerinin `latest` manifestleri, repo `Cargo.toml`.
- **`keytar` 7.9.0:** `"install": "prebuild-install || npm run build"`. v7.9.0 GitHub release'inde `darwin-arm64`, `darwin-x64`, `win32-x64`, `win32-arm64` (napi-v3) tarball'ları var. Ancak binary kurulum anında GitHub'dan indiriliyor. Bu indirme başarısız olursa (proxy, kurumsal ağ, GitHub erişimi yok) iş `node-gyp`'e kalıyor ve toolchain gerektiriyor. Ayrıca proje arşivlendiği için güvenlik düzeltmesi gelmeyecek. Kaynak: npm registry `keytar@7.9.0` `scripts`, GitHub `atom/node-keytar` release v7.9.0 asset listesi.

## API şekli ve `tezgah/<connectionId>` eşlemesi

`@napi-rs/keyring` `index.d.ts` (2.1.2):

```ts
class Entry {            // senkron
  constructor(service: string, username: string, options?: EntryOptions)
  static withTarget(target: string, service: string, username: string, options?): Entry
  setPassword(password: string): void
  getPassword(): string | null          // yoksa null
  deletePassword(): boolean             // silindiyse true, yoksa false; hata → throw
  setSecret(secret: Uint8Array): void / getSecret(): number[] | null
}
class AsyncEntry { /* aynı yöntemler, Promise + opsiyonel AbortSignal */ }
findCredentials(service: string, target?): { account, password }[]
```

Paket ayrıca keytar uyumlu bir shim içeriyor (`@napi-rs/keyring/keytar`: `getPassword(service, account)`, `setPassword(service, account, password)`, `deletePassword(service, account)`, `findCredentials(service)`). Bu sayede keytar'dan geçiş birebir oluyor.

**Önerilen eşleme:** `service = "tezgah"`, `username/account = <connectionId>`. "tezgah/<connectionId>" yazımı kavramsal olarak bu çifti ifade ediyor.

- **macOS:** Generic password öğesi oluşuyor; `service` niteliği `tezgah`, `account` niteliği `<connectionId>` oluyor. Keychain API'sindeki bir tuhaflık nedeniyle ikisi de boş olamaz. Kaynak: docs.rs `apple_native_keyring_store::keychain`.
- **Windows:** Generic credential (`CRED_TYPE_GENERIC`) oluşuyor. `TargetName` varsayılan olarak `prefix + user + "." + service + suffix` şeklinde kuruluyor (prefix ve suffix boş). Dolayısıyla Credential Manager'da **`<connectionId>.tezgah`** olarak görünüyor. `UserName` alanına `<connectionId>` yazılıyor. Varsayılan kalıcılık `CRED_PERSIST_ENTERPRISE`. Kaynak: `open-source-cooperative/windows-native-keyring-store` `src/lib.rs` satır 18–41. Credential Manager'da `tezgah/...` biçiminde bir hedef adı istenirse `Entry.withTarget("tezgah/<id>", "tezgah", "<id>")` kullanılabilir; açık `target` verildiğinde `TargetName` olarak aynen kullanılıyor (aynı kaynak). Öneri: `connectionId`'yi `.` içermeyen bir UUID olarak tutmak ya da `withTarget` ile hedef adını açıkça sabitlemek.

## Windows Credential Manager sınırları

Microsoft Learn, `CREDENTIALW` yapısı:

- `CredentialBlobSize` en fazla **`CRED_MAX_CREDENTIAL_BLOB_SIZE` (5*512 = 2560 bayt)**.
- Generic `TargetName` en fazla `CRED_MAX_GENERIC_TARGET_NAME_LENGTH` (32767) karakter, büyük/küçük harfe duyarsız.
- `UserName` en fazla 513, `Comment`/`TargetAlias` en fazla 256 karakter.
- `CRED_PERSIST_ENTERPRISE`: kullanıcının roaming profili varsa credential başka makinelere taşınabiliyor; roaming profil yoksa yalnızca yerelde kalıyor.

`windows-native-keyring-store`, `setPassword` ile verilen şifreyi **UTF-16LE** olarak kaydediyor ve 2560 bayt sınırını kendisi kontrol ediyor (`src/utils.rs` 88–100, aşılırsa `Error::TooLong("password encoded as UTF-16", ...)`). Bu nedenle `setPassword` ile **en fazla ~1280 UTF-16 kod birimi** saklanabiliyor. `setSecret` (ham bayt) ile tam 2560 bayt kullanılabiliyor. Bir Postgres şifresi için bu sınır sorun çıkarmaz. SSH private key ya da büyük JSON saklamak ise **bu sınıra takılır**. Tezgah keychain'e yalnızca şifre veya passphrase yazmalı; SSH anahtarı dosya yoluyla referans verilmeli.

Not: keytar Windows'ta blob'u UTF-8 yazıyordu. keyring-rs ise UTF-16 bekliyor, tek uzunluklu blob'larda `BadEncoding` dönüyor (`utils.rs` 406–417). Tezgah'ın keytar'dan taşıyacağı veri olmadığından bunun pratik bir etkisi yok.

## macOS erişim istemi (prompt) davranışı

- `@napi-rs/keyring`, Security.framework'ü **süreç içinden** çağırıyor (`apple-native-keyring-store` ve `security-framework` crate'leri; repo `Cargo.toml`). Dolayısıyla öğeyi oluşturan uygulama **`node` çalıştırılabilir dosyasının kendisi** oluyor ve öğenin ACL'sinde güvenilen uygulama olarak kayıt ediliyor. Aynı `node` binary'si sonraki okumalarda normalde istem görmüyor. Her okumada prompt beklenmiyor.
- **Node güncellenince durum:** Keychain ACL'si uygulamayı kod imzası ve "designated requirement" (DR) üzerinden tanıyor. Apple TN3127'ye göre DR olmadan macOS yetkiyi uygulamanın sürümleri arasında taşıyamıyor ([TN3127](https://developer.apple.com/documentation/technotes/tn3127-inside-code-signing-requirements)). Buradan iki durum çıkıyor:
  - **nodejs.org resmi macOS build'leri** Developer ID ile, hardened runtime açık şekilde imzalanıyor (`nodejs/node` `tools/osx-codesign.sh`: `codesign --sign "$SIGN" --options runtime --timestamp $PKGDIR/bin/node`). DR imzalayan kimliğe bağlı olduğu için yeni Node sürümünün de aynı DR'yi karşılaması ve "Always Allow"ın korunması beklenir. *Bu bir çıkarım; Apple'ın bu senaryoyu birebir anlatan resmi bir belgesi bulunamadı.*
  - **Ad-hoc imzalı veya imzasız `node`** (örneğin kaynaktan derlenmiş, bazı paket yöneticisi build'leri) için DR yalnızca cdhash'e dayanıyor ve her yeni binary'de değişiyor. Bu durumda Node güncellemesinden sonra macOS her öğe için tekrar "erişime izin ver" istemi gösteriyor. Aynı davranış başka projelerde de raporlanmış: [Apple Developer Forums 734689](https://developer.apple.com/forums/thread/734689) ("Always allow only works until I change the code"), [jaraco/keyring#619](https://github.com/jaraco/keyring/issues/619). Bunlar ikincil kaynaklar; mekanizmanın kendisi TN3127'ye dayanıyor.
- **Pratik etki:** Tezgah her açılışta değil, bir bağlantı açılırken şifreyi okuyacak. Node güncellemesinden sonra kullanıcı bağlantı başına bir kez istem görebilir. Bu kabul edilebilir bir durum ama README'de belgelenmeli. `npx` tek başına sorun yaratmıyor: ACL `npx` önbelleğindeki `.node` dosyasına değil, süreci çalıştıran `node` binary'sine bağlı.
- **CLI fallback'ten kaçınılmalı:** `/usr/bin/security` çağıran çözümlerde (örneğin `cross-keychain`'in fallback'i) ACL `security` aracına bağlanıyor ve şifre süreç argümanlarında görünebiliyor. `cross-keychain` README'si de native backend'i bu yüzden "no password exposure in process lists" diye öne çıkarıyor.

## `cross-keychain` neden seçilmedi

- İçeride zaten `@napi-rs/keyring` kullanıyor (optional dep). Native modül yüklenemezse **CLI backend'lerine ve bir `file` backend'ine** düşüyor (README: "Automatic fallback to CLI-based backends", `--list-backends` çıktısında `file (priority: 1)`). Dosya backend'i, Tezgah'ın "diske düz metin şifre yazılmaz" kuralıyla çelişiyor. Fallback'in sessizce devreye girme riski var.
- Çalışma zamanı bağımlılıkları arasında CLI paketleri var (`@inquirer/prompts`, `meow`). Bakımcı tek kişi ve kullanıcı tabanı küçük.

## Öneri

**`@napi-rs/keyring` (^2.1.2) kullanılmalı.** `service = "tezgah"`, `account = <connectionId>` olmalı; sunucuda event loop'u bloklamamak için `AsyncEntry` tercih edilmeli. Kütüphane UI'dan bağımsız küçük bir `secretStore` modülünün arkasına sarılmalı (`get/set/delete(connectionId)`). Bu sayede birim testlerde sahte bir store kullanılabilir.

### Uyarılar

1. **Windows boyut sınırı:** `setPassword` en fazla ~1280 UTF-16 karakter kabul ediyor (2560 bayt). Yalnızca şifre veya passphrase saklanmalı. `TooLong` hatası kullanıcıya anlaşılır bir mesajla gösterilmeli.
2. **Windows hedef adı:** Varsayılan `TargetName` `<connectionId>.tezgah` oluyor. `tezgah/<id>` görünümü isteniyorsa `withTarget` kullanılmalı ve bu karar baştan sabitlenmeli. Sonradan değiştirmek, mevcut kayıtların taşınmasını gerektirir.
3. **Roaming:** Varsayılan `CRED_PERSIST_ENTERPRISE` roaming profillerde credential'ı başka makinelere taşıyabilir. Sadece yerel kalması isteniyorsa `persistence` modifier'ının `@napi-rs/keyring` API'sinde açığa çıkıp çıkmadığına bakılmalı. 2.1.2 `EntryOptions` yalnızca `linux` alanı içeriyor, yani bu ayar şu an JS'ten verilemiyor.
4. **macOS istemleri:** Ad-hoc imzalı Node kullanıcılarında her Node güncellemesinden sonra öğe başına bir kez istem çıkacak. Bu durum belgelenmeli. Kullanıcı "Deny" derse okuma hata fırlatıyor; Tezgah bu durumda şifreyi tekrar sormalı, çökmemeli.
5. **Bus factor:** `keyring-node` pratikte tek bakımcıya (Brooooooklyn / napi-rs yazarı) bağlı, 107 yıldız. Buna karşılık altta yatan `keyring-rs` organizasyon altında (`open-source-cooperative`, 779 yıldız, aktif) ve haftalık ~7,3 M indirme, paketin geniş çapta kullanıldığını gösteriyor. 2.x major sürümü yakın tarihli (2026-08). Sürüm `^2` ile sabitlenmeli.
6. **Linux** kapsam dışı ama paket orada da çalışıyor. Secret Service yoksa sessizce bellek içi `keyutils`'e düşüyor ve şifreler reboot'ta kayboluyor. Linux bir gün desteklenirse `{ linux: { store: 'secret-service' } }` zorlanmalı.

## Kaynaklar

- npm registry: `https://registry.npmjs.org/@napi-rs/keyring`, `.../keytar`, `.../cross-keychain`, `.../keytar-forked`, `.../@postman/node-keytar` ve platform paketleri (`@napi-rs/keyring-{darwin-arm64,darwin-x64,win32-x64-msvc,win32-arm64-msvc}/latest`)
- npm downloads API: `https://api.npmjs.org/downloads/point/last-week/<paket>` (2026-10-27 – 2026-11-02)
- `@napi-rs/keyring@2.1.2` tarball: `index.d.ts`, `keytar.d.ts`, `README.md`, `package.json`
- GitHub: `Brooooooklyn/keyring-node` (`Cargo.toml`), `atom/node-keytar` (arşiv durumu, v7.9.0 release asset'leri), `open-source-cooperative/windows-native-keyring-store` (`src/lib.rs`, `src/utils.rs`), `magarcia/cross-keychain` (`README.md`), `nodejs/node` (`tools/osx-codesign.sh`)
- docs.rs: `windows_native_keyring_store`, `apple_native_keyring_store::keychain`
- crates.io: `keyring-core` 1.0.1, `windows-native-keyring-store` 1.1.0, `apple-native-keyring-store` 1.0.2
- Microsoft Learn: [CREDENTIALW structure (wincred.h)](https://learn.microsoft.com/en-us/windows/win32/api/wincred/ns-wincred-credentialw)
- Apple: [TN3127 Inside Code Signing: Requirements](https://developer.apple.com/documentation/technotes/tn3127-inside-code-signing-requirements); ikincil: [Apple Developer Forums 734689](https://developer.apple.com/forums/thread/734689), [jaraco/keyring#619](https://github.com/jaraco/keyring/issues/619)
