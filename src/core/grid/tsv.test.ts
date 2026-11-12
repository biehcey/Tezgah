import { describe, expect, it } from 'vitest';
import { parseTsv, toTsv } from './tsv';

describe('TSV kopyalama', () => {
  it('başlıksız; hücreler sekmeyle, satırlar satır sonuyla ayrılır', () => {
    expect(
      toTsv([
        ['1', 'Ali'],
        ['2', 'Ayşe'],
      ]),
    ).toBe('1\tAli\n2\tAyşe');
  });

  it('NULL boş yazılır, boş metin de boştur', () => {
    expect(toTsv([[null, '', 'x']])).toBe('\t\tx');
  });

  it('sekme, satır sonu ya da çift tırnak içeren hücre tırnaklanır, içteki tırnak ikilenir', () => {
    expect(toTsv([['a\tb', 'c\nd', 'e\r\nf', 'say "hi"', 'düz']])).toBe('"a\tb"\t"c\nd"\t"e\r\nf"\t"say ""hi"""\tdüz');
  });

  it('boş aralık boş metin verir', () => {
    expect(toTsv([])).toBe('');
  });
});

describe('TSV yapıştırma çözümlemesi', () => {
  it('sekme hücreleri, satır sonu (\\n ya da \\r\\n) satırları ayırır; sondaki satır sonu yeni satır açmaz', () => {
    expect(parseTsv('1\tAli\r\n2\tAyşe\n')).toEqual([
      ['1', 'Ali'],
      ['2', 'Ayşe'],
    ]);
  });

  it('boş hücre NULL; `NULL` metni düz metin', () => {
    expect(parseTsv('\tNULL\t')).toEqual([[null, 'NULL', null]]);
  });

  it('tırnaklı hücreler kopyalama kuralına simetrik çözülür', () => {
    const rows = [['a\tb', 'c\nd', 'e\r\nf', 'say "hi"', 'düz']];
    expect(parseTsv(toTsv(rows))).toEqual(rows);
    expect(parseTsv('""\tx')).toEqual([['', 'x']]);
  });

  it('tırnakla başlamayan hücredeki tırnak düz metindir', () => {
    expect(parseTsv('5" vida\tx"y')).toEqual([['5" vida', 'x"y']]);
  });

  it('boş metin boş matris', () => {
    expect(parseTsv('')).toEqual([]);
  });
});
