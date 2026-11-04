import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Settings } from '../core/ayarlar';
import {
  copyConnection,
  newConnection,
  parseConnectionInput,
  parseSessionPasswordInput,
  passwordAction,
  type Connection,
  type ConnectionInput,
  type DeleteConnectionResponse,
  type PasswordStatusResponse,
  type SaveConnectionResponse,
  type SessionPasswordResponse,
  type ValidationErrorResponse,
} from '../core/baglanti';
import { changesServerSession } from '../core/veritabani-secimi';
import type { SettingsStore } from './ayar-deposu';
import { json, methodNotAllowed, notFound as notFoundWith, readJson } from './http';
import { passwordAccount, type Keychain, type SecretDelete, type SecretRead, type SecretWrite } from './keychain';
import type { SessionPasswords } from './oturum-sifreleri';

export interface ConnectionDeps {
  store: SettingsStore;
  keychain: Keychain;
  sessionPasswords: SessionPasswords;
  log: (line: string) => void;
  /** Bağlantının sunucuya bağlanma ayarı ya da şifresi değişti, ya da bağlantı silindi. */
  onChanged?: (id: string) => void;
}

const COLLECTION = '/api/baglantilar';

/** `/api/baglantilar` uçları. İsteği ele aldıysa `true` döner. */
export function createConnectionRoutes({ store, keychain, sessionPasswords, log, onChanged }: ConnectionDeps) {
  async function create(req: IncomingMessage, res: ServerResponse) {
    const parsed = parseConnectionInput(await readJson(req));
    if (!parsed.ok) return invalid(res, parsed.errors);
    const connection = newConnection(randomUUID(), parsed.value);
    const outcome = await store.update((settings) => {
      if (!folderExists(settings, connection.folderId)) return 'klasor-yok' as const;
      settings.connections.push(connection);
      return 'tamam' as const;
    });
    if (outcome === 'klasor-yok') return invalid(res, { folderId: 'Klasör bulunamadı' });
    const body: SaveConnectionResponse = {
      connection,
      password: await writePassword(connection.id, parsed.value, { isNew: true }),
    };
    json(res, 201, body);
  }

  async function update(req: IncomingMessage, res: ServerResponse, id: string) {
    const parsed = parseConnectionInput(await readJson(req));
    if (!parsed.ok) return invalid(res, parsed.errors);
    const { password, ...fields } = parsed.value;
    const outcome = await store.update((settings) => {
      const index = settings.connections.findIndex((c) => c.id === id);
      const existing = settings.connections[index];
      if (!existing) return { status: 'yok' as const };
      if (!folderExists(settings, fields.folderId)) return { status: 'klasor-yok' as const };
      const connection: Connection = { ...existing, ...fields };
      settings.connections[index] = connection;
      return { status: 'tamam' as const, connection, changed: changesServerSession(existing, connection) };
    });
    if (outcome.status === 'yok') return notFound(res);
    if (outcome.status === 'klasor-yok') return invalid(res, { folderId: 'Klasör bulunamadı' });
    const passwordOutcome = await writePassword(id, parsed.value, { isNew: false });
    // Şifre yazıldıktan sonra: arada açılan pool eski şifreyle kalmasın.
    if (outcome.changed || passwordOutcome === 'kaydedildi' || passwordOutcome === 'silindi') onChanged?.(id);
    const body: SaveConnectionResponse = { connection: outcome.connection, password: passwordOutcome };
    json(res, 200, body);
  }

  async function remove(res: ServerResponse, id: string) {
    const removed = await store.update((settings) => {
      const before = settings.connections.length;
      settings.connections = settings.connections.filter((c) => c.id !== id);
      return settings.connections.length < before;
    });
    if (!removed) return notFound(res);
    sessionPasswords.forget(id);
    onChanged?.(id);
    // Ayar silindikten sonra keychain: erişim reddedilse de bağlantı silinmiş kalır, sonuç bildirilir.
    const result = await keychain.delete(passwordAccount(id));
    logDenied('silme', id, result);
    const body: DeleteConnectionResponse = { password: result.result };
    json(res, 200, body);
  }

  /** Kopya kaynağın hemen arkasına eklenir; kayıtlı şifre yeni kimlik altına kopyalanır. */
  async function copy(res: ServerResponse, id: string) {
    const copied = await store.update((settings) => {
      const index = settings.connections.findIndex((c) => c.id === id);
      const source = settings.connections[index];
      if (!source) return null;
      const connection = copyConnection(source, randomUUID(), settings.connections.map((c) => c.name));
      settings.connections.splice(index + 1, 0, connection);
      return connection;
    });
    if (!copied) return notFound(res);
    const body: SaveConnectionResponse = { connection: copied, password: await copyPassword(id, copied) };
    json(res, 201, body);
  }

  async function copyPassword(sourceId: string, copy: Connection): Promise<SaveConnectionResponse['password']> {
    if (!copy.savePassword) return 'degismedi';
    const read = await keychain.get(passwordAccount(sourceId));
    logDenied('okuma', sourceId, read);
    if (read.result === 'yok') return 'degismedi';
    if (read.result === 'reddedildi') return 'reddedildi';
    const written = await keychain.set(passwordAccount(copy.id), read.value);
    logDenied('yazma', copy.id, written);
    return written.result;
  }

  async function passwordStatus(res: ServerResponse, id: string) {
    const { connections } = await store.read();
    if (!connections.some((c) => c.id === id)) return notFound(res);
    const result = await keychain.get(passwordAccount(id));
    logDenied('okuma', id, result);
    const body: PasswordStatusResponse = { password: result.result };
    json(res, 200, body);
  }

  /**
   * Şifre penceresinden gelen şifre. Varsayılan: yalnızca bellekte. "Keychain'e kaydet" seçildiyse
   * keychain'e yazılır ve bağlantı ayarı değişir; keychain reddederse şifre bellekte kalır, ayar değişmez.
   */
  async function giveSessionPassword(req: IncomingMessage, res: ServerResponse, id: string) {
    const parsed = parseSessionPasswordInput(await readJson(req));
    if (!parsed.ok) return json(res, 400, { hata: parsed.error });
    let connection = (await store.read()).connections.find((c) => c.id === id);
    if (!connection) return notFound(res);
    const { password, saveToKeychain } = parsed.value;
    let outcome: SessionPasswordResponse['password'] = 'oturumda';
    if (saveToKeychain) {
      const written = await keychain.set(passwordAccount(id), password);
      logDenied('yazma', id, written);
      outcome = written.result;
    }
    if (outcome === 'kaydedildi') {
      const updated = await store.update((settings) => {
        const found = settings.connections.find((c) => c.id === id);
        if (found) found.savePassword = true;
        return found;
      });
      if (!updated) return notFound(res);
      connection = updated;
      sessionPasswords.forget(id);
    } else {
      sessionPasswords.remember(id, password);
    }
    // Açık pool'lar eski (reddedilen) şifreyle kalmasın.
    onChanged?.(id);
    const body: SessionPasswordResponse = { connection, password: outcome };
    json(res, 200, body);
  }

  async function writePassword(
    id: string,
    input: Pick<ConnectionInput, 'savePassword' | 'password'>,
    { isNew }: { isNew: boolean },
  ): Promise<SaveConnectionResponse['password']> {
    const account = passwordAccount(id);
    switch (passwordAction(input, { isNew })) {
      case 'dokunma':
        return 'degismedi';
      case 'sil': {
        const result = await keychain.delete(account);
        logDenied('silme', id, result);
        return result.result === 'yok' ? 'degismedi' : result.result;
      }
      case 'yaz': {
        const result = await keychain.set(account, input.password!);
        logDenied('yazma', id, result);
        return result.result;
      }
    }
  }

  /** Reddin nedeni (kilitli depo, iptal edilen istem…) yalnızca terminale yazılır; sır asla. */
  function logDenied(operation: string, id: string, result: SecretRead | SecretWrite | SecretDelete) {
    if (result.result === 'reddedildi') log(`Keychain ${operation} reddedildi (${id}): ${result.message}`);
  }

  return async function handle(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<boolean> {
    if (pathname === COLLECTION) {
      if (req.method === 'GET') json(res, 200, (await store.read()).connections);
      else if (req.method === 'POST') await create(req, res);
      else methodNotAllowed(res);
      return true;
    }
    const match = /^\/api\/baglantilar\/([^/]+)(?:\/(sifre|kopya|oturum-sifresi))?$/.exec(pathname);
    if (!match) return false;
    const id = decodeURIComponent(match[1]!);
    if (match[2] === 'sifre') {
      if (req.method === 'GET') await passwordStatus(res, id);
      else methodNotAllowed(res);
    } else if (match[2] === 'oturum-sifresi') {
      if (req.method === 'POST') await giveSessionPassword(req, res, id);
      else methodNotAllowed(res);
    } else if (match[2] === 'kopya') {
      if (req.method === 'POST') await copy(res, id);
      else methodNotAllowed(res);
    } else if (req.method === 'PUT') await update(req, res, id);
    else if (req.method === 'DELETE') await remove(res, id);
    else methodNotAllowed(res);
    return true;
  };
}

function folderExists(settings: Settings, folderId: string | null) {
  return folderId === null || settings.folders.some((f) => f.id === folderId);
}

function notFound(res: ServerResponse) {
  notFoundWith(res, 'Bağlantı bulunamadı');
}

function invalid(res: ServerResponse, alanlar: ValidationErrorResponse['alanlar']) {
  const body: ValidationErrorResponse = { hata: 'Geçersiz bağlantı', alanlar };
  json(res, 400, body);
}
