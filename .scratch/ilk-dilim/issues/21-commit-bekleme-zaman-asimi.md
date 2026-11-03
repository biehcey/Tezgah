# Commit/rollback beklerken zaman aşımı

Type: grilling
Status: resolved
Blocked by: —

## Question

Transaction modunda script bittikten sonra transaction, kullanıcı commit veya rollback seçene kadar açık bekler ([Backend ↔ arayüz iletişimi](06-backend-arayuz-iletisimi.md), [ADR-0002](../../../docs/adr/0002-kopmada-rollback.md)); soket açık kaldıkça bu bekleme sınırsızdır ve satır kilitleri tutulur. Açık transaction için bir üst süre var mı; varsa kaç dakika, ortam etiketine (`prod`) göre değişiyor mu, süre dolunca ne olur (otomatik rollback mi, yalnızca uyarı mı), kullanıcıya geri sayım gösterilir mi, uzatılabilir mi? Postgres tarafında `idle_in_transaction_session_timeout` mı kullanılır, Tezgah'ın kendi zamanlayıcısı mı?

## Answer

- **Kapsam**: yalnızca Transaction modunda, son ifade bittikten sonra commit/rollback kararı beklenirken (Karar süresi). Deneme modu zaten beklemeden rollback yapar; Autocommit'te bekleyen transaction yoktur.
- **Süre**: `prod`'da **5 dk**, diğer tüm ortamlarda ve etiketsiz bağlantılarda **30 dk**; sabit, ilk dilimde ayar yok. Sayım son ifadenin bitişinden (veya hatadan sonraki karar beklemesinden) başlar; çalışma süresi sayılmaz.
- **Süre dolunca**: otomatik rollback; "Süre doldu; transaction geri alındı" mesajı, log korunur. Otomatik commit ve yalnızca uyarı reddedildi.
- **Ön uyarı ve uzatma**: son 1 dakikada görünür geri sayım; "Uzat" sınırsız, sunucuya `SELECT 1` gönderip süreyi baştan başlatır.
- **Mekanizma**: asıl mekanizma Tezgah sunucusundaki zamanlayıcı (tarayıcıda değil). Yedek: `BEGIN`'den hemen sonra `SET LOCAL idle_in_transaction_session_timeout` = süre + 1 dk; dizüstü uykudayken Node zamanlayıcısı işlemezken uzak sunucuda kilitlerin saatlerce kalmasını önler. "Uzat"taki `SELECT 1` bu sayacı da sıfırlar. Uyanınca client'ın öldüğü görülür, pool onu atar; mesaj ADR-0002 dilinde: "Oturum sunucuda zaman aşımına uğradı; transaction geri alındı".
- **Yarış**: yetkili olan sunucu zamanlayıcısıdır; süre dolduktan sonra gelen `commit` reddedilir, düğmeler devre dışı kalır. Tolerans yok.
- **İlk dilimde yok**: `pg_blocking_pids` ile "N oturumu bekletiyorsun" göstergesi (ek sorgu ve rol izni gerektirir); sonraki iyileştirme.
