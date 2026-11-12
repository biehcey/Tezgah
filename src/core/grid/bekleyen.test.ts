import { describe, expect, it } from 'vitest';
import { splitStatements } from '../ifade-bolme';
import { NO_CHANGES, editCell, editableTable, failedRowKey, isCellChanged, pendingScript, rowKey, shownRow, type EditableTable } from './bekleyen';

const USERS: EditableTable = {
  sema: 'public',
  tablo: 'users',
  kolonlar: ['id', 'ad', 'eposta'],
  tipler: ['integer', 'text', 'text'],
  pk: ['id'],
};
const ROW_1 = ['1', 'Ali', 'ali@x'];
const ROW_2 = ['2', 'Ayşe', null];

describe('Bekleyen değişiklik deposu: hücre düzenleme', () => {
  it('düzenlenen hücre yalnızca değişen kolonla, tüm PK orijinaliyle UPDATE üretir', () => {
    const changes = editCell(USERS, NO_CHANGES, ROW_1, 1, 'Veli');
    expect(pendingScript(USERS, changes).metin).toBe(`UPDATE "public"."users" SET "ad" = 'Veli'::text WHERE "id" = '1'::integer;`);
  });

  it('aynı hücreye çoklu düzenleme tek değişiklikte birleşir; aynı satırın kolonları tek UPDATE’te', () => {
    let changes = editCell(USERS, NO_CHANGES, ROW_1, 1, 'Veli');
    changes = editCell(USERS, changes, ROW_1, 1, 'Can');
    changes = editCell(USERS, changes, ROW_1, 2, 'can@x');
    expect(pendingScript(USERS, changes).metin).toBe(
      `UPDATE "public"."users" SET "ad" = 'Can'::text, "eposta" = 'can@x'::text WHERE "id" = '1'::integer;`,
    );
  });

  it('orijinal değere dönen hücre düşer; değişmeyen satır SQL üretmez', () => {
    let changes = editCell(USERS, NO_CHANGES, ROW_1, 1, 'Veli');
    changes = editCell(USERS, changes, ROW_1, 1, 'Ali');
    expect(pendingScript(USERS, changes)).toEqual({ metin: '', ifadeler: [] });
    expect(changes.satirlar).toEqual([]);
  });

  it('boş metin NULL değildir; NULL hücreye yazılan metin değişikliktir', () => {
    const changes = editCell(USERS, NO_CHANGES, ROW_2, 2, '');
    expect(pendingScript(USERS, changes).metin).toBe(`UPDATE "public"."users" SET "eposta" = ''::text WHERE "id" = '2'::integer;`);
  });

  it('çok kolonlu PK: WHERE tüm PK kolonlarını orijinal değerleriyle içerir, PK değişse de', () => {
    const table: EditableTable = { sema: 's', tablo: 't', kolonlar: ['a', 'b', 'v'], tipler: ['integer', 'text', null], pk: ['a', 'b'] };
    const row = ['1', 'x', 'eski'];
    let changes = editCell(table, NO_CHANGES, row, 1, 'y');
    changes = editCell(table, changes, row, 2, "O'Brien");
    expect(pendingScript(table, changes).metin).toBe(
      `UPDATE "s"."t" SET "b" = 'y'::text, "v" = 'O''Brien' WHERE "a" = '1'::integer AND "b" = 'x'::text;`,
    );
  });

  it('satırlar ilk düzenlenme sırasıyla; her ifadenin hangi satıra ait olduğu bilinir', () => {
    let changes = editCell(USERS, NO_CHANGES, ROW_2, 1, 'Zeynep');
    changes = editCell(USERS, changes, ROW_1, 1, 'Veli');
    changes = editCell(USERS, changes, ROW_2, 2, 'z@x');
    const { ifadeler } = pendingScript(USERS, changes);
    expect(ifadeler.map((s) => s.satir)).toEqual([changes.satirlar[0]!.anahtar, changes.satirlar[1]!.anahtar]);
    expect(changes.satirlar.map((r) => r.orijinal)).toEqual([ROW_2, ROW_1]);
  });

  it('üretilen script ifade bölücüde değişiklik sayısı kadar ifadeye bölünür (`;`, tırnak, yorum, satır sonu içeren değerler)', () => {
    let changes = editCell(USERS, NO_CHANGES, ROW_1, 1, "a;b'c -- d\n/* e");
    changes = editCell(USERS, changes, ROW_2, 1, '$$x$$ \\');
    const { metin, ifadeler } = pendingScript(USERS, changes);
    expect(splitStatements(metin).map((s) => s.text)).toEqual(ifadeler.map((s) => s.sql.slice(0, -1)));
  });

  it('görünen satır bekleyen değerleri taşır; değişen hücreler işaretlidir', () => {
    const changes = editCell(USERS, NO_CHANGES, ROW_1, 2, null);
    expect(shownRow(USERS, changes, ROW_1)).toEqual(['1', 'Ali', null]);
    expect(shownRow(USERS, changes, ROW_2)).toBe(ROW_2);
    expect(isCellChanged(USERS, changes, ROW_1, 2)).toBe(true);
    expect(isCellChanged(USERS, changes, ROW_1, 1)).toBe(false);
    expect(isCellChanged(USERS, changes, ROW_2, 2)).toBe(false);
  });

  it('satır, sayfa yeniden çekilse de PK değerleriyle tanınır', () => {
    const changes = editCell(USERS, NO_CHANGES, ROW_1, 1, 'Veli');
    expect(shownRow(USERS, changes, ['1', 'Ali (başkası değiştirdi)', 'ali@x'])).toEqual(['1', 'Veli', 'ali@x']);
  });
});

describe('Bekleyen değişiklik deposu: düzenlenebilirlik', () => {
  const input = { sema: 's', tablo: 't', kolonlar: ['id', 'ad'], tipler: ['integer', 'text'] };

  it.each([
    ['PK var', ['id'], { sema: 's', tablo: 't', kolonlar: ['id', 'ad'], tipler: ['integer', 'text'], pk: ['id'] }],
    ['PK yok', [], { kapali: 'Düzenleme kapalı: tablonun birincil anahtarı (PK) yok' }],
    ['PK kolonu sonuçta yok', ['kod'], { kapali: 'Düzenleme kapalı: birincil anahtar kolonu (kod) sonuçta yok' }],
  ])('%s', (_, pk, expected) => {
    expect(editableTable({ ...input, pk })).toEqual(expected);
  });
});

describe('Bekleyen değişiklik deposu: ifade → satır', () => {
  it('hata gelen ifadenin indeksi o ifadenin satırına çevrilir; bilinmeyen indeks `null`', () => {
    let changes = editCell(USERS, NO_CHANGES, ROW_1, 1, 'Veli');
    changes = editCell(USERS, changes, ROW_2, 1, 'Zeynep');
    const script = pendingScript(USERS, changes);
    expect(failedRowKey(script, 1)).toBe(rowKey(USERS, ROW_2));
    expect(failedRowKey(script, 0)).toBe(rowKey(USERS, ROW_1));
    expect(failedRowKey(script, 5)).toBeNull();
  });
});
