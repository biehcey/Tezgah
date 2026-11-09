# Araştırma: Grid kütüphanesi seçimi

Tarih: 2026-11-09 · Bilet: "Grid kütüphanesi seçimi"

**Soru:** Konsol sonuçları (1.1), Tablo sekmesi (1.4) ve düzenlenebilir grid (1.5) ortak bir grid bileşeni kullanacak. Bu bileşen hangi temel üzerine kurulmalı: kendi DOM tablomuz + `@tanstack/react-virtual`, Glide Data Grid (canvas), AG Grid Community, yoksa başka bir aday mı?

Projedeki durum (`package.json`, `vitest.config.ts`): React `^19.3.1`, Vite 8, Vitest 5. `web` test projesi `jsdom` ortamında çalışıyor ve `@testing-library/react` 16 + `user-event` 14 + `jest-dom` kullanıyor. Paket yöneticisi npm (`package-lock.json`). Tema, `styles.css`'te `prefers-color-scheme` ile değişen CSS değişkenleri (`--zemin`, `--cizgi`, `--vurgu`…) üzerinden yönetiliyor. Sunucu tüm değerleri `RAW_TYPES` ile ham metin olarak döndürüyor (`string | null`).

## Kısa cevap

**Kendi DOM grid'imiz + `@tanstack/react-virtual` (^3.14.26, MIT).** Bunun üç nedeni var:

1. Gereksinimlerin büyük kısmı zaten Tezgah'a özgü: NULL ≠ boş metin, Ctrl/Cmd+Shift+N, bekleyen değişiklik/eklendi/silindi işaretleri, salt okunur kolonlar, sona sayfa ekleme. Bunlar hiçbir adayda kutudan gelmiyor. Hepsinde ya özel renderer ya da kendi state'imiz gerekiyor.
2. Hazır grid'lerin bize gerçekten kazandıracağı iki şey, yani **aralık seçimi ve panoya kopyalama**, AG Grid'de Enterprise'a ait. react-data-grid'de aralık seçimi yok. Glide'da ikisi de var ama Glide canvas tabanlı ve kararlı sürümü React 19'u desteklemiyor.
3. DOM tabanlı çözüm jsdom + Testing Library ile doğrudan test edilebiliyor. TanStack Virtual'ın `initialRect` seçeneği jsdom'daki 0 yükseklik sorununu tek satırla çözüyor. Paket ~10 KB gzip.

Bu yolun bedeli şu: klavye gezinme, aralık seçimi, kopyalama ve kolon genişliği ayarı kendimiz yazılacak. Bunların saf mantık kısmı (seçim modeli, TSV üretimi, gezinme) `src/core` altında UI'dan bağımsız tutulup birim testiyle doğrulanabiliyor. Bu, CLAUDE.md'deki çalışma şekliyle uyumlu.

**Yedek aday:** `react-data-grid` 7 (MIT, DOM, `role="grid"`, metin editörü, klavye gezinme, kolon boyutlandırma, açık/koyu tema kutudan geliyor). Aralık seçimi yok ve paket hâlâ `7.0.0-beta.*`. Kendi grid'imizde aralık seçimi beklenenden pahalı çıkarsa ve aralık seçiminden vazgeçilirse ikinci seçenek bu olur.

## Adaylar: temel olgular

Veriler npm registry (`registry.npmjs.org/<paket>`), npm downloads API (2026-11-02 – 2026-11-08), GitHub REST API (`/repos/<owner>/<repo>`) ve bundlephobia (`bundlephobia.com/api/size`) üzerinden 2026-11-09'da alındı.

