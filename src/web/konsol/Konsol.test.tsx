import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { TABS_VERSION, type SavedTabs } from '../../core/konsol-sekmeleri';
import { App } from '../App';
import { editorScript, setEditorScript } from '../test/eylemler';
import { connection, createFakeConnections, createFakeScriptRuns, renderWithApi } from '../test/sahte-api';

const DK = 60_000;

const PROD = connection({ id: 'p1', name: 'Canlı', envTag: 'prod', color: '#dc2626', databaseSelection: [{ database: 'app', schemas: null }] });
const DEV = connection({ id: 'd1', name: 'Yerel', envTag: 'dev', color: '#16a34a', databaseSelection: [{ database: 'postgres', schemas: null }] });

const saved = (sekmeler: SavedTabs['sekmeler'], aktif: string | null = sekmeler[0]?.id ?? null): SavedTabs => ({
  version: TABS_VERSION,
  sekmeler,
  aktif,
});
const prodTab = (id: string, metin = '') => ({ id, tur: 'konsol' as const, hedef: { connectionId: 'p1', database: 'app', schema: null }, metin });
const devTab = (id: string, metin = '') => ({ id, tur: 'konsol' as const, hedef: { connectionId: 'd1', database: 'postgres', schema: null }, metin });

async function setup(tabs: SavedTabs = saved([])) {
  const user = userEvent.setup();
  const runs = createFakeScriptRuns();
  const fake = createFakeConnections([PROD, DEV]);
  fake.savedTabs = tabs;
  fake.api.runScript = runs.runScript;
  const view = renderWithApi(<App />, fake.api);
  await screen.findByText('Canlı', { selector: '.baglanti-adi' });
  // Sekmeler bağlantılarla birlikte gelir; CodeMirror görünümü bir effect'te kurulur.
  await waitFor(() => editorScript());
  return { user, runs, fake, view };
}

const strip = () => screen.getByRole('tablist', { name: 'Konsol sekmeleri' });
const tabs = () => within(strip()).getAllByRole('tab');
const tabNamed = (name: RegExp) => within(strip()).getByRole('tab', { name });
const header = () => screen.getByRole('region', { name: 'Hedef' });
const lockButton = () => screen.getByRole('button', { name: /Salt okunur|Yazma açık/ });
const runButton = () => screen.getByRole('button', { name: '▶ Çalıştır' });
const frame = (view: { container: HTMLElement }) => view.container.querySelector('.tezgah')!;

/** Paletten hedef seçer (ilk eşleşen hedef). */
async function pickTarget(user: ReturnType<typeof userEvent.setup>, query: string) {
  await user.keyboard('{Control>}k{/Control}');
  await user.keyboard(query);
  await user.keyboard('{Enter}');
}

describe('Konsol sekmeleri: açılış', () => {
  it('kayıtlı sekmeler sırasıyla geri gelir; aktif sekmenin metni ve hedefi görünür', async () => {
    await setup(saved([devTab('s1', 'SELECT 1'), prodTab('s2', 'SELECT 2')], 's2'));
    expect(tabs().map((t) => t.textContent)).toEqual(['Yerel / postgres', 'Canlı / app']);
    expect(tabNamed(/Canlı/)).toHaveAttribute('aria-selected', 'true');
    expect(editorScript()).toBe('SELECT 2');
    expect(within(header()).getByRole('heading')).toHaveTextContent('Canlı / app');
  });

  it('geri gelen prod sekmesi her zaman 🔒 açılır ve hiçbir sunucuya istek gitmez', async () => {
    const { fake, runs } = await setup(saved([prodTab('s1', 'DELETE FROM t')]));
    expect(lockButton()).toHaveTextContent('🔒 Salt okunur');
    expect(fake.databaseRequests).toEqual([]);
    expect(runs.runs).toEqual([]);
  });

  it('silinmiş bağlantıya işaret eden sekme hedefsiz açılır, metni korunur', async () => {
    await setup(saved([{ id: 's1', tur: 'konsol', hedef: { connectionId: 'silindi', database: 'x', schema: null }, metin: 'SELECT 9' }]));
    expect(tabs().map((t) => t.textContent)).toEqual(['Hedefsiz']);
    expect(within(header()).getByText('Hedef seçilmedi')).toBeInTheDocument();
    expect(editorScript()).toBe('SELECT 9');
  });

  it('kayıtlı sekme yoksa hedefsiz boş bir sekme açılır', async () => {
    await setup();
    expect(tabs().map((t) => t.textContent)).toEqual(['Hedefsiz']);
    expect(editorScript()).toBe('');
  });
});

