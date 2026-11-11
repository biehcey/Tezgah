import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { parseRecords } from '../core/calistirma-kaydi';
import type { ServerEvent } from '../core/script-calistirma';
import { createFakeClock, type FakeClock } from './test/sahte-saat';
import { describePg, pgUrl, startTestServer, type TestServer, type TestSocket } from './test/sunucu';

/** Postgres'in yerleşik tip OID'leri. */
const INT4 = 23;
const TEXT = 25;
const DK = 60_000;

let t: TestServer;
let ws: TestSocket;
let clock: FakeClock;
beforeEach(async () => {
  clock = createFakeClock();
  t = await startTestServer({ clock });
  ws = await t.socket();
});
afterEach(async () => {
  ws.close();
  await t.close();
});

/** Yapılandırma dizinine yazılan Çalıştırma kayıtlarının sonuçları. */
async function recordedResults(): Promise<string[]> {
  const dir = join(t.configDir, 'history');
  const files = await readdir(dir).catch(() => []);
  const texts = await Promise.all(files.map((f) => readFile(join(dir, f), 'utf8')));
  return parseRecords(texts.join('')).map((r) => r.sonuc);
}

/** Olay dizisinin özeti: tür ve (varsa) ifade indeksi. Her çalıştırmanın başındaki `analiz` ayrıca sınanır. */
const sequence = (events: ServerEvent[]) => events.filter((e) => e.type !== 'analiz').map((e) => ('i' in e ? `${e.type}:${e.i}` : e.type));

describe('script çalıştırma: istek doğrulama', () => {
  it('tanınmayan mesaj reddedilir, soket açık kalır', async () => {
    ws.send({ type: 'yok' });
    expect(await ws.waitFor('uyari')).toMatchObject({ tur: 'gecersizIstek' });
  });

  it('bilinmeyen bağlantıda çalıştırma başlamadan biter', async () => {
    ws.send({ type: 'run', target: { connectionId: 'yok', database: 'postgres' }, script: 'SELECT 1' });
    expect(await ws.waitFor('bitti')).toMatchObject({ sonuc: 'hata', mesaj: 'Bağlantı bulunamadı' });
    expect(sequence(ws.events)).toEqual(['bitti']);
  });

  it('sunucu script’i istemciye güvenmeden analiz eder; reddedilen ifade varsa hiçbir şey çalışmaz', async () => {
    ws.send({ type: 'run', target: { connectionId: 'yok', database: 'postgres' }, script: 'BEGIN;\nSELECT 1;\nCOMMIT' });
    expect(await ws.waitFor('analiz')).toEqual({
      type: 'analiz',
      mod: 'transaction',
      transactionDisi: [],
      reddedilenler: [
        { i: 0, neden: 'transaction' },
        { i: 2, neden: 'transaction' },
      ],
    });
    // Bağlantıya bakılmadan reddedilir.
    expect(await ws.waitFor('bitti')).toMatchObject({ sonuc: 'reddedildi' });
  });

  it('Karışık script çalıştırılmadan reddedilir', async () => {
    ws.send({ type: 'run', target: { connectionId: 'yok', database: 'postgres' }, script: 'INSERT INTO t VALUES (1);\nVACUUM t' });
    expect(await ws.waitFor('analiz')).toMatchObject({ mod: 'karisik', transactionDisi: [1] });
    expect(await ws.waitFor('bitti')).toMatchObject({ sonuc: 'reddedildi', mesaj: expect.stringContaining('ayrı çalıştır') });
    expect(sequence(ws.events)).toEqual(['bitti']);
  });

  it('karar beklenmezken uzat reddedilir', async () => {
    ws.send({ type: 'uzat' });
    expect(await ws.waitFor('uyari')).toMatchObject({ tur: 'gecersizIstek' });
  });

  it('çalıştırma yokken commit reddedilir', async () => {
    ws.send({ type: 'commit' });
    expect(await ws.waitFor('uyari')).toMatchObject({ tur: 'gecersizIstek' });
  });
});

