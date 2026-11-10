import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseRecords, type RunRecord } from '../core/calistirma-kaydi';
import { DENEME_READ_MESSAGE } from '../core/yazma-kilidi';
import type { ServerEvent } from '../core/script-calistirma';
import { startFakePostgres, type FakePostgres } from './test/sahte-postgres';
import { createFakeClock, type FakeClock } from './test/sahte-saat';
import { startTestServer, type TestServer, type TestSocket } from './test/sunucu';

const DK = 60_000;

let t: TestServer;
let ws: TestSocket;
let fake: FakePostgres;
let clock: FakeClock;

beforeEach(async () => {
  fake = await startFakePostgres({ password: 'gizli' });
  clock = createFakeClock();
  t = await startTestServer({ clock });
  ws = await t.socket();
});
afterEach(async () => {
  ws.close();
  await t.close();
  await fake.close();
});

async function createConnection(fields: Record<string, unknown> = {}): Promise<string> {
  const res = await t.api('POST', '/api/baglantilar', {
    name: 'Yerel',
    host: '127.0.0.1',
    port: fake.port,
    user: 'postgres',
    password: 'gizli',
    sslmode: 'disable',
    ...fields,
  });
  expect(res.status).toBe(201);
  return res.body.connection.id;
}

const run = (connectionId: string, script: string, extra: Record<string, unknown> = {}) =>
  ws.send({ type: 'run', target: { connectionId, database: 'postgres' }, script, ...extra });