describe('Konsol sekmeleri: şerit', () => {
  it('sekme başlığında hedefin ortam rengi var; hedef başlığı ve prod çerçevesi aktif sekmeye göre değişir', async () => {
    const { user, view } = await setup(saved([devTab('s1'), prodTab('s2')], 's1'));
    expect(within(tabNamed(/Canlı/)).getByTestId('sekme-rengi')).toHaveStyle({ backgroundColor: '#dc2626' });
    expect(frame(view)).not.toHaveClass('prod-cerceve');
    expect(within(header()).getByRole('heading')).toHaveTextContent('Yerel / postgres');

    await user.click(tabNamed(/Canlı/));
    expect(frame(view)).toHaveClass('prod-cerceve');
    expect(within(header()).getByRole('heading')).toHaveTextContent('Canlı / app');
    expect(header()).toHaveClass('prod');
  });

  it('yeni sekme aktif sekmenin hedefiyle, boş metinle açılır; kapatılınca komşusu aktif olur', async () => {
    const { user } = await setup(saved([devTab('s1', 'SELECT 1')]));
    await user.click(screen.getByRole('button', { name: 'Yeni sekme' }));
    expect(tabs()).toHaveLength(2);
    expect(tabs()[1]).toHaveAttribute('aria-selected', 'true');
    expect(tabs()[1]).toHaveTextContent('Yerel / postgres');
    expect(editorScript()).toBe('');

    setEditorScript('SELECT 2');
    await user.click(tabs()[0]!);
    expect(editorScript()).toBe('SELECT 1');
    await user.click(tabs()[1]!);
    expect(editorScript()).toBe('SELECT 2');

    await user.click(within(strip()).getAllByRole('button', { name: /sekmesini kapat/ })[1]!);
    expect(tabs()).toHaveLength(1);
    expect(editorScript()).toBe('SELECT 1');
  });

  it('son sekme kapanınca konsol boş kalır; paletten seçilen hedef yeni sekmede açılır', async () => {
    const { user } = await setup(saved([devTab('s1')]));
    await user.click(within(strip()).getByRole('button', { name: /sekmesini kapat/ }));
    expect(within(strip()).queryAllByRole('tab')).toHaveLength(0);
    expect(screen.queryByRole('region', { name: 'Script editörü' })).not.toBeInTheDocument();

    await pickTarget(user, 'Canlı');
    expect(tabs().map((t) => t.textContent)).toEqual(['Canlı / app']);
  });
});

describe('Konsol sekmeleri: hedef', () => {
  it('paletten seçilen hedef yalnızca aktif sekmenin hedefi olur', async () => {
    const { user } = await setup(saved([devTab('s1'), devTab('s2')], 's2'));
    await pickTarget(user, 'Canlı');
    expect(tabs().map((t) => t.textContent)).toEqual(['Yerel / postgres', 'Canlı / app']);
  });

  it('Veritabanı panelinden seçilen hedef aktif sekmenin hedefi olur', async () => {
    const { user } = await setup(saved([devTab('s1')]));
    const nav = screen.getByRole('navigation', { name: 'Bağlantılar' });
    await user.click(within(nav).getByRole('button', { name: /Canlı/ }));
    await user.click(within(screen.getByRole('region', { name: 'Veritabanları' })).getByRole('button', { name: 'app' }));
    expect(tabs().map((t) => t.textContent)).toEqual(['Canlı / app']);
  });

  it('karar bekleyen sekmede hedef değiştirilemez; başka sekmede değiştirilebilir', async () => {
    const { user, runs } = await setup(saved([devTab('s1', 'INSERT INTO t VALUES (1)'), devTab('s2')]));
    await user.click(runButton());
    runs.last().emit({ type: 'kararBekleniyor', commitEdilebilir: true, kalanMs: 30 * DK });
    await pickTarget(user, 'Canlı');
    expect(screen.getByRole('dialog')).toHaveTextContent(/Hedef değiştirilemez/);
    await user.keyboard('{Escape}');
    expect(tabs()[0]).toHaveTextContent('Yerel / postgres');

    await user.click(tabs()[1]!);
    await pickTarget(user, 'Canlı');
    expect(tabs()[1]).toHaveTextContent('Canlı / app');
  });

  it('çalıştırma şemayı değil bağlantı + veritabanını hedefler (search_path değişmez)', async () => {
    const { user, runs } = await setup(saved([{ ...devTab('s1', 'SELECT 1'), hedef: { connectionId: 'd1', database: 'postgres', schema: 'rapor' } }]));
    await user.click(runButton());
    expect(runs.last().target).toEqual({ connectionId: 'd1', database: 'postgres' });
    expect(runs.last().script).toBe('SELECT 1');
  });
});

