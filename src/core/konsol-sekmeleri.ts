/**
 * Konsol sekmeleri (ADR-0003): diske yazılan biçim ve sekme geçişleri. Biçimde yalnızca sekmenin
 * kendisi (sıra, aktif sekme, tür, hedef, metin/tablo) vardır; Yazma kilidi, sonuçlar ve Bekleyen
 * değişiklikler yazılmaz, geri gelen sekme her zaman 🔒 açılır ve hiçbir yere bağlanmaz.
 */

/** Sekme dosyası biçiminin sürümü; biçim değişince artırılır. */
export const TABS_VERSION = 1;

/**
 * Sekmenin hedefi. Şema yalnızca panel ve Tablo sekmesi bağlamıdır: `search_path`'i değiştirmez,
 * çalıştırmanın hedefi bağlantı + veritabanıdır.
 */
export interface TabTarget {
  connectionId: string;
  database: string;
  schema: string | null;
}

export interface ConsoleTab {
  id: string;
  tur: 'konsol';
  hedef: TabTarget | null;
  metin: string;
}

/** Tablo sekmesi (ticket 09/10): biçimde şimdiden tanımlı. */
export interface TableTab {
  id: string;
  tur: 'tablo';
  hedef: TabTarget | null;
  sema: string;
  tablo: string;
  where: string;
  orderBy: string;
}

export type SavedTab = ConsoleTab | TableTab;

export interface SavedTabs {
  version: number;
  sekmeler: SavedTab[];
  /** Aktif sekmenin kimliği; sekme yoksa `null`. */
  aktif: string | null;
}

/** Sekme dosyası bir nesne değil ya da daha yeni bir Tezgah'ın yazdığı biçimde. */
export class TabsFormatError extends Error {
  constructor(
    message: string,
    /** Daha yeni bir Tezgah'ın biçimi: üzerine yazılmamalı. */
    readonly newer = false,
  ) {
    super(message);
    this.name = 'TabsFormatError';
  }
}

type Raw = Record<string, unknown>;
const isObject = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);
const isString = (v: unknown): v is string => typeof v === 'string';

function parseTarget(raw: unknown): TabTarget | null | undefined {
  if (raw === null) return null;
  if (!isObject(raw)) return undefined;
  const { connectionId, database, schema } = raw;
  if (!isString(connectionId) || connectionId === '' || !isString(database) || database === '') return undefined;
  if (schema !== null && schema !== undefined && !isString(schema)) return undefined;
  return { connectionId, database, schema: schema ?? null };
}

/** Bir sekme; bozuksa `null` (atlanır). Bilinmeyen alanlar (ör. eski bir kilit) düşer. */
function parseTab(raw: unknown): SavedTab | null {
  if (!isObject(raw) || !isString(raw.id) || raw.id === '') return null;
  const hedef = parseTarget(raw.hedef);
  if (hedef === undefined) return null;
  if (raw.tur === 'konsol') {
    if (!isString(raw.metin)) return null;
    return { id: raw.id, tur: 'konsol', hedef, metin: raw.metin };
  }
  if (raw.tur === 'tablo') {
    const { sema, tablo, where = '', orderBy = '' } = raw;
    if (!isString(sema) || !isString(tablo) || tablo === '' || !isString(where) || !isString(orderBy)) return null;
    return { id: raw.id, tur: 'tablo', hedef, sema, tablo, where, orderBy };
  }
  return null;
}

/**
 * Diskten (ya da istek gövdesinden) gelen sekmeleri okur. Toleranslıdır: bozuk ya da aynı kimlikli
 * ikinci sekme atlanır, kalanlar geri gelir; aktif sekme yoksa ilk sekme aktiftir. Yalnızca dosyanın
 * kendisi okunamıyorsa (nesne değil, daha yeni sürüm) `TabsFormatError` fırlatır; çağıran bu durumda
 * dosyanın üzerine yazmamalı.
 */
export function parseTabs(raw: unknown): SavedTabs {
  if (!isObject(raw)) throw new TabsFormatError('Sekme dosyası bir nesne değil');
  if (typeof raw.version !== 'number') throw new TabsFormatError('Sekme dosyasında sürüm yok');
  if (raw.version > TABS_VERSION) {
    throw new TabsFormatError(`Sekme dosyası daha yeni bir Tezgah sürümüyle yazılmış (version ${raw.version})`, true);
  }
  const sekmeler: SavedTab[] = [];
  for (const item of Array.isArray(raw.sekmeler) ? raw.sekmeler : []) {
    const tab = parseTab(item);
    if (tab && !sekmeler.some((t) => t.id === tab.id)) sekmeler.push(tab);
  }
  const aktif = sekmeler.find((t) => t.id === raw.aktif)?.id ?? sekmeler[0]?.id ?? null;
  return { version: TABS_VERSION, sekmeler, aktif };
}

export function emptyTabs(): SavedTabs {
  return { version: TABS_VERSION, sekmeler: [], aktif: null };
}

// ---------- Açık sekmeler (çalışma zamanı) ----------

/** Açık sekme: kayıtlı alanlar + yalnızca bellekte tutulan Yazma kilidi (sekme ve hedef başına). */
export type OpenTab = SavedTab & { yazmaModu: boolean };

export interface ConsoleState {
  tabs: OpenTab[];
  active: string | null;
}

