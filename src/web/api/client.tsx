import { createContext, useContext, type ReactNode } from 'react';
import type { DeleteFolderResponse, Folder } from '../../core/ayarlar';
import type {
  Connection,
  ConnectionInput,
  DatabaseSelection,
  DeleteConnectionResponse,
  PasswordStatusResponse,
  SaveConnectionResponse,
  SessionPasswordRequest,
  SessionPasswordResponse,
  SshSettings,
  ValidationErrorResponse,
} from '../../core/baglanti';
import type { ConnectionTestRequest, ConnectionTestResponse } from '../../core/baglanti-testi';
import { historySearchParams, type HistoryPage, type HistoryQuery } from '../../core/gecmis-filtresi';
import type { SavedTabs } from '../../core/konsol-sekmeleri';
import type { ImportApplyRequest, ImportApplyResponse, ImportPreviewRequest, ImportPreviewResponse } from '../../core/ice-aktarma/sozlesme';
import type { HostKeyForgetRequest, HostKeyForgetResponse, HostKeyTrustRequest, HostKeyTrustResponse } from '../../core/ssh-tuneli';
import type { ClientMessage, ServerEvent } from '../../core/script-calistirma';
import type { DatabaseListResponse, SchemaListResponse, TargetErrorResponse } from '../../core/veritabani-secimi';

/**
 * Web'in sunucuyla tek konuşma noktası (REST + WS olay akışı).
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
  /** Şifre penceresinden: Tezgah kapanana kadar bellekte; istenirse keychain'e (bağlantı ayarı değişir). */
  giveSessionPassword(id: string, input: SessionPasswordRequest): Promise<SessionPasswordResponse>;
  /** Formdaki kaydedilmemiş değerlerle bağlantıyı adım adım sınar; hiçbir şey kaydetmez. */
  testConnection(input: ConnectionTestBody): Promise<ConnectionTestResponse>;
  /** "Güven ve tekrar dene": host anahtarını Tezgah'ın `known_hosts`'una yazar. */
  trustHostKey(input: HostKeyTrustRequest): Promise<HostKeyTrustResponse>;
  /** "Kayıtlı host anahtarını unut": yalnızca Tezgah'ın `known_hosts`'undan siler. */
  forgetHostKey(input: HostKeyForgetRequest): Promise<HostKeyForgetResponse>;
  listFolders(): Promise<Folder[]>;
  createFolder(name: string): Promise<Folder>;
  renameFolder(id: string, name: string): Promise<Folder>;
  /** İçindeki bağlantılar Klasörsüz'e taşınır. */
  deleteFolder(id: string): Promise<DeleteFolderResponse>;
  /** Başlangıç veritabanının pool'unu açar (gerekirse) ve `pg_database`'i listeler. */
  listDatabases(id: string): Promise<DatabaseListResponse>;
  /** Hedefin (bağlantı + veritabanı) pool'u üzerinden şemaları listeler. */
  listSchemas(id: string, database: string): Promise<SchemaListResponse>;
  updateDatabaseSelection(id: string, selection: DatabaseSelection[]): Promise<Connection>;
  /** Bağlantının tüm pool'larını kapatır. */
  disconnect(id: string): Promise<void>;
  /**
   * Script'i hedefte çalıştırır; olaylar `onEvent`'e sırayla gelir. Transaction bu çalıştırmaya
   * bağlıdır: `close` ya da sekmenin kapanması açık transaction'ı geri aldırır (ADR-0002).
   */
  runScript(request: ScriptRunRequest, onEvent: (event: ServerEvent) => void): ScriptRunHandle;
  /** Çalıştırma kayıtları klasörünü işletim sisteminin dosya yöneticisinde açar. */
  openRunHistoryFolder(): Promise<void>;
  /** Filtreye uyan Çalıştırma kayıtları, yeniden eskiye bir sayfa; yalnızca dosya okunur. */
  listRunHistory(query: HistoryQuery): Promise<HistoryPage>;
  /** İçe aktarma kaynaklarını (`.pgpass`) tarar; adaylar şifre değeri olmadan gelir. */
  previewImport(input: ImportPreviewRequest): Promise<ImportPreviewResponse>;
  /** Seçilen adayları ekler; şifreler sunucuda keychain'e kopyalanır. */
  applyImport(input: ImportApplyRequest): Promise<ImportApplyResponse>;
  /** Diskteki konsol sekmeleri; yalnızca dosya okunur, hiçbir sunucuya bağlanılmaz. */
  readTabs(): Promise<SavedTabs>;
  /**
   * Konsol sekmelerinin tümünü yazar; sunucu biçime göre süzüp yazılanı döndürür. `keepalive`:
   * sayfa kapanırken de gitsin (tarayıcı sınırı nedeniyle yalnızca küçük gövdelerde uygulanır).
   */
  writeTabs(tabs: SavedTabs, options?: { keepalive?: boolean }): Promise<SavedTabs>;
}

/** Çalıştırmanın hedefi, script'i ve (prod'da) yazma kilidi durumu. */
export type ScriptRunRequest = Omit<Extract<ClientMessage, { type: 'run' }>, 'type'>;

