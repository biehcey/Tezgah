# 03: Klasörler, bağlantı menüsü ve URL

Spec: [İlk dilim spec'i](../../ilk-dilim/spec.md) · Kararlar: Bağlantı ağacı (wayfinder 25), Bağlantı formu (24)

**What to build:** Geliştirici bağlantılarını tek düzey klasörlerde düzenler. Klasör oluşturur, yeniden adlandırır ve siler; bağlantıları sürükle-bırakla ya da menüyle taşır. Bir bağlantıyı kopyalayabilir. Forma `postgres://` URL'i yapıştırınca alanlar dolar; bağlantı menüsünden şifresiz URL kopyalanabilir.

**Blocked by:** 02

**Status:** ready-for-agent

- [ ] Klasörler tek düzey (iç içe değil). Kenar çubuğu başlığındaki düğmeyle oluşturuluyor; başlıkta sağ tıkla yeniden adlandırılıp siliniyor. Silinen klasördeki bağlantılar "Klasörsüz" bölümüne taşınıyor. Klasör başlıkları katlanır ve bağlantı sayısını gösteriyor.
- [ ] Bağlantı sürükle-bırakla ya da menüdeki "Klasöre taşı" ile klasör değiştiriyor.
- [ ] Bağlantı menüsü (sağ tık / ⋯) düzenle, kopyala, klasöre taşı, URL'yi kopyala (şifresiz) ve sil seçeneklerini içeriyor. Hedef yap, bağlan ve bağlantıyı kes ticket 06'da ekleniyor.
- [ ] Kopyala: hemen yanına "ad (kopya)" oluşuyor, sırlar yeni `connectionId` altına keychain'e kopyalanıyor ve form açılıyor.
- [ ] core URL modülü `postgres://` ve `postgresql://` ayrıştırıyor ve üretiyor. Ayrıştırmanın sonucu alanlar (host, port, kullanıcı, şifre, veritabanı, `sslmode`, `sslrootcert`, `sslcert`, `sslkey`), yok sayılan parametreler ya da ret nedeni (çok host, geçersiz `sslmode`, başka şema). Tablo tabanlı birim testleri var.
- [ ] Formun ilk satırı URL; Host alanına yapıştırılan URL de algılanıyor. Alanlar doluyor, yok sayılanlar listeleniyor, şifre şifre alanına gidiyor. URL saklanmıyor. SSL parametreleri, ticket 05 gelene kadar modelde tutuluyor.
- [ ] Web testleri klasör işlemlerini, kopyalamayı ve URL'den doldurmayı sınıyor.
