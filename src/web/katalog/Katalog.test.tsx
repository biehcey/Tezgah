import { EditorView } from '@codemirror/view';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { Catalog, CompletionConfig } from '../../core/katalog';
import { TABS_VERSION, type SavedTabs } from '../../core/konsol-sekmeleri';
import { App } from '../App';
import { completionConfig } from '../script/ScriptEditoru';
import { editorScript, setEditorScript } from '../test/eylemler';
import { connection, createFakeConnections, createFakeScriptRuns, emptyCatalog, renderWithApi } from '../test/sahte-api';

const DEV = connection({
  id: 'd1',
  name: 'Yerel',
  databaseSelection: [
    { database: 'postgres', schemas: null },
    { database: 'app', schemas: ['public'] },
  ],
});
const OTHER = connection({ id: 'o1', name: 'Diğer', databaseSelection: [{ database: 'rapor', schemas: null }] });

const col = (ad: string, tip: string, tipOid = 23) => ({ ad, tip, tipOid, notNull: false, varsayilan: false, uretilmis: false });
const relation = (sema: string, ad: string, kolonlar = [col('id', 'integer')]) => ({ sema, ad, tur: 'r' as const, kolonlar, pk: [], reltuples: 0 });

const POSTGRES_CATALOG: Catalog = emptyCatalog({
  semalar: ['public', 'rapor'],
  iliskiler: [relation('public', 'users', [col('id', 'integer'), col('durum', 'durum', 16400)]), relation('rapor', 'aylik')],
  tipler: { '16400': 'durum' },
  kullaniciTipleri: ['durum'],
});

const saved = (sekmeler: SavedTabs['sekmeler']): SavedTabs => ({ version: TABS_VERSION, sekmeler, aktif: sekmeler[0]?.id ?? null });
const devTab = (id: string, metin = '', database = 'postgres') => ({
  id,
  tur: 'konsol' as const,
  hedef: { connectionId: 'd1', database, schema: null },
  metin,
});

async function setup(tabs: SavedTabs = saved([])) {
  const user = userEvent.setup();
  const runs = createFakeScriptRuns();
  // Sahte API seçimi yerinde değiştirir; her test kendi kopyasıyla başlar.
  const fake = createFakeConnections([structuredClone(DEV), structuredClone(OTHER)]);
  fake.savedTabs = tabs;
  fake.api.runScript = runs.runScript;
  fake.catalogs.set('d1/postgres', POSTGRES_CATALOG);
  renderWithApi(<App />, fake.api);
  await screen.findByText('Yerel', { selector: '.baglanti-adi' });
  await waitFor(() => editorScript());
  return { user, runs, fake };
}

/** Editöre verilen tamamlama yapılandırması (CodeMirror'ın kendi tamamlaması sınanmaz). */
function editorCompletion(): CompletionConfig | null {
  const content = screen.getByRole('region', { name: 'Script editörü' }).querySelector('.cm-content') as HTMLElement;
  return EditorView.findFromDOM(content)!.state.facet(completionConfig);
}
const schemaNames = () => Object.keys(editorCompletion()?.schema ?? {});
const tableNames = (schema: string) =>
  Object.keys((editorCompletion()!.schema as Record<string, { children: Record<string, unknown> }>)[schema]!.children);

const runButton = () => screen.getByRole('button', { name: '▶ Çalıştır' });
const refreshButton = () => screen.getByRole('button', { name: 'Katalogu yenile' });

/** Bağlantıyı seçip panelden bağlanır ve `postgres`'in şema çiplerini açar. */
async function connectInPanel(user: ReturnType<typeof userEvent.setup>) {
  const nav = screen.getByRole('navigation', { name: 'Bağlantılar' });
  await user.click(within(nav).getByRole('button', { name: /Yerel/ }));
  const panel = screen.getByRole('region', { name: 'Veritabanları' });
  await user.click(within(panel).getByRole('button', { name: /Bağlan ve tüm/ }));
  await user.click(await within(panel).findByRole('button', { name: 'postgres şemaları' }));
  return within(await within(panel).findByRole('group', { name: 'postgres şemaları' }));
}

async function pickTarget(user: ReturnType<typeof userEvent.setup>, query: string) {
  await user.keyboard('{Control>}k{/Control}');
  await user.keyboard(query);
  await user.keyboard('{Enter}');
}

