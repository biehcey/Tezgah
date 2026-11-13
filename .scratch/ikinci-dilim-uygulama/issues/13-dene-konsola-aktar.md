# 13: Dene ve Konsola aktar

Spec: [İkinci dilim spec'i](../../ikinci-dilim/spec.md) · Kararlar: harita Q19

**What to build:** Tablo sekmesindeki bekleyen değişiklikler "Dene" ile Deneme modunda çalıştırılıp (PG18'de önce/sonra farkıyla) gösterilir, ya da "Konsola aktar" ile aynı hedefte yeni bir konsol sekmesine üretilen SQL olarak taşınır. Dene prod 🔒 iken de kullanılabilir.

**Blocked by:** 11

**Status:** done (6a29701)

- [x] Dene: üretilen script Deneme modunda, `beklenenSatir: 1` ile; sonuç Değişiklikler sekmesinde; bekleyenler kalıyor.
- [x] Konsola aktar: yeni konsol sekmesi, aynı hedef, metin = önizlemedeki SQL; bekleyenler Tablo sekmesinde kalıyor.
- [x] Prod 🔒 iken Dene açık, Uygula kapalı.
- [x] Testler: web'de Dene akışı (sahte olaylarla) ve Konsola aktar; server'da Deneme + `beklenenSatir` birlikte.
