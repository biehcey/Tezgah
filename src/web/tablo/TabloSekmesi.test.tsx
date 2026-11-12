import { EditorView } from '@codemirror/view';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { Catalog } from '../../core/katalog';
import { TABS_VERSION, type SavedTabs } from '../../core/konsol-sekmeleri';
import type { TablePageResponse } from '../../core/tablo-sayfasi';
import { ApiError } from '../api/client';
import { App } from '../App';
import { completionConfig } from '../script/ScriptEditoru';
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
  pk: ['id'],
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
    expect(fake.tablePageRequests).toEqual([{ hedef: 'd1/postgres', sema: 'public', tablo: 'users', where: '', orderBy: '', sonraki: null }]);
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
    expect(fake.tablePageRequests).toEqual([{ hedef: 'd1/postgres', sema: 'public', tablo: 'users', where: '', orderBy: '', sonraki: null }]);
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

/** Tablo sekmesinin filtre kutusu (tek satırlık CodeMirror). */
const filterBox = (name: 'WHERE' | 'ORDER BY') => within(tableTab()).getByRole('textbox', { name });
const boxText = (name: 'WHERE' | 'ORDER BY') => EditorView.findFromDOM(filterBox(name))!.state.doc.toString();

/** Kutuya yazar (kullanıcı yazmış gibi) ve Enter'a basar. */
function applyBox(name: 'WHERE' | 'ORDER BY', text: string) {
  const view = EditorView.findFromDOM(filterBox(name))!;
  act(() => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, userEvent: 'input' }));
  fireEvent.keyDown(view.contentDOM, { key: 'Enter', keyCode: 13 });
}

const cells = () => within(tableTab()).getAllByRole('gridcell').map((c) => c.textContent);

async function openUsers(user: ReturnType<typeof userEvent.setup>, fake: Awaited<ReturnType<typeof setup>>['fake']) {
  const list = await openTableList(user);
  await user.click(await list.findByRole('button', { name: 'users' }));
  await waitFor(() => expect(fake.tablePageRequests).toHaveLength(1));
  await waitFor(() => expect(cells()).toEqual(['1', '2', '3']));
}

