import { describe, expect, it } from 'vitest';
import { toTsv } from './tsv';

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
