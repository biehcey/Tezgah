import { describe, expect, it } from 'vitest';
import { splitStatements } from './ifade-bolme';
import { catalogCompletion, changesCatalog, searchTables, type Catalog, type CatalogRelation } from './katalog';

const col = (ad: string, tip: string) => ({ ad, tip, tipOid: 0, notNull: false, varsayilan: false, uretilmis: false });
const rel = (sema: string, ad: string, tur: CatalogRelation['tur'] = 'r', kolonlar = [col('id', 'integer')]): CatalogRelation => ({
  sema,
  ad,
  tur,
  kolonlar,
  pk: [],
  reltuples: -1,
});
const catalog = (iliskiler: CatalogRelation[], defaultSchema: string | null = 'public'): Catalog => ({
  defaultSchema,
  semalar: [...new Set(iliskiler.map((r) => r.sema))],
  iliskiler,
  tipler: {},
  kullaniciTipleri: [],
});

describe('catalogCompletion', () => {
  it('şema → tablo → kolon ağacı; kolon tipi detail, tablo türü detail', () => {
    const { schema, defaultSchema } = catalogCompletion(
      catalog([rel('public', 'users', 'r', [col('id', 'integer'), col('ad', 'text')]), rel('public', 'aktif', 'v')]),
      ['public'],
    );
    expect(defaultSchema).toBe('public');
    expect(schema).toEqual({
      public: {
        self: { label: 'public', type: 'namespace' },
        children: {
          users: {
            self: { label: 'users', type: 'type', detail: 'tablo' },
            children: [
              { label: 'id', type: 'property', detail: 'integer' },
              { label: 'ad', type: 'property', detail: 'text' },
            ],
          },
          aktif: { self: { label: 'aktif', type: 'type', detail: 'view' }, children: [{ label: 'id', type: 'property', detail: 'integer' }] },
        },
      },
    });
  });

  it('görünür olmayan şemalar girmez; defaultSchema görünür değilse verilmez', () => {
    const { schema, defaultSchema } = catalogCompletion(catalog([rel('public', 'a'), rel('gizli', 'b')], 'gizli'), ['public']);
    expect(Object.keys(schema)).toEqual(['public']);
    expect(defaultSchema).toBeUndefined();
  });

  it('matview, partitioned ve foreign tablolar türleriyle', () => {
    const { schema } = catalogCompletion(catalog([rel('s', 'm', 'm'), rel('s', 'p', 'p'), rel('s', 'f', 'f')]), ['s']);
    const children = (schema as Record<string, { children: Record<string, { self: { detail: string } }> }>).s!.children;
    expect([children.m!.self.detail, children.p!.self.detail, children.f!.self.detail]).toEqual([
      'materialized view',
      'bölümlü tablo',
      'foreign tablo',
    ]);
  });

  it('büyük harf, boşluk, anahtar kelime ya da nokta içeren adlar tırnaklı uygulanır', () => {
    const { schema } = catalogCompletion(
      catalog([rel('Satış', 'user', 'r', [col('Ad Soyad', 'text'), col('a"b', 'text'), col('order', 'int')]), rel('Satış', 'v1.2')]),
      ['Satış'],
    );
    const s = (schema as Record<string, { self: unknown; children: Record<string, { self: unknown; children: unknown }> }>)['Satış']!;
    expect(s.self).toEqual({ label: 'Satış', type: 'namespace', apply: '"Satış"' });
    expect(s.children.user!.self).toEqual({ label: 'user', type: 'type', detail: 'tablo', apply: '"user"' });
    expect(s.children.user!.children).toEqual([
      { label: 'Ad Soyad', type: 'property', detail: 'text', apply: '"Ad Soyad"' },
      { label: 'a"b', type: 'property', detail: 'text', apply: '"a""b"' },
      { label: 'order', type: 'property', detail: 'int', apply: '"order"' },
    ]);
    // lang-sql nokta içeren anahtarı yol olarak böler; kaçışlı nokta tek ad kalır.
    expect(Object.keys(s.children)).toContain('v1\\.2');
  });
});

describe('searchTables', () => {
  const c = catalog([rel('public', 'siparis'), rel('public', 'musteri_siparis'), rel('arsiv', 'Siparis_2020'), rel('gizli', 'siparis')]);

  it('görünür şemalarda büyük/küçük harf duyarsız arar; önce ad başında eşleşenler, sonra şema + ad sırası', () => {
    expect(searchTables(c, ['public', 'arsiv'], 'SIPAR').map((r) => `${r.sema}.${r.ad}`)).toEqual([
      'arsiv.Siparis_2020',
      'public.siparis',
      'public.musteri_siparis',
    ]);
  });

  it('şema.ad biçiminde de aranır; boş sorgu görünürlerin tümünü verir', () => {
    expect(searchTables(c, ['public', 'arsiv'], 'arsiv.sip').map((r) => r.ad)).toEqual(['Siparis_2020']);
    expect(searchTables(c, ['public'], '  ').map((r) => r.ad)).toEqual(['musteri_siparis', 'siparis']);
  });
});

describe('changesCatalog', () => {
  it.each([
    ['CREATE TABLE t (id int)', true],
    ['alter table t add column x int', true],
    ['DROP VIEW v', true],
    ['IMPORT FOREIGN SCHEMA s FROM SERVER x INTO public', true],
    ['SELECT * INTO yeni FROM eski', true],
    ['COMMENT ON TABLE t IS $$x$$', false],
    ['SELECT 1; UPDATE t SET a = 1', false],
    ['SELECT 1; create index on t (a)', true],
    ['', false],
  ])('%s → %s', (script, expected) => {
    expect(changesCatalog(splitStatements(script))).toBe(expected);
  });
});
