import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { Connection } from '../../core/baglanti';
import type { Catalog } from '../../core/katalog';
import { TABS_VERSION, type SavedTabs } from '../../core/konsol-sekmeleri';
import type { TablePageResponse } from '../../core/tablo-sayfasi';
import { App } from '../App';
import { editorScript } from '../test/eylemler';
import { connection, createFakeConnections, createFakeScriptRuns, emptyCatalog, renderWithApi } from '../test/sahte-api';

const DK = 60_000;
const DEV = connection({ id: 'd1', name: 'Yerel', databaseSelection: [{ database: 'postgres', schemas: null }] });
const PROD = connection({ id: 'p1', name: 'Canlı', envTag: 'prod', color: '#dc2626', databaseSelection: [{ database: 'postgres', schemas: null }] });

const CATALOG: Catalog = emptyCatalog({ semalar: ['public'] });

const page = (overrides: Partial<TablePageResponse> = {}): TablePageResponse => ({
  kolonlar: ['id', 'ad'],
  tipler: [23, 25],
  pk: ['id'],
  uretilmis: [],
  satirlar: [
    ['1', 'Ali'],
    ['2', 'Ayşe'],
  ],
  sonraki: null,
  tutarlilikNotu: false,
  ...overrides,
});

/** `users` Tablo sekmesi geri gelmiş olarak açılır; "Yükle" ile ilk sayfa çekilir. */
async function setup({ conn = DEV, firstPage = page() }: { conn?: Connection; firstPage?: TablePageResponse } = {}) {
  const user = userEvent.setup();
  const runs = createFakeScriptRuns();
  const fake = createFakeConnections([structuredClone(conn)]);
  const tabs: SavedTabs = {
    version: TABS_VERSION,
    sekmeler: [
      { id: 'k1', tur: 'konsol', hedef: { connectionId: conn.id, database: 'postgres', schema: null }, metin: '' },
      { id: 't1', tur: 'tablo', hedef: { connectionId: conn.id, database: 'postgres', schema: 'public' }, sema: 'public', tablo: 'users', where: '', orderBy: '' },
    ],
    aktif: 't1',
  };
  fake.savedTabs = tabs;
  fake.catalogs.set(`${conn.id}/postgres`, CATALOG);
  fake.tablePage = async () => firstPage;
  fake.api.runScript = runs.runScript;
  renderWithApi(<App />, fake.api);
  await screen.findByRole('region', { name: 'public.users tablosu' });
  await user.click(t().getByRole('button', { name: 'Yükle' }));
  await within(tableTab()).findByRole('grid');
  return { user, fake, runs };
}

const tableTab = () => screen.getByRole('region', { name: 'public.users tablosu' });
const t = () => within(tableTab());
const cell = (r: number, c: number) => {
  const row = t().getByRole('grid').querySelector(`[role="row"][aria-rowindex="${r + 2}"]`) as HTMLElement;
  return within(row).getAllByRole('gridcell')[c]!;
};
const preview = () => t().getByRole('region', { name: 'SQL önizlemesi' });
const applyButton = () => t().getByRole('button', { name: 'Uygula' });

async function editName(user: ReturnType<typeof userEvent.setup>, r: number, value: string) {
  await user.click(cell(r, 1));
  await user.keyboard(`${value}{Enter}`);
}

describe('Tablo sekmesi: hücre düzenleme', () => {
  it('düzenlenen hücre grid’de işaretli; bekleyen değişiklik ve üretilen SQL sağ sütunda', async () => {
    const { user } = await setup();
    expect(preview()).toHaveTextContent('Bekleyen değişiklik yok');
    expect(applyButton()).toBeDisabled();
    await editName(user, 0, 'Veli');

    expect(cell(0, 1)).toHaveTextContent('Veli');
    expect(cell(0, 1)).toHaveClass('degisti');
    expect(cell(1, 1)).not.toHaveClass('degisti');
    expect(t().getByRole('list', { name: 'Bekleyen değişiklikler' })).toHaveTextContent('id = 1 · ad');
    expect(preview()).toHaveTextContent(`UPDATE "public"."users" SET "ad" = 'Veli'::text WHERE "id" = '1'::integer;`);
    expect(applyButton()).toBeEnabled();
  });

  it('PK’sız tabloda düzenleme kapalı ve nedeni görünür', async () => {
    const { user } = await setup({ firstPage: page({ pk: [] }) });
    expect(tableTab()).toHaveTextContent('Düzenleme kapalı: tablonun birincil anahtarı (PK) yok');
    await user.click(cell(0, 1));
    await user.keyboard('x');
    expect(t().queryByRole('textbox', { name: /değeri$/ })).not.toBeInTheDocument();
    expect(t().queryByRole('button', { name: 'Uygula' })).not.toBeInTheDocument();
  });
});

