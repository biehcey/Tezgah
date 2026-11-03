# Paket yapısı ve build/dev akışı

Type: grilling
Status: resolved
Blocked by: —

## Question

npx ile dağıtılan tek paket mi, backend/frontend ayrı workspace mi; build ve dev akışı nasıl?

## Answer

Workspace yok, **tek npm paketi**:

- `src/core`: saf mantık (lexer/bölme, transaction dışı komut tanıma, içe aktarma ayrıştırıcıları). Node/DOM bağımlılığı yok; Vitest.
- `src/server`: Node, `pg`, keychain, ssh.
- `src/web`: React + CodeMirror 6, Vite.
- Sınır lint kuralıyla korunur: `core` → `server`/`web` import edemez.
- Build: Vite → `dist/web`, tsup → `dist/server`; `bin` → `dist/server/cli.js`; sunucu `dist/web`'i statik servis eder.
- Dev: `vite dev` + `tsx watch` server; Vite `/api` ve `/ws`'i proxy'ler.
- Minimum Node 22 LTS.

Çizim oturumunda (2026-11-03) kararlaştırıldı.

### Ek (2026-11-03): ssh2 bundle'lanır

[npx kurulumunda ssh2 native derleme davranışı](19-npx-ssh2-kurulum.md) sonucunda: `ssh2` runtime bağımlılığı değil, `devDependencies`'te; tsup `noExternal: ['ssh2']` ile `dist/server`'a gömer, `external: [/\.node$/, 'cpu-features']`. Kurulumda node-gyp çalışmaz; ssh2 her zaman saf JS/Node `crypto` yolunu kullanır. Gömülen paketlerin MIT lisans metinleri dağıtıma eklenir.
