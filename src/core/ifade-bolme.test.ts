import { describe, expect, it } from 'vitest';
import { positionOf, splitStatements } from './ifade-bolme';

const texts = (script: string) => splitStatements(script).map((s) => s.text);

describe('splitStatements: sınırlar', () => {
  it.each([
    ['tek ifade, noktalı virgülsüz', 'SELECT 1', ['SELECT 1']],
    ['iki ifade', 'SELECT 1; SELECT 2;', ['SELECT 1', 'SELECT 2']],
    ['satırlara yayılan ifade', 'UPDATE t\n  SET a = 1\n WHERE id = 2;\nSELECT 2', ['UPDATE t\n  SET a = 1\n WHERE id = 2', 'SELECT 2']],
    ['boş ifadeler atlanır', ';; SELECT 1 ;\n;', ['SELECT 1']],
    ['yalnızca boşluk ve yorum ifade üretmez', '  -- yorum\n/* blok */\n', []],
    ['satır yorumundaki ; bölmez', 'SELECT 1 -- a; b\n+ 1;', ['SELECT 1 -- a; b\n+ 1']],
    ['blok yorumundaki ; bölmez', 'SELECT /* ; */ 1;', ['SELECT /* ; */ 1']],
    ['iç içe blok yorumu', 'SELECT /* a /* ; */ ; */ 1; SELECT 2', ['SELECT /* a /* ; */ ; */ 1', 'SELECT 2']],
    ['dizgedeki ; bölmez', "SELECT 'a;b';", ["SELECT 'a;b'"]],
    ['dizgede çift tırnak kaçışı', "SELECT 'it''s; ok'; SELECT 2", ["SELECT 'it''s; ok'", 'SELECT 2']],
    ['düz dizgede ters bölü kaçış değildir', "SELECT 'a\\'; SELECT 2", ["SELECT 'a\\'", 'SELECT 2']],
    ['E dizgesinde ters bölü kaçıştır', "SELECT E'a\\'; b'; SELECT 2", ["SELECT E'a\\'; b'", 'SELECT 2']],
    ['küçük e dizgesi', "SELECT e'\\';'; SELECT 2", ["SELECT e'\\';'", 'SELECT 2']],
    ['E ile biten ad E dizgesi değildir', "SELECT name'a\\'; SELECT 2", ["SELECT name'a\\'", 'SELECT 2']],
    ['U& dizgesi', "SELECT U&'d\\0061t;a'; SELECT 2", ["SELECT U&'d\\0061t;a'", 'SELECT 2']],
    ['tırnaklı ad', 'SELECT 1 AS "a;""b"; SELECT 2', ['SELECT 1 AS "a;""b"', 'SELECT 2']],
    ['dollar-quote', 'DO $$ BEGIN PERFORM 1; END $$; SELECT 2', ['DO $$ BEGIN PERFORM 1; END $$', 'SELECT 2']],
    [
      'etiketli dollar-quote içinde başka etiket',
      'CREATE FUNCTION f() RETURNS int AS $body$ SELECT $x$;$x$; $body$ LANGUAGE sql; SELECT 2',
      ['CREATE FUNCTION f() RETURNS int AS $body$ SELECT $x$;$x$; $body$ LANGUAGE sql', 'SELECT 2'],
    ],
    ['konumsal parametre dollar-quote değildir', 'SELECT $1; SELECT 2', ['SELECT $1', 'SELECT 2']],
    ['ad içindeki $ dollar-quote değildir', 'SELECT a$b$; SELECT 2', ['SELECT a$b$', 'SELECT 2']],
    ['baştaki yorum ifadeye dahil değildir', '-- açıklama\nSELECT 1;', ['SELECT 1']],
    ['sondaki yorum ifadeye dahil değildir', 'SELECT 1 -- son', ['SELECT 1']],
  ])('%s', (_, script, expected) => {
    expect(texts(script)).toEqual(expected);
  });
});