const rowOf = (r: number) => t().getByRole('grid').querySelector(`[role="row"][aria-rowindex="${r + 2}"]`) as HTMLElement;
const sqlLines = () => preview().querySelector('pre')?.textContent?.split('\n') ?? [];
const menuItem = (name: string) => within(screen.getByRole('menu')).getByRole('menuitem', { name });

describe('Tablo sekmesi: satır ekleme ve silme', () => {
  it('“Satır ekle” grid’in sonuna DEFAULT’lu satır ekler ve ona gider; dokunulan kolonlar INSERT’e girer', async () => {
    const { user } = await setup();
    await user.click(t().getByRole('button', { name: 'Satır ekle' }));

    expect(rowOf(2)).toHaveClass('eklendi');
    expect(cell(2, 0)).toHaveTextContent('DEFAULT');
    expect(sqlLines()).toEqual([`INSERT INTO "public"."users" DEFAULT VALUES;`]);
    expect(t().getByRole('list', { name: 'Bekleyen değişiklikler' })).toHaveTextContent('+ yeni satır');

    await user.keyboard('{Tab}Can{Enter}');
    expect(cell(2, 1)).toHaveTextContent('Can');
    expect(cell(2, 0)).toHaveTextContent('DEFAULT');
    expect(sqlLines()).toEqual([`INSERT INTO "public"."users" ("ad") VALUES ('Can'::text);`]);
  });

  it('sağ tıkla satır silinir ve işaretlenir; silmeyi geri almak bekleyeni kaldırır; sıra DELETE → UPDATE → INSERT', async () => {
    const { user } = await setup();
    await user.click(t().getByRole('button', { name: 'Satır ekle' }));
    await editName(user, 0, 'Veli');
    await user.pointer({ keys: '[MouseRight]', target: cell(1, 0) });
    await user.click(menuItem('Satırları sil'));

    expect(rowOf(1)).toHaveClass('silinecek');
    expect(sqlLines().map((s) => s.split(' ')[0])).toEqual(['DELETE', 'UPDATE', 'INSERT']);
    expect(sqlLines()[0]).toBe(`DELETE FROM "public"."users" WHERE "id" = '2'::integer;`);

    await user.pointer({ keys: '[MouseRight]', target: cell(1, 0) });
    await user.click(menuItem('Silmeyi geri al'));
    expect(rowOf(1)).not.toHaveClass('silinecek');
    expect(sqlLines().map((s) => s.split(' ')[0])).toEqual(['UPDATE', 'INSERT']);
  });

  it('eklenip silinen satır SQL üretmez', async () => {
    const { user } = await setup();
    await user.click(t().getByRole('button', { name: 'Satır ekle' }));
    await user.pointer({ keys: '[MouseRight]', target: cell(2, 1) });
    await user.click(menuItem('Satırları sil'));
    expect(t().getAllByRole('row')).toHaveLength(3);
    expect(preview()).toHaveTextContent('Bekleyen değişiklik yok');
  });
});

describe('Tablo sekmesi: NULL', () => {
  it('Ctrl/Cmd+Shift+N seçili hücreyi NULL yapar; NULL boş metinden ayrıdır', async () => {
    const { user } = await setup();
    await user.click(cell(0, 1));
    await user.keyboard('{Control>}{Shift>}N{/Shift}{/Control}');
    expect(cell(0, 1)).toHaveTextContent('NULL');
    expect(cell(0, 1)).toHaveClass('null');

    await user.click(cell(1, 1));
    await user.keyboard('{Meta>}{Shift>}N{/Shift}{/Meta}');
    expect(sqlLines()).toEqual([
      `UPDATE "public"."users" SET "ad" = NULL WHERE "id" = '1'::integer;`,
      `UPDATE "public"."users" SET "ad" = NULL WHERE "id" = '2'::integer;`,
    ]);
  });

  it('düzenleyicide Ctrl/Cmd+Shift+N değeri NULL yapar ve kutuyu kapatır', async () => {
    const { user } = await setup();
    await user.click(cell(0, 1));
    await user.keyboard('{F2}xyz{Control>}{Shift>}N{/Shift}{/Control}');
    expect(t().queryByRole('textbox', { name: /değeri$/ })).not.toBeInTheDocument();
    expect(sqlLines()).toEqual([`UPDATE "public"."users" SET "ad" = NULL WHERE "id" = '1'::integer;`]);
  });

  it('sağ tık “NULL yap”', async () => {
    const { user } = await setup();
    await user.pointer({ keys: '[MouseRight]', target: cell(1, 1) });
    await user.click(menuItem('NULL yap'));
    expect(sqlLines()).toEqual([`UPDATE "public"."users" SET "ad" = NULL WHERE "id" = '2'::integer;`]);
  });
});