| Paket | Son sürüm (tarih) | Lisans | React peer | npm unpacked | min / gzip (bundlephobia) | Haftalık indirme | Repo |
|---|---|---|---|---|---|---|---|
| `@tanstack/react-virtual` (+ `virtual-core` 3.19.11) | 3.14.26 (2026-11-03) | MIT | `^16.8 … ^19.0` | 62 KB (+core 645 KB, kaynak haritası dahil) | 34,7 KB / **10,3 KB** | ~42,4 M | `TanStack/virtual`, 7,2 B yıldız, son push 2026-11-08 |
| `react-data-grid` | 7.0.0-beta.64 (2026-11-05), `latest` etiketi beta | MIT (LICENSE: "The MIT License (MIT)") | `^19.2` | 697 KB | 72,1 KB / **26,7 KB** | ~778 B | `Comcast/react-data-grid`, 7,7 B yıldız, son push 2026-11-09 |
| `@glideapps/glide-data-grid` | 6.0.3 (**2024-02-03**); 6.0.4-alpha24 (2025-10-08) | MIT | 6.0.3: `^16.12 … 18.x` (**19 yok**); alpha: `… 19.x` | 3,58 MB | 189 KB / **63,8 KB** (+ `lodash`, `marked`, `react-responsive-carousel` peer) | ~762 B | `glideapps/glide-data-grid`, 5,4 B yıldız, son push 2026-11-05 |
| `ag-grid-community` + `ag-grid-react` | 36.3.0 (2026-11-04) | MIT (Community); Enterprise ticari | `^16.8 … ^19.0` | 21,4 MB + 862 KB | community 1,44 MB / **392 KB**; react 744 KB / 209 KB | ~5,7 M / ~4,3 M | `ag-grid/ag-grid`, 15,7 B yıldız |
| `@tanstack/react-table` | 9.3.1 (2026-10-12) | MIT | `>=18` | 120 KB | — | ~35,5 M | `TanStack/table`, 28,6 B yıldız |
| `@revolist/revogrid` + `@revolist/react-datagrid` | 4.31.4 (2026-11-04) | MIT (çekirdek); Pro ticari | (Web Component) | 7,45 MB | 192 KB / **64 KB** | ~62 B | `revolist/revogrid`, 3,5 B yıldız |
| `handsontable` + `@handsontable/react-wrapper` | 18.1.2 (2026-10-07) | "SEE LICENSE IN LICENSE.txt" (ikili lisans) | — | 33,8 MB | 1,47 MB / **343 KB** | ~363 B | `handsontable/handsontable`, 22 B yıldız |

Notlar:

- **Glide:** `latest` (6.0.3) 21 aydır güncellenmedi. React 19 desteği yalnızca `6.0.4-alpha*` sürümlerinde var. Projede React 19.3 olduğu için `npm install @glideapps/glide-data-grid` peer çakışmasına (ERESOLVE) düşer; `--legacy-peer-deps` ya da alpha sürüm gerekir. README'de "React 16-19" yazıyor ama yayımlanmış kararlı paket bununla çelişiyor.
- **react-data-grid:** `latest` dist-tag'i bir beta (`7.0.0-beta.64`); v7 yıllardır beta olarak yayımlanıyor. Sık sürüm çıkıyor ama beta'lar arasında kırıcı değişiklik olabilir. Tam sürüm sabitlenmeli (`7.0.0-beta.64`, `^` olmadan). React `^19.2` zorunluluğu bizim için sorun değil.
- **AG Grid:** Bundlephobia rakamı paketin tamamını ölçüyor. Modül kaydı (`ModuleRegistry`) ile küçültülebiliyor ama yine de diğer adaylardan bir mertebe büyük.

## Lisans ve ücretsiz kapsam