describe('Katalog: yalnızca kullanıcı eylemiyle istenir', () => {
  it('geri gelen sekmeler katalog istemez; editörde tamamlama yoktur', async () => {
    const { fake } = await setup(saved([devTab('s1', 'SELECT 1'), devTab('s2', '', 'app')]));
    expect(fake.catalogRequests).toEqual([]);
    expect(editorCompletion()).toBeNull();
  });

  it('paletten seçilen hedefin katalogu istenir ve editöre verilir', async () => {
    const { user, fake } = await setup();
    await pickTarget(user, 'Yerel');
    await waitFor(() => expect(fake.catalogRequests).toEqual(['getir d1/postgres']));
    await waitFor(() => expect(schemaNames()).toEqual(['public', 'rapor']));
    expect(editorCompletion()!.defaultSchema).toBe('public');
    expect(tableNames('public')).toEqual(['users']);
  });

  it('Veritabanı panelinden seçilen hedefin katalogu istenir', async () => {
    const { user, fake } = await setup();
    fake.servers.set('d1', { databases: { postgres: ['public'], app: ['public'] } });
    const nav = screen.getByRole('navigation', { name: 'Bağlantılar' });
    await user.click(within(nav).getByRole('button', { name: /Yerel/ }));
    await user.click(within(screen.getByRole('region', { name: 'Veritabanları' })).getByRole('button', { name: 'app' }));
    await waitFor(() => expect(fake.catalogRequests).toEqual(['getir d1/app']));
  });

  it('geri gelen sekme ilk çalıştırıldığında katalogu ister; aynı hedefteki sekmeler katalogu paylaşır', async () => {
    const { user, fake, runs } = await setup(saved([devTab('s1', 'SELECT 1'), devTab('s2', 'SELECT 2')]));
    await user.click(runButton());
    runs.last().emit({ type: 'bitti', sonuc: 'commit' });
    await waitFor(() => expect(schemaNames()).toEqual(['public', 'rapor']));
    await user.click(runButton());
    runs.last().emit({ type: 'bitti', sonuc: 'commit' });

    await user.click(screen.getAllByRole('tab')[1]!);
    await waitFor(() => expect(schemaNames()).toEqual(['public', 'rapor']));
    await user.click(runButton());
    expect(fake.catalogRequests).toEqual(['getir d1/postgres']);
  });

  it('editör yalnızca Veritabanı seçiminin görünür şemalarını tamamlar', async () => {
    const { user, fake } = await setup();
    fake.servers.set('d1', { databases: { postgres: ['public', 'rapor'] } });
    await pickTarget(user, 'Yerel');
    await waitFor(() => expect(schemaNames()).toEqual(['public', 'rapor']));
    fake.catalogs.set('d1/postgres', { ...POSTGRES_CATALOG, semalar: ['public'] });
    // Seçim değişince eski katalog atılır ve (kullanıcı eylemi olduğundan) yeniden istenir.
    const chips = await connectInPanel(user);
    await user.click(chips.getByRole('button', { name: 'rapor' }));
    await waitFor(() => expect(schemaNames()).toEqual(['public']));
    expect(fake.catalogRequests).toEqual(['getir d1/postgres', 'getir d1/postgres']);
  });
});

describe('Katalog: yenileme', () => {
  it('↻ katalogu sunucuda yeniden okutur ve editörü yeniden yapılandırır', async () => {
    const { user, fake } = await setup();
    await pickTarget(user, 'Yerel');
    await waitFor(() => expect(tableNames('public')).toEqual(['users']));
    fake.catalogs.set('d1/postgres', emptyCatalog({ iliskiler: [relation('public', 'yeni')] }));
    await user.click(refreshButton());
    await waitFor(() => expect(tableNames('public')).toEqual(['yeni']));
    expect(fake.catalogRequests).toEqual(['getir d1/postgres', 'yenile d1/postgres']);
  });

  it('bitti.katalogYenilendi gelince tazelenen katalog yeniden çekilir', async () => {
    const { user, fake, runs } = await setup(saved([devTab('s1', 'CREATE TABLE yeni (id int)')]));
    await user.click(runButton());
    await waitFor(() => expect(tableNames('public')).toEqual(['users']));
    fake.catalogs.set('d1/postgres', emptyCatalog({ iliskiler: [relation('public', 'yeni')] }));
    runs.last().emit({ type: 'bitti', sonuc: 'commit', katalogYenilendi: true });
    await waitFor(() => expect(tableNames('public')).toEqual(['yeni']));
    expect(fake.catalogRequests).toEqual(['getir d1/postgres', 'getir d1/postgres']);
  });

  it('bağlantı kesilince katalog atılır ve yeniden istenmez', async () => {
    const { user, fake } = await setup();
    fake.servers.set('d1', { databases: { postgres: ['public'] } });
    await pickTarget(user, 'Yerel');
    await waitFor(() => expect(schemaNames()).toEqual(['public', 'rapor']));
    await connectInPanel(user);
    await user.click(within(screen.getByRole('region', { name: 'Veritabanları' })).getByRole('button', { name: 'Bağlantı menüsü' }));
    await user.click(screen.getByRole('menuitem', { name: 'Bağlantıyı kes' }));
    await waitFor(() => expect(editorCompletion()).toBeNull());
    expect(fake.catalogRequests).toEqual(['getir d1/postgres']);
  });
});

describe('Katalog: INSERT olarak kopyala', () => {
  it('yerleşik olmayan tip OID’si hedefin katalogundan çözülür', async () => {
    const { user, runs } = await setup();
    await pickTarget(user, 'Yerel');
    await waitFor(() => expect(schemaNames()).toEqual(['public', 'rapor']));
    setEditorScript('SELECT durum FROM users');
    await user.click(runButton());
    runs.last().emit(
      { type: 'done', i: 0, rowCount: 1, ms: 1, komut: 'SELECT', onizleme: { kolonlar: ['durum'], tipler: [16400], satirlar: [['acik']] } },
      { type: 'bitti', sonuc: 'commit' },
    );
    const cell = within(screen.getByRole('grid')).getAllByRole('gridcell')[0]!;
    await user.click(cell);
    fireEvent.contextMenu(cell);
    await user.click(screen.getByRole('menuitem', { name: 'INSERT olarak kopyala' }));
    expect(await navigator.clipboard.readText()).toBe(`INSERT INTO "tablo" ("durum") VALUES ('acik'::durum);`);
  });
});
