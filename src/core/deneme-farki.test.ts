import { describe, expect, it } from 'vitest';
import { mergeChanges, type RowChanges, type SchemaChange, type TableSchema } from './deneme-farki';

const MUSTERI = { oid: '100', ad: 'public.musteri' };
const NONE = { eklendi: 0, guncellendi: 0, silindi: 0 };

/** `musteri(id PK, ad, sehir)` üzerinde bir ifadenin önce/sonra satırları. */
function changes(satirlar: RowChanges['satirlar'], extra: Partial<RowChanges> = {}): { fark: RowChanges } {
  return { fark: { tablo: MUSTERI, kolonlar: ['id', 'ad', 'sehir'], anahtar: ['id'], satirlar, gorulmeyen: NONE, ...extra } };
}

describe('mergeChanges: önce/sonra satırlarının tablo bazında birleşmesi', () => {
  it('tek UPDATE: yalnızca değeri değişen kolonlar işaretlenir', () => {
    const [diff] = mergeChanges([
      changes([
        { once: ['1', 'Ali', 'İzmir'], sonra: ['1', 'Ali', 'Ankara'] },
        { once: ['2', 'Ayşe', null], sonra: ['2', 'Ayşe', 'Bursa'] },
      ]),
    ]);
    expect(diff).toMatchObject({ tablo: MUSTERI, eklendi: 0, guncellendi: 2, silindi: 0, kolonlar: ['id', 'ad', 'sehir'], daha: 0 });
    expect(diff!.satirlar).toEqual([
      { tur: 'guncellendi', once: ['1', 'Ali', 'İzmir'], sonra: ['1', 'Ali', 'Ankara'], degisen: ['sehir'] },
      { tur: 'guncellendi', once: ['2', 'Ayşe', null], sonra: ['2', 'Ayşe', 'Bursa'], degisen: ['sehir'] },
    ]);
  });

  it('INSERT ve DELETE: önce ya da sonra yok', () => {
    const [diff] = mergeChanges([
      changes([{ once: null, sonra: ['3', 'Can', null] }]),
      changes([{ once: ['1', 'Ali', 'İzmir'], sonra: null }]),
    ]);
    expect(diff).toMatchObject({ eklendi: 1, guncellendi: 0, silindi: 1 });
    expect(diff!.satirlar).toEqual([
      { tur: 'eklendi', once: null, sonra: ['3', 'Can', null], degisen: [] },
      { tur: 'silindi', once: ['1', 'Ali', 'İzmir'], sonra: null, degisen: [] },
    ]);
  });

  it('aynı satıra iki ifade dokunursa ilk "önce" ve son "sonra" alınır', () => {
    const [diff] = mergeChanges([
      changes([{ once: ['1', 'Ali', 'İzmir'], sonra: ['1', 'Ali', 'Ankara'] }]),
      changes([{ once: ['1', 'Ali', 'Ankara'], sonra: ['1', 'Veli', 'Ankara'] }]),
    ]);
    expect(diff!.satirlar).toEqual([{ tur: 'guncellendi', once: ['1', 'Ali', 'İzmir'], sonra: ['1', 'Veli', 'Ankara'], degisen: ['ad', 'sehir'] }]);
    expect(diff!.guncellendi).toBe(1);
  });

  it('PK’sı değişen satır yeni anahtarıyla izlenir', () => {
    const [diff] = mergeChanges([
      changes([{ once: ['1', 'Ali', 'İzmir'], sonra: ['10', 'Ali', 'İzmir'] }]),
      changes([{ once: ['10', 'Ali', 'İzmir'], sonra: null }]),
    ]);
    expect(diff!.satirlar).toEqual([{ tur: 'silindi', once: ['1', 'Ali', 'İzmir'], sonra: null, degisen: [] }]);
  });

  it('eklenip silinen satır farkta yer almaz; silinip aynı anahtarla eklenen güncellenmiş sayılır', () => {
    const [diff] = mergeChanges([
      changes([
        { once: null, sonra: ['5', 'Geçici', null] },
        { once: ['1', 'Ali', 'İzmir'], sonra: null },
      ]),
      changes([
        { once: ['5', 'Geçici', null], sonra: null },
        { once: null, sonra: ['1', 'Ali', 'Bursa'] },
      ]),
    ]);
    expect(diff).toMatchObject({ eklendi: 0, guncellendi: 1, silindi: 0 });
    expect(diff!.satirlar).toEqual([{ tur: 'guncellendi', once: ['1', 'Ali', 'İzmir'], sonra: ['1', 'Ali', 'Bursa'], degisen: ['sehir'] }]);
  });

  it('tablolar ilk göründükleri sırayla gruplanır; ifadesi farksız olanlar atlanır', () => {
    const siparis = { oid: '200', ad: 'public.siparis' };
    const diffs = mergeChanges([
      { fark: { tablo: siparis, kolonlar: ['no'], anahtar: ['no'], satirlar: [{ once: null, sonra: ['9'] }], gorulmeyen: NONE } },
      {},
      changes([{ once: null, sonra: ['3', 'Can', null] }]),
      { fark: { tablo: siparis, kolonlar: ['no'], anahtar: ['no'], satirlar: [{ once: null, sonra: ['8'] }], gorulmeyen: NONE } },
    ]);
    expect(diffs.map((d) => [d.tablo.ad, d.eklendi])).toEqual([
      ['public.siparis', 2],
      ['public.musteri', 1],
    ]);
  });

  it('bileşik anahtar: anahtarın tüm kolonları eşleşmeli', () => {
    const fark = (satirlar: RowChanges['satirlar']) => ({
      fark: { tablo: MUSTERI, kolonlar: ['a', 'b', 'v'], anahtar: ['a', 'b'], satirlar, gorulmeyen: NONE },
    });
    const [diff] = mergeChanges([fark([{ once: ['1', '1', 'x'], sonra: ['1', '1', 'y'] }]), fark([{ once: ['1', '2', 'p'], sonra: ['1', '2', 'q'] }])]);
    expect(diff!.guncellendi).toBe(2);
  });

  it('tablo başına ilk 100 satır; sunucudan çekilmeyen satırlar sayılara ve "daha"ya eklenir', () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({ once: [String(i), 'a', null], sonra: [String(i), 'b', null] }));
    const [diff] = mergeChanges([
      changes(rows, { gorulmeyen: { eklendi: 0, guncellendi: 50, silindi: 0 } }),
      changes([{ once: null, sonra: ['500', 'yeni', null] }]),
    ]);
    expect(diff).toMatchObject({ eklendi: 1, guncellendi: 150, silindi: 0 });
    expect(diff!.satirlar).toHaveLength(100);
    // 101 birleşmiş satırdan 100'ü gösterildi, 50'si hiç çekilmedi.
    expect(diff!.daha).toBe(51);
  });

  it('çekilmeyen satırlı tabloya başka ifade de dokunduysa sayılar yaklaşıktır (aynı satır iki kez sayılabilir)', () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({ once: [String(i), 'a', null], sonra: [String(i), 'b', null] }));
    const rest = { gorulmeyen: { eklendi: 0, guncellendi: 50, silindi: 0 } };
    const [diff] = mergeChanges([changes(rows, rest), changes(rows, rest)]);
    expect(diff).toMatchObject({ guncellendi: 200, yaklasik: true });
    expect(mergeChanges([changes(rows), changes(rows)])[0]).toMatchObject({ guncellendi: 100, yaklasik: false });
  });

  it('DDL ile eklenen kolon sonraki ifadelerde kolon listesine eklenir; eski satırlarda boştur', () => {
    const [diff] = mergeChanges([
      changes([{ once: ['1', 'Ali', 'İzmir'], sonra: ['1', 'Veli', 'İzmir'] }]),
      {
        fark: {
          tablo: MUSTERI,
          kolonlar: ['id', 'ad', 'sehir', 'puan'],
          anahtar: ['id'],
          satirlar: [{ once: null, sonra: ['2', 'Can', null, '5'] }],
          gorulmeyen: NONE,
        },
      },
    ]);
    expect(diff!.kolonlar).toEqual(['id', 'ad', 'sehir', 'puan']);
    expect(diff!.satirlar.map((r) => r.sonra)).toEqual([
      ['1', 'Veli', 'İzmir', null],
      ['2', 'Can', null, '5'],
    ]);
    expect(diff!.satirlar[0]!.degisen).toEqual(['ad']);
  });
});