- **AG Grid Community:** Aralık seçimi ("Range Selection" / Cell Selection) ve panoya kopyalama ("Clipboard Operations") **Enterprise**. Cell Selection sayfasının metadata'sında `enterprise: true` var ve örnekler `CellSelectionModule`'ü `ag-grid-enterprise`'tan alıyor. Clipboard sayfası: "Copying from the grid is enabled by default for enterprise users." Community'de yalnızca `enableCellTextSelection=true` ile tarayıcının kendi metin seçimi kullanılabiliyor; bu, hücre aralığı kopyalama değil. Lisanssız Enterprise "a watermark and an error message in the console" gösteriyor. Sanallaştırma, klavye gezinme ve ARIA Community'de var. **Infinite Row Model Community'de var:** "AG Grid Enterprise is not required for infinite scrolling". `lastRow` `-1`/`undefined` verildiğinde toplam bilinmeden scroll uzayabiliyor. Bu bizim `FETCH 500` modelimize uyuyor.
- **Handsontable:** İkili lisans. Ticari olmayan lisans yalnızca "strictly personal or solely for evaluation purposes" kullanım için geçerli. Tezgah npm'de `tezgah-db` adıyla MIT lisansıyla dağıtılıyor (`package.json` `license: "MIT"`). Ticari olmayan bir bileşeni bağımlılık olarak paketlemek, MIT olarak yayımlanan bir paketle uyumlu değil. **Bu nedenle elendi.**
- **RevoGrid:** Çekirdek MIT. Çekirdekte aralık seçimi ve kopyala/yapıştır var (readme: "Range Operations: Selection", "Seamless copy/paste from Excel…"). Multi-range, undo/redo (History) ve JSON clipboard ise **Pro**.
- **Glide, react-data-grid, TanStack:** MIT, ücretli katman yok.

## Aday × gereksinim

K = kutudan geliyor · E = eklenti/yapılandırma ya da az kod · Y = kendimiz yazıyoruz · ✗ = yok veya lisans gerektiriyor

