# 01: İskelet ve yerel güvenlik

Spec: [İlk dilim spec'i](../../ilk-dilim/spec.md) · Kararlar: ADR-0001, Paket yapısı (wayfinder 01), Yerel güvenlik (02), npx ssh2 kurulumu (19)

**What to build:** Geliştirici `npx` ile Tezgah'ı başlatır. Sunucu yalnızca `127.0.0.1`'e bağlanır, tarayıcıyı token'lı URL ile açar ve aynı URL'i terminale yazar. Tarayıcı boş Tezgah arayüzünü görür. Başka bir origin'den, yanlış `Host` başlığıyla ya da cookie'siz gelen istekler reddedilir. Bu ticket sonraki tüm ticket'ların dayandığı paket yapısını ve üç katmanın test altyapısını kurar.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Workspace'siz tek npm paketi; core, server ve web katmanları ayrı. core'un server'ı ya da web'i import etmesi lint hatası veriyor.
- [ ] Vite web'i, tsup server'ı derliyor; `bin` CLI'a işaret ediyor ve server derlenmiş web'i statik servis ediyor. Dev modunda Vite `/api` ve `/ws`'i `tsx watch` ile çalışan sunucuya proxy'liyor. `engines` Node ≥ 22.
- [ ] tsup yapılandırması `ssh2`'yi gömmeye hazır: `noExternal` listesi ve native `.node`/`cpu-features` için `external`. Paket henüz eklenmese de yapı yerinde.
- [ ] Açılışta 32 baytlık rastgele token ve rastgele port üretiliyor; sabit port bayrağı var. Sunucu yalnızca `127.0.0.1`'e bağlanıyor ve açılışta hiçbir veritabanına bağlanmıyor.
- [ ] `?t=<token>` → `HttpOnly; SameSite=Strict; Path=/` cookie → token'sız URL'e 302. Yanlış token reddediliyor.
- [ ] Her istek (WS upgrade dahil) cookie'yi sabit zamanlı karşılaştırmayla doğruluyor. `Host` yalnızca `127.0.0.1:<port>` ya da `localhost:<port>` olabilir. Durum değiştiren isteklerde ve WS upgrade'de aynı-origin `Origin` zorunlu. Hiçbir CORS başlığı gönderilmiyor.
- [ ] Test altyapısı: core için Vitest; server için sunucuyu test içinde başlatan bir yardımcı (`TEZGAH_TEST_PG_URL` yoksa PG testleri atlanıyor); web için Vitest + Testing Library + jsdom ve sahte bir API istemci katmanı.
- [ ] Server entegrasyon testleri yukarıdaki güvenlik kurallarının her birini HTTP sınırından sınıyor.
