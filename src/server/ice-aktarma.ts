import { randomUUID } from 'node:crypto';
import { access, readFile, readdir } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { basename, dirname, isAbsolute, join } from 'node:path';
import type { Settings } from '../core/ayarlar';
import { SSL_PATH_FIELDS } from '../core/baglanti';
import { DataSourcesXmlError, dataSourceCandidates, type DataSourcesResult, type SkippedDataSource } from '../core/ice-aktarma/datasources';
import { groupCandidates, type SourceCandidate } from '../core/ice-aktarma/gruplama';
import { findPassword, parsePgpass, pgpassSourceCandidates, type PgpassEntry } from '../core/ice-aktarma/pgpass';
import {
  CandidateNotFound,
  PGPASS_FILE_NAMES,
  PGPASS_SOURCE_ID,
  addImported,
  jetbrainsSourceId,
  projectSourceId,
  parseImportApplyInput,
  parseImportPreviewInput,
  type ImportApplyResponse,
  type ImportPasswordOutcome,
  type ImportPreviewRequest,
  type ImportPreviewResponse,
  type ImportSourceInfo,
  type PreviewCandidate,
} from '../core/ice-aktarma/sozlesme';
import type { SettingsStore } from './ayar-deposu';
import { json, methodNotAllowed, readJson } from './http';
import { passwordAccount, type Keychain } from './keychain';

/** Platform, `PGPASSFILE` ve `APPDATA` (`.pgpass` ve JetBrains dizinleri için); testlerde enjekte edilir. */
export interface ImportEnvironment {
  platform: string;
  env: Record<string, string | undefined>;
}

export interface ImportDeps {
  store: SettingsStore;
  keychain: Keychain;
  homeDir: string;
  environment: ImportEnvironment;
  log: (line: string) => void;
}

/**
 * libpq'nun aradığı yer: `PGPASSFILE`, yoksa Windows'ta `%APPDATA%\postgresql\pgpass.conf`, diğerlerinde
 * `~/.pgpass`.
 */
export function defaultPgpassPath(homeDir: string, { platform, env }: ImportEnvironment): string {
  if (env.PGPASSFILE) return env.PGPASSFILE;
  if (platform === 'win32') return join(env.APPDATA ?? join(homeDir, 'AppData', 'Roaming'), 'postgresql', 'pgpass.conf');
  return join(homeDir, '.pgpass');
}

/** Taramanın sonucu: önizleme ve (sunucuda kalan) aday kimliğine göre şifreler. */
interface Scan extends ImportPreviewResponse {
  passwords: Map<string, string>;
}

/** Taranan bir IntelliJ dizini (global `options/` ya da proje `.idea`). */
interface DataSourcesDir {
  info: Pick<ImportSourceInfo, 'id' | 'label' | 'path'>;
  projectDir: string | null;
  defaultFolder: string | null;
  files: { dataSources: string | null; local: string | null; sshConfigs: string | null } | null;
  error: string | null;
}

/** Sunucunun okuduğu IntelliJ dosyaları: yalnızca `dataSources*.xml` ve `sshConfigs.xml`. */
export function isDataSourcesFileName(name: string): boolean {
  return /^dataSources[^\\/]*\.xml$/.test(name) || name === 'sshConfigs.xml';
}

/** Dosya yoksa `null`; okunabilir adlar dışındakini hiç açmaz. */
async function readOptional(path: string): Promise<string | null> {
  if (!isDataSourcesFileName(basename(path))) throw new Error(`${basename(path)} okunmaz`);
  try {
    return await readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT' || (err as NodeJS.ErrnoException).code === 'ENOTDIR') return null;
    throw err;
  }
}

async function readDataSourcesDir(dir: string): Promise<NonNullable<DataSourcesDir['files']>> {
  return {
    dataSources: await readOptional(join(dir, 'dataSources.xml')),
    local: await readOptional(join(dir, 'dataSources.local.xml')),
    sshConfigs: await readOptional(join(dir, 'sshConfigs.xml')),
  };
}

