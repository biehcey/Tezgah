import type { Connection } from './baglanti';

/** `tezgah.json` şemasının sürümü. Şema değiştiğinde artırılır ve `MIGRATIONS`'a adım eklenir. */
export const SETTINGS_VERSION = 1;

/** Tek düzey klasör (iç içe yok). */
export interface Folder {
  id: string;
  name: string;
}

export interface Settings {
  version: number;
  folders: Folder[];
  connections: Connection[];
}

type RawSettings = Record<string, unknown>;
/** `n` sürümündeki ayarı `n + 1` sürümüne taşıyan adım. */
export type Migration = (settings: RawSettings) => RawSettings;

/** Sürüm → bir sonraki sürüme geçiş. İlk sürümde henüz adım yok. */
const MIGRATIONS: Record<number, Migration> = {};

export function emptySettings(): Settings {
  return { version: SETTINGS_VERSION, folders: [], connections: [] };
}

/**
 * Diskten okunan ayarı güncel sürüme taşır. Daha yeni bir Tezgah'ın yazdığı ya da biçimi
 * bozuk dosyayı reddeder; çağıran bu durumda dosyanın üzerine yazmamalı.
 */
export function migrateSettings(
  raw: unknown,
  { current = SETTINGS_VERSION, migrations = MIGRATIONS }: { current?: number; migrations?: Record<number, Migration> } = {},
): Settings {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('Ayar dosyası bir nesne değil');
  let settings = raw as RawSettings;
  if (typeof settings.version !== 'number' || !Number.isInteger(settings.version) || settings.version < 1) {
    throw new Error('Ayar dosyasında geçerli bir "version" yok');
  }
  if (settings.version > current) {
    throw new Error(`Ayar dosyası daha yeni bir Tezgah sürümüyle yazılmış (version ${settings.version})`);
  }
  while ((settings.version as number) < current) {
    const from = settings.version as number;
    const step = migrations[from];
    if (!step) throw new Error(`version ${from} için migration yok`);
    settings = step(settings);
    if (settings.version !== from + 1) throw new Error(`version ${from} migration'ı sürümü artırmadı`);
  }
  if (!Array.isArray(settings.folders) || !Array.isArray(settings.connections)) {
    throw new Error('Ayar dosyasında "folders" ya da "connections" dizi değil');
  }
  return settings as unknown as Settings;
}

export type FolderNameResult = { ok: true; name: string } | { ok: false; error: string };

/**
 * Büyük/küçük harf duyarsız eşitlik. Türkçe çevrim tek başına "BILLING"i "bıllıng" yapar, kök çevrim
 * de "İzmir"i "i̇zmir" yapar; ikisinden biri eşleşirse aynı ad sayılır.
 */
function sameName(a: string, b: string): boolean {
  const tr = (s: string) => s.toLocaleUpperCase('tr').toLocaleLowerCase('tr');
  return tr(a) === tr(b) || a.toLowerCase() === b.toLowerCase();
}

/** Klasör adı boş olamaz ve (büyük/küçük harf duyarsız) başka bir klasörünkiyle aynı olamaz. */
export function parseFolderName(raw: unknown, folders: readonly Folder[], selfId?: string): FolderNameResult {
  const input = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>).name : undefined;
  const name = typeof input === 'string' ? input.trim() : '';
  if (name === '') return { ok: false, error: 'Klasör adı gerekli' };
  if (folders.some((f) => f.id !== selfId && sameName(f.name, name))) {
    return { ok: false, error: `“${name}” adlı bir klasör zaten var` };
  }
  return { ok: true, name };
}

/** Klasörü siler; içindeki bağlantılar silinmez, Klasörsüz'e taşınır. Taşınan sayısını döndürür. */
export function deleteFolder(settings: Pick<Settings, 'folders' | 'connections'>, folderId: string): number {
  settings.folders = settings.folders.filter((f) => f.id !== folderId);
  let moved = 0;
  for (const c of settings.connections) {
    if (c.folderId === folderId) {
      c.folderId = null;
      moved++;
    }
  }
  return moved;
}

export interface DeleteFolderResponse {
  /** Klasörsüz'e taşınan bağlantı sayısı. */
  tasinan: number;
}