export interface ScriptRunHandle {
  send(message: Exclude<ClientMessage, { type: 'run' }>): void;
  close(): void;
}

/** Sunucuyla bağlantı `bitti` gelmeden koparsa arayüzün gördüğü son olay. */
export const CONNECTION_LOST: ServerEvent = {
  type: 'bitti',
  sonuc: 'hata',
  mesaj: 'Tezgah sunucusuyla bağlantı koptu; açık transaction sunucuda geri alındı.',
};

/**
 * Oluşturma/güncelleme gövdesi; `password`/`sshSecret` verilmezse kayıtlı sırra dokunulmaz, boş dize
 * siler. `ssh` verilmezse tünel yok.
 */
export type ConnectionRequest = Omit<ConnectionInput, 'password' | 'sshSecret' | 'ssh'> & {
  password?: string;
  sshSecret?: string;
  ssh?: SshSettings | null;
};

/** Test gövdesi; `password`/`sshSecret` verilmezse kayıtlı bağlantının keychain'deki sırrı kullanılır. */
export type ConnectionTestBody = Omit<ConnectionTestRequest, 'password' | 'sshSecret' | 'ssh'> & {
  password?: string;
  sshSecret?: string;
  ssh?: SshSettings | null;
};

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
    /** Sunucunun JSON hata gövdesi (`hata`, doğrulamada `alanlar`, hedef hatasında `kod`). */
    readonly body?: Partial<ValidationErrorResponse & TargetErrorResponse>,
  ) {
    super(body?.hata ?? `Sunucu ${status} döndü`);
    this.name = 'ApiError';
  }
}

/** `keepalive` gövdesi için karakter sınırı: UTF-8'de karakter başına 4 bayta kadar, 64 KiB altında. */
const KEEPALIVE_MAX_CHARS = 16 * 1024;

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
    giveSessionPassword: (id, input) => send('POST', `${connectionUrl(id)}/oturum-sifresi`, input),
    testConnection: (input) => send('POST', '/api/baglanti-testi', input),
    trustHostKey: (input) => send('POST', '/api/host-anahtarlari', input),
    forgetHostKey: (input) => send('POST', '/api/host-anahtarlari/unut', input),
    listFolders: () => request<Folder[]>('/api/klasorler'),
    createFolder: (name) => send('POST', '/api/klasorler', { name }),
    renameFolder: (id, name) => send('PUT', folderUrl(id), { name }),
    deleteFolder: (id) => send('DELETE', folderUrl(id)),
    listDatabases: (id) => request(`${connectionUrl(id)}/veritabanlari`),
    listSchemas: (id, database) => request(`${connectionUrl(id)}/veritabanlari/${encodeURIComponent(database)}/semalar`),
    updateDatabaseSelection: (id, selection) => send('PUT', `${connectionUrl(id)}/veritabani-secimi`, selection),
    disconnect: async (id) => {
      await send('POST', `${connectionUrl(id)}/baglantiyi-kes`);
    },
    runScript: (request, onEvent) => openScriptSocket(request, onEvent),
    openRunHistoryFolder: async () => {
      await send('POST', '/api/calistirma-kayitlari/klasoru-ac');
    },
    listRunHistory: (query) => request(`/api/calistirma-kayitlari?${new URLSearchParams(historySearchParams(query))}`),
    previewImport: (input) => send('POST', '/api/ice-aktarma/onizleme', input),
    applyImport: (input) => send('POST', '/api/ice-aktarma/uygula', input),
    readTabs: () => request<SavedTabs>('/api/konsol-sekmeleri'),
    writeTabs: (tabs, { keepalive = false } = {}) => {
      const body = JSON.stringify(tabs);
      return request<SavedTabs>('/api/konsol-sekmeleri', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body,
        // Tarayıcılar keepalive gövdesini 64 KiB ile sınırlar; büyük gövde normal istekle gider.
        keepalive: keepalive && body.length < KEEPALIVE_MAX_CHARS,
      });
    },
  };
}

/** Çalıştırma başına bir WebSocket; erişim cookie'si upgrade isteğinde gider. */
function openScriptSocket(request: ScriptRunRequest, onEvent: (event: ServerEvent) => void): ScriptRunHandle {
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${scheme}//${location.host}/ws`);
  let finished = false;
  /** Soket açılmadan istenenler (ör. hemen basılan İptal) açılınca `run`'dan sonra gider. */
  const queued: ClientMessage[] = [];
  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'run', ...request } satisfies ClientMessage));
    for (const message of queued.splice(0)) ws.send(JSON.stringify(message));
  };
  ws.onmessage = (message) => {
    const event = JSON.parse(String(message.data)) as ServerEvent;
    if (event.type === 'bitti') finished = true;
    onEvent(event);
    if (finished) ws.close();
  };
  ws.onclose = () => {
    if (finished) return;
    finished = true;
    onEvent(CONNECTION_LOST);
  };
  return {
    send: (message) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
      else if (ws.readyState === WebSocket.CONNECTING) queued.push(message);
    },
    close: () => {
      finished = true;
      ws.close();
    },
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
