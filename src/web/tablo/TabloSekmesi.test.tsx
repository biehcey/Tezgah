import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { Catalog } from '../../core/katalog';
import { TABS_VERSION, type SavedTabs } from '../../core/konsol-sekmeleri';
import type { TablePageResponse } from '../../core/tablo-sayfasi';
import { App } from '../App';
import { connection, createFakeConnections, emptyCatalog, renderWithApi } from '../test/sahte-api';

const DEV = connection({ id: 'd1', name: 'Yerel', databaseSelection: [{ database: 'postgres', schemas: null }] });

const col = (ad: string, tip = 'integer') => ({ ad, tip, tipOid: 23, notNull: false, varsayilan: false, uretilmis: false });
const relation = (sema: string, ad: string, reltuples = 0) => ({ sema, ad, tur: 'r' as const, kolonlar: [col('id')], pk: ['id'], reltuples });

const CATALOG: Catalog = emptyCatalog({
  semalar: ['public', 'rapor'],
  iliskiler: [relation('public', 'users'), relation('public', 'user_log'), relation('public', 'siparis'), relation('rapor', 'aylik')],
});

const ids = (from: number, n: number) => Array.from({ length: n }, (_, k) => [String(from + k)]);
const page = (overrides: Partial<TablePageResponse> = {}): TablePageResponse => ({
  kolonlar: ['id'],
  tipler: [23],
  satirlar: ids(1, 3),
  sonraki: null,
  tutarlilikNotu: false,
  ...overrides,
});

async function setup(tabs: SavedTabs = { version: TABS_VERSION, sekmeler: [], aktif: null }) {
  const user = userEvent.setup();
  const fake = createFakeConnections([structuredClone(DEV)]);
  fake.savedTabs = tabs;
  fake.servers.set('d1', { databases: { postgres: ['public', 'rapor', 'pg_catalog'] } });
  fake.catalogs.set('d1/postgres', CATALOG);
  fake.tablePage = async () => page();
  renderWithApi(<App />, fake.api);
  await screen.findByText('Yerel', { selector: '.baglanti-adi' });
  return { user, fake };
}

const panel = () => screen.getByRole('region', { name: 'Veritabanları' });
const tableTab = () => screen.getByRole('region', { name: /tablosu$/ });
const grid = () => within(tableTab()).getByRole('grid');

/** Panelden bağlanır, `postgres`'in şemalarını açar ve `schema` çipine tıklar; tablo listesini döndürür. */
async function openTableList(user: ReturnType<typeof userEvent.setup>, schema = 'public') {
  await user.click(within(screen.getByRole('navigation', { name: 'Bağlantılar' })).getByRole('button', { name: /Yerel/ }));
  await user.click(within(panel()).getByRole('button', { name: /Bağlan ve tüm/ }));
  await user.click(await within(panel()).findByRole('button', { name: 'postgres şemaları' }));
  const chips = within(await within(panel()).findByRole('group', { name: 'postgres şemaları' }));
  await user.click(chips.getByRole('button', { name: schema }));
  return within(await within(panel()).findByRole('list', { name: `${schema} tabloları` }));
}

/** Grid'i yüklü `loaded` satırın sonuna kaydırır (satır 24 px). */
function scrollToEnd(loaded: number) {
  const scroller = grid();
  Object.defineProperty(scroller, 'scrollTop', { configurable: true, value: loaded * 24 });
  fireEvent.scroll(scroller);
}

