import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { parseRecords } from '../core/calistirma-kaydi';
import { NO_CHANGES, addRow, deleteRows, editCell, pendingScript, type EditableTable } from '../core/grid/bekleyen';
import { startFakePostgres, type FakePostgres } from './test/sahte-postgres';
import { createFakeClock } from './test/sahte-saat';
import { describePg, pgUrl, startTestServer, type TestServer, type TestSocket } from './test/sunucu';
import { addFakeConnection } from './test/yardimcilar';

let t: TestServer;
let ws: TestSocket;
let fake: FakePostgres;

beforeEach(async () => {
  fake = await startFakePostgres({ password: 'gizli' });
  t = await startTestServer({ clock: createFakeClock() });
  ws = await t.socket();
});
afterEach(async () => {
  ws.close();
  await t.close();
  await fake.close();
});

const createConnection = () => addFakeConnection(t, fake.port);

/** `UPDATE` ifadeleri sırayla bu sayılarda satır etkiler. */
function updatesAffect(...counts: number[]) {
  let n = 0;
  fake.resultFor = (sql) => (sql.startsWith('UPDATE') ? { columns: [], rows: [], command: `UPDATE ${counts[n++]}` } : undefined);
}

const SCRIPT = `UPDATE "public"."t" SET "a" = 'x' WHERE "id" = '1';\nUPDATE "public"."t" SET "a" = 'y' WHERE "id" = '2';\nUPDATE "public"."t" SET "a" = 'z' WHERE "id" = '3';`;

describe('script çalıştırma: beklenenSatir', () => {
  it.each([0, 2])('%i satır etkileyen ifadede durur; hata türü satirSayisi, yalnızca rollback', async (affected) => {
    const id = await createConnection();
    updatesAffect(1, affected, 1);
    ws.send({ type: 'run', target: { connectionId: id, database: 'postgres' }, script: SCRIPT, beklenenSatir: 1 });

    expect(await ws.waitFor('error')).toMatchObject({
      i: 1,
      tur: 'satirSayisi',
      sqlstate: null,
      mesaj: `Satır değişmiş ya da silinmiş (${affected} satır etkilendi)`,
      satir: 2,
    });
    expect(await ws.waitFor('kararBekleniyor')).toMatchObject({ commitEdilebilir: false });
    expect(fake.queries.filter((q) => q.startsWith('UPDATE'))).toHaveLength(2);

    ws.send({ type: 'commit' });
    expect(await ws.waitFor('uyari')).toMatchObject({ tur: 'commitReddedildi' });
    ws.send({ type: 'rollback' });
    expect(await ws.waitFor('bitti')).toMatchObject({ sonuc: 'rollback' });
    expect(fake.queries).not.toContain('COMMIT');

    const dir = join(t.configDir, 'history');
    const [file] = await readdir(dir);
    const [record] = parseRecords(await readFile(join(dir, file!), 'utf8'));
    expect(record!.bitti!.ifadeler[1]).toMatchObject({ satirSayisi: affected, hata: { kod: null, satir: 2 } });
  });

  it('her ifade tam 1 satır etkilerse commit edilebilir', async () => {
    const id = await createConnection();
    updatesAffect(1, 1, 1);
    ws.send({ type: 'run', target: { connectionId: id, database: 'postgres' }, script: SCRIPT, beklenenSatir: 1 });
    expect(await ws.waitFor('kararBekleniyor')).toMatchObject({ commitEdilebilir: true });
    ws.send({ type: 'commit' });
    expect(await ws.waitFor('bitti')).toMatchObject({ sonuc: 'commit' });
  });

  it('Deneme modunda da denetlenir: satirSayisi hatasında durulur, karar beklenmeden geri alınır', async () => {
    const id = await createConnection();
    // Denemede DML önizleme sarmalıyla çalışır; ilk kolon toplam satır sayısıdır.
    let n = 0;
    const counts = [1, 0, 1];
    fake.resultFor = (sql) => {
      if (!sql.startsWith('WITH tezgah_onizleme AS (UPDATE')) return undefined;
      const count = counts[n++]!;
      return { columns: ['count', 'id'], rows: Array.from({ length: count }, () => [String(count), '1']), command: `SELECT ${count}` };
    };
    ws.send({ type: 'run', target: { connectionId: id, database: 'postgres' }, script: SCRIPT, deneme: true, beklenenSatir: 1 });

    expect(await ws.waitFor('error')).toMatchObject({ i: 1, tur: 'satirSayisi', mesaj: 'Satır değişmiş ya da silinmiş (0 satır etkilendi)', satir: 2 });
    expect(await ws.waitFor('bitti')).toMatchObject({ sonuc: 'deneme' });
    expect(ws.events.some((e) => e.type === 'kararBekleniyor')).toBe(false);
    expect(fake.queries.filter((q) => q.includes('UPDATE'))).toHaveLength(2);
    expect(fake.queries.at(-1)).toBe('ROLLBACK');
    expect(fake.queries).not.toContain('COMMIT');

    const dir = join(t.configDir, 'history');
    const [file] = await readdir(dir);
    const [record] = parseRecords(await readFile(join(dir, file!), 'utf8'));
    expect(record).toMatchObject({ sonuc: 'deneme-rollback', basladi: { deneme: true } });
    expect(record!.bitti!.ifadeler[1]).toMatchObject({ satirSayisi: 0, hata: { kod: null, satir: 2 } });
  });

  it('beklenenSatir verilmezse satır sayısı denetlenmez', async () => {
    const id = await createConnection();
    updatesAffect(1, 0, 2);
    ws.send({ type: 'run', target: { connectionId: id, database: 'postgres' }, script: SCRIPT });
    expect(await ws.waitFor('kararBekleniyor')).toMatchObject({ commitEdilebilir: true });
  });
});

