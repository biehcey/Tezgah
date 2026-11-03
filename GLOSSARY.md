# Tezgah

PostgreSQL için kişisel, yerel çalışan bir veritabanı yönetim aracı.

## Bağlantılar

**Bağlantı**:
Kullanıcının kaydettiği, sunucu düzeyindeki giriş: nereye, hangi kullanıcıyla, hangi ortam etiketiyle ve gerekiyorsa hangi tünelden ulaşılacağı. Tek bir veritabanına bağlı değildir.
_Avoid_: Data source, sunucu, connection string

**Veritabanı seçimi**:
Bir bağlantı altında sunucudaki veritabanlarından kullanıcının görünür kıldıkları ve her birinde görünür kıldığı şemalar.
_Avoid_: Scope, filtre

**Hedef**:
Bir script'in çalıştığı yer: bir bağlantı ile o bağlantıdaki bir veritabanının çifti.
_Avoid_: Oturum, context

**Ortam etiketi**:
Bir bağlantının hangi ortamı temsil ettiğini söyleyen sabit kümeden bir değer (`local`, `dev`, `test`, `staging`, `prod`), kullanıcının değiştirebildiği bir renkle birlikte. Özel güvenlik davranışını yalnızca `prod` tetikler; etiket opsiyoneldir.
_Avoid_: Ortam, environment, tag

**Tünel**:
Bir bağlantının sunucuya bir SSH sunucusu üzerinden ulaşma yolu. Bağlantı başına en fazla bir tanedir; o bağlantının tüm hedefleri onu paylaşır.
_Avoid_: SSH bağlantısı, port forward

## Script çalıştırma

**Transaction dışı komut**:
Postgres'in bir transaction bloğu içinde çalıştırmayı reddettiği komut (ör. `VACUUM`, `CREATE INDEX CONCURRENTLY`). Etkisi anında kalıcıdır, geri alınamaz.
_Avoid_: Özel komut, non-tx

**Çalıştırma modu**:
Bir script'in içeriğinden çıkarılan, nasıl çalışacağını belirleyen mod: *Transaction* (tüm ifadeler tek transaction'da, sonda commit veya rollback) ya da *Autocommit* (script yalnızca transaction dışı komutlardan oluşur; her ifade anında kalıcı). İki türü karıştıran script çalıştırılamaz. Deneme modu bir çalıştırma modu değildir; Transaction modunun sonu her zaman rollback olan biçimidir.
_Avoid_: Transaction modu anahtarı, execution mode
