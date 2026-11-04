# 07: Oturumluk şifre

Spec: [İlk dilim spec'i](../../ilk-dilim/spec.md) · Kararlar: Ayar saklama eki (wayfinder 03), Bağlantı formu (24), Bağlantı ağacı (25)

**What to build:** Geliştirici formda "Keychain'e kaydet"i kapatır. Bağlantı ilk açılırken küçük bir şifre penceresi çıkar. Şifre Tezgah kapanana kadar bellekte kalır ve yalnızca sunucu reddederse (`28P01`) yeniden sorulur.

**Blocked by:** 06

**Status:** ready-for-agent

- [ ] Formdaki şifre alanının altında "Keychain'e kaydet" var (varsayılan açık). Kapalıyken "her açılışta ilk bağlanmada sorulur, yalnızca bellekte" uyarısı görünüyor ve kapatınca kayıtlı sır siliniyor.
- [ ] Şifre penceresi: bağlantının adı ve rengi, `kullanıcı@host`, şifre alanı, "Tezgah kapanana kadar bellekte tutulur, diske yazılmaz" notu, varsayılan kapalı "Keychain'e kaydet (bağlantı ayarını değiştirir)" seçeneği, `İptal` / `Bağlan`.
- [ ] Oturumluk sır süreç belleğindeki bir haritada tutuluyor. Bağlantı kesilse ya da düşse yeniden sorulmuyor; yalnızca `28P01`'de siliniyor ve soruluyor.
- [ ] Sunucu sırrı olmayan bir bağlantıda yapısal bir "şifre gerekli" hatası döndürüyor; arayüz pencereyi açıp şifreyi REST ile gönderiyor.
- [ ] Server testleri `28P01` sonrası yeniden sormayı, web testleri pencereyi sınıyor.
