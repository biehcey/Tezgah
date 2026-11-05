import { act, render } from '@testing-library/react';
import type { ServerEvent } from '../../core/script-calistirma';
import type { Target } from '../../core/veritabani-secimi';
import type { ReactElement } from 'react';
import { deleteFolder, parseFolderName, type Folder } from '../../core/ayarlar';
import {
  DEFAULT_SSL,
  copyConnection,
  newConnection,
  passwordAction,
  type Connection,
  type DatabaseSelection,
  type PasswordStatus,
  type PasswordWriteOutcome,
} from '../../core/baglanti';
import { ApiError, ApiProvider, type ApiClient, type ConnectionRequest } from '../api/client';

/** Testlerde gerçek sunucu yerine kullanılan API istemcisi; verilmeyen işlemler hata fırlatır. */
export function createFakeApi(overrides: Partial<ApiClient> = {}): ApiClient {
  const missing = (name: string) => () => Promise.reject(new Error(`Sahte API: ${name} tanımlı değil`));
  return {
    status: missing('status'),
    listConnections: missing('listConnections'),
    createConnection: missing('createConnection'),
    updateConnection: missing('updateConnection'),
    deleteConnection: missing('deleteConnection'),
    copyConnection: missing('copyConnection'),
    passwordStatus: missing('passwordStatus'),
    giveSessionPassword: missing('giveSessionPassword'),
    testConnection: missing('testConnection'),
    listFolders: missing('listFolders'),
    createFolder: missing('createFolder'),
    renameFolder: missing('renameFolder'),
    deleteFolder: missing('deleteFolder'),
    listDatabases: missing('listDatabases'),
    listSchemas: missing('listSchemas'),
    updateDatabaseSelection: missing('updateDatabaseSelection'),
    disconnect: missing('disconnect'),
    openRunHistoryFolder: missing('openRunHistoryFolder'),
    runScript: () => {
      throw new Error('Sahte API: runScript tanımlı değil');
    },
    ...overrides,
  };
}

/** Sahte çalıştırma: testler sunucu olaylarını elle gönderir, istemcinin isteklerini okur. */
export interface FakeRun {
  target: Target;
  script: string;
  /** İstemcinin gönderdiği istekler (`commit`, `rollback`, `iptal`). */
  sent: string[];
  closed: boolean;
  emit(...events: ServerEvent[]): void;
}

export function createFakeScriptRuns() {
  const runs: FakeRun[] = [];
  const runScript: ApiClient['runScript'] = (target, script, onEvent) => {
    const run: FakeRun = {
      target,
      script,
      sent: [],
      closed: false,
      emit: (...events) => act(() => events.forEach(onEvent)),
    };
    runs.push(run);
    return {
      send: (message) => run.sent.push(message.type),
      close: () => (run.closed = true),
    };
  };
  return { runs, runScript, last: () => runs.at(-1)! };
}

export function renderWithApi(ui: ReactElement, api: ApiClient = createFakeApi()) {
  return render(<ApiProvider client={api}>{ui}</ApiProvider>);
}

export function connection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: 'b1',
    name: 'Yerel',
    folderId: null,
    host: 'localhost',
    port: 5432,
    user: 'postgres',
    database: 'postgres',
    envTag: null,
    color: null,
    savePassword: true,
    ...DEFAULT_SSL,
    databaseSelection: [{ database: 'postgres', schemas: null }],
    ...overrides,
  };
}

export interface FakeConnections {
  api: ApiClient;
  connections: Connection[];
  folders: Folder[];
  /** Keychain'deki şifreler (bağlantı kimliği → değer). */
  passwords: Map<string, string>;
  /** Kaydet/güncelle/sil isteklerinin gövdeleri, sırasıyla. */
  requests: { method: string; id?: string; body?: ConnectionRequest | { name: string } | DatabaseSelection[] }[];
  /** Açıkken keychain işlemleri "Deny" ile reddedilmiş gibi döner. */
  deny: boolean;
  /**
   * Bağlantı kimliğine göre sunucudaki veritabanları ve şemaları. Tanımlı olmayan bağlantının
   * sunucusuna ulaşılamaz (502).
   */
  servers: Map<string, FakeServer>;
  /** Veritabanı paneli istekleri (`listele`, `semalar/<db>`, `kes`), bağlantı kimliğiyle. */
  databaseRequests: string[];
  /** Sunucunun bellekteki oturumluk şifreleri (bağlantı kimliği → şifre). */
  sessionPasswords: Map<string, string>;
}

