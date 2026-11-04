# 12: Çalıştırma kaydı

Spec: [İlk dilim spec'i](../../ilk-dilim/spec.md) · Kararlar: Çalıştırma geçmişi (wayfinder 22)

**What to build:** Her çalıştırma (hatalı ve iptal edilenler dahil) yapılandırma dizinindeki `history/` altında aylık bir JSONL dosyasına Çalıştırma kaydı olarak yazılır. Kayıtta ne çalıştırıldığı, hangi hedefte olduğu ve nasıl sonuçlandığı bulunur, satır verisi bulunmaz. Script ekranındaki "Çalıştırma kayıtları klasörünü aç" klasörü açar.

**Blocked by:** 09

**Status:** ready-for-agent

- [ ] core kayıt satırları: aynı `runId` ile `başladı` (script, hedef anlık kopyası (bağlantı `id`, ad, veritabanı, ortam etiketi), mod, deneme mi, yazma kilidi) ve `bitti` (sonuç, zamanlar, ifade özetleri: offset, süre, komut etiketi, satır sayısı, hata kodu/mesajı/satırı). Her satırda `v` sürümü var. `bitti` satırı olmayan kayıt "bilinmiyor" olarak çıkıyor. Birim testli.
- [ ] Sonuç değerleri `commit, rollback, deneme-rollback, karar-suresi-doldu, kopma-rollback, hata, iptal`; o an var olan akışlar kullanıyor.
- [ ] Dosya `history/YYYY-MM.jsonl`, POSIX'te `0600`. Yazma hatası çalıştırmayı engellemiyor, `uyari` olayı gidiyor ve arayüzde "Çalıştırma kaydı yazılamadı" görünüyor.
- [ ] SELECT önizlemesi ve deneme farkı kayda girmiyor.
- [ ] Hedef başlığında "Çalıştırma kayıtları klasörünü aç" bağlantısı (REST → OS dosya yöneticisi) var; aynı komut palette de var.
- [ ] Server testleri geçici dizinde yazılan satırları sınıyor.