describe('Tablo listesi → Tablo sekmesi', () => {
  it('şema çipi o şemanın tablolarını katalogdan listeler; filtre kutusu daraltır', async () => {
    const { user, fake } = await setup();
    const list = await openTableList(user);
    await waitFor(() => expect(list.getAllByRole('button').map((b) => b.textContent)).toEqual(['siparis', 'user_log', 'users']));
    expect(fake.catalogRequests).toEqual(['getir d1/postgres']);
    await user.type(within(panel()).getByRole('searchbox', { name: 'public tablolarını filtrele' }), 'user');
    expect(list.getAllByRole('button').map((b) => b.textContent)).toEqual(['user_log', 'users']);
  });

  it('şema çipinin yanındaki düğme görünürlüğü değiştirmeye devam eder', async () => {
    const { user, fake } = await setup();
    await openTableList(user);
    const chips = within(within(panel()).getByRole('group', { name: 'postgres şemaları' }));
    expect(chips.getByRole('button', { name: 'rapor görünürlüğü' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(chips.getByRole('button', { name: 'rapor görünürlüğü' }));
    await waitFor(() => expect(fake.connections[0]!.databaseSelection[0]!.schemas).toEqual(['public']));
  });

  it('tabloya tıklayınca editörsüz Tablo sekmesi açılır ve ilk sayfayı çeker', async () => {
    const { user, fake } = await setup();
    fake.tablePage = async () => page({ satirTahmini: 1300 });
    const list = await openTableList(user);
    await user.click(await list.findByRole('button', { name: 'users' }));

    expect(screen.getByRole('tab', { selected: true })).toHaveTextContent('users');
    await waitFor(() => expect(within(tableTab()).getAllByRole('gridcell').map((c) => c.textContent)).toEqual(['1', '2', '3']));
    expect(fake.tablePageRequests).toEqual([{ hedef: 'd1/postgres', sema: 'public', tablo: 'users', sonraki: null }]);
    expect(within(tableTab()).getByRole('heading')).toHaveTextContent('public.users');
    expect(tableTab()).toHaveTextContent('≈ 1.300 satır');
    expect(within(tableTab()).queryByRole('region', { name: 'Script editörü' })).not.toBeInTheDocument();
  });

  it('aynı tablo yeniden açılırsa açık sekmesine geçilir', async () => {
    const { user, fake } = await setup();
    const list = await openTableList(user);
    await user.click(await list.findByRole('button', { name: 'users' }));
    await user.click(screen.getAllByRole('tab')[0]!);
    await user.click(list.getByRole('button', { name: 'users' }));
    expect(screen.getAllByRole('tab')).toHaveLength(2);
    expect(screen.getByRole('tab', { selected: true })).toHaveTextContent('users');
    expect(fake.tablePageRequests).toHaveLength(1);
  });
});

describe('Tablo sekmesi: başlık', () => {
  it('hiç analiz edilmemiş tabloda "≈ bilinmiyor"; OFFSET ile sayfalanan tabloda tutarlılık notu', async () => {
    const { user, fake } = await setup();
    fake.tablePage = async () => page({ satirTahmini: -1, tutarlilikNotu: true });
    const list = await openTableList(user);
    await user.click(await list.findByRole('button', { name: 'users' }));
    await waitFor(() => expect(tableTab()).toHaveTextContent('≈ bilinmiyor'));
    expect(tableTab()).not.toHaveTextContent('0 satır');
    expect(tableTab()).toHaveTextContent('sayfalar arası tutarlılık garanti değil');
  });

  it('↻ önce hedefin katalogunu yeniler (kolonlar ve PK oradan), sonra ilk sayfayı yeniden çeker', async () => {
    const { user, fake } = await setup();
    const list = await openTableList(user);
    await user.click(await list.findByRole('button', { name: 'users' }));
    await waitFor(() => expect(fake.tablePageRequests).toHaveLength(1));
    let catalogAtPage: string | undefined;
    fake.tablePage = async () => {
      catalogAtPage = fake.catalogRequests.at(-1);
      return page({ satirlar: ids(7, 1), satirTahmini: 1 });
    };
    await user.click(within(tableTab()).getByRole('button', { name: 'Tabloyu yeniden yükle' }));
    await waitFor(() => expect(within(tableTab()).getAllByRole('gridcell').map((c) => c.textContent)).toEqual(['7']));
    expect(fake.tablePageRequests.map((r) => r.sonraki)).toEqual([null, null]);
    expect(fake.catalogRequests).toEqual(['getir d1/postgres', 'yenile d1/postgres']);
    expect(catalogAtPage).toBe('yenile d1/postgres');
  });

  it('↻’de katalog okunamazsa hata görünür, sayfa istenmez', async () => {
    const { user, fake } = await setup();
    const list = await openTableList(user);
    await user.click(await list.findByRole('button', { name: 'users' }));
    await waitFor(() => expect(fake.tablePageRequests).toHaveLength(1));
    fake.api.refreshCatalog = () => Promise.reject(new Error('bağlantı reddedildi'));
    await user.click(within(tableTab()).getByRole('button', { name: 'Tabloyu yeniden yükle' }));
    expect(await within(tableTab()).findByRole('alert')).toHaveTextContent('bağlantı reddedildi');
    expect(fake.tablePageRequests).toHaveLength(1);
  });

  it('sayfa okunamazsa hata sekmede görünür', async () => {
    const { user, fake } = await setup();
    fake.tablePage = async () => Promise.reject(new Error('permission denied for table users'));
    const list = await openTableList(user);
    await user.click(await list.findByRole('button', { name: 'users' }));
    expect(await within(tableTab()).findByRole('alert')).toHaveTextContent('permission denied for table users');
  });
});

describe('Tablo sekmesi: sayfalama', () => {
  it('sona yaklaşınca sonraki sayfa bir kez istenir, satırlar eklenir; son sayfadan sonra istenmez', async () => {
    const { user, fake } = await setup();
    const pages = [
      page({ satirlar: ids(1, 500), sonraki: { tur: 'keyset', degerler: ['500'] } }),
      page({ satirlar: ids(501, 500), sonraki: { tur: 'keyset', degerler: ['1000'] } }),
      page({ satirlar: ids(1001, 3), sonraki: null }),
    ];
    const waiting: (() => void)[] = [];
    fake.tablePage = (_hedef, request) => {
      const answer = pages[fake.tablePageRequests.length - 1]!;
      if (request.sonraki === null) return Promise.resolve(answer);
      return new Promise((resolve) => waiting.push(() => resolve(answer)));
    };
    const list = await openTableList(user);
    await user.click(await list.findByRole('button', { name: 'users' }));
    await waitFor(() => expect(tableTab()).toHaveTextContent('ilk 500 satır gösteriliyor'));

    scrollToEnd(500);
    scrollToEnd(500);
    expect(fake.tablePageRequests.map((r) => r.sonraki)).toEqual([null, { tur: 'keyset', degerler: ['500'] }]);
    expect(tableTab()).toHaveTextContent('Satırlar yükleniyor…');
    waiting.shift()!();
    await waitFor(() => expect(tableTab()).toHaveTextContent('ilk 1000 satır gösteriliyor'));

    scrollToEnd(1000);
    expect(fake.tablePageRequests).toHaveLength(3);
    waiting.shift()!();
    await waitFor(() => expect(tableTab()).toHaveTextContent('1003 satır'));
    scrollToEnd(1003);
    expect(fake.tablePageRequests).toHaveLength(3);
  });

  it('100.000 satıra ulaşınca durur ve sınır mesajı görünür', async () => {
    const { user, fake } = await setup();
    const big = (n: number) =>
      page({ satirlar: ids(n * 60_000 + 1, 60_000), sonraki: { tur: 'keyset', degerler: [String((n + 1) * 60_000)] } });
    fake.tablePage = async () => big(fake.tablePageRequests.length - 1);
    const list = await openTableList(user);
    await user.click(await list.findByRole('button', { name: 'users' }));
    await waitFor(() => expect(tableTab()).toHaveTextContent('ilk 60000 satır'));
    scrollToEnd(60_000);
    await waitFor(() => expect(tableTab()).toHaveTextContent('Sınıra ulaşıldı, filtrele'));
    expect(tableTab()).toHaveTextContent('ilk 100000 satır');
    scrollToEnd(100_000);
    expect(fake.tablePageRequests).toHaveLength(2);
  });
});

describe('Tablo sekmesi: kalıcılık', () => {
  const restoredTab: SavedTabs = {
    version: TABS_VERSION,
    aktif: 't1',
    sekmeler: [
      { id: 't1', tur: 'tablo', hedef: { connectionId: 'd1', database: 'postgres', schema: 'public' }, sema: 'public', tablo: 'users', where: '', orderBy: '' },
    ],
  };

  it('açılan Tablo sekmesi hedefi, şeması ve tablosuyla diske yazılır', async () => {
    const { user, fake } = await setup();
    const list = await openTableList(user);
    await user.click(await list.findByRole('button', { name: 'users' }));
    await waitFor(
      () =>
        expect(fake.savedTabs.sekmeler.find((t) => t.tur === 'tablo')).toMatchObject({
          tur: 'tablo',
          hedef: { connectionId: 'd1', database: 'postgres', schema: 'public' },
          sema: 'public',
          tablo: 'users',
        }),
      { timeout: 3000 },
    );
  });

  it('geri gelen Tablo sekmesi bağlanmaz; "Yükle" ile ilk sayfayı çeker', async () => {
    const { user, fake } = await setup(restoredTab);
    expect(screen.getByRole('tab', { selected: true })).toHaveTextContent('users');
    expect(tableTab()).toHaveTextContent('public.users');
    expect(fake.tablePageRequests).toEqual([]);
    expect(fake.catalogRequests).toEqual([]);
    expect(fake.databaseRequests).toEqual([]);

    await user.click(within(tableTab()).getByRole('button', { name: 'Yükle' }));
    await waitFor(() => expect(within(tableTab()).getAllByRole('gridcell')).toHaveLength(3));
    expect(fake.tablePageRequests).toEqual([{ hedef: 'd1/postgres', sema: 'public', tablo: 'users', sonraki: null }]);
  });

  it('geri gelen, yüklenmemiş Tablo sekmesinin tablosu listeden açılınca o sekme yüklenir', async () => {
    const { user, fake } = await setup(restoredTab);
    const list = await openTableList(user);
    await user.click(await list.findByRole('button', { name: 'users' }));
    await waitFor(() => expect(within(tableTab()).getAllByRole('gridcell')).toHaveLength(3));
    expect(screen.getAllByRole('tab')).toHaveLength(1);
    expect(fake.tablePageRequests).toHaveLength(1);
  });

  it('hedefi silinmiş Tablo sekmesi hedefsiz açılır ve yüklenemez', async () => {
    const { fake } = await setup({ ...restoredTab, sekmeler: [{ ...restoredTab.sekmeler[0]!, hedef: { connectionId: 'yok', database: 'x', schema: null } }] });
    expect(within(tableTab()).queryByRole('button', { name: 'Yükle' })).not.toBeInTheDocument();
    expect(tableTab()).toHaveTextContent('hedefi yok');
    expect(fake.tablePageRequests).toEqual([]);
  });
});
