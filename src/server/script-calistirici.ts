import { performance } from 'node:perf_hooks';
import pg from 'pg';
import type { WebSocket } from 'ws';
import type { Connection } from '../core/baglanti';
import type { RecordResult, StatementSummary } from '../core/calistirma-kaydi';
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
import { analyzeScript, forceTransaction, type RunMode } from '../core/calistirma-modu';
import {
  DML_VERBS,
  LOCK_NOT_AVAILABLE,
  LOCK_NOT_AVAILABLE_MESSAGE,
  OLD_NEW_MIN_VERSION,
  ddlTargets,
  decodeOldNew,
  denemeLockTimeout,
  dmlTarget,
  oldNewSelect,
  parseServerVersion,
  parseTableInfo,
  tableInfoQuery,
  withReturning,
  type FallbackReason,
  type TableInfo,
  type TableName,
} from '../core/deneme';
import type { SchemaChange, TableSchema } from '../core/deneme-farki';
import { splitStatements, type Statement } from '../core/ifade-bolme';
import { TUNNEL_CLOSED } from '../core/ssh-tuneli';
import {
  PREVIEW_ROWS,
  autocommitSummary,
  parseClientMessage,
  type ClientMessage,
  type DenemeOutput,
  type Preview,
  type ServerEvent,
} from '../core/script-calistirma';
import { beginStatement, runBlockReasons, writeLockState, type WriteLockState } from '../core/yazma-kilidi';
import type { SettingsStore } from './ayar-deposu';
import type { RunHistory } from './calistirma-kayitlari';
import { PoolFullError, TargetError, catalogQuery, type PoolManager } from './havuzlar';
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

/**
 * Önizleme sarmalının adı: savepoint, imleç ve CTE aynı adı taşır. Sarmallar satırların 100'den
 * fazlasını sunucudan çekmez.
 */
const WRAPPER = 'tezgah_onizleme';
const CURSOR_PREFIX = `DECLARE ${WRAPPER} NO SCROLL CURSOR FOR `;
/**
 * Deneme modunda DML'in değişiklik sarmalı: veri değiştiren CTE her durumda sonuna kadar çalışır,
 * `LIMIT` yalnızca istemciye aktarılan satırları sınırlar; ilk kolon toplam satır sayısıdır.
 */
const CHANGES_PREFIX = `WITH ${WRAPPER} AS (`;
const CHANGES_SUFFIX = `) SELECT count(*) OVER (), * FROM ${WRAPPER} LIMIT ${PREVIEW_ROWS}`;
/** Katalog okumalarının savepoint'i: beklenmedik bir hata kullanıcının transaction'ını bozmasın. */
const CATALOG_SAVEPOINT = 'tezgah_katalog';
/** İmleçle çalıştırılmaya çalışılan ifade türleri; olmazsa (ör. `SELECT … INTO`) düz çalışır. */
const CURSOR_COMMANDS = new Set(['SELECT', 'VALUES', 'TABLE', 'WITH']);

/**
 * Kararın nasıl verildiği: istemciden, soket kopmasından, Karar süresinden, ölen bağlantıdan ya da
 * (Okuma'da) aynı sokette başlayan yeni çalıştırmadan.
 */
type Decision = 'commit' | 'rollback' | 'kopma' | 'sureDoldu' | 'baglantiKoptu' | 'yeniCalistirma';

const READ_EXPIRED = "Süre doldu; Okuma transaction'ı kapandı";
const READ_SESSION_TIMED_OUT = "Oturum sunucuda zaman aşımına uğradı; Okuma transaction'ı kapandı";
const EXPIRED = 'Süre doldu; transaction geri alındı';
const LATE_COMMIT = `${EXPIRED}; commit yapılamaz.`;
const SESSION_TIMED_OUT = 'Oturum sunucuda zaman aşımına uğradı; transaction geri alındı';

