import { performance } from 'node:perf_hooks';
import pg from 'pg';
import type { WebSocket } from 'ws';
import type { Connection } from '../core/baglanti';
import { errorLocation } from '../core/hata-konumu';
import { splitStatements, type Statement } from '../core/ifade-bolme';
import {
  PREVIEW_ROWS,
  parseClientMessage,
  type ClientMessage,
  type Preview,
  type ServerEvent,
} from '../core/script-calistirma';
import type { Target } from '../core/veritabani-secimi';
import type { SettingsStore } from './ayar-deposu';
import { TargetError, catalogQuery, type PoolManager } from './havuzlar';

export interface ScriptRunnerDeps {
  store: SettingsStore;
  pools: PoolManager;
  log: (line: string) => void;
}

/** Değerler metin olarak gelir: önizleme JSON'a kayıpsız girer (bigint, numeric, tarih). */
const RAW_TYPES = { getTypeParser: () => (value: string) => value };

/** Önizleme imleci; satırların 100'den fazlası sunucudan çekilmez. */
const CURSOR = 'tezgah_onizleme';
const CURSOR_PREFIX = `DECLARE ${CURSOR} NO SCROLL CURSOR FOR `;
/** İmleçle çalıştırılmaya çalışılan ifade türleri; olmazsa (ör. `SELECT … INTO`) düz çalışır. */
const CURSOR_COMMANDS = new Set(['SELECT', 'VALUES', 'TABLE', 'WITH']);

type Decision = 'commit' | 'rollback' | 'kopma';

/** Soket başına tek çalıştırma; karar verilene kadar client tutulur (ADR-0002). */
interface Run {
  phase: 'calisiyor' | 'karar';
  /** İptal ya da kopma istendi; sıradaki ifadeler çalıştırılmaz. */
  stopping: 'iptal' | 'kopma' | null;
  /** Çalışan ifadeyi `pg_cancel_backend` ile durdurur; client henüz alınmadıysa yok. */
  cancel?: () => Promise<void>;
  /** Karar bekleniyorken çağrılır. */
  decide?: (decision: Decision) => void;
  commitAllowed: boolean;
}

type StatementResult =
  | { ok: true; rowCount: number | null; komut: string; onizleme?: Preview }
  | { ok: false; error: unknown; /** Hata konumundan düşülecek önek (imleç sarmalı). */ prefix: number };

/**
 * Script çalıştırma WebSocket'i (Transaction modu). İfadeler tek client'ta, `BEGIN` ile açılan tek
 * transaction'da sırayla çalışır; ilk hatada durulur; sonda istemciden commit/rollback beklenir.
 * Soket koparsa açık transaction geri alınır.
 */
