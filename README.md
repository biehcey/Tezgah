# Tezgah

PostgreSQL için kişisel, yerel çalışan bir veritabanı yönetim aracı. Node.js 22 veya üstü gerekir.

## Kullanım

```sh
npx tezgah            # rastgele port, tarayıcıyı açar
npx tezgah --port 7000
npx tezgah --no-open  # yalnızca adresi terminale yazar
```

Sunucu yalnızca `127.0.0.1`'de dinler. Her açılışta rastgele bir erişim anahtarı üretilir; tarayıcı terminalde yazan `http://127.0.0.1:<port>/?t=<anahtar>` adresiyle açılır. Tezgah yeniden başlatıldığında eski sekme geçersiz olur; terminaldeki yeni adresi açın.

## prod salt okunurluğu

`prod` etiketli bir hedef salt okunur açılır: bağlantılar `default_transaction_read_only=on` ile kurulur, script'ler `BEGIN READ ONLY` ile başlar ve yazma girişimlerini Postgres reddeder. Salt okunurken transaction dışı (Autocommit) script'ler sunucuya hiç gönderilmez. Araç çubuğundaki 🔒 Salt okunur / 🔓 Yazma açık düğmesi yazma modunu tek tıkla açar ve kapatır; kilit editör ve hedef başına, sayfa açık kaldıkça geçerlidir ve çalıştırmadan önce ayrıca onay istenmez.

**prod salt okunurluğu bir kaza önleyicidir, güvenlik sınırı değildir.** Yanlış sekmede yanlışlıkla yazmayı önler; veritabanı kullanıcısının yetkilerini kısıtlamaz. prod'u gerçekten korumak için salt okunur yetkili bir rol kullanın.

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
npm run build      # dist/web (Vite) + dist/server (tsup)
```

Sunucu kodu değişince `tsx watch` sunucuyu yeniden başlatır ve yeni bir erişim anahtarı üretir; terminaldeki yeni adresi açın.

Gerçek Postgres'e karşı çalışan server testleri yalnızca `TEZGAH_TEST_PG_URL` tanımlıysa koşar.
