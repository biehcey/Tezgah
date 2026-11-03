# İçe aktarma akışı: dataSources.xml ve .pgpass

Type: grilling
Status: open
Blocked by: 13

## Question

[dataSources.xml araştırmasına](13-datasources-xml-formati.md) göre içe aktarma akışı nasıl işler?

- dataSources.xml: hangi alanlar eşlenir; eşlenemeyenler (desteklenmeyen sürücüler, bilinmeyen SSH ayarları) nasıl raporlanır; klasör/renk taşınır mı; şifreler nereden gelir?
- `.pgpass`: konum (`~/.pgpass`, `%APPDATA%\postgresql\pgpass.conf`, `PGPASSFILE`); `*` joker satırları bağlantıya mı dönüşür yoksa yalnızca şifre kaynağı mı olur; şifreler keychain'e kopyalanır mı?
- Çakışma: aynı host/port/kullanıcı/veritabanı zaten varsa ne olur (atla, birleştir, yinele)?
- Önizleme: içe aktarmadan önce liste gösterilip seçim yaptırılır mı?
