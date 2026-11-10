import { readFile, readdir, stat, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { TABS_VERSION } from '../core/konsol-sekmeleri';
import { startTestServer, type TestServer } from './test/sunucu';

const URL = '/api/konsol-sekmeleri';

const TABS = {
  version: TABS_VERSION,
  aktif: 's2',
  sekmeler: [
    { id: 's1', tur: 'konsol', hedef: null, metin: '' },
    { id: 's2', tur: 'konsol', hedef: { connectionId: 'p1', database: 'app', schema: null }, metin: 'SELECT 1' },
  ],
};

let t: TestServer | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

describe('Konsol sekmeleri deposu', () => {
  it('dosya yokken boş sekme listesi döner ve hiçbir şey yazılmaz', async () => {
    t = await startTestServer();
    expect(await t.api('GET', URL)).toEqual({ status: 200, body: { version: TABS_VERSION, sekmeler: [], aktif: null } });
    await expect(readdir(t.configDir)).rejects.toThrow();
  });

  it('yazılan sekmeler geri okunur; tezgah.json dışında bir konsol dizinine yazılır', async () => {
    t = await startTestServer();
    expect((await t.api('PUT', URL, TABS)).status).toBe(200);
    expect((await t.api('GET', URL)).body).toEqual(TABS);
    expect(await readdir(t.configDir)).toEqual(['konsol']);
    expect(JSON.parse(await readFile(join(t.configDir, 'konsol', 'sekmeler.json'), 'utf8'))).toEqual(TABS);
  });

  it('atomik yazar: ardışık yazmalardan sonuncusu kalır, geçici dosya bırakılmaz', async () => {
    t = await startTestServer();
    const writes = Array.from({ length: 5 }, (_, i) =>
      t!.api('PUT', URL, { ...TABS, sekmeler: [{ id: 's1', tur: 'konsol', hedef: null, metin: `SELECT ${i}` }] }),
    );
    await Promise.all(writes);
    expect(await readdir(join(t.configDir, 'konsol'))).toEqual(['sekmeler.json']);
    expect((await t.api('GET', URL)).body.sekmeler[0].metin).toBe('SELECT 4');
  });

  it.skipIf(process.platform === 'win32')('dosya POSIX\'te yalnızca kullanıcının okuyabileceği izinle (0600) yazılır', async () => {
    t = await startTestServer();
    await t.api('PUT', URL, TABS);
    expect((await stat(join(t.configDir, 'konsol', 'sekmeler.json'))).mode & 0o777).toBe(0o600);
  });

  it('bozuk sekme ve biçim dışı alanlar (Yazma kilidi) yazılmaz', async () => {
    t = await startTestServer();
    const body = { ...TABS, sekmeler: [{ ...TABS.sekmeler[1], yazmaModu: true }, { id: 'bozuk', tur: 'konsol' }] };
    expect((await t.api('PUT', URL, body)).body.sekmeler).toEqual([TABS.sekmeler[1]]);
    const file = await readFile(join(t.configDir, 'konsol', 'sekmeler.json'), 'utf8');
    expect(file).not.toMatch(/yazmaModu|bozuk/);
  });

  it('daha yeni sürümlü dosya okunmaz ve üzerine yazılmaz', async () => {
    t = await startTestServer();
    await mkdir(join(t.configDir, 'konsol'), { recursive: true });
    const newer = JSON.stringify({ version: TABS_VERSION + 1, sekmeler: [] });
    await writeFile(join(t.configDir, 'konsol', 'sekmeler.json'), newer);
    const read = await t.api('GET', URL);
    expect(read.status).toBe(500);
    expect(read.body.hata).toMatch(/daha yeni/);
    expect((await t.api('PUT', URL, TABS)).status).toBe(409);
    expect(await readFile(join(t.configDir, 'konsol', 'sekmeler.json'), 'utf8')).toBe(newer);
  });

  it('nesne olmayan gövde reddedilir', async () => {
    t = await startTestServer();
    expect((await t.api('PUT', URL, [])).status).toBe(400);
  });
});
