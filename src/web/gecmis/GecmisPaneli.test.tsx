import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { HistoryEntry } from '../../core/gecmis-filtresi';
import { TABS_VERSION, type SavedTabs } from '../../core/konsol-sekmeleri';
import { App } from '../App';
import { editorScript } from '../test/eylemler';
import { connection, createFakeConnections, renderWithApi } from '../test/sahte-api';

const PROD = connection({ id: 'p1', name: 'Canlı', envTag: 'prod', color: '#dc2626', databaseSelection: [{ database: 'app', schemas: null }] });
const DEV = connection({ id: 'd1', name: 'Yerel', envTag: 'dev', color: '#16a34a', databaseSelection: [{ database: 'postgres', schemas: null }] });

const CANLI = { baglantiId: 'p1', ad: 'Canlı', veritabani: 'app', ortam: 'prod' as const };
const YEREL = { baglantiId: 'd1', ad: 'Yerel', veritabani: 'postgres', ortam: 'dev' as const };

const entry = (runId: string, fields: Partial<HistoryEntry> = {}): HistoryEntry => ({
  runId,
  zaman: '2026-11-10T09:30:00.000Z',
  hedef: CANLI,
  mod: 'transaction',
  deneme: false,
  sonuc: 'commit',
  script: `SELECT '${runId}'`,
  ...fields,
});

const tabs = (sekmeler: SavedTabs['sekmeler']): SavedTabs => ({ version: TABS_VERSION, sekmeler, aktif: sekmeler[0]?.id ?? null });
const prodTab = { id: 's1', tur: 'konsol' as const, hedef: { connectionId: 'p1', database: 'app', schema: null }, metin: 'SELECT 1' };

async function setup({ history = [] as HistoryEntry[], saved = tabs([prodTab]) } = {}) {
  const user = userEvent.setup();
  const fake = createFakeConnections([PROD, DEV]);
  fake.savedTabs = saved;
  fake.history = history;
  renderWithApi(<App />, fake.api);
  await screen.findByText('Canlı', { selector: '.baglanti-adi' });
  await waitFor(() => editorScript());
  return { user, fake };
}

const panel = () => screen.getByRole('complementary', { name: 'Sorgu geçmişi' });
const list = () => within(panel()).getByRole('list', { name: 'Çalıştırma kayıtları' });
const rows = () => within(list()).queryAllByRole('listitem');
const strip = () => screen.getByRole('tablist', { name: 'Konsol sekmeleri' });
const toggle = (user: ReturnType<typeof userEvent.setup>) => user.keyboard('{Control>}{Alt>}e{/Alt}{/Control}');

describe('Sorgu geçmişi paneli: kısayol', () => {
  it('Ctrl+Alt+E açar ve kapatır; Cmd+Alt+E de çalışır; açılana kadar kayıt istenmez', async () => {
    const { user, fake } = await setup();
    expect(screen.queryByRole('complementary', { name: 'Sorgu geçmişi' })).not.toBeInTheDocument();
    expect(fake.historyRequests).toEqual([]);

    await toggle(user);
    expect(panel()).toBeInTheDocument();
    await toggle(user);
    expect(screen.queryByRole('complementary', { name: 'Sorgu geçmişi' })).not.toBeInTheDocument();

    await user.keyboard('{Meta>}{Alt>}e{/Alt}{/Meta}');
    expect(panel()).toBeInTheDocument();
    await user.click(within(panel()).getByRole('button', { name: 'Geçmişi kapat' }));
    expect(screen.queryByRole('complementary', { name: 'Sorgu geçmişi' })).not.toBeInTheDocument();
  });

  it('AltGr+E (Windows’ta Ctrl+Alt olarak gelir) paneli açmaz', async () => {
    const { user } = await setup();
    await user.keyboard('{Control>}{Alt>}{AltGraph>}e{/AltGraph}{/Alt}{/Control}');
    expect(screen.queryByRole('complementary', { name: 'Sorgu geçmişi' })).not.toBeInTheDocument();
  });
});

describe('Sorgu geçmişi paneli: filtre', () => {
  it('varsayılan filtre aktif sekmenin hedefidir; tüm hedeflere geçilebilir', async () => {
    const { user, fake } = await setup({ history: [entry('canli', { hedef: CANLI }), entry('yerel', { hedef: YEREL })] });
    await toggle(user);
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(fake.historyRequests.at(-1)).toMatchObject({ hedef: { baglantiId: 'p1', veritabani: 'app' }, imlec: null });

    await user.click(within(panel()).getByRole('radio', { name: 'Tüm hedefler' }));
    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(fake.historyRequests.at(-1)).toMatchObject({ hedef: null });
  });

  it('hedefsiz sekmede tüm hedefler gösterilir', async () => {
    const { user, fake } = await setup({ saved: tabs([{ ...prodTab, hedef: null }]) });
    await toggle(user);
    await waitFor(() => expect(fake.historyRequests).toHaveLength(1));
    expect(fake.historyRequests[0]).toMatchObject({ hedef: null });
    expect(within(panel()).getByRole('radio', { name: 'Bu hedef' })).toBeDisabled();
  });

  it('metin, sonuç ve tarih aralığı isteğe girer; bitiş günü dahildir', async () => {
    const { user, fake } = await setup();
    await toggle(user);
    await user.type(within(panel()).getByRole('searchbox', { name: 'Script’te ara' }), 'siparis');
    await user.click(within(panel()).getByRole('checkbox', { name: 'Hata' }));
    fireEvent.change(within(panel()).getByLabelText('Başlangıç tarihi'), { target: { value: '2026-11-02' } });
    fireEvent.change(within(panel()).getByLabelText('Bitiş tarihi'), { target: { value: '2026-11-03' } });
    await waitFor(() =>
      expect(fake.historyRequests.at(-1)).toMatchObject({
        metin: 'siparis',
        sonuclar: ['basarili', 'deneme', 'rollback'],
        baslangic: new Date(2026, 10, 2),
        bitis: new Date(2026, 10, 4),
      }),
    );
  });
});

