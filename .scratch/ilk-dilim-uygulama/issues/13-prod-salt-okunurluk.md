# 13: prod hedefi: salt okunurluk ve yazma kilidi

Spec: [İlk dilim spec'i](../../ilk-dilim/spec.md) · Kararlar: prod salt okunurluğu (wayfinder 07), Transaction dışı komutlar (15), Script ekranı (23)

**What to build:** prod etiketli bir hedef salt okunur açılır ve yazma girişimlerini Postgres reddeder. Araç çubuğundaki 🔒/🔓 düğmesi yazma modunu tek tıkla açıp kapatır; çalıştırmadan önce onay istenmez. Salt okunur prod'da Autocommit script'i sunucuya gitmeden reddedilir.

**Blocked by:** 11

**Status:** ready-for-agent

- [ ] prod hedefinin pool'u `options: -c default_transaction_read_only=on` ile açılıyor. Salt okunurken script `BEGIN READ ONLY`, yazma modunda `BEGIN READ WRITE` ile başlıyor.
- [ ] Yazma kilidi editör ve hedef başına, oturum boyunca geçerli ve `run` mesajında gönderiliyor. Rozet 🔒 Salt okunur / 🔓 Yazma açık; ek onay, şerit ya da tema değişimi yok.
- [ ] Salt okunur prod'da Autocommit script'i Tezgah tarafında reddediliyor. Yazma modunda client'a `SET default_transaction_read_only = off` uygulanıyor ve çalıştırma bitince client pool'a dönmüyor, yok ediliyor.
- [ ] Server testleri (gerçek PG, prod etiketli bağlantı) salt okunurken INSERT reddini, yazma modunda başarıyı ve Autocommit sonrası ayarın sızmadığını sınıyor.
- [ ] README'ye "prod salt okunurluğu bir kaza önleyicidir, güvenlik sınırı değildir" notu ekleniyor.
