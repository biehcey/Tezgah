# 09: Tablo sekmesi: açma ve sayfalama

Spec: [İkinci dilim spec'i](../../ikinci-dilim/spec.md) · Kararlar: harita Q13, Q14, Q16

**What to build:** Veritabanı panelinde bir şema çipine tıklayınca o şemanın tablo listesi (filtre kutulu) açılır; bir tabloya tıklayınca editörsüz bir Tablo sekmesinde ilk sayfa görünür. Başlıkta `≈ N satır` (ya da "≈ bilinmiyor") yazar. Kaydırdıkça sonraki sayfalar gelir: PK'lı tabloda PK sırasıyla keyset, PK'sızda OFFSET (tutarlılık garanti değil notuyla). Her sayfa kısa, ayrı, `BEGIN READ ONLY` bir sorgudur; açık transaction tutulmaz. Tablo sekmesi diske yazılır ve geri gelir ama bağlanmaz.

**Blocked by:** 01, 04, 08

**Status:** done (c49888c)

- [x] core tablo sayfası SQL'i: keyset `(pk…) > ($…) ORDER BY pk… LIMIT 500` (tek ve çok kolonlu PK), aksi hâlde `LIMIT 500 OFFSET n` + tutarlılık notu; `reltuples = -1` → "≈ bilinmiyor". Birim testli.
- [x] server tablo sayfası ucu: kısa süreli client, her ortamda `BEGIN READ ONLY`, tek ifade extended protocol ile parametreli, `COMMIT`; ham metin; Çalıştırma kaydına yazılmıyor.
- [x] Veritabanı panelinde şema çipi → tablo listesi (katalogdan, filtre kutulu) → Tablo sekmesi.
- [x] Tablo sekmesi: başlık (tablo adı, `≈ N satır`, ↻), grid (ticket 04), sona yaklaşınca sonraki sayfa, 100.000 sınırı.
- [x] Kalıcılık: hedef + şema + tablo diske yazılıyor; geri gelen Tablo sekmesi "Yükle" gibi açık bir eylemle veri çekiyor.
- [x] Testler: core; server'da keyset/OFFSET, salt okunurluk, prod'da okuma, kayda yazılmama; web'de liste → sekme, başlık sayısı, sayfalama, geri gelen sekmede istek gitmemesi.
