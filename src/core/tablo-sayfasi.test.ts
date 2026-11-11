import { describe, expect, it } from 'vitest';
import { appendPage, nextCursor, parseTablePageRequest, rowEstimate, tablePageQuery, type TableMeta } from './tablo-sayfasi';

const users: TableMeta = { sema: 'public', tablo: 'users', kolonlar: ['id', 'ad'], pk: ['id'] };
const kalem: TableMeta = { sema: 'app', tablo: 'Sipariş Kalemi', kolonlar: ['siparis', 'sira', 'urun'], pk: ['siparis', 'sira'] };
const log: TableMeta = { sema: 'public', tablo: 'log', kolonlar: ['ts', 'mesaj'], pk: [] };

const rows = (n: number, row: (i: number) => (string | null)[]) => Array.from({ length: n }, (_, i) => row(i));

describe('tablePageQuery: PK’lı tabloda keyset', () => {
  it('ilk sayfa PK sırasıyla 500 satır, parametresiz', () => {
    expect(tablePageQuery(users, null)).toEqual({
      text: 'SELECT "id", "ad" FROM "public"."users" ORDER BY "id" LIMIT 500',
      values: [],
      mod: 'keyset',
    });
  });

  it('sonraki sayfa önceki sayfanın son PK değerinden sonrası, parametreli', () => {
    expect(tablePageQuery(users, { tur: 'keyset', degerler: ['500'] })).toEqual({
      text: 'SELECT "id", "ad" FROM "public"."users" WHERE ("id") > ($1) ORDER BY "id" LIMIT 500',
      values: ['500'],
      mod: 'keyset',
    });
  });

  it('çok kolonlu PK satır karşılaştırmasıyla, PK sırasıyla; adlar tırnaklı', () => {
    expect(tablePageQuery(kalem, { tur: 'keyset', degerler: ['7', '3'] })).toEqual({
      text: 'SELECT "siparis", "sira", "urun" FROM "app"."Sipariş Kalemi" WHERE ("siparis", "sira") > ($1, $2) ORDER BY "siparis", "sira" LIMIT 500',
      values: ['7', '3'],
      mod: 'keyset',
    });
  });
});

describe('tablePageQuery: PK’sız tabloda OFFSET', () => {
  it('sırasız LIMIT 500, sonraki sayfalar OFFSET ile', () => {
    expect(tablePageQuery(log, null)).toEqual({ text: 'SELECT "ts", "mesaj" FROM "public"."log" LIMIT 500 OFFSET 0', values: [], mod: 'offset' });
    expect(tablePageQuery(log, { tur: 'offset', offset: 1000 }).text).toBe('SELECT "ts", "mesaj" FROM "public"."log" LIMIT 500 OFFSET 1000');
  });

  it('imleç tabloya uymuyorsa ilk sayfa çekilmez, hata verir', () => {
    expect(() => tablePageQuery(log, { tur: 'keyset', degerler: ['1'] })).toThrow();
    expect(() => tablePageQuery(users, { tur: 'keyset', degerler: ['1', '2'] })).toThrow();
    expect(() => tablePageQuery(users, { tur: 'offset', offset: 500 })).toThrow();
    expect(() => tablePageQuery(log, { tur: 'offset', offset: -1 })).toThrow();
  });
});

describe('nextCursor', () => {
  it('dolu keyset sayfasında son satırın PK değerleri, kolon sırasından bağımsız PK sırasıyla', () => {
    const meta: TableMeta = { ...kalem, kolonlar: ['urun', 'sira', 'siparis'] };
    const page = rows(500, (i) => [`u${i}`, String(i), '9']);
    expect(nextCursor(meta, null, page)).toEqual({ tur: 'keyset', degerler: ['9', '499'] });
  });

  it('dolu OFFSET sayfasında bir sonraki ofset', () => {
    expect(nextCursor(log, null, rows(500, () => ['t', 'm']))).toEqual({ tur: 'offset', offset: 500 });
    expect(nextCursor(log, { tur: 'offset', offset: 500 }, rows(500, () => ['t', 'm']))).toEqual({ tur: 'offset', offset: 1000 });
  });

  it('500’den az satır gelen sayfa sondur', () => {
    expect(nextCursor(users, null, rows(499, (i) => [String(i), 'a']))).toBeNull();
    expect(nextCursor(log, { tur: 'offset', offset: 500 }, [])).toBeNull();
  });
});

describe('rowEstimate', () => {
  it('reltuples = -1 (hiç analiz edilmedi) "≈ bilinmiyor", 0 değil', () => {
    expect(rowEstimate(-1)).toBe('≈ bilinmiyor');
  });

  it('aksi hâlde yuvarlanmış, binlik ayraçlı', () => {
    expect(rowEstimate(0)).toBe('≈ 0 satır');
    expect(rowEstimate(42)).toBe('≈ 42 satır');
    expect(rowEstimate(1234567.4)).toBe('≈ 1.234.567 satır');
  });
});

describe('appendPage', () => {
  const keyset = (v: string) => ({ tur: 'keyset' as const, degerler: [v] });

  it('sayfa sona eklenir, sonraki imleç gelen sayfanınkidir', () => {
    expect(appendPage([['1']], { satirlar: [['2'], ['3']], sonraki: keyset('3') })).toEqual({
      satirlar: [['1'], ['2'], ['3']],
      sonraki: keyset('3'),
      sinir: false,
    });
  });

  it('100.000 satırda kesilir; devamı varsa sınır işaretlenir ve imleç düşer', () => {
    const loaded = rows(99_800, (i) => [String(i)]);
    const result = appendPage(loaded, { satirlar: rows(500, (i) => [`y${i}`]), sonraki: keyset('y499') });
    expect(result.satirlar).toHaveLength(100_000);
    expect(result.satirlar.at(-1)).toEqual(['y199']);
    expect(result).toMatchObject({ sonraki: null, sinir: true });
  });

  it('son sayfa sınırın altında kalırsa sınır yok', () => {
    expect(appendPage(rows(99_000, () => ['x']), { satirlar: rows(10, () => ['y']), sonraki: null })).toMatchObject({ sinir: false, sonraki: null });
  });
});

describe('parseTablePageRequest', () => {
  it('ilk sayfa, keyset ve offset imleçleri', () => {
    expect(parseTablePageRequest({ sema: 'public', tablo: 'users' })).toEqual({ sema: 'public', tablo: 'users', sonraki: null });
    expect(parseTablePageRequest({ sema: 's', tablo: 't', sonraki: { tur: 'keyset', degerler: ['1', '2'] } })?.sonraki).toEqual({ tur: 'keyset', degerler: ['1', '2'] });
    expect(parseTablePageRequest({ sema: 's', tablo: 't', sonraki: { tur: 'offset', offset: 500 } })?.sonraki).toEqual({ tur: 'offset', offset: 500 });
  });

  it('bozuk gövde reddedilir', () => {
    for (const raw of [null, 'x', { tablo: 't' }, { sema: 's', tablo: '' }, { sema: 's', tablo: 't', sonraki: { tur: 'keyset', degerler: [1] } }, { sema: 's', tablo: 't', sonraki: { tur: 'baska' } }, { sema: 's', tablo: 't', sonraki: 5 }]) {
      expect(parseTablePageRequest(raw)).toBeNull();
    }
  });
});