describe('Sorgu geçmişi paneli: liste', () => {
  it('kayıtta zaman, ortam renginde hedef, sonuç ve script’in başı', async () => {
    const { user } = await setup({
      history: [
        entry('r1', { script: '\n  UPDATE siparis SET durum = 2\nWHERE id = 1', sonuc: 'kopma-rollback' }),
        entry('r2', { sonuc: 'bilinmiyor' }),
        entry('r3', { sonuc: 'commit', mod: 'autocommit' }),
      ],
    });
    await toggle(user);
    await waitFor(() => expect(rows()).toHaveLength(3));
    const [first, second, third] = rows();
    expect(first).toHaveTextContent('Canlı / app');
    expect(first).toHaveTextContent(new Date('2026-11-10T09:30:00.000Z').toLocaleString('tr-TR'));
    expect(within(first!).getByTestId('gecmis-rengi')).toHaveStyle({ backgroundColor: '#dc2626' });
    expect(within(first!).getByText('UPDATE siparis SET durum = 2')).toBeInTheDocument();
    expect(first).toHaveTextContent('kopma');
    expect(second).toHaveTextContent('bilinmiyor');
    expect(third).toHaveTextContent('autocommit');
  });

  it('aşağı kaydırınca sonraki sayfa imleçle istenir ve listeye eklenir', async () => {
    const history = Array.from({ length: 60 }, (_, i) => entry(`r${i}`));
    const { user, fake } = await setup({ history });
    await toggle(user);
    await waitFor(() => expect(rows()).toHaveLength(50));
    fireEvent.scroll(list());
    await waitFor(() => expect(rows()).toHaveLength(60));
    expect(fake.historyRequests.at(-1)!.imlec).not.toBeNull();
    fireEvent.scroll(list());
    expect(fake.historyRequests).toHaveLength(2);
  });

  it('liste paneli doldurmasa da “Daha eski kayıtlar” sonraki sayfayı ister', async () => {
    const { user } = await setup({ history: Array.from({ length: 55 }, (_, i) => entry(`r${i}`)) });
    await toggle(user);
    await user.click(await within(panel()).findByRole('button', { name: 'Daha eski kayıtlar' }));
    await waitFor(() => expect(rows()).toHaveLength(55));
    expect(within(panel()).queryByRole('button', { name: 'Daha eski kayıtlar' })).not.toBeInTheDocument();
  });

  it('kayıt yoksa bilgi gösterilir', async () => {
    const { user } = await setup();
    await toggle(user);
    expect(await within(panel()).findByText('Kayıt yok.')).toBeInTheDocument();
  });

  it('kayıtlar okunamazsa hata gösterilir', async () => {
    const { user, fake } = await setup();
    fake.api.listRunHistory = () => Promise.reject(new Error('disk okunamadı'));
    await toggle(user);
    expect(await within(panel()).findByRole('alert')).toHaveTextContent('disk okunamadı');
  });
});

describe('Sorgu geçmişi paneli: çift tık', () => {
  it('kaydın metni yeni sekmede, kaydın hedefiyle açılır; mevcut sekme değişmez', async () => {
    const { user } = await setup({ history: [entry('r1', { hedef: YEREL, script: 'SELECT 42' })] });
    await toggle(user);
    await user.click(within(panel()).getByRole('radio', { name: 'Tüm hedefler' }));
    await waitFor(() => expect(rows()).toHaveLength(1));
    await user.dblClick(rows()[0]!);

    const opened = within(strip()).getAllByRole('tab');
    expect(opened.map((t) => t.textContent)).toEqual(['Canlı / app', 'Yerel / postgres']);
    expect(opened[1]).toHaveAttribute('aria-selected', 'true');
    expect(editorScript()).toBe('SELECT 42');
    await user.click(opened[0]!);
    expect(editorScript()).toBe('SELECT 1');
  });

  it('Enter da açar; bağlantısı silinmiş kayıt hedefsiz sekmede açılır', async () => {
    const gone = { baglantiId: 'silindi', ad: 'Eski', veritabani: 'x', ortam: null };
    const { user } = await setup({ history: [entry('r1', { hedef: gone, script: 'SELECT 7' })] });
    await toggle(user);
    await user.click(within(panel()).getByRole('radio', { name: 'Tüm hedefler' }));
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(rows()[0]).toHaveTextContent('Eski / x');
    rows()[0]!.focus();
    await user.keyboard('{Enter}');
    expect(within(strip()).getAllByRole('tab').map((t) => t.textContent)).toEqual(['Canlı / app', 'Hedefsiz']);
    expect(editorScript()).toBe('SELECT 7');
  });
});