describe('Tablo sekmesi: salt okunur kolonlar', () => {
  it('generated ve bytea kolonları düzenleyici açmaz, nedeni kutunun altında; NULL kısayolu da etkisiz', async () => {
    const { user } = await setup({
      firstPage: page({ kolonlar: ['id', 'ad', 'dosya'], tipler: [23, 25, 17], uretilmis: ['ad'], satirlar: [['1', 'Ali', '\\x00']] }),
    });
    await user.click(cell(0, 1));
    await user.keyboard('x');
    expect(t().getByRole('textbox', { name: 'ad değeri' })).toHaveAttribute('readonly');
    expect(t().getByRole('note')).toHaveTextContent('“ad” üretilmiş (generated) kolon: salt okunur');
    await user.keyboard('{Escape}');

    await user.dblClick(cell(0, 2));
    expect(t().getByRole('note')).toHaveTextContent('“dosya” bytea kolonu: salt okunur');
    await user.keyboard('{Escape}{Control>}{Shift>}N{/Shift}{/Control}');
    expect(preview()).toHaveTextContent('Bekleyen değişiklik yok');
  });
});

describe('Tablo sekmesi: TSV yapıştırma', () => {
  it('seçimin sol üst köşesinden yapıştırır; taşan satır yeni satır, boş hücre NULL', async () => {
    const { user } = await setup();
    await user.click(cell(0, 1));
    await user.paste('Veli\nNULL\n');
    await user.click(cell(1, 1));
    await user.paste('Zeynep\n\nCan');
    expect(sqlLines()).toEqual([
      `UPDATE "public"."users" SET "ad" = 'Veli'::text WHERE "id" = '1'::integer;`,
      `UPDATE "public"."users" SET "ad" = 'Zeynep'::text WHERE "id" = '2'::integer;`,
      `INSERT INTO "public"."users" ("ad") VALUES (NULL);`,
      `INSERT INTO "public"."users" ("ad") VALUES ('Can'::text);`,
    ]);
    expect(rowOf(3)).toHaveClass('eklendi');
  });

  it('kolon taşan yapıştırma tümden reddedilir ve hata görünür', async () => {
    const { user } = await setup();
    await user.click(cell(0, 1));
    await user.paste('a\tb\nc');
    expect(t().getByRole('alert')).toHaveTextContent('Yapıştırma reddedildi: 2 kolon yapıştırılıyor, seçimden itibaren 1 kolon var.');
    expect(preview()).toHaveTextContent('Bekleyen değişiklik yok');
  });
});

