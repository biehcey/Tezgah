import type { IncomingMessage, ServerResponse } from 'node:http';
import pg from 'pg';
import type { Connection } from '../core/baglanti';
import { RELATION_KINDS, buildCatalog, pgBool, type Catalog } from '../core/katalog';
import { selectionEntry, visibleSchemas } from '../core/veritabani-secimi';
import type { SettingsStore } from './ayar-deposu';
import { RAW_TYPES, TargetError, targetQueryError, type PoolManager } from './havuzlar';
import { json, methodNotAllowed, notFound } from './http';

/** Büyük veritabanlarında katalog okuması panelin kısa sorgularından uzun sürebilir. */
const TIMEOUT_MS = 30_000;

/**
 * Metin literal'i, `standard_conforming_strings`'ten bağımsız: `E'…'` içinde ters bölü ve tek
 * tırnak kaçışlanır. Sahte Postgres parametreli sorguya satır döndürmediğinden adlar gömülür.
 */
const literal = (value: string) => `E'${value.replaceAll('\\', '\\\\').replaceAll("'", "''")}'`;
const inList = (values: readonly string[]) => `IN (${values.map(literal).join(', ')})`;

const SCHEMAS_SQL = `SELECT nspname AS ad, (nspname = (current_schemas(false))[1])::text AS varsayilan
  FROM pg_catalog.pg_namespace WHERE nspname !~ '^pg_(toast_)?temp_' ORDER BY nspname`;

const relationsSql = (schemas: readonly string[]) => `SELECT n.nspname AS sema, c.relname AS ad, c.relkind::text AS tur,
    c.reltuples::text AS satir, a.attname AS kolon, format_type(a.atttypid, a.atttypmod) AS tip,
    a.atttypid::text AS tip_oid, a.attnotnull::text AS not_null, a.atthasdef::text AS varsayilan,
    a.attgenerated::text AS uretilmis, array_position(i.indkey::int2[], a.attnum)::text AS pk_sira
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
  LEFT JOIN pg_catalog.pg_index i ON i.indrelid = c.oid AND i.indisprimary
  WHERE c.relkind ${inList(RELATION_KINDS)} AND n.nspname ${inList(schemas)}
  ORDER BY n.nspname, c.relname, a.attnum`;

/** Tip eşlemesi; kullanıcı tipi: görünür şemada, dizi değil, tablo satır tipi değil. */
const typesSql = (schemas: readonly string[]) => `SELECT t.oid::text AS oid, format_type(t.oid, NULL) AS ad,
    (n.nspname <> 'pg_catalog' AND t.typcategory <> 'A' AND (t.typrelid = 0 OR r.relkind = 'c'))::text AS kullanici
  FROM pg_catalog.pg_type t
  JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
  LEFT JOIN pg_catalog.pg_class r ON r.oid = t.typrelid
  WHERE n.nspname ${inList(['pg_catalog', ...schemas])}`;

async function query(client: pg.ClientBase, text: string): Promise<Record<string, string | null>[]> {
  // `query_timeout` sorgu başına desteklenir ama @types/pg'de tanımlı değil.
  const config = { text, types: RAW_TYPES, query_timeout: TIMEOUT_MS } as pg.QueryConfig;
  return (await client.query<Record<string, string | null>>(config)).rows;
}

export interface CatalogCacheDeps {
  pools: PoolManager;
}

/**
 * Katalog önbelleği: süreç belleğinde hedef (bağlantı + veritabanı) başına. Yalnızca istemcinin
 * açık isteğiyle (kullanıcı eylemi) ya da DDL'li script commit edilince okunur; bağlantı
 * kesilince/silinince ve Veritabanı seçimi değişince atılır. Okuma kısa süreli bir client'la, tek
 * bir salt okunur transaction'da (tutarlı görüntü) yapılır; oturum sayılmaz.
 */
