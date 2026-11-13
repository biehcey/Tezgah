# 18: .pgpass'tan içe aktarma ve içe aktardıktan sonra test

Spec: [İlk dilim spec'i](../../ilk-dilim/spec.md) · Kararlar: İçe aktarma akışı (wayfinder 18), İçe aktarma diyaloğu (26)

**What to build:** Geliştirici "İçe aktar"ı açar ve `.pgpass` kendiliğinden taranır. Önizleme, bağlantı listesinin içe aktarmadan sonraki hâli olarak görünür: mevcutlar gri, gelen İçe aktarma adayları yeşil ve onay kutulu, zaten var olanlar eşlerinin altında ve seçilmemiş. Bir aday seçilince sağ panelde ad, klasör ve ortam düzenlenir. İçe aktarınca seçilenler kaydedilir ve şifreler keychain'e kopyalanır. İsteğe bağlı olarak içe aktarılanlar sırayla test edilir.

**Blocked by:** 03, 04

**Status:** done (a697670)

- [ ] core pgpass modülü ayrıştırıyor ve libpq eşlemesini yapıyor (ilk eşleşen satır, `*` joker). Host, port ve kullanıcısı somut satırlar aday oluyor (`db` somutsa başlangıç veritabanı, değilse `postgres`); joker satırlar yalnızca şifre kaynağı. Birim testli.
- [ ] core gruplama: kimlik anahtarı `(host, port, kullanıcı, SSH host/port/kullanıcı)`; aynı anahtarlı kaynaklar birleşiyor ve Veritabanı seçimi birleşim oluyor. Mevcut bağlantıyla eşleşen aday "zaten var" olarak işaretleniyor. Birim testli. Ticket 19'da IntelliJ kaynaklarıyla da kullanılacak.
- [ ] Tarama sırası `PGPASSFILE` → `~/.pgpass` / `%APPDATA%\postgresql\pgpass.conf`; yol elle de girilebiliyor. Sunucu yalnızca `.pgpass` ya da `pgpass.conf` adlı dosyaları okuyor. Ev dizini ve ortam testte enjekte ediliyor.
- [ ] REST: tara/önizle (adaylar, kaynak hataları) ve uygula. Uygulama seçilenleri tek atomik yazmayla ekliyor, ardından şifreleri keychain'e yazıyor. Başarısız olanlar "şifre kaydedilemedi" olarak dönüyor, geri alma yok. Yinelenen aday "ad (2)" oluyor.
- [ ] Diyalog: üstte kaynak çipleri (aday sayısıyla, aç/kapa; hatalı kaynak kırmızı ⚠). Solda sonuç ağacı ("yeni klasör" rozeti, ⚠N, 🔑, "yeni" / "atlanacak"). Sağda ayrıntı paneli (ad, içe aktar/yinele, klasör, ortam etiketi, sunucu, şifre kaynağı satırı, veritabanları, kaynaklar, uyarılar). Altta "İçe aktardıktan sonra test et" (varsayılan kapalı), "N yeni bağlantı", `İptal` / `İçe aktar`.
- [ ] Sonuç penceresi: "N eklendi, M atlandı", keychain'e yazılamayanlar, her satırda "Formda aç" (diyalog kapanıp form açılıyor). Yeni bağlantılar listede bir sonraki içe aktarmaya kadar "yeni" rozetli.
- [ ] Toplu test: içe aktarılanlar sırayla, bağlantıyı test et servisiyle ve etkileşimsiz sınanıyor (şifresiz bağlantı "şifre yok, test atlandı"). Sonuç hem pencerede hem listede durum ikonu olarak görünüyor.
- [ ] Giriş noktaları: kenar çubuğundaki "⇩ İçe aktar", palet komutu ve boş listedeki "İçe aktar…" düğmesi.
- [ ] Server testleri geçici dizindeki fixture `.pgpass` ile tara, önizle, uygula ve keychain hatasını sınıyor; web testleri diyaloğu sınıyor.
