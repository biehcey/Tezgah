import { describe, expect, it } from 'vitest';
import {
  FilterError,
  appendPage,
  columnSort,
  cycleOrderBy,
  filterErrorPosition,
  headerSort,
  nextCursor,
  pageErrorText,
  parseTablePageRequest,
  rowEstimate,
  tablePageQuery,
  type TableMeta,
} from './tablo-sayfasi';

const users: TableMeta = { sema: 'public', tablo: 'users', kolonlar: ['id', 'ad'], pk: ['id'] };
const kalem: TableMeta = { sema: 'app', tablo: 'Sipariş Kalemi', kolonlar: ['siparis', 'sira', 'urun'], pk: ['siparis', 'sira'] };
const log: TableMeta = { sema: 'public', tablo: 'log', kolonlar: ['ts', 'mesaj'], pk: [] };

const rows = (n: number, row: (i: number) => (string | null)[]) => Array.from({ length: n }, (_, i) => row(i));

describe('tablePageQuery: PK’lı tabloda keyset', () => {
  it('ilk sayfa PK sırasıyla 500 satır, parametresiz', () => {
    expect(tablePageQuery(users, null)).toMatchObject({
      text: 'SELECT "id", "ad" FROM "public"."users" ORDER BY "id" LIMIT 500',
      values: [],
      mod: 'keyset',
    });
  });

  it('sonraki sayfa önceki sayfanın son PK değerinden sonrası, parametreli', () => {
    expect(tablePageQuery(users, { tur: 'keyset', degerler: ['500'] })).toMatchObject({
      text: 'SELECT "id", "ad" FROM "public"."users" WHERE ("id") > ($1) ORDER BY "id" LIMIT 500',
      values: ['500'],
      mod: 'keyset',
    });
  });

  it('çok kolonlu PK satır karşılaştırmasıyla, PK sırasıyla; adlar tırnaklı', () => {
    expect(tablePageQuery(kalem, { tur: 'keyset', degerler: ['7', '3'] })).toMatchObject({
      text: 'SELECT "siparis", "sira", "urun" FROM "app"."Sipariş Kalemi" WHERE ("siparis", "sira") > ($1, $2) ORDER BY "siparis", "sira" LIMIT 500',
      values: ['7', '3'],
      mod: 'keyset',
    });
  });
});

describe('tablePageQuery: PK’sız tabloda OFFSET', () => {
  it('sırasız LIMIT 500, sonraki sayfalar OFFSET ile', () => {
    expect(tablePageQuery(log, null)).toMatchObject({ text: 'SELECT "ts", "mesaj" FROM "public"."log" LIMIT 500 OFFSET 0', values: [], mod: 'offset' });
    expect(tablePageQuery(log, { tur: 'offset', offset: 1000 }).text).toBe('SELECT "ts", "mesaj" FROM "public"."log" LIMIT 500 OFFSET 1000');
  });

  it('imleç tabloya uymuyorsa ilk sayfa çekilmez, hata verir', () => {
    expect(() => tablePageQuery(log, { tur: 'keyset', degerler: ['1'] })).toThrow();
    expect(() => tablePageQuery(users, { tur: 'keyset', degerler: ['1', '2'] })).toThrow();
    expect(() => tablePageQuery(users, { tur: 'offset', offset: 500 })).toThrow();
    expect(() => tablePageQuery(log, { tur: 'offset', offset: -1 })).toThrow();
  });
});

