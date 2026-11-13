import type { Connection } from '../core/baglanti';
import { BLOCKED_SESSIONS_QUERY, BLOCKED_TICK_MS, parseBlockedSessions, sameSessions, type BlockedSession } from '../core/bekletme';
import { PoolBusyError, catalogQuery, type PoolManager } from './havuzlar';
import type { Clock } from './saat';

export interface BlockedWatchDeps {
  pools: PoolManager;
  clock: Clock;
  log: (line: string) => void;
}

export interface BlockedWatch {
  connection: Connection;
  database: string;
  /** Açık transaction'ı tutan oturumun backend pid'i. */
  pid: number;
  /** Sonuç değişince (transaction kapanırken boş liste dahil) çağrılır. */
  onChange: (oturumlar: BlockedSession[]) => void;
}

/**
 * Açık transaction'ın kilitle beklettiği oturumları 5 sn'de bir kısa süreli bir client'la sorar.
 * Pool doluysa tik atlanır; okunamayan tik sessizce geçer (gösterge son bilineni tutar). Dönen
 * fonksiyon izlemeyi durdurur: liste boş değilse boş liste bildirilir, yoldaki tikin sonucu atılır.
 */
export function watchBlocked({ pools, clock, log }: BlockedWatchDeps, { connection, database, pid, onChange }: BlockedWatch): () => void {
  let last: BlockedSession[] = [];
  let stopped = false;
  let timer: unknown;

  const schedule = () => {
    timer = clock.setTimeout(() => void tick(), BLOCKED_TICK_MS);
  };

  async function tick() {
    try {
      const rows = await pools.withClient(connection, database, (client) => catalogQuery(client, BLOCKED_SESSIONS_QUERY, [pid]), { ifFree: true });
      const next = parseBlockedSessions(rows);
      if (stopped || sameSessions(last, next)) return;
      last = next;
      onChange(next);
    } catch (err) {
      if (!(err instanceof PoolBusyError)) log(`Bekletilen oturumlar okunamadı (${connection.name} / ${database}): ${String(err)}`);
    } finally {
      if (!stopped) schedule();
    }
  }

  schedule();
  return () => {
    if (stopped) return;
    stopped = true;
    clock.clearTimeout(timer);
    if (last.length > 0) onChange([]);
  };
}