describe('Tablo sekmesi: WHERE ve ORDER BY', () => {
  it('Enter kutuları uygular: ilk sayfa filtreyle yeniden çekilir, filtre sekmeyle diske yazılır', async () => {
    const { user, fake } = await setup();
    await openUsers(user, fake);
    fake.tablePage = async () => page({ satirlar: ids(2, 1) });
    applyBox('ORDER BY', 'ad DESC');
    applyBox('WHERE', 'id = 2');
    await waitFor(() => expect(cells()).toEqual(['2']));
    expect(fake.tablePageRequests.at(-1)).toEqual({ hedef: 'd1/postgres', sema: 'public', tablo: 'users', where: 'id = 2', orderBy: 'ad DESC', sonraki: null });
    await waitFor(() => expect(fake.savedTabs.sekmeler.find((t) => t.tur === 'tablo')).toMatchObject({ where: 'id = 2', orderBy: 'ad DESC' }), {
      timeout: 3000,
    });
  });

  it('sonraki sayfalar uygulanan filtreyle istenir', async () => {
    const { user, fake } = await setup();
    await openUsers(user, fake);
    fake.tablePage = async () => page({ satirlar: ids(1, 500), sonraki: { tur: 'offset', offset: 500 } });
    applyBox('ORDER BY', 'ad');
    await waitFor(() => expect(tableTab()).toHaveTextContent('ilk 500 satır'));
    scrollToEnd(500);
    await waitFor(() => expect(fake.tablePageRequests.at(-1)).toMatchObject({ orderBy: 'ad', sonraki: { tur: 'offset', offset: 500 } }));
  });

  it('hatalı filtrede Postgres hatası (SQLSTATE, mesaj, konum) kutunun yanında; grid önceki sonuçla kalır', async () => {
    const { user, fake } = await setup();
    await openUsers(user, fake);
    fake.tablePage = () =>
      Promise.reject(new ApiError(400, { hata: 'column "yok" does not exist', sqlstate: '42703', konum: 48, kutu: 'where', kutuKonumu: 6 }));
    applyBox('WHERE', 'id = yok');
    const alert = await within(tableTab()).findByRole('alert');
    expect(alert).toHaveTextContent('column "yok" does not exist');
    expect(alert).toHaveTextContent('42703');
    expect(alert).toHaveTextContent('6. karakter');
    expect(alert.closest('.filtre-kutusu')).toContainElement(filterBox('WHERE'));
    expect(filterBox('WHERE')).toHaveAttribute('aria-invalid', 'true');
    expect(cells()).toEqual(['1', '2', '3']);

    fake.tablePage = async () => page({ satirlar: ids(5, 1) });
    applyBox('WHERE', 'id = 5');
    await waitFor(() => expect(cells()).toEqual(['5']));
    expect(within(tableTab()).queryByRole('alert')).not.toBeInTheDocument();
  });

  it('yeni filtrenin ilk sayfası yoldayken eski sonucun sonraki sayfası istenmez', async () => {
    const { user, fake } = await setup();
    fake.tablePage = async () => page({ satirlar: ids(1, 500), sonraki: { tur: 'keyset', degerler: ['500'] } });
    const list = await openTableList(user);
    await user.click(await list.findByRole('button', { name: 'users' }));
    await waitFor(() => expect(tableTab()).toHaveTextContent('ilk 500 satır'));
    const waiting: (() => void)[] = [];
    fake.tablePage = () => new Promise((resolve) => waiting.push(() => resolve(page({ satirlar: ids(2, 1) }))));
    applyBox('WHERE', 'id = 2');
    scrollToEnd(500);
    expect(fake.tablePageRequests.map((r) => r.sonraki)).toEqual([null, null]);
    act(() => waiting.shift()!());
    await waitFor(() => expect(cells()).toEqual(['2']));
  });

  it('reddedilen filtre sekmeye yazılmaz; ↻ son başarılı filtreyle çeker', async () => {
    const { user, fake } = await setup();
    await openUsers(user, fake);
    fake.tablePage = () => Promise.reject(new ApiError(400, { hata: 'syntax error', sqlstate: '42601', kutu: 'where', kutuKonumu: 5 }));
    applyBox('WHERE', 'id =');
    await within(tableTab()).findByRole('alert');
    fake.tablePage = async () => page();
    await user.click(within(tableTab()).getByRole('button', { name: 'Tabloyu yeniden yükle' }));
    await waitFor(() => expect(fake.tablePageRequests).toHaveLength(3));
    expect(fake.tablePageRequests.at(-1)).toMatchObject({ where: '', orderBy: '' });
    await waitFor(() => expect(fake.savedTabs.sekmeler.find((t) => t.tur === 'tablo')).toMatchObject({ where: '' }), { timeout: 3000 });
  });

  it('başlık tıklaması uygulanmamış WHERE taslağını uygulamaz, taslak kutuda kalır', async () => {
    const { user, fake } = await setup();
    await openUsers(user, fake);
    const view = EditorView.findFromDOM(filterBox('WHERE'))!;
    act(() => view.dispatch({ changes: { from: 0, insert: 'id > 9' }, userEvent: 'input' }));
    await user.click(within(grid()).getByRole('button', { name: 'id' }));
    await waitFor(() => expect(fake.tablePageRequests.at(-1)).toMatchObject({ where: '', orderBy: '"id"' }));
    expect(boxText('WHERE')).toBe('id > 9');
  });

  it('çok ifadeli filtrenin reddi de ORDER BY kutusunun yanında görünür', async () => {
    const { user, fake } = await setup();
    await openUsers(user, fake);
    fake.tablePage = () => Promise.reject(new ApiError(400, { hata: 'ORDER BY kutusu tek ifade olmalı', kutu: 'orderBy' }));
    applyBox('ORDER BY', 'id; DELETE FROM users');
    const alert = await within(tableTab()).findByRole('alert');
    expect(alert).toHaveTextContent('tek ifade');
    expect(alert.closest('.filtre-kutusu')).toContainElement(filterBox('ORDER BY'));
    expect(cells()).toEqual(['1', '2', '3']);
  });

  it('kolon başlığına tık ORDER BY’ı doldurur: artan → azalan → temiz', async () => {
    const { user, fake } = await setup();
    await openUsers(user, fake);
    const header = () => within(grid()).getByRole('columnheader', { name: /id/ });
    await user.click(within(header()).getByRole('button', { name: 'id' }));
    await waitFor(() => expect(fake.tablePageRequests.at(-1)).toMatchObject({ orderBy: '"id"', sonraki: null }));
    expect(boxText('ORDER BY')).toBe('"id"');
    await waitFor(() => expect(header()).toHaveAttribute('aria-sort', 'ascending'));
    await user.click(within(header()).getByRole('button', { name: 'id' }));
    await waitFor(() => expect(fake.tablePageRequests.at(-1)).toMatchObject({ orderBy: '"id" DESC' }));
    await waitFor(() => expect(header()).toHaveAttribute('aria-sort', 'descending'));
    await user.click(within(header()).getByRole('button', { name: 'id' }));
    await waitFor(() => expect(fake.tablePageRequests.at(-1)).toMatchObject({ orderBy: '' }));
    expect(boxText('ORDER BY')).toBe('');
    expect(fake.tablePageRequests).toHaveLength(4);
  });

  it('kutularda katalog tamamlaması: tablonun kolonları öneksiz', async () => {
    const { user, fake } = await setup();
    await openUsers(user, fake);
    const config = EditorView.findFromDOM(filterBox('WHERE'))!.state.facet(completionConfig);
    expect(config).toMatchObject({ defaultSchema: 'public', defaultTable: 'users' });
  });

  it('geri gelen sekmenin filtresi kutularda durur; "Yükle" onunla çeker', async () => {
    const { user, fake } = await setup({
      version: TABS_VERSION,
      aktif: 't1',
      sekmeler: [
        {
          id: 't1',
          tur: 'tablo',
          hedef: { connectionId: 'd1', database: 'postgres', schema: 'public' },
          sema: 'public',
          tablo: 'users',
          where: 'id > 1',
          orderBy: '"id" DESC',
        },
      ],
    });
    expect(boxText('WHERE')).toBe('id > 1');
    expect(boxText('ORDER BY')).toBe('"id" DESC');
    await user.click(within(tableTab()).getByRole('button', { name: 'Yükle' }));
    await waitFor(() =>
      expect(fake.tablePageRequests).toEqual([{ hedef: 'd1/postgres', sema: 'public', tablo: 'users', where: 'id > 1', orderBy: '"id" DESC', sonraki: null }]),
    );
  });
});