/** Kayıtlar; `bitti` satırı yazılana kadar bekler (soket koptuysa olay gelmez). */
async function records(count = 1): Promise<RunRecord[]> {
  const dir = join(t.configDir, 'history');
  for (let i = 0; ; i++) {
    const files = await readdir(dir).catch(() => []);
    const texts = await Promise.all(files.map((f) => readFile(join(dir, f), 'utf8')));
    const found = parseRecords(texts.join(''));
    if ((found.length >= count && found.every((r) => r.bitti)) || i > 100) return found;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function eventually(check: () => boolean) {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('koşul sağlanmadı');
}

const sequence = (events: ServerEvent[]) => events.map((e) => ('i' in e ? `${e.type}:${e.i}` : e.type));
const rollbacks = () => fake.queries.filter((q) => q === 'ROLLBACK').length;

describe('Okuma modu: sahte Postgres', () => {
  it('Okuma script’i BEGIN READ ONLY ile çalışır; karar sorulmaz, transaction okumaAcik ile açık kalır', async () => {
    run(await createConnection(), 'SELECT 1;\nSHOW search_path');
    expect(await ws.waitFor('okumaAcik')).toEqual({ type: 'okumaAcik', kalanMs: 30 * DK });
    expect(sequence(ws.events)).toEqual(['analiz', 'started:0', 'done:0', 'started:1', 'done:1', 'okumaAcik']);
    expect(ws.events[0]).toMatchObject({ mod: 'okuma' });
    expect(fake.queries.slice(0, 2)).toEqual(['BEGIN READ ONLY', `SET LOCAL idle_in_transaction_session_timeout = ${31 * DK}`]);
    expect(rollbacks()).toBe(0);
  });

  it('ortam etiketinden bağımsız: prod’da yazma modu açıkken de BEGIN READ ONLY; Karar süresi prod’unki', async () => {
    run(await createConnection({ envTag: 'prod' }), 'SELECT 1', { yazmaModu: true });
    expect(await ws.waitFor('okumaAcik')).toEqual({ type: 'okumaAcik', kalanMs: 5 * DK });
    expect(fake.queries[0]).toBe('BEGIN READ ONLY');
  });

  it('Karar süresi dolunca rollback; sonuç ve kayıt okuma', async () => {
    run(await createConnection(), 'SELECT 1');
    await ws.waitFor('okumaAcik');
    clock.advance(30 * DK - 1);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(ws.events.some((e) => e.type === 'bitti')).toBe(false);

    clock.advance(1);
    expect(await ws.waitFor('bitti')).toMatchObject({ sonuc: 'okuma' });
    expect(rollbacks()).toBe(1);
    expect((await records()).map((r) => [r.basladi.mod, r.sonuc])).toEqual([['okuma', 'okuma']]);
  });

  it('aynı sokette yeni çalıştırma açık Okuma transaction’ını geri alır, sonra başlar', async () => {
    const id = await createConnection();
    run(id, 'SELECT 1');
    await ws.waitFor('okumaAcik');
    run(id, 'SELECT 2');
    expect(await ws.waitFor('bitti')).toMatchObject({ sonuc: 'okuma' });
    await ws.waitFor('okumaAcik', (e) => ws.events.indexOf(e) > ws.events.findIndex((x) => x.type === 'bitti'));
    expect(sequence(ws.events)).toEqual([
      'analiz',
      'started:0',
      'done:0',
      'okumaAcik',
      'bitti',
      'analiz',
      'started:0',
      'done:0',
      'okumaAcik',
    ]);
    // İlk transaction ikincisi açılmadan kapandı.
    expect(fake.queries.indexOf('ROLLBACK')).toBeLessThan(fake.queries.lastIndexOf('BEGIN READ ONLY'));
    expect((await records()).map((r) => r.sonuc)).toEqual(['okuma', 'bilinmiyor']);
  });

  it('soket kapanınca Okuma transaction’ı geri alınır', async () => {
    run(await createConnection(), 'SELECT 1');
    await ws.waitFor('okumaAcik');
    ws.terminate();
    await eventually(() => rollbacks() === 1);
    expect((await records()).map((r) => r.sonuc)).toEqual(['okuma']);
  });

  it('Okuma açıkken veritabanı bağlantısı koparsa beklenmeden biter; kayıt okuma', async () => {
    run(await createConnection(), 'SELECT 1');
    await ws.waitFor('okumaAcik');
    fake.dropSessions();
    expect(await ws.waitFor('bitti')).toEqual({ type: 'bitti', sonuc: 'okuma', mesaj: "Bağlantı koptu; Okuma transaction'ı kapandı." });
    expect((await records()).map((r) => r.sonuc)).toEqual(['okuma']);
  });

  it('Okuma’da hata: transaction hemen geri alınır; kayıt hata', async () => {
    fake.failOn = (sql) => (sql.includes('nextval') ? { code: '25006', message: 'cannot execute nextval() in a read-only transaction' } : undefined);
    run(await createConnection(), "SELECT 1;\nSELECT nextval('s')");
    expect(await ws.waitFor('error')).toMatchObject({ i: 1, sqlstate: '25006' });
    expect(await ws.waitFor('bitti')).toMatchObject({ sonuc: 'okuma' });
    expect(ws.events.some((e) => e.type === 'okumaAcik' || e.type === 'kararBekleniyor')).toBe(false);
    expect(rollbacks()).toBe(1);
    expect((await records()).map((r) => r.sonuc)).toEqual(['hata']);
  });

  it('hatadan sonraki geri alma sürerken soket koparsa iptal gönderilmez (çalışan ifade yok)', async () => {
    fake.failOn = (sql) => (sql.includes('nextval') ? { code: '25006', message: 'cannot execute nextval() in a read-only transaction' } : undefined);
    fake.hangOn = (sql) => sql === 'ROLLBACK';
    run(await createConnection(), "SELECT nextval('s')");
    await eventually(() => rollbacks() === 1);
    ws.terminate();
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(fake.queries.filter((q) => q.includes('pg_cancel_backend'))).toEqual([]);
    // Askıdaki ROLLBACK'i bırakır: oturum düşer, çalıştırma biter.
    fake.dropSessions();
    expect((await records()).map((r) => r.sonuc)).toEqual(['hata']);
  });

  it('Okuma’da commit ve rollback istekleri reddedilir', async () => {
    run(await createConnection(), 'SELECT 1');
    await ws.waitFor('okumaAcik');
    ws.send({ type: 'commit' });
    expect(await ws.waitFor('uyari')).toMatchObject({ tur: 'gecersizIstek' });
  });

  it('Okuma script’i denenmez: sunucu da reddeder', async () => {
    run(await createConnection(), 'SELECT 1', { deneme: true });
    expect(await ws.waitFor('bitti')).toEqual({ type: 'bitti', sonuc: 'reddedildi', mesaj: DENEME_READ_MESSAGE });
    expect(fake.queries).toEqual([]);
  });

  describe('zorlaTransaction', () => {
    it('Okuma çıkan script Transaction modunda çalışır ve karar bekler', async () => {
      run(await createConnection(), 'SELECT 1', { zorlaTransaction: true });
      expect(await ws.waitFor('analiz')).toMatchObject({ mod: 'transaction' });
      expect(await ws.waitFor('kararBekleniyor')).toMatchObject({ commitEdilebilir: true });
      expect(fake.queries[0]).toBe('BEGIN');
      ws.send({ type: 'rollback' });
      await ws.waitFor('bitti');
      expect((await records()).map((r) => r.basladi.mod)).toEqual(['transaction']);
    });

    it('salt okunur prod’da Yazma kilidi korunur: BEGIN READ ONLY', async () => {
      run(await createConnection({ envTag: 'prod' }), 'SELECT 1', { zorlaTransaction: true });
      await ws.waitFor('kararBekleniyor');
      expect(fake.queries[0]).toBe('BEGIN READ ONLY');
    });

    it('yalnızca Okuma → Transaction yönünde etkili: Autocommit script’i Autocommit kalır', async () => {
      run(await createConnection(), 'VACUUM t', { zorlaTransaction: true });
      expect(await ws.waitFor('analiz')).toMatchObject({ mod: 'autocommit' });
      expect(await ws.waitFor('bitti')).toMatchObject({ sonuc: 'autocommit' });
    });
  });
});
