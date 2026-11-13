# 15: "Bekletiyorsun" göstergesi

Spec: [İkinci dilim spec'i](../../ikinci-dilim/spec.md) · Kararlar: harita Q17

**What to build:** Transaction modunda karar beklerken ve Okuma modunda transaction açıkken, karar kartında (Okuma'da durum satırında) "⚠ N oturumu bekletiyorsun" görünür; üzerine gelince bekletilen oturumların listesi (pid, kullanıcı, uygulama, bekleme türü, sorgunun başı, süre) açılır. Yetkiden gelmeyen alanlar "görünmüyor" yazar. İptal/sonlandırma yok.

**Blocked by:** 03

**Status:** done (0fa9bef)

- [x] server bekletme izleyicisi: transaction karar/Okuma'da açıkken 5 sn'de bir kısa süreli client ile `pg_stat_activity` + `$1 = ANY(pg_blocking_pids(pid))` (`$1` = çalıştırmanın backend pid'i); `left(query, 200)`, süre. Havuz doluysa tik atlanıyor.
- [x] Sonuç değişince `bekletilenler{oturumlar}` olayı; transaction kapanınca izleme duruyor ve boş liste gidiyor.
- [x] core çalıştırma görünümü olayı taşıyor; web göstergesi ve liste; NULL alanlar "görünmüyor"; sayı yetkiden bağımsız doğru.
- [x] Testler: server'da gerçek PG ile ikinci client'ı kilitte bekletip olay, kapanınca boş liste (sahte saat ile tik); web'de sayı, liste, "görünmüyor".

**Notlar (uygulama):**

- core `src/core/bekletme.ts`: sorgu, satır ayrıştırma (`<insufficient privilege>` → NULL), değişim karşılaştırması, "görünmüyor" ve süre biçimi. Server `src/server/bekletme-izleyicisi.ts`; çalıştırıcı karar/Okuma başlayınca başlatır, karar verilince (ya da `finally`'de) durdurur. İlk tik 5 sn sonra.
- Süre karşılaştırmaya dahil: bekletilen varken her tikte olay gider (süre taze kalsın). Boş liste kapanışta yalnızca son liste boş değilse gider. Spec 243/250 buna göre yeniden yazıldı.
- Havuz: `withClient`'a `ifFree` (tüm client'lar kullanımdaysa `PoolBusyError`, tik atlanır). Ayrıca kısa süreli client'a sorgu sürerken bağlantı düşünce süreci çökerten eksik `error` dinleyicisi eklendi (izleyici bu yolu 5 sn'de bir kullanıyor).
- Testler: `src/server/bekletme.test.ts` (sahte PG + sahte saat; gerçek PG testi `npm run test:pg` ile koşturuldu ve geçti), core tablo testleri, `ScriptEkrani.test.tsx` gösterge testleri.
