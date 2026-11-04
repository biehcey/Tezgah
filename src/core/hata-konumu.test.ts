import { describe, expect, it } from 'vitest';
import { errorLocation } from './hata-konumu';
import { splitStatements } from './ifade-bolme';

/** Betikteki `index`'inci ifadede verilen Postgres `position`'ının konumu ve işaretlenen metin. */
function locate(script: string, index: number, position?: number) {
  const statement = splitStatements(script)[index]!;
  const location = errorLocation(script, statement, position);
  return { ...location, isaretli: script.slice(location.bas, location.bit) };
}

describe('errorLocation', () => {
  it.each([
    ['tek satır', 'SELEC 1', 0, 1, { satir: 1, sutun: 1, isaretli: 'SELEC' }],
    ['ifade içi konum kelimenin sonuna kadar işaretlenir', 'SELECT * FRM t', 0, 10, { satir: 1, sutun: 10, isaretli: 'FRM' }],
    ['ikinci ifade, sonraki satır', 'SELECT 1;\n\n  SELECT nope FROM t', 1, 8, { satir: 3, sutun: 10, isaretli: 'nope' }],
    ['çok satırlı ifadenin ikinci satırı', '-- baş\nUPDATE t\n   SET x = y\n WHERE z', 0, 21, { satir: 3, sutun: 12, isaretli: 'y' }],
    ['CRLF satır sonları', 'SELECT 1;\r\nSELECT\r\n  bad', 1, 11, { satir: 3, sutun: 3, isaretli: 'bad' }],
    ['girdinin sonu (position = uzunluk + 1) son karakteri işaretler', 'SELECT 1;\nSELECT (', 1, 9, { satir: 2, sutun: 8, isaretli: '(' }],
    ['position karakter sayar (BMP dışı karakter)', "SELECT '😀', bad", 0, 13, { satir: 1, sutun: 14, isaretli: 'bad' }],
  ])('%s', (_, script, index, position, expected) => {
    expect(locate(script, index, position)).toMatchObject(expected);
  });

  it('position yoksa ifadenin tamamı işaretlenir', () => {
    expect(locate('SELECT 1;\n  INSERT INTO t\n  VALUES (1);', 1)).toMatchObject({
      satir: 2,
      sutun: 3,
      isaretli: 'INSERT INTO t\n  VALUES (1)',
    });
  });
});
