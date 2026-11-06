/**
 * İçe aktarma önizlemesi: bağlantı listesinin içe aktarmadan sonraki hâli. Mevcut bağlantılar ve adaylar
 * düşecekleri klasörde; henüz olmayan klasör "yeni". Arayüzden bağımsız, saf.
 */
import { sameName, type Folder } from '../ayarlar';
import type { Connection, EnvTag } from '../baglanti';
import { uniqueName } from './gruplama';
import type { ImportSelection, PreviewCandidate } from './sozlesme';

/** Önizlemede aday başına kullanıcının seçimi ve düzenlemeleri. */
export interface CandidateChoice {
  selected: boolean;
  name: string;
  /** Klasör adı; `null` klasörsüz. */
  folder: string | null;
  envTag: EnvTag | null;
}

/** Başlangıç seçimi: zaten var olan aday eşinin klasörüne düşer. */
export function initialChoice(candidate: PreviewCandidate, connections: readonly Connection[], folders: readonly Folder[]): CandidateChoice {
  let folder = candidate.folder;
  if (candidate.existing) {
    const match = connections.find((c) => c.id === candidate.existing!.id);
    folder = folders.find((f) => f.id === match?.folderId)?.name ?? null;
  }
  return { selected: candidate.selected, name: candidate.name, folder, envTag: candidate.envTag };
}

export type PreviewRow =
  | { kind: 'mevcut'; connection: Connection }
  | { kind: 'aday'; candidate: PreviewCandidate; choice: CandidateChoice; /** Kaydedilecek ad (`ad (2)`). */ name: string };

export interface PreviewSection {
  key: string;
  name: string;
  /** Klasörsüz bölümü. */
  unfiled: boolean;
  /** İçe aktarmayla oluşacak klasör. */
  isNew: boolean;
  rows: PreviewRow[];
}

/**
 * Bölümler: mevcut klasörler, sonra yeni klasörler, en altta Klasörsüz. Aday kendi klasörünün sonuna;
 * zaten var olan aday aynı klasördeyse eşinin hemen altına düşer.
 */
export function previewSections(
  connections: readonly Connection[],
  folders: readonly Folder[],
  candidates: readonly PreviewCandidate[],
  choices: Readonly<Record<string, CandidateChoice>>,
): PreviewSection[] {
  const sections: PreviewSection[] = folders.map((f) => ({ key: f.id, name: f.name, unfiled: false, isNew: false, rows: [] }));
  const unfiled: PreviewSection = { key: 'klasorsuz', name: 'Klasörsüz', unfiled: true, isNew: false, rows: [] };
  const sectionOf = (folder: string | null): PreviewSection => {
    if (folder === null) return unfiled;
    let found = sections.find((s) => sameName(s.name, folder));
    if (!found) {
      found = { key: `yeni:${folder}`, name: folder, unfiled: false, isNew: true, rows: [] };
      sections.push(found);
    }
    return found;
  };
  for (const c of connections) {
    (folders.some((f) => f.id === c.folderId) ? sections.find((s) => s.key === c.folderId)! : unfiled).rows.push({ kind: 'mevcut', connection: c });
  }
  const taken = connections.map((c) => c.name);
  for (const candidate of candidates) {
    const choice = choices[candidate.id];
    if (!choice) continue;
    const name = choice.selected ? uniqueName(choice.name, taken) : choice.name;
    if (choice.selected) taken.push(name);
    const section = sectionOf(choice.folder);
    const row: PreviewRow = { kind: 'aday', candidate, choice, name };
    const twinId = candidate.existing?.id;
    const twin = twinId === undefined ? -1 : section.rows.findIndex((r) => r.kind === 'mevcut' && r.connection.id === twinId);
    if (twin >= 0) {
      let at = twin + 1;
      while (rowTwin(section.rows[at]) === twinId) at++;
      section.rows.splice(at, 0, row);
    } else section.rows.push(row);
  }
  return [...sections.filter((s) => !s.isNew || s.rows.length > 0), unfiled];
}

function rowTwin(row: PreviewRow | undefined): string | undefined {
  return row?.kind === 'aday' ? row.candidate.existing?.id : undefined;
}

/** Seçili adayların uygulama isteğindeki hâli. */
export function selectionsOf(candidates: readonly PreviewCandidate[], choices: Readonly<Record<string, CandidateChoice>>): ImportSelection[] {
  return candidates.flatMap((c) => {
    const choice = choices[c.id];
    return choice?.selected ? [{ id: c.id, name: choice.name, folder: choice.folder, envTag: choice.envTag }] : [];
  });
}