export function createCatalogCache({ pools }: CatalogCacheDeps) {
  const keyOf = (connectionId: string, database: string) => `${connectionId}\u0000${database}`;
  const cached = new Map<string, Catalog>();
  /** Yoldaki okumalar; aynı hedefe gelen istekler aynı okumayı bekler. */
  const loading = new Map<string, Promise<Catalog>>();
  /**
   * Sürümler: atma bağlantının, yenileme hedefin sürümünü artırır; eski sürümle başlamış okumanın
   * sonucu önbelleğe yazılmaz (ör. seçim okuma sürerken değişti).
   */
  const versions = new Map<string, number>();
  const bump = (key: string) => versions.set(key, (versions.get(key) ?? 0) + 1);
  const version = (connectionId: string, key: string) => `${versions.get(connectionId) ?? 0}:${versions.get(key) ?? 0}`;

  function read(connection: Connection, database: string): Promise<Catalog> {
    const entry = selectionEntry(connection, database);
    return pools.withClient(connection, database, async (client, discard) => {
      try {
        await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        const schemaRows = await query(client, SCHEMAS_SQL);
        const all = schemaRows.map((r) => r.ad!);
        const semalar = visibleSchemas(entry, all);
        const defaultSchema = schemaRows.find((r) => pgBool(r.varsayilan))?.ad ?? null;
        const iliskiler = semalar.length > 0 ? await query(client, relationsSql(semalar)) : [];
        const tipler = await query(client, typesSql(semalar));
        await client.query('COMMIT');
        return buildCatalog({ semalar, defaultSchema, iliskiler, tipler });
      } catch (err) {
        // Transaction açık kalmış olabilir: client pool'a dönmez.
        discard();
        throw targetQueryError(err, 'Katalog');
      }
    });
  }

  function load(connection: Connection, database: string): Promise<Catalog> {
    const key = keyOf(connection.id, database);
    const started = version(connection.id, key);
    const reading = read(connection, database).then((catalog) => {
      if (version(connection.id, key) === started) cached.set(key, catalog);
      return catalog;
    });
    loading.set(key, reading);
    const settle = () => {
      if (loading.get(key) === reading) loading.delete(key);
    };
    reading.then(settle, settle);
    return reading;
  }

  return {
    /** Hedefin katalogu önbellekte ya da okunuyor mu (kullanıcı istemiş mi). */
    has(connectionId: string, database: string): boolean {
      const key = keyOf(connectionId, database);
      return cached.has(key) || loading.has(key);
    },

    /** Önbellekteki katalog; yoksa (ya da okuma yoldaysa onu bekleyerek) okur. */
    get(connection: Connection, database: string): Promise<Catalog> {
      const key = keyOf(connection.id, database);
      const hit = cached.get(key);
      if (hit) return Promise.resolve(hit);
      return loading.get(key) ?? load(connection, database);
    },

    /** Yeniden okur ("↻", DDL commit'i); yoldaki eski okumanın sonucu önbelleğe yazılmaz. */
    refresh(connection: Connection, database: string): Promise<Catalog> {
      bump(keyOf(connection.id, database));
      return load(connection, database);
    },

    /** Bağlantının tüm kataloglarını atar. */
    dropConnection(connectionId: string) {
      bump(connectionId);
      for (const key of [...cached.keys()]) if (key.startsWith(`${connectionId}\u0000`)) cached.delete(key);
      for (const key of [...loading.keys()]) if (key.startsWith(`${connectionId}\u0000`)) loading.delete(key);
    },
  };
}

export type CatalogCache = ReturnType<typeof createCatalogCache>;

const PATH = /^\/api\/baglantilar\/([^/]+)\/veritabanlari\/([^/]+)\/katalog(\/yenile)?$/;

/** `GET …/veritabanlari/:db/katalog` (yoksa okur) ve `POST …/katalog/yenile`. */
export function createCatalogRoutes({ store, catalogs }: { store: SettingsStore; catalogs: CatalogCache }) {
  return async function handle(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<boolean> {
    const match = PATH.exec(pathname);
    if (!match) return false;
    const [, rawId, rawDatabase, refresh] = match;
    if (req.method !== (refresh ? 'POST' : 'GET')) {
      methodNotAllowed(res);
      return true;
    }
    const id = decodeURIComponent(rawId!);
    const database = decodeURIComponent(rawDatabase!);
    const connection = (await store.read()).connections.find((c) => c.id === id);
    if (!connection) {
      notFound(res, 'Bağlantı bulunamadı');
      return true;
    }
    try {
      const catalog = await (refresh ? catalogs.refresh(connection, database) : catalogs.get(connection, database));
      json(res, 200, catalog);
    } catch (err) {
      if (!(err instanceof TargetError)) throw err;
      json(res, 502, err.body);
    }
    return true;
  };
}
