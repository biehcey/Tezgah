import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ApiError } from './api/client';
import { App } from './App';
import { connection, createFakeApi, createFakeConnections, renderWithApi } from './test/sahte-api';

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
