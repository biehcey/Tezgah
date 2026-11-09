import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startTestServer, type TestServer } from './test/sunucu';

const PGPASS = [
  '*:*:*:postgres:joker',
  'prod-db.internal:5432:*:app:prod-sifre',
  '10.0.4.12:5432:warehouse:etl:etl-sifre',
  '10.0.4.12:5432:staging:etl:etl-sifre-2',
  'localhost:5432:*:postgres:yerel',
].join('\n');

let t: TestServer;
let home: string;
let env: Record<string, string | undefined>;

async function start(platform = 'linux') {
  t = await startTestServer({ homeDir: home, importEnvironment: { platform, env } });
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'tezgah-home-'));
  env = {};
});
afterEach(async () => {
  await t?.close();
  await rm(home, { recursive: true, force: true });
});

const preview = (body: object = {}) => t.api('POST', '/api/ice-aktarma/onizleme', { pgpassPath: null, disabled: [], ...body });
const apply = (body: object) => t.api('POST', '/api/ice-aktarma/uygula', { pgpassPath: null, disabled: [], ...body });
const settings = async () => JSON.parse(await readFile(join(t.configDir, 'tezgah.json'), 'utf8'));

describe('tara ve önizle', () => {
  it('~/.pgpass kendiliğinden taranır; somut satırlar gruplanmış aday, şifre kaynağı satırıyla', async () => {
    await writeFile(join(home, '.pgpass'), PGPASS);
    await start();
    const { status, body } = await preview();
    expect(status).toBe(200);
    expect(body.sources).toEqual([
      {
        id: 'pgpass',
        label: '.pgpass',
        path: join(home, '.pgpass'),
        status: 'ok',
        error: null,
        candidateCount: 4,
        enabled: true,
      },
    ]);
    expect(body.candidates.map((c: { name: string; databases: string[] }) => [c.name, c.databases])).toEqual([
      ['prod-db.internal', ['postgres']],
      ['10.0.4.12', ['warehouse', 'staging']],
      ['localhost', ['postgres']],
    ]);
    // localhost satırı jokerden sonra geldiği için libpq jokeri seçer.
    expect(body.candidates[2].password).toEqual({ label: '.pgpass satır 1', line: 1, wildcard: true });
    expect(body.candidates[1].password).toEqual({ label: '.pgpass satır 3', line: 3, wildcard: false });
    // Şifre değeri hiçbir yerde yok.
    expect(JSON.stringify(body)).not.toMatch(/sifre|joker"|yerel"/);
  });

  it('PGPASSFILE önce gelir; Windows\'ta %APPDATA%\\postgresql\\pgpass.conf aranır', async () => {
    const custom = join(home, 'baska', '.pgpass');
    await mkdir(join(home, 'baska'));
    await writeFile(custom, 'h:5432:*:u:p');
    env.PGPASSFILE = custom;
    await start();
    expect((await preview()).body.sources[0]).toMatchObject({ path: custom, candidateCount: 1 });
    await t.close();

    delete env.PGPASSFILE;
    env.APPDATA = join(home, 'AppData');
    await mkdir(join(home, 'AppData', 'postgresql'), { recursive: true });
    await writeFile(join(home, 'AppData', 'postgresql', 'pgpass.conf'), 'h1:5432:*:u:p\nh2:5432:*:u:p');
    await start('win32');
    expect((await preview()).body.sources[0]).toMatchObject({ label: 'pgpass.conf', candidateCount: 2, status: 'ok' });
  });

  it('dosya yoksa kaynak "missing" ve aday yok', async () => {
    await start();
    const { body } = await preview();
    expect(body.sources[0]).toMatchObject({ status: 'missing', candidateCount: 0 });
    expect(body.candidates).toEqual([]);
  });

  it('yol elle girilebilir; yalnızca .pgpass ve pgpass.conf adlı dosyalar okunur', async () => {
    await writeFile(join(home, 'pgpass.conf'), 'h:5432:*:u:p');
    await writeFile(join(home, 'gizli.txt'), 'h:5432:*:u:p');
    await start();
    expect((await preview({ pgpassPath: join(home, 'pgpass.conf') })).body.candidates).toHaveLength(1);
    const refused = (await preview({ pgpassPath: join(home, 'gizli.txt') })).body;
    expect(refused.sources[0]).toMatchObject({ status: 'error', error: expect.stringMatching(/\.pgpass ya da pgpass\.conf/) });
    expect(refused.candidates).toEqual([]);
    const missing = (await preview({ pgpassPath: join(home, 'yok', '.pgpass') })).body;
    expect(missing.sources[0]).toMatchObject({ status: 'error', error: expect.stringMatching(/bulunamadı/) });
  });

  it('kapatılan kaynağın adayı gelmez; mevcut bağlantıyla eşleşen aday "zaten var" ve seçilmemiş', async () => {
    await writeFile(join(home, '.pgpass'), PGPASS);
    await start();
    await t.api('POST', '/api/baglantilar', { name: 'Yerel', host: 'LOCALHOST', user: 'postgres' });
    const { body } = await preview();
    expect(body.candidates[2]).toMatchObject({ name: 'Yerel', existing: { name: 'Yerel' }, selected: false });
    const off = (await preview({ disabled: ['pgpass'] })).body;
    expect(off.sources[0]).toMatchObject({ enabled: false, candidateCount: 4 });
    expect(off.candidates).toEqual([]);
  });
});

