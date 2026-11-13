# 03: Klasörler, bağlantı menüsü ve URL

Spec: [İlk dilim spec'i](../../ilk-dilim/spec.md) · Kararlar: Bağlantı ağacı (wayfinder 25), Bağlantı formu (24)

**What to build:** Geliştirici bağlantılarını tek düzey klasörlerde düzenler. Klasör oluşturur, yeniden adlandırır ve siler; bağlantıları sürükle-bırakla ya da menüyle taşır. Bir bağlantıyı kopyalayabilir. Forma `postgres://` URL'i yapıştırınca alanlar dolar; bağlantı menüsünden şifresiz URL kopyalanabilir.

**Blocked by:** 02

**Status:** done (96ea2d8)

- [x] Klasörler tek düzey (iç içe değil). Kenar çubuğu başlığındaki düğmeyle oluşturuluyor; başlıkta sağ tıkla yeniden adlandırılıp siliniyor. Silinen klasördeki bağlantılar "Klasörsüz" bölümüne taşınıyor. Klasör başlıkları katlanır ve bağlantı sayısını gösteriyor.
- [x] Bağlantı sürükle-bırakla ya da menüdeki "Klasöre taşı" ile klasör değiştiriyor.
- [x] Bağlantı menüsü (sağ tık / ⋯) düzenle, kopyala, klasöre taşı, URL'yi kopyala (şifresiz) ve sil seçeneklerini içeriyor. Hedef yap, bağlan ve bağlantıyı kes ticket 06'da ekleniyor.
- [x] Kopyala: hemen yanına "ad (kopya)" oluşuyor, sırlar yeni `connectionId` altına keychain'e kopyalanıyor ve form açılıyor.
- [x] core URL modülü `postgres://` ve `postgresql://` ayrıştırıyor ve üretiyor. Ayrıştırmanın sonucu alanlar (host, port, kullanıcı, şifre, veritabanı, `sslmode`, `sslrootcert`, `sslcert`, `sslkey`), yok sayılan parametreler ya da ret nedeni (çok host, geçersiz `sslmode`, başka şema). Tablo tabanlı birim testleri var.
- [x] Formun ilk satırı URL; Host alanına yapıştırılan URL de algılanıyor. Alanlar doluyor, yok sayılanlar listeleniyor, şifre şifre alanına gidiyor. URL saklanmıyor. SSL parametreleri, ticket 05 gelene kadar modelde tutuluyor.
- [x] Web testleri klasör işlemlerini, kopyalamayı ve URL'den doldurmayı sınıyor.

## Comments

- **Uçlar.** `GET/POST /api/klasorler`, `PUT/DELETE /api/klasorler/:id` (silme `{ tasinan }` döner), `POST /api/baglantilar/:id/kopya`. Taşıma için ayrı uç yok; bağlantının alanlarıyla `PUT` ve yeni `folderId` gönderiliyor (şifreye dokunulmaz).
- **Klasör adları.** Boş olamaz; büyük/küçük harf duyarsız tekil (Türkçe ve kök çevrimden biri eşleşirse aynı ad). Klasör silme, içindeki bağlantı sayısını söyleyen bir onay istiyor.
- **Kopya adı.** "ad (kopya)" alınmışsa "ad (kopya 2)", "ad (kopya 3)"… Keychain'de şifre yoksa ya da bağlantı keychain'e kaydetmiyorsa keychain'e yazılmıyor; okuma/yazma reddedilirse kopya yine oluşuyor ve bu söyleniyor.
- **URL modülü** `src/core/baglanti-url.ts` (core'da `url` adı Node modülüyle çakışan lint kuralına takılıyor). libpq query alanları (`host`, `port`, `user`, `password`, `dbname`) yoldakileri ezer; `sslmode=allow` desteklenmiyor (modeldeki beş mod). URL'de port yoksa form portu 5432 yapar; URL'de olmayan diğer alanlara dokunulmaz.
- **SSL parametreleri** formun durumunda (`ssl`) tutuluyor ve durum satırında gösteriliyor; `Connection` modelinde alan olmadığı için kaydedilmiyor. Ticket 05 bu durumu SSL bölümünün alanlarına bağlamalı ve "URL'yi kopyala" çağrısına SSL alanlarını geçmeli (`buildConnectionUrl` destekliyor).
- **Klasör yokken** liste başlıksız düz liste; ilk klasör oluşunca bölümler ve en altta "Klasörsüz" görünür. Katlanma durumu yalnızca oturum boyunca tutuluyor.
- **Form** artık bir Klasör seçimi içeriyor (ticket 24'teki alan listesi). Form açıkken bağlantı listeden taşınırsa form yeni klasörü alıyor.
