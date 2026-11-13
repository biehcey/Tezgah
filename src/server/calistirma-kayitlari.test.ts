import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { historyFileName, parseRecords, type RunRecord } from '../core/calistirma-kaydi';
import { startFakePostgres, type FakePostgres } from './test/sahte-postgres';
import { createFakeClock, type FakeClock } from './test/sahte-saat';
import { startTestServer, type TestServer, type TestSocket } from './test/sunucu';
import { addFakeConnection, settle } from './test/yardimcilar';

const DK = 60_000;
/** Sahte sunucunun her sorguya döndürdüğü satır; kayda hiç girmemeli. */
const ROW_VALUE = 'satir-verisi-asla-yazilmaz';

let t: TestServer;
let ws: TestSocket;
let fake: FakePostgres;
let clock: FakeClock;
let opened: string[];

beforeEach(async () => {
  fake = await startFakePostgres({ password: 'gizli' });
  fake.names = [ROW_VALUE];
  clock = createFakeClock();
  opened = [];
  t = await startTestServer({ clock, openFolder: (dir) => void opened.push(dir) });
  ws = await t.socket();
});
afterEach(async () => {
  ws.close();
  await t.close();
  await fake.close();
});

const historyDir = () => join(t.configDir, 'history');

const createConnection = (fields: Record<string, unknown> = {}) => addFakeConnection(t, fake.port, fields);

const run = (connectionId: string, script: string) => ws.send({ type: 'run', target: { connectionId, database: 'postgres' }, script });

async function historyText(): Promise<string> {
  const files = await readdir(historyDir());
  expect(files).toEqual([historyFileName(new Date())]);
  return readFile(join(historyDir(), files[0]!), 'utf8');
}

/** Kayıtlar; `bitti` satırı yazılana kadar bekler (soket koptuysa olay gelmez). */
async function records(): Promise<RunRecord[]> {
  for (let i = 0; ; i++) {
    const found = parseRecords(await historyText().catch(() => ''));
    if ((found.length > 0 && found.every((r) => r.bitti)) || i > 100) return found;
    await settle(20);
  }
}

