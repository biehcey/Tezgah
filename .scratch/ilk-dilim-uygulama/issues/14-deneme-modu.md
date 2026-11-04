# 14: Deneme modu: her zaman rollback ve ifade başına önizleme

Spec: [İlk dilim spec'i](../../ilk-dilim/spec.md) · Kararlar: Deneme modu (wayfinder 16), Transaction dışı komutlar (15), Script ekranı (23)

**What to build:** Geliştirici ⟲ Dene'ye basar. Script Transaction modunda çalışır ve sonunda her zaman geri alınır. Değişiklikler sekmesinde her DML ifadesi için `RETURNING *` önizlemesi görünür: UPDATE'te yeni hâl, INSERT'te eklenen, DELETE'te silinen satır. Transaction dışı komut içeren script denemede çalıştırılmaz.

**Blocked by:** 11

**Status:** ready-for-agent

- [ ] `run{deneme: true}`: son ifadeden ya da hatadan hemen sonra beklemeden rollback yapılıyor; karar kartı yerine "deneme geri alındı" özeti gösteriliyor.
- [ ] core DML yeniden yazımı INSERT/UPDATE/DELETE'e `RETURNING *` ekliyor; kullanıcı zaten `RETURNING` yazmışsa ifadeye dokunulmuyor ve kendi sonucu gösteriliyor. Birim testli.
- [ ] İfade başına en fazla 100 satır; fazlası sunucudan çekilmiyor. Satır sayısı her durumda gösteriliyor.
- [ ] Sekmeler: denemede *Değişiklikler* (varsayılan) + *Log*, normal çalıştırmada yalnızca *Log*. SELECT sonuçları Log'da.
- [ ] Transaction dışı ifade içeren script denemede reddediliyor ve ifadeler işaretleniyor.
- [ ] Hata durumunda banner'da hatalı satır ve SQLSTATE, altında hataya kadar olan önizlemeler; sonuç her durumda rollback.
- [ ] Server testleri verinin değişmeden kaldığını ve önizleme olaylarını sınıyor.
