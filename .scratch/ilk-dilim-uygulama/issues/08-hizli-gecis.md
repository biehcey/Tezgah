# 08: Cmd/Ctrl+K hızlı geçiş

Spec: [İlk dilim spec'i](../../ilk-dilim/spec.md) · Kararlar: Bağlantı ağacı ve hızlı geçiş (wayfinder 25)

**What to build:** Geliştirici Cmd/Ctrl+K'ya basar ve tüm bağlantıların görünür veritabanlarını `bağlantı / veritabanı` biçiminde bulanık arar. Enter mevcut editörün hedefini değiştirir. Paletten komutlar çalıştırılır. Bir `postgres://` URL'i yapıştırılınca aynı sunucuya giden mevcut bağlantılar ve "URL'den yeni bağlantı…" sunulur.

**Blocked by:** 03, 06

**Status:** ready-for-agent

- [x] Gruplar: *Hedefler* (kayıtlı Veritabanı seçiminden, bağlanmadan; prod rozeti; mevcut hedef işaretli), *Gizli veritabanları* (yalnızca bağlı bağlantılarda ve sorgu varken; seçilince görünür yapılıyor), *Komutlar* (yeni bağlantı, yeni klasör, içe aktar, çalıştırma kayıtları klasörünü aç). Henüz olmayan komutlar gizli ya da pasif.
- [x] Enter hedefi değiştiriyor, Alt+Enter seçimi listede gösteriyor, klavyeyle gezinme çalışıyor.
- [x] URL yapıştırınca core URL modülüyle ayrıştırılıyor. Aynı host, port ve kullanıcıya giden bağlantılar "Bu sunucuya giden mevcut bağlantı" grubunda; seçince URL'deki veritabanı hedef oluyor. "URL'den yeni bağlantı…" formu dolu açıyor. Geçersiz URL için tek satır hata.
- [x] Kenar çubuğu başlığında ⌘K düğmesi var; hedef başlığındaki "hedefi değiştir ▾" paleti açıyor.
- [x] Web testleri aramayı, Enter / Alt+Enter'ı ve URL yapıştırmayı sınıyor.

## Comments

Uygulama notları (2026-11-04):

- **core** `src/core/hizli-gecis.ts`: `fuzzyScore` (sırayla geçen harfler; boşluk, büyük/küçük harf ve aksan/Türkçe ı-İ yok sayılır; bitişik ve kelime başı harf daha çok puan), `searchTargets` (kayıtlı Veritabanı seçiminden, bağlanmadan), `searchHiddenDatabases` (yalnızca bağlı bağlantılar, yalnızca sorgu varken), `matchUrl` (core URL ayrıştırıcısıyla). Hedef karşılaştırması `veritabani-secimi.isTarget`'a taşındı, panel de onu kullanıyor.
- **URL eşleşmesi.** Host büyük/küçük harf duyarsız; port yazılmadıysa 5432; host yazılmadıysa `localhost`. URL'de kullanıcı yoksa o sunucudaki tüm bağlantılar eşleşiyor (spec bunu söylemiyor, öneri). Veritabanı yazılmadıysa bağlantının başlangıç veritabanı hedef oluyor. URL eşleşmesinden seçilen veritabanı Veritabanı seçimine eklenmiyor (gizli veritabanından farklı olarak); seçimde değilse panelde "● hedef" görünmez. Sunucuda var olduğu bilinmediği için kalıcı seçime yazmadım; istenirse değiştirilebilir.
- **Gizli veritabanı.** Enter görünür yapar ve hedef yapar; Alt+Enter görünür yapmadan panelde (⭐ düğmesini odaklayarak) gösterir.
- **Alt+Enter.** Bağlantı seçilir, klasörü kapalıysa açılır, veritabanı satırı panelde odaklanır.
- **Komutlar.** Yeni bağlantı ve Yeni klasör çalışıyor; İçe aktar ve Çalıştırma kayıtları klasörünü aç "yakında" notuyla pasif, gezinmede atlanıyor. Komutlar da sorguyla süzülüyor.
- **Kısayol.** Ctrl+K ve Cmd+K; başka bir pencere (klasör, silme onayı, şifre) açıkken yok sayılıyor. Kenar çubuğu düğmesi Mac'te `⌘K`, diğerlerinde `Ctrl K` yazıyor.
- **Açık iş.** Spec hikâyesi 65 (karar bekleyen transaction varken hedef değiştirme kapalı, paletin tepesinde neden) script çalıştırmayla (ticket 09/10) gelecek. Hedef değişiminin tek yolu `App.chooseTarget`; kilit oraya ve palete o ticket'ta eklenmeli.
