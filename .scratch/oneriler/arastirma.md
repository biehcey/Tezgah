# Araştırma: Tezgah'a neler eklenebilir?

Type: research
Status: needs-triage

## Question

İlk dilim (bağlantı yönetimi + script çalıştırma, ticket 01–19) bitti ve `tezgah-db@0.1.0` olarak paketlendi. Bundan sonra ne eklenmeli? Öneriler birincil kaynaklara (PostgreSQL, node-postgres, CodeMirror, JetBrains DataGrip, pgAdmin, DBeaver resmi dokümanları) dayanmalı. Her öneri bu mimariye (`src/core` saf + birim testli, `src/server`, `src/web`) ve değişmez kurallara (yalnızca `127.0.0.1`, açılışta bağlantı yok, `prod` salt okunur + tek tıkla yazma, onay yok) göre değerlendirilmeli.

Kaynak notasyonu: her iddianın sonunda köşeli parantez içinde kaynak var. Birincil kaynakla doğrulayamadığım şeyler **doğrulanmadı** diye işaretli. Efor: S = bir ticket, birkaç gün; M = 2–4 ticket; L = kendi dilimi/haritası gereken iş.

## Mevcut durum (öneriler bunun üstüne)

Repodan okunanlar (`CLAUDE.md`, `README.md`, `GLOSSARY.md`, `docs/adr/0001–0002`, `.scratch/ilk-dilim/spec.md` + `map.md`, `.scratch/ilk-dilim-uygulama/issues/01–19`, `src/`, `git log`):

**Yapılmış (önerilmedi):** klasörlü bağlantı listesi, ortam etiketi/renk, keychain + oturumluk şifre, SSL/TLS (`sslmode` core'da), SSH tüneli (yerel port yok, host anahtarı doğrulaması), Bağlantı testi, `pg_database`/`pg_namespace` ile Veritabanı seçimi, Cmd/Ctrl+K, `dataSources.xml` ve `.pgpass` içe aktarma, Transaction/Autocommit Çalıştırma modu, transaction dışı komut tanıma, hata konumu, Karar süresi (+ `idle_in_transaction_session_timeout` yedeği), kopmada rollback / `pg_cancel_backend`, prod salt okunurluğu (`default_transaction_read_only=on` + `BEGIN READ ONLY`) ve Yazma kilidi, Deneme modu (PG18 `RETURNING old.*, new.*` farkı, yedek önizleme, DDL şema farkı, prod'da `lock_timeout = '3s'`), Çalıştırma kaydı (JSONL), SELECT için imleçle ilk 100 satır önizleme (`src/server/script-calistirici.ts` `runWithCursor`), pool'larda `application_name: 'Tezgah'` (`src/server/havuzlar.ts`).

**Planlı ama yapılmamış (CLAUDE.md "Kapsam" + spec "Out of Scope"):** sekmeli/geçmişli SQL konsolu, şema bilen otomatik tamamlama, filtreli/sayfalı tablo görünümü (`reltuples`), PK üzerinden düzenlenebilir grid, ALTER TABLE önizlemeli kolon ekleme. Spec'te açıkça ertelenenler: tam sonuç grid'i, Çalıştırma kayıtlarına göz atma arayüzü, `pg_blocking_pids` ile "N oturumu bekletiyorsun" göstergesi (ilk-dilim ticket 21), Karar süresi ayarı, ProxyJump / `~/.ssh/config`, libpq `anahtar=değer`, PG17 direct SSL, birden çok editör.

**Bilinçli kapsam dışı:** şema tasarımı, ER diyagramı, Postgres dışı veritabanları.

Editörde şu an yalnızca `sql({ dialect: PostgreSQL })` renklendirmesi, `history` ve `defaultKeymap` var (`src/web/script/ScriptEditoru.tsx`); `@codemirror/autocomplete` `lang-sql`'in bağımlılığı olarak `node_modules`'ta duruyor, `@codemirror/search` ve `@codemirror/lint` kurulu değil. Sunucu `notice` olayını dinlemiyor (`src/` içinde `'notice'` geçmiyor).

---

## 1. Kapsamdaki eksikleri tamamlayan (CLAUDE.md sırasıyla)

### 1.1 Sekmeli SQL konsolu + tam sonuç grid'i (akışlı, sayfalı) — L

