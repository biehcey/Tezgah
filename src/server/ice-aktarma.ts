import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { basename, isAbsolute, join } from 'node:path';
import type { Settings } from '../core/ayarlar';
import { groupCandidates } from '../core/ice-aktarma/gruplama';
import { findPassword, parsePgpass, pgpassSourceCandidates, type PgpassEntry } from '../core/ice-aktarma/pgpass';
import {
  CandidateNotFound,
  PGPASS_FILE_NAMES,
  PGPASS_SOURCE_ID,
  addImported,
  parseImportApplyInput,
  parseImportPreviewInput,
  type ImportApplyResponse,
  type ImportPasswordOutcome,
  type ImportPreviewRequest,
  type ImportPreviewResponse,
  type ImportSourceInfo,
} from '../core/ice-aktarma/sozlesme';
import type { SettingsStore } from './ayar-deposu';
import { json, methodNotAllowed, readJson } from './http';
import { passwordAccount, type Keychain } from './keychain';

/** `PGPASSFILE` ve (Windows'ta) `APPDATA`; testlerde enjekte edilir. */
export interface PgpassEnvironment {
  platform: string;
  env: Record<string, string | undefined>;
}

export interface ImportDeps {
  store: SettingsStore;
  keychain: Keychain;
  homeDir: string;
  environment: PgpassEnvironment;
  log: (line: string) => void;
}

/**
 * libpq'nun aradığı yer: `PGPASSFILE`, yoksa Windows'ta `%APPDATA%\postgresql\pgpass.conf`, diğerlerinde
 * `~/.pgpass`.
 */
export function defaultPgpassPath(homeDir: string, { platform, env }: PgpassEnvironment): string {
  if (env.PGPASSFILE) return env.PGPASSFILE;
  if (platform === 'win32') return join(env.APPDATA ?? join(homeDir, 'AppData', 'Roaming'), 'postgresql', 'pgpass.conf');
  return join(homeDir, '.pgpass');
}

/** Taramanın sonucu: önizleme ve (sunucuda kalan) aday kimliğine göre şifreler. */
interface Scan extends ImportPreviewResponse {
  passwords: Map<string, string>;
}

type PgpassRead =
  | { status: 'ok'; path: string; entries: PgpassEntry[] }
  | { status: 'missing' | 'error'; path: string; error: string | null };

/** `/api/ice-aktarma/*` uçları. İsteği ele aldıysa `true` döner. */
export function createImportRoutes({ store, keychain, homeDir, environment, log }: ImportDeps) {
  async function readPgpass(manualPath: string | null): Promise<PgpassRead> {
    const expanded = manualPath?.replace(/^~(?=[\\/])/, homeDir) ?? null;
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

  async function scan({ pgpassPath, disabled }: ImportPreviewRequest, settings: Settings): Promise<Scan> {
    const pgpass = await readPgpass(pgpassPath);
    const entries = pgpass.status === 'ok' ? pgpass.entries : [];
    const fileName = basename(pgpass.path);
    const enabled = !disabled.includes(PGPASS_SOURCE_ID);
    const fromPgpass = pgpassSourceCandidates(entries, fileName);
    const source: ImportSourceInfo = {
      id: PGPASS_SOURCE_ID,
      label: fileName,
      path: pgpass.path,
      status: pgpass.status,
      error: pgpass.status === 'ok' ? null : pgpass.error,
      candidateCount: fromPgpass.length,
      enabled,
    };
    const passwords = new Map<string, string>();
    // Şifre her aday için libpq kuralıyla aranır; tünelli adayda `host` uzak sunucunun adıdır.
    const candidates = groupCandidates(enabled ? fromPgpass : [], settings.connections).map((c) => {
      const match = findPassword(entries, c);
      if (!match) return { ...c, password: null };
      passwords.set(c.id, match.password);
      return { ...c, password: { label: `${fileName} satır ${match.line}`, line: match.line, wildcard: match.wildcard } };
    });
    return { sources: [source], candidates, passwords };
  }

  async function preview(req: IncomingMessage, res: ServerResponse) {
    const parsed = parseImportPreviewInput(await readJson(req));
    if (!parsed.ok) return json(res, 400, { hata: parsed.error });
    const { sources, candidates } = await scan(parsed.value, await store.read());
    const body: ImportPreviewResponse = { sources, candidates };
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