describe('Cmd/Ctrl+K: Tablolar', () => {
  it('yalnızca katalog önbelleği dolu hedeflerden; Enter Tablo sekmesi açar', async () => {
    const { user, fake } = await setup();
    await user.keyboard('{Control>}k{/Control}');
    await user.keyboard('user_l');
    expect(screen.queryByRole('group', { name: 'Tablolar' })).not.toBeInTheDocument();
    await user.keyboard('{Escape}');

    await openTableList(user);
    await waitFor(() => expect(fake.catalogRequests).toEqual(['getir d1/postgres']));
    await user.keyboard('{Control>}k{/Control}');
    await user.keyboard('user_l');
    const group = within(await screen.findByRole('group', { name: 'Tablolar' }));
    expect(group.getAllByRole('option')).toHaveLength(1);
    expect(group.getByRole('option')).toHaveTextContent('public.user_log');
    expect(group.getByRole('option')).toHaveTextContent('Yerel / postgres');
    await user.keyboard('{Enter}');
    expect(screen.queryByRole('dialog', { name: 'Hızlı geçiş' })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { selected: true })).toHaveTextContent('user_log');
    await waitFor(() =>
      expect(fake.tablePageRequests).toEqual([{ hedef: 'd1/postgres', sema: 'public', tablo: 'user_log', where: '', orderBy: '', sonraki: null }]),
    );
  });
});
