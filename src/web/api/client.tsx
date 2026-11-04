import { createContext, useContext, type ReactNode } from 'react';
import type { DeleteFolderResponse, Folder } from '../../core/ayarlar';
import type {
  Connection,
  ConnectionInput,
  DeleteConnectionResponse,
  PasswordStatusResponse,
  SaveConnectionResponse,
  ValidationErrorResponse,
} from '../../core/baglanti';

/**
 * Web'in sunucuyla tek konuşma noktası (REST + ileride WS olay akışı).
 * Bileşenler sunucuyu yalnızca bunun üzerinden görür; testlerde sahte implementasyon verilir.
 */
export interface ApiClient {
  status(): Promise<ServerStatus>;
  listConnections(): Promise<Connection[]>;
  createConnection(input: ConnectionRequest): Promise<SaveConnectionResponse>;
  updateConnection(id: string, input: ConnectionRequest): Promise<SaveConnectionResponse>;
  deleteConnection(id: string): Promise<DeleteConnectionResponse>;
  /** Hemen arkasına "ad (kopya)" oluşturur; kayıtlı şifre yeni kimlik altına kopyalanır. */
  copyConnection(id: string): Promise<SaveConnectionResponse>;
  /** Keychain'de kayıtlı şifre var mı; değer hiçbir zaman gelmez. */
  passwordStatus(id: string): Promise<PasswordStatusResponse>;
  listFolders(): Promise<Folder[]>;
  createFolder(name: string): Promise<Folder>;
  renameFolder(id: string, name: string): Promise<Folder>;
  /** İçindeki bağlantılar Klasörsüz'e taşınır. */
  deleteFolder(id: string): Promise<DeleteFolderResponse>;
}

/** Oluşturma/güncelleme gövdesi; `password` verilmezse kayıtlı şifreye dokunulmaz, boş dize siler. */
export type ConnectionRequest = Omit<ConnectionInput, 'password'> & { password?: string };

/** Kayıtlı bağlantının alanlarıyla güncelleme gövdesi; şifreye dokunmaz. */
export function connectionRequest({ id: _id, databaseSelection: _selection, ...fields }: Connection): ConnectionRequest {
  return fields;
}

export interface ServerStatus {
  uygulama: 'tezgah';
  surum: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    /** Sunucunun JSON hata gövdesi (`hata`, doğrulamada `alanlar`). */
    readonly body?: Partial<ValidationErrorResponse>,
  ) {
    super(body?.hata ?? `Sunucu ${status} döndü`);
    this.name = 'ApiError';
  }
}

/** Gerçek istemci: erişim cookie'si tarayıcıda olduğundan istekler aynı origin'e gider. */
export function createHttpApiClient(): ApiClient {
  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(path, { credentials: 'same-origin', ...init });
    if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => undefined));
    return (await res.json()) as T;
  }
  const send = <T,>(method: string, path: string, body?: unknown) =>
    request<T>(path, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const connectionUrl = (id: string) => `/api/baglantilar/${encodeURIComponent(id)}`;
  const folderUrl = (id: string) => `/api/klasorler/${encodeURIComponent(id)}`;
  return {
    status: () => request<ServerStatus>('/api/durum'),
    listConnections: () => request<Connection[]>('/api/baglantilar'),
    createConnection: (input) => send('POST', '/api/baglantilar', input),
    updateConnection: (id, input) => send('PUT', connectionUrl(id), input),
    deleteConnection: (id) => send('DELETE', connectionUrl(id)),
    copyConnection: (id) => send('POST', `${connectionUrl(id)}/kopya`),
    passwordStatus: (id) => request(`${connectionUrl(id)}/sifre`),
    listFolders: () => request<Folder[]>('/api/klasorler'),
    createFolder: (name) => send('POST', '/api/klasorler', { name }),
    renameFolder: (id, name) => send('PUT', folderUrl(id), { name }),
    deleteFolder: (id) => send('DELETE', folderUrl(id)),
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
