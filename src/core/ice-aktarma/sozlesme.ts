/**
 * İçe aktarma REST sözleşmesi ve seçilen adayların ayara eklenmesi. Sunucu ve web aynı tanımı kullanır;
 * şifre değeri hiçbir zaman istemciye gitmez, yalnızca hangi satırdan geleceği gösterilir.
 */
import { sameName, type Folder, type Settings } from '../ayarlar';
import { DEFAULT_ENV_COLORS, ENV_TAGS, type Connection, type EnvTag } from '../baglanti';
import type { SkippedDataSource } from './datasources';
import { uniqueName, type ImportCandidate } from './gruplama';

export const PGPASS_SOURCE_ID = 'pgpass';
/** Global JetBrains kaynağının kimliği: `jetbrains:<Ürün><Sürüm>` (dizin adı). */
export const jetbrainsSourceId = (dir: string) => `jetbrains:${dir}`;
/** Proje kaynağının kimliği: girilen yol. */
export const projectSourceId = (path: string) => `proje:${path}`;
/** Sunucunun okuduğu tek `.pgpass` dosya adları. */
export const PGPASS_FILE_NAMES = ['.pgpass', 'pgpass.conf'] as const;

/** Taranan kaynak (çip). `missing`: kendiliğinden aranan dosya yok; `error`: okunamadı ya da reddedildi. */
export interface ImportSourceInfo {
  id: string;
  label: string;
  path: string;
  status: 'ok' | 'missing' | 'error';
  error: string | null;
  /** Bu kaynaktan çıkan (birleştirmeden önceki) aday sayısı. */
  candidateCount: number;
  enabled: boolean;
}

/** Şifrenin bulunduğu satır; değer sunucuda kalır. */
export interface PasswordSource {
  label: string;
  line: number;
  wildcard: boolean;
}

export interface PreviewCandidate extends ImportCandidate {
  password: PasswordSource | null;
}

/** `pgpassPath` verilirse kendiliğinden arama yerine o dosya okunur; `disabled` kapalı çiplerdir. */
export interface ImportPreviewRequest {
  pgpassPath: string | null;
  disabled: string[];
  projectPaths: string[];
}

export interface ImportPreviewResponse {
  sources: ImportSourceInfo[];
  candidates: PreviewCandidate[];
  /** Aday olmayan IntelliJ data source’ları (Postgres dışı): önizlemede gri "Atlandı". */
  skipped: SkippedDataSource[];
}

/** Önizlemede seçilen aday ve düzenlenen alanları. `folder` klasör adıdır; yoksa oluşturulur. */
export interface ImportSelection {
  id: string;
  name: string;
  folder: string | null;
  envTag: EnvTag | null;
}

export interface ImportApplyRequest extends ImportPreviewRequest {
  selections: ImportSelection[];
}

/** Şifreye ne oldu: keychain'e yazıldı, yazılamadı (ilk bağlanmada sorulur) ya da kaynakta yoktu. */
export type ImportPasswordOutcome = 'kaydedildi' | 'reddedildi' | 'yok';

export interface ImportApplyResponse {
  added: { connection: Connection; password: ImportPasswordOutcome }[];
  folders: Folder[];
  /** Seçilmeyen aday sayısı. */
  skipped: number;
}

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function parseImportPreviewInput(raw: unknown): Parsed<ImportPreviewRequest> {
  if (!isRecord(raw)) return { ok: false, error: 'Geçersiz içe aktarma girdisi' };
  const { pgpassPath = null, disabled = [], projectPaths = [] } = raw;
  if (!Array.isArray(projectPaths) || projectPaths.some((p) => typeof p !== 'string')) return { ok: false, error: 'Geçersiz proje yolu' };
  const projects = [...new Set((projectPaths as string[]).map((p) => p.trim()).filter((p) => p !== ''))];
  if (pgpassPath !== null && typeof pgpassPath !== 'string') return { ok: false, error: 'Geçersiz .pgpass yolu' };
  if (!Array.isArray(disabled) || disabled.some((d) => typeof d !== 'string')) return { ok: false, error: 'Geçersiz kaynak listesi' };
  const path = pgpassPath?.trim() || null;
  return { ok: true, value: { pgpassPath: path, disabled: disabled as string[], projectPaths: projects } };
}

