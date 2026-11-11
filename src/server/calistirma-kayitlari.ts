import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile, readdir } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import {
  finishedLine,
  formatLine,
  historyFileName,
  parseRecords,
  startedLine,
  type RecordLine,
  type RecordResult,
  type StartedLine,
  type StatementSummary,
} from '../core/calistirma-kaydi';
import {
  compareKeys,
  compareNewestFirst,
  encodeCursor,
  historyEntry,
  historyKey,
  matchesHistoryFilter,
  parseHistorySearchParams,
  type HistoryKey,
  type HistoryPage,
  type HistoryQuery,
} from '../core/gecmis-filtresi';
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

/**
 * `GET /api/calistirma-kayitlari`: filtreli, yeniden eskiye sayfalı kayıtlar.
 * `POST /api/calistirma-kayitlari/klasoru-ac`: klasörü (yoksa oluşturup) OS dosya yöneticisinde açar.
 */
export function createRunHistoryRoutes({ history, openFolder }: { history: RunHistory; openFolder: (dir: string) => void }) {
  return async function handle(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<boolean> {
    if (pathname === '/api/calistirma-kayitlari') {
      if (req.method !== 'GET') {
        methodNotAllowed(res);
        return true;
      }
      const parsed = parseHistorySearchParams(new URL(req.url ?? '', 'http://127.0.0.1').searchParams);
      if (!parsed.ok) json(res, 400, { hata: parsed.hata });
      else json(res, 200, await readHistoryPage(history.dir, parsed.query, parsed.cursor));
      return true;
    }
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

const MONTH_FILE = /^(\d{4})-(\d{2})\.jsonl$/;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Aylık dosyanın kayıtlarının başlama zamanı için güvenli aralık. Dosya yerel saatle seçildiğinden
 * (saat dilimi o zamandan beri değişmiş olabilir) ay sınırları bir gün genişletilir.
 */
function monthBounds(year: number, month: number): { from: number; to: number } {
  return { from: Date.UTC(year, month - 1, 1) - DAY_MS, to: Date.UTC(year, month, 1) + DAY_MS };
}

/**
 * Dosyalar yeniden eskiye okunur; sayfa dolduktan sonra kalan dosyaların hiçbir kaydı sayfaya
 * giremeyecekse durulur. İmleç son kaydın sıradaki konumudur: sayfalar arasında eklenen yeni
 * çalıştırmalar sonraki sayfayı kaydırmaz.
 */
async function readHistoryPage(dir: string, query: HistoryQuery, cursor: HistoryKey | null): Promise<HistoryPage> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { kayitlar: [], sonraki: null };
    throw err;
  }
  const files = names
    .flatMap((name) => {
      const match = MONTH_FILE.exec(name);
      return match ? [{ name, ...monthBounds(Number(match[1]), Number(match[2])) }] : [];
    })
    .sort((a, b) => (a.name < b.name ? 1 : -1));
  const cursorAt = cursor ? Date.parse(cursor.zaman) : Infinity;
  const found = [];
  for (const file of files) {
    if (file.from > cursorAt) continue;
    // Sayfa + "sonraki var mı" için limit + 1 kayıt yeter; bu dosya o kayıttan yenisini içeremez.
    const boundary = found.length > query.limit ? found.sort(compareNewestFirst)[query.limit]! : null;
    if (boundary && Date.parse(boundary.basladi.zaman) >= file.to) break;
    let text: string;
    try {
      text = await readFile(join(dir, file.name), 'utf8');
    } catch (err) {
      // Okunurken silinen dosya boştur; okunamayan dosya (izin, kilit) sessizce kayıt düşürmesin.
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      text = '';
    }
    for (const record of parseRecords(text)) {
      if (cursor && compareKeys(historyKey(record), cursor) >= 0) continue;
      if (matchesHistoryFilter(record, query)) found.push(record);
    }
  }
  found.sort(compareNewestFirst);
  const page = found.slice(0, query.limit);
  return {
    kayitlar: page.map(historyEntry),
    sonraki: found.length > query.limit ? encodeCursor(historyKey(page.at(-1)!)) : null,
  };
}