describe('Konsol sekmeleri: çalıştırma oturumları', () => {
  it('iki sekme aynı anda farklı hedeflerde çalıştırabilir', async () => {
    const { user, runs } = await setup(saved([prodTab('s1', 'SELECT 1'), devTab('s2', 'INSERT INTO t VALUES (2)')]));
    await user.click(runButton());
    runs.last().emit({ type: 'kararBekleniyor', commitEdilebilir: true, kalanMs: 30 * DK });
    await user.click(tabs()[1]!);
    expect(runButton()).toBeEnabled();
    await user.click(runButton());

    expect(runs.runs.map((r) => [r.target.connectionId, r.script, r.closed])).toEqual([
      ['p1', 'SELECT 1', false],
      ['d1', 'INSERT INTO t VALUES (2)', false],
    ]);
    runs.runs[1]!.emit({ type: 'bitti', sonuc: 'commit' });
    await user.click(tabs()[0]!);
    expect(within(screen.getByRole('region', { name: 'Karar' })).getByRole('button', { name: 'Commit' })).toBeEnabled();
  });

  it('karar bekleyen sekme kapatılınca çalıştırması kapanır (transaction geri alınır)', async () => {
    const { user, runs } = await setup(saved([devTab('s1', 'INSERT INTO t VALUES (1)'), devTab('s2')]));
    await user.click(runButton());
    runs.last().emit({ type: 'kararBekleniyor', commitEdilebilir: true, kalanMs: 30 * DK });
    await user.click(within(strip()).getAllByRole('button', { name: /sekmesini kapat/ })[0]!);
    expect(runs.last().closed).toBe(true);
    // Kapanan sekmenin hedef kilidi kalmaz.
    await pickTarget(user, 'Canlı');
    expect(tabs().map((t) => t.textContent)).toEqual(['Canlı / app']);
  });
});

describe('Konsol sekmeleri: Yazma kilidi', () => {
  it('bir prod sekmesinde 🔓 başka prod sekmesini etkilemez', async () => {
    const { user, runs } = await setup(saved([prodTab('s1', 'SELECT 1'), prodTab('s2', 'SELECT 2')]));
    await user.click(lockButton());
    expect(lockButton()).toHaveTextContent('🔓 Yazma açık');
    await user.click(tabs()[1]!);
    expect(lockButton()).toHaveTextContent('🔒 Salt okunur');
    await user.click(runButton());
    expect(runs.last().yazmaModu).toBe(false);
    await user.click(tabs()[0]!);
    expect(lockButton()).toHaveTextContent('🔓 Yazma açık');
  });

  it('sekmenin hedefi değişince kilit kapanır', async () => {
    const { user } = await setup(saved([prodTab('s1')]));
    await user.click(lockButton());
    await pickTarget(user, 'Yerel');
    await pickTarget(user, 'Canlı');
    expect(lockButton()).toHaveTextContent('🔒 Salt okunur');
  });
});

describe('Konsol sekmeleri: kalıcılık', () => {
  it('değişiklikler gecikmeli olarak diske yazılır; Yazma kilidi yazılmaz', async () => {
    const { user, fake } = await setup(saved([prodTab('s1')]));
    await user.click(lockButton());
    setEditorScript('SELECT 42');
    await waitFor(() => expect(fake.tabWrites.at(-1)?.sekmeler[0]).toMatchObject({ metin: 'SELECT 42' }));
    expect(fake.tabWrites.at(-1)).toEqual(saved([prodTab('s1', 'SELECT 42')]));
    expect(JSON.stringify(fake.tabWrites)).not.toMatch(/yazma/i);
  });

  it('geri gelen sekmeler değişmedikçe yeniden yazılmaz', async () => {
    const { fake } = await setup(saved([prodTab('s1', 'SELECT 1')]));
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(fake.tabWrites).toEqual([]);
  });

  it('sekmeler okunamazsa uyarı gösterilir ve diske yazılmaz', async () => {
    const user = userEvent.setup();
    const fake = createFakeConnections([DEV]);
    fake.api.readTabs = () => Promise.reject(new Error('bozuk'));
    renderWithApi(<App />, fake.api);
    expect(await screen.findByRole('alert')).toHaveTextContent(/Konsol sekmeleri okunamadı/);
    await screen.findByRole('tab', { name: 'Hedefsiz' });
    setEditorScript('SELECT 1');
    await user.click(screen.getByRole('button', { name: 'Yeni sekme' }));
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(fake.tabWrites).toEqual([]);
  });
});
