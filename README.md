# Tezgah

PostgreSQL için kişisel, yerel çalışan bir veritabanı yönetim aracı. Node.js 22 veya üstü gerekir.

## Kullanım

```sh
npx tezgah-db            # rastgele port, tarayıcıyı açar
npx tezgah-db --port 7000
npx tezgah-db --no-open  # yalnızca adresi terminale yazar
```

Sunucu yalnızca `127.0.0.1`'de dinler. Her açılışta rastgele bir erişim anahtarı üretilir; tarayıcı terminalde yazan `http://127.0.0.1:<port>/?t=<anahtar>` adresiyle açılır. Tezgah yeniden başlatıldığında eski sekme geçersiz olur; terminaldeki yeni adresi açın.

## prod salt okunurluğu

`prod` etiketli bir hedef salt okunur açılır: bağlantılar `default_transaction_read_only=on` ile kurulur, script'ler `BEGIN READ ONLY` ile başlar ve yazma girişimlerini Postgres reddeder. Salt okunurken transaction dışı (Autocommit) script'ler sunucuya hiç gönderilmez. Araç çubuğundaki 🔒 Salt okunur / 🔓 Yazma açık düğmesi yazma modunu tek tıkla açar ve kapatır; kilit sekme ve hedef başınadır: bir sekmede yazmayı açmak başka bir sekmeyi etkilemez, sekmenin hedefi değişince ya da Tezgah yeniden açılınca kilit kapanır. Çalıştırmadan önce ayrıca onay istenmez.

**prod salt okunurluğu bir kaza önleyicidir, güvenlik sınırı değildir.** Yanlış sekmede yanlışlıkla yazmayı önler; veritabanı kullanıcısının yetkilerini kısıtlamaz. prod'u gerçekten korumak için salt okunur yetkili bir rol kullanın.

## Konsol sekmeleri

Konsol sekmelerinin metni ve hedefi (bağlantı, veritabanı) yapılandırma dizinindeki `konsol/sekmeler.json` dosyasına yazılır ve Tezgah açılınca geri gelir; geri gelen sekmeler hiçbir sunucuya kendiliğinden bağlanmaz. Yazma kilidi ve sonuçlar dosyaya yazılmaz. Dosya düz metindir ve script'teki sırlar maskelenmez; POSIX'te `0600` izinle yazılır.

## Çalıştırma kayıtları

Her script çalıştırması (hatalı ve iptal edilenler dahil) yapılandırma dizinindeki `history/` altında aylık bir JSON Lines dosyasına (`2026-11.jsonl`) yazılır: script metni, hedef, mod, zamanlar, sonuç ve ifade başına özet. Satır verisi yazılmaz. Dizin macOS'ta `~/Library/Application Support/Tezgah/history`, Windows'ta `%APPDATA%\Tezgah\history`; script ekranındaki "Çalıştırma kayıtları klasörünü aç" bağlantısı onu açar.

Kayıtlar düz metindir ve script'teki sırlar (ör. `CREATE ROLE … PASSWORD '…'`) maskelenmez. Dosyalar POSIX'te yalnızca kullanıcının okuyabileceği izinle (`0600`) oluşturulur. Kayıtlar otomatik silinmez; aylık dosyalar elle silinebilir.

## Geliştirme

```sh
npm install
npm run dev        # Vite (5173) + tsx watch sunucu (5174); terminaldeki 5173 adresini açın
npm test           # core, server ve web testleri
npm run typecheck
npm run lint
npm run check      # typecheck + lint + test
npm run test:pg    # server testleri geçici bir gerçek Postgres'e karşı (embedded-postgres)
npm run build      # dist/web (Vite) + dist/server (tsup)
```

`npm install`, commit'ten önce typecheck ve lint çalıştıran `.githooks/pre-commit` hook'unu kurar.

Sunucu kodu değişince `tsx watch` sunucuyu yeniden başlatır ve yeni bir erişim anahtarı üretir; terminaldeki yeni adresi açın.

Gerçek Postgres'e karşı çalışan server testleri yalnızca `TEZGAH_TEST_PG_URL` tanımlıysa koşar; `npm run test:pg` bunu geçici bir sunucuyla kendisi yapar.
