import { describe, expect, it } from 'vitest';
import { ddlTargets, decodeOldNew, dmlTarget, oldNewSelect, parseServerVersion, parseTableInfo, qualifiedName, tableInfoQuery, withReturning } from './deneme';
import { splitStatements } from './ifade-bolme';

const rewrite = (sql: string) => withReturning(splitStatements(sql)[0]!);

describe('withReturning: Deneme modunda DML yeniden yazımı', () => {
  it.each([
    ['INSERT INTO t VALUES (1)', 'INSERT INTO t VALUES (1) RETURNING *'],
    ['update t set a = 1 where id = 2', 'update t set a = 1 where id = 2 RETURNING *'],
    ['DELETE FROM t WHERE id = 1', 'DELETE FROM t WHERE id = 1 RETURNING *'],
    ['INSERT INTO t VALUES (1) ON CONFLICT DO NOTHING', 'INSERT INTO t VALUES (1) ON CONFLICT DO NOTHING RETURNING *'],
    // Sondaki `;` ve yorum ifade metnine girmez; ek son anlamlı karakterden sonra gelir.
    ['DELETE FROM t -- hepsi\n;', 'DELETE FROM t RETURNING *'],
  ])('%s → RETURNING * eklenir', (sql, expected) => {
    expect(rewrite(sql)).toEqual({ text: expected, degistirir: true, kendiReturning: false });
  });

  it.each([
    'INSERT INTO t VALUES (1) RETURNING id',
    'UPDATE t SET a = 1 returning a, b',
    'DELETE FROM t RETURNING *',
  ])('kullanıcının RETURNING’i olan ifadeye dokunulmaz ama sonucu değişiklik önizlemesidir: %s', (sql) => {
    expect(rewrite(sql)).toEqual({ text: sql, degistirir: true, kendiReturning: true });
  });

  it.each([
    'SELECT * FROM t',
    'CREATE TABLE t (id int)',
    'WITH d AS (DELETE FROM t RETURNING *) SELECT count(*) FROM d',
    "SELECT 'INSERT INTO t'",
    'TRUNCATE t',
  ])('DML olmayan ifade olduğu gibi kalır: %s', (sql) => {
    expect(rewrite(sql)).toEqual({ text: sql, degistirir: false, kendiReturning: false });
  });

  it('dizge ya da tırnaklı addaki returning kelimesi RETURNING sayılmaz', () => {
    expect(rewrite(`INSERT INTO t VALUES ('returning')`).text).toBe(`INSERT INTO t VALUES ('returning') RETURNING *`);
    expect(rewrite(`UPDATE t SET "returning" = 1`).text).toBe(`UPDATE t SET "returning" = 1 RETURNING *`);
  });
});

describe('dmlTarget: DML ifadesinin hedef tablosu', () => {
  const target = (sql: string) => dmlTarget(splitStatements(sql)[0]!);
  it.each([
    ['INSERT INTO t VALUES (1)', { ad: 't' }],
    ['insert into Public.Musteri (id) values (1)', { sema: 'public', ad: 'musteri' }],
    ['UPDATE ONLY "Büyük"."Tablo" SET a = 1', { sema: 'Büyük', ad: 'Tablo' }],
    ['DELETE FROM /* yorum */ s.t WHERE id = 1', { sema: 's', ad: 't' }],
    ['update "a""b" set x = 1', { ad: 'a"b' }],
    ['DELETE FROM ONLY t', { ad: 't' }],
    ['DELETE FROM /* dış /* iç */ hâlâ yorum */ t', { ad: 't' }],
  ])('%s', (sql, expected) => {
    expect(target(sql)).toEqual(expected);
  });

  it.each(['SELECT 1', 'WITH d AS (DELETE FROM t RETURNING *) SELECT 1', 'INSERT t VALUES (1)'])('hedef yok: %s', (sql) => {
    expect(target(sql)).toBeNull();
  });
});

describe('ddlTargets: DDL ifadesinin dokunduğu tablolar', () => {
  const targets = (sql: string) => ddlTargets(splitStatements(sql)[0]!);
  it.each([
    ['ALTER TABLE musteriler ADD COLUMN son_giris timestamptz', [{ ad: 'musteriler' }]],
    ['alter table if exists only s.t drop column a', [{ sema: 's', ad: 't' }]],
    ['CREATE TABLE IF NOT EXISTS yeni (id int)', [{ ad: 'yeni' }]],
    ['create unlogged table u (id int)', [{ ad: 'u' }]],
    ['CREATE TEMP TABLE gecici (id int)', [{ ad: 'gecici' }]],
    ['DROP TABLE IF EXISTS a, s.b CASCADE', [{ ad: 'a' }, { sema: 's', ad: 'b' }]],
    ['CREATE TABLE t AS SELECT 1', [{ ad: 't' }]],
  ])('%s', (sql, expected) => {
    expect(targets(sql)).toEqual(expected);
  });

  it.each(['CREATE INDEX i ON t (a)', 'ALTER SEQUENCE s RESTART', 'SELECT 1', 'DROP VIEW v'])('tablo şeması değiştirmez: %s', (sql) => {
    expect(targets(sql)).toEqual([]);
  });
});

describe('qualifiedName', () => {
  it('her parçayı tırnaklar; to_regclass sözdizimi hatası vermez', () => {
    expect(qualifiedName({ ad: 'a"b' })).toBe('"a""b"');
    expect(qualifiedName({ sema: 's', ad: 't' })).toBe('"s"."t"');
  });
});

