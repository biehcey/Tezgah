import { performance } from 'node:perf_hooks';
import pg from 'pg';
import type { WebSocket } from 'ws';
import type { Connection } from '../core/baglanti';
import type { RecordResult, StatementSummary, WriteLockState } from '../core/calistirma-kaydi';
import { errorLocation } from '../core/hata-konumu';
import {
  commitRequest,
  decisionDurationMs,
  decisionStatus,
  extendDecision,
  serverIdleTimeoutMs,
  startDecision,
  type DecisionTimer,
} from '../core/karar-suresi';
import { analyzeScript, blockReasons, type RunMode } from '../core/calistirma-modu';
import { splitStatements, type Statement } from '../core/ifade-bolme';
import {
  PREVIEW_ROWS,
  autocommitSummary,
  parseClientMessage,
  type ClientMessage,
  type Preview,
  type ServerEvent,
} from '../core/script-calistirma';
import type { Target } from '../core/veritabani-secimi';
import { beginStatement, writeLockBlock, writeLockState } from '../core/yazma-kilidi';
import type { SettingsStore } from './ayar-deposu';
import type { RunHistory } from './calistirma-kayitlari';
import { TargetError, catalogQuery, type PoolManager } from './havuzlar';
import type { Clock } from './saat';

export interface ScriptRunnerDeps {
  store: SettingsStore;
  pools: PoolManager;
  /** Karar süresinin yetkili zamanlayıcısı. */
  clock: Clock;
  /** Her çalıştırma (bağlantısı bulunan) bir Çalıştırma kaydına yazılır. */
  history: RunHistory;
  log: (line: string) => void;
}

/** Değerler metin olarak gelir: önizleme JSON'a kayıpsız girer (bigint, numeric, tarih). */
const RAW_TYPES = { getTypeParser: () => (value: string) => value };

/** Önizleme imleci; satırların 100'den fazlası sunucudan çekilmez. */
const CURSOR = 'tezgah_onizleme';
const CURSOR_PREFIX = `DECLARE ${CURSOR} NO SCROLL CURSOR FOR `;
/** İmleçle çalıştırılmaya çalışılan ifade türleri; olmazsa (ör. `SELECT … INTO`) düz çalışır. */
const CURSOR_COMMANDS = new Set(['SELECT', 'VALUES', 'TABLE', 'WITH']);

/** Kararın nasıl verildiği: istemciden, soket kopmasından, Karar süresinden ya da ölen bağlantıdan. */
type Decision = 'commit' | 'rollback' | 'kopma' | 'sureDoldu' | 'baglantiKoptu';

const EXPIRED = 'Süre doldu; transaction geri alındı';
const LATE_COMMIT = `${EXPIRED}; commit yapılamaz.`;
const SESSION_TIMED_OUT = 'Oturum sunucuda zaman aşımına uğradı; transaction geri alındı';
/** Postgres oturumu `idle_in_transaction_session_timeout` ile kapattı. */
const IDLE_IN_TRANSACTION_TIMEOUT = '25P03';
/** Hata alan transaction'da yalnızca ROLLBACK kabul edilir; diğer sorgular bununla döner. */
const TRANSACTION_ABORTED = '25P02';

/** Soket başına tek çalıştırma; karar verilene kadar client tutulur (ADR-0002). */
interface Run {
  /** `bitiyor`: karar verildi, transaction kapanıyor; yeni karar istekleri kabul edilmez. */
  phase: 'calisiyor' | 'karar' | 'bitiyor';
  /** İptal ya da kopma istendi; sıradaki ifadeler çalıştırılmaz. */
  stopping: 'iptal' | 'kopma' | null;
  /** Çalışan ifadeyi `pg_cancel_backend` ile durdurur; client henüz alınmadıysa yok. */
  cancel?: () => Promise<void>;
  /** Karar bekleniyorken çağrılır. */
  decide?: (decision: Decision) => void;
  /** "Uzat": `SELECT 1` gönderir ve Karar süresini baştan başlatır. */
  extend?: () => Promise<void>;
  /** Karar beklenirken işleyen Karar süresi. */
  timer?: DecisionTimer;
  commitAllowed: boolean;
  /** Çalışan ifadelerin kayıt özetleri; satır verisi içermez. */
  ifadeler: StatementSummary[];
}

