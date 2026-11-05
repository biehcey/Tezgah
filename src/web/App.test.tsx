import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ApiError } from './api/client';
import { App } from './App';
import { editorScript, setEditorScript } from './test/eylemler';
import { connection, createFakeApi, createFakeConnections, createFakeScriptRuns, renderWithApi } from './test/sahte-api';

describe('App', () => {
  it('boş Tezgah arayüzünü ve sürümü gösterir', async () => {
    renderWithApi(
      <App />,
      createFakeApi({
        status: async () => ({ uygulama: 'tezgah', surum: '1.2.3' }),
        listConnections: async () => [],
        listFolders: async () => [],
      }),
    );
    expect(screen.getByRole('heading', { name: 'Tezgah' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Bağlantılar' })).toBeInTheDocument();
    expect(await screen.findByText('v1.2.3')).toBeInTheDocument();
  });

  it('oturum geçersizse terminaldeki URL\'in yeniden açılmasını söyler', async () => {
    const unauthorized = () => Promise.reject(new ApiError(401));
    renderWithApi(<App />, createFakeApi({ status: unauthorized, listConnections: unauthorized, listFolders: unauthorized }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Terminaldeki adresi yeniden açın/);
  });
});

describe('App: bağlantı formu script ekranını kapatmaz', () => {
  async function setup() {
    const user = userEvent.setup();
    const runs = createFakeScriptRuns();
    const fake = createFakeConnections([connection({ databaseSelection: [{ database: 'postgres', schemas: null }] })]);
    fake.api.runScript = runs.runScript;
    renderWithApi(<App />, fake.api);
    await screen.findByText('Yerel', { selector: '.baglanti-adi' });
    await user.keyboard('{Control>}k{/Control}');
    await user.keyboard('{Enter}');
    const toggleForm = async () => {
      await user.click(screen.getByRole('button', { name: 'Yeni bağlantı' }));
      expect(screen.queryByRole('region', { name: 'Hedef' })).not.toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'İptal' }));
    };
    return { user, runs, toggleForm };
  }

  it('form açılıp kapanınca editördeki script korunur', async () => {
    const { toggleForm } = await setup();
    setEditorScript('SELECT 42');
    await toggleForm();
    expect(editorScript()).toBe('SELECT 42');
  });

  it('karar beklenirken form açılırsa transaction geri alınmaz; dönünce karar kartı yerinde', async () => {
    const { user, runs, toggleForm } = await setup();
    setEditorScript('INSERT INTO t VALUES (1)');
    await user.click(screen.getByRole('button', { name: '▶ Çalıştır' }));
    runs.last().emit({ type: 'done', i: 0, rowCount: 1, ms: 1, komut: 'INSERT' }, { type: 'kararBekleniyor', commitEdilebilir: true, kalanMs: 1_800_000 });
    await toggleForm();
    expect(runs.last().closed).toBe(false);
    expect(within(screen.getByRole('region', { name: 'Karar' })).getByRole('button', { name: 'Commit' })).toBeEnabled();
  });
});

describe('App: prod yazma kilidi', () => {
  it('bağlantı formu açılıp kapanınca hedefin yazma modu korunur', async () => {
    const user = userEvent.setup();
    const fake = createFakeConnections([
      connection({ id: 'p1', name: 'Canlı', envTag: 'prod', color: '#dc2626', databaseSelection: [{ database: 'app', schemas: null }] }),
    ]);
    renderWithApi(<App />, fake.api);
    await screen.findByText('Canlı', { selector: '.baglanti-adi' });
    await user.keyboard('{Control>}k{/Control}');
    await user.keyboard('{Enter}');
    const lockButton = () => screen.getByRole('button', { name: /Salt okunur|Yazma açık/ });
    await user.click(lockButton());
    expect(lockButton()).toHaveTextContent('🔓 Yazma açık');

    await user.click(screen.getByRole('button', { name: 'Yeni bağlantı' }));
    await user.click(screen.getByRole('button', { name: 'İptal' }));
    expect(lockButton()).toHaveTextContent('🔓 Yazma açık');
  });
});
