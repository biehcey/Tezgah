import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Connection } from '../core/baglanti';
import { classifyListError, toDriverError } from '../core/baglanti-testi';
import {
  parseDatabaseSelection,
  type DatabaseListResponse,
  type SchemaListResponse,
  type TargetErrorResponse,
} from '../core/veritabani-secimi';
import type { SettingsStore } from './ayar-deposu';
import { TargetError, type PoolManager } from './havuzlar';
import { json, methodNotAllowed, notFound, readJson } from './http';

export interface DatabaseRouteDeps {
  store: SettingsStore;
  pools: PoolManager;
}

const PATH = /^\/api\/baglantilar\/([^/]+)\/(?:(veritabanlari)(?:\/([^/]+)\/(semalar))?|(veritabani-secimi|baglantiyi-kes))$/;

/**
 * Veritabanı paneli uçları: veritabanı ve şema listesi (hedefin pool'u üzerinden), Veritabanı
 * seçimini güncelleme ve bağlantıyı kesme. İsteği ele aldıysa `true` döner.
 */
export function createDatabaseRoutes({ store, pools }: DatabaseRouteDeps) {
  async function find(id: string): Promise<Connection | undefined> {
    return (await store.read()).connections.find((c) => c.id === id);
  }

  /** Hedefte ad listesi sorgusu; bağlanılamazsa ya da sorgu düşerse 502 yanıtını yazar ve `null` döner. */
  async function queryNamesOr502(res: ServerResponse, connection: Connection, database: string, sql: string): Promise<string[] | null> {
    try {
      return await pools.withClient(connection, database, async (client) => {
        try {
          return (await client.query<{ ad: string }>(sql)).rows.map((r) => r.ad);
        } catch (err) {
          throw new TargetError(classifyListError(toDriverError(err)));
        }
      });
    } catch (err) {
      if (!(err instanceof TargetError)) throw err;
      const body: TargetErrorResponse = { hata: err.failure.mesaj, kod: err.failure.kod };
      json(res, 502, body);
      return null;
    }
  }

  async function databases(res: ServerResponse, connection: Connection) {
    const names = await queryNamesOr502(
      res,
      connection,
      connection.database,
      'SELECT datname AS ad FROM pg_catalog.pg_database WHERE NOT datistemplate ORDER BY datname',
    );
    if (names === null) return;
    const body: DatabaseListResponse = { veritabanlari: names };
    json(res, 200, body);
  }

  async function schemas(res: ServerResponse, connection: Connection, database: string) {
    const names = await queryNamesOr502(
      res,
      connection,
      database,
      `SELECT nspname AS ad FROM pg_catalog.pg_namespace
        WHERE nspname !~ '^pg_(toast_)?temp_' ORDER BY nspname`,
    );
    if (names === null) return;
    const body: SchemaListResponse = { semalar: names };
    json(res, 200, body);
  }

  async function updateSelection(req: IncomingMessage, res: ServerResponse, id: string) {
    const parsed = parseDatabaseSelection(await readJson(req));
    if (!parsed.ok) return json(res, 400, { hata: parsed.error });
    const updated = await store.update((settings) => {
      const connection = settings.connections.find((c) => c.id === id);
      if (connection) connection.databaseSelection = parsed.value;
      return connection;
    });
    if (!updated) return notFound(res, 'Bağlantı bulunamadı');
    json(res, 200, updated);
  }

  return async function handle(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<boolean> {
    const match = PATH.exec(pathname);
    if (!match) return false;
    const [, rawId, list, rawDatabase, sub, other] = match;
    const action = list ?? other!;
    const id = decodeURIComponent(rawId!);
    const expected = action === 'veritabanlari' ? 'GET' : action === 'veritabani-secimi' ? 'PUT' : 'POST';
    if (req.method !== expected) {
      methodNotAllowed(res);
      return true;
    }
    if (action === 'veritabani-secimi') {
      await updateSelection(req, res, id);
      return true;
    }
    const connection = await find(id);
    if (!connection) {
      notFound(res, 'Bağlantı bulunamadı');
      return true;
    }
    if (action === 'baglantiyi-kes') {
      await pools.disconnect(id);
      json(res, 200, {});
    } else if (sub === 'semalar') await schemas(res, connection, decodeURIComponent(rawDatabase!));
    else await databases(res, connection);
    return true;
  };
}
