# 07: Oturumluk şifre

Spec: [İlk dilim spec'i](../../ilk-dilim/spec.md) · Kararlar: Ayar saklama eki (wayfinder 03), Bağlantı formu (24), Bağlantı ağacı (25)

**What to build:** Geliştirici formda "Keychain'e kaydet"i kapatır. Bağlantı ilk açılırken küçük bir şifre penceresi çıkar. Şifre Tezgah kapanana kadar bellekte kalır ve yalnızca sunucu reddederse (`28P01`) yeniden sorulur.

**Blocked by:** 06

**Status:** ready-for-agent

- [x] Formdaki şifre alanının altında "Keychain'e kaydet" var (varsayılan açık). Kapalıyken "her açılışta ilk bağlanmada sorulur, yalnızca bellekte" uyarısı görünüyor ve kapatınca kayıtlı sır siliniyor.
- [x] Şifre penceresi: bağlantının adı ve rengi, `kullanıcı@host`, şifre alanı, "Tezgah kapanana kadar bellekte tutulur, diske yazılmaz" notu, varsayılan kapalı "Keychain'e kaydet (bağlantı ayarını değiştirir)" seçeneği, `İptal` / `Bağlan`.
- [x] Oturumluk sır süreç belleğindeki bir haritada tutuluyor. Bağlantı kesilse ya da düşse yeniden sorulmuyor; yalnızca `28P01`'de siliniyor ve soruluyor.
- [x] Sunucu sırrı olmayan bir bağlantıda yapısal bir "şifre gerekli" hatası döndürüyor; arayüz pencereyi açıp şifreyi REST ile gönderiyor.
- [x] Server testleri `28P01` sonrası yeniden sormayı, web testleri pencereyi sınıyor.

## Comments

Uygulama notları (2026-11-04):

- **Form** zaten ticket 02'den beri "Keychain'e kaydet"i ve kapalıyken uyarıyı gösteriyordu; kapatınca kayıtlı şifre `passwordAction` → `sil` ile siliniyor. Bu ticket'ta formda değişiklik yok.
- **Uç.** `POST /api/baglantilar/:id/oturum-sifresi`, gövde `{ password, saveToKeychain? }`. Yanıt `{ connection, password: 'oturumda' | 'kaydedildi' | 'reddedildi' }`. `saveToKeychain` ile keychain'e yazılır ve `savePassword` true olur; keychain reddederse şifre bellekte kalır, ayar değişmez. Her şifre verişinde bağlantının pool'ları kapanır, eski şifreyle kalmasınlar.
- **Bellek.** `src/server/oturum-sifreleri.ts`: süreç içindeki haritanın küçük API'si (`get`, `remember`, `forgetRejected`, `forget`). Pool yöneticisi `savePassword` kapalıyken şifreyi oradan okur. Yalnızca `28P01`'de (pool açılırken ya da açık pool'dan client alırken) ve bağlantı silinince temizleniyor; kesme ya da düşme ona dokunmuyor. Ret, yalnızca reddedilen şifre hâlâ kayıtlıysa onu siler: geç gelen bir `28P01` arada girilen yeni şifreyi silmez.
- **Açık sorular.** Host ya da kullanıcı formda değişse de oturumluk şifre kalıyor (spec yalnızca `28P01` diyor). Şifre her verildiğinde bağlantının pool'ları kapanıyor; script çalıştırma kendi oturumlarını tuttuğunda (ticket 09) açık transaction'ı düşürmemesi gözden geçirilmeli.
- **"Şifre gerekli"**: sunucu şifre isteyip elde şifre olmayınca mevcut yapısal `sifreGerekli` kodu 502 ile dönüyor (bağlantı testiyle aynı kod). Şifre istemeyen (trust) sunucuya şifresiz bağlanılıyor.
- **Arayüz.** `SifrePenceresi` ortak bileşen. `App.askPassword` pencereyi `asksForSessionPassword` (`core/baglanti-testi`, tipli kodlarla) kuralıyla açıyor: yalnızca `savePassword` kapalıyken ve kod `sifreGerekli`/`28P01` olduğunda. Şifre verilince istek yeniden deneniyor; `28P01`'de pencere ret nedeniyle yeniden açılıyor. Hem "Bağlan/Yenile" hem paneldeki şema listesi bu yolu kullanıyor. İptal panelde hatayı bırakıyor, "Tekrar dene" pencereyi yeniden açıyor. Keychain'e kaydedilen bağlantıda pencere açılmıyor (hata + "Düzenle").
- **Testler.** Gerçek Postgres olmadan `28P01` akışını sınamak için `src/server/test/sahte-postgres.ts` (wire protokolü v3, düz metin şifre, tek kolonlu sorgu yanıtı) eklendi. Sahte web API'si de sunucunun şifre denetimini taklit ediyor.
- Bağlantı testi oturumluk şifreyi kullanmıyor: "Keychain'e kaydet" kapalı formda şifre alanı yok, test şifresiz deniyor (değişmedi).