export function createScriptRunner({ store, pools, log }: ScriptRunnerDeps) {
  return function attach(ws: WebSocket) {
    let run: Run | null = null;
    let open = true;
    const send = (event: ServerEvent) => {
      if (open) ws.send(JSON.stringify(event));
    };
    const warn = (tur: Extract<ServerEvent, { type: 'uyari' }>['tur'], mesaj: string) => send({ type: 'uyari', tur, mesaj });

    ws.on('message', (data) => {
      let message: ClientMessage | null = null;
      try {
        message = parseClientMessage(JSON.parse(String(data)));
      } catch {
        // geçersiz JSON
      }
      if (!message) return warn('gecersizIstek', 'Tanınmayan istek');
      handle(message);
    });

    ws.on('close', () => {
      open = false;
      if (!run) return;
      if (run.phase === 'karar') return run.decide?.('kopma');
      run.stopping = 'kopma';
      void run.cancel?.();
    });

    function handle(message: ClientMessage) {
      switch (message.type) {
        case 'run': {
          if (run) return warn('mesgul', 'Bu sekmede zaten bir çalıştırma var');
          const current: Run = { phase: 'calisiyor', stopping: null, commitAllowed: false };
          run = current;
          execute(current, message.target, message.script)
            .catch((err: unknown) => {
              log(`Script çalıştırma hatası: ${String(err)}`);
              send({ type: 'bitti', sonuc: 'hata', mesaj: 'Beklenmeyen bir hata oluştu' });
            })
            .finally(() => {
              if (run === current) run = null;
            });
          return;
        }
        case 'iptal':
          if (run?.phase !== 'calisiyor') return warn('gecersizIstek', 'Çalışan bir script yok');
          if (run.stopping) return;
          run.stopping = 'iptal';
          void run.cancel?.();
          return;
        case 'commit':
        case 'rollback':
          if (run?.phase !== 'karar') return warn('gecersizIstek', 'Karar bekleyen bir transaction yok');
          if (message.type === 'commit' && !run.commitAllowed) {
            return warn('commitReddedildi', 'Hata alan transaction commit edilemez; yalnızca rollback yapılabilir.');
          }
          run.decide?.(message.type);
          return;
      }
    }

    async function execute(current: Run, target: Target, script: string) {
      const connection = (await store.read()).connections.find((c) => c.id === target.connectionId);
      if (!connection) return send({ type: 'bitti', sonuc: 'hata', mesaj: 'Bağlantı bulunamadı' });
      try {
        await pools.withClient(connection, target.database, (client, discard) =>
          inTransaction(current, { client, discard, connection, database: target.database }, script),
        );
      } catch (err) {
        if (!(err instanceof TargetError)) throw err;
        send({ type: 'bitti', sonuc: 'hata', mesaj: err.failure.mesaj });
      }
    }

    async function inTransaction(current: Run, session: Session, script: string) {
      const { client, discard, connection, database } = session;
      const where = `${connection.name} / ${database}`;
      let broken = false;
      /**
       * Gönderilen iptal sinyali. Sinyal ifade bittikten sonra varabilir; client bu yüzden pool'a
       * dönmez, yoksa sinyal o oturumun sıradaki sorgusunu (başka bir sekmenin) iptal edebilirdi.
       */
      let cancelSent: Promise<void> | null = null;
      /** Transaction COMMIT ya da ROLLBACK ile kapandı; client pool'a temiz dönebilir. */
      let clean = false;
      // Checkout sırasında pool'un dinleyicisi yok; bağlantı düşerse süreç çökmesin.
      const onError = (err: Error) => {
        broken = true;
        log(`Script bağlantısı düştü (${where}): ${err.message}`);
      };
      client.on('error', onError);
      const lost = () => send({ type: 'bitti', sonuc: 'hata', mesaj: 'Bağlantı koptu; transaction sunucuda geri alındı.' });
      const rolledBack = async (reason: Decision | 'iptal') => {
        clean = await rollback(client);
        if (reason === 'kopma') log(`Soket koptu; transaction geri alındı (${where}).`);
      };
      try {
        // İptal client beklenirken geldi: hiçbir şey çalışmadı.
        if (current.stopping) {
          clean = true;
          return send({ type: 'bitti', sonuc: 'iptal' });
        }
        // Sunucu süreç kimliği (BackendKeyData); @types/pg'de tanımlı değil.
        const pid = (client as unknown as { processID: number }).processID;
        current.cancel = () => (cancelSent ??= cancelBackend(session, pid));

        await client.query('BEGIN');
        const outcome = await runStatements(current, client, script);
        if (outcome === 'baglantiKoptu') broken = true;
        if (broken) return lost();
        const failed = outcome === 'hata';
        if (current.stopping) {
          await cancelSent;
          await rolledBack(current.stopping);
          return send({ type: 'bitti', sonuc: 'iptal' });
        }

        current.phase = 'karar';
        current.commitAllowed = !failed;
        const decision = await new Promise<Decision>((resolve) => {
          current.decide = resolve;
          send({ type: 'kararBekleniyor', commitEdilebilir: !failed });
        });
        if (broken) return lost();
        if (decision !== 'commit') {
          await rolledBack(decision);
          return send({ type: 'bitti', sonuc: 'rollback' });
        }
        try {
          await client.query('COMMIT');
          clean = true;
          send({ type: 'bitti', sonuc: 'commit' });
        } catch (err) {
          if (!(err instanceof pg.DatabaseError)) {
            return send({ type: 'bitti', sonuc: 'hata', mesaj: 'Commit sonucu bilinmiyor: bağlantı koptu.' });
          }
          // Postgres başarısız COMMIT'te transaction'ı geri alır.
          clean = true;
          send({ type: 'bitti', sonuc: 'hata', mesaj: `Commit başarısız; transaction geri alındı: ${err.message}` });
        }
      } finally {
        client.off('error', onError);
        // Kapanan oturumun açık transaction'ı sunucuda geri alınır.
        if (broken || !clean || cancelSent) discard();
      }
    }

    /** İfadeleri sırayla çalıştırır; ilk hatada ya da iptal/kopmada durur. */
    async function runStatements(current: Run, client: pg.PoolClient, script: string): Promise<'tamam' | 'hata' | 'baglantiKoptu'> {
      for (const [i, statement] of splitStatements(script).entries()) {
        if (current.stopping) return 'tamam';
        send({ type: 'started', i });
        const started = performance.now();
        const result = await runStatement(client, statement);
        const ms = Math.round(performance.now() - started);
        if (result.ok) {
          send({ type: 'done', i, ms, rowCount: result.rowCount, komut: result.komut, onizleme: result.onizleme });
          continue;
        }
        const e = result.error as Partial<pg.DatabaseError>;
        const position = e.position ? Number(e.position) - result.prefix : undefined;
        const location = errorLocation(script, statement, position !== undefined && position >= 1 ? position : undefined);
        send({ type: 'error', i, ms, sqlstate: e.code ?? null, mesaj: e.message ?? String(result.error), ...location });
        return result.error instanceof pg.DatabaseError ? 'hata' : 'baglantiKoptu';
      }
      return 'tamam';
    }

    async function cancelBackend({ connection, database }: Session, pid: number): Promise<void> {
      try {
        await pools.withClient(connection, database, (c) => catalogQuery(c, 'SELECT pg_cancel_backend($1)', [pid]));
      } catch (err) {
        log(`İptal gönderilemedi: ${String(err)}`);
      }
    }
  };
}