| Gereksinim | Kendi DOM + `react-virtual` | `react-data-grid` 7 | Glide 6 (canvas) | AG Grid Community 36 |
|---|---|---|---|---|
| 100 bin+ satır sanallaştırma | K (satır + kolon, `horizontal`) | K ("columns and rows outside the viewport are not rendered") | K (canvas, "millions of rows") | K ("Column and row virtualization enabled by default") |
| Toplam bilinmeden sona sayfa ekleme | Y (son sanal öğe görününce sonraki sayfa; basit) | Y (`onScroll` ile) | E (`onVisibleRegionChanged`) | K (Infinite Row Model, `lastRow: -1`) |
| Metin kutusu ile düzenleme | Y (`<input>`/`<textarea>`) | K (`renderTextEditor`) | K (`onCellEdited`) | K |
| NULL ≠ boş metin, Cmd/Ctrl+Shift+N | Y | Y (özel renderer + editör) | Y (özel hücre çizimi + kısayol) | Y (özel renderer/editör) |
| Eklendi/silindi işareti, değişen hücre vurgusu | Y (sınıf adı) | E (`rowClass`, `cellClass`) | E (`getRowThemeOverride`, hücre teması) | E (`rowClassRules`, `cellClassRules`) |
| bytea / generated kolonlar salt okunur | Y | E (kolon başına `editable`) | E (`readonly`/`allowOverlay`) | E (`editable`) |
| Klavyeyle gezinme | Y | K (oklar, Tab, Home/End, Ctrl+Home/End, PgUp/PgDn) | K (`keybindings`) | K |
| Aralık seçimi | Y | **✗** (yalnızca tek hücre ve satır seçimi) | K (`rangeSelect: "rect"`) | **✗ (Enterprise)** |
| Panoya kopyalama | Y (TSV; Clipboard API) | E (`onCellCopy`, yalnızca tek hücre) | K (`getCellsForSelection`) | **✗ (Enterprise)** |
| Ham metin gösterme (string\|null) | K (ne verirsek o) | K | E (her hücre `GridCellKind.Text`) | K |
| Geniş kolon, kolon genişliği ayarı | Y (başlıkta sürükleme tutamacı) | K (`resizable`, Ctrl+←/→) | E (`onColumnResize`, genişliği biz uyguluyoruz) | K |
| Açık/koyu tema | K (mevcut CSS değişkenleri) | K (`color-scheme`, `--rdg-*` değişkenleri) | E (JS `theme` nesnesi; CSS değişkenini kendimiz okuyup vermeliyiz) | E (tema API'si; dark ayarı) |
| React 19 | K | K (`^19.2`) | **✗ kararlı sürümde** (yalnızca alpha) | K |
| jsdom + Testing Library ile düzenleme testi | K (`initialRect`) | K (rol/isimle sorgu; README önerisi) | **✗** (hücreler DOM'da yok) | Kısmen (resmi doküman e2e öneriyor) |
| ARIA grid | Y (`role="grid"`, `aria-rowcount=-1`, `aria-rowindex`) | K (`role="grid"` varsayılan) | Kısmen (FAQ: "Yes" ama "likely flaws") | K ("ARIA support and keyboard navigation") |
| gzip boyut | ~10 KB | ~27 KB | ~64 KB + peer'lar | ~390 KB+ |

Özet: Satırlardaki **Y** işaretlerinin çoğu (NULL, işaretler, Tezgah kısayolları) hangi adayı seçersek seçelim yazılacak. Hazır grid'lerin sağladığı net kazanç klavye gezinme, kolon boyutlandırma ve (Glide'da) aralık seçimi + kopyalama ile sınırlı.

## Elenen adaylar

- **AG Grid Community:** İhtiyacımız olan iki "zor" özellik (aralık seçimi, clipboard) Enterprise. Paket ~390 KB gzip; bu, `npx` ile dağıtılan yerel bir araç için en ağır seçenek. Kendi CSS/tema sistemi, mevcut CSS değişkenlerimizle iki ayrı tema kaynağı oluşturur. Resmi test dokümanı jsdom için "No support for CSS layout - impacts column / row virtualisation" diyor ve e2e testi öneriyor. Infinite Row Model güzel bir uyum olsa da bu tek başına yetmiyor.
- **Glide Data Grid:** Canvas tabanlı; hücre içerikleri DOM'da yok, bu yüzden `getByRole('gridcell')` / `user.type` ile düzenleme testi yazılamıyor. jsdom'da canvas yok, ek mock gerekiyor. Kararlı sürüm (6.0.3, 2024-02) React 19'u peer olarak kabul etmiyor. `lodash`, `marked`, `react-responsive-carousel` gibi bize gereksiz peer bağımlılıklar istiyor. Tema JS nesnesiyle verildiği için CSS değişkenlerine bağlanması dolaylı. Aralık seçimi ve kopyalama kutudan gelse de, test edilebilirlik ve bakım riski bu kazancı geçiyor.
- **Handsontable:** Lisans (ticari olmayan lisans yalnızca kişisel kullanım/değerlendirme içindir; MIT dağıtımla uyumsuz), ~343 KB gzip. Elektronik tablo (spreadsheet) odaklı.
- **RevoGrid:** StencilJS ile yazılmış bir Web Component; React'e sarmalayıcıyla geliyor. Çekirdekte aralık seçimi ve kopyalama var, bu güçlü yanı. Ancak kullanıcı tabanı küçük (~62 B/hafta), React sarmalayıcısı ayrı bir repo, ~64 KB gzip. Web Component'in jsdom'daki davranışı (custom elements, shadow DOM) ve CSS değişkenlerimizle tema uyumu ayrıca doğrulanmalı. Avantajı, kendi aralık seçimimizi yazma maliyetini haklı çıkaracak kadar büyük değil.
- **TanStack Table:** Headless bir tablo state'i (sıralama, filtreleme, kolon boyutlandırma state'i) sunuyor. Ancak Tezgah'ta sıralama ve filtreleme sunucu tarafında (SQL) yapılacak, veriler ham metin. Tek işe yarar parçası kolon genişliği state'i olurdu, bu da birkaç satırlık kod. v9 sürümü yeni (React `>=18`). Eklemek gereksiz bir soyutlama katmanı getirir. Gerekirse sonradan eklenebilir; `react-virtual` ile resmi olarak birlikte kullanılabiliyor.

