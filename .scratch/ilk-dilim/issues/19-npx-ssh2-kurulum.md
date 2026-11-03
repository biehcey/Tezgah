# npx kurulumunda ssh2 native derleme davranışı

Type: task
Status: open
Blocked by: —

## Question

[SSH araştırmasına](12-ssh-kutuphanesi.md) göre `ssh2` ve `cpu-features` kurulumda `node-gyp` derlemesi deniyor; başarısızsa JS/WASM yedeğe düşüp kurulum yine başarılı oluyor. Bu, `npx tezgah` ilk kurulum deneyimini nasıl etkiliyor ve önlenmeli mi?

Yapılacak (AFK): `ssh2@~1.17.0`'a bağımlı minimal bir paket `npm pack` ile paketlenip Windows'ta (derleme araç zinciri olmadan) ve mümkünse macOS'ta `npx <tarball>` ile kurulur. Kaydedilecekler: kurulum süresi, konsola basılan derleme hataları, çalışma zamanında hangi yedeğin kullanıldığı. Sonra şu seçenekler karşılaştırılır: (a) olduğu gibi bırakmak; (b) `ssh2`'yi `dist/server`'a bundle'layıp bağımlılık listesinden çıkarmak (tsup); (c) `overrides` / `optionalDependencies` ile `cpu-features`'ı devre dışı bırakmak. Sonuç, [paket yapısı](01-paket-yapisi.md) kararına bir ek olarak kaydedilir.