describe('uygula', () => {
  it('seçilenler tek yazmayla eklenir, şifreler keychain\'e kopyalanır; yeni klasör oluşur, yinelenen "ad (2)"', async () => {
    await writeFile(join(home, '.pgpass'), PGPASS);
    await start();
    await t.api('POST', '/api/baglantilar', { name: 'Yerel', host: 'localhost', user: 'postgres' });
    const { body: p } = await preview();
    const [prod, etl, local] = p.candidates;
    const { status, body } = await apply({
      selections: [
        { id: prod.id, name: 'billing-prod', folder: 'Billing', envTag: 'prod' },
        { id: etl.id, name: etl.name, folder: null, envTag: null },
        { id: local.id, name: local.name, folder: null, envTag: null },
      ],
    });
    expect(status).toBe(200);
    expect(body.skipped).toBe(0);
    expect(body.added.map((a: { connection: { name: string }; password: string }) => [a.connection.name, a.password])).toEqual([
      ['billing-prod', 'kaydedildi'],
      ['10.0.4.12', 'kaydedildi'],
      ['Yerel (2)', 'kaydedildi'],
    ]);
    const [billing, warehouse] = body.added.map((a: { connection: unknown }) => a.connection);
    expect(billing).toMatchObject({ envTag: 'prod', color: '#dc2626', savePassword: true, sslmode: 'prefer', ssh: null });
    expect(warehouse.databaseSelection).toEqual([
      { database: 'warehouse', schemas: null },
      { database: 'staging', schemas: null },
    ]);
    expect(body.folders).toEqual([{ id: billing.folderId, name: 'Billing' }]);
    expect(t.keychain.entries.get(billing.id)).toBe('prod-sifre');
    expect(t.keychain.entries.get(warehouse.id)).toBe('etl-sifre');
    expect(t.keychain.entries.get(body.added[2].connection.id)).toBe('joker');
    const saved = await settings();
    expect(saved.connections.map((c: { name: string }) => c.name)).toEqual(['Yerel', 'billing-prod', '10.0.4.12', 'Yerel (2)']);
    expect(saved.folders).toEqual(body.folders);
  });

  it('mevcut klasöre adıyla (büyük/küçük harf duyarsız) eklenir; seçilmeyenler atlanmış sayılır', async () => {
    await writeFile(join(home, '.pgpass'), PGPASS);
    await start();
    const folder = (await t.api('POST', '/api/klasorler', { name: 'Billing' })).body;
    const { body: p } = await preview();
    const { body } = await apply({ selections: [{ id: p.candidates[0].id, name: 'x', folder: 'billing', envTag: null }] });
    expect(body.added[0].connection.folderId).toBe(folder.id);
    expect(body.folders).toEqual([]);
    expect(body.skipped).toBe(2);
  });

  it('keychain yazamazsa bağlantı eklenmiş kalır, "reddedildi" döner ve şifre ilk bağlanmada sorulur', async () => {
    await writeFile(join(home, '.pgpass'), PGPASS);
    await start();
    const { body: p } = await preview();
    t.keychain.deny = true;
    const { status, body } = await apply({ selections: [{ id: p.candidates[0].id, name: 'prod', folder: null, envTag: null }] });
    expect(status).toBe(200);
    expect(body.added[0]).toMatchObject({ password: 'reddedildi', connection: { name: 'prod', savePassword: false } });
    expect((await settings()).connections).toMatchObject([{ name: 'prod', savePassword: false }]);
  });

  it('kaynaklarda olmayan aday 409 döner ve hiçbir şey yazılmaz; geçersiz girdi 400', async () => {
    await writeFile(join(home, '.pgpass'), PGPASS);
    await start();
    const missing = await apply({ selections: [{ id: 'yok', name: 'x', folder: null, envTag: null }] });
    expect(missing.status).toBe(409);
    expect((await t.api('GET', '/api/baglantilar')).body).toEqual([]);
    expect((await apply({ selections: [{ id: 'yok', name: ' ', folder: null, envTag: null }] })).status).toBe(400);
    expect((await apply({ selections: [{ id: 'yok', name: 'x', folder: null, envTag: 'uretim' }] })).status).toBe(400);
  });
});
