import { describe, expect, it } from 'vitest';
import { addColumn, addColumnWarnings, defaultFunctions, parseVolatilityRequest, tableHasRows, typeSuggestions, type NewColumn } from './kolon-ekle';

const column = (overrides: Partial<NewColumn> = {}): NewColumn => ({ ad: 'son_giris', tip: 'timestamptz', notNull: false, varsayilan: '', ...overrides });
const CLOSED = 'Tip ve varsayılan ifade kendi içinde kapanmalı: “;”, satır yorumu ya da kapanmamış tırnak/yorum olamaz.';
const TABLE = { sema: 'public', tablo: 'users', kolonlar: ['id', 'ad'] };

describe('addColumn: SQL', () => {
  it.each([
    ['yalnızca ad ve tip', column(), 'ALTER TABLE "public"."users" ADD COLUMN "son_giris" timestamptz;'],
    ['boş alanlar önizlemede boşluk bırakmaz', column({ ad: '', tip: ' ' }), 'ALTER TABLE "public"."users" ADD COLUMN "";'],
    ['NOT NULL', column({ notNull: true }), 'ALTER TABLE "public"."users" ADD COLUMN "son_giris" timestamptz NOT NULL;'],
    ['varsayılan', column({ varsayilan: 'now()' }), 'ALTER TABLE "public"."users" ADD COLUMN "son_giris" timestamptz DEFAULT now();'],
    ['NOT NULL ve varsayılan', column({ notNull: true, varsayilan: 'now()' }), 'ALTER TABLE "public"."users" ADD COLUMN "son_giris" timestamptz NOT NULL DEFAULT now();'],
    ['baştaki ve sondaki boşluk atılır', column({ ad: ' x ', tip: ' int ', varsayilan: '  0 ' }), 'ALTER TABLE "public"."users" ADD COLUMN "x" int DEFAULT 0;'],
    ['ad ve tablo tırnaklanır, tip olduğu gibi', column({ ad: 'Ad "x"', tip: 'character varying(20)[]' }), 'ALTER TABLE "public"."users" ADD COLUMN "Ad ""x""" character varying(20)[];'],
  ])('%s', (_, input, expected) => {
    expect(addColumn({ ...TABLE, kolonlar: [] }, input).metin).toBe(expected);
  });

  it('tablo adı tırnaklanır', () => {
    expect(addColumn({ sema: 'My Schema', tablo: 'T"1', kolonlar: [] }, column()).metin).toBe('ALTER TABLE "My Schema"."T""1" ADD COLUMN "son_giris" timestamptz;');
  });
});

describe('addColumn: doğrulama', () => {
  it.each([
    ['geçerli', column(), {}],
    ['boş ad', column({ ad: '  ' }), { ad: 'Kolon adı boş olamaz.' }],
    ['boş tip', column({ tip: '' }), { tip: 'Tip boş olamaz.' }],
    ['var olan kolon', column({ ad: 'ad' }), { ad: '“ad” kolonu tabloda zaten var.' }],
    ['büyük/küçük harf farklı ad başka kolondur', column({ ad: 'Ad' }), {}],
    ['tipte ; ikinci ifade açar', column({ tip: 'int; DROP TABLE users' }), { tip: CLOSED }],
    ['varsayılanda ; ikinci ifade açar', column({ varsayilan: '1; DROP TABLE users' }), { varsayilan: CLOSED }],
    ['dizgedeki ; sorun değil', column({ tip: 'text', varsayilan: "'a;b'" }), {}],
    ['tipteki satır yorumu sonrakini yutar', column({ tip: 'int -- x', notNull: true }), { tip: CLOSED }],
    ['varsayılanda kapanmamış dizge', column({ varsayilan: "'abc" }), { varsayilan: CLOSED }],
    ['varsayılanda kapanmamış blok yorumu', column({ varsayilan: '1 /* x' }), { varsayilan: CLOSED }],
    ['kapanan blok yorumu sorun değil', column({ varsayilan: '1 /* x */' }), {}],
  ])('%s', (_, input, expected) => {
    expect(addColumn(TABLE, input).hatalar).toEqual(expected);
  });
});

describe('defaultFunctions: varsayılan ifadedeki fonksiyon adları', () => {
  it.each([
    ['boş', '', []],
    ['sabit', "'a'", []],
    ['tek çağrı, küçük harfe katlanır', 'NOW()', ['now']],
    ['boşluk ve yorum araya girebilir', 'random /* x */ ()', ['random']],
    ['iç içe ve tekrar eden', 'round(random() * 10) + random()', ['round', 'random']],
    ['şemalı ad: son parça', 'pg_catalog.clock_timestamp()', ['clock_timestamp']],
    ['tırnaklı ad harfini korur', '"Uret"()', ['Uret']],
    ['dizge içindeki çağrı sayılmaz', "'random()'", []],
    ['parantezsiz kelime çağrı değildir', 'CURRENT_TIMESTAMP', []],
    ['tip dönüşümü çağrı değildir', "'1'::int", []],
  ])('%s', (_, expr, expected) => {
    expect(defaultFunctions(expr)).toEqual(expected);
  });
});

