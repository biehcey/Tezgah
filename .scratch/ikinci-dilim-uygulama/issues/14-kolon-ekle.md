# 14: "+ Kolon" (ALTER TABLE ADD COLUMN)

Spec: [İkinci dilim spec'i](../../ikinci-dilim/spec.md) · Kararlar: harita Q22

**What to build:** Tablo sekmesi başlığındaki "+ Kolon" sağ sütunda ad, tip (tamamlamalı), NULL/NOT NULL ve varsayılan ifade alanlı bir form açar; `ALTER TABLE "s"."t" ADD COLUMN …` önizlemesi her tuşta güncellenir. Uygula/Dene/Konsola aktar düzenlenebilir grid'deki gibi çalışır; Dene DDL şema farkını gösterir. Volatile varsayılan ve boş olmayan tabloda varsayılansız NOT NULL için engellemeyen uyarılar çıkar.

**Blocked by:** 13

**Status:** done

- [x] core ALTER üretici + doğrulama (boş ad/tip, var olan kolon adı). Birim testli.
- [x] core lint: varsayılan ifadedeki fonksiyon adları lexer ile çıkarılıyor; oynaklık `v` ise "Tablo yeniden yazılır"; NOT NULL + varsayılansız + ilk sayfada satır var ise "Boş olmayan tabloda hata verecek". Engellemiyor.
- [x] server fonksiyon oynaklığı ucu: hedef + adlar → ad başına `i|s|v` (`pg_proc`), kısa süreli client; form debounce ile soruyor.
- [x] Tip önerileri: sabit yaygın tip listesi + katalogdaki kullanıcı tipleri.
- [x] Commit sonrası katalog (`katalogYenilendi`) ve Tablo sekmesi yeniden çekiliyor; yeni kolon görünüyor.
- [x] Kolon silme, yeniden adlandırma ve tip değiştirme yok.
- [x] Testler: core üretici ve lint; server oynaklık ucu; web'de canlı önizleme ve uyarılar.
