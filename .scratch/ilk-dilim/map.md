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
- [prod salt okunurluğu ve onay akışı](issues/07-prod-salt-okunurluk.md): `default_transaction_read_only` + `BEGIN READ ONLY`; bağlantı adı yazarak oturumluk yazma kilidi.
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

## Not yet specified

- Cmd/Ctrl+K hızlı geçiş UI'ı.
- Klasör ağacı etkileşimleri (sürükle-bırak, yeniden adlandırma, silme).
- Bağlantı formu ve "bağlantıyı test et" akışı (SSH alanları, "Keychain'e kaydet" kutusu, oturumluk şifre istemi ve host anahtarı onay diyaloğu dahil).
- Script çalıştırma ekranının yerleşimi (editör, log, commit/rollback çubuğu, prod çerçevesi, çalıştırma modu rozeti, autocommit onayı); deneme modunun sonuç alanı Değişiklikler/Log sekmeleri olarak belirlendi, aynı sekmelerin normal çalıştırmada da kullanılıp kullanılmayacağı açık.
- İçe aktarma diyaloğunun yerleşimi (kaynak listesi, proje yolu girişi, önizleme tablosu); sütunlar ve davranış [İçe aktarma akışı](issues/18-ice-aktarma-akisi.md)'nda belirlendi.
- Commit/rollback beklerken zaman aşımı (açık transaction ne kadar bekleyebilir?).
- Çalıştırma geçmişi/denetim kaydı ilk dilime girer mi?

## Out of scope

- `~/.ssh/config`'ten SSH ayarı içe aktarma (`ssh-config`, `matchExec: false`): ilk dilimde gerekmiyor; sonraki bir içe aktarma iyileştirmesi.
- SSH ProxyJump / çok atlamalı tünel: ilk dilim tek atlama; model `jumps[]` eklemeye açık ([SSH tüneli yaşam döngüsü](issues/17-ssh-tunel-yasam-dongusu.md)).

- Sekmeli/geçmişli konsol, şema bilen otomatik tamamlama, tablo görünümü, düzenlenebilir grid, ALTER TABLE önizlemesi: sonraki dilimler (CLAUDE.md sırası).
- Tam sonuç grid'i: konsol dilimi.