describe('splitStatements: bozuk girdi bölmeyi engellemez', () => {
  it.each([
    ['yazımı bozuk ifade', 'SELEC 1 FRM; SELECT 2', ['SELEC 1 FRM', 'SELECT 2']],
    ['kapanmamış dizge sona kadar sürer', "SELECT 1; SELECT 'a; SELECT 2", ['SELECT 1', "SELECT 'a; SELECT 2"]],
    ['kapanmamış blok yorumu', 'SELECT 1; SELECT /* a; b', ['SELECT 1', 'SELECT /* a; b']],
    ['kapanmamış dollar-quote', 'SELECT 1; DO $$ a; b', ['SELECT 1', 'DO $$ a; b']],
    ['kapanmamış tırnaklı ad', 'SELECT 1; SELECT "a; b', ['SELECT 1', 'SELECT "a; b']],
  ])('%s', (_, script, expected) => {
    expect(texts(script)).toEqual(expected);
  });
});

describe('splitStatements: offset', () => {
  it('başlangıç ve bitiş betikteki konumdur', () => {
    const script = '-- x\n  SELECT 1 ;\nSELECT 2';
    const [first, second] = splitStatements(script);
    expect(first).toMatchObject({ start: 7, end: 15 });
    expect(script.slice(first!.start, first!.end)).toBe('SELECT 1');
    expect(second).toMatchObject({ start: 18, end: 26 });
  });
});

describe('splitStatements: ilk anahtar kelimeler', () => {
  it.each([
    ['büyük harfe çevrilir', 'select 1', ['SELECT']],
    ['ilk noktalama işaretine kadar', 'create unique index concurrently ix on t (a)', ['CREATE', 'UNIQUE', 'INDEX', 'CONCURRENTLY', 'IX', 'ON', 'T']],
    ['yorumlar atlanır', 'VACUUM /* not */ -- x\n ANALYZE t', ['VACUUM', 'ANALYZE', 'T']],
    ['tırnaklı ad kelime değildir ve durdurur', 'ALTER TABLE "t" ADD x int', ['ALTER', 'TABLE']],
    ['en fazla sekiz kelime', 'a b c d e f g h i j', ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']],
    ['dollar-quote ile başlayan', 'DO $$ x $$', ['DO']],
  ])('%s', (_, script, expected) => {
    expect(splitStatements(script)[0]!.keywords).toEqual(expected);
  });
});

describe('splitStatements: tüm kelimeler', () => {
  it.each([
    ['noktalama ve tırnaklı adlar durdurmaz', 'ALTER TABLE "s".t DETACH PARTITION p1 concurrently', ['ALTER', 'TABLE', 'T', 'DETACH', 'PARTITION', 'P1', 'CONCURRENTLY']],
    ['dizge, yorum ve dollar-quote içi kelime değildir', "SELECT 'a b' /* c */ , $$ d $$, E'e' -- f\n FROM g", ['SELECT', 'FROM', 'G']],
    ['sekizden fazla kelime', 'a b c d e f g h i j', ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']],
  ])('%s', (_, script, expected) => {
    expect(splitStatements(script)[0]!.words).toEqual(expected);
  });
});

describe('splitStatements: psql meta komutları', () => {
  it.each([
    ['tek başına satır', 'SELECT 1;\n\\set x 1\nSELECT 2', [['SELECT 1', false], ['\\set x 1', true], ['SELECT 2', false]]],
    ['ifadenin sonunda \\g ifadeyi bitirir', 'SELECT 1 \\gset\nSELECT 2', [['SELECT 1', false], ['\\gset', true], ['SELECT 2', false]]],
    ['dizge içindeki ters bölü meta değildir', "SELECT '\\x'", [["SELECT '\\x'", false]]],
    ['satır sonuna kadar sürer, ; dahil', '\\echo a; b\nSELECT 2', [['\\echo a; b', true], ['SELECT 2', false]]],
  ])('%s', (_, script, expected) => {
    expect(splitStatements(script).map((s) => [s.text, s.meta])).toEqual(expected);
  });
});

describe('positionOf', () => {
  it.each([
    ['ilk karakter', 'SELECT 1', 0, { satir: 1, sutun: 1 }],
    ['ikinci satır', 'a\nbc\nd', 3, { satir: 2, sutun: 2 }],
    ['CRLF satır sonu', 'a\r\nbc', 4, { satir: 2, sutun: 2 }],
    ['betik sonu', 'a\n', 2, { satir: 2, sutun: 1 }],
  ])('%s', (_, script, offset, expected) => {
    expect(positionOf(script, offset)).toEqual(expected);
  });
});