/** Bağlantı tünel koptuğu için mi düştü (tünel üzerindeki soketin hata kodu). */
function isTunnelClosed(err: unknown): boolean {
  return (err as { code?: unknown } | null)?.code === TUNNEL_CLOSED;
}
/** Postgres oturumu `idle_in_transaction_session_timeout` ile kapattı. */
const IDLE_IN_TRANSACTION_TIMEOUT = '25P03';
/** Hata alan transaction'da yalnızca ROLLBACK kabul edilir; diğer sorgular bununla döner. */
const TRANSACTION_ABORTED = '25P02';

/** Soket başına tek çalıştırma; karar verilene kadar client tutulur (ADR-0002). */
interface Run {
  /**
   * `okuma`: Okuma script'i bitti, transaction yalnızca daha fazla satır için açık; karar istenmez.
   * `bitiyor`: karar verildi, transaction kapanıyor; yeni karar istekleri kabul edilmez.
   */
  phase: 'calisiyor' | 'karar' | 'okuma' | 'bitiyor';
  /** İptal ya da kopma istendi; sıradaki ifadeler çalıştırılmaz. */
  stopping: 'iptal' | 'kopma' | null;
  /** Çalışan ifadeyi `pg_cancel_backend` ile durdurur; client henüz alınmadıysa yok. */
  cancel?: () => Promise<void>;
  /** Karar bekleniyorken (ya da Okuma transaction'ı açıkken) çağrılır. */
  decide?: (decision: Decision) => void;
  /** Çalıştırmanın tamamı: transaction kapanıp `bitti` gidince çözülür. */
  done?: Promise<void>;
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
  | ({ ok: true; rowCount: number | null; komut: string; onizleme?: Preview } & DenemeOutput)
  | { ok: false; error: unknown; /** Hata konumundan düşülecek önek (imleç sarmalı). */ prefix: number };

/**
 * Script çalıştırma WebSocket'i. Sunucu script'i istemciye güvenmeden analiz eder; reddedilen
 * ifade varsa ya da script Karışık'sa hiçbir şey çalışmaz.
 *
 * - Transaction modu: ifadeler tek client'ta, `BEGIN` ile açılan tek transaction'da sırayla
 *   çalışır; ilk hatada durulur; sonda istemciden commit/rollback beklenir. Soket koparsa açık
 *   transaction geri alınır.
 * - Deneme modu: Transaction modu gibi çalışır, DML'in değiştirdiği satırlar ifade başına önizlenir;
 *   son ifadeden ya da hatadan hemen sonra, karar beklenmeden geri alınır.
 * - Okuma modu (ADR-0004): ortamdan bağımsız `BEGIN READ ONLY`; son ifadeden sonra karar sorulmaz,
 *   transaction yalnızca daha fazla satır için açık kalır. Karar süresi, aynı soketteki yeni
 *   çalıştırma ya da soket kopması onu geri alır; hata alırsa hemen geri alınır.
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
      if (run.phase === 'karar' || run.phase === 'okuma') return run.decide?.('kopma');
      run.stopping = 'kopma';
      void run.cancel?.();
    });

    function handle(message: ClientMessage) {
      switch (message.type) {
        case 'run': {
          // Açık Okuma transaction'ı yeni çalıştırmaya yer açar: önce geri alınır, sonra başlanır.
          const previous = run;
          if (previous && previous.phase !== 'okuma') return warn('mesgul', 'Bu sekmede zaten bir çalıştırma var');
          previous?.decide?.('yeniCalistirma');
          expired = false;
          const current: Run = { phase: 'calisiyor', stopping: null, commitAllowed: false, ifadeler: [] };
          run = current;
          current.done = (previous?.done ?? Promise.resolve())
            .then(() => start(current, message))
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

    /**
     * Script'i istemciye güvenmeden analiz eder ve engelleri sınar; engellenen script (reddedilen
     * ifade, Karışık script, salt okunur prod'da Autocommit) hiçbir yere bağlanmadan biter ve
     * kaydedilmez. Kilit bağlantının kayıtlı ortam etiketinden hesaplanır; istemciden yalnızca
     * yazma modunun açık olup olmadığı gelir. `zorlaTransaction` yalnızca Okuma'yı Transaction'a
     * çevirir; başka bir modu değiştirmez.
     */
    async function start(current: Run, { target, script, yazmaModu, deneme, zorlaTransaction }: Extract<ClientMessage, { type: 'run' }>) {
      const statements = splitStatements(script);
      const analysis = forceTransaction(analyzeScript(statements), zorlaTransaction);
      send({ type: 'analiz', ...analysis });
      const connection = (await store.read()).connections.find((c) => c.id === target.connectionId);
      const lock = writeLockState(connection?.envTag, yazmaModu);
      const [blocked] = runBlockReasons(script, statements, lock, { deneme, analysis });
      if (blocked) {
        const mesaj = blocked.satir === null ? blocked.mesaj : `Satır ${blocked.satir}: ${blocked.mesaj}`;
        return send({ type: 'bitti', sonuc: 'reddedildi', mesaj });
      }
      // Hedefi olmayan çalıştırma kaydedilmez: hiçbir şey çalışmadı.
      if (!connection) return send({ type: 'bitti', sonuc: 'hata', mesaj: 'Bağlantı bulunamadı' });
      // Engellenmeyen script Karışık değildir; denemede transaction dışı ifade de yoktur.
      await execute(current, connection, target.database, script, analysis.mod as Exclude<RunMode, 'karisik'>, lock, deneme);
    }

