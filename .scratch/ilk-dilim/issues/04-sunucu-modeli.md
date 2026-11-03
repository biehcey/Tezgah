# Sunucu modeli: veritabanı listeleme ve pool yönetimi

Type: grilling
Status: resolved
Blocked by: —

## Question

Veritabanları nasıl listelenir; hedef başına bağlantı/pool nasıl yönetilir; tembel bağlanma nasıl işler?

## Answer

- Bağlantıda **başlangıç veritabanı** alanı (varsayılan `postgres`); `pg_database` listesi buradan alınır.
- Açılışta hiçbir yere bağlanılmaz; bağlantı ağaçta genişletildiğinde veya hedef seçildiğinde bağlanılır.
- **Hedef** başına tembel `pg.Pool` (max 3), 10 dk boşta kalınca kapanır.
- Script çalıştırma pool'dan **tek client** alır ve commit/rollback dahil bitene kadar tutar.
- SSH tüneli bağlantı başına tek; o bağlantının tüm pool'ları paylaşır.

Çizim oturumunda (2026-11-03) kararlaştırıldı.
