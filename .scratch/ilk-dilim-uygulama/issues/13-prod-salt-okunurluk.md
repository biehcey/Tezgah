# 13: prod hedefi: salt okunurluk ve yazma kilidi

Spec: [İlk dilim spec'i](../../ilk-dilim/spec.md) · Kararlar: prod salt okunurluğu (wayfinder 07), Transaction dışı komutlar (15), Script ekranı (23)

**What to build:** prod etiketli bir hedef salt okunur açılır ve yazma girişimlerini Postgres reddeder. Araç çubuğundaki 🔒/🔓 düğmesi yazma modunu tek tıkla açıp kapatır; çalıştırmadan önce onay istenmez. Salt okunur prod'da Autocommit script'i sunucuya gitmeden reddedilir.

**Blocked by:** 11

**Status:** ready-for-agent

- [x] prod hedefinin pool'u `options: -c default_transaction_read_only=on` ile açılıyor. Salt okunurken script `BEGIN READ ONLY`, yazma modunda `BEGIN READ WRITE` ile başlıyor.
- [x] Yazma kilidi editör ve hedef başına, oturum boyunca geçerli ve `run` mesajında gönderiliyor. Rozet 🔒 Salt okunur / 🔓 Yazma açık; ek onay, şerit ya da tema değişimi yok.
- [x] Salt okunur prod'da Autocommit script'i Tezgah tarafında reddediliyor. Yazma modunda client'a `SET default_transaction_read_only = off` uygulanıyor ve çalıştırma bitince client pool'a dönmüyor, yok ediliyor.
- [x] Server testleri (gerçek PG, prod etiketli bağlantı) salt okunurken INSERT reddini, yazma modunda başarıyı ve Autocommit sonrası ayarın sızmadığını sınıyor.
- [x] README'ye "prod salt okunurluğu bir kaza önleyicidir, güvenlik sınırı değildir" notu ekleniyor.

## Comments

Uygulama notları (2026-11-05):

- **core** `yazma-kilidi.ts`: `writeLockState(envTag, yazmaModu)` (prod dışında `null`), `beginStatement` (`BEGIN READ ONLY` / `BEGIN READ WRITE` / `BEGIN`), `writeLockBlock` (salt okunur prod'da Autocommit → ret mesajı). `run` mesajında `yazmaModu`; yalnızca açıkça `true` yazma modudur.
- **server**: kilit sunucuda bağlantının kayıtlı `envTag`'inden hesaplanır. Salt okunur prod'da Autocommit bağlanmadan `bitti{reddedildi}` ile biter ve diğer reddedilen script'ler gibi kaydedilmez. Yazma modunda Autocommit önce `SET default_transaction_read_only = off` gönderir ve client her durumda atılır. Kayıtta `yazmaKilidi` artık gerçek durumu taşır.
- **web**: araç çubuğunda 🔒 Salt okunur / 🔓 Yazma açık düğmesi (`aria-pressed`). Yalnızca prod hedefte görünür, çalıştırma sürerken ve karar beklenirken kapalıdır. Kilit `ScriptEkrani` durumunda hedef başına tutulur. Salt okunur prod'da Autocommit script'inde Çalıştır kapalıdır ve nedeni listelenir. `ApiClient.runScript` artık `{ target, script, yazmaModu }` alır.
- **Testler**: sahte PG ile BEGIN biçimleri, bağlanmadan ret, SET + client'ın atılması sınanır. Gerçek PG testleri (`src/server/yazma-kilidi.test.ts`: INSERT `25006` reddi, yazma modunda commit, Autocommit sonrası sızmama) `TEZGAH_TEST_PG_URL` olmadığından **koşturulamadı**.
- **İnceleme sonrası** (yapıldı):
  - Yazma modu açık hedefler (`WritableTargets`, core `isWritable`/`toggleWritable`, `isTarget` ile karşılaştırma) App'te tutulur. Bağlantı formu açılıp kapanınca (ScriptEkrani unmount) kilit korunur; App testiyle sınandı. Script metni unmount'ta hâlâ kayboluyor, bu ticket'tan önce de böyleydi.
  - Çalıştırma engelleri tek core fonksiyonunda: `runBlockReasons(script, statements, lock, analysis?)`. Analiz engellerinden sonra salt okunur prod'daki Autocommit'i ekler. Sunucu ve arayüz bunu kullanır. Sunucu, bağlantının ortam etiketini okuduktan sonra tek noktada reddeder (bilinmeyen bağlantıda analiz reddi yine önce gelir).
  - `WriteLockState` artık `yazma-kilidi.ts`'de; `calistirma-kaydi.ts` onu import eder.
  - Karar 23 gereği hedef başlığında ortam etiketinin yanında kilit rozeti (`title="Yazma kilidi"`) var; değiştirmek araç çubuğundaki düğmeyle. Rozet/eylem metinleri `durum.ts`'de `WRITE_LOCK_LABELS` haritasında.
