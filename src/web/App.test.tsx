import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ApiError } from './api/client';
import { App } from './App';
import { createFakeApi, renderWithApi } from './test/sahte-api';

describe('App', () => {
  it('boş Tezgah arayüzünü ve sürümü gösterir', async () => {
    renderWithApi(<App />, createFakeApi({ status: async () => ({ uygulama: 'tezgah', surum: '1.2.3' }) }));
    expect(screen.getByRole('heading', { name: 'Tezgah' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Bağlantılar' })).toBeInTheDocument();
    expect(await screen.findByText('v1.2.3')).toBeInTheDocument();
  });

  it('oturum geçersizse terminaldeki URL\'in yeniden açılmasını söyler', async () => {
    renderWithApi(<App />, createFakeApi({ status: () => Promise.reject(new ApiError(401)) }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Terminaldeki adresi yeniden açın/);
  });
});