describe('tablePageQuery: kullanıcı WHERE ve ORDER BY', () => {
  it('WHERE parantez içinde gömülür; keyset koşulu AND ile eklenir', () => {
    expect(tablePageQuery(users, null, { where: 'ad = \'x\' OR id < 3', orderBy: '' })).toMatchObject({
      text: 'SELECT "id", "ad" FROM "public"."users" WHERE (ad = \'x\' OR id < 3) ORDER BY "id" LIMIT 500',
      values: [],
      mod: 'keyset',
    });
    expect(tablePageQuery(users, { tur: 'keyset', degerler: ['500'] }, { where: 'id < 900', orderBy: '' }).text).toBe(
      'SELECT "id", "ad" FROM "public"."users" WHERE (id < 900) AND ("id") > ($1) ORDER BY "id" LIMIT 500',
    );
  });

  it('boşluktan ibaret kutular yok sayılır', () => {
    expect(tablePageQuery(users, null, { where: '  ', orderBy: '\t' }).text).toBe('SELECT "id", "ad" FROM "public"."users" ORDER BY "id" LIMIT 500');
  });

  it('kullanıcı ORDER BY varsa PK’lı tabloda da OFFSET’e düşülür', () => {
    expect(tablePageQuery(users, null, { where: '', orderBy: 'ad DESC' })).toMatchObject({
      text: 'SELECT "id", "ad" FROM "public"."users" ORDER BY ad DESC LIMIT 500 OFFSET 0',
      values: [],
      mod: 'offset',
    });
    expect(tablePageQuery(users, { tur: 'offset', offset: 500 }, { where: 'id > 1', orderBy: 'ad' }).text).toBe(
      'SELECT "id", "ad" FROM "public"."users" WHERE (id > 1) ORDER BY ad LIMIT 500 OFFSET 500',
    );
    expect(tablePageQuery(log, null, { where: '', orderBy: 'ts' }).text).toBe('SELECT "ts", "mesaj" FROM "public"."log" ORDER BY ts LIMIT 500 OFFSET 0');
  });

  it('sondaki yorum ve `;` atılır: yorum sorgunun devamını yutamaz', () => {
    expect(tablePageQuery(users, null, { where: 'id > 1; -- not', orderBy: 'ad -- not' }).text).toBe(
      'SELECT "id", "ad" FROM "public"."users" WHERE (id > 1) ORDER BY ad LIMIT 500 OFFSET 0',
    );
  });

  it('`;` sonrası boş olmayan metin reddedilir, hangi kutuda olduğu söylenir; dizgedeki `;` serbest', () => {
    expect(() => tablePageQuery(users, null, { where: 'true; DROP TABLE users', orderBy: '' })).toThrow(FilterError);
    expect(() => tablePageQuery(users, null, { where: '', orderBy: 'ad; DELETE FROM users' })).toThrow(
      expect.objectContaining({ kutu: 'orderBy' }),
    );
    expect(tablePageQuery(users, null, { where: "ad = 'a;b'", orderBy: '' }).text).toContain("WHERE (ad = 'a;b')");
  });
});

describe('filterErrorPosition', () => {
  it('Postgres’in sorgudaki konumu kutudaki 1 tabanlı konuma çevrilir', () => {
    const query = tablePageQuery(users, null, { where: 'id = x', orderBy: '' });
    const at = query.text.indexOf('x') + 1;
    expect(filterErrorPosition(query, at)).toEqual({ kutu: 'where', konum: 6 });
    const ordered = tablePageQuery(users, null, { where: 'id > 1', orderBy: 'yok DESC' });
    expect(filterErrorPosition(ordered, ordered.text.indexOf('yok') + 1)).toEqual({ kutu: 'orderBy', konum: 1 });
  });

  it('konum kutudaki metne göre: baştaki boşluk ve yorum sayılır', () => {
    const query = tablePageQuery(users, null, { where: '  /* c */ id = x', orderBy: '' });
    expect(filterErrorPosition(query, query.text.indexOf('x') + 1)).toEqual({ kutu: 'where', konum: 16 });
  });

  it('yarım ifadede Postgres kutudan sonraki ekleri gösterir: kutunun sonuna düşer', () => {
    const where = tablePageQuery(users, null, { where: 'id =', orderBy: '' });
    expect(filterErrorPosition(where, where.text.indexOf(')') + 1)).toEqual({ kutu: 'where', konum: 5 });
    const ordered = tablePageQuery(users, null, { where: '', orderBy: 'ad,' });
    expect(filterErrorPosition(ordered, ordered.text.indexOf('LIMIT') + 1)).toEqual({ kutu: 'orderBy', konum: 4 });
  });

  it('kutuların dışındaki konum kutuya düşmez', () => {
    const query = tablePageQuery(users, null, { where: 'id = 1', orderBy: '' });
    expect(filterErrorPosition(query, 1)).toBeNull();
    expect(filterErrorPosition(query, query.text.indexOf('ORDER') + 1)).toBeNull();
    expect(filterErrorPosition(query, undefined)).toBeNull();
  });
});