export function sameTabTarget(a: TabTarget | null, b: TabTarget | null): boolean {
  if (a === null || b === null) return a === b;
  return a.connectionId === b.connectionId && a.database === b.database && a.schema === b.schema;
}

/** Başka bir sekmenin aynı hedefte açık oturumu; şeritteki sırasıyla adlandırılır. */
export interface SessionTab {
  id: string;
  ad: string;
}

/**
 * `id` sekmesiyle aynı hedefte (bağlantı + veritabanı; şema fark etmez) Açık oturumu olan diğer
 * sekmeler. `openSessions`: açık oturumu olan sekmelerin kimlikleri. Aynı hedefin sekmeleri aynı
 * başlığı taşıdığından `Sekme N` (şeritteki sıra) diye adlandırılır.
 */
export function sessionTabs(state: ConsoleState, id: string, openSessions: ReadonlySet<string>): SessionTab[] {
  const hedef = state.tabs.find((t) => t.id === id)?.hedef;
  if (!hedef) return [];
  return state.tabs.flatMap((other, index) =>
    other.id !== id &&
    openSessions.has(other.id) &&
    other.hedef?.connectionId === hedef.connectionId &&
    other.hedef.database === hedef.database
      ? [{ id: other.id, ad: `Sekme ${index + 1}` }]
      : [],
  );
}

/**
 * Kayıtlı sekmeleri açar: Yazma kilidi her zaman kapalı; artık olmayan bağlantıya işaret eden
 * sekme hedefsiz açılır, metni korunur.
 */
export function restoreTabs(saved: SavedTabs, connectionIds: readonly string[]): ConsoleState {
  return {
    tabs: saved.sekmeler.map((t) => ({
      ...t,
      hedef: t.hedef && connectionIds.includes(t.hedef.connectionId) ? t.hedef : null,
      yazmaModu: false,
    })),
    active: saved.aktif,
  };
}

/** Diske yazılacak biçim: yalnızca biçimdeki alanlar; Yazma kilidi düşer. */
export function savedTabs(state: ConsoleState): SavedTabs {
  const sekmeler = state.tabs.map((t): SavedTab => {
    const hedef = t.hedef && { connectionId: t.hedef.connectionId, database: t.hedef.database, schema: t.hedef.schema };
    return t.tur === 'konsol'
      ? { id: t.id, tur: 'konsol', hedef, metin: t.metin }
      : { id: t.id, tur: 'tablo', hedef, sema: t.sema, tablo: t.tablo, where: t.where, orderBy: t.orderBy };
  });
  return { version: TABS_VERSION, sekmeler, aktif: state.active };
}

/** Konsol sekmesi (varsayılan boş) aktif sekmenin sağında açılır ve aktif olur; kilit kapalı. */
export function openConsoleTab(state: ConsoleState, id: string, hedef: TabTarget | null, metin = ''): ConsoleState {
  const tab: OpenTab = { id, tur: 'konsol', hedef, metin, yazmaModu: false };
  const at = state.tabs.findIndex((t) => t.id === state.active);
  const tabs = [...state.tabs];
  tabs.splice(at === -1 ? tabs.length : at + 1, 0, tab);
  return { tabs, active: id };
}

export function activateTab(state: ConsoleState, id: string): ConsoleState {
  return state.tabs.some((t) => t.id === id) ? { ...state, active: id } : state;
}

/** Aktif sekme kapanırsa sağındaki, yoksa solundaki aktif olur. */
export function closeTab(state: ConsoleState, id: string): ConsoleState {
  const at = state.tabs.findIndex((t) => t.id === id);
  if (at === -1) return state;
  const tabs = state.tabs.filter((t) => t.id !== id);
  const active = state.active === id ? (tabs[at] ?? tabs[at - 1])?.id ?? null : state.active;
  return { tabs, active };
}

function updateTab(state: ConsoleState, id: string, change: (tab: OpenTab) => OpenTab): ConsoleState {
  return { ...state, tabs: state.tabs.map((t) => (t.id === id ? change(t) : t)) };
}

/** Sekmenin hedefi değişince Yazma kilidi kapanır; aynı hedef yeniden seçilirse kalır. */
export function setTabTarget(state: ConsoleState, id: string, hedef: TabTarget | null): ConsoleState {
  return updateTab(state, id, (t) => (sameTabTarget(t.hedef, hedef) ? t : { ...t, hedef, yazmaModu: false }));
}

export function setTabScript(state: ConsoleState, id: string, metin: string): ConsoleState {
  return updateTab(state, id, (t) => (t.tur === 'konsol' && t.metin !== metin ? { ...t, metin } : t));
}

/** 🔒/🔓: yalnızca bu sekmenin kilidi değişir. */
export function toggleWriteMode(state: ConsoleState, id: string): ConsoleState {
  return updateTab(state, id, (t) => ({ ...t, yazmaModu: !t.yazmaModu }));
}

/** Silinen bağlantıya işaret eden sekmeler hedefsiz kalır. */
export function forgetConnection(state: ConsoleState, connectionId: string): ConsoleState {
  return {
    ...state,
    tabs: state.tabs.map((t) => (t.hedef?.connectionId === connectionId ? { ...t, hedef: null, yazmaModu: false } : t)),
  };
}