/** Script'in tuttuğu client ve hedefi. */
interface Session {
  client: pg.PoolClient;
  /** Client'ı pool'a döndürmeden kapatır. */
  discard: () => void;
  connection: Connection;
  database: string;
}

/** Geri alındıysa `true`; alınamayan client pool'a dönmemeli. */
async function rollback(client: pg.PoolClient): Promise<boolean> {
  try {
    await client.query('ROLLBACK');
    return true;
  } catch {
    return false;
  }
}

async function runStatement(client: pg.PoolClient, statement: Statement): Promise<StatementResult> {
  if (CURSOR_COMMANDS.has(statement.keywords[0] ?? '')) {
    const viaCursor = await runWithCursor(client, statement);
    if (viaCursor) return viaCursor;
  }
  try {
    const raw = await client.query({ text: statement.text, rowMode: 'array', types: RAW_TYPES });
    const result = Array.isArray(raw) ? (raw.at(-1) as pg.QueryArrayResult) : raw;
    const onizleme = result.fields.length > 0 ? preview(result) : undefined;
    return { ok: true, rowCount: result.rowCount, komut: result.command ?? statement.keywords[0] ?? '', onizleme };
  } catch (error) {
    return { ok: false, error, prefix: 0 };
  }
}

/**
 * SELECT benzeri ifadeyi bir savepoint içinde imleçle çalıştırır: ilk 100 satır çekilir, kalanı
 * `MOVE` ile sayılır ama istemciye aktarılmaz. İmleç bu ifadeyi kabul etmezse `null` döner ve
 * transaction savepoint'e geri sarılır (ifade düz çalıştırılır).
 */
async function runWithCursor(client: pg.PoolClient, statement: Statement): Promise<StatementResult | null> {
  /** Sorgu metni artık imleç önekli; hata konumundan önek düşülür. */
  let wrapped = false;
  try {
    await client.query(`SAVEPOINT ${CURSOR}`);
    wrapped = true;
    try {
      await client.query(CURSOR_PREFIX + statement.text);
    } catch (error) {
      if (!rejectedByDeclare(error)) throw error;
      await client.query(`ROLLBACK TO SAVEPOINT ${CURSOR}`);
      await client.query(`RELEASE SAVEPOINT ${CURSOR}`);
      return null;
    }
    const fetched = await client.query({ text: `FETCH ${PREVIEW_ROWS} FROM ${CURSOR}`, rowMode: 'array', types: RAW_TYPES });
    const rest = await client.query(`MOVE FORWARD ALL IN ${CURSOR}`);
    await client.query(`CLOSE ${CURSOR}`);
    await client.query(`RELEASE SAVEPOINT ${CURSOR}`);
    return { ok: true, rowCount: (fetched.rowCount ?? 0) + (rest.rowCount ?? 0), komut: 'SELECT', onizleme: preview(fetched) };
  } catch (error) {
    return { ok: false, error, prefix: wrapped ? CURSOR_PREFIX.length : 0 };
  }
}

/**
 * DECLARE ayrıştırma ya da çözümlemede (sınıf 42 ve 0A) düştü: imlecin kabul etmediği ifade
 * (`SELECT … INTO` → 42601, WITH içinde veri değiştiren → 0A000) ya da kullanıcının yazım hatası.
 * Bu aşamanın yan etkisi yoktur; ifade düz çalıştırılır ve gerçek hata konumu oradan gelir.
 * İptal, kilit zaman aşımı gibi hatalarda ifade yeniden çalıştırılmaz.
 */
function rejectedByDeclare(error: unknown): boolean {
  const code = error instanceof pg.DatabaseError ? (error.code ?? '') : '';
  return code.startsWith('42') || code.startsWith('0A');
}

function preview(result: pg.QueryArrayResult): Preview {
  return {
    kolonlar: result.fields.map((f) => f.name),
    satirlar: result.rows.slice(0, PREVIEW_ROWS).map((row) => row.map((v) => (v === null ? null : String(v)))),
  };
}