describe('withReturning: PG18+ ve PK’lı tabloda önce/sonra', () => {
  it('işlem türü PK’nın eski/yeni değerinin NULL’luğundan; old/new kendi takma adlarıyla (tablonun `old` takma adıyla çakışmasın)', () => {
    expect(withReturning(splitStatements('UPDATE t AS old SET a = 1')[0]!, { anahtar: ['Id', 'b'], kolonlar: ['Id', 'b', 'a'] })).toEqual({
      text:
        `UPDATE t AS old SET a = 1 RETURNING WITH (OLD AS tezgah_once, NEW AS tezgah_sonra) ` +
        `CASE WHEN tezgah_once."Id" IS NULL THEN 'I' WHEN tezgah_sonra."Id" IS NULL THEN 'D' ELSE 'U' END AS tezgah_tur, tezgah_once.*, tezgah_sonra.*`,
      degistirir: true,
      kendiReturning: false,
      turKolonu: 'tezgah_tur',
    });
  });

  it('tür kolonunun adı tablonun kolonlarıyla çakışmaz', () => {
    const rewritten = withReturning(splitStatements('DELETE FROM t')[0]!, { anahtar: ['id'], kolonlar: ['id', 'tezgah_tur', 'tezgah_tur_1'] });
    expect(rewritten.turKolonu).toBe('tezgah_tur_2');
    expect(rewritten.text).toContain('END AS tezgah_tur_2,');
  });

  it('kullanıcının RETURNING’i varsa PK verilse de dokunulmaz', () => {
    expect(withReturning(splitStatements('DELETE FROM t RETURNING id')[0]!, { anahtar: ['id'], kolonlar: ['id'] })).toEqual({
      text: 'DELETE FROM t RETURNING id',
      degistirir: true,
      kendiReturning: true,
    });
  });

  it('PK boşsa RETURNING *', () => {
    expect(withReturning(splitStatements('DELETE FROM t')[0]!, { anahtar: [], kolonlar: ['a'] })).toMatchObject({ text: 'DELETE FROM t RETURNING *' });
  });
});

describe('tableInfoQuery / parseTableInfo: katalogdan tablo bilgisi', () => {
  it('ad tırnaklı literal olarak, oid sayı olarak sorguya girer', () => {
    expect(tableInfoQuery({ ad: { sema: "o'ne", ad: 't' } })).toContain(`to_regclass('"o''ne"."t"')`);
    expect(tableInfoQuery({ oid: '16384' })).toContain('c.oid = 16384::oid');
    expect(() => tableInfoQuery({ oid: '1; DROP TABLE t' })).toThrow();
  });

  it('JSON sonucu ayrıştırılır; beklenmeyen değer null', () => {
    const json = JSON.stringify({
      oid: '16384',
      ad: 'public.t',
      anahtar: ['id'],
      kolonlar: [{ no: 1, ad: 'id', tip: 'integer', bos: false, varsayilan: null }],
    });
    expect(parseTableInfo(json)).toEqual({
      tablo: { oid: '16384', ad: 'public.t' },
      anahtar: ['id'],
      sema: { ad: 'public.t', kolonlar: [{ no: 1, ad: 'id', tip: 'integer', bos: false, varsayilan: null }] },
    });
    expect(parseTableInfo('postgres')).toBeNull();
    expect(parseTableInfo(null)).toBeNull();
    expect(parseTableInfo('{"oid": 1}')).toBeNull();
  });
});

describe('parseServerVersion', () => {
  it.each([
    ['180001', 180001],
    ['170005', 170005],
    ['postgres', 0],
    [null, 0],
  ])('%s → %s', (value, expected) => {
    expect(parseServerVersion(value)).toBe(expected);
  });
});

describe('oldNewSelect / decodeOldNew: önce/sonra sarmalının sorgusu ve sonucu', () => {
  it('toplam, eklenen ve silinen sayılar pencere fonksiyonuyla, LIMIT’ten önce sayılır', () => {
    expect(oldNewSelect('w', 'tezgah_tur_2')).toBe(
      `) SELECT count(*) OVER (), count(*) FILTER (WHERE tezgah_tur_2 = 'I') OVER (), count(*) FILTER (WHERE tezgah_tur_2 = 'D') OVER (), * FROM w LIMIT 100`,
    );
  });

  it('satırlar türlerine göre önce/sonra olarak ayrılır; çekilmeyenler türlere göre sayılır', () => {
    const names = ['count', 'count', 'count', 'tezgah_tur', 'id', 'ad', 'id', 'ad'];
    expect(
      decodeOldNew(names, [
        ['150', '20', '5', 'U', '1', 'Ali', '1', 'Veli'],
        ['150', '20', '5', 'I', null, null, '9', 'Yeni'],
        ['150', '20', '5', 'D', '2', 'Ayşe', null, null],
      ]),
    ).toEqual({
      rowCount: 150,
      kolonlar: ['id', 'ad'],
      satirlar: [
        { once: ['1', 'Ali'], sonra: ['1', 'Veli'] },
        { once: null, sonra: ['9', 'Yeni'] },
        { once: ['2', 'Ayşe'], sonra: null },
      ],
      gorulmeyen: { eklendi: 19, guncellendi: 124, silindi: 4 },
    });
  });

  it('satır yoksa her şey sıfır', () => {
    expect(decodeOldNew(['count', 'count', 'count', 'tezgah_tur', 'id', 'id'], [])).toEqual({
      rowCount: 0,
      kolonlar: ['id'],
      satirlar: [],
      gorulmeyen: { eklendi: 0, guncellendi: 0, silindi: 0 },
    });
  });
});
