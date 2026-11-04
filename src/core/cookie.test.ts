import { describe, expect, it } from 'vitest';
import { readCookie } from './cookie';

describe('readCookie', () => {
  it.each([
    ['tek cookie', 'a=1', 'a', '1'],
    ['birden çok cookie', 'x=9; a=1; b=2', 'a', '1'],
    ['boşluksuz ayraç', 'x=9;a=1', 'a', '1'],
    ['değerde = var', 'a=b=c', 'a', 'b=c'],
    ['tırnaklı değer', 'a="1"', 'a', '1'],
    ['ad önek eşleşmesi sayılmaz', 'aa=1', 'a', undefined],
    ['yok', 'x=9', 'a', undefined],
    ['başlık yok', undefined, 'a', undefined],
    ['aynı ad iki kez: ilki', 'a=1; a=2', 'a', '1'],
  ])('%s', (_ad, header, name, expected) => {
    expect(readCookie(header, name)).toBe(expected);
  });
});
