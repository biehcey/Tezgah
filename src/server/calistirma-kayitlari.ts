import { randomUUID } from 'node:crypto';
import { appendFile, mkdir } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import {
  finishedLine,
  formatLine,
  historyFileName,
  startedLine,
  type RecordLine,
  type RecordResult,
  type StartedLine,
  type StatementSummary,
} from '../core/calistirma-kaydi';
import { json, methodNotAllowed } from './http';

/** Yapılandırma dizininde Çalıştırma kayıtlarının alt dizini. */
export const HISTORY_DIR = 'history';

/** Takılan bir yazma (ör. ağ sürücüsü) çalıştırmanın bitişini bundan fazla geciktirmez. */
const WRITE_TIMEOUT_MS = 2_000;

export type RunStart = Omit<StartedLine, 'v' | 'tur' | 'runId' | 'zaman'>;

/** Tek çalıştırmanın kaydı. Yazma hataları fırlatılmaz; `false` döner. */
export interface RunRecorder {
  /** `başladı` satırı yazıldı mı. */
  started: Promise<boolean>;
  /** `bitti` satırını yazar; yalnızca ilk çağrı yazar. */
  finish(result: { sonuc: RecordResult; mesaj?: string; ifadeler: StatementSummary[] }): Promise<boolean>;
}

export interface RunHistory {
  dir: string;
  begin(start: RunStart): RunRecorder;
}

/**
 * Çalıştırma kayıtları: `history/YYYY-MM.jsonl` dosyalarına eklenir (POSIX'te `0600`). Satırlar
 * tek kuyrukta sırayla yazılır; bir çalıştırmanın iki satırı başladığı ayın dosyasına gider.
 */
export function createRunHistory({
  configDir,
  now = () => new Date(),
  log,
}: {
  configDir: string;
  now?: () => Date;
  log: (line: string) => void;
}): RunHistory {
  const dir = join(configDir, HISTORY_DIR);
  let queue: Promise<unknown> = Promise.resolve();

  function append(file: string, line: RecordLine): Promise<boolean> {
    const write = queue.then(async () => {
      await mkdir(dir, { recursive: true, mode: 0o700 });
      await appendFile(join(dir, file), formatLine(line), { encoding: 'utf8', mode: 0o600 });
    });
    queue = write.catch(() => {});
    return withTimeout(write).then(
      () => true,
      (err: unknown) => {
        log(`Çalıştırma kaydı yazılamadı (${line.runId}): ${String(err)}`);
        return false;
      },
    );
  }

  return {
    dir,
    begin(start) {
      const runId = randomUUID();
      const baslangic = now();
      const file = historyFileName(baslangic);
      let finished: Promise<boolean> | null = null;
      return {
        started: append(file, startedLine({ runId, zaman: baslangic, ...start })),
        finish: (result) => (finished ??= append(file, finishedLine({ runId, baslangic, bitis: now(), ...result }))),
      };
    },
  };
}

function withTimeout(write: Promise<void>): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('zaman aşımı')), WRITE_TIMEOUT_MS);
    timer.unref();
  });
  return Promise.race([write, timeout]).finally(() => clearTimeout(timer));
}

/** `/api/calistirma-kayitlari/klasoru-ac`: klasörü (yoksa oluşturup) OS dosya yöneticisinde açar. */
export function createRunHistoryRoutes({ history, openFolder }: { history: RunHistory; openFolder: (dir: string) => void }) {
  return async function handle(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<boolean> {
    if (pathname !== '/api/calistirma-kayitlari/klasoru-ac') return false;
    if (req.method !== 'POST') {
      methodNotAllowed(res);
      return true;
    }
    await mkdir(history.dir, { recursive: true, mode: 0o700 });
    openFolder(history.dir);
    json(res, 200, { klasor: history.dir });
    return true;
  };
}
