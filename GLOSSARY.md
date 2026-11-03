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
