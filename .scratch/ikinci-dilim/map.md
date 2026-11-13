# Harita: İkinci dilim (kapsamdaki eksikler: konsol, geçmiş, tamamlama, tablo görünümü, grid, ALTER, bekletme göstergesi)

Label: wayfinder:map

## Destination

[Araştırma](../oneriler/arastirma.md) 1. bölümündeki yedi madde (1.1–1.7) için `/to-spec`'e verilebilecek kadar netleşmiş kararlar: tek bir `spec.md`, ardından 1.1→1.7 sırasıyla numaralı uygulama ticket'ları. Uygulama kodu bu haritanın çıktısı değildir.

## Notes

- Kişisel proje, tek geliştirici. Bağlam ve değişmez kurallar: `CLAUDE.md`. Terimler: `GLOSSARY.md`. ADR'ler: `docs/adr/` (bu dilim: 0003, 0004).
- İlk dilimin kararları geçerlidir: [ilk-dilim/map.md](../ilk-dilim/map.md). Özellikle ADR-0002 (tek client, kopmada rollback) ve prod kuralları değişmeden genişler.
- Kaynak grilling oturumu: 2026-11-09 (Q1–Q25).
- Araştırmanın 2. (hızlı kazanımlar), 3. ve 4. bölümleri bu dilimin kapsamı dışında.

## Decisions so far

### Süreç
- Tek harita, kararlar önce; uygulama ticket'ları araştırma başlık sırasıyla 1.1→1.7 (Q1, Q2).

