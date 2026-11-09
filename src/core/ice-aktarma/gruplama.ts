/**
 * Kaynaklardan (`.pgpass` satırları, ileride IntelliJ data source'ları) çıkan adayların İçe aktarma
 * adaylarında birleştirilmesi ve mevcut Bağlantılarla çakışmanın tespiti. IO yok.
 */
import type { Connection, EnvTag, SshSettings, SslSettings } from '../baglanti';

/** Adayın geldiği kaynak: kaynak kimliği (çip) ve ayrıntılı etiket (ör. `.pgpass satır 3`). */
export interface CandidateSource {
  id: string;
  label: string;
}

/** Tek bir kaynaktan çıkan, henüz birleştirilmemiş aday. */
export interface SourceCandidate extends SslSettings {
  source: CandidateSource;
  name: string;
  host: string;
  port: number;
  user: string;
  /** Başlangıç veritabanı. */
  database: string;
  /** Görünür veritabanları (Veritabanı seçimi). */
  databases: string[];
  ssh: SshSettings | null;
  /** Önerilen ortam etiketi ve gerekçesi (ör. `read-only="true"` → prod). */
  envTag: EnvTag | null;
  envReason: string | null;
  /** Önerilen klasör adı; `null` klasörsüz. */
  folder: string | null;
  warnings: string[];
  /** Tünel eşlenemedi (ProxyJump, bulunamayan referans): aday varsayılan olarak seçilmez. */
  tunnelUnmapped: boolean;
}

/** Önizlemede gösterilen İçe aktarma adayı; şifre değeri burada yoktur. */
export interface ImportCandidate extends Omit<SourceCandidate, 'source' | 'tunnelUnmapped'> {
  /** Kimlik anahtarından türetilir; aynı kaynaklar yeniden tarandığında aynı kalır. */
  id: string;
  sources: CandidateSource[];
  /** Aynı anahtarlı mevcut Bağlantı ("zaten var"). */
  existing: { id: string; name: string } | null;
  /** Varsayılan seçim: zaten var olan ya da tüneli eşlenemeyen aday seçilmez. */
  selected: boolean;
}

type Identity = Pick<SourceCandidate, 'host' | 'port' | 'user' | 'ssh'>;

/** Kimlik anahtarı `(host, port, kullanıcı, SSH host/port/kullanıcı)`; host adları büyük/küçük harf duyarsız. */
export function identityKey({ host, port, user, ssh }: Identity): string {
  return JSON.stringify([host.toLowerCase(), port, user, ssh?.host.toLowerCase() ?? null, ssh?.port ?? null, ssh?.user ?? null]);
}

/**
 * Aynı anahtarlı kaynakları ilk görülme sırasıyla tek adayda birleştirir. Ad, başlangıç veritabanı,
 * SSL ve tünel ilk kaynaktan; Veritabanı seçimi birleşim; etiket ve klasör ilk dolu olandan.
 */
export function groupCandidates(sources: readonly SourceCandidate[], connections: readonly Connection[]): ImportCandidate[] {
  const groups = new Map<string, { candidate: ImportCandidate; unmapped: boolean }>();
  for (const s of sources) {
    // Tüneli eşlenemeyen kaynağın gerçek kimliği bilinmez: doğrudan adaylarla ve mevcut bağlantılarla birleşmez.
    const key = s.tunnelUnmapped ? JSON.stringify(['tunel-eslenemedi', identityKey(s)]) : identityKey(s);
    const group = groups.get(key);
    if (!group) {
      const { source, tunnelUnmapped, ...fields } = s;
      groups.set(key, {
        candidate: { ...fields, id: key, databases: [...s.databases], warnings: [...new Set(s.warnings)], sources: [source], existing: null, selected: true },
        unmapped: tunnelUnmapped,
      });
      continue;
    }
    const c = group.candidate;
    c.sources.push(s.source);
    for (const d of s.databases) if (!c.databases.includes(d)) c.databases.push(d);
    for (const w of s.warnings) if (!c.warnings.includes(w)) c.warnings.push(w);
    if (c.envTag === null && s.envTag !== null) {
      c.envTag = s.envTag;
      c.envReason = s.envReason;
    }
    c.folder ??= s.folder;
    group.unmapped ||= s.tunnelUnmapped;
  }

  const existingByKey = new Map<string, Connection>();
  for (const c of connections) {
    const key = identityKey(c);
    if (!existingByKey.has(key)) existingByKey.set(key, c);
  }
  return [...groups.values()].map(({ candidate, unmapped }) => {
    if (!candidate.databases.includes(candidate.database)) candidate.databases.unshift(candidate.database);
    const match = existingByKey.get(candidate.id);
    if (match) {
      candidate.existing = { id: match.id, name: match.name };
      candidate.name = match.name;
    }
    candidate.selected = !match && !unmapped;
    return candidate;
  });
}

/** Alınmamış ad aynen kalır; alınmışsa `ad (2)`, `ad (3)`… */
export function uniqueName(name: string, taken: Iterable<string>): string {
  const names = new Set(taken);
  if (!names.has(name)) return name;
  let n = 2;
  while (names.has(`${name} (${n})`)) n++;
  return `${name} (${n})`;
}
