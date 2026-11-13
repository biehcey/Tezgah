# 11: Hücre düzenleme ve Uygula

Spec: [İkinci dilim spec'i](../../ikinci-dilim/spec.md) · Kararlar: harita Q18, Q19, Q20, Q21; [02 Grid davranış ayrıntıları](../../ikinci-dilim/issues/02-grid-davranis-ayrintilari.md) Q4

**What to build:** PK'lı bir tablonun Tablo sekmesinde hücreler düzenlenir. Değişiklikler Bekleyen değişiklik olarak birikir; sağ sütunda liste ve üretilen SQL sürekli görünür. "Uygula" bu SQL'i bu sekmede mevcut Script çalıştırıcıyla Transaction modunda, her ifade tam 1 satır etkileyecek şekilde çalıştırır (karar kartı, Karar süresi, Çalıştırma kaydı; ek onay yok). Commit sonrası sayfa yeniden çekilir; rollback/hata sonrası bekleyenler kalır.

**Blocked by:** 06, 09

**Status:** done (670afe0)

- [x] PK'sız tabloda ve konsol sonuçlarında düzenleme kapalı (nedeni görünür).
- [x] Düzenleyici: hücrenin üstünde büyüyen `<textarea>`; F2, çift tık ya da yazmaya başlama açar; Enter kaydet + aşağı, Shift+Enter yeni satır, Esc vazgeç, Tab/Shift+Tab kaydet + yana. Tüm tipler ham metin.
- [x] core Bekleyen değişiklik deposu (bu ticket'ta hücre düzenlemesi): aynı hücreye çoklu düzenleme birleşiyor, orijinale dönen hücre düşüyor; `UPDATE "s"."t" SET <yalnızca değişen kolonlar> WHERE <tüm PK kolonları = orijinal>`; değerler literal (ticket 06 üreticisi); her ifadenin hangi değişikliğe ait olduğu biliniyor. Birim testli.
- [x] `run` mesajında `beklenenSatir: 1`: etkilenen satır 1 değilse `satirSayisi` hata türü, "Satır değişmiş ya da silinmiş (N satır etkilendi)", çalıştırma duruyor, yalnızca Rollback; hatalı ifade grid'de satıra işaretleniyor.
- [x] Sağ sütun: Bekleyen değişiklikler + SQL önizlemesi + Uygula + karar kartı. Değişen hücreler grid'de işaretli.
- [x] Prod 🔒 iken Uygula devre dışı, yanında tek tık Yazma kilidi.
- [x] Commit → sayfa yeniden çekiliyor, bekleyenler temizleniyor; rollback/hata → kalıyor. Bekleyenler diske yazılmıyor; varken sekme kapatılırsa uyarı.
- [x] Testler: core depo; server'da `beklenenSatir` (0 ve 2 satır); web'de düzenleme tuşları, önizleme, prod'da Uygula, commit/rollback sonrası durum, kapatma uyarısı.
