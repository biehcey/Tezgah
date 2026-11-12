import { describe, expect, it } from 'vitest';
import { splitStatements } from '../ifade-bolme';
import {
  NO_CHANGES,
  addRow,
  deleteRows,
  editCell,
  editableTable,
  failedRowKey,
  gridRows,
  pasteTsv,
  pendingCount,
  pendingItems,
  pendingScript,
  readOnlyReason,
  restoreRows,
  rowKey,
  type EditableTable,
  type PendingChanges,
  type RowRef,
} from './bekleyen';

const USERS: EditableTable = {
  sema: 'public',
  tablo: 'users',
  kolonlar: ['id', 'ad', 'eposta'],
  tipler: ['integer', 'text', 'text'],
  pk: ['id'],
  uretilmis: [],
};
const ROW_1 = ['1', 'Ali', 'ali@x'];
const ROW_2 = ['2', 'Ayşe', null];
const LOADED = [ROW_1, ROW_2];

const loaded = (row: readonly (string | null)[]): RowRef => ({ yuklu: row });
const sql = (changes: PendingChanges, table = USERS) => pendingScript(table, changes).metin.split('\n');
/** Grid'deki `i`. satırın referansı (yüklüler, sonra eklenenler). */
const at = (changes: PendingChanges, i: number, table = USERS, rows = LOADED) => gridRows(table, changes, rows)[i]!.ref;

describe('Bekleyen değişiklik deposu: hücre düzenleme', () => {
  it('düzenlenen hücre yalnızca değişen kolonla, tüm PK orijinaliyle UPDATE üretir', () => {
    const changes = editCell(USERS, NO_CHANGES, loaded(ROW_1), 1, 'Veli');
    expect(pendingScript(USERS, changes).metin).toBe(`UPDATE "public"."users" SET "ad" = 'Veli'::text WHERE "id" = '1'::integer;`);
  });

  it('aynı hücreye çoklu düzenleme tek değişiklikte birleşir; aynı satırın kolonları tek UPDATE’te', () => {
    let changes = editCell(USERS, NO_CHANGES, loaded(ROW_1), 1, 'Veli');
    changes = editCell(USERS, changes, loaded(ROW_1), 1, 'Can');
    changes = editCell(USERS, changes, loaded(ROW_1), 2, 'can@x');
    expect(pendingScript(USERS, changes).metin).toBe(
      `UPDATE "public"."users" SET "ad" = 'Can'::text, "eposta" = 'can@x'::text WHERE "id" = '1'::integer;`,
    );
  });

  it('orijinal değere dönen hücre düşer; değişmeyen satır SQL üretmez', () => {
    let changes = editCell(USERS, NO_CHANGES, loaded(ROW_1), 1, 'Veli');
    changes = editCell(USERS, changes, loaded(ROW_1), 1, 'Ali');
    expect(pendingScript(USERS, changes)).toEqual({ metin: '', ifadeler: [] });
    expect(changes.guncellenen).toEqual([]);
  });

  it('boş metin NULL değildir; NULL hücreye yazılan metin değişikliktir', () => {
    const changes = editCell(USERS, NO_CHANGES, loaded(ROW_2), 2, '');
    expect(pendingScript(USERS, changes).metin).toBe(`UPDATE "public"."users" SET "eposta" = ''::text WHERE "id" = '2'::integer;`);
  });

  it('çok kolonlu PK: WHERE tüm PK kolonlarını orijinal değerleriyle içerir, PK değişse de', () => {
    const table: EditableTable = { sema: 's', tablo: 't', kolonlar: ['a', 'b', 'v'], tipler: ['integer', 'text', null], pk: ['a', 'b'], uretilmis: [] };
    const row = ['1', 'x', 'eski'];
    let changes = editCell(table, NO_CHANGES, loaded(row), 1, 'y');
    changes = editCell(table, changes, loaded(row), 2, "O'Brien");
    expect(pendingScript(table, changes).metin).toBe(
      `UPDATE "s"."t" SET "b" = 'y'::text, "v" = 'O''Brien' WHERE "a" = '1'::integer AND "b" = 'x'::text;`,
    );
  });

  it('satırlar ilk düzenlenme sırasıyla; her ifadenin hangi satıra ait olduğu bilinir', () => {
    let changes = editCell(USERS, NO_CHANGES, loaded(ROW_2), 1, 'Zeynep');
    changes = editCell(USERS, changes, loaded(ROW_1), 1, 'Veli');
    changes = editCell(USERS, changes, loaded(ROW_2), 2, 'z@x');
    const { ifadeler } = pendingScript(USERS, changes);
    expect(ifadeler.map((s) => s.satir)).toEqual([changes.guncellenen[0]!.anahtar, changes.guncellenen[1]!.anahtar]);
    expect(changes.guncellenen.map((r) => r.orijinal)).toEqual([ROW_2, ROW_1]);
  });

  it('üretilen script ifade bölücüde değişiklik sayısı kadar ifadeye bölünür (`;`, tırnak, yorum, satır sonu içeren değerler)', () => {
    let changes = editCell(USERS, NO_CHANGES, loaded(ROW_1), 1, "a;b'c -- d\n/* e");
    changes = editCell(USERS, changes, loaded(ROW_2), 1, '$$x$$ \\');
    const { metin, ifadeler } = pendingScript(USERS, changes);
    expect(splitStatements(metin).map((s) => s.text)).toEqual(ifadeler.map((s) => s.sql.slice(0, -1)));
  });

  it('görünen satır bekleyen değerleri taşır; değişen hücreler işaretlidir', () => {
    const changes = editCell(USERS, NO_CHANGES, loaded(ROW_1), 2, null);
    const [first, second] = gridRows(USERS, changes, LOADED);
    expect(first).toMatchObject({ degerler: ['1', 'Ali', null], durum: null, degisen: [2] });
    expect(second).toMatchObject({ degerler: ROW_2, durum: null, degisen: [] });
  });

  it('satır, sayfa yeniden çekilse de PK değerleriyle tanınır', () => {
    const changes = editCell(USERS, NO_CHANGES, loaded(ROW_1), 1, 'Veli');
    expect(gridRows(USERS, changes, [['1', 'Ali (başkası değiştirdi)', 'ali@x']])[0]!.degerler).toEqual(['1', 'Veli', 'ali@x']);
  });
});

