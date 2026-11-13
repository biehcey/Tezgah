# 04: Salt okunur sonuç grid'i

Spec: [İkinci dilim spec'i](../../ikinci-dilim/spec.md) · Kararlar: harita Q7, Q11; [01 Grid kütüphanesi](../../ikinci-dilim/issues/01-grid-kutuphanesi.md), [02 Grid davranış ayrıntıları](../../ikinci-dilim/issues/02-grid-davranis-ayrintilari.md)

**What to build:** Script'teki her SELECT'in sonucu editörün altında kendi sonuç sekmesinde, ilk 500 satırla, sanallaştırılmış salt okunur bir grid'de açılır. Yeniden çalıştırınca eski sonuç sekmeleri silinir. Sağ sütun (karar kartı + zaman çizelgesi) aynen kalır. Grid'de klavyeyle gezinilir, aralık seçilir ve Ctrl/Cmd+C ile başlıksız TSV kopyalanır.

**Blocked by:** None (can start immediately)

**Status:** done (4cf9d20)

- [x] Yeni bağımlılık `@tanstack/react-virtual`; kendi DOM grid'imiz, yalnızca satır sanallaştırması, sabit satır yüksekliği.
- [x] core grid temeli (saf, birim testli): seçim/gezinme (oklar, Shift+ok, Home/End, Ctrl+Home/End, PageUp/PageDown, Tab), hücre gösterimi (`…` kırpma, `↵`, ilk 1000 karakter, NULL ayrı durum), TSV üretimi (NULL boş; sekme, satır sonu ya da çift tırnak içeren hücre çift tırnak içinde, içteki çift tırnak ikileniyor), sabitler (sayfa 500, sınır 100.000).
- [x] SELECT önizlemesi 500 satır; kolon adlarıyla birlikte tip OID'leri ve `dahaVar` bayrağı geliyor. Deneme önizlemeleri 100 satırda kalıyor.
- [x] Sonuç sekmeleri: SELECT başına bir sekme; yeniden çalıştırmada temizleniyor.
- [x] Hücreler ham metin; NULL boş metinden görsel olarak ayrışıyor. Kolon genişliği başlıktan sürüklenerek ayarlanıyor, ilk genişlik ilk sayfadan ölçülüyor (en fazla ~400 px), diske yazılmıyor.
- [x] F2 / çift tık tam değeri salt okunur `<textarea>`'da gösteriyor.
- [x] Erişilebilirlik: `role="grid"`, toplam bilinmezken `aria-rowcount="-1"`, `aria-rowindex`, `aria-colindex`, `aria-selected`, roving tabindex.
- [x] Testler: core tablo testleri; web'de jsdom'da `initialRect` ile çizim, gezinme, aralık seçimi, Ctrl/Cmd+C (pano sahtesi), sonuç sekmelerinin yeniden çalıştırmada silinmesi.
