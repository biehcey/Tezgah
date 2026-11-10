import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SSL, type Connection } from '../core/baglanti';
import { createPoolManager, type PoolManager } from './havuzlar';
import { createSessionPasswords } from './oturum-sifreleri';
import { createFakeKeychain } from './test/sahte-keychain';
import { startFakePostgres, type FakePostgres } from './test/sahte-postgres';
import { createFakeClock } from './test/sahte-saat';

let fake: FakePostgres;
let pools: PoolManager;
let connection: Connection;

beforeEach(async () => {
  fake = await startFakePostgres({ password: 'gizli' });
  const sessionPasswords = createSessionPasswords();
  sessionPasswords.remember('b1', 'gizli');
  pools = createPoolManager({
    keychain: createFakeKeychain(),
    sessionPasswords,
    clock: createFakeClock(),
    openTunnel: () => Promise.reject(new Error('tünel yok')),
    log: () => {},
  });
  connection = {
    ...DEFAULT_SSL,
    sslmode: 'disable',
    id: 'b1',
    name: 'Yerel',
    folderId: null,
    host: '127.0.0.1',
    port: fake.port,
    user: 'postgres',
    database: 'postgres',
    envTag: null,
    color: null,
    savePassword: false,
    ssh: null,
    databaseSelection: [],
  };
});
afterEach(async () => {
  await pools.closeAll();
  await fake.close();
});

describe('havuz yöneticisi kapanınca', () => {
  it('yeni client istenirse hedefe bağlanmadan reddedilir; kapanmayan pool kalmaz', async () => {
    await pools.withClient(connection, 'postgres', (c) => c.query('SELECT 1'));
    await pools.closeAll();
    const attempts = fake.attempts.length;

    // Ör. kapanış sırasında kopan soketin iptal sorgusu.
    await expect(pools.withClient(connection, 'postgres', (c) => c.query('SELECT 2'))).rejects.toThrow();
    expect(fake.attempts.length).toBe(attempts);
    expect(fake.queries).not.toContain('SELECT 2');
  });
});
