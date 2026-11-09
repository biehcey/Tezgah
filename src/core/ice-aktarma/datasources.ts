/**
 * IntelliJ/DataGrip `dataSources.xml`, `dataSources.local.xml` ve `sshConfigs.xml` metinlerinden İçe
 * aktarma adayları. IO yok: metinler girer, gruplamaya girecek kaynak adayları ve atlananlar çıkar.
 * JetBrains formatı belgelemediği için ayrıştırıcı toleranslıdır: bilinmeyen element yok sayılır, eksik
 * alan varsayılana düşer; bozuk XML yalnızca o kaynağı (çipi) hatalı yapar.
 */
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import {
  DEFAULT_PORT,
  DEFAULT_SSH_PORT,
  DEFAULT_SSL,
  SSL_MODES,
  type SshAuth,
  type SshSettings,
  type SslMode,
  type SslSettings,
} from '../baglanti';
import type { CandidateSource, SourceCandidate } from './gruplama';

/** Bir kaynağın (JetBrains ürün/sürüm dizini ya da proje `.idea`) dosya metinleri; olmayan `null`. */
export interface DataSourcesFiles {
  dataSources: string | null;
  local: string | null;
  /** Önce kaynağın kendi, sonra global `sshConfigs.xml` metinleri; `ssh-config-id` ilk bulunduğu yerden. */
  sshConfigs: string[];
}

export interface DataSourcesContext {
  source: CandidateSource;
  /** `$USER_HOME$` makrosu. */
  homeDir: string;
  /** `$PROJECT_DIR$` makrosu; global kaynakta `null`. */
  projectDir: string | null;
  /** Grupsuz data source'un klasörü: proje kaynağında proje klasörünün adı, globalde `null`. */
  defaultFolder: string | null;
}

/** Aday olmayan data source (Postgres dışı sürücü, okunamayan URL). */
export interface SkippedDataSource {
  source: CandidateSource;
  name: string;
  reason: string;
}

export interface DataSourcesResult {
  candidates: SourceCandidate[];
  skipped: SkippedDataSource[];
}

/** `dataSources.xml` ya da `dataSources.local.xml` ayrıştırılamadı; yalnızca bu kaynak hatalıdır. */
export class DataSourcesXmlError extends Error {}

// --- XML ağacı: her element bir nesne, çocuklar her zaman dizi, metin `#text`, öznitelikler `@_ad`. ---

type El = Record<string, unknown>;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  alwaysCreateTextNode: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  isArray: (_name, _jpath, _isLeaf, isAttribute) => !isAttribute,
});

function parseXml(text: string, fileName: string): El {
  const valid = XMLValidator.validate(text);
  if (valid !== true) throw new DataSourcesXmlError(`${fileName} okunamadı: ${valid.err.msg} (satır ${valid.err.line})`);
  return parser.parse(text) as El;
}

const isEl = (v: unknown): v is El => typeof v === 'object' && v !== null && !Array.isArray(v);

function children(el: El | undefined, tag: string): El[] {
  const value = el?.[tag];
  return Array.isArray(value) ? value.filter(isEl) : [];
}

const child = (el: El | undefined, tag: string): El | undefined => children(el, tag)[0];