describe('Bekleyen değişiklik deposu: satır ekleme', () => {
  it('eklenen satır yüklü satırların sonunda; dokunulmayan kolonlar DEFAULT (işaretsiz NULL)', () => {
    const changes = addRow(NO_CHANGES);
    const rows = gridRows(USERS, changes, LOADED);
    expect(rows).toHaveLength(3);
    expect(rows[2]).toMatchObject({ degerler: [null, null, null], durum: 'eklendi', degisen: [] });
    expect(pendingCount(changes)).toBe(1);
  });

  it('hiçbir kolonu dokunulmayan satır `DEFAULT VALUES`', () => {
    expect(sql(addRow(NO_CHANGES))).toEqual([`INSERT INTO "public"."users" DEFAULT VALUES;`]);
  });

  it('INSERT yalnızca dokunulan kolonlarla, kolon sırasıyla; NULL yapılan kolon dokunulmuştur', () => {
    let changes = addRow(NO_CHANGES);
    changes = editCell(USERS, changes, at(changes, 2), 2, 'z@x');
    changes = editCell(USERS, changes, at(changes, 2), 1, null);
    expect(gridRows(USERS, changes, LOADED)[2]).toMatchObject({ degerler: [null, null, 'z@x'], degisen: [1, 2] });
    expect(sql(changes)).toEqual([`INSERT INTO "public"."users" ("ad", "eposta") VALUES (NULL, 'z@x'::text);`]);
  });

  it('eklenen satırlar ekleme sırasıyla; her INSERT kendi satırına aittir', () => {
    let changes = addRow(NO_CHANGES);
    changes = addRow(changes);
    changes = editCell(USERS, changes, at(changes, 3), 0, '9');
    const script = pendingScript(USERS, changes);
    expect(script.metin.split('\n')).toEqual([`INSERT INTO "public"."users" DEFAULT VALUES;`, `INSERT INTO "public"."users" ("id") VALUES ('9'::integer);`]);
    const rows = gridRows(USERS, changes, LOADED);
    expect(failedRowKey(script, 1)).toBe(rows[3]!.anahtar);
    expect(failedRowKey(script, 0)).toBe(rows[2]!.anahtar);
  });

  it('eklenen satırlar sayfa yeniden çekilse de grid’in sonunda kalır', () => {
    const changes = addRow(NO_CHANGES);
    expect(gridRows(USERS, changes, [ROW_2]).map((r) => r.durum)).toEqual([null, 'eklendi']);
  });
});

