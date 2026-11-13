# 06: Hedef seçimi ve Veritabanı paneli

Spec: [İlk dilim spec'i](../../ilk-dilim/spec.md) · Kararlar: Sunucu modeli (wayfinder 04), Bağlantı ağacı (25), Script ekranı (23)

**What to build:** Geliştirici bir bağlantıyı seçer. Alt panelde kayıtlı Veritabanı seçimi görünür; "Bağlan ve tüm veritabanlarını listele" ile sunucudaki veritabanları gelir. ⭐ ile görünürlük ve şema çipleriyle şemalar ayarlanır. Bir veritabanına tıklamak onu editörün hedefi yapar ve script ekranının hedef başlığı güncellenir. "Bağlantıyı kes" pool'ları kapatır.

**Blocked by:** 02

**Status:** done (aaa9a32)

- [x] Hedef başına tembel bir `pg.Pool` açılıyor (en fazla 3 client, 10 dk boşta kalınca kapanıyor). Açılışta bağlantı yok. Bağlantı, panelden bağlanılınca ya da hedef ilk kullanılınca açılıyor.
- [x] REST: veritabanı listesi (`pg_database`, şablonlar hariç), veritabanı başına şema listesi, Veritabanı seçimini güncelleme, bağlantıyı kesme.
- [x] Yeni bağlantıda yalnızca başlangıç veritabanı görünür. `pg_catalog`, `information_schema` ve `pg_toast` gizli, diğer şemalar görünür.
- [x] Panel: görünür veritabanları üstte (⭐), altında açılıp kapanan şema çipleri, gizliler "Gizli (N)" altında. Bağlanmamışken kayıtlı seçim görünüyor ve hedef seçilebiliyor. Hata durumunda mesaj + "Tekrar dene" / "Düzenle". Başlıkta ⟳ ve ⋯ var.
- [x] Liste satırında durum ikonu (◌ bağlanıyor / ● bağlı / ⚠ hata) ve hedefin bağlantısında "● hedef" görünüyor. Bağlantı menüsüne hedef yap, bağlan/yenile ve bağlantıyı kes ekleniyor.
- [x] Script ekranı iskeleti: üstte hedef başlığı (renk noktası, `bağlantı / veritabanı`, ortam rozeti; prod'da kırmızımsı zemin ve uygulamada ince kırmızı çerçeve), altında henüz boş editör alanı.
- [x] Server entegrasyon testleri listelemeyi ve pool yaşam döngüsünü (sahte saat), web testleri panel etkileşimlerini sınıyor.
