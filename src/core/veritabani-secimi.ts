/**
 * Veritabanı seçimi: bir bağlantı altında görünür veritabanları ve her birinin görünür şemaları.
 * Sunucu (doğrulama, kayıt) ve Veritabanı paneli aynı kuralları kullanır.
 */
import { SSL_PATH_FIELDS, isProd, type Connection, type DatabaseSelection } from './baglanti';
import type { HostKeyProblem } from './ssh-tuneli';

/** Varsayılan görünürlükte gizli sistem şemaları; diğer şemalar görünür. */
export const HIDDEN_SCHEMAS: readonly string[] = ['pg_catalog', 'information_schema', 'pg_toast'];

/** Görünür şemalar, sunucudaki sırayla. `schemas: null` varsayılan görünürlüktür. */
export function visibleSchemas(entry: DatabaseSelection, all: readonly string[]): string[] {
  const visible = entry.schemas;
  return all.filter((s) => (visible === null ? !HIDDEN_SCHEMAS.includes(s) : visible.includes(s)));
}

/** Hedef veritabanının seçim girdisi; seçimde yoksa varsayılan şema görünürlüğüyle. */
export function selectionEntry(connection: Pick<Connection, 'databaseSelection'>, database: string): DatabaseSelection {
  return connection.databaseSelection.find((d) => d.database === database) ?? { database, schemas: null };
}

/** ⭐: görünür yapılan veritabanı varsayılan şema görünürlüğüyle sona eklenir; gizlenen çıkar. */
export function setDatabaseVisible(selection: readonly DatabaseSelection[], database: string, visible: boolean): DatabaseSelection[] {
  const present = selection.some((d) => d.database === database);
  if (visible) return present ? [...selection] : [...selection, { database, schemas: null }];
  return selection.filter((d) => d.database !== database);
}

/**
 * Şema çipi. Varsayılan görünürlükten ayrılınca açık listeye geçer; liste varsayılanla aynı olursa
 * yeniden `null` olur, böylece sonradan oluşturulan şemalar görünür kalır.
 */
export function setSchemaVisible(
  selection: readonly DatabaseSelection[],
  database: string,
  schema: string,
  visible: boolean,
  all: readonly string[],
): DatabaseSelection[] {
  return selection.map((entry) => {
    if (entry.database !== database) return entry;
    const current = new Set(visibleSchemas(entry, all));
    if (visible) current.add(schema);
    else current.delete(schema);
    const next = all.filter((s) => current.has(s));
    const defaults = visibleSchemas({ database, schemas: null }, all);
    const isDefault = next.length === defaults.length && next.every((s, i) => s === defaults[i]);
    return { database, schemas: isDefault ? null : next };
  });
}

export interface DatabasePanelModel {
  /** Seçimdeki veritabanları, seçim sırasıyla (⭐). */
  visible: string[];
  /** Sunucuda olup seçimde olmayanlar; bağlanılmadıysa bilinmez (`null`). */
  hidden: string[] | null;
}

export function databasePanel(selection: readonly DatabaseSelection[], serverDatabases: readonly string[] | null): DatabasePanelModel {
  const visible = selection.map((d) => d.database);
  return {
    visible,
    hidden: serverDatabases === null ? null : serverDatabases.filter((d) => !visible.includes(d)),
  };
}

export type SelectionParseResult = { ok: true; value: DatabaseSelection[] } | { ok: false; error: string };

export function parseDatabaseSelection(raw: unknown): SelectionParseResult {
  if (!Array.isArray(raw)) return { ok: false, error: 'Veritabanı seçimi bir dizi olmalı' };
  const value: DatabaseSelection[] = [];
  for (const item of raw as unknown[]) {
    if (typeof item !== 'object' || item === null) return { ok: false, error: 'Geçersiz Veritabanı seçimi' };
    const { database, schemas } = item as Record<string, unknown>;
    if (typeof database !== 'string' || database === '') return { ok: false, error: 'Veritabanı adı gerekli' };
    if (value.some((d) => d.database === database)) return { ok: false, error: `“${database}” iki kez seçilmiş` };
    if (schemas !== null && !(Array.isArray(schemas) && schemas.every((s) => typeof s === 'string'))) {
      return { ok: false, error: `“${database}” için şemalar bir ad dizisi olmalı` };
    }
    value.push({ database, schemas: schemas === null ? null : [...new Set(schemas as string[])] });
  }
  return { ok: true, value };
}

/** Hedef: bir script'in çalıştığı bağlantı + veritabanı çifti. */
export interface Target {
  connectionId: string;
  database: string;
}

/** `target`, bu bağlantının bu veritabanı mı. */
export function isTarget(target: Target | null, connectionId: string, database: string): boolean {
  return target?.connectionId === connectionId && target.database === database;
}

/** "Hedef yap": başlangıç veritabanı görünürse o, değilse ilk görünür veritabanı; hiç yoksa `null`. */
export function defaultTargetDatabase(connection: Pick<Connection, 'database' | 'databaseSelection'>): string | null {
  const visible = connection.databaseSelection.map((d) => d.database);
  return visible.includes(connection.database) ? connection.database : (visible[0] ?? null);
}

/**
 * Güncelleme açık pool'ları geçersiz kılıyor mu: sunucuya nasıl bağlanıldığını değiştiren alanlar
 * (adres, kimlik, SSL, şifre kaynağı, prod salt okunurluğu). Ad, klasör, renk ve seçim kılmaz.
 */
export function changesServerSession(before: Connection, after: Connection): boolean {
  const fields = ['host', 'port', 'user', 'database', 'sslmode', 'savePassword', ...SSL_PATH_FIELDS] as const;
  return (
    fields.some((f) => before[f] !== after[f]) ||
    isProd(before.envTag) !== isProd(after.envTag) ||
    !sameTunnel(before.ssh, after.ssh)
  );
}

/** Tünelin herhangi bir alanı (sır seçeneği dahil) değiştiyse tünel yeniden açılmalı. */
function sameTunnel(a: Connection['ssh'], b: Connection['ssh']): boolean {
  if (a === null || b === null) return a === b;
  const fields = ['host', 'port', 'user', 'auth', 'keyPath', 'agentPath', 'saveSecret'] as const;
  return fields.every((f) => a[f] === b[f]);
}

// --- REST sözleşmesi ---

export interface DatabaseListResponse {
  /** `pg_database`'deki veritabanları (şablonlar hariç), ada göre. */
  veritabanlari: string[];
}

export interface SchemaListResponse {
  /** `pg_namespace`'teki şemalar (oturumların geçici şemaları hariç), ada göre. */
  semalar: string[];
}

/** Hedefe bağlanılamadı ya da listeleme başarısız oldu (502). */
export interface TargetErrorResponse {
  hata: string;
  /** Bağlantı testiyle aynı kodlar: `ECONNREFUSED`, `28P01`, `sifreGerekli`, `hostKeyUnknown`…; bilinmiyorsa `null`. */
  kod: string | null;
  /** Host anahtarı bilinmiyor ya da uyuşmuyor: listeden bağlanırken de aynı kutu gösterilir. */
  hostAnahtari?: HostKeyProblem;
}