describe('pageErrorText', () => {
  it('kutudaki hata: kutu, konum, mesaj ve SQLSTATE', () => {
    expect(pageErrorText({ hata: 'syntax error', sqlstate: '42601', konum: 50, kutu: 'where', kutuKonumu: 5 })).toBe(
      'WHERE, 5. karakter: syntax error (SQLSTATE 42601)',
    );
    expect(pageErrorText({ hata: 'ORDER BY kutusu tek bir ifade olmalı', kutu: 'orderBy' })).toBe('ORDER BY: ORDER BY kutusu tek bir ifade olmalı');
    expect(pageErrorText({ hata: 'permission denied', sqlstate: '42501' })).toBe('permission denied (SQLSTATE 42501)');
  });
});

describe('headerSort', () => {
  it('ORDER BY kutusu bir kolonun başlık sıralamasıysa o kolon ve yön', () => {
    expect(headerSort(['id', 'ad'], '"ad" DESC')).toEqual({ kolon: 1, yon: 'azalan' });
    expect(headerSort(['id', 'ad'], 'ad')).toBeNull();
  });
});

describe('cycleOrderBy ve columnSort: kolon başlığına tık', () => {
  it('artan → azalan → temiz; ad tırnaklı', () => {
    expect(cycleOrderBy('', 'Ad Soyad')).toBe('"Ad Soyad"');
    expect(cycleOrderBy('"Ad Soyad"', 'Ad Soyad')).toBe('"Ad Soyad" DESC');
    expect(cycleOrderBy('"Ad Soyad" DESC', 'Ad Soyad')).toBe('');
  });

  it('başka bir sıralama varsa tıklanan kolonla artan başlar', () => {
    expect(cycleOrderBy('"id" DESC', 'ad')).toBe('"ad"');
    expect(cycleOrderBy('ad, id', 'ad')).toBe('"ad"');
  });

  it('kutudaki sıralamanın tek kolonlu başlık sıralaması olup olmadığı', () => {
    expect(columnSort('"ad"', 'ad')).toBe('artan');
    expect(columnSort(' "ad"  desc ', 'ad')).toBe('azalan');
    expect(columnSort('"ad", "id"', 'ad')).toBeNull();
    expect(columnSort('', 'ad')).toBeNull();
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

  it('kullanıcı ORDER BY’ı varsa PK’lı tabloda da sonraki ofset', () => {
    const filter = { where: '', orderBy: 'ad' };
    expect(nextCursor(users, null, rows(500, (i) => [String(i), 'a']), filter)).toEqual({ tur: 'offset', offset: 500 });
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
    expect(parseTablePageRequest({ sema: 'public', tablo: 'users' })).toEqual({ sema: 'public', tablo: 'users', where: '', orderBy: '', sonraki: null });
    expect(parseTablePageRequest({ sema: 's', tablo: 't', where: 'a > 1', orderBy: 'a' })).toMatchObject({ where: 'a > 1', orderBy: 'a' });
    expect(parseTablePageRequest({ sema: 's', tablo: 't', sonraki: { tur: 'keyset', degerler: ['1', '2'] } })?.sonraki).toEqual({ tur: 'keyset', degerler: ['1', '2'] });
    expect(parseTablePageRequest({ sema: 's', tablo: 't', sonraki: { tur: 'offset', offset: 500 } })?.sonraki).toEqual({ tur: 'offset', offset: 500 });
  });

  it('bozuk gövde reddedilir', () => {
    for (const raw of [null, 'x', { tablo: 't' }, { sema: 's', tablo: '' }, { sema: 's', tablo: 't', sonraki: { tur: 'keyset', degerler: [1] } }, { sema: 's', tablo: 't', sonraki: { tur: 'baska' } }, { sema: 's', tablo: 't', sonraki: 5 }, { sema: 's', tablo: 't', where: 1 }]) {
      expect(parseTablePageRequest(raw)).toBeNull();
    }
  });
});
