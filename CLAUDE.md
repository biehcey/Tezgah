# Tezgah

PostgreSQL için kişisel, IntelliJ veritabanı aracına benzer bir yönetim aracı. `npx` ile terminalden başlatılan, yalnızca localhost'ta dinleyen yerel bir web uygulaması (imzalı kurulum paketi yok). macOS ve Windows'ta çalışmalı.

## Teknoloji

- Backend: Node.js + TypeScript, `pg` sürücüsü
- Arayüz: React, CodeMirror 6 editör
- Şifreler işletim sisteminin anahtar zincirinde (macOS Keychain / Windows Credential Manager) saklanır; diske düz metin şifre yazılmaz.

## Değişmez kurallar

- Sunucu yalnızca `127.0.0.1`'e bağlanır; her açılışta rastgele bir erişim anahtarı üretilir ve her istek bu anahtarla doğrulanır.
- Uygulama açılışta hiçbir sunucuya bağlanmaz; yalnızca kullanıcının açtığı bağlantıya bağlanır.
- `prod` etiketli bağlantılar kırmızı kenarlıkla ve varsayılan olarak salt okunur açılır; script çalıştırmadan önce bağlantı adı yazdırılarak onay alınır.
- Script çalıştırma: ifadeler aynı bağlantıda sırayla, transaction içinde çalışır; hatada durulur ve hatalı satır işaretlenir; sonunda commit/rollback seçilir. Transaction içinde çalışamayan komutlar (`CREATE INDEX CONCURRENTLY`, `VACUUM` vb.) tanınır ve ayrı ele alınır.

## Kapsam

Kapsamda: bağlantı yönetimi (klasörler, ortam etiketi/renk, Cmd/Ctrl+K, sunucu → `pg_database` veritabanları ve şema seçimi, SSH tüneli, `dataSources.xml` ve `.pgpass` içe aktarma), script çalıştırma (deneme modu dahil), sekmeli/geçmişli SQL konsolu ve şema bilen otomatik tamamlama, filtreli/sayfalı tablo görünümü (`pg_class.reltuples` ile tahmini satır sayısı), PK üzerinden düzenlenebilir grid (bekleyen değişiklikler + üretilen SQL önizlemesi), ALTER TABLE önizlemeli kolon ekleme.

Kapsam dışı (şimdilik): şema tasarımı, ER diyagramı, Postgres dışındaki veritabanları.

## Çalışma şekli

- Önce bağlantı yönetimi ve script çalıştırma akışı; ardından konsol, tablo görünümü, grid.
- Her adım küçük ve tek başına test edilebilir olmalı. Saf mantık (ifade bölme, transaction dışı komut tanıma, SQL üretimi, içe aktarma ayrıştırıcıları) UI ve veritabanından bağımsız modüllerde tutulup birim testleriyle doğrulanır.

## Git

- Commit mesajlarına `Co-Authored-By: Claude ...` satırı, PR açıklamalarına "Generated with Claude Code" satırı eklenmez; Claude katkıcı olarak kaydedilmez.

## Agent skills

### Issue tracker

Issues and specs live as local markdown files under `.scratch/<feature>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five canonical roles (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`), recorded as a `Status:` line in each issue file. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
