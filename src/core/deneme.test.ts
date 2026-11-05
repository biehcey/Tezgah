import { describe, expect, it } from 'vitest';
import { withReturning } from './deneme';
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
    expect(rewrite(sql)).toEqual({ text: expected, degistirir: true });
  });

  it.each([
    'INSERT INTO t VALUES (1) RETURNING id',
    'UPDATE t SET a = 1 returning a, b',
    'DELETE FROM t RETURNING *',
  ])('kullanıcının RETURNING’i olan ifadeye dokunulmaz ama sonucu değişiklik önizlemesidir: %s', (sql) => {
    expect(rewrite(sql)).toEqual({ text: sql, degistirir: true });
  });

  it.each([
    'SELECT * FROM t',
    'CREATE TABLE t (id int)',
    'WITH d AS (DELETE FROM t RETURNING *) SELECT count(*) FROM d',
    "SELECT 'INSERT INTO t'",
    'TRUNCATE t',
  ])('DML olmayan ifade olduğu gibi kalır: %s', (sql) => {
    expect(rewrite(sql)).toEqual({ text: sql, degistirir: false });
  });

  it('dizge ya da tırnaklı addaki returning kelimesi RETURNING sayılmaz', () => {
    expect(rewrite(`INSERT INTO t VALUES ('returning')`).text).toBe(`INSERT INTO t VALUES ('returning') RETURNING *`);
    expect(rewrite(`UPDATE t SET "returning" = 1`).text).toBe(`UPDATE t SET "returning" = 1 RETURNING *`);
  });
});