describe('Bekleyen değişiklik deposu: satır silme', () => {
  it('silinen satır işaretli kalır ve `DELETE … WHERE <tüm PK>` üretir', () => {
    const changes = deleteRows(USERS, NO_CHANGES, [loaded(ROW_2)]);
    expect(gridRows(USERS, changes, LOADED).map((r) => r.durum)).toEqual([null, 'silinecek']);
    expect(sql(changes)).toEqual([`DELETE FROM "public"."users" WHERE "id" = '2'::integer;`]);
  });

  it('çok kolonlu PK: WHERE tüm PK kolonlarıyla', () => {
    const table: EditableTable = { sema: 's', tablo: 't', kolonlar: ['a', 'b', 'v'], tipler: ['integer', 'text', null], pk: ['a', 'b'], uretilmis: [] };
    expect(sql(deleteRows(table, NO_CHANGES, [loaded(['1', 'x', 'v'])]), table)).toEqual([`DELETE FROM "s"."t" WHERE "a" = '1'::integer AND "b" = 'x'::text;`]);
  });

  it('silinen satırdaki düzenlemeler düşer; silmeyi geri almak onları getirmez', () => {
    let changes = editCell(USERS, NO_CHANGES, loaded(ROW_1), 1, 'Veli');
    changes = deleteRows(USERS, changes, [loaded(ROW_1)]);
    expect(sql(changes)).toEqual([`DELETE FROM "public"."users" WHERE "id" = '1'::integer;`]);
    changes = restoreRows(USERS, changes, [loaded(ROW_1)]);
    expect(pendingCount(changes)).toBe(0);
    expect(gridRows(USERS, changes, LOADED)[0]).toMatchObject({ degerler: ROW_1, durum: null, degisen: [] });
  });

  it('silinecek satır düzenlenmez', () => {
    let changes = deleteRows(USERS, NO_CHANGES, [loaded(ROW_1)]);
    changes = editCell(USERS, changes, loaded(ROW_1), 1, 'Veli');
    expect(sql(changes)).toEqual([`DELETE FROM "public"."users" WHERE "id" = '1'::integer;`]);
  });

  it('eklenip silinen satır SQL üretmez ve grid’den kalkar', () => {
    let changes = addRow(NO_CHANGES);
    changes = editCell(USERS, changes, at(changes, 2), 1, 'Yeni');
    changes = deleteRows(USERS, changes, [at(changes, 2)]);
    expect(pendingScript(USERS, changes).metin).toBe('');
    expect(pendingCount(changes)).toBe(0);
    expect(gridRows(USERS, changes, LOADED)).toHaveLength(2);
  });

  it('sıra DELETE → UPDATE → INSERT, değişikliklerin yapılış sırasından bağımsız', () => {
    let changes = addRow(NO_CHANGES);
    changes = editCell(USERS, changes, loaded(ROW_1), 1, 'Veli');
    changes = deleteRows(USERS, changes, [loaded(ROW_2)]);
    expect(sql(changes).map((s) => s.split(' ')[0])).toEqual(['DELETE', 'UPDATE', 'INSERT']);
    expect(pendingCount(changes)).toBe(3);
  });
});

describe('Bekleyen değişiklik deposu: liste', () => {
  it('SQL sırasıyla: silinen `− pk`, düzenlenen `pk · kolonlar`, eklenen `+ yeni satır · kolonlar | DEFAULT VALUES`', () => {
    let changes = addRow(NO_CHANGES);
    changes = addRow(changes);
    changes = editCell(USERS, changes, at(changes, 3), 2, 'x');
    changes = editCell(USERS, changes, at(changes, 3), 1, 'y');
    changes = editCell(USERS, changes, loaded(ROW_1), 2, null);
    changes = deleteRows(USERS, changes, [loaded(ROW_2)]);
    const rows = gridRows(USERS, changes, LOADED);
    expect(pendingItems(USERS, changes)).toEqual([
      { anahtar: rows[1]!.anahtar, metin: '− id = 2 · silinecek' },
      { anahtar: rows[0]!.anahtar, metin: 'id = 1 · eposta' },
      { anahtar: rows[2]!.anahtar, metin: '+ yeni satır · DEFAULT VALUES' },
      { anahtar: rows[3]!.anahtar, metin: '+ yeni satır · ad, eposta' },
    ]);
  });
});

describe('Bekleyen değişiklik deposu: salt okunur kolonlar', () => {
  const TABLE: EditableTable = {
    sema: 's',
    tablo: 't',
    kolonlar: ['id', 'dosya', 'toplam', 'ad'],
    tipler: ['integer', 'bytea', 'numeric', 'text'],
    pk: ['id'],
    uretilmis: ['toplam'],
  };
  const ROW = ['1', '\\x00', '3', 'a'];

  it('`bytea` ve generated kolonlar salt okunur, nedeniyle', () => {
    expect([0, 1, 2, 3].map((c) => readOnlyReason(TABLE, c))).toEqual([
      null,
      '“dosya” bytea kolonu: salt okunur',
      '“toplam” üretilmiş (generated) kolon: salt okunur',
      null,
    ]);
  });

  it('salt okunur kolona düzenleme yok sayılır', () => {
    let changes = editCell(TABLE, NO_CHANGES, loaded(ROW), 1, 'x');
    changes = addRow(changes);
    changes = editCell(TABLE, changes, at(changes, 1, TABLE, [ROW]), 2, '5');
    expect(sql(changes, TABLE)).toEqual([`INSERT INTO "s"."t" DEFAULT VALUES;`]);
  });
});

