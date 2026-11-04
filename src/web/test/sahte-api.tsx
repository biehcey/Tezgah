import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { ApiProvider, type ApiClient } from '../api/client';

/** Testlerde gerçek sunucu yerine kullanılan API istemcisi; verilmeyen işlemler hata fırlatır. */
export function createFakeApi(overrides: Partial<ApiClient> = {}): ApiClient {
  const missing = (name: string) => () => Promise.reject(new Error(`Sahte API: ${name} tanımlı değil`));
  return {
    status: missing('status'),
    ...overrides,
  };
}

export function renderWithApi(ui: ReactElement, api: ApiClient = createFakeApi()) {
  return render(<ApiProvider client={api}>{ui}</ApiProvider>);
}
