# Harita: İlk dilim (bağlantı yönetimi + script çalıştırma)

Label: wayfinder:map

## Destination

Tezgah'ın ilk dilimi (bağlantı yönetimi + script çalıştırma akışı) için `/to-spec`'e verilebilecek kadar netleşmiş kararlar: tek bir `spec.md` yazılabilsin; geri dönmesi zor kararlar ADR'de. Uygulama kodu bu haritanın çıktısı değildir.

## Notes

- Kişisel proje, tek geliştirici. Proje bağlamı ve değişmez kurallar: `CLAUDE.md`. Terimler: `GLOSSARY.md` (Bağlantı, Veritabanı seçimi, Hedef, Ortam etiketi). ADR'ler: `docs/adr/`.
- Kararlar küçük ve tek başına test edilebilir parçalara bölünebilecek şekilde verilir; saf mantık `src/core`'da.
- Teknik belirsizlikte research veya prototype ticket'ı açmaktan çekinme.
- Grilling ticket'larında `grilling` ve `domain-modeling` becerilerini çağır.
- Research bulguları atılabilir `research/<ad>` dallarında; ticket'tan bağlam işaretçisi.
- İlk dilim sınırı: tek ve "aptal" bir CodeMirror script editörü (yalnızca SQL renklendirme), hedef seçimi, ifade başına canlı log, hatalı satır işareti, commit/rollback, deneme modu. SSH ve içe aktarma bu haritada karara bağlanır; spec'te ayrı sıralı alt adımlar olur.

## Decisions so far