export function parseImportApplyInput(raw: unknown): Parsed<ImportApplyRequest> {
  const preview = parseImportPreviewInput(raw);
  if (!preview.ok) return preview;
  const selections = (raw as Record<string, unknown>).selections;
  if (!Array.isArray(selections)) return { ok: false, error: 'Seçim listesi gerekli' };
  const parsed: ImportSelection[] = [];
  for (const s of selections) {
    if (!isRecord(s) || typeof s.id !== 'string') return { ok: false, error: 'Geçersiz seçim' };
    if (typeof s.name !== 'string' || s.name.trim() === '') return { ok: false, error: 'Bağlantı adı gerekli' };
    const folder = s.folder ?? null;
    if (folder !== null && typeof folder !== 'string') return { ok: false, error: 'Geçersiz klasör' };
    const envTag = s.envTag ?? null;
    if (envTag !== null && !ENV_TAGS.includes(envTag as EnvTag)) return { ok: false, error: 'Geçersiz ortam etiketi' };
    parsed.push({ id: s.id, name: s.name.trim(), folder: folder?.trim() || null, envTag: envTag as EnvTag | null });
  }
  if (new Set(parsed.map((s) => s.id)).size !== parsed.length) return { ok: false, error: 'Aynı aday iki kez seçilmiş' };
  return { ok: true, value: { ...preview.value, selections: parsed } };
}

export class CandidateNotFound extends Error {
  constructor() {
    super('Seçilen aday kaynaklarda artık yok; içe aktarmayı yeniden açın.');
  }
}

/**
 * Seçilenleri ayara ekler (çağıran bunu tek atomik yazmada yapar): klasörler adla eşleşir, yoksa
 * oluşturulur; alınmış ad `ad (2)` olur. Şifresi bulunan bağlantı keychain'e kaydedilecek olarak işaretlenir,
 * şifresizde ilk bağlanmada sorulur.
 */
export function addImported(
  settings: Settings,
  candidates: readonly ImportCandidate[],
  selections: readonly ImportSelection[],
  { newId, hasPassword }: { newId: () => string; hasPassword: (candidateId: string) => boolean },
): { connections: { connection: Connection; candidateId: string }[]; folders: Folder[] } {
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const taken = settings.connections.map((c) => c.name);
  const connections: { connection: Connection; candidateId: string }[] = [];
  const folders: Folder[] = [];
  for (const selection of selections) {
    const candidate = byId.get(selection.id);
    if (!candidate) throw new CandidateNotFound();
    let folderId: string | null = null;
    if (selection.folder !== null) {
      let folder = settings.folders.find((f) => sameName(f.name, selection.folder!));
      if (!folder) {
        folder = { id: newId(), name: selection.folder };
        settings.folders.push(folder);
        folders.push(folder);
      }
      folderId = folder.id;
    }
    const name = uniqueName(selection.name, taken);
    taken.push(name);
    const connection: Connection = {
      id: newId(),
      name,
      folderId,
      host: candidate.host,
      port: candidate.port,
      user: candidate.user,
      database: candidate.database,
      envTag: selection.envTag,
      color: selection.envTag ? DEFAULT_ENV_COLORS[selection.envTag] : null,
      savePassword: hasPassword(candidate.id),
      sslmode: candidate.sslmode,
      sslrootcert: candidate.sslrootcert,
      sslcert: candidate.sslcert,
      sslkey: candidate.sslkey,
      ssh: candidate.ssh,
      databaseSelection: candidate.databases.map((database) => ({ database, schemas: null })),
    };
    settings.connections.push(connection);
    connections.push({ connection, candidateId: candidate.id });
  }
  return { connections, folders };
}