- **Ne:** Script ekranından ayrı, birden çok sekmeli konsol; her sekme kendi hedefine bağlı. SELECT sonucu ilk 100 satırla sınırlı değil, kaydırdıkça sayfa sayfa çekilen bir grid.
- **Fayda:** CLAUDE.md'deki bir sonraki adım. DataGrip'te sekmeler ve konsol temel iş akışı: her SELECT yeni sonuç sekmesinde açılabiliyor ve sekme sabitlenebiliyor ("Open results in new tab", "Pin Tab") [DataGrip, Run queries: https://www.jetbrains.com/help/datagrip/query-execution.html].
- **Uygulanabilirlik:** Sunucuda şu an elle `DECLARE … CURSOR` + `FETCH 100` + `MOVE FORWARD ALL` var. Konsolda imleç açık tutulup istendikçe `FETCH N` yapılabilir. Resmi `pg-cursor` paketi aynı işi `new Cursor(text, values, { rowMode: 'array' })` + `cursor.read(n)` + `cursor.close()` ile yapıyor; bu imleç bir client'a bağlı (`client.query(cursor)`) [https://node-postgres.com/apis/cursor]. Dışa aktarma gibi uçtan uca akış için `pg-query-stream` sunucu tarafında imleç kullanan bir Readable stream veriyor; yalnızca saf JS client'la çalışıyor [https://github.com/brianc/node-postgres/tree/master/packages/pg-query-stream]. Mevcut "script tek client tutar" modeli (ADR-0002) buna uyuyor: açık imleç = açık transaction, yani Karar süresi ve kopmada rollback kuralı aynen geçerli.
- **Saf modül:** sayfalama durumu (imleç konumu, "daha var mı", toplam bilinmiyorsa `MOVE` sayımı) ve hücre biçimleme (`RAW_TYPES` ile ham metin) core'da tutulabilir.
- **Kurallar:** prod'da konsol da `BEGIN READ ONLY` ile açılmalı; Yazma kilidi konsol sekmesi + hedef başına olmalı (mevcut "editör ve hedef başına" tanımı genişler). Açık imleç transaction tuttuğu için `idle_in_transaction_session_timeout` yedeği konsolda da gerekli [https://www.postgresql.org/docs/current/runtime-config-client.html].
- **Açık soru:** konsolda Transaction modu mu, Autocommit mi varsayılan? DataGrip'te oturum başına "Tx Mode" var [https://www.jetbrains.com/help/datagrip/sessions.html]; DBeaver `Production` tipinde auto-commit'i varsayılan kapatıyor [https://dbeaver.com/docs/dbeaver/Connection-Types/]. Tezgah'ın mevcut modeli (içerikten çıkan Çalıştırma modu) konsolda da kullanılabilir; bu bir grilling konusu.

### 1.2 Sorgu geçmişi = Çalıştırma kaydı göz atma — S/M

- **Ne:** `history/*.jsonl` dosyalarını okuyan, hedefe göre filtrelenebilen, aranabilir bir liste; çift tıkla metni editöre yapıştırır.
- **Fayda:** Spec bunu "konsol dilimine" bırakmış (ilk-dilim ticket 22). DataGrip'te "Browse Query History" (Ctrl+Alt+E) veri kaynağı başına çalıştırılan tüm ifadeleri listeliyor, metin araması var, çift tıkla editöre yapıştırıyor [https://www.jetbrains.com/help/datagrip/find-recent-queries-and-files.html]. pgAdmin'de "Query History" sekmesi var, varsayılan olarak veritabanı başına son 20 sorguyu tutuyor [https://www.pgadmin.org/docs/pgadmin4/latest/query_tool.html].
- **Uygulanabilirlik:** Biçim zaten core'da (`src/core/calistirma-kaydi.ts`, "bilinmiyor" çıkarımı dahil). Yeni saf iş: filtre/arama fonksiyonu. Sunucu tarafında aylık dosyaları okuyan bir REST ucu.
- **Kurallar:** Ağ trafiği yok, açılışta bağlantı kuralına dokunmaz. Kayıtlar düz metin olduğu için arayüzde de maskeleme yok; README'deki uyarı geçerli.

### 1.3 Şema bilen otomatik tamamlama — M

- **Ne:** Tablo, kolon ve şema adlarını tamamlama.
- **Fayda:** CLAUDE.md'de kapsamda.
- **Uygulanabilirlik:** `@codemirror/lang-sql`'in `SQLConfig.schema` seçeneği tablo/şema → kolon iç içe nesnesi alıyor; `defaultSchema` verilince o şemanın tabloları önek olmadan tamamlanıyor; `upperCaseKeywords` ve `schemaCompletionSource`/`keywordCompletionSource` var [https://github.com/codemirror/lang-sql/blob/main/README.md]. Yani tamamlama motorunu yazmak gerekmiyor, yalnızca katalogdan bu nesneyi üretmek gerekiyor.
- **Saf modül:** `pg_namespace` + `pg_class` + `pg_attribute` satırlarından (`format_type` ile tip) `SQLNamespace` nesnesi üreten dönüştürücü; Veritabanı seçimindeki görünür şemalarla filtreleme; `defaultSchema` için `search_path`'in ilk geçerli şeması (`current_schemas()` ile çözülmüş yol) [https://www.postgresql.org/docs/current/runtime-config-client.html]. Tablo tabanlı birim testine çok uygun.
- **Kurallar:** Katalog okuma yalnızca hedef açıkken yapılmalı (açılışta bağlantı yok). Salt okunur prod'da sorun yok.

### 1.4 Filtreli/sayfalı tablo görünümü (`reltuples`) — M

- **Ne:** Bir tabloyu açınca filtre (WHERE), sıralama ve sayfalama ile göz atma; başlıkta tahmini satır sayısı.
- **Dikkat edilecek kaynak bilgisi:** `pg_class.reltuples` yalnızca planlayıcı tahmini; VACUUM, ANALYZE ve bazı DDL'lerle (`CREATE INDEX`) güncelleniyor; tablo hiç vacuum/analyze görmediyse **`-1`** ve bu "bilinmiyor" demek [https://www.postgresql.org/docs/current/catalog-pg-class.html]. Arayüz `-1`'i "≈ bilinmiyor" diye göstermeli, `0` değil.
- **Saf modül:** tanımlayıcı tırnaklama, kullanıcı filtresinin parametreli WHERE'e çevrilmesi, PK varsa keyset (`WHERE pk > $son`) sayfalama SQL üretimi, `reltuples` gösterim kuralı.
- **Kurallar:** Yalnızca okuma; prod'da `BEGIN READ ONLY` içinde çalışır.
- **Ek (S):** aynı ekranda `pg_stat_user_tables`'tan `n_live_tup`, `n_dead_tup`, `last_autovacuum`, `seq_scan`/`idx_scan` gösterilebilir [https://www.postgresql.org/docs/current/monitoring-stats.html].

### 1.5 PK üzerinden düzenlenebilir grid + üretilen SQL önizlemesi — L

- **Ne:** Hücre düzenleme, satır ekleme/silme; bekleyen değişiklikler listesi ve üretilen `UPDATE … WHERE pk = …` / `INSERT` / `DELETE` önizlemesi.
- **Tezgah'a özgü fırsat:** Üretilen SQL doğrudan mevcut Script çalıştırıcıya bir script olarak verilebilir. Böylece transaction, hatada durma, hatalı satır işareti, commit/rollback kararı, Karar süresi, Çalıştırma kaydı ve **Deneme modu farkı** (PG18'de önce/sonra) bedavaya gelir. pgAdmin de auto-commit kapalıyken grid değişikliklerini transaction'da tutuyor, kaydetme hatasında otomatik savepoint'e dönüyor [https://www.pgadmin.org/docs/pgadmin4/latest/query_tool.html].
- **Saf modül:** değişiklik kümesi → SQL üretimi (tırnaklama, NULL, tip dönüşümü `$1::tip`), aynı hücreye çoklu düzenlemenin birleştirilmesi. CLAUDE.md "SQL üretimi" saf mantığını zaten öngörüyor.
- **Kurallar:** Salt okunur prod'da "Uygula" Postgres'e gider ve reddedilir (mevcut davranış), ya da düğme 🔒 iken devre dışı gösterilir; ek onay eklenmemeli. PK'sız tabloda düzenleme kapalı olmalı (Deneme farkının PK kuralıyla tutarlı).

### 1.6 ALTER TABLE önizlemeli kolon ekleme — S/M

- **Ne:** Formdan kolon adı/tip/NULL/varsayılan seçilir, `ALTER TABLE … ADD COLUMN` önizlenir.
- **Uygulanabilirlik:** Saf SQL üretici + mevcut Deneme modunun DDL şema farkı (`+ kolon son_giris timestamptz NULL`) hazır. Varsayılan ifadeyi göstermek için `pg_get_expr(adbin, adrelid)` kullanılabilir [https://www.postgresql.org/docs/current/functions-info.html].
- **Kurallar:** Script çalıştırıcı üzerinden gider; prod kuralları aynen geçerli.

### 1.7 "Bekletiyorsun" göstergesi (`pg_blocking_pids`) — S

- **Ne:** Karar beklerken, açık transaction'ın kaç oturumu kilitle beklettiğini göstermek (ilk-dilim ticket 21'de "sonraki iyileştirme").
- **Kaynak:** `pg_blocking_pids(pid)` bir oturumu kilit almaktan alıkoyan oturumların PID dizisini döndürüyor. Sık çağrılması performansı etkileyebilir; hazırlanmış transaction PID `0` olarak görünüyor [https://www.postgresql.org/docs/current/functions-info.html]. `pg_locks` dokümanı engelleyenleri bulmak için `pg_locks`'u kendisiyle birleştirmek yerine bu fonksiyonu öneriyor [https://www.postgresql.org/docs/current/view-pg-locks.html].
- **Uygulanabilirlik:** Tezgah'ın tuttuğu client'ın `pg_backend_pid()`'i biliniyor. Karar süresi boyunca birkaç saniyede bir, ayrı bir pool client'ından `SELECT count(*) FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))` çalıştırılır. Diğer kullanıcıların oturum ayrıntıları `pg_read_all_stats` olmadan kısmen NULL gelir, ama oturumun varlığı herkese görünür [https://www.postgresql.org/docs/current/monitoring-stats.html]. Bu yüzden sayı göstermek yetkiden bağımsız çalışır, ayrıntı göstermek çalışmayabilir.
- **Kurallar:** Okuma; prod'da daha da faydalı (kilit tutan prod transaction'ı).

---

## 2. Hızlı kazanımlar (S)

### 2.1 İmleçteki ifadeyi / seçimi çalıştır

- DataGrip'te imleç bir ifadenin içindeyken en küçük/en büyük ifadeyi, tüm script'i ya da imleçten aşağısını çalıştırma seçenekleri var; seçim "tek ifade gibi" ya da ayrı ifadeler olarak çalıştırılabiliyor [https://www.jetbrains.com/help/datagrip/query-execution.html].
- **Uygulanabilirlik:** `src/core/ifade-bolme.ts` zaten her ifadenin başlangıç/bitiş offset'ini veriyor. "offset → ifade" ve "seçim → ifade alt kümesi" saf fonksiyonlarla eklenir. Çalıştırma modu çıkarımı alt kümeye uygulanır.
- **Kurallar:** Değişmez; sadece gönderilen script küçülür.

### 2.2 `RAISE NOTICE` / sunucu mesajlarını Log'da göstermek

- Migration script'lerinde `DO $$ … RAISE NOTICE … $$` yaygın. PL/pgSQL'de `NOTICE`, `INFO`, `WARNING` gibi seviyeler hata üretmeden mesaj gönderiyor; istemciye gidip gitmediğini `client_min_messages` belirliyor [https://www.postgresql.org/docs/current/plpgsql-errors-and-messages.html]. node-postgres `Client` bunun için `notice` olayı yayınlıyor [https://node-postgres.com/apis/client].
- **Uygulanabilirlik:** Script çalıştırıcı tuttuğu client'ta `notice`'i dinleyip mevcut WS olay akışına yeni bir `bildirim{i, seviye, mesaj}` olayı ekler; ifade kartında gösterilir. Çalıştırma kaydına yazılıp yazılmayacağı karar gerektirir (satır verisi değil ama sır içerebilir).
- **Kurallar:** Etkisi yok.

### 2.3 WHERE'siz UPDATE/DELETE uyarısı (onaysız, lint olarak)

- DataGrip `WHERE`'siz ya da `WHERE TRUE`'lu `DELETE`/`UPDATE` için uyarı gösteriyor, kullanıcı yine de çalıştırabiliyor [https://www.jetbrains.com/help/datagrip/query-execution.html].
- **Tezgah'a uyarlama:** CLAUDE.md "çalıştırmadan önce ayrıca onay istenmez" diyor; bu yüzden **modal onay değil**, editörde satır içi uyarı. `@codemirror/lint` `linter()` ile `{from, to, severity, message, actions}` diagnostic'leri ve `lintGutter` sağlıyor [https://codemirror.net/examples/lint/]. Mevcut Karışık/reddedilen ifade vurguları da ileride aynı diagnostic altyapısına taşınabilir.
- **Saf modül:** lexer çıktısı üstünde "ilk anahtar kelime UPDATE/DELETE ve üst düzeyde WHERE yok" kuralı; tablo tabanlı test. CTE/alt sorgu içindeki WHERE'i ayırt etmek lexer düzeyinde kaba kalabilir; yanlış pozitif zararsız (yalnızca uyarı).

### 2.4 Editörde arama/değiştir ve çoklu seçim

- `@codemirror/search` `search()`, `searchKeymap`, `openSearchPanel`, `highlightSelectionMatches` sağlıyor [https://codemirror.net/docs/ref/#search]. Çoklu seçim `EditorState.allowMultipleSelections` facet'i ile açılıyor; ikincil seçimlerin görünmesi için `drawSelection` gerekiyor [https://codemirror.net/docs/ref/].
- Şu an kurulu değil (`node_modules/@codemirror` içinde `search` yok). Yalnızca web'e eklenti; test gerekmez (spec: CodeMirror'ın kendi davranışı test edilmez).

### 2.5 Sonucu kopyala / dışa aktar (CSV, TSV, Markdown, SQL INSERT)

- DataGrip'in "data extractor"ları: SQL Inserts, SQL Updates, Where Clause, CSV, TSV, JSON, Markdown, HTML, XML vb. [https://www.jetbrains.com/help/datagrip/data-extractors.html]. pgAdmin sonuçları CSV olarak kaydediyor [https://www.pgadmin.org/docs/pgadmin4/latest/query_tool.html].
- **Saf modül:** `{kolonlar, satirlar}` → CSV (RFC tırnaklama), TSV, Markdown tablosu, `INSERT` dizisi. Çok iyi birim testi adayı. Önizleme verisi zaten bu biçimde (`src/server/script-calistirici.ts` `preview`).
- Büyük sonuçlar için 3.3'teki COPY ile birleşir.

### 2.6 Konsol için isteğe bağlı `statement_timeout` / `transaction_timeout`

- `statement_timeout` ifade başına toplam süreyi, `lock_timeout` her kilit denemesini, `transaction_timeout` (PG17'de eklendi [https://www.postgresql.org/docs/release/17.0/]) transaction'ın toplam süresini sınırlıyor; hepsi varsayılan `0` (kapalı). Doküman bunları `postgresql.conf`'ta değil rol/veritabanı/oturum düzeyinde ayarlamayı öneriyor; `statement_timeout` ≤ `lock_timeout` ise `lock_timeout` anlamsız [https://www.postgresql.org/docs/current/runtime-config-client.html]. node-postgres client config'inde `statement_timeout` ve `query_timeout` seçenekleri var [https://node-postgres.com/apis/client].
- **Tezgah bağlamı:** ilk dilim bilinçli olarak `statement_timeout` koymadı ("uzun sorguyu kullanıcı iptal eder", `src/core/deneme.ts`). Öneri bunu değiştirmek değil: konsolda/tablo görünümünde, Ortam etiketine göre opsiyonel bir `SET LOCAL statement_timeout` (ör. prod'da göz atma sorguları için). `transaction_timeout` Karar süresiyle çakışabileceği için script çalıştırmada kullanılmamalı (Karar süresi zaten var). Saf modül: etiket → `SET LOCAL` listesi (mevcut `denemeLockTimeout` deseni).

### 2.7 CREATE INDEX CONCURRENTLY / VACUUM ilerlemesi

- Autocommit modunda uzun süren komutlar için `pg_stat_progress_create_index` (`CREATE INDEX`/`REINDEX`), `pg_stat_progress_vacuum`, `pg_stat_progress_cluster`, `pg_stat_progress_analyze`, `pg_stat_progress_copy` görünümleri var [https://www.postgresql.org/docs/current/monitoring-stats.html].
- **Uygulanabilirlik:** Çalışan ifadenin PID'i biliniyor; ayrı bir pool client'ıyla periyodik okunup ifade kartında "faz / blok ilerlemesi" gösterilir. Not: PG17'de `pg_stat_progress_vacuum` kolonları yeniden adlandırıldı (`max_dead_tuples` → `max_dead_tuple_bytes`, `num_dead_tuples` → `num_dead_item_ids`) [https://www.postgresql.org/docs/release/17.0/]; saf eşleme modülü sürüme göre kolon seçmeli.
- **Kurallar:** Okuma; mevcut ADR-0002 eki (iptal edilen CIC INVALID index bırakabilir) ile birlikte kullanıcıya daha iyi bilgi verir.

---

## 3. Daha büyük işler (M/L)

### 3.1 EXPLAIN / EXPLAIN ANALYZE plan görselleştirme — M

- **Kaynak:** `EXPLAIN` seçenekleri: `ANALYZE`, `FORMAT {TEXT|XML|JSON|YAML}`, `BUFFERS`, `SERIALIZE` (ANALYZE gerekir), `GENERIC_PLAN` (`$1` yer tutucularıyla, ANALYZE ile birleşmez), `MEMORY`, `SETTINGS`, `WAL` (ANALYZE gerekir), `VERBOSE`, `COSTS`, `TIMING`, `SUMMARY` [https://www.postgresql.org/docs/current/sql-explain.html]. `MEMORY` ve `SERIALIZE` PG17'de [https://www.postgresql.org/docs/release/17.0/]; PG18'de `EXPLAIN ANALYZE` `BUFFERS`'ı otomatik içeriyor [https://www.postgresql.org/docs/release/18.0/].
- **Kritik güvenlik noktası:** `EXPLAIN ANALYZE` ifadeyi gerçekten çalıştırıyor; INSERT/UPDATE/DELETE/MERGE/CREATE TABLE AS/EXECUTE için doküman `BEGIN; EXPLAIN ANALYZE …; ROLLBACK;` öneriyor [https://www.postgresql.org/docs/current/sql-explain.html]. **Bu Tezgah'ın Deneme modunun ta kendisi**: DML'de "Analiz et" Deneme yoluyla (her zaman rollback, prod'da `BEGIN READ WRITE` + `lock_timeout 3s`, yan etki şeridi) çalışmalı; salt SELECT için normal `BEGIN READ ONLY` yeterli. Sequence/dış etki uyarısı aynen geçerli.
- **Rakipler:** DataGrip "Explain Plan" (yalnızca planlar) ve "Explain Analyse" ayrımı, ağaç, diyagram, flame graph (total/startup cost), ham plan [https://www.jetbrains.com/help/datagrip/query-execution-plan.html]. pgAdmin planı JSON olarak üretip grafik sekmesinde gösteriyor, SVG indirilebiliyor [https://www.pgadmin.org/docs/pgadmin4/latest/query_tool.html].
- **Saf modül:** `FORMAT JSON` çıktısı → düğüm ağacı; düğüm başına öz süre (toplam − çocuklar), tahmini/gerçek satır oranı ("Plan Rows" vs "Actual Rows" × "Actual Loops"), en pahalı düğüm vurgusu. JSON anahtar adları ("Node Type", "Actual Total Time" vb.) PG dokümanında tek tek listelenmiyor; fixture'lar gerçek sunucudan alınmalı (**anahtar listesi doğrulanmadı**). Arayüz önce basit girintili ağaç; flame graph sonra.

### 3.2 Oturum izleme: `pg_stat_activity` + iptal/sonlandırma + kilitler — M

- **Kaynak:** `pg_stat_activity` her sunucu süreci için `pid`, `usename`, `application_name`, `client_addr`, `state` (`active`, `idle`, `idle in transaction`, `idle in transaction (aborted)` …), `wait_event_type`/`wait_event`, `query` (varsayılan 1024 bayta kesilir), `backend_type`, `xact_start`, `query_start` veriyor. Sıradan kullanıcılar diğer rollerin oturumlarında birçok kolonu NULL görüyor; superuser ve `pg_read_all_stats` üyeleri hepsini görüyor [https://www.postgresql.org/docs/current/monitoring-stats.html]. `pg_cancel_backend(pid)` sorguyu iptal edip oturumu açık bırakıyor; `pg_terminate_backend(pid, timeout)` oturumu sonlandırıyor; yetki: superuser, oturum sahibinin rolüne üyelik ya da `pg_signal_backend` [https://www.postgresql.org/docs/current/functions-admin.html]. Kilit tarafı için `pg_locks` (`granted = false` bekleyen, `waitstart` bekleme başlangıcı) + `pg_blocking_pids` [https://www.postgresql.org/docs/current/view-pg-locks.html].
- **Rakip:** pgAdmin panosu oturumları, kilitleri ve hazırlanmış transaction'ları gösteriyor; Terminate/Cancel ikonları var, sonlandırmadan önce onay istiyor; 8.4'ten beri rol kontrolünü Postgres'e bırakıyor [pgAdmin dokümanı, arama özeti: https://www.pgadmin.org/docs/pgadmin4/latest/tabbed_browser.html — sayfa doğrudan okunmadı, **kısmen doğrulandı**].
- **Uygulanabilirlik:** Hedef başına bir "Oturumlar" paneli; sunucu ucu sorguyu çalıştırır, satırları döner. Tezgah'ın kendi oturumları `application_name = 'Tezgah'` ile işaretlenebilir. Saf modül: satırlar → gruplama (bekleyen/bekleten ağacı `pg_blocking_pids`'ten), yaş hesapları, "idle in transaction > N dk" vurgusu.
- **Kurallarla etkileşim (önemli):** `pg_terminate_backend` bir SELECT fonksiyonu olduğu için `default_transaction_read_only` tarafından engellenip engellenmediğini birincil kaynakta bulamadım (**doğrulanmadı**; read-only tanımı "geçici olmayan tablolara yazamaz" diyor [https://www.postgresql.org/docs/current/runtime-config-client.html], sinyal fonksiyonlarından bahsetmiyor). Engellenmiyorsa salt okunur prod'da da oturum öldürmek mümkün olur. Öneri: Tezgah prod'da İptal/Sonlandır düğmelerini Yazma kilidine bağlasın (🔒 iken pasif, 🔓 iken tek tık; ek onay yok — CLAUDE.md kuralına uygun, pgAdmin'in onay davranışından bilinçli olarak farklı).

### 3.3 COPY ile CSV içe/dışa aktarma — L

- **Kaynak:** `COPY … TO STDOUT` / `FROM STDIN` verileri istemci bağlantısı üzerinden taşıyor; formatlar `text`, `csv`, `binary`; `HEADER [MATCH]`, `FORCE_QUOTE`, `ON_ERROR {stop|ignore}`, `REJECT_LIMIT`, `LOG_VERBOSITY`. Sunucu dosyası/`PROGRAM` superuser ya da `pg_read_server_files`/`pg_write_server_files`/`pg_execute_server_program` gerektiriyor; STDIN/STDOUT için yalnızca tablo yetkisi (TO için SELECT, FROM için INSERT) [https://www.postgresql.org/docs/current/sql-copy.html]. `ON_ERROR ignore` ve `LOG_VERBOSITY` PG17 [https://www.postgresql.org/docs/release/17.0/], `REJECT_LIMIT` PG18 [https://www.postgresql.org/docs/release/18.0/].
- **Sürücü:** `pg-copy-streams` (sahibi `brianc`, node-postgres'in yazarı; `to()` Readable, `from()` Writable; 7.0.0, 2025-05-27) [https://github.com/brianc/node-pg-copy-streams].
- **Uygulanabilirlik:** Yalnızca STDIN/STDOUT kullanılmalı (sunucu dosyası yok — yerel araç, sunucu dosya sistemine erişmemeli). İçe aktarma Script çalıştırıcının Transaction modunda koşmalı: COPY FROM + sonda commit/rollback kararı, Karar süresi, Çalıştırma kaydı (satır verisi değil, satır sayısı). DataGrip'in içe aktarma diyaloğundaki kolon eşleme, "First row is header", yeni tablo için DDL önizlemesi ve "çevrilemeyen değeri NULL yaz" seçenekleri referans alınabilir [https://www.jetbrains.com/help/datagrip/import-data.html].
- **Saf modül:** CSV başlığı ↔ tablo kolonları eşleme, `COPY` komut metni üretimi (sürüme göre `ON_ERROR`/`REJECT_LIMIT`'in eklenip eklenmemesi).
- **Kurallar:** Salt okunur prod'da COPY FROM tabloyu değiştirdiği için reddedilir (read-only tanımından çıkarım [https://www.postgresql.org/docs/current/runtime-config-client.html]; COPY sayfası bunu ayrıca söylemiyor). COPY TO salt okunurda çalışmalı (**gerçek sunucuda doğrulanmadı**). Dosya seçimi tarayıcıdan yapılırsa dosya sunucuya yüklenir; yerel yol yazılırsa sunucu dosyayı okur — ikincisi `127.0.0.1` sunucusunun dosya sistemi erişimini genişletir, içe aktarmadaki "yalnızca belirli dosya adlarını okur" ilkesine benzer bir kısıt gerekir.

### 3.4 Nesne DDL'ini görüntüleme (salt okuma) — M

- **Kaynak:** `pg_get_viewdef`, `pg_get_functiondef` (tam `CREATE OR REPLACE FUNCTION/PROCEDURE`), `pg_get_indexdef`, `pg_get_constraintdef`, `pg_get_triggerdef`, `pg_get_ruledef`, `pg_get_expr`, `pg_get_partkeydef`, `pg_get_statisticsobjdef` var; bunlar "orijinal metin değil, yeniden kurulmuş" çıktı. **`pg_get_tabledef` yok**; tablo DDL'i `pg_attribute`/`format_type`/`pg_get_expr`/`pg_get_constraintdef`/`pg_get_indexdef`'ten toplanmalı [https://www.postgresql.org/docs/current/functions-info.html]. PG18'de `pg_get_acl()` eklendi [https://www.postgresql.org/docs/release/18.0/].
- **Uygulanabilirlik:** Veritabanı panelinde nesneye tıklayınca DDL sekmesi. View/fonksiyon/index için tek fonksiyon çağrısı (S); tablo için saf bir "katalog satırları → `CREATE TABLE`" kurucusu (M, tablo tabanlı testli). Deneme modunun DDL şema farkı zaten katalogdan kolon okuyor; ortak modül olabilir.
- **Kapsam notu:** Bu salt okuma; "şema tasarımı" kapsam dışılığıyla çelişmez. DDL'i düzenleyip göndermek (DataGrip'in yaptığı gibi [https://www.jetbrains.com/help/datagrip/schema-comparison-and-migration.html]) şema tasarımına kayar; önerilmiyor.

### 3.5 `pg_stat_statements` görünümü — M

- **Kaynak:** `shared_preload_libraries = 'pg_stat_statements'` + yeniden başlatma ve veritabanında `CREATE EXTENSION` gerekiyor; `compute_query_id` `auto`/`on` olmalı. Kolonlar: `calls`, `total_exec_time`, `mean_exec_time`, `rows`, `shared_blks_hit`/`read`. Diğer kullanıcıların sorgu metnini yalnızca superuser ve `pg_read_all_stats` görüyor; `pg_stat_statements_reset` varsayılan superuser [https://www.postgresql.org/docs/current/pgstatstatements.html].
- **Uygulanabilirlik:** Uzantı yoksa panel "kurulu değil" der, Tezgah kurmaz (kurmak sunucu yapılandırması değiştirir). En pahalı sorgudan tek tıkla EXPLAIN'e (3.1) geçiş iyi bir bağ.
- **Kurallar:** Okuma; `reset` bir yazma sayılmalı ve prod'da Yazma kilidine bağlanmalı.

### 3.6 LISTEN/NOTIFY paneli — M (düşük öncelik)

- **Kaynak:** `LISTEN` commit'te etkinleşir, oturum sonunda temizlenir; bildirimler yalnızca transaction'lar arasında teslim edilir; NOTIFY transaction içindeyse commit olmadan gitmez; payload varsayılan olarak 8000 bayttan kısa olmalı; `pg_notify(kanal, payload)` fonksiyon biçimi [https://www.postgresql.org/docs/current/sql-listen.html, https://www.postgresql.org/docs/current/sql-notify.html]. node-postgres `notification` olayı `msg.channel`, `msg.payload` veriyor [https://node-postgres.com/apis/client].
- **Uygulanabilirlik:** Pool dışında, kullanıcının açtığı ayrı ve uzun ömürlü bir client gerekir (pool'un 10 dk boşta kapanması dinlemeyi koparır). Tünel koparsa dinleme biter; ilk dilimdeki "otomatik yeniden bağlanma yok" ilkesine göre kullanıcıya gösterilmeli.
- **Kurallar:** Açılışta bağlanmaz (kullanıcı başlatır). `LISTEN` salt okunur transaction'da çalışır mı **doğrulanmadı**.

---

## 4. Kapsam dışı ama not edilmeye değer

- **Şema karşılaştırma / migration script üretimi:** DataGrip iki şemayı/tabloyu karşılaştırıp hedefi kaynağa eşitleyen düzenlenebilir bir script üretiyor [https://www.jetbrains.com/help/datagrip/schema-comparison-and-migration.html]. Şema tasarımına yakın; Tezgah'ın "migration benzeri script çalıştırma" odağıyla ilginç bir köprü ama kapsam dışı.
- **ER diyagramı, şema tasarımı, Postgres dışı DB'ler:** CLAUDE.md gereği önerilmedi.
- **SSH ProxyJump ve `~/.ssh/config` içe aktarma:** Spec dışı bırakılmış; araştırma `forwardOut` kanalının sonraki `Client`'a `sock` olarak verilmesiyle N atlamanın mümkün olduğunu ve `ssh-config` kütüphanesinde `matchExec: false` zorunluluğunu zaten bulmuş (`.scratch/ilk-dilim/issues/12-ssh-kutuphanesi.md`). Ayar şeması `jumps[]`'a hazır.
- **SQL biçimlendirici:** CodeMirror'ın yerleşik SQL formatter'ı yok (paket listesinde görünmüyor [https://codemirror.net/docs/ref/]); pgAdmin dokümanında da "Format SQL" yok [https://www.pgadmin.org/docs/pgadmin4/latest/query_tool.html]. Üçüncü taraf `sql-formatter` npm paketi bir seçenek (**doğrulanmadı**; PostgreSQL lehçesi ve dollar-quote davranışı denenmeli). Kendi lexer'ımızla yanlış biçimlendirme riski göz önüne alınmalı.
- **DBeaver tarzı "Production'da SQL çalıştırma onayı":** DBeaver `Production` tipinde auto-commit kapalı, SQL çalıştırma ve veri değişikliği onayı açık [https://dbeaver.com/docs/dbeaver/Connection-Types/]. Tezgah bunu **bilinçli olarak** reddetmiş (tek tık yazma, onay yok); karşılaştırma için not.
- **Makrolar / parametreli sorgular:** pgAdmin makroları `$SELECTION$` yer tutucusuyla tek tuşla kayıtlı SQL çalıştırıyor [https://www.pgadmin.org/docs/pgadmin4/latest/query_tool.html]; DataGrip parametre değerlerini hatırlayıp çalıştırmadan önce düzenletebiliyor [https://www.jetbrains.com/help/datagrip/query-execution.html]. `EXPLAIN (GENERIC_PLAN)` `$1` yer tutuculu sorguları planlayabiliyor [https://www.postgresql.org/docs/current/sql-explain.html]. Kişisel kullanımda düşük öncelik.
- **Beekeeper Studio / TablePlus:** Resmi dokümanlarını bu turda okumadım; bu araçlarla ilgili hiçbir iddia bu dosyada yok (**doğrulanmadı**).

---

## Önerilen sıra (özet)

| # | Öneri | Grup | Efor | Not |
|---|---|---|---|---|
| 1 | Sekmeli konsol + akışlı sonuç grid'i | Kapsam | L | `pg-cursor` / mevcut imleç; ADR-0002 modeli korunur |
| 2 | Şema bilen tamamlama | Kapsam | M | `lang-sql` `schema` hazır; iş katalog → nesne dönüştürücüsü |
| 3 | Çalıştırma kaydı göz atma (sorgu geçmişi) | Kapsam | S/M | core biçimi hazır |
| 4 | İmleçteki ifadeyi / seçimi çalıştır | Hızlı | S | `ifade-bolme` offset'leri hazır |
| 5 | `RAISE NOTICE` mesajları | Hızlı | S | pg `notice` olayı |
| 6 | Tablo görünümü (`reltuples = -1` durumu dahil) | Kapsam | M | |
| 7 | Düzenlenebilir grid → Script çalıştırıcı + Deneme farkı | Kapsam | L | en büyük yeniden kullanım fırsatı |
| 8 | EXPLAIN (JSON) ağacı; DML'de ANALYZE Deneme yoluyla | Büyük | M | ANALYZE ifadeyi çalıştırır |
| 9 | `pg_blocking_pids` göstergesi + oturum paneli | Kapsam/Büyük | S → M | prod'da İptal/Sonlandır Yazma kilidine bağlı |
| 10 | Sonuç dışa aktarma (CSV/MD/INSERT), sonra COPY | Hızlı → Büyük | S → L | |

## Comments