describe('Çalıştırma kaydı', () => {
  it('commit: başladı ve bitti satırları; ifade özetleri; satır verisi yazılmaz', async () => {
    const id = await createConnection();
    const script = 'INSERT INTO t VALUES (1);\nSELECT a FROM t';
    run(id, script);
    await ws.waitFor('kararBekleniyor');
    ws.send({ type: 'commit' });
    await ws.waitFor('bitti');

    const text = await historyText();
    expect(text).not.toContain(ROW_VALUE);
    expect(text.trimEnd().split('\n')).toHaveLength(2);
    const [record] = parseRecords(text);
    expect(record!.basladi).toMatchObject({
      v: 1,
      script,
      hedef: { baglantiId: id, ad: 'Yerel', veritabani: 'postgres', ortam: null },
      mod: 'transaction',
      deneme: false,
      yazmaKilidi: null,
    });
    expect(record!.sonuc).toBe('commit');
    expect(record!.bitti!.ifadeler).toEqual([
      { offset: 0, ms: expect.any(Number), komut: 'SELECT', satirSayisi: 1 },
      { offset: 26, ms: expect.any(Number), komut: 'SELECT', satirSayisi: expect.any(Number) },
    ]);
    expect(Date.parse(record!.bitti!.bitis)).toBeGreaterThanOrEqual(Date.parse(record!.bitti!.baslangic));
  });

  it('hatalı ifade ve rollback: hata kodu, mesajı ve satırı; çalıştırılmayanlar yazılmaz', async () => {
    const id = await createConnection();
    fake.failOn = (sql) => (sql.startsWith('UPDATE') ? { code: '42P01', message: 'relation "yok" does not exist', position: 8 } : undefined);
    run(id, 'SELECT 1;\nUPDATE yok SET a = 1;\nSELECT 2');
    await ws.waitFor('kararBekleniyor');
    ws.send({ type: 'rollback' });
    await ws.waitFor('bitti');

    const [record] = await records();
    expect(record!.sonuc).toBe('rollback');
    expect(record!.bitti!.ifadeler.map(({ offset, hata }) => ({ offset, hata }))).toEqual([
      { offset: 0, hata: undefined },
      { offset: 10, hata: { kod: '42P01', mesaj: 'relation "yok" does not exist', satir: 2 } },
    ]);
  });

  it('Karar süresi dolunca karar-suresi-doldu', async () => {
    run(await createConnection(), 'UPDATE t SET a = 1');
    await ws.waitFor('kararBekleniyor');
    clock.advance(30 * DK);
    await ws.waitFor('bitti');
    expect((await records()).map((r) => r.sonuc)).toEqual(['karar-suresi-doldu']);
  });

  it('karar beklenirken soket koparsa kopma-rollback', async () => {
    run(await createConnection(), 'UPDATE t SET a = 1');
    await ws.waitFor('kararBekleniyor');
    ws.terminate();
    expect((await records()).map((r) => r.sonuc)).toEqual(['kopma-rollback']);
  });

  it('Autocommit: uygulanan script commit, hatada duran hata; mod autocommit', async () => {
    const id = await createConnection();
    run(id, 'VACUUM t');
    await ws.waitFor('bitti');
    fake.failOn = (sql) => (sql === 'VACUUM b' ? { code: '42P01', message: 'yok' } : undefined);
    run(id, 'VACUUM a;\nVACUUM b;\nVACUUM c');
    await ws.waitFor('bitti', (e) => e.sonuc === 'autocommit' && e.ozet?.hatali === 1);

    const found = await records();
    expect(found.map((r) => [r.basladi.mod, r.sonuc, r.bitti!.ifadeler.length])).toEqual([
      ['autocommit', 'commit', 1],
      ['autocommit', 'hata', 2],
    ]);
  });

  it('hedefe bağlanılamazsa hata olarak kaydedilir', async () => {
    const id = await createConnection({ password: 'yanlis' });
    run(id, 'SELECT 1');
    expect(await ws.waitFor('bitti')).toMatchObject({ sonuc: 'hata' });
    const [record] = await records();
    expect(record).toMatchObject({ sonuc: 'hata', bitti: { ifadeler: [], mesaj: expect.any(String) } });
  });

  it('prod hedefte yazma kilidi ve ortam etiketi anlık kopyada', async () => {
    run(await createConnection({ name: 'Canlı', envTag: 'prod' }), 'UPDATE t SET a = 1');
    await ws.waitFor('kararBekleniyor');
    ws.send({ type: 'rollback' });
    await ws.waitFor('bitti');
    const [record] = await records();
    expect(record!.basladi).toMatchObject({ hedef: { ad: 'Canlı', ortam: 'prod' }, yazmaKilidi: 'salt-okunur' });
  });

  it('analizden geçmeyen script çalışmadığı için kaydedilmez', async () => {
    run(await createConnection(), 'BEGIN;\nSELECT 1');
    await ws.waitFor('bitti');
    await expect(readdir(historyDir())).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('yazma hatası çalıştırmayı engellemez; uyarı gider', async () => {
    const id = await createConnection();
    // `history` bir dosya: dizin oluşturulamaz.
    await mkdir(t.configDir, { recursive: true });
    await writeFile(historyDir(), '');
    run(id, 'UPDATE t SET a = 1');
    expect(await ws.waitFor('uyari')).toMatchObject({ tur: 'kayitYazilamadi', mesaj: 'Çalıştırma kaydı yazılamadı' });
    await ws.waitFor('kararBekleniyor');
    ws.send({ type: 'commit' });
    expect(await ws.waitFor('bitti')).toMatchObject({ sonuc: 'commit' });
    expect(ws.events.filter((e) => e.type === 'uyari')).toHaveLength(1);
  });

  it.skipIf(process.platform === 'win32')('dosya POSIX’te 0600', async () => {
    run(await createConnection(), 'VACUUM t');
    await ws.waitFor('bitti');
    const file = join(historyDir(), historyFileName(new Date()));
    expect((await stat(file)).mode & 0o777).toBe(0o600);
  });
});

describe('Çalıştırma kayıtları klasörünü aç', () => {
  it('klasörü oluşturur ve işletim sisteminin dosya yöneticisinde açar', async () => {
    const res = await t.api('POST', '/api/calistirma-kayitlari/klasoru-ac');
    expect(res.status).toBe(200);
    expect(opened).toEqual([historyDir()]);
    expect((await stat(historyDir())).isDirectory()).toBe(true);
  });

  it('yalnızca POST', async () => {
    expect((await t.api('GET', '/api/calistirma-kayitlari/klasoru-ac')).status).toBe(405);
  });
});