describePg('script çalıştırma: Transaction modu, gerçek Postgres', () => {
  const url = new URL(pgUrl ?? 'postgres://localhost');
  const real = {
    host: url.hostname,
    port: Number(url.port || 5432),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.slice(1)) || 'postgres',
  };
  const TABLE = 'tezgah_test_script';
  let admin: pg.Client;
  let connectionId: string;

  beforeAll(async () => {
    admin = new pg.Client(real);
    await admin.connect();
    await admin.query(`CREATE TABLE IF NOT EXISTS ${TABLE} (id int PRIMARY KEY)`);
  });
  afterAll(async () => {
    await admin.query(`DROP TABLE IF EXISTS ${TABLE}`);
    await admin.end();
  });
  beforeEach(async () => {
    await admin.query(`TRUNCATE ${TABLE}`);
    const res = await t.api('POST', '/api/baglantilar', { name: 'Yerel', ...real });
    connectionId = res.body.connection.id;
  });

  const run = (script: string, id = connectionId) => ws.send({ type: 'run', target: { connectionId: id, database: real.database }, script });
  const ids = async () => (await admin.query<{ id: number }>(`SELECT id FROM ${TABLE} ORDER BY id`)).rows.map((r) => r.id);

  /** Tezgah'ın sunucudaki oturumlarının durumları. */
  async function tezgahStates(): Promise<string[]> {
    // `pg_stat_activity` transaction boyunca ilk okumadaki anlık görüntüyü verir; admin kilit
    // tutarken (BEGIN içinde) yoklanınca her seferinde taze okunmalı.
    await admin.query('SELECT pg_stat_clear_snapshot()');
    const { rows } = await admin.query<{ state: string }>(
      `SELECT state FROM pg_stat_activity WHERE application_name = 'Tezgah' AND pid <> pg_backend_pid()`,
    );
    return rows.map((r) => r.state);
  }

  /** Karar bekleyen Tezgah oturumunun son sorgusu. */
  async function waitingQuery(): Promise<string | undefined> {
    const { rows } = await admin.query<{ query: string }>(
      `SELECT query FROM pg_stat_activity WHERE application_name = 'Tezgah' AND state = 'idle in transaction'`,
    );
    return rows[0]?.query;
  }

  /** Sunucudan gelebilecek olayların ulaşması için kısa bir süre tanır. */
  const settle = () => new Promise((resolve) => setTimeout(resolve, 200));

  async function eventually(check: () => Promise<boolean>) {
    for (let i = 0; i < 100; i++) {
      if (await check()) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('koşul sağlanmadı');
  }

  it('başarı: ifadeler sırayla çalışır, karar beklenir, commit kalıcı yazar', async () => {
    run(`INSERT INTO ${TABLE} VALUES (1);\nINSERT INTO ${TABLE} VALUES (2), (3);\nSELECT id FROM ${TABLE} ORDER BY id`);
    expect(await ws.waitFor('kararBekleniyor')).toMatchObject({ commitEdilebilir: true });
    expect(sequence(ws.events)).toEqual(['started:0', 'done:0', 'started:1', 'done:1', 'started:2', 'done:2', 'kararBekleniyor']);
    const done = ws.events.filter((e) => e.type === 'done');
    expect(done.map((e) => [e.komut, e.rowCount])).toEqual([
      ['INSERT', 1],
      ['INSERT', 2],
      ['SELECT', 3],
    ]);
    expect(done[2]!.onizleme).toEqual({ kolonlar: ['id'], tipler: [INT4], satirlar: [['1'], ['2'], ['3']], dahaVar: false });
    // Karar verilene kadar başka oturum görmez.
    expect(await ids()).toEqual([]);

    ws.send({ type: 'commit' });
    expect(await ws.waitFor('bitti')).toMatchObject({ sonuc: 'commit' });
    expect(await ids()).toEqual([1, 2, 3]);
  });

  it('rollback hiçbir şey yazmaz ve client pool’a döner', async () => {
    run(`INSERT INTO ${TABLE} VALUES (1)`);
    await ws.waitFor('kararBekleniyor');
    ws.send({ type: 'rollback' });
    expect(await ws.waitFor('bitti')).toMatchObject({ sonuc: 'rollback' });
    expect(await ids()).toEqual([]);
    await eventually(async () => (await tezgahStates()).every((s) => s === 'idle'));
  });

  it('hata: durulur, hatalı satır ve sütun döner, kalan ifadeler çalışmaz', async () => {
    run(`INSERT INTO ${TABLE} VALUES (1);\n-- yorum\nSELECT nope FROM yok_tablo;\nINSERT INTO ${TABLE} VALUES (2)`);
    expect(await ws.waitFor('kararBekleniyor')).toMatchObject({ commitEdilebilir: false });
    expect(sequence(ws.events)).toEqual(['started:0', 'done:0', 'started:1', 'error:1', 'kararBekleniyor']);
    expect(await ws.waitFor('error')).toMatchObject({ sqlstate: '42P01', satir: 3, sutun: 18, mesaj: expect.stringContaining('yok_tablo') });
  });

  it('imleç yolunda gelen hatanın konumu kullanıcının metnine göredir', async () => {
    run(`SELECT 1;\nSELECT 'x'::int`);
    expect(await ws.waitFor('error')).toMatchObject({ i: 1, sqlstate: '22P02', satir: 2, sutun: 8 });
    // Okuma script'i: hatadan sonra transaction hemen geri alınır.
    expect(await ws.waitFor('bitti')).toMatchObject({ sonuc: 'okuma' });
  });

  it('position yoksa ifadenin tamamı işaretlenir', async () => {
    run(`SELECT 1;\n  SELECT 1/0`);
    const error = await ws.waitFor('error');
    expect(error).toMatchObject({ i: 1, sqlstate: '22012', satir: 2, sutun: 3 });
    expect(await ws.waitFor('bitti')).toMatchObject({ sonuc: 'okuma' });
  });

  it('hatadan sonra commit reddedilir; rollback kabul edilir', async () => {
    run(`INSERT INTO ${TABLE} VALUES (1);\nSELECT 1/0`);
    await ws.waitFor('kararBekleniyor');
    ws.send({ type: 'commit' });
    expect(await ws.waitFor('uyari')).toMatchObject({ tur: 'commitReddedildi' });
    expect(ws.events.some((e) => e.type === 'bitti')).toBe(false);
    ws.send({ type: 'rollback' });
    expect(await ws.waitFor('bitti')).toMatchObject({ sonuc: 'rollback' });
    expect(await ids()).toEqual([]);
  });

  it("SELECT önizlemesi ilk 500 satır, kolon tip OID'leri ve dahaVar bayrağı; devamı varken satır sayısı bilinmez", async () => {
    run('SELECT g, NULL::text AS bos FROM generate_series(1, 750) g');
    const done = await ws.waitFor('done');
    expect(done.rowCount).toBeNull();
    expect(done.onizleme?.kolonlar).toEqual(['g', 'bos']);
    expect(done.onizleme?.tipler).toEqual([INT4, TEXT]);
    expect(done.onizleme?.satirlar).toHaveLength(500);
    expect(done.onizleme?.satirlar[0]).toEqual(['1', null]);
    expect(done.onizleme?.dahaVar).toBe(true);
  });

  it('tam 500 satırlık sonuçta dahaVar yok; satır sayısı bilinir', async () => {
    run('SELECT g FROM generate_series(1, 500) g');
    const done = await ws.waitFor('done');
    expect(done.onizleme?.satirlar).toHaveLength(500);
    expect(done.onizleme?.dahaVar).toBe(false);
    expect(done.rowCount).toBe(500);
  });

  describe('daha fazla satır', () => {
    /** `dahaFazla` gönderir ve yanıtını (`satirlar` ya da `uyari`) bekler. */
    async function more(i: number): Promise<ServerEvent> {
      const from = ws.events.length;
      ws.send({ type: 'dahaFazla', i });
      for (let k = 0; k < 500; k++) {
        const found = ws.events.slice(from).find((e) => e.type === 'satirlar' || (e.type === 'uyari' && e.tur === 'dahaFazla'));
        if (found) return found;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error('dahaFazla yanıtlanmadı');
    }
    const numbers = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, k) => [String(from + k)]);

    it('Okuma’da ilk 500 satırdan sonra sonraki sayfa; sonunda devamı yok', async () => {
      run('SELECT g FROM generate_series(1, 1100) g');
      await ws.waitFor('okumaAcik');
      expect(await more(0)).toEqual({ type: 'satirlar', i: 0, satirlar: numbers(501, 1000), dahaVar: true });
      expect(await more(0)).toEqual({ type: 'satirlar', i: 0, satirlar: numbers(1001, 1100), dahaVar: false });
    });

    it('karar beklenirken çekilir; commit sonrasında reddedilir', async () => {
      run(`INSERT INTO ${TABLE} VALUES (1);\nSELECT g FROM generate_series(1, 800) g`);
      await ws.waitFor('kararBekleniyor');
      expect(await more(1)).toMatchObject({ type: 'satirlar', satirlar: numbers(501, 800), dahaVar: false });
      ws.send({ type: 'commit' });
      expect(await ws.waitFor('bitti')).toMatchObject({ sonuc: 'commit' });
      expect(await more(1)).toMatchObject({ type: 'uyari', tur: 'dahaFazla', i: 1 });
      expect(await ids()).toEqual([1]);
    });

    it('100.000 satırda sınır; devamı çekilmez', async () => {
      run('SELECT g FROM generate_series(1, 100100) g');
      await ws.waitFor('okumaAcik');
      let loaded = 500;
      let last: ServerEvent | undefined;
      while (loaded < 100_000) {
        last = await more(0);
        if (last.type !== 'satirlar') throw new Error(JSON.stringify(last).slice(0, 200));
        loaded += last.satirlar.length;
      }
      expect(loaded).toBe(100_000);
      expect(last).toMatchObject({ dahaVar: true, sinir: true });
      expect(await more(0)).toMatchObject({ type: 'uyari', tur: 'dahaFazla' });
    }, 60_000);

    it('çekerken hata veren satır transaction’ı bozmaz: yazılanlar commit edilir', async () => {
      run(`INSERT INTO ${TABLE} VALUES (1);\nSELECT 1 / (g - 700) FROM generate_series(1, 800) g`);
      await ws.waitFor('kararBekleniyor');
      expect(await more(1)).toMatchObject({ type: 'uyari', tur: 'dahaFazla', mesaj: expect.stringContaining('division by zero') });
      ws.send({ type: 'commit' });
      expect(await ws.waitFor('bitti')).toMatchObject({ sonuc: 'commit' });
      expect(await ids()).toEqual([1]);
    });
  });

  it('imleçle çalışamayan SELECT (INTO) düz çalışır ve transaction bozulmaz', async () => {
    run(`SELECT 1 AS x INTO TEMP tezgah_gecici;\nINSERT INTO ${TABLE} SELECT x FROM tezgah_gecici`);
    expect(await ws.waitFor('kararBekleniyor')).toMatchObject({ commitEdilebilir: true });
    ws.send({ type: 'commit' });
    await ws.waitFor('bitti');
    expect(await ids()).toEqual([1]);
  });

  it('iptal: çalışan ifade pg_cancel_backend ile durur ve transaction geri alınır', async () => {
    run(`INSERT INTO ${TABLE} VALUES (1);\nSELECT pg_sleep(30);\nSELECT 3`);
    await ws.waitFor('started', (e) => e.i === 1);
    ws.send({ type: 'iptal' });
    expect(await ws.waitFor('error')).toMatchObject({ i: 1, sqlstate: '57014' });
    expect(await ws.waitFor('bitti')).toMatchObject({ sonuc: 'iptal' });
    expect(sequence(ws.events)).toEqual(['started:0', 'done:0', 'started:1', 'error:1', 'bitti']);
    expect(await ids()).toEqual([]);
    expect(await recordedResults()).toEqual(['iptal']);
  });

  it('karar beklenirken soket koparsa transaction geri alınır', async () => {
    run(`INSERT INTO ${TABLE} VALUES (1)`);
    await ws.waitFor('kararBekleniyor');
    expect(await tezgahStates()).toContain('idle in transaction');
    ws.terminate();
    await eventually(async () => !(await tezgahStates()).includes('idle in transaction'));
    // Satır kilidi bırakıldı: aynı anahtar başka oturumdan eklenebilir.
    await admin.query(`INSERT INTO ${TABLE} VALUES (1)`);
    expect(await ids()).toEqual([1]);
  });

  it('ifade çalışırken soket koparsa ifade iptal edilir ve transaction geri alınır', async () => {
    run(`INSERT INTO ${TABLE} VALUES (1);\nSELECT pg_sleep(30)`);
    await ws.waitFor('started', (e) => e.i === 1);
    ws.terminate();
    await eventually(async () => (await tezgahStates()).every((s) => s === 'idle'));
    expect(await ids()).toEqual([]);
    await eventually(async () => (await recordedResults()).join() === 'kopma-rollback');
  });

  it('bitince aynı soketten yeni çalıştırma başlatılabilir; çalışırken ikincisi reddedilir', async () => {
    run(`INSERT INTO ${TABLE} VALUES (1);\nSELECT pg_sleep(0.2)`);
    run(`INSERT INTO ${TABLE} VALUES (2)`);
    expect(await ws.waitFor('uyari')).toMatchObject({ tur: 'mesgul' });
    await ws.waitFor('kararBekleniyor');
    ws.send({ type: 'rollback' });
    await ws.waitFor('bitti');
    ws.events.length = 0;
    run(`INSERT INTO ${TABLE} VALUES (2)`);
    expect(await ws.waitFor('kararBekleniyor')).toMatchObject({ commitEdilebilir: true });
  });

  describe('Autocommit', () => {
    const INDEX = 'tezgah_test_script_ix';
    afterEach(async () => {
      await admin.query(`DROP INDEX IF EXISTS ${INDEX}`);
    });

    /** İndeks var ve geçerli mi; yoksa `null`. */
    async function indexValid(): Promise<boolean | null> {
      const { rows } = await admin.query<{ valid: boolean }>(
        `SELECT indisvalid AS valid FROM pg_index WHERE indexrelid = to_regclass($1)`,
        [INDEX],
      );
      return rows[0]?.valid ?? null;
    }

    it('VACUUM ve CREATE INDEX CONCURRENTLY ifade ifade ve kalıcı çalışır; karar beklenmez', async () => {
      run(`VACUUM ${TABLE};
CREATE INDEX CONCURRENTLY ${INDEX} ON ${TABLE} (id)`);
      expect(await ws.waitFor('analiz')).toMatchObject({ mod: 'autocommit', transactionDisi: [0, 1], reddedilenler: [] });
      expect(await ws.waitFor('bitti')).toEqual({
        type: 'bitti',
        sonuc: 'autocommit',
        ozet: { uygulandi: 2, hatali: 0, calistirilmadi: 0 },
      });
      expect(sequence(ws.events)).toEqual(['started:0', 'done:0', 'started:1', 'done:1', 'bitti']);
      expect(ws.events.filter((e) => e.type === 'done').map((e) => e.komut)).toEqual(['VACUUM', 'CREATE']);
      expect(await indexValid()).toBe(true);
      // Client transaction'sız döndü.
      await eventually(async () => (await tezgahStates()).every((s) => s === 'idle'));
    });

    it('hatada durulur; önceki ifade kalıcıdır, kalanlar çalışmaz; özet', async () => {
      run(`CREATE INDEX CONCURRENTLY ${INDEX} ON ${TABLE} (id);
VACUUM yok_tablo;
VACUUM ${TABLE}`);
      expect(await ws.waitFor('error')).toMatchObject({ i: 1, sqlstate: '42P01', satir: 2 });
      expect(await ws.waitFor('bitti')).toMatchObject({
        sonuc: 'autocommit',
        ozet: { uygulandi: 1, hatali: 1, calistirilmadi: 1 },
      });
      expect(sequence(ws.events)).toEqual(['started:0', 'done:0', 'started:1', 'error:1', 'bitti']);
      expect(await indexValid()).toBe(true);
    });

    it('bitince commit isteği karar bekleyen transaction olmadığından reddedilir', async () => {
      run(`VACUUM ${TABLE}`);
      await ws.waitFor('bitti');
      ws.send({ type: 'commit' });
      expect(await ws.waitFor('uyari')).toMatchObject({ tur: 'gecersizIstek' });
    });

    it('çalışırken soket koparsa çalışan ifade iptal edilir ve kalanlar çalışmaz', async () => {
      // Çalışan ifade, başka oturumun tuttuğu kilidi bekleyen VACUUM.
      await admin.query('BEGIN');
      await admin.query(`LOCK TABLE ${TABLE} IN ACCESS EXCLUSIVE MODE`);
      try {
        run(`VACUUM ${TABLE};
CREATE INDEX CONCURRENTLY ${INDEX} ON ${TABLE} (id)`);
        await ws.waitFor('started', (e) => e.i === 0);
        await eventually(async () => (await tezgahStates()).includes('active'));
        ws.terminate();
        await eventually(async () => !(await tezgahStates()).includes('active'));
      } finally {
        await admin.query('ROLLBACK');
      }
      await settle();
      expect(await indexValid()).toBeNull();
    });

    it('listede olmayan transaction dışı komut 25001 ile düşer; hatalı satır işaretlenir', async () => {
      // DISCARD ALL desende yok; Transaction modunda çalışır ve Postgres reddeder.
      run(`INSERT INTO ${TABLE} VALUES (1);
DISCARD ALL`);
      expect(await ws.waitFor('analiz')).toMatchObject({ mod: 'transaction' });
      expect(await ws.waitFor('error')).toMatchObject({ i: 1, sqlstate: '25001', satir: 2, sutun: 1 });
      expect(await ws.waitFor('kararBekleniyor')).toMatchObject({ commitEdilebilir: false });
      ws.send({ type: 'rollback' });
      await ws.waitFor('bitti');
      expect(await ids()).toEqual([]);
    });
  });

  describe('Okuma modu', () => {
    const SEQUENCE = 'tezgah_test_okuma_seq';
    beforeAll(async () => {
      await admin.query(`CREATE SEQUENCE IF NOT EXISTS ${SEQUENCE}`);
    });
    afterAll(async () => {
      await admin.query(`DROP SEQUENCE IF EXISTS ${SEQUENCE}`);
    });

    it('ortamdan bağımsız READ ONLY transaction açık kalır; Karar süresi dolunca kapanır', async () => {
      run('SHOW transaction_read_only');
      expect(await ws.waitFor('okumaAcik')).toEqual({ type: 'okumaAcik', kalanMs: 30 * DK });
      expect((await ws.waitFor('done')).onizleme?.satirlar).toEqual([['on']]);
      expect(await tezgahStates()).toContain('idle in transaction');
      clock.advance(30 * DK);
      expect(await ws.waitFor('bitti')).toMatchObject({ sonuc: 'okuma' });
      await eventually(async () => (await tezgahStates()).every((s) => s === 'idle'));
      expect(await recordedResults()).toEqual(['okuma']);
    });

    it('desen yanılırsa 25006; zorlaTransaction ile aynı script karar kartıyla çalışır', async () => {
      const script = `SELECT nextval('${SEQUENCE}')`;
      run(script);
      expect(await ws.waitFor('analiz')).toMatchObject({ mod: 'okuma' });
      expect(await ws.waitFor('error')).toMatchObject({ i: 0, sqlstate: '25006' });
      expect(await ws.waitFor('bitti')).toMatchObject({ sonuc: 'okuma' });

      ws.events.length = 0;
      ws.send({ type: 'run', target: { connectionId, database: real.database }, script, zorlaTransaction: true });
      expect(await ws.waitFor('analiz')).toMatchObject({ mod: 'transaction' });
      expect(await ws.waitFor('kararBekleniyor')).toMatchObject({ commitEdilebilir: true });
      ws.send({ type: 'rollback' });
      expect(await ws.waitFor('bitti')).toMatchObject({ sonuc: 'rollback' });
    });

    it('soket kapanınca Okuma transaction’ı geri alınır', async () => {
      run('SELECT 1');
      await ws.waitFor('okumaAcik');
      ws.terminate();
      await eventually(async () => !(await tezgahStates()).includes('idle in transaction'));
    });
  });

  describe('Karar süresi', () => {
    it('karar 30 dk beklenir; sunucudaki yedek zaman aşımı BEGIN ile süre + 1 dk', async () => {
      run(`INSERT INTO ${TABLE} VALUES (1);\nSHOW idle_in_transaction_session_timeout`);
      expect(await ws.waitFor('kararBekleniyor')).toMatchObject({ kalanMs: 30 * DK });
      expect((await ws.waitFor('done', (e) => e.i === 1)).onizleme?.satirlar).toEqual([['31min']]);
    });

    it('prod hedefte süre 5 dk, yedek zaman aşımı 6 dk', async () => {
      const prod = await t.api('POST', '/api/baglantilar', { name: 'Prod', envTag: 'prod', ...real });
      run('SET LOCAL statement_timeout = 0;\nSHOW idle_in_transaction_session_timeout', prod.body.connection.id);
      expect(await ws.waitFor('kararBekleniyor')).toMatchObject({ kalanMs: 5 * DK });
      expect((await ws.waitFor('done', (e) => e.i === 1)).onizleme?.satirlar).toEqual([['6min']]);
    });

    it('süre dolunca transaction geri alınır ve client pool’a döner; geç gelen commit reddedilir', async () => {
      run(`INSERT INTO ${TABLE} VALUES (1)`);
      await ws.waitFor('kararBekleniyor');
      clock.advance(30 * DK - 1);
      await settle();
      expect(ws.events.some((e) => e.type === 'bitti')).toBe(false);

      clock.advance(1);
      expect(await ws.waitFor('bitti')).toEqual({ type: 'bitti', sonuc: 'sureDoldu', mesaj: 'Süre doldu; transaction geri alındı' });
      expect(await ids()).toEqual([]);
      await eventually(async () => (await tezgahStates()).every((s) => s === 'idle'));

      ws.send({ type: 'commit' });
      expect(await ws.waitFor('uyari')).toMatchObject({ tur: 'commitReddedildi', mesaj: expect.stringContaining('Süre doldu') });
      expect(await ids()).toEqual([]);
    });

    it('uzat sunucuya SELECT 1 gönderir ve süreyi baştan başlatır', async () => {
      run(`INSERT INTO ${TABLE} VALUES (1)`);
      await ws.waitFor('kararBekleniyor');
      clock.advance(29 * DK);
      ws.send({ type: 'uzat' });
      expect(await ws.waitFor('uzatildi')).toEqual({ type: 'uzatildi', kalanMs: 30 * DK });
      expect(await waitingQuery()).toBe('SELECT 1');

      clock.advance(29 * DK);
      await settle();
      expect(ws.events.some((e) => e.type === 'bitti')).toBe(false);
      ws.send({ type: 'commit' });
      expect(await ws.waitFor('bitti')).toMatchObject({ sonuc: 'commit' });
      expect(await ids()).toEqual([1]);
    });

    it('hatadan sonra da uzatılabilir; rollback çalışır', async () => {
      run(`INSERT INTO ${TABLE} VALUES (1);\nSELECT 1/0`);
      expect(await ws.waitFor('kararBekleniyor')).toMatchObject({ commitEdilebilir: false });
      clock.advance(29 * DK);
      ws.send({ type: 'uzat' });
      expect(await ws.waitFor('uzatildi')).toEqual({ type: 'uzatildi', kalanMs: 30 * DK });
      clock.advance(29 * DK);
      ws.send({ type: 'rollback' });
      expect(await ws.waitFor('bitti')).toMatchObject({ sonuc: 'rollback' });
      await eventually(async () => (await tezgahStates()).every((s) => s === 'idle'));
    });

    it('zamanlayıcı geç kalsa da (uyku) süresi geçmiş commit reddedilir ve transaction geri alınır', async () => {
      run(`INSERT INTO ${TABLE} VALUES (1)`);
      await ws.waitFor('kararBekleniyor');
      clock.jump(30 * DK);
      ws.send({ type: 'commit' });
      expect(await ws.waitFor('uyari')).toMatchObject({ tur: 'commitReddedildi', mesaj: expect.stringContaining('Süre doldu') });
      expect(await ws.waitFor('bitti')).toMatchObject({ sonuc: 'sureDoldu' });
      expect(await ids()).toEqual([]);
    });

    it('süresi geçmişken uzat da reddedilir; transaction geri alınır', async () => {
      run(`INSERT INTO ${TABLE} VALUES (1)`);
      await ws.waitFor('kararBekleniyor');
      clock.jump(30 * DK);
      ws.send({ type: 'uzat' });
      expect(await ws.waitFor('bitti')).toMatchObject({ sonuc: 'sureDoldu' });
      expect(ws.events.some((e) => e.type === 'uzatildi')).toBe(false);
    });

    it('oturum sunucuda zaman aşımına uğrarsa client atılır ve nedeni söylenir', async () => {
      // Yedek zaman aşımını kısaltır: dizüstü uykudayken uzak sunucunun oturumu kapatmasının benzeri.
      run(`INSERT INTO ${TABLE} VALUES (1);
SET LOCAL idle_in_transaction_session_timeout = 300`);
      await ws.waitFor('kararBekleniyor');
      expect(await ws.waitFor('bitti')).toEqual({
        type: 'bitti',
        sonuc: 'hata',
        mesaj: 'Oturum sunucuda zaman aşımına uğradı; transaction geri alındı',
      });
      await eventually(async () => (await tezgahStates()).length === 0);
      expect(await ids()).toEqual([]);
      // Ölen client pool'a dönmedi: aynı hedefte yeni çalıştırma sorunsuz.
      ws.events.length = 0;
      run(`INSERT INTO ${TABLE} VALUES (1)`);
      expect(await ws.waitFor('kararBekleniyor')).toMatchObject({ commitEdilebilir: true });
    });
  });
});
