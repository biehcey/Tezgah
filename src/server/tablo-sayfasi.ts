import pg from 'pg';
import type { Connection } from '../core/baglanti';
import {
  FilterError,
  filterErrorPosition,
  nextCursor,
  parseTablePageRequest,
  tablePageQuery,
  type PageQuery,
  type TableMeta,
  type TablePageError,
  type TablePageRequest,
  type TablePageResponse,
} from '../core/tablo-sayfasi';
import type { SettingsStore } from './ayar-deposu';
import { RAW_TYPES, targetPostRoute, targetQueryError, type PoolManager } from './havuzlar';
import { json, notFound, readJson } from './http';
import type { CatalogCache } from './katalog';

/** Sayfa kısa bir sorgu olmalı; uzarsa client bırakılır (pool'a dönmez). */
const TIMEOUT_MS = 30_000;

const ESTIMATE_SQL = `SELECT c.reltuples::text AS satir FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = $1 AND c.relname = $2`;

/**
 * Postgres'in kendi hatası (sorgu çalıştı ve reddedildi); bağlantı sağlam. Konum bir filtre
 * kutusuna düşüyorsa kutu ve kutudaki konum da döner. Tahmin sorgusunun hatasında kutu aranmaz.
 */
function serverError(err: unknown, query: PageQuery | null): TablePageError | null {
  if (!(err instanceof pg.DatabaseError) || err.code === undefined) return null;
  const konum = Number(err.position);
  const valid = Number.isInteger(konum) && konum > 0;
  const box = query && valid ? filterErrorPosition(query, konum) : null;
  return {
    hata: err.message,
    sqlstate: err.code,
    ...(valid && { konum }),
    ...(box && { kutu: box.kutu, kutuKonumu: box.konum }),
  };
}

/** Parametreli, tek ifade: extended protocol birden fazla ifadeyi reddeder. */
function extendedQuery(client: pg.ClientBase, text: string, values: unknown[]) {
  // `queryMode` ve `query_timeout` desteklenir ama @types/pg'de tanımlı değil.
  const config = { text, values, rowMode: 'array', types: RAW_TYPES, queryMode: 'extended', query_timeout: TIMEOUT_MS } as pg.QueryArrayConfig;
  return client.query(config);
}

type PageOutcome = { ok: true; page: TablePageResponse } | { ok: false; error: TablePageError };

/**
 * Bir sayfa: kısa süreli client (oturum sayılmaz), ortamdan bağımsız `BEGIN READ ONLY`, tek ifade,
 * `COMMIT`. Açık imleç ya da transaction tutulmaz; Çalıştırma kaydına yazılmaz.
 */
function readPage(pools: PoolManager, connection: Connection, database: string, meta: TableMeta & { uretilmis: string[] }, request: TablePageRequest, query: PageQuery) {
  return pools.withClient(connection, database, async (client, discard): Promise<PageOutcome> => {
    /** Hata sayfa sorgusundan mı geldi (konum kullanıcı kutusuna eşlenebilir). */
    let running: PageQuery | null = null;
    try {
      await client.query('BEGIN READ ONLY');
      const estimate = request.sonraki === null ? await extendedQuery(client, ESTIMATE_SQL, [meta.sema, meta.tablo]) : null;
      running = query;
      const result = await extendedQuery(client, query.text, query.values);
      running = null;
      await client.query('COMMIT');
      const satirlar = result.rows as (string | null)[][];
      const satir = estimate?.rows[0]?.[0];
      return {
        ok: true,
        page: {
          kolonlar: result.fields.map((f) => f.name),
          tipler: result.fields.map((f) => f.dataTypeID),
          pk: [...meta.pk],
          uretilmis: meta.uretilmis,
          satirlar,
          sonraki: nextCursor(meta, request.sonraki, satirlar, request),
          tutarlilikNotu: query.mod === 'offset',
          ...(estimate && { satirTahmini: satir == null ? -1 : Number(satir) }),
        },
      };
    } catch (err) {
      const error = serverError(err, running);
      if (error) {
        try {
          await client.query('ROLLBACK');
          return { ok: false, error };
        } catch {
          discard();
          return { ok: false, error };
        }
      }
      // Bağlantı ya da zaman aşımı: transaction açık kalmış olabilir, client pool'a dönmez.
      discard();
      throw targetQueryError(err, 'Tablo');
    }
  });
}

const PATH = /^\/api\/baglantilar\/([^/]+)\/veritabanlari\/([^/]+)\/tablo-sayfasi$/;

/** `POST …/veritabanlari/:db/tablo-sayfasi`: Tablo sekmesinin bir sayfası. Kolonlar ve PK katalogdan. */
export function createTablePageRoutes({ store, pools, catalogs }: { store: SettingsStore; pools: PoolManager; catalogs: CatalogCache }) {
  return targetPostRoute(store, PATH, async (req, res, connection, database) => {
    const request = parseTablePageRequest(await readJson(req));
    if (!request) return json(res, 400, { hata: 'Geçersiz tablo sayfası isteği' });
    const catalog = await catalogs.get(connection, database);
    const relation = catalog.iliskiler.find((r) => r.sema === request.sema && r.ad === request.tablo);
    if (!relation) {
      return notFound(res, `${request.sema}.${request.tablo} katalogda yok: tablo silinmiş ya da şeması Veritabanı seçiminde görünür değil.`);
    }
    const meta = {
      sema: relation.sema,
      tablo: relation.ad,
      kolonlar: relation.kolonlar.map((k) => k.ad),
      pk: relation.pk,
      uretilmis: relation.kolonlar.filter((k) => k.uretilmis).map((k) => k.ad),
    };
    let query: PageQuery;
    try {
      query = tablePageQuery(meta, request.sonraki, request);
    } catch (err) {
      const body: TablePageError = { hata: (err as Error).message, ...(err instanceof FilterError && { kutu: err.kutu }) };
      return json(res, 400, body);
    }
    const outcome = await readPage(pools, connection, database, meta, request, query);
    if (outcome.ok) json(res, 200, outcome.page);
    else json(res, 400, outcome.error);
  });
}