describe('Tablo sekmesi: Uygula', () => {
  it('önizlemedeki SQL bu sekmede Transaction modunda, her ifade 1 satır beklenerek çalışır; commit sonrası sayfa yeniden çekilir, bekleyenler temizlenir', async () => {
    const { user, fake, runs } = await setup();
    await editName(user, 0, 'Veli');
    await user.click(applyButton());

    expect(runs.last()).toMatchObject({
      target: { connectionId: 'd1', database: 'postgres' },
      script: `UPDATE "public"."users" SET "ad" = 'Veli'::text WHERE "id" = '1'::integer;`,
      deneme: false,
      beklenenSatir: 1,
    });
    // Çalışırken düzenleme kapalı.
    await user.click(cell(1, 1));
    await user.keyboard('x');
    expect(t().queryByRole('textbox', { name: /değeri$/ })).not.toBeInTheDocument();

    runs.last().emit(
      { type: 'analiz', mod: 'transaction', transactionDisi: [], reddedilenler: [] },
      { type: 'started', i: 0 },
      { type: 'done', i: 0, rowCount: 1, ms: 2, komut: 'UPDATE' },
      { type: 'kararBekleniyor', commitEdilebilir: true, kalanMs: 30 * DK },
    );
    const card = within(t().getByRole('region', { name: 'Karar' }));
    fake.tablePage = async () => page({ satirlar: [['1', 'Veli'], ['2', 'Ayşe']] });
    await user.click(card.getByRole('button', { name: 'Commit' }));
    expect(runs.last().sent).toEqual(['commit']);
    runs.last().emit({ type: 'bitti', sonuc: 'commit' });

    await waitFor(() => expect(fake.tablePageRequests).toHaveLength(2));
    await waitFor(() => expect(preview()).toHaveTextContent('Bekleyen değişiklik yok'));
    expect(cell(0, 1)).toHaveTextContent('Veli');
    expect(cell(0, 1)).not.toHaveClass('degisti');
    expect(card.getByText('Commit edildi')).toBeInTheDocument();
  });

  it('satır sayısı hatasında hatalı satır işaretlenir, yalnızca rollback; rollback sonrası bekleyenler kalır', async () => {
    const { user, fake, runs } = await setup();
    await editName(user, 0, 'Veli');
    await editName(user, 1, 'Zeynep');
    await user.click(applyButton());
    const mesaj = 'Satır değişmiş ya da silinmiş (0 satır etkilendi)';
    runs.last().emit(
      { type: 'done', i: 0, rowCount: 1, ms: 2, komut: 'UPDATE' },
      { type: 'error', i: 1, sqlstate: null, mesaj, satir: 2, sutun: 1, bas: 0, bit: 1, ms: 1, tur: 'satirSayisi' },
      { type: 'kararBekleniyor', commitEdilebilir: false, kalanMs: 30 * DK },
    );
    const card = within(t().getByRole('region', { name: 'Karar' }));
    expect(card.queryByRole('button', { name: 'Commit' })).not.toBeInTheDocument();
    const rows = t().getAllByRole('row');
    expect(rows.filter((r) => r.getAttribute('aria-invalid') === 'true').map((r) => r.getAttribute('aria-rowindex'))).toEqual(['3']);
    expect(t().getByRole('list', { name: 'Bekleyen değişiklikler' })).toHaveTextContent(mesaj);

    await user.click(card.getByRole('button', { name: 'Rollback' }));
    runs.last().emit({ type: 'bitti', sonuc: 'rollback' });
    expect(fake.tablePageRequests).toHaveLength(1);
    expect(preview()).toHaveTextContent(`SET "ad" = 'Zeynep'::text WHERE "id" = '2'::integer;`);
    expect(cell(0, 1)).toHaveClass('degisti');
    expect(applyButton()).toBeEnabled();
  });

  it('prod 🔒 iken Uygula devre dışı; yanındaki tek tık Yazma kilidi açar', async () => {
    const { user, runs } = await setup({ conn: PROD });
    await editName(user, 0, 'Veli');
    expect(applyButton()).toBeDisabled();
    await user.click(t().getByRole('button', { name: '🔒 Salt okunur' }));
    expect(applyButton()).toBeEnabled();
    await user.click(applyButton());
    expect(runs.last()).toMatchObject({ yazmaModu: true, beklenenSatir: 1 });
  });
});

const tryButton = () => t().getByRole('button', { name: '⟲ Dene' });

