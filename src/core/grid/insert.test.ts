import { describe, expect, it } from 'vitest';
import { insertStatements } from './insert';

describe('INSERT olarak kopyalama', () => {
  it('her satır bir INSERT; kolonlar tırnaklı, değerler tipli literal, NULL `NULL`', () => {
    expect(
      insertStatements({
        tablo: { ad: 'tablo' },
        kolonlar: ['id', 'Ad'],
        tipler: [23, 25],
        satirlar: [
          ['1', "O'Brien"],
          ['2', null],
        ],
      }),
    ).toBe(
      [
        `INSERT INTO "tablo" ("id", "Ad") VALUES ('1'::integer, 'O''Brien'::text);`,
        `INSERT INTO "tablo" ("id", "Ad") VALUES ('2'::integer, NULL);`,
      ].join('\n'),
    );
  });

  it('şemalı tablo adı şema.tablo olarak tırnaklanır', () => {
    expect(insertStatements({ tablo: { sema: 'Satış', ad: 'sipariş' }, kolonlar: ['id'], tipler: [23], satirlar: [['7']] })).toBe(
      `INSERT INTO "Satış"."sipariş" ("id") VALUES ('7'::integer);`,
    );
  });

  it('tipi çözülmeyen ya da bilinmeyen kolon `::tip` ekini almaz', () => {
    expect(insertStatements({ tablo: { ad: 'tablo' }, kolonlar: ['d', 'x'], tipler: [99999, 23], satirlar: [['a', 'b']] })).toBe(
      `INSERT INTO "tablo" ("d", "x") VALUES ('a', 'b'::integer);`,
    );
    expect(insertStatements({ tablo: { ad: 'tablo' }, kolonlar: ['d'], satirlar: [['a']] })).toBe(`INSERT INTO "tablo" ("d") VALUES ('a');`);
  });

  it('katalog eşlemesi kullanıcı tiplerini çözer', () => {
    const katalog = new Map([[99999, 'public.durum']]);
    expect(insertStatements({ tablo: { ad: 'tablo' }, kolonlar: ['d'], tipler: [99999], satirlar: [['açık']], katalog })).toBe(
      `INSERT INTO "tablo" ("d") VALUES ('açık'::public.durum);`,
    );
  });

  it('satır yoksa boş metin', () => {
    expect(insertStatements({ tablo: { ad: 'tablo' }, kolonlar: ['id'], tipler: [23], satirlar: [] })).toBe('');
  });
});