## Test edilebilirlik

- **Sanallaştırmanın jsdom'daki 0 yükseklik sorunu:** jsdom layout hesaplamıyor. Scroll elemanının `getBoundingClientRect`/`offsetHeight` değerleri 0 dönüyor, bu yüzden virtualizer hiç satır render etmiyor. `@tanstack/virtual-core` 3.19.11 `index.d.ts` iki çıkış sunuyor: `initialRect?: Rect` ve `observeElementRect` (enjekte edilebilir). Grid bileşeni bu iki seçeneği prop olarak dışarı açarsa, testte `initialRect={{ width: 1000, height: 600 }}` verilir ve ResizeObserver'a gerek kalmaz. Alternatif olarak `setup.ts`'te `HTMLElement.prototype.getBoundingClientRect` mock'lanabilir, ama prop yolu daha yerel ve açık. Satır yüksekliği sabit tutulursa (`estimateSize` = sabit, `measureElement` kullanılmaz) jsdom'da ölçüm gerekmez.
- **Düzenleme testi:** DOM grid'de hücreler gerçek `role="gridcell"` öğeleri. `user.dblClick(cell)` → `user.type(textbox, 'x')` → `user.keyboard('{Enter}')` → bekleyen değişiklik listesinin kontrolü doğrudan yazılabiliyor. Ctrl/Cmd+Shift+N → NULL testi de `user.keyboard` ile yapılıyor.
- **Pano:** `user-event` 14'te `userEvent.setup()` sahte bir `navigator.clipboard` kuruyor. Kopyalama testi `navigator.clipboard.readText()` ile doğrulanabilir. TSV üretimi zaten `src/core`'da saf fonksiyon olarak test edilecek.
- **react-data-grid** da DOM tabanlı ve README "querying the grid by its `role` and `name`" öneriyor; aynı teknik geçerli. Ancak iç sanallaştırması jsdom'da 0 yükseklik görür. Testlerde `enableVirtualization={false}` kullanmak gerekir.
- **Glide:** Canvas, jsdom'da yok (`HTMLCanvasElement.getContext` `null` döner / uygulanmamış). Hücre metni çizildiği için Testing Library ile sorgulanamıyor; test ancak `onCellEdited` gibi callback'leri doğrudan tetikleyerek veya e2e ile yapılabilir.
- **AG Grid:** Resmi test sayfası `setupAgTestIds()` ve bir `innerText` polyfill'i öneriyor. jsdom'da sanallaştırmanın tarayıcıdan farklı davranacağını belirtip e2e (Playwright/Cypress) öneriyor.

## Erişilebilirlik

- WAI-ARIA 1.2 `aria-rowcount`: "If the total number of rows is unknown, authors MUST set the value of aria-rowcount to -1". Satırların yalnızca bir kısmı DOM'dayken her satıra `aria-rowindex` verilmesi gerekiyor. Sona sayfa ekleme modelimizde (toplam bilinmiyor) bu birebir uygulanmalı: son sayfa gelene kadar `-1`, gelince gerçek sayı.
- Kendi grid'imizde öneri: kapsayıcıda `role="grid"` + `aria-label`, satırlarda `role="row"` + `aria-rowindex`, hücrelerde `role="gridcell"`/`columnheader` + `aria-colindex` (kolon sanallaştırması varsa `aria-colcount`), salt okunur grid'de `aria-readonly="true"`, seçili hücrelerde `aria-selected`. Odak tek bir hücrede tutulur (roving tabindex ya da `aria-activedescendant`); bu, WAI-ARIA APG "Grid" deseniyle uyumlu.
- Testing Library'nin `getByRole('gridcell', { name })` sorguları bu rollere dayanıyor. Dolayısıyla a11y ile test edilebilirlik aynı işi görüyor.

## Öneri