describe('addColumnWarnings: engellemeyen uyarılar', () => {
  const REWRITE = 'Tablo yeniden yazılır: varsayılan ifadede volatile fonksiyon var (random). Büyük tabloda uzun sürer ve tabloyu kilitler.';
  const FAILS = 'Boş olmayan tabloda hata verecek: NOT NULL kolonun varsayılanı yok, var olan satırlar NULL kalır.';
  it.each([
    ['uyarı yok', column(), {}, true, []],
    ['stable varsayılan yeniden yazmaz', column({ varsayilan: 'now()' }), { now: 's' }, true, []],
    ['volatile varsayılan', column({ varsayilan: 'random()' }), { random: 'v' }, false, [REWRITE]],
    ['birden çok volatile ad listelenir', column({ varsayilan: 'random() + nextval(1)' }), { random: 'v', nextval: 'v' }, false, [REWRITE.replace('(random)', '(random, nextval)')]],
    ['oynaklığı bilinmeyen ad uyarmaz', column({ varsayilan: 'random()' }), {}, false, []],
    ['NOT NULL, varsayılansız, satırlı tablo', column({ notNull: true }), {}, true, [FAILS]],
    ['NOT NULL, varsayılansız, boş tablo', column({ notNull: true }), {}, false, []],
    ['NOT NULL, varsayılanlı, satırlı tablo', column({ notNull: true, varsayilan: '0' }), {}, true, []],
    ['yalnızca boşluk varsayılan sayılmaz', column({ notNull: true, varsayilan: '   ' }), {}, true, [FAILS]],
  ] as const)('%s', (_, input, oynaklik, satirVar, expected) => {
    expect(addColumnWarnings(input, { oynaklik, tablodaSatirVar: satirVar })).toEqual(expected);
  });

  it('volatile ve satırlı tabloda NOT NULL birlikte: varsayılan olduğundan yalnızca yeniden yazma', () => {
    expect(addColumnWarnings(column({ notNull: true, varsayilan: 'random()' }), { oynaklik: { random: 'v' }, tablodaSatirVar: true })).toEqual([REWRITE]);
  });
});

describe('typeSuggestions', () => {
  it('yaygın tipler, ardından katalogdaki kullanıcı tipleri; tekrar yok', () => {
    const list = typeSuggestions(['public.durum', 'text', 'para']);
    expect(list.slice(0, 3)).toEqual(['text', 'integer', 'bigint']);
    expect(list.slice(-2)).toEqual(['public.durum', 'para']);
    expect(list.filter((t) => t === 'text')).toHaveLength(1);
  });
});

describe('parseVolatilityRequest', () => {
  it.each([
    ['geçerli', { fonksiyonlar: ['now', 'random'] }, { fonksiyonlar: ['now', 'random'] }],
    ['boş liste', { fonksiyonlar: [] }, { fonksiyonlar: [] }],
    ['dizi değil', { fonksiyonlar: 'now' }, null],
    ['metin olmayan ad', { fonksiyonlar: ['now', 1] }, null],
    ['boş ad', { fonksiyonlar: [''] }, null],
    ['gövde yok', null, null],
    ['çok fazla ad', { fonksiyonlar: Array.from({ length: 101 }, (_, i) => `f${i}`) }, null],
  ])('%s', (_, body, expected) => {
    expect(parseVolatilityRequest(body)).toEqual(expected);
  });
});

describe('tableHasRows: varsayılansız NOT NULL uyarısı için', () => {
  it.each([
    ['filtresiz ilk sayfada satır var', { satir: 2, filtreli: false, tahmin: 0 }, true],
    ['filtresiz boş tablo', { satir: 0, filtreli: false, tahmin: 1000 }, false],
    ['filtre hiçbir satırı tutmadı, tahmin satır diyor', { satir: 0, filtreli: true, tahmin: 1000 }, true],
    ['filtre hiçbir satırı tutmadı, tahmin bilinmiyor', { satir: 0, filtreli: true, tahmin: -1 }, true],
    ['filtre hiçbir satırı tutmadı, tahmin 0', { satir: 0, filtreli: true, tahmin: 0 }, false],
    ['sayfa yüklenmedi, tahmin satır diyor', { satir: null, filtreli: false, tahmin: 5 }, true],
    ['sayfa yüklenmedi, tahmin yok', { satir: null, filtreli: false, tahmin: null }, false],
  ] as const)('%s', (_, input, expected) => {
    expect(tableHasRows(input)).toBe(expected);
  });
});