### 1.1 Sekmeli konsol + sonuç grid'i
- **Konsol = sekmeli Script editörü** (Q3, ADR-0003): ayrı bir konsol modeli yok. Her sekme bugünkü editördür: kendi hedefi, Yazma kilidi, Çalıştırma modu, karar kartı, deneme modu.
- **Sekmeler kalıcı** (Q4): metin + hedef (bağlantı id, veritabanı, şema) OS yapılandırma dizininde `tezgah.json` dışında (ör. `konsol/`) saklanır; açılışta geri gelir, **bağlanmaz**.
- **Okuma modu** (Q5, ADR-0004): tüm ifadeler `SELECT`/`TABLE`/`VALUES`/`SHOW`/ANALYZE'sız `EXPLAIN`/DML'siz `WITH` ise mod içerikten Okuma çıkar (ortam etiketinden bağımsız). `BEGIN READ ONLY`, karar kartı yok; transaction sonuç imleçleri açıkken yaşar, yeniden çalıştırma/sekme kapama/soket kopması/Karar süresiyle rollback. `25006`'da "Transaction modunda çalıştır" düğmesi. Saf mantık `calistirma-modu`'nda.
- **Daha fazla satır** (Q6): `WITHOUT HOLD` imleç; transaction açıkken (karar beklerken veya Okuma'da) kaydırdıkça `FETCH 500`, ilk sayfa da 500. Commit/rollback sonrası yüklenenler kalır, "daha fazla" kapanır ve bu belirtilir. `WITH HOLD` reddedildi.
- **Sonuç sekmeleri** (Q7): her SELECT editörün altında kendi sonuç sekmesi; yeniden çalıştırmada eskiler silinir; sabitleme kapsam dışı. Sağ sütun (karar kartı + zaman çizelgesi) aynen.
- **Pool** (Q8): `MAX_CLIENTS` 3 → 5; aşılınca kuyruk yok, hemen "Bu hedefte N açık oturum var: Sekme X, Y…" hatası (sekmelere bağlantı). Katalog ve izleme sorguları kısa süreli client kullanır.
- **Yazma kilidi** (Q9): sekme + hedef başına; hedef değişince kapanır; diske yazılmaz, geri gelen sekmede hep kapalı.

### 1.2 Sorgu geçmişi
- (Q10) Konsolda açılır/kapanır yan panel, Ctrl+Alt+E / Cmd+Alt+E. Varsayılan filtre aktif sekmenin hedefi; tüm hedefler, metin araması, sonuç (başarılı/hata/deneme/rollback), tarih aralığı. Çift tık → kaydın metni **yeni sekmede, kaydın hedefiyle**. Sunucu: aylık JSONL'leri yeniden eskiye okuyan sayfalı `GET /api/calistirma-kayitlari`.

### 1.3 Şema bilen tamamlama
- (Q12) Katalog yalnızca bu oturumda kullanıcı eliyle hedef seçince (panel / Ctrl+K) veya sekme ilk çalıştırılınca yüklenir; geri gelen sekmeler kendiliğinden okumaz. İçerik: Veritabanı seçiminde görünür şemaların tablo/view/matview + kolonları (tipli); fonksiyonlar yok. Sunucu belleğinde hedef başına önbellek; DDL içeren script commit/autocommit ile bitince yenilenir, ayrıca "↻". `defaultSchema` = `current_schemas(false)[1]`. Motor `@codemirror/lang-sql` `schema`; iş katalog → `SQLNamespace` saf dönüştürücüsü.

### Grid altyapısı
- (Q11) [01 Grid kütüphanesi seçimi](issues/01-grid-kutuphanesi.md): kendi DOM grid'imiz + `@tanstack/react-virtual`; seçim/gezinme/TSV/bekleyen değişiklikler `src/core/grid`'de saf. Yedek `react-data-grid`; AG Grid (aralık seçimi/pano Enterprise), Glide (React 19 yok, canvas test edilemez) elendi.

- [Grid davranış ayrıntıları](issues/02-grid-davranis-ayrintilari.md): Ctrl+C başlıksız TSV (NULL boş), sağ tıkta "INSERT olarak kopyala"; Tablo sekmesinde çok hücreli TSV yapıştırma (boş → NULL, taşan satır → yeni satır, taşan/salt okunur kolon → red); tek satır kırpma + `↵`, tooltip yok; tek `<textarea>` düzenleyici (Enter kaydet/aşağı, Shift+Enter yeni satır); sert sınır 100.000 satır; yalnızca satır sanallaştırması.

### 1.4 Tablo görünümü
- (Q13) Tablo açma: veritabanı panelinde şema çipine tıklayınca o şemanın tablo listesi (filtre kutulu) + Ctrl+K'da tablo araması; ikisi de katalog önbelleğinden.
- (Q14) Editörsüz **Tablo sekmesi**: başlıkta `≈ N satır` (`reltuples = -1` → "≈ bilinmiyor"), filtre/sıralama çubuğu, grid. Diske yazılır (hedef + tablo + filtre), açılışta bağlanmaz. Her sayfa kısa ayrı sorgu; uzun imleç/transaction yok (prod'da vacuum ufku tutulmaz).
- (Q15) Serbest `WHERE` ve `ORDER BY` kutuları (tamamlamalı); extended protocol ile tek ifade; her ortamda `BEGIN READ ONLY`. Kolon başlığına tık → ORDER BY dolar. Kolon başına filtre arayüzü reddedildi.
- (Q16) Sıralama PK'ya göre (varsayılan) ve PK varsa keyset `WHERE (pk) > ($son) ORDER BY pk LIMIT 500`; aksi hâlde `LIMIT 500 OFFSET n`, sayfalar arası tutarlılık garanti değil notuyla. SQL üretimi `src/core`'da saf.

### 1.5 Düzenlenebilir grid
- (Q18) Yalnızca Tablo sekmesinde; konsol sonuçları salt okunur; PK'sız tabloda kapalı.
- (Q19) Sağ sütunda sürekli bekleyen değişiklikler + üretilen SQL önizlemesi. **Uygula** = üretilen script mevcut Script çalıştırıcıyla Transaction modunda bu sekmede (karar kartı, Karar süresi, Çalıştırma kaydı). **Dene** (Deneme modu, PG18 farkı) ve **Konsola aktar** (yeni konsol sekmesi). Ek onay yok. Prod'da 🔒 iken Uygula devre dışı + yanında tek tık Yazma kilidi; Dene kullanılabilir.
- (Q20) `UPDATE` yalnızca değişen kolonlar, `WHERE` tüm PK kolonları (orijinal değerler yok). Değerler **literal** `'…'::tip` (önizleme = kayıt = konsola aktarılan). Her ifade **tam 1 satır** etkilemeli; değilse hata, durma, satır işareti, "satır değişmiş ya da silinmiş" (Script çalıştırıcıya "beklenen satır sayısı" seçeneği). Sıra DELETE → UPDATE → INSERT; aynı hücreye çoklu düzenleme birleşir; eklenip silinen satır SQL üretmez.
- (Q21) Tüm tipler metin kutusu (json/dizi ham metin, dönüşüm Postgres'te). NULL ≠ boş metin; NULL için Ctrl/Cmd+Shift+N veya sağ tık. Yeni satırda dokunulmayan kolonlar INSERT'te yok (DEFAULT). `bytea` ve generated kolonlar salt okunur. Commit → sayfa yeniden çekilir, bekleyenler temizlenir; rollback/hata → bekleyenler kalır. Bekleyenler diske yazılmaz; varken sekme kapatılırsa uyarı.

### 1.6 ALTER TABLE kolon ekleme
- (Q22) Tablo sekmesi başlığında "+ Kolon": ad, tip (yaygın + katalog tipleri, tamamlamalı), NULL/NOT NULL, varsayılan ifade. Canlı `ALTER TABLE "s"."t" ADD COLUMN …` önizlemesi. Uygula/Dene/Konsola aktar Q19 ile aynı; Dene DDL şema farkı gösterir. Engellemeyen lint: volatile varsayılan (`pg_proc.provolatile`) → tablo yeniden yazılır; boş olmayan tabloda varsayılansız NOT NULL → hata verecek. Kolon silme/adlandırma/tip değiştirme kapsam dışı.

### 1.7 "Bekletiyorsun" göstergesi
- (Q17) Transaction'da karar beklerken ve Okuma'da transaction açıkken, ayrı kısa süreli pool client'ı 5 sn'de bir `pg_stat_activity` + `$1 = ANY(pg_blocking_pids(pid))` (pid, usename, application_name, wait_event_type, `left(query,200)`, süre). Karar kartında "⚠ N oturumu bekletiyorsun", üzerine gelince liste; yetkiden NULL gelenler "görünmüyor". İptal/sonlandırma yok (araştırma 3.2).

### Doküman
- (Q23) ADR-0003 (konsol = sekmeli Script editörü), ADR-0004 (Okuma modu). Literal SQL ve "tam 1 satır" spec'te.
- (Q24) GLOSSARY: Sekme, Okuma modu (Çalıştırma modu içinde), Tablo sekmesi, Bekleyen değişiklik, Katalog önbelleği; Yazma kilidi "sekme ve hedef başına".

## Not yet specified

(Boş. Tüm ticket'lar çözüldü; sıradaki adım `/to-spec`.)

## Out of scope

- Araştırma 2., 3., 4. bölümleri (imleçteki ifadeyi çalıştır, `RAISE NOTICE`, dışa aktarma, EXPLAIN, oturum paneli vb.).
- Sonuç sekmesi sabitleme; konsol sonuçlarını düzenleme; tamamlamada fonksiyonlar.
- Kolon silme / yeniden adlandırma / tip değiştirme; `bytea` düzenleme.
- Bekletilen oturumları iptal/sonlandırma.
- Grid: CSV olarak / başlıklarla kopyalama, doldurma, değer paneli, kolon sanallaştırması ([Grid davranış ayrıntıları](issues/02-grid-davranis-ayrintilari.md)).
