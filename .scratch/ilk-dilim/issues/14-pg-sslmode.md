# pg sürücüsünde sslmode davranışı

Type: research
Status: resolved
Blocked by: —

## Question

`pg` (node-postgres) libpq'nun `sslmode` değerlerini (disable / prefer / require / verify-ca / verify-full) nasıl karşılıyor ve [bağlantı modelindeki SSL alanları](08-ssl-alanlari.md) `pg` ayarlarına nasıl eşlenmeli?

Karar için gereken olgular:
- `pg` `prefer`'ı (SSL dene, olmazsa düz) destekliyor mu; desteklemiyorsa ne yapılmalı?
- `require` / `verify-ca` / `verify-full` için `ssl: { rejectUnauthorized, ca, checkServerIdentity }` eşlemesi; connection string `sslmode` parse davranışı ve güncel sürümlerdeki değişiklikler (ör. `uselibpqcompat`).
- SSH tüneli üzerinden bağlanırken `verify-full`'da hostname doğrulaması nasıl yapılır (`servername`)?

## Answer

Bulgular: `research/pg-sslmode` dalı, `research/pg-sslmode.md` (origin'e push'landı, merge edilmez).

- `pg` `prefer`'ı desteklemiyor (SSL reddedilirse düz bağlantıya düşmez). `pg-connection-string` varsayılanda `prefer`/`require`/`verify-ca`'yı `verify-full` gibi ele alıyor; libpq anlamı yalnızca `uselibpqcompat=true` ile (pg@9'da varsayılan olacak).
- **Karar:** connection string kullanılmaz; `ssl` nesnesi `src/core`'da saf, birim testli bir modülde açıkça kurulur:
  - `disable` → `ssl: false`
  - `require` → `rejectUnauthorized: false` (CA verilmişse `verify-ca` gibi)
  - `verify-ca` → CA zorunlu, `checkServerIdentity: () => undefined`
  - `verify-full` → `rejectUnauthorized: true`, `servername: realHost`, `checkServerIdentity` = `tls.checkServerIdentity(realHost, cert)`
- `prefer`'ı Tezgah yapar: önce doğrulamasız SSL, yalnızca "server does not support SSL" hatasında bir kez `ssl: false` ile yeniden dene; bağlanılan modu arayüzde göster; `prod` + `prefer` uyarı verir.
- SSH tünelinde `pg`, `host` hostname ise `servername`'i ezer → hostname doğrulaması her zaman açık `checkServerIdentity(realHost)` ile.
- ssh2 kanalı `pg`'ye stream olarak verilirken sarmalayıcı gerekir (`pg` `stream.connect` çağırır) — [SSH tüneli yaşam döngüsü](17-ssh-tunel-yasam-dongusu.md) için not.
- PG17 direct SSL (`sslnegotiation: 'direct'`, pg ≥ 8.22.0): kapsam dışı bırakıldı.
- Doğrulanamayan: `uselibpqcompat`'ın hangi `pg-connection-string` sürümüyle çıktığı.
