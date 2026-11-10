import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startFakePostgres, type FakePostgres } from './test/sahte-postgres';
import { createFakeClock } from './test/sahte-saat';
import { startTestServer, type TestServer, type TestSocket } from './test/sunucu';

let t: TestServer;
let fake: FakePostgres;
let sockets: TestSocket[];

beforeEach(async () => {
  fake = await startFakePostgres({ password: 'gizli' });
  t = await startTestServer({ clock: createFakeClock() });
  sockets = [];
});
afterEach(async () => {
  for (const s of sockets) s.close();
  await t.close();
  await fake.close();
});

async function createConnection(): Promise<string> {
  const res = await t.api('POST', '/api/baglantilar', {
    name: 'Yerel',
    host: '127.0.0.1',
    port: fake.port,
    user: 'postgres',
    password: 'gizli',
    sslmode: 'disable',
  });
  expect(res.status).toBe(201);
  return res.body.connection.id;
}

/** Yeni bir sekmenin soketi (her sekme kendi çalıştırma oturumunu tutar). */
async function tab(): Promise<TestSocket> {
  const ws = await t.socket();
  sockets.push(ws);
  return ws;
}

/** Karar bekleyen (client tutan) bir çalıştırma açar. */
async function openSession(connectionId: string): Promise<TestSocket> {
  const ws = await tab();
  ws.send({ type: 'run', target: { connectionId, database: 'postgres' }, script: 'SELECT 1' });
  await ws.waitFor('kararBekleniyor');
  return ws;
}

describe('Pool sınırı: hedef başına 5 oturum', () => {
  it('6. açık çalıştırma beklemeden havuzDolu koduyla biter ve hiçbir ifade çalışmaz', async () => {
    const id = await createConnection();
    for (let i = 0; i < 5; i++) await openSession(id);

    const sixth = await tab();
    sixth.send({ type: 'run', target: { connectionId: id, database: 'postgres' }, script: 'SELECT 1' });
    expect(await sixth.waitFor('bitti')).toMatchObject({ sonuc: 'hata', kod: 'havuzDolu', oturum: 5, mesaj: expect.stringContaining('5 açık oturum') });
    expect(sixth.events.some((e) => e.type === 'started')).toBe(false);
  });

  it('bir oturum kapanınca yeni çalıştırma başlar', async () => {
    const id = await createConnection();
    const open: TestSocket[] = [];
    for (let i = 0; i < 5; i++) open.push(await openSession(id));

    open[2]!.send({ type: 'rollback' });
    await open[2]!.waitFor('bitti');

    const next = await tab();
    next.send({ type: 'run', target: { connectionId: id, database: 'postgres' }, script: 'SELECT 1' });
    await next.waitFor('kararBekleniyor');
  });

  it('kısa süreli sorgular sınırı doldurmaz: 5 oturum açıkken veritabanı listesi okunur', async () => {
    const id = await createConnection();
    for (let i = 0; i < 5; i++) await openSession(id);

    const res = await t.api('GET', `/api/baglantilar/${id}/veritabanlari`);
    expect(res.status).toBe(200);
  });

  it('5 oturum açıkken çalışan ifade iptal edilebilir', async () => {
    const id = await createConnection();
    for (let i = 0; i < 4; i++) await openSession(id);
    fake.hangOn = (sql) => sql.includes('pg_sleep');
    const slow = await tab();
    // İptal, çalışan oturumdan ayrı bir client ister.
    slow.send({ type: 'run', target: { connectionId: id, database: 'postgres' }, script: 'SELECT pg_sleep(60)' });
    await slow.waitFor('started');
    slow.send({ type: 'iptal' });
    await expect.poll(() => fake.queries.some((q) => q.includes('pg_cancel_backend'))).toBe(true);
    // Sahte sunucu iptali uygulamaz; takılı oturum düşürülür.
    fake.dropSessions();
  });
});