- [Paket yapısı ve build/dev akışı](issues/01-paket-yapisi.md): workspace'siz tek paket; `src/core|server|web`; Vite + tsup; Node 22.
- [Yerel güvenlik: erişim anahtarı, CSRF, DNS rebinding](issues/02-yerel-guvenlik.md): URL token → HttpOnly SameSite=Strict cookie; Host ve Origin doğrulaması; CORS yok.
- [Bağlantı ayarlarının saklanması](issues/03-ayar-saklama.md): OS yapılandırma dizininde sürümlü tek `tezgah.json`; şifreler keychain'de.
- [Sunucu modeli: veritabanı listeleme ve pool yönetimi](issues/04-sunucu-modeli.md): başlangıç veritabanından `pg_database`; hedef başına tembel küçük pool; script tek client tutar.
- [İfade bölme ve hata konumunu satıra eşleme](issues/05-ifade-bolme.md): `src/core`'da kendi lexer'ımız; `position` + ifade offset'i → satır/sütun.
- [Backend ↔ arayüz iletişimi](issues/06-backend-arayuz-iletisimi.md): CRUD REST, script çalıştırma WebSocket; kopmada rollback.
- [prod salt okunurluğu ve onay akışı](issues/07-prod-salt-okunurluk.md): `default_transaction_read_only` + `BEGIN READ ONLY`; oturumluk yazma kilidi (tek tıkla açılır, bkz. Script çalıştırma ekranının yerleşimi).
- [Bağlantı modelinde SSL/TLS](issues/08-ssl-alanlari.md): `sslmode` + CA/sertifika yolları; varsayılan `prefer`, prod'da `verify-full` önerisi.
- [Script içindeki SELECT sonuçları](issues/09-script-select-onizleme.md): satır sayısı + ilk 100 satır önizleme.
- [Entegrasyon test stratejisi](issues/10-test-stratejisi.md): core birim; server `TEZGAH_TEST_PG_URL` varsa gerçek PG; keychain/SSH sahte.
- [pg sürücüsünde sslmode davranışı](issues/14-pg-sslmode.md): connection string yok; `ssl` nesnesi core'da açıkça kurulur; `prefer` Tezgah tarafında SSL→düz tek yeniden deneme; tünelde açık `checkServerIdentity(realHost)`.
- [Keychain kütüphanesi seçimi](issues/11-keychain-kutuphanesi.md): `@napi-rs/keyring`; service `tezgah`, account `connectionId`; keychain'de yalnızca şifre/passphrase (Windows 2560 bayt sınırı).
- [IntelliJ dataSources.xml formatı](issues/13-datasources-xml-formati.md): belgesiz format; proje `.idea/` + global `JetBrains/*/options/`, `uuid` ile birleştirme; SSH `sshConfigs.xml`'de; renk/ortam etiketi eşlenemez; IntelliJ şifreleri okunmaz (öneri).
- [SSH: kütüphane, kimlik doğrulama ve agent desteği](issues/12-ssh-kutuphanesi.md): `ssh2@~1.17.0`; yerel port yok (Duplex sarmalayıcı + `stream` factory); Pageant yalnızca named pipe; known_hosts için kendi saf modülümüz; ProxyJump `sock` zinciri.
- [Transaction dışı komutlar ve karışık script](issues/15-transaction-disi-komutlar.md): çalıştırma modu içerikten çıkar (Transaction / Autocommit / karışık → reddedilir); ilk anahtar kelime deseni + `25001` yedeği; deneme modunda reddedilir; kopmada iptal.
- [Deneme modunda ne gösterilir](issues/16-deneme-modu.md): tablo bazlı önce/sonra farkı (PG18+ `RETURNING old.*, new.*`); PG18 öncesi veya PK'sız tabloda ifade başına `RETURNING *` önizleme; DDL için katalog şema farkı.
- [SSH tüneli yaşam döngüsü](issues/17-ssh-tunel-yasam-dongusu.md): tek atlama, `password|key|agent`; tembel aç/son pool'la kapat; kopmada pool'lar atılır, otomatik yeniden bağlanma yok; host anahtarı `~/.ssh/known_hosts` (salt okunur) + Tezgah `known_hosts`, bilinmeyende parmak izi onayı, uyuşmazlıkta sert ret; SSH sırrı `<connectionId>:ssh`, kaydetmeme seçeneği DB şifresine de.
- [İçe aktarma akışı: dataSources.xml ve .pgpass](issues/18-ice-aktarma-akisi.md): önizlemeli tek diyalog; sunucu-düzeyi anahtarla aday birleştirme, mevcutta varsayılan atla; `.pgpass` somut satırları aday + şifreler keychain'e kopya; `read-only` → `prod` önerisi; IntelliJ şifreleri okunmaz; saf ayrıştırıcılar `src/core/import`.
- [npx kurulumunda ssh2 native derleme davranışı](issues/19-npx-ssh2-kurulum.md): kurulum her durumda sessiz başarılı, binding yalnızca performans; `ssh2` tsup ile `dist/server`'a gömülür (native external), `overrides` tüketici tarafında işlemez.
- [prod hedefinde deneme modu](issues/20-prod-deneme-modu.md): yazma modu kapalıyken de `BEGIN READ WRITE` + otomatik rollback; ad onayı yok, sabit yan etki uyarı şeridi; prod'da `lock_timeout = '3s'`.
- [Commit/rollback beklerken zaman aşımı](issues/21-commit-bekleme-zaman-asimi.md): Karar süresi `prod` 5 dk / diğerleri 30 dk; dolunca otomatik rollback; son 1 dk geri sayım + sınırsız "Uzat"; Tezgah zamanlayıcısı + `idle_in_transaction_session_timeout` yedeği.
- [Çalıştırma geçmişi ve denetim kaydı](issues/22-calistirma-gecmisi.md): her çalıştırma için Çalıştırma kaydı (deneme/hata dahil); `history/` altında aylık JSONL, başladı/bitti satırları; script metni + hedef anlık kopyası + sonuç + ifade özeti, satır verisi asla; süresiz, maskeleme yok; prod için ayrı denetim yok; ilk dilimde yalnızca "klasörü aç" bağlantısı.
- [Script çalıştırma ekranının yerleşimi](issues/23-script-ekrani-yerlesimi.md): varyant B, yani üstte hedef başlığı, solda editör, sağ sütunda karar kartı ve ifade zaman çizelgesi; Değişiklikler sekmesi yalnızca denemede; hata sonrası yalnızca rollback; prod yazma kilidi tek tıkla, çalıştırma öncesi hiçbir onay yok.
- [Bağlantı formu ve "bağlantıyı test et" akışı](issues/24-baglanti-formu.md): varyant C, yani kısa form, katlanır SSL/SSH, URL'den doldurma (URL saklanmaz); test kaydedilmemiş değerlerle 6 adım (sırlar → SSH → ulaşma → TLS → kimlik doğrulama → `pg_database`), sonuç ait olduğu bölümde, ilk hatada durur; testsiz kaydetme serbest.
- [Bağlantı ağacı, klasör etkileşimleri ve Cmd/Ctrl+K hızlı geçiş](issues/25-baglanti-agaci-hizli-gecis.md): varyant C, yani üstte klasörlü bağlantı listesi, altta veritabanı paneli (⭐ görünürlük, şema çipleri, tıkla = hedef); tek düzey klasör, sürükle-bırak; oturumluk şifre Tezgah kapanana kadar bellekte (yalnızca `28P01`'de yeniden); Ctrl+K ↵ mevcut editörün hedefini değiştirir, `postgres://` yapıştırınca mevcut eşleşme + "URL'den yeni bağlantı".

## Not yet specified

_(şu an boş: kalan son ticket [İçe aktarma diyaloğunun yerleşimi](issues/26-ice-aktarma-diyalogu.md))_

## Out of scope

- `~/.ssh/config`'ten SSH ayarı içe aktarma (`ssh-config`, `matchExec: false`): ilk dilimde gerekmiyor; sonraki bir içe aktarma iyileştirmesi.
- SSH ProxyJump / çok atlamalı tünel: ilk dilim tek atlama; model `jumps[]` eklemeye açık ([SSH tüneli yaşam döngüsü](issues/17-ssh-tunel-yasam-dongusu.md)).

- Sekmeli/geçmişli konsol, şema bilen otomatik tamamlama, tablo görünümü, düzenlenebilir grid, ALTER TABLE önizlemesi: sonraki dilimler (CLAUDE.md sırası).
- Tam sonuç grid'i: konsol dilimi.
- Bağlantı formunda libpq `anahtar=değer` dizisinden doldurma: ilk dilimde yalnızca URL ([Bağlantı formu ve "bağlantıyı test et" akışı](issues/24-baglanti-formu.md)).
- Çalıştırma kayıtlarına göz atma arayüzü ve saklama süresi ayarı: konsol dilimi / sonraki iyileştirme ([Çalıştırma geçmişi ve denetim kaydı](issues/22-calistirma-gecmisi.md)).