function readError(err: unknown): string {
  const code = (err as NodeJS.ErrnoException).code;
  return code === 'EACCES' || code === 'EPERM' ? 'okuma izni yok' : (err as Error).message;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** IDE yapılandırma kökü: Windows `%APPDATA%\JetBrains`, macOS `~/Library/Application Support/JetBrains`, Linux `~/.config/JetBrains`. */
export function jetbrainsRoot(homeDir: string, { platform, env }: ImportEnvironment): string {
  if (platform === 'win32') return join(env.APPDATA ?? join(homeDir, 'AppData', 'Roaming'), 'JetBrains');
  if (platform === 'darwin') return join(homeDir, 'Library', 'Application Support', 'JetBrains');
  return join(env.XDG_CONFIG_HOME ?? join(homeDir, '.config'), 'JetBrains');
}

type PgpassRead =
  | { status: 'ok'; path: string; entries: PgpassEntry[] }
  | { status: 'missing' | 'error'; path: string; error: string | null };

/** `/api/ice-aktarma/*` uçları. İsteği ele aldıysa `true` döner. */
export function createImportRoutes({ store, keychain, homeDir, environment, log }: ImportDeps) {
  /** `~` ya da `~/…` ev dizinine (testte enjekte edilen) çevrilir. */
  const expandHome = (path: string) => path.replace(/^~(?=[\\/]|$)/, homeDir);

  async function readPgpass(manualPath: string | null): Promise<PgpassRead> {
    const expanded = manualPath === null ? null : expandHome(manualPath);
    const path = expanded ?? defaultPgpassPath(homeDir, environment);
    if (expanded !== null && !isAbsolute(expanded)) return { status: 'error', path, error: 'Tam yol girin (ör. ~/.pgpass)' };
    if (!(PGPASS_FILE_NAMES as readonly string[]).includes(basename(path))) {
      return { status: 'error', path, error: 'Yalnızca .pgpass ya da pgpass.conf adlı dosyalar okunur' };
    }
    try {
      return { status: 'ok', path, entries: parsePgpass(await readFile(path, 'utf8')) };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' && manualPath === null) return { status: 'missing', path, error: null };
      const reason = code === 'ENOENT' ? 'dosya bulunamadı' : code === 'EACCES' || code === 'EPERM' ? 'okuma izni yok' : (err as Error).message;
      return { status: 'error', path, error: `Okunamadı: ${reason}` };
    }
  }

  /** Global `JetBrains/*\/options/` dizinleri: dataSources dosyası olan her ürün/sürüm bir kaynak. */
  async function readJetbrains(): Promise<DataSourcesDir[]> {
    const root = jetbrainsRoot(homeDir, environment);
    let names: string[];
    try {
      names = (await readdir(root, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name).sort();
    } catch {
      return [];
    }
    const dirs: DataSourcesDir[] = [];
    for (const name of names) {
      const options = join(root, name, 'options');
      const dir: DataSourcesDir = {
        info: { id: jetbrainsSourceId(name), label: name, path: options },
        projectDir: null,
        defaultFolder: null,
        files: null,
        error: null,
      };
      try {
        dir.files = await readDataSourcesDir(options);
      } catch (err) {
        dir.error = `Okunamadı: ${readError(err)}`;
      }
      if (dir.error !== null || dir.files!.dataSources !== null || dir.files!.local !== null) dirs.push(dir);
    }
    return dirs;
  }

  /** "＋ Proje klasörü…": proje kökü ya da `.idea`; `.idea/dataSources.xml` yoksa çip hatalıdır. */
  async function readProject(input: string): Promise<DataSourcesDir> {
    const expanded = expandHome(input);
    const idea = basename(expanded) === '.idea' ? expanded : join(expanded, '.idea');
    const root = dirname(idea);
    const dir: DataSourcesDir = {
      info: { id: projectSourceId(input), label: basename(root) || root, path: idea },
      projectDir: root,
      defaultFolder: basename(root) || null,
      files: null,
      error: null,
    };
    if (!isAbsolute(expanded)) dir.error = 'Tam yol girin (ör. ~/projeler/billing)';
    else {
      try {
        dir.files = await readDataSourcesDir(idea);
        if (dir.files.dataSources === null) dir.error = `${join(idea, 'dataSources.xml')} bulunamadı`;
      } catch (err) {
        dir.error = `Okunamadı: ${readError(err)}`;
      }
    }
    return dir;
  }

  async function scan({ pgpassPath, disabled, projectPaths }: ImportPreviewRequest, settings: Settings): Promise<Scan> {
    const jetbrains = await readJetbrains();
    const projects = await Promise.all(projectPaths.map(readProject));
    const globalSsh = jetbrains.flatMap((d) => (d.files?.sshConfigs !== null && d.files?.sshConfigs !== undefined ? [d.files.sshConfigs] : []));

    const sources: ImportSourceInfo[] = [];
    const fromSources: SourceCandidate[] = [];
    const skipped: SkippedDataSource[] = [];
    for (const dir of [...jetbrains, ...projects]) {
      const enabled = !disabled.includes(dir.info.id);
      let result: DataSourcesResult = { candidates: [], skipped: [] };
      let error = dir.error;
      // `ssh-config-id` önce kaynağın kendi sshConfigs.xml'inde, sonra global dosyalarda aranır.
      if (error === null && dir.files) {
        const { dataSources, local, sshConfigs } = dir.files;
        try {
          result = dataSourceCandidates(
            { dataSources, local, sshConfigs: [...(sshConfigs !== null ? [sshConfigs] : []), ...globalSsh] },
            { source: { id: dir.info.id, label: dir.info.label }, homeDir, projectDir: dir.projectDir, defaultFolder: dir.defaultFolder },
          );
        } catch (err) {
          if (!(err instanceof DataSourcesXmlError)) throw err;
          error = err.message;
        }
      }
      sources.push({ ...dir.info, status: error === null ? 'ok' : 'error', error, candidateCount: result.candidates.length, enabled });
      if (!enabled) continue;
      fromSources.push(...result.candidates);
      skipped.push(...result.skipped);
    }

    const pgpass = await readPgpass(pgpassPath);
    const entries = pgpass.status === 'ok' ? pgpass.entries : [];
    const fileName = basename(pgpass.path);
    const pgpassEnabled = !disabled.includes(PGPASS_SOURCE_ID);
    const fromPgpass = pgpassSourceCandidates(entries, fileName);
    sources.push({
      id: PGPASS_SOURCE_ID,
      label: fileName,
      path: pgpass.path,
      status: pgpass.status,
      error: pgpass.status === 'ok' ? null : pgpass.error,
      candidateCount: fromPgpass.length,
      enabled: pgpassEnabled,
    });
    if (pgpassEnabled) fromSources.push(...fromPgpass);

    const passwords = new Map<string, string>();
    // Şifre her aday için libpq kuralıyla aranır; tünelli adayda `host` uzak sunucunun adıdır.
    const candidates: PreviewCandidate[] = [];
    for (const c of groupCandidates(fromSources, settings.connections)) {
      for (const field of SSL_PATH_FIELDS) {
        const path = c[field];
        if (path !== null && !(await exists(expandHome(path)))) c.warnings.push(`SSL dosyası bulunamadı: ${path}`);
      }
      const match = findPassword(entries, c);
      if (!match) {
        candidates.push({ ...c, password: null });
        continue;
      }
      passwords.set(c.id, match.password);
      candidates.push({ ...c, password: { label: `${fileName} satır ${match.line}`, line: match.line, wildcard: match.wildcard } });
    }
    return { sources, candidates, skipped, passwords };
  }

  async function preview(req: IncomingMessage, res: ServerResponse) {
    const parsed = parseImportPreviewInput(await readJson(req));
    if (!parsed.ok) return json(res, 400, { hata: parsed.error });
    const { sources, candidates, skipped } = await scan(parsed.value, await store.read());
    const body: ImportPreviewResponse = { sources, candidates, skipped };
    json(res, 200, body);
  }

  /**
   * Kaynaklar yeniden taranır (şifreler istemciye hiç gitmez); seçilenler tek atomik yazmayla eklenir,
   * ardından şifreler keychain'e yazılır. Yazılamayan şifre için geri alma yok: bağlantı kalır, şifresi
   * ilk bağlanmada sorulur.
   */
  async function apply(req: IncomingMessage, res: ServerResponse) {
    const parsed = parseImportApplyInput(await readJson(req));
    if (!parsed.ok) return json(res, 400, { hata: parsed.error });
    const { candidates, passwords } = await scan(parsed.value, await store.read());
    let added: ReturnType<typeof addImported>;
    try {
      added = await store.update((settings) =>
        addImported(settings, candidates, parsed.value.selections, {
          newId: randomUUID,
          hasPassword: (id) => passwords.has(id),
        }),
      );
    } catch (err) {
      if (err instanceof CandidateNotFound) return json(res, 409, { hata: err.message });
      throw err;
    }

    const outcomes = new Map<string, ImportPasswordOutcome>();
    for (const { connection, candidateId } of added.connections) {
      const password = passwords.get(candidateId);
      if (password === undefined) {
        outcomes.set(connection.id, 'yok');
        continue;
      }
      const written = await keychain.set(passwordAccount(connection.id), password);
      if (written.result === 'reddedildi') log(`Keychain yazma reddedildi (${connection.id}): ${written.message}`);
      outcomes.set(connection.id, written.result);
    }
    const denied = new Set([...outcomes].filter(([, o]) => o === 'reddedildi').map(([id]) => id));
    if (denied.size > 0) {
      await store.update((settings) => {
        for (const c of settings.connections) if (denied.has(c.id)) c.savePassword = false;
      });
    }
    const body: ImportApplyResponse = {
      added: added.connections.map(({ connection }) => ({
        connection: denied.has(connection.id) ? { ...connection, savePassword: false } : connection,
        password: outcomes.get(connection.id)!,
      })),
      folders: added.folders,
      skipped: candidates.length - added.connections.length,
    };
    json(res, 200, body);
  }

  return async function handle(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<boolean> {
    if (pathname !== '/api/ice-aktarma/onizleme' && pathname !== '/api/ice-aktarma/uygula') return false;
    if (req.method !== 'POST') methodNotAllowed(res);
    else if (pathname.endsWith('onizleme')) await preview(req, res);
    else await apply(req, res);
    return true;
  };
}

