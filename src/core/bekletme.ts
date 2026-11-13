/**
 * "Bekletiyorsun" göstergesi: açık transaction'ın kilitle beklettiği oturumlar. Sunucu izleyicisi
 * sorguyu kısa süreli bir client'la çalıştırır; satırlar burada ayrıştırılır, arayüz burada biçimler.
 */

/** Tik aralığı: `pg_blocking_pids` sık çağrıda maliyetli olabilir. */
export const BLOCKED_TICK_MS = 5_000;

/**
 * `$1`: çalıştırmanın backend pid'i. Yetkisiz kullanıcıya başkalarının `query`'si
 * `<insufficient privilege>`, bekleme türü ve başlangıç zamanı NULL gelir; `pg_blocking_pids` yine
 * tüm oturumlara bakar, sayı doğru kalır.
 */
export const BLOCKED_SESSIONS_QUERY =
  'SELECT pid, usename, application_name, wait_event_type, left(query, 200) AS sorgu, ' +
  'floor(extract(epoch FROM now() - query_start))::int AS sure_sn ' +
  'FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid)) ORDER BY pid';

/** Bekletilen bir oturum; `null`: alan yetkiden dolayı görünmüyor. */
export interface BlockedSession {
  pid: number;
  kullanici: string | null;
  uygulama: string | null;
  beklemeTuru: string | null;
  /** Sorgunun ilk 200 karakteri. */
  sorgu: string | null;
  /** Sorgu başlayalı geçen süre (sn). */
  sureSn: number | null;
}

/** Postgres'in yetkisiz kullanıcıya gösterdiği sorgu metni. */
const INSUFFICIENT_PRIVILEGE = '<insufficient privilege>';

const text = (value: unknown): string | null => (value === null || value === undefined ? null : String(value));
const number = (value: unknown): number | null => (value === null || value === undefined ? null : Number(value));

/** Sorgu satırlarını (sayılar sayı ya da ham metin olabilir) oturumlara çevirir. */
export function parseBlockedSessions(rows: readonly Record<string, unknown>[]): BlockedSession[] {
  return rows.map((row) => {
    const sorgu = text(row.sorgu);
    return {
      pid: Number(row.pid),
      kullanici: text(row.usename),
      uygulama: text(row.application_name),
      beklemeTuru: text(row.wait_event_type),
      sorgu: sorgu === INSUFFICIENT_PRIVILEGE ? null : sorgu,
      sureSn: number(row.sure_sn),
    };
  });
}

/** İki tikin sonucu aynı mı (süre dahil); değilse olay gönderilir. */
export function sameSessions(a: readonly BlockedSession[], b: readonly BlockedSession[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Yetkiden dolayı gelmeyen alanın yazısı. */
export const HIDDEN = 'görünmüyor';

export const orHidden = (value: string | null): string => value ?? HIDDEN;

/** Bekleme süresi: "45 sn", "2 dk 5 sn", "1 sa 2 dk". */
export function formatWait(sn: number | null): string {
  if (sn === null) return HIDDEN;
  const sa = Math.floor(sn / 3600);
  const dk = Math.floor((sn % 3600) / 60);
  const s = sn % 60;
  if (sa > 0) return dk > 0 ? `${sa} sa ${dk} dk` : `${sa} sa`;
  if (dk > 0) return s > 0 ? `${dk} dk ${s} sn` : `${dk} dk`;
  return `${s} sn`;
}
