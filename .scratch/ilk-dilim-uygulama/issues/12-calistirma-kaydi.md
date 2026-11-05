# 12: Çalıştırma kaydı

Spec: [İlk dilim spec'i](../../ilk-dilim/spec.md) · Kararlar: Çalıştırma geçmişi (wayfinder 22)

**What to build:** Her çalıştırma (hatalı ve iptal edilenler dahil) yapılandırma dizinindeki `history/` altında aylık bir JSONL dosyasına Çalıştırma kaydı olarak yazılır. Kayıtta ne çalıştırıldığı, hangi hedefte olduğu ve nasıl sonuçlandığı bulunur, satır verisi bulunmaz. Script ekranındaki "Çalıştırma kayıtları klasörünü aç" klasörü açar.

**Blocked by:** 09

**Status:** ready-for-agent

- [x] core kayıt satırları: aynı `runId` ile `başladı` (script, hedef anlık kopyası (bağlantı `id`, ad, veritabanı, ortam etiketi), mod, deneme mi, yazma kilidi) ve `bitti` (sonuç, zamanlar, ifade özetleri: offset, süre, komut etiketi, satır sayısı, hata kodu/mesajı/satırı). Her satırda `v` sürümü var. `bitti` satırı olmayan kayıt "bilinmiyor" olarak çıkıyor. Birim testli.
- [x] Sonuç değerleri `commit, rollback, deneme-rollback, karar-suresi-doldu, kopma-rollback, hata, iptal`; o an var olan akışlar kullanıyor.
- [x] Dosya `history/YYYY-MM.jsonl`, POSIX'te `0600`. Yazma hatası çalıştırmayı engellemiyor, `uyari` olayı gidiyor ve arayüzde "Çalıştırma kaydı yazılamadı" görünüyor.
- [x] SELECT önizlemesi ve deneme farkı kayda girmiyor.
- [x] Hedef başlığında "Çalıştırma kayıtları klasörünü aç" bağlantısı (REST → OS dosya yöneticisi) var; aynı komut palette de var.
- [x] Server testleri geçici dizinde yazılan satırları sınıyor.

## Comments

Uygulama notları (2026-11-05):

- **core** `calistirma-kaydi.ts`: `startedLine`, `finishedLine`, `formatLine`, `historyFileName` (yerel saatle `YYYY-MM.jsonl`), `parseRecords` (aynı `runId` birleşir; `bitti` yoksa `bilinmiyor`; bozuk, yarım ya da daha yeni `v`'li satırlar ve yetim `bitti` atlanır). `yazmaKilidi`: `salt-okunur | yazma-acik | null` (prod olmayan hedefte `null`). `bitti` satırında isteğe bağlı `mesaj` var.
- **server** `calistirma-kayitlari.ts`: tek kuyrukla `appendFile` (`mode 0600`, dizin `0700`). İki satır da çalıştırmanın başladığı ayın dosyasına gider. Yazma 2 sn'de bitmezse başarısız sayılır. `bitti` olayından önce kaydın `bitti` satırı yazılır (tarayıcı `bitti`'de soketi kapattığı için uyarı ondan önce gitmeli); yazılamazsa çalıştırma başına bir kez `uyari{tur: kayitYazilamadi}` gider. `POST /api/calistirma-kayitlari/klasoru-ac` klasörü oluşturup açar (Windows `explorer.exe`, macOS `open`, diğerleri `xdg-open`).
- **Kaydedilmeyenler**: analizden geçmeyen (`reddedildi`) script'ler ve bulunamayan bağlantı. İkisinde de hiçbir şey çalışmaz ve sonuç değerleri listesinde karşılıkları yok.
- **Sonuç eşlemesi**: Transaction'da kullanıcı rollback'i `rollback`, ifade hatasından sonra da öyle (hata `ifadeler[].hata`'da). Karar beklenirken ya da ifade çalışırken soket koparsa `kopma-rollback`. İstemci yokken gelen iptal `iptal`. Bağlanamama, bağlantı kopması ve commit hatası `hata`. Autocommit hatasız biterse `commit`, hatada durursa `hata`. Kopma ya da iptal `iptal` olur, çünkü geri alınan bir şey yoktur. `deneme-rollback` ticket 14'te, `yazma-acik` ticket 13'te kullanılacak.
- **web**: hedef başlığının sağ ucunda "Çalıştırma kayıtları klasörünü aç". Açılamazsa başlıkta hata gösterilir. Palet komutu artık etkin. Kayıt uyarısı `RunView.kayitUyarisi`'de durur, bekleyen isteğe dokunmaz ve karar kartında kalır.
- **Testler**: sahte Postgres'e `failOn` ve `queries` eklendi. Kayıt testleri (commit, hata + rollback, süre doldu, kopma, Autocommit, bağlanamama, prod anlık kopyası, ret, yazma hatası, 0600) gerçek PG'siz koşuyor. `iptal` ve ifade çalışırken kopma kontrolleri gerçek PG testlerine eklendi ama `TEZGAH_TEST_PG_URL` olmadığından **koşturulamadı**.
- **İnceleme notları** (yapılmadı): sonuç eşlemesi core'a taşınabilir. Tanım dizinin adı spec gereği `history/`, ama kod tanımlayıcılarında "history" var ve GLOSSARY "Geçmiş"ten kaçınıyor; `/domain-modeling` ile hizalanabilir.