describe('Bekleyen değişiklik deposu: TSV yapıştırma', () => {
  const rows = (changes: PendingChanges) => gridRows(USERS, changes, LOADED);
  const paste = (changes: PendingChanges, satir: number, kolon: number, metin: string, table = USERS) =>
    pasteTsv(table, changes, gridRows(table, changes, LOADED), { satir, kolon }, metin);

  it('seçimin sol üst köşesinden başlar; boş hücre NULL, `NULL` metni düz metin', () => {
    const changes = paste(NO_CHANGES, 0, 1, 'Veli\t\nNULL\tz@x') as PendingChanges;
    expect(sql(changes)).toEqual([
      `UPDATE "public"."users" SET "ad" = 'Veli'::text, "eposta" = NULL WHERE "id" = '1'::integer;`,
      `UPDATE "public"."users" SET "ad" = 'NULL'::text, "eposta" = 'z@x'::text WHERE "id" = '2'::integer;`,
    ]);
  });

  it('taşan satırlar yeni satır olur; yalnızca yapıştırılan kolonlar dokunulmuştur', () => {
    const changes = paste(NO_CHANGES, 1, 1, 'B\nC\t\nD') as PendingChanges;
    expect(rows(changes).map((r) => r.durum)).toEqual([null, null, 'eklendi', 'eklendi']);
    expect(sql(changes)).toEqual([
      `UPDATE "public"."users" SET "ad" = 'B'::text WHERE "id" = '2'::integer;`,
      `INSERT INTO "public"."users" ("ad", "eposta") VALUES ('C'::text, NULL);`,
      `INSERT INTO "public"."users" ("ad") VALUES ('D'::text);`,
    ]);
  });

  it('var olan eklenen satıra yapıştırma onu düzenler', () => {
    let changes = addRow(NO_CHANGES);
    changes = paste(changes, 2, 0, '7') as PendingChanges;
    expect(sql(changes)).toEqual([`INSERT INTO "public"."users" ("id") VALUES ('7'::integer);`]);
  });

  it('kolon taşması tüm yapıştırmayı reddeder', () => {
    expect(paste(NO_CHANGES, 0, 1, 'a\nb\tc\td')).toEqual({ hata: 'Yapıştırma reddedildi: 3 kolon yapıştırılıyor, seçimden itibaren 2 kolon var.' });
  });

  it('salt okunur kolona denk gelen yapıştırma tümden reddedilir', () => {
    const table: EditableTable = { ...USERS, uretilmis: ['eposta'] };
    expect(paste(NO_CHANGES, 0, 1, 'a\tb', table)).toEqual({ hata: 'Yapıştırma reddedildi: “eposta” üretilmiş (generated) kolon: salt okunur.' });
  });

  it('silinecek satıra denk gelen yapıştırma tümden reddedilir', () => {
    const changes = deleteRows(USERS, NO_CHANGES, [loaded(ROW_2)]);
    expect(paste(changes, 0, 1, 'a\nb')).toEqual({ hata: 'Yapıştırma reddedildi: silinecek satıra yapıştırılamaz; önce silmeyi geri alın.' });
  });

  it('boş pano değişiklik yapmaz', () => {
    expect(paste(NO_CHANGES, 0, 0, '')).toBe(NO_CHANGES);
  });
});

describe('Bekleyen değişiklik deposu: düzenlenebilirlik', () => {
  const input = { sema: 's', tablo: 't', kolonlar: ['id', 'ad'], tipler: ['integer', 'text'], uretilmis: [] };

  it.each([
    ['PK var', ['id'], { sema: 's', tablo: 't', kolonlar: ['id', 'ad'], tipler: ['integer', 'text'], pk: ['id'], uretilmis: [] }],
    ['PK yok', [], { kapali: 'Düzenleme kapalı: tablonun birincil anahtarı (PK) yok' }],
    ['PK kolonu sonuçta yok', ['kod'], { kapali: 'Düzenleme kapalı: birincil anahtar kolonu (kod) sonuçta yok' }],
  ])('%s', (_, pk, expected) => {
    expect(editableTable({ ...input, pk })).toEqual(expected);
  });
});

describe('Bekleyen değişiklik deposu: ifade → satır', () => {
  it('hata gelen ifadenin indeksi o ifadenin satırına çevrilir; bilinmeyen indeks `null`', () => {
    let changes = editCell(USERS, NO_CHANGES, loaded(ROW_1), 1, 'Veli');
    changes = editCell(USERS, changes, loaded(ROW_2), 1, 'Zeynep');
    const script = pendingScript(USERS, changes);
    expect(failedRowKey(script, 1)).toBe(rowKey(USERS, ROW_2));
    expect(failedRowKey(script, 0)).toBe(rowKey(USERS, ROW_1));
    expect(failedRowKey(script, 5)).toBeNull();
  });
});