type Finished = Extract<ServerEvent, { type: 'bitti' }>;
/** Çalıştırmayı bitirir: kaydın `bitti` satırını yazar, sonra istemciye `bitti` gönderir. */
type Finish = (event: Omit<Finished, 'type'>, sonuc: RecordResult) => Promise<void>;

type StatementResult =
  | { ok: true; rowCount: number | null; komut: string; onizleme?: Preview }
  | { ok: false; error: unknown; /** Hata konumundan düşülecek önek (imleç sarmalı). */ prefix: number };

/**
 * Script çalıştırma WebSocket'i. Sunucu script'i istemciye güvenmeden analiz eder; reddedilen
 * ifade varsa ya da script Karışık'sa hiçbir şey çalışmaz.
 *
 * - Transaction modu: ifadeler tek client'ta, `BEGIN` ile açılan tek transaction'da sırayla
 *   çalışır; ilk hatada durulur; sonda istemciden commit/rollback beklenir. Soket koparsa açık
 *   transaction geri alınır.
 * - Autocommit modu: ifadeler transaction'sız, sırayla ve her biri anında kalıcı çalışır; ilk
 *   hatada durulur; karar beklenmez. Soket koparsa çalışan ifade iptal edilir, kalanlar çalışmaz.
 */
export function createScriptRunner({ store, pools, clock, history, log }: ScriptRunnerDeps) {
  return function attach(ws: WebSocket) {
    let run: Run | null = null;
    /** Bu soketin son çalıştırması Karar süresi dolarak bitti; geç gelen commit buna göre reddedilir. */
    let expired = false;
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
          expired = false;
          const statements = splitStatements(message.script);
          const analysis = analyzeScript(statements);
          send({ type: 'analiz', ...analysis });
          const [blocked] = blockReasons(message.script, statements, analysis);
          if (blocked) {
            const mesaj = blocked.satir === null ? blocked.mesaj : `Satır ${blocked.satir}: ${blocked.mesaj}`;
            return send({ type: 'bitti', sonuc: 'reddedildi', mesaj });
          }
          const current: Run = { phase: 'calisiyor', stopping: null, commitAllowed: false, ifadeler: [] };
          run = current;
          // Engellenmeyen script Karışık değildir.
          execute(current, message.target, message.script, analysis.mod as Exclude<RunMode, 'karisik'>, message.yazmaModu)
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
        case 'uzat': {
          if (run?.phase !== 'karar') {
            if (message.type === 'commit' && expired) return warn('commitReddedildi', LATE_COMMIT);
            return warn('gecersizIstek', 'Karar bekleyen bir transaction yok');
          }
          // Yetkili olan sunucunun saati: zamanlayıcı geç kalsa da (uyku) süresi geçen istek işlenmez.
          if (run.timer && commitRequest(run.timer, clock.now()) === 'sureDoldu') {
            if (message.type === 'commit') warn('commitReddedildi', LATE_COMMIT);
            return run.decide?.('sureDoldu');
          }
          if (message.type === 'uzat') return void run.extend?.();
          if (message.type === 'commit' && !run.commitAllowed) {
            return warn('commitReddedildi', 'Hata alan transaction commit edilemez; yalnızca rollback yapılabilir.');
          }
          run.decide?.(message.type);
          return;
        }
      }
    }

    async function execute(current: Run, target: Target, script: string, mode: Exclude<RunMode, 'karisik'>, yazmaModu: boolean) {
      const connection = (await store.read()).connections.find((c) => c.id === target.connectionId);
      // Hedefi olmayan çalıştırma kaydedilmez: hiçbir şey çalışmadı.
      if (!connection) return send({ type: 'bitti', sonuc: 'hata', mesaj: 'Bağlantı bulunamadı' });
      const lock = writeLockState(connection.envTag, yazmaModu);
      // Salt okunur prod'da Autocommit sunucuya hiç gitmez; analizden geçmeyen script gibi kaydedilmez.
      const blocked = writeLockBlock(mode, lock);
      if (blocked) return send({ type: 'bitti', sonuc: 'reddedildi', mesaj: blocked });
      const recorder = history.begin({
        script,
        hedef: { baglantiId: connection.id, ad: connection.name, veritabani: target.database, ortam: connection.envTag },
        mod: mode,
        deneme: false,
        yazmaKilidi: lock,
      });
      // Kayıt yazılamazsa çalıştırma sürer; uyarı bir kez gider.
      let warned = false;
      const recordFailed = () => {
        if (warned) return;
        warned = true;
        warn('kayitYazilamadi', 'Çalıştırma kaydı yazılamadı');
      };
      void recorder.started.then((ok) => ok || recordFailed());
      let finished = false;
      const finish: Finish = async (event, sonuc) => {
        finished = true;
        if (!(await recorder.finish({ sonuc, mesaj: event.mesaj, ifadeler: current.ifadeler }))) recordFailed();
        send({ type: 'bitti', ...event });
      };
      try {
        await pools.withClient(connection, target.database, (client, discard) => {
          const session = { client, discard, connection, database: target.database, lock };
          return mode === 'autocommit' ? inAutocommit(current, session, script, finish) : inTransaction(current, session, script, finish);
        });
      } catch (err) {
        // `bitti` gitti; ikinci bir sonuç gönderilmez.
        if (finished) return log(`Script çalıştırma hatası: ${String(err)}`);
        if (err instanceof TargetError) return finish({ sonuc: 'hata', mesaj: err.failure.mesaj }, 'hata');
        log(`Script çalıştırma hatası: ${String(err)}`);
        await finish({ sonuc: 'hata', mesaj: 'Beklenmeyen bir hata oluştu' }, 'hata');
      }
    }

    async function inTransaction(current: Run, session: Session, script: string, finish: Finish) {
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
      /** Postgres oturumu `idle_in_transaction_session_timeout` ile kapattı (ör. dizüstü uykudayken). */
      let timedOut = false;
      let expiry: unknown;
      const markBroken = () => {
        broken = true;
        // Karar beklenirken ölen client'ın kararı beklenmez.
        if (current.phase === 'karar') current.decide?.('baglantiKoptu');
      };
      // Checkout sırasında pool'un dinleyicisi yok; bağlantı düşerse süreç çökmesin.
      const onError = (err: Error) => {
        if ((err as Partial<pg.DatabaseError>).code === IDLE_IN_TRANSACTION_TIMEOUT) timedOut = true;
        log(`Script bağlantısı düştü (${where}): ${err.message}`);
        markBroken();
      };
      client.on('error', onError);
      const lost = () =>
        finish({ sonuc: 'hata', mesaj: timedOut ? SESSION_TIMED_OUT : 'Bağlantı koptu; transaction sunucuda geri alındı.' }, 'hata');
      /** İptal ya da soket kopması: transaction geri alındı. */
      const stopped = (reason: 'iptal' | 'kopma') => finish({ sonuc: 'iptal' }, reason === 'kopma' ? 'kopma-rollback' : 'iptal');
      const rolledBack = async (reason: Decision | 'iptal') => {
        clean = await rollback(client);
        if (reason === 'kopma') log(`Soket koptu; transaction geri alındı (${where}).`);
        if (reason === 'sureDoldu') log(`Karar süresi doldu; transaction geri alındı (${where}).`);
      };
      try {
        // İptal client beklenirken geldi: hiçbir şey çalışmadı.
        if (current.stopping) {
          clean = true;
          // Transaction hiç açılmadı; geri alınan bir şey yok.
          return await finish({ sonuc: 'iptal' }, 'iptal');
        }
        // Sunucu süreç kimliği (BackendKeyData); @types/pg'de tanımlı değil.
        const pid = (client as unknown as { processID: number }).processID;
        current.cancel = () => (cancelSent ??= cancelBackend(session, pid));

        // Salt okunur prod'da `BEGIN READ ONLY`; yazma modunda pool varsayılanı `READ WRITE` ile aşılır.
        await client.query(beginStatement(session.lock));
        const sureMs = decisionDurationMs(connection.envTag);
        // Yedek: Node zamanlayıcısı işlemezken (uyku) uzak sunucuda transaction açık kalmasın.
        await client.query(`SET LOCAL idle_in_transaction_session_timeout = ${serverIdleTimeoutMs(sureMs)}`);
        const { outcome } = await runStatements(current, client, script);
        if (outcome === 'baglantiKoptu') broken = true;
        if (broken) return await lost();
        const failed = outcome === 'hata';
        if (current.stopping) {
          await cancelSent;
          await rolledBack(current.stopping);
          return await stopped(current.stopping);
        }

        current.phase = 'karar';
        current.commitAllowed = !failed;
        const decision = await new Promise<Decision>((resolve) => {
          current.decide = resolve;
          const arm = (timer: DecisionTimer) => {
            current.timer = timer;
            clock.clearTimeout(expiry);
            expiry = clock.setTimeout(() => resolve('sureDoldu'), timer.bitis - clock.now());
          };
          current.extend = async () => {
            if (!current.timer) return;
            // Süre isteğin geldiği andan başlar: SELECT 1 yoldayken eski süre dolmasın.
            const next = extendDecision(current.timer, clock.now());
            if (!next) return resolve('sureDoldu');
            arm(next);
            try {
              // Postgres'in boşta bekleme sayacını da sıfırlar.
              await client.query('SELECT 1');
            } catch (err) {
              // Hatadan sonra transaction iptal durumunda (25P02); sayaç yine sıfırlanır. Başka her
              // hata (ör. 25P03: oturum sunucuda kapandı) client'ın öldüğünü söyler.
              const code = (err as Partial<pg.DatabaseError>).code;
              if (code !== TRANSACTION_ABORTED) {
                if (code === IDLE_IN_TRANSACTION_TIMEOUT) timedOut = true;
                return markBroken();
              }
            }
            if (current.phase === 'karar') send({ type: 'uzatildi', kalanMs: decisionStatus(next, clock.now()).kalanMs });
          };
          arm(startDecision(sureMs, clock.now()));
          send({ type: 'kararBekleniyor', commitEdilebilir: !failed, kalanMs: sureMs });
        });
        current.phase = 'bitiyor';
        clock.clearTimeout(expiry);
        if (decision === 'sureDoldu') expired = true;
        if (broken) return await lost();
        if (decision === 'sureDoldu') {
          await rolledBack(decision);
          // ROLLBACK gidemediyse oturum ölmüştür; sunucu transaction'ı zaten geri aldı.
          return await finish({ sonuc: 'sureDoldu', mesaj: timedOut ? SESSION_TIMED_OUT : EXPIRED }, 'karar-suresi-doldu');
        }
        if (decision !== 'commit') {
          await rolledBack(decision);
          return await finish({ sonuc: 'rollback' }, decision === 'kopma' ? 'kopma-rollback' : 'rollback');
        }
        let commitError: unknown = null;
        try {
          await client.query('COMMIT');
        } catch (err) {
          commitError = err;
        }
        if (commitError === null) {
          clean = true;
          return await finish({ sonuc: 'commit' }, 'commit');
        }
        if (!(commitError instanceof pg.DatabaseError)) {
          return await finish({ sonuc: 'hata', mesaj: 'Commit sonucu bilinmiyor: bağlantı koptu.' }, 'hata');
        }
        // Postgres başarısız COMMIT'te transaction'ı geri alır.
        clean = true;
        await finish({ sonuc: 'hata', mesaj: `Commit başarısız; transaction geri alındı: ${commitError.message}` }, 'hata');
      } finally {
        clock.clearTimeout(expiry);
        client.off('error', onError);
        // Kapanan oturumun açık transaction'ı sunucuda geri alınır.
        if (broken || !clean || cancelSent) discard();
      }
    }

    /**
     * Transaction'sız çalıştırma: her ifade kendi örtük transaction'ında anında kalıcıdır. Karar
     * beklenmez; özet uygulanan, hatalı ve çalıştırılmayan ifadeleri sayar.
     */
    async function inAutocommit(current: Run, session: Session, script: string, finish: Finish) {
      const { client, discard, connection, database, lock } = session;
      const where = `${connection.name} / ${database}`;
      const total = splitStatements(script).length;
      let broken = false;
      /** prod yazma modunda oturumun salt okunurluğu kapatıldı; ayar pool'a sızmasın. */
      let unlocked = false;
      /** Gönderilen iptal sinyali; geç varabilir, client bu yüzden pool'a dönmez. */
      let cancelSent: Promise<void> | null = null;
      const onError = (err: Error) => {
        log(`Script bağlantısı düştü (${where}): ${err.message}`);
        broken = true;
      };
      client.on('error', onError);
      try {
        if (current.stopping) {
          return await finish({ sonuc: 'iptal', ozet: { uygulandi: 0, hatali: 0, calistirilmadi: total } }, 'iptal');
        }
        // Sunucu süreç kimliği (BackendKeyData); @types/pg'de tanımlı değil.
        const pid = (client as unknown as { processID: number }).processID;
        current.cancel = () => (cancelSent ??= cancelBackend(session, pid));
        // Transaction'sız ifadelerin her biri oturum varsayılanıyla (prod pool'unda salt okunur) açılır.
        if (lock === 'yazma-acik') {
          unlocked = true;
          await client.query('SET default_transaction_read_only = off');
        }
        const { outcome, applied } = await runStatements(current, client, script);
        const ozet = autocommitSummary(total, applied, outcome !== 'tamam');
        if (outcome === 'baglantiKoptu' || broken) {
          return await finish({ sonuc: 'hata', mesaj: 'Bağlantı koptu; çalışan ifadenin sonucu bilinmiyor.', ozet }, 'hata');
        }
        if (current.stopping) {
          await cancelSent;
          // Uygulanan ifadeler kalıcıdır; geri alınan bir şey yok, kayıtta iptal.
          if (current.stopping === 'kopma') log(`Soket koptu; autocommit durduruldu (${where}): ${applied} ifade uygulandı.`);
          return await finish({ sonuc: 'iptal', ozet }, 'iptal');
        }
        // Her ifade kendi örtük transaction'ında commit edildi.
        await finish({ sonuc: 'autocommit', ozet }, outcome === 'tamam' ? 'commit' : 'hata');
      } finally {
        client.off('error', onError);
        if (broken || cancelSent || unlocked) discard();
      }
    }

    /** İfadeleri sırayla çalıştırır; ilk hatada ya da iptal/kopmada durur. `applied`: başarılı ifade sayısı. */
    async function runStatements(
      current: Run,
      client: pg.PoolClient,
      script: string,
    ): Promise<{ outcome: 'tamam' | 'hata' | 'baglantiKoptu'; applied: number }> {
      let applied = 0;
      for (const [i, statement] of splitStatements(script).entries()) {
        if (current.stopping) return { outcome: 'tamam', applied };
        send({ type: 'started', i });
        const started = performance.now();
        const result = await runStatement(client, statement);
        const ms = Math.round(performance.now() - started);
        if (result.ok) {
          send({ type: 'done', i, ms, rowCount: result.rowCount, komut: result.komut, onizleme: result.onizleme });
          current.ifadeler.push({ offset: statement.start, ms, komut: result.komut, satirSayisi: result.rowCount });
          applied++;
          continue;
        }
        const e = result.error as Partial<pg.DatabaseError>;
        const position = e.position ? Number(e.position) - result.prefix : undefined;
        const location = errorLocation(script, statement, position !== undefined && position >= 1 ? position : undefined);
        const hata = { kod: e.code ?? null, mesaj: e.message ?? String(result.error), satir: location.satir };
        send({ type: 'error', i, ms, sqlstate: hata.kod, mesaj: hata.mesaj, ...location });
        current.ifadeler.push({ offset: statement.start, ms, komut: statement.keywords[0] ?? '', satirSayisi: null, hata });
        return { outcome: result.error instanceof pg.DatabaseError ? 'hata' : 'baglantiKoptu', applied };
      }
      return { outcome: 'tamam', applied };
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
  lock: WriteLockState;
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
