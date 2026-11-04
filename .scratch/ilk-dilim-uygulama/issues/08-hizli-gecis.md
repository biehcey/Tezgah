# 08: Cmd/Ctrl+K hızlı geçiş

Spec: [İlk dilim spec'i](../../ilk-dilim/spec.md) · Kararlar: Bağlantı ağacı ve hızlı geçiş (wayfinder 25)

**What to build:** Geliştirici Cmd/Ctrl+K'ya basar ve tüm bağlantıların görünür veritabanlarını `bağlantı / veritabanı` biçiminde bulanık arar. Enter mevcut editörün hedefini değiştirir. Paletten komutlar çalıştırılır. Bir `postgres://` URL'i yapıştırılınca aynı sunucuya giden mevcut bağlantılar ve "URL'den yeni bağlantı…" sunulur.

**Blocked by:** 03, 06

**Status:** ready-for-agent

- [ ] Gruplar: *Hedefler* (kayıtlı Veritabanı seçiminden, bağlanmadan; prod rozeti; mevcut hedef işaretli), *Gizli veritabanları* (yalnızca bağlı bağlantılarda ve sorgu varken; seçilince görünür yapılıyor), *Komutlar* (yeni bağlantı, yeni klasör, içe aktar, çalıştırma kayıtları klasörünü aç). Henüz olmayan komutlar gizli ya da pasif.
- [ ] Enter hedefi değiştiriyor, Alt+Enter seçimi listede gösteriyor, klavyeyle gezinme çalışıyor.
- [ ] URL yapıştırınca core URL modülüyle ayrıştırılıyor. Aynı host, port ve kullanıcıya giden bağlantılar "Bu sunucuya giden mevcut bağlantı" grubunda; seçince URL'deki veritabanı hedef oluyor. "URL'den yeni bağlantı…" formu dolu açıyor. Geçersiz URL için tek satır hata.
- [ ] Kenar çubuğu başlığında ⌘K düğmesi var; hedef başlığındaki "hedefi değiştir ▾" paleti açıyor.
- [ ] Web testleri aramayı, Enter / Alt+Enter'ı ve URL yapıştırmayı sınıyor.
