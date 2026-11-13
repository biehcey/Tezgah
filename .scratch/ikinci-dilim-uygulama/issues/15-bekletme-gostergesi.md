# 15: "Bekletiyorsun" göstergesi

Spec: [İkinci dilim spec'i](../../ikinci-dilim/spec.md) · Kararlar: harita Q17

**What to build:** Transaction modunda karar beklerken ve Okuma modunda transaction açıkken, karar kartında (Okuma'da durum satırında) "⚠ N oturumu bekletiyorsun" görünür; üzerine gelince bekletilen oturumların listesi (pid, kullanıcı, uygulama, bekleme türü, sorgunun başı, süre) açılır. Yetkiden gelmeyen alanlar "görünmüyor" yazar. İptal/sonlandırma yok.

**Blocked by:** 03

**Status:** ready-for-agent

- [ ] server bekletme izleyicisi: transaction karar/Okuma'da açıkken 5 sn'de bir kısa süreli client ile `pg_stat_activity` + `$1 = ANY(pg_blocking_pids(pid))` (`$1` = çalıştırmanın backend pid'i); `left(query, 200)`, süre. Havuz doluysa tik atlanıyor.
- [ ] Sonuç değişince `bekletilenler{oturumlar}` olayı; transaction kapanınca izleme duruyor ve boş liste gidiyor.
- [ ] core çalıştırma görünümü olayı taşıyor; web göstergesi ve liste; NULL alanlar "görünmüyor"; sayı yetkiden bağımsız doğru.
- [ ] Testler: server'da gerçek PG ile ikinci client'ı kilitte bekletip olay, kapanınca boş liste (sahte saat ile tik); web'de sayı, liste, "görünmüyor".
