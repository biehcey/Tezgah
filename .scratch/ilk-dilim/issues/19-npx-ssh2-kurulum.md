# npx kurulumunda ssh2 native derleme davranışı

Type: task
Status: resolved
Blocked by: —

## Question

[SSH araştırmasına](12-ssh-kutuphanesi.md) göre `ssh2` ve `cpu-features` kurulumda `node-gyp` derlemesi deniyor; başarısızsa JS/WASM yedeğe düşüp kurulum yine başarılı oluyor. Bu, `npx tezgah` ilk kurulum deneyimini nasıl etkiliyor ve önlenmeli mi?

Yapılacak (AFK): `ssh2@~1.17.0`'a bağımlı minimal bir paket `npm pack` ile paketlenip Windows'ta (derleme araç zinciri olmadan) ve mümkünse macOS'ta `npx <tarball>` ile kurulur. Kaydedilecekler: kurulum süresi, konsola basılan derleme hataları, çalışma zamanında hangi yedeğin kullanıldığı. Sonra şu seçenekler karşılaştırılır: (a) olduğu gibi bırakmak; (b) `ssh2`'yi `dist/server`'a bundle'layıp bağımlılık listesinden çıkarmak (tsup); (c) `overrides` / `optionalDependencies` ile `cpu-features`'ı devre dışı bırakmak. Sonuç, [paket yapısı](01-paket-yapisi.md) kararına bir ek olarak kaydedilir.

## Answer

Yapılanlar (2026-11-03, Windows 11, Node 24.14 / npm 11.9; macOS denenmedi): `ssh2@~1.17.0`'a bağımlı minimal `ssh2probe` paketi `npm pack` ile paketlendi, `npx -p <tgz> ssh2probe` ile kuruldu; çalışma zamanında `cpu-features` ve `sshcrypto.node` yüklenebiliyor mu ölçüldü. Araç zinciri yokluğu `npm_config_msvs_version=2015` ile simüle edildi (node-gyp: "Could not find any Visual Studio installation"). Test dosyaları atılabilir scratchpad'deydi, repoya girmedi.

| Senaryo | Süre (ilk kurulum) | Konsol (normal `npx`) | Çalışma zamanı |
|---|---|---|---|
| VS Build Tools + Python var, varsayılan npx önbelleği | ~24 sn (iki C++ derlemesi) | sessiz | `sshcrypto.node` + `cpu-features` yüklü |
| Araç zinciri yok | ~6 sn | sessiz | binding yok, `cpu-features` npm tarafından silinmiş; `ssh2` sorunsuz yükleniyor |
| Araç zinciri var ama npx yolu uzun (`%TEMP%` altında) | ~13 sn | sessiz | MSBuild `PathTooLongException` (260 karakter MAX_PATH) → binding yok |

Bulgular:

- **Kurulum her durumda başarılı ve sessiz.** `ssh2`'nin `install.js`'i node-gyp hatasını yutup 0 ile çıkıyor; `cpu-features` `optionalDependencies` olduğu için başarısız derlemede npm onu sessizce kaldırıyor. Derleme çıktısı yalnızca `--foreground-scripts` ile görünüyor. Yani "derleme hatası basar" endişesi gerçekleşmedi.
- **Binding yalnızca performans.** `bindingAvailable=false` iken tüm varsayılan cipher'lar (`aes*-gcm`, `aes*-ctr`, `chacha20-poly1305`) Node `crypto` ile çalışan `*Native` sınıflara düşüyor; `cpu-features` yalnızca cipher sırasını etkiliyor. Bir veritabanı tüneli için bu fark önemsiz.
- **Asıl maliyet:** araç zinciri olan makinede her ilk `npx` ~20 sn C++ derlemesi; derleme kullanıcı profil yolunun uzunluğuna bağlı olarak MAX_PATH'e takılabiliyor (yani davranış makineye göre değişiyor). macOS'ta Xcode CLT yoksa `/usr/bin/cc` taklidinin "komut satırı geliştirici araçlarını yükle" diyaloğu açması bilinen bir sorun (bu oturumda doğrulanmadı).

Seçenekler:

- **(a) Olduğu gibi bırakmak:** çalışır ama ilk kurulum makineye göre 6–25 sn arası değişir, gereksiz native derleme ve olası macOS diyaloğu kalır.
- **(b) `ssh2`'yi `dist/server`'a bundle'lamak:** denendi. esbuild `--platform=node --external:*.node --external:cpu-features` ile 709 KB (minify'sız) tek dosya üretiyor; `node_modules` olmadan izole çalışıyor, `Client` mevcut ve `bindingAvailable=false`. Kurulumda hiç install script'i çalışmıyor. tsup karşılığı: `ssh2` → `devDependencies`, `noExternal: ['ssh2']`, `external: [/\.node$/, 'cpu-features']`.
- **(c) `overrides` / `optionalDependencies`:** işe yaramaz. npm `overrides` yalnızca kök projenin `package.json`'unda geçerli; `npx tezgah` ile kurulan paketin `overrides`'ı yok sayılır. Ayrıca `ssh2`'nin kendi `install` script'i (`sshcrypto` derlemesi) yine çalışır.

**Karar: (b).** `ssh2` tsup ile `dist/server`'a gömülür, native modüller external bırakılır ve her zaman JS yoluna düşülür. Lisans: `ssh2` (MIT) ve gömülen alt bağımlılıklar (`asn1`, `bcrypt-pbkdf`, `tweetnacl`, `safer-buffer`) için lisans metinleri dağıtıma eklenir. Gömme, sabitlenmiş sürümle (`~1.17.0`) aynı risk profilinde; sürüm yükseltme devDependency güncellemesi + yeniden build demek. [Paket yapısı](01-paket-yapisi.md) kararına ek olarak kaydedildi.
