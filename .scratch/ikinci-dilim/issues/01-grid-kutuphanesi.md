# Grid kütüphanesi seçimi

Type: research
Status: resolved
Blocked by: —

## Question

Konsol sonuçları (1.1), Tablo sekmesi (1.4) ve düzenlenebilir grid (1.5) için ortak grid bileşeni hangi temelle kurulmalı? Adaylar: kendi DOM tablomuz + `@tanstack/react-virtual`, Glide Data Grid (canvas), AG Grid Community; araştırma sırasında öne çıkan başka aday varsa o da.

Gereksinimler (bkz. [map](../map.md)):
- 100 bin+ satırı sanallaştırarak gösterme; sona sayfa ekleme (`FETCH 500` / keyset sayfaları), toplam satır sayısı bilinmeden.
- Hücre düzenleme (metin kutusu), NULL ile boş metni ayırt etme, satır ekleme/silme işaretleri, değişen hücre vurgusu.
- Klavyeyle gezinme, aralık seçimi ve panoya kopyalama.
- `RAW_TYPES` ile gelen ham metni olduğu gibi gösterme; geniş kolonlar, kolon genişliği ayarı.
- Açık/koyu tema; React 18/19 uyumu.

Karar için gereken olgular (birincil kaynaklardan):
- Lisans (MIT/ücretsiz kapsam; AG Grid Community'de aralık seçimi gibi özellikler Enterprise mı?), bakım durumu, son sürüm, paket boyutu.
- Yukarıdaki her gereksinim kutudan mı, eklentiyle mi, kendimiz mi yazıyoruz?
- Test edilebilirlik: jsdom / Testing Library ile hücre düzenleme testi yazılabiliyor mu (canvas tabanlı çözümlerde zorluk)?
- Erişilebilirlik (ARIA grid rolleri).

## Answer

Bulgular: `research/grid-kutuphanesi` dalı, `research/grid-kutuphanesi.md` (origin'e push'landı, merge edilmez).

- **Karar: kendi DOM grid'imiz + `@tanstack/react-virtual` (^3.14.26, MIT, ~10 KB gzip).** Ön eğilim doğrulandı. NULL ≠ '', Ctrl/Cmd+Shift+N, eklendi/silindi/değişti işaretleri ve toplam bilinmeden sona sayfa ekleme hiçbir adayda kutudan gelmiyor; hangi aday seçilirse seçilsin bunlar bizim kodumuz. Seçim modeli, klavye gezinme, TSV üretimi ve bekleyen değişiklik deposu `src/core/grid` altında saf modüller, birim testli.
- **Yedek: `react-data-grid` 7.0.0-beta.64** (MIT, DOM, React ^19.2; `role="grid"`, metin editörü, gezinme, kolon boyutlandırma kutudan; aralık seçimi yok, `latest` hâlâ beta → kullanılırsa sürüm tam sabitlenir).
- Reddedilenler: **AG Grid Community 36.3.0** (Cell Selection ve Clipboard Enterprise; ~390 KB gzip; jsdom için resmi öneri e2e), **Glide Data Grid** (kararlı 6.0.3 2024-02'den beri, peer React ≤18 → ERESOLVE; canvas → Testing Library ile düzenleme testi yok), **Handsontable** (ticari olmayan lisans kişisel/değerlendirme; npm'de MIT dağıtımla uyumsuz), **RevoGrid** (Web Component/Stencil, küçük topluluk, ~64 KB gzip), **TanStack Table** (sıralama/filtre sunucuda; gereksiz katman).
- Test: jsdom'da 0 yükseklik sorunu `initialRect` (veya enjekte `observeElementRect`) ile çözülür; sabit satır yüksekliği → ölçüm yok. Düzenleme, NULL kısayolu ve pano testleri `user-event` ile.
- Erişilebilirlik: `role="grid"`, toplam bilinmezken `aria-rowcount="-1"`, satırda `aria-rowindex`, hücrede `aria-colindex`/`aria-selected`, roving tabindex.
- Riskler: aralık seçimi/gezinme/kopyalama/kolon boyutlandırma bizim kodumuz (iş yükü); odaklı hücre kaydırmayla DOM'dan çıkınca odak kaybı; çok büyük satır sayılarında tarayıcı öğe yüksekliği sınırı (kesin değer doğrulanmadı); sona eklemede bellek büyümesi.
- Açılan sorular → [02 Grid davranış ayrıntıları](02-grid-davranis-ayrintilari.md).