describePg('Bekleyen değişiklik script’i, gerçek Postgres', () => {
  const url = new URL(pgUrl ?? 'postgres://localhost');
  const real = {
    host: url.hostname,
    port: Number(url.port || 5432),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.slice(1)) || 'postgres',
  };
  const TABLE = 'tezgah_test_bekleyen';
  // Çok kolonlu PK; literal'lerin `::tip` ekleri gerçek kolon tiplerine dönüşmeli.
  const table: EditableTable = {
    sema: 'public',
    tablo: TABLE,
    kolonlar: ['bolge', 'no', 'ad', 'tutar', 'etiketler', 'veri'],
    tipler: ['text', 'integer', 'text', 'numeric', 'text[]', 'jsonb'],
    pk: ['bolge', 'no'],
    uretilmis: [],
  };
  const ROW_1 = ['tr', '1', 'Ali', '10.50', '{a,b}', '{"x": 1}'];
  const ROW_2 = ['tr', '2', 'Ayşe', '3', '{}', null];
  let admin: pg.Client;
  let connectionId: string;

  beforeAll(async () => {
    admin = new pg.Client(real);
    await admin.connect();
    await admin.query(`DROP TABLE IF EXISTS ${TABLE}`);
    await admin.query(`CREATE TABLE ${TABLE} (bolge text, no int, ad text, tutar numeric, etiketler text[], veri jsonb, PRIMARY KEY (bolge, no))`);
  });
  afterAll(async () => {
    await admin.query(`DROP TABLE IF EXISTS ${TABLE}`);
    await admin.end();
  });
  beforeEach(async () => {
    await admin.query(`TRUNCATE ${TABLE}`);
    await admin.query(`INSERT INTO ${TABLE} VALUES ('tr', 1, 'Ali', 10.50, '{a,b}', '{"x": 1}'), ('tr', 2, 'Ayşe', 3, '{}', NULL)`);
    const res = await t.api('POST', '/api/baglantilar', { name: 'Yerel', ...real });
    connectionId = res.body.connection.id;
  });

  const apply = (script: string) =>
    ws.send({ type: 'run', target: { connectionId, database: real.database }, script, beklenenSatir: 1 });

  it('literal değerler (tırnak, dizi, json, NULL) kolon tiplerine dönüşür ve commit edilir', async () => {
    let changes = editCell(table, NO_CHANGES, { yuklu: ROW_1 }, 2, "O'Brien; -- yorum değil");
    changes = editCell(table, changes, { yuklu: ROW_1 }, 3, '12.75');
    changes = editCell(table, changes, { yuklu: ROW_2 }, 4, '{x,"y z"}');
    changes = editCell(table, changes, { yuklu: ROW_2 }, 5, '{"a": [1, 2]}');
    changes = editCell(table, changes, { yuklu: ROW_1 }, 5, null);
    apply(pendingScript(table, changes).metin);
    expect(await ws.waitFor('kararBekleniyor')).toMatchObject({ commitEdilebilir: true });
    ws.send({ type: 'commit' });
    expect(await ws.waitFor('bitti')).toMatchObject({ sonuc: 'commit' });

    const { rows } = await admin.query(`SELECT no, ad, tutar::text, etiketler, veri FROM ${TABLE} ORDER BY no`);
    expect(rows).toEqual([
      { no: 1, ad: "O'Brien; -- yorum değil", tutar: '12.75', etiketler: ['a', 'b'], veri: null },
      { no: 2, ad: 'Ayşe', tutar: '3', etiketler: ['x', 'y z'], veri: { a: [1, 2] } },
    ]);
  });

  it('başkası satırı silmişse ifade 0 satır etkiler: satirSayisi hatası, rollback ile hiçbir şey yazılmaz', async () => {
    let changes = editCell(table, NO_CHANGES, { yuklu: ROW_1 }, 2, 'Veli');
    changes = editCell(table, changes, { yuklu: ROW_2 }, 2, 'Zeynep');
    await admin.query(`DELETE FROM ${TABLE} WHERE no = 2`);
    apply(pendingScript(table, changes).metin);
    expect(await ws.waitFor('error')).toMatchObject({ i: 1, tur: 'satirSayisi', mesaj: 'Satır değişmiş ya da silinmiş (0 satır etkilendi)' });
    expect(await ws.waitFor('kararBekleniyor')).toMatchObject({ commitEdilebilir: false });
    ws.send({ type: 'rollback' });
    expect(await ws.waitFor('bitti')).toMatchObject({ sonuc: 'rollback' });
    const { rows } = await admin.query(`SELECT ad FROM ${TABLE}`);
    expect(rows).toEqual([{ ad: 'Ali' }]);
  });

  it('Dene: değişiklikler gösterilir, satır sayısı denetlenir, veri değişmez', async () => {
    let changes = editCell(table, NO_CHANGES, { yuklu: ROW_1 }, 2, 'Veli');
    changes = editCell(table, changes, { yuklu: ROW_2 }, 2, 'Zeynep');
    await admin.query(`DELETE FROM ${TABLE} WHERE no = 2`);
    ws.send({ type: 'run', target: { connectionId, database: real.database }, script: pendingScript(table, changes).metin, deneme: true, beklenenSatir: 1 });
    expect(await ws.waitFor('done')).toMatchObject({ i: 0, rowCount: 1 });
    expect(await ws.waitFor('error')).toMatchObject({ i: 1, tur: 'satirSayisi', mesaj: 'Satır değişmiş ya da silinmiş (0 satır etkilendi)' });
    expect(await ws.waitFor('bitti')).toMatchObject({ sonuc: 'deneme' });
    const { rows } = await admin.query(`SELECT ad FROM ${TABLE}`);
    expect(rows).toEqual([{ ad: 'Ali' }]);
  });

  it('DELETE → UPDATE → INSERT gerçek tabloda çalışır; dokunulmayan kolonlar DEFAULT (NULL) kalır', async () => {
    let changes = deleteRows(table, NO_CHANGES, [{ yuklu: ROW_2 }]);
    changes = editCell(table, changes, { yuklu: ROW_1 }, 2, 'Veli');
    changes = addRow(changes);
    const yeni = { yeni: changes.eklenen[0]!.anahtar };
    for (const [c, v] of [[0, 'tr'], [1, '2'], [2, 'Can']] as const) changes = editCell(table, changes, yeni, c, v);
    apply(pendingScript(table, changes).metin);
    expect(await ws.waitFor('kararBekleniyor')).toMatchObject({ commitEdilebilir: true });
    ws.send({ type: 'commit' });
    expect(await ws.waitFor('bitti')).toMatchObject({ sonuc: 'commit' });
    const { rows } = await admin.query(`SELECT no, ad, tutar::text FROM ${TABLE} ORDER BY no`);
    expect(rows).toEqual([
      { no: 1, ad: 'Veli', tutar: '10.50' },
      { no: 2, ad: 'Can', tutar: null },
    ]);
  });
});