1. **Bağımlılık:** `@tanstack/react-virtual@^3.14.26` (devDependency; diğer web bağımlılıkları gibi Vite build'e gömülüyor).
2. **Katmanlar:**
   - `src/core/grid/` (saf, birim testli): seçim modeli (aktif hücre, dikdörtgen aralık, Shift+ok genişletme), klavye gezinme indirgeyicisi, aralık → TSV (NULL'ın panoya nasıl yazılacağı ayrı bir karar, bkz. açık sorular), bekleyen değişiklik deposu (hücre değişikliği / eklenen satır / silinen satır; NULL ve `''` ayrı değerler). 1.5'teki SQL üretimi zaten bu depodan beslenecek.
   - `src/web/grid/Grid.tsx`: Sanallaştırılmış DOM, salt okunur mod (konsol, 1.1) ve düzenlenebilir mod (Tablo sekmesi, 1.4/1.5). Props: `columns`, `rows: (string|null)[][]`, `onNeedMore()` (son sanal satır görününce), `hasMore`, düzenleme modunda `pending` ve geri çağrılar, test için `initialRect`.
3. **Sanallaştırma:** Satırlar sabit yükseklikte (ham metin tek satıra kırpılır, `text-overflow: ellipsis`; tam değer hücre editöründe veya ayrı bir panelde). Kolonlar için ikinci bir `horizontal` virtualizer ancak kolon sayısı büyükse (ör. >50) gerekir. İlk sürümde yalnızca satır sanallaştırması yeterli olabilir.
4. **Tema:** Mevcut `styles.css` değişkenleri (`--cizgi`, `--secili`, `--vurgu`, `--basarili`, `--uyari`) doğrudan kullanılır; ek tema sistemi yok.
5. **Sıralama:** Önce salt okunur grid + sanallaştırma + sona ekleme (1.1'i açar). Sonra seçim/kopyalama ve kolon genişliği, en son düzenleme ve işaretler (1.5).

## Riskler

1. **Yazılacak kod miktarı:** Aralık seçimi + klavye gezinme + kopyalama + kolon boyutlandırma, tahminen birkaç yüz satır UI kodu ve bir o kadar test demek. Çekirdek mantığın `src/core`'da saf tutulması bu riski küçültüyor. Kapsam büyürse yedek plan react-data-grid'e geçmek; bu durumda aralık seçiminden vazgeçilir.
2. **Tarayıcının öğe yükseklik sınırı:** Sanal liste toplam yüksekliği tek bir öğenin yüksekliği olarak uygulanıyor. Tarayıcılar çok büyük piksel yüksekliklerini (yaklaşık on milyonlarca px; kesin değer tarayıcıya göre değişiyor, bu araştırmada birincil kaynakla doğrulanmadı) kırpıyor. 24 px satırla 100 bin satır 2,4 M px ediyor, sorun yok. Sona ekleme modelinde kullanıcı milyonlarca satıra kaydırırsa sınır aşılabilir. Bir üst sınır (ör. 1 M satırda "daha fazlası için filtrele" uyarısı) baştan konmalı.
3. **Bellek:** 100 bin+ satır × geniş kolon ham metin olarak tarayıcı belleğinde tutulacak. Sona eklemede satırları hiç atmıyoruz. Çok geniş `text`/`jsonb` değerler için hücre başına gösterim kırpılabilir, ama veri yine bellekte duruyor. Ölçülmeli.
4. **Odak ve sanallaştırma:** Odaklı hücre scroll ile DOM'dan çıkınca odak kaybolur. Aktif hücre state'te tutulmalı, DOM odağı geri geldiğinde yeniden verilmeli. Bu, kendi grid'imizin en hataya açık kısmı.
5. **`react-virtual` sürüm temposu:** Yama sürümleri çok sık çıkıyor (3.14.x). `^3` ile sabitlemek yeterli; virtual-core'da davranış değişikliklerine (ör. `_holdOffset` düzeltmeleri) karşı entegrasyon testleri olmalı.

## Açık sorular (ayrı karar biletleri gerektirebilir)

1. **Panoya NULL nasıl yazılır?** Boş hücre mi, `NULL` metni mi, `\N` mi? TSV'de NULL ile boş metin ayrımı kayboluyor. Ayrıca kopyalama yalnızca TSV mi olacak, yoksa "INSERT olarak kopyala" / CSV seçenekleri de olacak mı?
2. **Yapıştırma (paste) kapsamda mı?** Ticket yalnızca kopyalamayı istiyor. Düzenlenebilir grid'de çok hücreli yapıştırma, bekleyen değişiklik modeli ve tip hataları açısından ayrı bir karar gerektiriyor.
3. **Çok satırlı/çok uzun değerlerin gösterimi:** Sabit satır yüksekliğinde `text`/`jsonb` değerler nasıl gösterilecek (kırpma + değer paneli / tooltip)? Düzenleme `<input>` mı yoksa `<textarea>` mı ile yapılacak?
4. **Bellek üst sınırı:** Sona ekleme kaç satırda durmalı ya da uyarmalı (bkz. Risk 2–3)?
5. **Kolon sanallaştırması:** İlk sürümde gerekli mi? Yüzlerce kolonlu tablolar beklenen bir kullanım mı?

## Kaynaklar

- npm registry: `https://registry.npmjs.org/@tanstack/react-virtual`, `.../@tanstack/virtual-core`, `.../@tanstack/react-table`, `.../react-data-grid`, `.../@glideapps/glide-data-grid` (6.0.3 ve 6.0.4-alpha22–24 `peerDependencies`), `.../ag-grid-community`, `.../ag-grid-react`, `.../handsontable`, `.../@handsontable/react-wrapper`, `.../@revolist/revogrid`, `.../@revolist/react-datagrid`
- npm downloads API: `https://api.npmjs.org/downloads/point/last-week/<paket>` (2026-11-02 – 2026-11-08)
- bundlephobia: `https://bundlephobia.com/api/size?package=<paket>` (2026-11-09)
- GitHub REST API `/repos/...`: `TanStack/virtual`, `TanStack/table`, `Comcast/react-data-grid`, `glideapps/glide-data-grid`, `ag-grid/ag-grid`, `revolist/revogrid`, `handsontable/handsontable`
- `@tanstack/virtual-core@3.19.11` tarball, `dist/esm/index.d.ts` (`initialRect`, `observeElementRect`, `horizontal`, `overscan`)
- react-data-grid: [README](https://github.com/Comcast/react-data-grid/blob/main/README.md), [LICENSE](https://github.com/Comcast/react-data-grid/blob/main/LICENSE)
- Glide Data Grid: [README](https://github.com/glideapps/glide-data-grid/blob/main/README.md), [API.md](https://github.com/glideapps/glide-data-grid/blob/main/packages/core/API.md)
- AG Grid: [Community vs Enterprise](https://www.ag-grid.com/react-data-grid/community-vs-enterprise/), [Licensing](https://www.ag-grid.com/react-data-grid/licensing/), [Cell Selection](https://www.ag-grid.com/react-data-grid/cell-selection/), [Clipboard](https://www.ag-grid.com/react-data-grid/clipboard/), [Infinite Row Model](https://www.ag-grid.com/react-data-grid/infinite-scrolling/), [Testing](https://www.ag-grid.com/react-data-grid/testing/)
- Handsontable: [LICENSE.txt](https://github.com/handsontable/handsontable/blob/develop/LICENSE.txt)
- RevoGrid: `@revolist/revogrid@4.31.4` tarball `readme.md` (çekirdek ve Pro özellik listeleri)
- W3C: [WAI-ARIA 1.2, `aria-rowcount`](https://www.w3.org/TR/wai-aria-1.2/#aria-rowcount); [ARIA APG Grid deseni](https://www.w3.org/WAI/ARIA/apg/patterns/grid/)
