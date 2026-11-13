# 07: Sorgu geçmişi paneli

Spec: [İkinci dilim spec'i](../../ikinci-dilim/spec.md) · Kararlar: harita Q10

**What to build:** Konsolda Ctrl+Alt+E / Cmd+Alt+E ile açılıp kapanan bir yan panel, Çalıştırma kayıtlarını yeniden eskiye listeler. Varsayılan filtre aktif sekmenin hedefidir; tüm hedeflere geçilebilir, metin araması, sonuç ve tarih aralığı filtreleri vardır. Bir kayda çift tıklayınca metni yeni bir sekmede, kaydın hedefiyle açılır.

**Blocked by:** 01

**Status:** done (115b378)

- [x] core geçmiş filtresi: hedef (ya da tümü), metin, sonuç kümesi, tarih aralığı. Sonuç eşlemesi: başarılı = `commit`, Autocommit başarısı, `okuma`; hata = `hata`, `iptal`; deneme = `deneme-rollback`; rollback = `rollback`, `karar-suresi-doldu`, `kopma-rollback`. "bilinmiyor" her zaman görünür. Birim testli.
- [x] server `GET /api/calistirma-kayitlari`: aylık JSONL dosyalarını yeniden eskiye okuyor, filtreyi uyguluyor, sayfa + sonraki imleç dönüyor.
- [x] Panel: kayıt başına zaman, hedef (ortam rengiyle), sonuç, script'in başı; kaydırınca sonraki sayfa.
- [x] Çift tık: yeni konsol sekmesi, kaydın metni ve hedefi; bağlantı silinmişse hedefsiz.
- [x] Testler: core filtre; server'da çok aylık fixture'larla sayfalama ve filtre; web'de kısayol, varsayılan hedef filtresi, çift tıkla yeni sekme.