describe('Tablo sekmesi: Dene', () => {
  it('önizlemedeki SQL Deneme modunda, her ifade 1 satır beklenerek çalışır; sonuç Değişiklikler’de, bekleyenler kalır', async () => {
    const { user, fake, runs } = await setup();
    expect(tryButton()).toBeDisabled();
    await editName(user, 0, 'Veli');
    await user.click(tryButton());

    expect(runs.last()).toMatchObject({
      target: { connectionId: 'd1', database: 'postgres' },
      script: `UPDATE "public"."users" SET "ad" = 'Veli'::text WHERE "id" = '1'::integer;`,
      deneme: true,
      beklenenSatir: 1,
    });
    expect(applyButton()).toBeDisabled();
    expect(tryButton()).toBeDisabled();
    expect(tableTab()).toHaveTextContent('Bekleyen değişiklikler deneniyor; bitene kadar düzenlenemez.');

    runs.last().emit(
      { type: 'started', i: 0 },
      {
        type: 'done',
        i: 0,
        rowCount: 1,
        ms: 2,
        komut: 'UPDATE',
        fark: {
          tablo: { oid: '100', ad: 'public.users' },
          kolonlar: ['id', 'ad'],
          anahtar: ['id'],
          satirlar: [{ once: ['1', 'Ali'], sonra: ['1', 'Veli'] }],
          gorulmeyen: { eklendi: 0, guncellendi: 0, silindi: 0 },
        },
      },
      { type: 'bitti', sonuc: 'deneme' },
    );
    const changes = t().getByRole('region', { name: 'Değişiklikler' });
    expect(within(changes).getByRole('region', { name: 'public.users' })).toHaveTextContent('~1 güncellendi');
    expect(within(changes).getByRole('deletion')).toHaveTextContent('Ali');
    expect(within(t().getByRole('region', { name: 'Karar' })).getByText('Deneme geri alındı; hiçbir şey kalıcı yazılmadı')).toBeInTheDocument();

    // Hiçbir şey yazılmadı: sayfa yeniden çekilmez, bekleyenler yerinde.
    expect(fake.tablePageRequests).toHaveLength(1);
    expect(cell(0, 1)).toHaveClass('degisti');
    expect(preview()).toHaveTextContent(`SET "ad" = 'Veli'::text`);
    expect(applyButton()).toBeEnabled();
    expect(tryButton()).toBeEnabled();
  });

  it('satır sayısı hatasında hatalı satır işaretlenir; Değişiklikler hatayı gösterir', async () => {
    const { user, runs } = await setup();
    await editName(user, 0, 'Veli');
    await editName(user, 1, 'Zeynep');
    await user.click(tryButton());
    const mesaj = 'Satır değişmiş ya da silinmiş (0 satır etkilendi)';
    runs.last().emit(
      { type: 'done', i: 0, rowCount: 1, ms: 2, komut: 'UPDATE' },
      { type: 'error', i: 1, sqlstate: null, mesaj, satir: 2, sutun: 1, bas: 0, bit: 1, ms: 1, tur: 'satirSayisi' },
      { type: 'bitti', sonuc: 'deneme' },
    );
    expect(t().getByRole('region', { name: 'Değişiklikler' })).toHaveTextContent(`Satır 2 · ${mesaj}`);
    const rows = t().getAllByRole('row');
    expect(rows.filter((r) => r.getAttribute('aria-invalid') === 'true').map((r) => r.getAttribute('aria-rowindex'))).toEqual(['3']);
    expect(t().getByRole('list', { name: 'Bekleyen değişiklikler' })).toHaveTextContent(mesaj);
  });

  it('prod 🔒 iken Dene açık, Uygula kapalı; deneme yan etki uyarısı görünür', async () => {
    const { user, runs } = await setup({ conn: PROD });
    await editName(user, 0, 'Veli');
    expect(applyButton()).toBeDisabled();
    expect(tryButton()).toBeEnabled();
    await user.click(tryButton());
    expect(runs.last()).toMatchObject({ deneme: true, yazmaModu: false, beklenenSatir: 1 });
    expect(t().getByRole('note', { name: 'Deneme yan etki uyarısı' })).toBeInTheDocument();
  });
});

describe('Tablo sekmesi: Konsola aktar', () => {
  it('önizlemedeki SQL aynı hedefte yeni konsol sekmesinde açılır; bekleyenler Tablo sekmesinde kalır', async () => {
    const { user, runs } = await setup();
    const exportButton = () => t().getByRole('button', { name: 'Konsola aktar' });
    expect(exportButton()).toBeDisabled();
    await editName(user, 0, 'Veli');
    await editName(user, 1, 'Zeynep');
    const sql = preview().querySelector('pre')!.textContent;
    await user.click(exportButton());

    const tabs = within(screen.getByRole('tablist', { name: 'Konsol sekmeleri' })).getAllByRole('tab');
    expect(tabs.map((tab) => [tab.textContent, tab.getAttribute('aria-selected')])).toEqual([
      ['Yerel / postgres', 'false'],
      ['users', 'false'],
      ['Yerel / postgres', 'true'],
    ]);
    expect(editorScript()).toBe(sql);
    expect(runs.runs).toHaveLength(0);

    await user.click(tabs[1]!);
    expect(cell(0, 1)).toHaveClass('degisti');
    expect(preview().querySelector('pre')!.textContent).toBe(sql);
  });
});

describe('Tablo sekmesi: kapatma', () => {
  it('bekleyen değişiklik varken sekme kapatılırsa uyarı; vazgeçilirse sekme kalır', async () => {
    const { user } = await setup();
    await editName(user, 0, 'Veli');
    await user.click(screen.getByRole('button', { name: 'users sekmesini kapat' }));
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent('1 bekleyen değişiklik');
    await user.click(within(dialog).getByRole('button', { name: 'Vazgeç' }));
    expect(tableTab()).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'users sekmesini kapat' }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Kapat' }));
    expect(screen.queryByRole('region', { name: 'public.users tablosu' })).not.toBeInTheDocument();
  });

  it('bekleyen değişiklik yoksa sekme sorulmadan kapanır', async () => {
    const { user } = await setup();
    await user.click(screen.getByRole('button', { name: 'users sekmesini kapat' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'public.users tablosu' })).not.toBeInTheDocument();
  });
});