function textOf(el: El | undefined): string | null {
  const value = el?.['#text'];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

const text = (el: El | undefined, tag: string): string | null => textOf(child(el, tag));

function attr(el: El | undefined, name: string): string | null {
  const value = el?.[`@_${name}`];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/** Ağaçtaki tüm `tag` elementleri (kök `<project>` ya da `<application>`, bileşen adı fark etmez). */
function descendants(el: El, tag: string): El[] {
  const found: El[] = [];
  for (const [key, value] of Object.entries(el)) {
    if (key.startsWith('@_') || key === '#text' || !Array.isArray(value)) continue;
    for (const item of value) {
      if (!isEl(item)) continue;
      if (key === tag) found.push(item);
      else found.push(...descendants(item, tag));
    }
  }
  return found;
}

// --- Data source'lar ---

/** Gruplardaki görünmez karakterler (U+200B vb.) gerçek dosyalarda görüldü. */
const INVISIBLE = /[\u200b-\u200f\u2060\ufeff]/g;

export function dataSourceCandidates(files: DataSourcesFiles, ctx: DataSourcesContext): DataSourcesResult {
  const shared = files.dataSources === null ? [] : descendants(parseXml(files.dataSources, 'dataSources.xml'), 'data-source');
  const local = files.local === null ? [] : descendants(parseXml(files.local, 'dataSources.local.xml'), 'data-source');
  const localByUuid = new Map<string, El>();
  for (const l of local) {
    const uuid = attr(l, 'uuid');
    if (uuid !== null && !localByUuid.has(uuid)) localByUuid.set(uuid, l);
  }

  const sshConfigs = sshConfigIndex(files.sshConfigs);

  const result: DataSourcesResult = { candidates: [], skipped: [] };
  // Yalnızca local'de olan kayıt (paylaşılanı silinmiş) atlanır.
  for (const ds of shared) {
    const uuid = attr(ds, 'uuid');
    const loc = uuid === null ? undefined : localByUuid.get(uuid);
    const name = attr(ds, 'name') ?? attr(loc, 'name') ?? '';
    const source: CandidateSource = { id: ctx.source.id, label: `${ctx.source.label} · ${name || '(adsız)'}` };
    const url = text(ds, 'jdbc-url');
    const driver = text(ds, 'driver-ref');
    const postgresUrl = url !== null && /^jdbc:postgresql:/i.test(url);
    if (!postgresUrl && !driver?.toLowerCase().startsWith('postgresql')) {
      const kind = driver ?? /^jdbc:([^:]+):/i.exec(url ?? '')?.[1] ?? 'sürücü bilinmiyor';
      result.skipped.push({ source, name: name || '(adsız)', reason: `Postgres değil (${kind})` });
      continue;
    }
    const parsed = url === null ? null : parseJdbcUrl(url);
    if (!parsed) {
      result.skipped.push({ source, name: name || '(adsız)', reason: 'JDBC URL okunamadı' });
      continue;
    }
    const warnings: string[] = [];
    if (parsed.otherHosts > 0) warnings.push(`çoklu host: yalnızca ilki (${parsed.hostLabel}) alındı`);
    if (parsed.params.password !== undefined) warnings.push('JDBC URL’deki şifre alınmadı');
    const user = text(loc, 'user-name') ?? parsed.user ?? 'postgres';
    const database = parsed.database ?? user;

    const group = (attr(ds, 'group') ?? attr(ds, 'group-name'))?.replace(INVISIBLE, '').trim() || null;
    if (group?.includes('/')) warnings.push(`iç içe grup tek düzey klasöre: ${group}`);
    const readOnly = attr(ds, 'read-only') === 'true';
    const tunnel = mapTunnel(child(loc, 'ssh-properties'), sshConfigs, ctx);
    if (tunnel.warning) warnings.push(tunnel.warning);
    const scope = scopeDatabases(child(child(loc, 'schema-mapping'), 'introspection-scope'), database);
    if (scope.all) warnings.push('IntelliJ’de tüm veritabanları görünür; içe aktardıktan sonra Veritabanı panelinden seçin');

    result.candidates.push({
      source,
      name: name || `${user}@${parsed.host}/${database}`,
      host: parsed.host,
      port: parsed.port,
      user,
      database,
      databases: scope.databases,
      ssh: tunnel.ssh,
      ...mapSsl(child(loc, 'ssl-config'), parsed.params, ctx),
      envTag: readOnly ? 'prod' : null,
      envReason: readOnly ? 'IntelliJ’de salt okunur (read-only="true")' : null,
      folder: group ?? ctx.defaultFolder,
      warnings,
      tunnelUnmapped: tunnel.unmapped,
    });
  }
  return result;
}

/** `$USER_HOME$` ve `$PROJECT_DIR$`; ayırıcı makronun yerine geçen dizinin ayırıcısına uyar. */
export function expandMacros(path: string, { homeDir, projectDir }: Pick<DataSourcesContext, 'homeDir' | 'projectDir'>): string {
  const expand = (value: string, macro: string, dir: string | null) => {
    if (dir === null || !value.startsWith(macro)) return value;
    const rest = value.slice(macro.length);
    const windows = dir.includes('\\') && !dir.includes('/');
    return dir.replace(/[\\/]+$/, '') + (windows ? rest.replace(/\//g, '\\') : rest);
  };
  return expand(expand(path.trim(), '$USER_HOME$', homeDir), '$PROJECT_DIR$', projectDir);
}

// --- SSH ---

/** `sshConfigs.xml` metinlerindeki `sshConfig` elementleri, kimlikle; aynı kimlik ilk dosyadan. Bozuk dosya atlanır. */
function sshConfigIndex(texts: readonly string[]): Map<string, El> {
  const index = new Map<string, El>();
  for (const t of texts) {
    let root: El;
    try {
      root = parseXml(t, 'sshConfigs.xml');
    } catch {
      continue;
    }
    for (const config of descendants(root, 'sshConfig')) {
      const id = attr(config, 'id');
      if (id !== null && !index.has(id)) index.set(id, config);
    }
  }
  return index;
}

interface Tunnel {
  ssh: SshSettings | null;
  unmapped: boolean;
  warning: string | null;
}

const NO_TUNNEL: Tunnel = { ssh: null, unmapped: false, warning: null };
const unmapped = (reason: string): Tunnel => ({ ssh: null, unmapped: true, warning: `tünel eşlenemedi: ${reason}` });

function sshPort(value: string | null): number {
  const port = Number(value);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : DEFAULT_SSH_PORT;
}

/**
 * `ssh-properties`: yeni biçimde yalnızca `ssh-config-id` (ayrıntı `sshConfigs.xml`'de), eski biçimde satır
 * içi `proxy-host`/`proxy-port`/`user`. Şifre ve passphrase okunmaz; ProxyJump (tek düzey dışı) eşlenmez.
 */
function mapTunnel(props: El | undefined, configs: Map<string, El>, ctx: DataSourcesContext): Tunnel {
  if (!props || text(props, 'enabled') !== 'true') return NO_TUNNEL;
  const ids = children(props, 'ssh-config-id').map(textOf).filter((id): id is string => id !== null);
  if (ids.length > 1) return unmapped('birden çok SSH atlaması desteklenmiyor');
  const path = (p: string | null) => (p === null ? null : expandMacros(p, ctx));

  if (ids.length === 1) {
    const config = configs.get(ids[0]!);
    if (!config) return unmapped(`SSH yapılandırması bulunamadı (${ids[0]})`);
    const host = attr(config, 'host');
    const user = attr(config, 'username');
    if (host === null || user === null) return unmapped(`SSH yapılandırmasında host ya da kullanıcı yok (${ids[0]})`);
    const jump = Object.keys(config).some((k) => /^@_.*jump/i.test(k) && attr(config, k.slice(2)) !== null);
    if (jump) return unmapped(`ProxyJump desteklenmiyor (${host})`);
    const keyPath = path(attr(config, 'keyPath'));
    const type = attr(config, 'authType')?.toUpperCase() ?? null;
    let auth: SshAuth;
    if (type === 'PASSWORD') auth = 'password';
    else if (type === 'KEY_PAIR') auth = 'key';
    else if (type === 'OPEN_SSH' || type?.includes('AGENT')) auth = 'agent';
    else auth = keyPath !== null ? 'key' : 'password';
    if (auth === 'key' && keyPath === null) return unmapped(`anahtar dosyası belirtilmemiş (${host})`);
    return { ssh: { host, port: sshPort(attr(config, 'port')), user, auth, keyPath, agentPath: null, saveSecret: true }, unmapped: false, warning: null };
  }

  const host = text(props, 'proxy-host');
  const user = text(props, 'user');
  if (host === null || user === null) return unmapped('SSH host ya da kullanıcı yok');
  const keyPath = path(text(props, 'private-key-path'));
  const auth: SshAuth = text(props, 'use-password') === 'true' ? 'password' : keyPath !== null ? 'key' : 'agent';
  return {
    ssh: { host, port: sshPort(text(props, 'proxy-port')), user, auth, keyPath: auth === 'key' ? keyPath : null, agentPath: null, saveSecret: true },
    unmapped: false,
    warning: null,
  };
}

/**
 * `introspection-scope`: `@` varsayılan veritabanı, `<name qname>` listesi ya da tek `qname`;
 * `negative="1"` tümü (Tezgah'ta karşılığı yok, başlangıç veritabanı alınır). Eski biçim düz metin
 * `db:şema,şema;db2:şema`.
 */
function scopeDatabases(scope: El | undefined, database: string): { databases: string[]; all: boolean } {
  const names: string[] = [];
  let all = false;
  const add = (n: string | null) => {
    const value = n === '@' || n === null ? database : n;
    if (!names.includes(value)) names.push(value);
  };
  for (const node of children(scope, 'node')) {
    if (attr(node, 'kind') !== 'database') continue;
    if (attr(node, 'negative') === '1') {
      all = true;
      continue;
    }
    const listed = children(node, 'name').map((n) => attr(n, 'qname'));
    if (listed.length > 0) listed.forEach(add);
    else add(attr(node, 'qname'));
  }
  const legacy = textOf(scope);
  if (legacy !== null) for (const part of legacy.split(';')) add(part.split(':')[0]!.trim() || null);
  if (names.length === 0) add(database);
  return { databases: names, all };
}

// --- SSL ---

const SSL_CONFIG_MODES: Record<string, SslMode> = {
  DISABLE: 'disable',
  ALLOW: 'prefer',
  PREFER: 'prefer',
  REQUIRE: 'require',
  VERIFY_CA: 'verify-ca',
  VERIFY_FULL: 'verify-full',
};

/**
 * Önce açık `ssl-config` (mod yoksa `require`: SSL'i açan kullanıcı düz bağlantıya düşmek istemez), sonra
 * JDBC URL `sslmode` ve dosyaları (pgjdbc'de `ssl=true` tek başına `verify-full`), en son `prefer`.
 */
function mapSsl(config: El | undefined, params: Record<string, string>, ctx: DataSourcesContext): SslSettings {
  const path = (p: string | null | undefined) => (p ? expandMacros(p, ctx) : null);
  if (config && text(config, 'enabled') === 'true') {
    const mode = text(config, 'mode')?.toUpperCase();
    return {
      sslmode: (mode && SSL_CONFIG_MODES[mode]) || 'require',
      sslrootcert: path(text(config, 'ca-cert')),
      sslcert: path(text(config, 'client-cert')),
      sslkey: path(text(config, 'client-key')),
    };
  }
  const urlMode = params.sslmode === 'allow' ? 'prefer' : params.sslmode;
  let sslmode: SslMode = DEFAULT_SSL.sslmode;
  if (SSL_MODES.includes(urlMode as SslMode)) sslmode = urlMode as SslMode;
  else if (params.ssl === 'true' || params.ssl === '') sslmode = 'verify-full';
  return { sslmode, sslrootcert: path(params.sslrootcert), sslcert: path(params.sslcert), sslkey: path(params.sslkey) };
}

// --- JDBC URL (pgjdbc kuralları) ---

export interface JdbcUrl {
  host: string;
  port: number;
  /** Yolda veritabanı yoksa `null` (pgjdbc: kullanıcı adı). */
  database: string | null;
  /** Sorgu parametreleri; anahtarlar küçük harf. `password` yalnızca uyarı için okunur, hiçbir yere taşınmaz. */
  params: Record<string, string>;
  user: string | null;
  /** Virgülle verilen diğer host sayısı (failover); yalnızca ilki alınır. */
  otherHosts: number;
  /** İlk host URL'de yazıldığı gibi (uyarı metni için). */
  hostLabel: string;
}

/** `jdbc:postgresql://host:port/db?…`; Postgres URL'i değilse ya da okunamazsa `null`. */
export function parseJdbcUrl(url: string): JdbcUrl | null {
  const m = /^jdbc:postgresql:(?:\/\/([^/?]*))?\/?([^?]*)(?:\?(.*))?$/i.exec(url.trim());
  if (!m) return null;
  const [, authority = '', path, query = ''] = m;
  const hosts = authority.split(',');
  const first = hosts[0]!;
  let host = 'localhost';
  let portText = '';
  if (first.startsWith('[')) {
    const close = first.indexOf(']');
    if (close === -1) return null;
    host = first.slice(1, close);
    portText = first.slice(close + 1).replace(/^:/, '');
  } else if (first !== '') {
    const colon = first.indexOf(':');
    host = colon === -1 ? first : first.slice(0, colon);
    portText = colon === -1 ? '' : first.slice(colon + 1);
  }
  const port = portText === '' ? DEFAULT_PORT : Number(portText);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  const params: Record<string, string> = {};
  for (const pair of query.split('&')) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    const key = decode(eq === -1 ? pair : pair.slice(0, eq)).toLowerCase();
    params[key] = decode(eq === -1 ? '' : pair.slice(eq + 1));
  }
  return { host: decode(host) || 'localhost', port, database: path ? decode(path) : null, params, user: params.user || null, otherHosts: hosts.length - 1, hostLabel: first };
}

function decode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}