type Column = [no: number, ad: string, tip: string, bos: boolean, varsayilan: string | null];
const schema = (ad: string, kolonlar: Column[]): TableSchema => ({
  ad,
  kolonlar: kolonlar.map(([no, kolon, tip, bos, varsayilan]) => ({ no, ad: kolon, tip, bos, varsayilan })),
});
const BASE: Column[] = [
  [1, 'id', 'integer', false, null],
  [2, 'ad', 'text', true, null],
];
const BEFORE = schema('public.musteri', BASE);
const sema = (once: TableSchema | null, sonra: TableSchema | null): { sema: SchemaChange[] } => ({ sema: [{ oid: '100', once, sonra }] });

describe('mergeChanges: DDL şema farkı', () => {
  it('eklenen kolon', () => {
    const after = schema('public.musteri', [...BASE, [3, 'son_giris', 'timestamp with time zone', true, null]]);
    const [diff] = mergeChanges([sema(BEFORE, after)]);
    expect(diff).toMatchObject({ tablo: MUSTERI, ...NONE, satirlar: [], daha: 0 });
    expect(diff!.sema).toEqual([{ tur: '+', metin: 'kolon son_giris timestamp with time zone NULL' }]);
  });

  it('silinen, yeniden adlandırılan ve türü değişen kolonlar; varsayılan değer', () => {
    const after = schema('public.musteri', [
      [1, 'id', 'bigint', false, null],
      [2, 'tam_ad', 'text', false, "'?'::text"],
    ]);
    const before = schema('public.musteri', [...BASE, [3, 'eski', 'date', true, null]]);
    expect(mergeChanges([sema(before, after)])[0]!.sema).toEqual([
      { tur: '~', metin: 'kolon id integer NOT NULL → id bigint NOT NULL' },
      { tur: '~', metin: "kolon ad text NULL → tam_ad text NOT NULL DEFAULT '?'::text" },
      { tur: '−', metin: 'kolon eski date NULL' },
    ]);
  });

  it('oluşturulan, silinen ve yeniden adlandırılan tablo', () => {
    expect(mergeChanges([sema(null, BEFORE)])[0]!.sema).toEqual([
      { tur: '+', metin: 'tablo public.musteri' },
      { tur: '+', metin: 'kolon id integer NOT NULL' },
      { tur: '+', metin: 'kolon ad text NULL' },
    ]);
    expect(mergeChanges([sema(BEFORE, null)])[0]!.sema).toEqual([{ tur: '−', metin: 'tablo public.musteri' }]);
    const [renamed] = mergeChanges([sema(BEFORE, { ...BEFORE, ad: 'public.musteriler' })]);
    expect(renamed!.tablo).toEqual({ oid: '100', ad: 'public.musteriler' });
    expect(renamed!.sema).toEqual([{ tur: '~', metin: 'tablo public.musteri → public.musteriler' }]);
  });

  it('aynı tabloya birden çok DDL: ilk "önce" ile son "sonra" karşılaştırılır; DML ile aynı bölümde', () => {
    const mid = schema('public.musteri', [...BASE, [3, 'x', 'int', true, null]]);
    const diffs = mergeChanges([sema(BEFORE, mid), changes([{ once: null, sonra: ['1', 'a', null] }]), sema(mid, BEFORE)]);
    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toMatchObject({ eklendi: 1, sema: [] });
  });

  it('şeması değişmeyen ve satırı olmayan tablo listelenmez', () => {
    expect(mergeChanges([sema(BEFORE, BEFORE)])).toEqual([]);
  });
});
