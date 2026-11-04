# 15: Deneme: önce/sonra farkı ve DDL şema farkı

Spec: [İlk dilim spec'i](../../ilk-dilim/spec.md) · Kararlar: Deneme modu (wayfinder 16)

**What to build:** PG18+ sunucuda ve PK'lı tabloda deneme, tabloya göre gruplanmış bir önce/sonra farkı gösterir: `+N eklendi · ~N güncellendi · −N silindi`, değişen hücreler vurgulu, eski değer üstü çizili. DDL ifadelerinde tablonun şema farkı görünür. PG18 öncesinde ya da PK'sız tabloda nedenini söyleyen bir notla ticket 14'teki önizlemeye düşülür.

**Blocked by:** 14

**Status:** ready-for-agent

- [ ] Sunucu sürümü ve tablo PK'sı katalogdan tespit ediliyor. PG18+ ve PK varsa `RETURNING old.*, new.*`, yoksa `RETURNING *` kullanılıyor.
- [ ] core fark birleştirme: önce/sonra satırları PK anahtarıyla tablo başına birleştiriliyor. Aynı satıra birden fazla ifade dokunursa ilk "önce" ve son "sonra" alınıyor. Tablo başına sayılar, ilk 100 satır ve değişen kolonlar çıkıyor. Birim testli.
- [ ] DDL: rollback'ten önce katalogdan ilgili tablonun şeması okunup farkı çıkarılıyor (ör. `+ kolon son_giris timestamptz NULL`) ve tablonun bölümünde gösteriliyor.
- [ ] Arayüz: INSERT yeşil, DELETE kırmızı ve üstü çizili, UPDATE'te yalnızca değişen hücreler vurgulu. "… N satır daha" ve yedeğe düşüş notu var.
- [ ] Server testleri, PG18 ise önce/sonra farkını, değilse yedeği sınıyor (sürüme göre koşullu).