    async function execute(
      current: Run,
      connection: Connection,
      database: string,
      script: string,
      mode: Exclude<RunMode, 'karisik'>,
      lock: WriteLockState,
      deneme: boolean,
    ) {
      const recorder = history.begin({
        script,
        hedef: { baglantiId: connection.id, ad: connection.name, veritabani: database, ortam: connection.envTag },
        mod: mode,
        deneme,
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
        await pools.withClient(connection, database, (client, discard) => {
          const session = { client, discard, connection, database, lock, deneme, okuma: mode === 'okuma' };
          return mode === 'autocommit' ? inAutocommit(current, session, script, finish) : inTransaction(current, session, script, finish);
        }, { session: true });
      } catch (err) {
        // `bitti` gitti; ikinci bir sonuç gönderilmez.
        if (finished) return log(`Script çalıştırma hatası: ${String(err)}`);
        if (err instanceof PoolFullError) return finish({ sonuc: 'hata', kod: 'havuzDolu', oturum: err.sessions, mesaj: err.message }, 'hata');
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
      /** Bağlantı, tünel koptuğu için düştü. */
      let tunnelLost = false;
      let expiry: unknown;
      const markBroken = () => {
        broken = true;
        // Karar beklenirken (ya da Okuma açıkken) ölen client'ın kararı beklenmez.
        if (current.phase === 'karar' || current.phase === 'okuma') current.decide?.('baglantiKoptu');
      };
      // Checkout sırasında pool'un dinleyicisi yok; bağlantı düşerse süreç çökmesin.
      const onError = (err: Error) => {
        if ((err as Partial<pg.DatabaseError>).code === IDLE_IN_TRANSACTION_TIMEOUT) timedOut = true;
        if (isTunnelClosed(err)) tunnelLost = true;
        log(`Script bağlantısı düştü (${where}): ${err.message}`);
        markBroken();
      };
      client.on('error', onError);
      const lost = () =>
        finish(
          {
            sonuc: 'hata',
            mesaj: timedOut
              ? SESSION_TIMED_OUT
              : `${tunnelLost ? 'Tünel' : 'Bağlantı'} koptu; transaction sunucuda geri alındı.`,
          },
          'hata',
        );
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

        // Sürüm transaction'dan önce okunur: beklenmedik bir hata transaction'ı bozmasın.
        const deneme = session.deneme ? { surum: await serverVersion(client), lockTimeout: denemeLockTimeout(connection.envTag) } : null;
        // Salt okunur prod'da `BEGIN READ ONLY`; yazma modunda ve denemede pool varsayılanı `READ WRITE` ile aşılır.
        // Okuma ortamdan bağımsız `READ ONLY`'dir: desen yanılırsa Postgres 25006 ile reddeder.
        await client.query(session.okuma ? 'BEGIN READ ONLY' : beginStatement(session.lock, { deneme: session.deneme }));
        const sureMs = decisionDurationMs(connection.envTag);
        // Yedek: Node zamanlayıcısı işlemezken (uyku) uzak sunucuda transaction açık kalmasın.
        await client.query(`SET LOCAL idle_in_transaction_session_timeout = ${serverIdleTimeoutMs(sureMs)}`);
        if (deneme?.lockTimeout) await client.query(deneme.lockTimeout);
        const { outcome } = await runStatements(current, client, script, deneme);
        if (outcome === 'baglantiKoptu') broken = true;
        if (broken) return await lost();
        const failed = outcome === 'hata';
        if (current.stopping) {
          await cancelSent;
          await rolledBack(current.stopping);
          return await stopped(current.stopping);
        }
        if (session.deneme) {
          // Hata da olsa sonuç aynı: karar beklenmez, her şey geri alınır.
          current.phase = 'bitiyor';
          clean = await rollback(client);
          return await finish({ sonuc: 'deneme' }, 'deneme-rollback');
        }
        if (session.okuma) {
          // Hatalı transaction'dan satır çekilemez; açık tutmanın anlamı yok.
          if (failed) {
            current.phase = 'bitiyor';
            clean = await rollback(client);
            return await finish({ sonuc: 'okuma' }, 'hata');
          }
          current.phase = 'okuma';
          const decision = await new Promise<Decision>((resolve) => {
            current.decide = resolve;
            expiry = clock.setTimeout(() => resolve('sureDoldu'), sureMs);
            send({ type: 'okumaAcik', kalanMs: sureMs });
          });
          current.phase = 'bitiyor';
          clock.clearTimeout(expiry);
          await rolledBack(decision);
          // Node zamanlayıcısı işlemezken (uyku) sunucudaki yedek zaman aşımı oturumu kapatmış olabilir.
          const mesaj = broken
            ? timedOut
              ? READ_SESSION_TIMED_OUT
              : `${tunnelLost ? 'Tünel' : 'Bağlantı'} koptu; Okuma transaction'ı kapandı.`
            : decision === 'sureDoldu'
              ? READ_EXPIRED
              : undefined;
          return await finish({ sonuc: 'okuma', ...(mesaj && { mesaj }) }, 'okuma');
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
          const what = tunnelLost || isTunnelClosed(commitError) ? 'tünel' : 'bağlantı';
          return await finish({ sonuc: 'hata', mesaj: `Commit sonucu bilinmiyor: ${what} koptu.` }, 'hata');
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
      let tunnelLost = false;
      const onError = (err: Error) => {
        log(`Script bağlantısı düştü (${where}): ${err.message}`);
        if (isTunnelClosed(err)) tunnelLost = true;
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
        const { outcome, applied } = await runStatements(current, client, script, null);
        const ozet = autocommitSummary(total, applied, outcome !== 'tamam');
        if (outcome === 'baglantiKoptu' || broken) {
          const mesaj = `${tunnelLost ? 'Tünel' : 'Bağlantı'} koptu; çalışan ifadenin sonucu bilinmiyor, kalan ifadeler çalıştırılmadı.`;
          return await finish({ sonuc: 'hata', mesaj, ozet }, 'hata');
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

    /**
     * İfadeleri sırayla çalıştırır; ilk hatada ya da iptal/kopmada durur. `applied`: başarılı ifade
     * sayısı. `deneme`: DML'in değiştirdiği satırlar ve DDL'in şema farkı çıkarılır.
     */
    async function runStatements(
      current: Run,
      client: pg.PoolClient,
      script: string,
      deneme: DenemeContext | null,
    ): Promise<{ outcome: 'tamam' | 'hata' | 'baglantiKoptu'; applied: number }> {
      let applied = 0;
      for (const [i, statement] of splitStatements(script).entries()) {
        if (current.stopping) return { outcome: 'tamam', applied };
        send({ type: 'started', i });
        const started = performance.now();
        const result = await runStatement(client, statement, deneme);
        const ms = Math.round(performance.now() - started);
        if (result.ok) {
          const { ok: _ok, ...output } = result;
          send({ type: 'done', i, ms, ...output });
          current.ifadeler.push({ offset: statement.start, ms, komut: result.komut, satirSayisi: result.rowCount });
          applied++;
          continue;
        }
        const e = result.error as Partial<pg.DatabaseError>;
        const position = e.position ? Number(e.position) - result.prefix : undefined;
        const location = errorLocation(script, statement, position !== undefined && position >= 1 ? position : undefined);
        const kod = e.code ?? null;
        const mesaj = deneme?.lockTimeout && kod === LOCK_NOT_AVAILABLE ? LOCK_NOT_AVAILABLE_MESSAGE : (e.message ?? String(result.error));
        const hata = { kod, mesaj, satir: location.satir };
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
  deneme: boolean;
  /** Okuma modu: `BEGIN READ ONLY`, karar sorulmaz. */
  okuma: boolean;
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

/** Deneme modunda çalıştırmanın bilgisi. */
interface DenemeContext {
  /** `server_version_num`; okunamadıysa 0. */
  surum: number;
  /** prod'da satır kilidi beklemesini sınırlayan `SET LOCAL`; varsa `55P03` nedeniyle anlatılır. */
  lockTimeout: string | null;
}

async function serverVersion(client: pg.PoolClient): Promise<number> {
  try {
    const result = await client.query({ text: 'SHOW server_version_num', rowMode: 'array', types: RAW_TYPES });
    return parseServerVersion(result.rows[0]?.[0]);
  } catch {
    return 0;
  }
}

async function runStatement(client: pg.PoolClient, statement: Statement, deneme: DenemeContext | null): Promise<StatementResult> {
  const viaCursor = CURSOR_COMMANDS.has(statement.keywords[0] ?? '') ? await runWithCursor(client, statement) : null;
  if (viaCursor) return viaCursor;
  if (!deneme) return runPlain(client, statement, false);
  if (Object.hasOwn(DML_VERBS, statement.keywords[0] ?? '')) return runDml(client, statement, deneme);
  const tables = ddlTargets(statement);
  return tables.length > 0 ? runDdl(client, statement, tables) : runPlain(client, statement, false);
}

/**
 * İfadeyi kullanıcının yazdığı gibi çalıştırır. `degistirir`: DML'in kendi `RETURNING`'i değişiklik
 * önizlemesidir; satırların tamamı çekilir, ilk 100'ü gösterilir.
 */
async function runPlain(client: pg.PoolClient, statement: Statement, degistirir: boolean): Promise<StatementResult> {
  try {
    const raw = await client.query({ text: statement.text, rowMode: 'array', types: RAW_TYPES });
    const result = Array.isArray(raw) ? (raw.at(-1) as pg.QueryArrayResult) : raw;
    const rows = result.fields.length > 0 ? preview(result) : undefined;
    const komut = result.command ?? statement.keywords[0] ?? '';
    return { ok: true, rowCount: result.rowCount, komut, ...(degistirir ? { degisiklik: rows } : { onizleme: rows }) };
  } catch (error) {
    return { ok: false, error, prefix: 0 };
  }
}

/**
 * Deneme modunda DML: PG18+ ve PK'lı tabloda önce/sonra satırları, değilse `RETURNING *` önizlemesi
 * ve nedeni. Sarmalı kabul etmeyen DML kullanıcının yazdığı gibi çalışır: eklenen RETURNING ifadeyi
 * (ör. kurallı tabloda) gerçek çalıştırmada olmayan bir hatayla düşürebilir.
 */
async function runDml(client: pg.PoolClient, statement: Statement, { surum }: DenemeContext): Promise<StatementResult> {
  const plain = withReturning(statement);
  let reason: FallbackReason;
  if (plain.kendiReturning) reason = 'returning';
  else if (surum < OLD_NEW_MIN_VERSION) reason = 'surum';
  else {
    const target = dmlTarget(statement);
    const info = target && (await readTable(client, { ad: target }));
    if (!info || info.anahtar.length === 0) reason = 'anahtar';
    else {
      const viaOldNew = await runWithOldNew(client, statement, info);
      if (viaOldNew) return viaOldNew;
      reason = 'sarmal';
    }
  }
  const result = (await runWithChanges(client, statement, plain.text)) ?? (await runPlain(client, statement, reason === 'returning'));
  return result.ok && result.degisiklik ? { ...result, farkYok: reason } : result;
}

/**
 * Deneme modunda tablo DDL'i: dokunduğu tabloların şeması ifadeden önce ve sonra katalogdan okunur.
 * Sonraki okuma hemen yapılır; hatadan sonra transaction iptal durumunda olur, katalog okunamaz.
 */
async function runDdl(client: pg.PoolClient, statement: Statement, tables: TableName[]): Promise<StatementResult> {
  const before = new Map<string, TableSchema>();
  const unresolved: TableName[] = [];
  for (const table of tables) {
    const info = await readTable(client, { ad: table });
    if (info) before.set(info.tablo.oid, info.sema);
    else unresolved.push(table);
  }
  const result = await runPlain(client, statement, false);
  if (!result.ok) return result;
  // Var olan tablolar oid ile izlenir (yeniden adlandırma, silme); yeni tablolar adıyla bulunur.
  const after = new Map<string, TableSchema>();
  for (const oid of before.keys()) {
    const info = await readTable(client, { oid });
    if (info) after.set(oid, info.sema);
  }
  for (const table of unresolved) {
    const info = await readTable(client, { ad: table });
    if (info) after.set(info.tablo.oid, info.sema);
  }
  const oids = new Set([...before.keys(), ...after.keys()]);
  if (oids.size === 0) return result;
  const sema: SchemaChange[] = [...oids].map((oid) => ({ oid, once: before.get(oid) ?? null, sonra: after.get(oid) ?? null }));
  return { ...result, sema };
}

/** Tablo bilgisini katalogdan okur; tablo yoksa ya da okunamazsa `null`. */
async function readTable(client: pg.PoolClient, by: Parameters<typeof tableInfoQuery>[0]): Promise<TableInfo | null> {
  try {
    await client.query(`SAVEPOINT ${CATALOG_SAVEPOINT}`);
  } catch {
    return null;
  }
  try {
    const result = await client.query({ text: tableInfoQuery(by), rowMode: 'array', types: RAW_TYPES });
    await client.query(`RELEASE SAVEPOINT ${CATALOG_SAVEPOINT}`);
    return parseTableInfo(result.rows[0]?.[0]);
  } catch {
    try {
      await client.query(`ROLLBACK TO SAVEPOINT ${CATALOG_SAVEPOINT}`);
      await client.query(`RELEASE SAVEPOINT ${CATALOG_SAVEPOINT}`);
    } catch {
      // Bağlantı koptuysa sıradaki ifade bunu bildirir.
    }
    return null;
  }
}

/**
 * PG18+ ve PK'lı tabloda DML'i önce/sonra sarmalıyla çalıştırır: ilk 100 satırın eski ve yeni hâli
 * çekilir, türlere göre sayılar sunucuda sayılır. Sarmal reddedilirse `null` döner.
 */
function runWithOldNew(client: pg.PoolClient, statement: Statement, info: TableInfo): Promise<StatementResult | null> {
  const { text, turKolonu } = withReturning(statement, { anahtar: info.anahtar, kolonlar: info.sema.kolonlar.map((k) => k.ad) });
  return withWrapper(client, CHANGES_PREFIX, async () => {
    const result = await client.query({ text: CHANGES_PREFIX + text + oldNewSelect(WRAPPER, turKolonu!), rowMode: 'array', types: RAW_TYPES });
    const { rowCount, ...fark } = decodeOldNew(
      result.fields.map((f) => f.name),
      result.rows,
    );
    return { ok: true, rowCount, komut: statement.keywords[0] ?? '', fark: { tablo: info.tablo, anahtar: info.anahtar, ...fark } };
  });
}

/**
 * `wrapper`'ı bir savepoint içinde çalıştırır. Sarmal ifadeyi kabul etmezse transaction savepoint'e
 * geri sarılır ve `null` döner (ifade düz çalıştırılır). Hata konumundan sarmalın öneki düşülür.
 */
async function withWrapper(
  client: pg.PoolClient,
  prefix: string,
  wrapper: () => Promise<StatementResult>,
): Promise<StatementResult | null> {
  let wrapped = false;
  try {
    await client.query(`SAVEPOINT ${WRAPPER}`);
    wrapped = true;
    let result: StatementResult;
    try {
      result = await wrapper();
    } catch (error) {
      if (!rejectedByWrapper(error)) throw error;
      await client.query(`ROLLBACK TO SAVEPOINT ${WRAPPER}`);
      await client.query(`RELEASE SAVEPOINT ${WRAPPER}`);
      return null;
    }
    await client.query(`RELEASE SAVEPOINT ${WRAPPER}`);
    return result;
  } catch (error) {
    return { ok: false, error, prefix: wrapped ? prefix.length : 0 };
  }
}

/**
 * Deneme modunda DML'i değişiklik sarmalıyla çalıştırır: ilk 100 satır çekilir, toplam sayı
 * sunucuda sayılır. Sarmal ifadeyi kabul etmezse (ör. kurallı tablo → 0A000) `null` döner.
 */
function runWithChanges(client: pg.PoolClient, statement: Statement, text: string): Promise<StatementResult | null> {
  return withWrapper(client, CHANGES_PREFIX, async () => {
    const result = await client.query({ text: CHANGES_PREFIX + text + CHANGES_SUFFIX, rowMode: 'array', types: RAW_TYPES });
    const first = result.rows[0];
    return {
      ok: true,
      rowCount: first ? Number(first[0]) : 0,
      komut: statement.keywords[0] ?? '',
      degisiklik: {
        kolonlar: result.fields.slice(1).map((f) => f.name),
        satirlar: result.rows.map((row) => row.slice(1).map((v) => (v === null ? null : String(v)))),
      },
    };
  });
}

/**
 * SELECT benzeri ifadeyi imleçle çalıştırır: ilk 100 satır çekilir, kalanı `MOVE` ile sayılır ama
 * istemciye aktarılmaz. İmleç bu ifadeyi kabul etmezse `null` döner.
 */
function runWithCursor(client: pg.PoolClient, statement: Statement): Promise<StatementResult | null> {
  return withWrapper(client, CURSOR_PREFIX, async () => {
    await client.query(CURSOR_PREFIX + statement.text);
    const fetched = await client.query({ text: `FETCH ${PREVIEW_ROWS} FROM ${WRAPPER}`, rowMode: 'array', types: RAW_TYPES });
    const rest = await client.query(`MOVE FORWARD ALL IN ${WRAPPER}`);
    await client.query(`CLOSE ${WRAPPER}`);
    return { ok: true, rowCount: (fetched.rowCount ?? 0) + (rest.rowCount ?? 0), komut: 'SELECT', onizleme: preview(fetched) };
  });
}

/**
 * Sarmal (imleç ya da değişiklik CTE'si) ayrıştırma ya da çözümlemede (sınıf 42 ve 0A) düştü:
 * sarmalın kabul etmediği ifade (`SELECT … INTO` → 42601, WITH içinde veri değiştiren ya da
 * kurallı tabloya DML → 0A000) ya da kullanıcının yazım hatası. Savepoint'e geri sarılır, ifade
 * düz çalıştırılır ve gerçek hata konumu oradan gelir. İptal, kilit zaman aşımı, kısıt ihlali
 * gibi hatalarda ifade yeniden çalıştırılmaz.
 */
function rejectedByWrapper(error: unknown): boolean {
  const code = error instanceof pg.DatabaseError ? (error.code ?? '') : '';
  return code.startsWith('42') || code.startsWith('0A');
}

function preview(result: pg.QueryArrayResult): Preview {
  return {
    kolonlar: result.fields.map((f) => f.name),
    satirlar: result.rows.slice(0, PREVIEW_ROWS).map((row) => row.map((v) => (v === null ? null : String(v)))),
  };
}
