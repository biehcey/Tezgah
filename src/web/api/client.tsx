import { createContext, useContext, type ReactNode } from 'react';

/**
 * Web'in sunucuyla tek konuşma noktası (REST + ileride WS olay akışı).
 * Bileşenler sunucuyu yalnızca bunun üzerinden görür; testlerde sahte implementasyon verilir.
 */
export interface ApiClient {
  status(): Promise<ServerStatus>;
}

export interface ServerStatus {
  uygulama: 'tezgah';
  surum: string;
}

export class ApiError extends Error {
  constructor(readonly status: number) {
    super(`Sunucu ${status} döndü`);
    this.name = 'ApiError';
  }
}

/** Gerçek istemci: erişim cookie'si tarayıcıda olduğundan istekler aynı origin'e gider. */
export function createHttpApiClient(): ApiClient {
  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(path, { credentials: 'same-origin', ...init });
    if (!res.ok) throw new ApiError(res.status);
    return (await res.json()) as T;
  }
  return {
    status: () => request<ServerStatus>('/api/durum'),
  };
}

const ApiContext = createContext<ApiClient | null>(null);

export function ApiProvider({ client, children }: { client: ApiClient; children: ReactNode }) {
  return <ApiContext.Provider value={client}>{children}</ApiContext.Provider>;
}

export function useApi(): ApiClient {
  const client = useContext(ApiContext);
  if (!client) throw new Error('useApi, ApiProvider içinde kullanılmalı');
  return client;
}