export interface FakeServer {
  /** Veritabanı → şemalar. */
  databases: Record<string, string[]>;
  /** Verilirse sunucu şifre ister; keychain'e kaydedilmeyen bağlantıda oturumluk şifreyle karşılaştırılır. */
  password?: string;
}

export const PASSWORD_REQUIRED = new ApiError(502, { hata: 'Sunucu şifre istedi ama şifre girilmedi.', kod: 'sifreGerekli' });
export const PASSWORD_REJECTED = new ApiError(502, {
  hata: 'Şifre kabul edilmedi: password authentication failed for user "postgres"',
  kod: '28P01',
});

export const UNREACHABLE = new ApiError(502, {
  hata: 'localhost:5432 bağlantıyı reddetti; bu portta dinleyen bir sunucu yok.',
  kod: 'ECONNREFUSED',
});

export function folder(id: string, name: string): Folder {
  return { id, name };
}

/** Bağlantı ve klasör uçlarını bellekte, sunucunun sözleşmesiyle taklit eden sahte API. */
export function createFakeConnections(
  initial: Connection[] = [],
  overrides: Partial<ApiClient> = {},
  folders: Folder[] = [],
): FakeConnections {
  const state: FakeConnections = {
    connections: [...initial],
    folders: [...folders],
    passwords: new Map(),
    requests: [],
    deny: false,
    servers: new Map(),
    databaseRequests: [],
    sessionPasswords: new Map(),
    api: undefined as unknown as ApiClient,
  };
  let next = 1;

  const writePassword = (id: string, body: ConnectionRequest, isNew: boolean): PasswordWriteOutcome => {
    const action = passwordAction({ savePassword: body.savePassword, password: body.password }, { isNew });
    if (action === 'dokunma') return 'degismedi';
    if (state.deny) return 'reddedildi';
    if (action === 'sil') return state.passwords.delete(id) ? 'silindi' : 'degismedi';
    state.passwords.set(id, body.password!);
    return 'kaydedildi';
  };
  const fieldsOf = ({ password, ...rest }: ConnectionRequest) => rest;
  const find = (id: string) => {
    const found = state.connections.find((c) => c.id === id);
    if (!found) throw new ApiError(404, { hata: 'Bağlantı bulunamadı' });
    return found;
  };
  /** Sunucunun bağlanırken yaptığı şifre denetimi; `28P01`'de oturumluk şifre unutulur. */
  const authenticate = (connection: Connection, server: FakeServer) => {
    if (server.password === undefined) return;
    const offered = connection.savePassword ? state.passwords.get(connection.id) : state.sessionPasswords.get(connection.id);
    if (offered === undefined) throw PASSWORD_REQUIRED;
    if (offered !== server.password) {
      if (!connection.savePassword) state.sessionPasswords.delete(connection.id);
      throw PASSWORD_REJECTED;
    }
  };

  state.api = createFakeApi({
    status: async () => ({ uygulama: 'tezgah', surum: '0.0.0' }),
    listConnections: async () => structuredClone(state.connections),
    async createConnection(body) {
      state.requests.push({ method: 'POST', body });
      const created = newConnection(`yeni-${next++}`, { ...body, password: body.password });
      state.connections.push(created);
      return { connection: structuredClone(created), password: writePassword(created.id, body, true) };
    },
    async updateConnection(id, body) {
      state.requests.push({ method: 'PUT', id, body });
      const existing = find(id);
      if (body.folderId !== null && !state.folders.some((f) => f.id === body.folderId)) {
        throw new ApiError(400, { hata: 'Geçersiz bağlantı', alanlar: { folderId: 'Klasör bulunamadı' } });
      }
      const updated = { ...existing, ...fieldsOf(body) };
      state.connections = state.connections.map((c) => (c.id === id ? updated : c));
      return { connection: structuredClone(updated), password: writePassword(id, body, false) };
    },
    async deleteConnection(id) {
      state.requests.push({ method: 'DELETE', id });
      find(id);
      state.connections = state.connections.filter((c) => c.id !== id);
      if (state.deny) return { password: 'reddedildi' };
      return { password: state.passwords.delete(id) ? 'silindi' : 'yok' };
    },
    async copyConnection(id) {
      state.requests.push({ method: 'POST', id: `${id}/kopya` });
      const source = find(id);
      const copy = copyConnection(source, `kopya-${next++}`, state.connections.map((c) => c.name));
      state.connections.splice(state.connections.indexOf(source) + 1, 0, copy);
      const stored = state.passwords.get(id);
      let password: PasswordWriteOutcome = 'degismedi';
      if (copy.savePassword && (state.deny || stored !== undefined)) {
        if (state.deny) password = 'reddedildi';
        else {
          state.passwords.set(copy.id, stored!);
          password = 'kaydedildi';
        }
      }
      return { connection: structuredClone(copy), password };
    },
    listFolders: async () => structuredClone(state.folders),
    async createFolder(name) {
      state.requests.push({ method: 'POST', id: 'klasor', body: { name } });
      const parsed = parseFolderName({ name }, state.folders);
      if (!parsed.ok) throw new ApiError(400, { hata: parsed.error });
      const created = { id: `klasor-${next++}`, name: parsed.name };
      state.folders.push(created);
      return { ...created };
    },
    async renameFolder(id, name) {
      state.requests.push({ method: 'PUT', id: `klasor/${id}`, body: { name } });
      const target = state.folders.find((f) => f.id === id);
      if (!target) throw new ApiError(404, { hata: 'Klasör bulunamadı' });
      const parsed = parseFolderName({ name }, state.folders, id);
      if (!parsed.ok) throw new ApiError(400, { hata: parsed.error });
      target.name = parsed.name;
      return { ...target };
    },
    async deleteFolder(id) {
      state.requests.push({ method: 'DELETE', id: `klasor/${id}` });
      if (!state.folders.some((f) => f.id === id)) throw new ApiError(404, { hata: 'Klasör bulunamadı' });
      return { tasinan: deleteFolder(state, id) };
    },
    async listDatabases(id) {
      const found = find(id);
      state.databaseRequests.push(`${id}: listele`);
      const server = state.servers.get(id);
      if (!server) throw UNREACHABLE;
      authenticate(found, server);
      return { veritabanlari: Object.keys(server.databases).sort() };
    },
    async listSchemas(id, database) {
      const found = find(id);
      state.databaseRequests.push(`${id}: semalar/${database}`);
      const server = state.servers.get(id);
      const schemas = server?.databases[database];
      if (!server || !schemas) throw UNREACHABLE;
      authenticate(found, server);
      return { semalar: [...schemas].sort() };
    },
    async updateDatabaseSelection(id, selection) {
      state.requests.push({ method: 'PUT', id: `${id}/veritabani-secimi`, body: structuredClone(selection) });
      const target = find(id);
      target.databaseSelection = structuredClone(selection);
      return structuredClone(target);
    },
    async disconnect(id) {
      find(id);
      state.databaseRequests.push(`${id}: kes`);
    },
    async giveSessionPassword(id, { password, saveToKeychain }) {
      state.requests.push({ method: 'POST', id: `${id}/oturum-sifresi` });
      const found = find(id);
      if (saveToKeychain && !state.deny) {
        state.passwords.set(id, password);
        found.savePassword = true;
        state.sessionPasswords.delete(id);
        return { connection: structuredClone(found), password: 'kaydedildi' };
      }
      state.sessionPasswords.set(id, password);
      return { connection: structuredClone(found), password: saveToKeychain ? 'reddedildi' : 'oturumda' };
    },
    async passwordStatus(id) {
      find(id);
      const password: PasswordStatus = state.deny ? 'reddedildi' : state.passwords.has(id) ? 'bulundu' : 'yok';
      return { password };
    },
    ...overrides,
  });
  return state;
}
