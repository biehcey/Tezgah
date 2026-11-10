/**
 * Script analizi ve Çalıştırma modu çıkarımı (wayfinder 15). Lexer'ın kelimelerine bakan desen
 * tablosudur; SQL ayrıştırılmaz. Seçeneğe bağlı durumlar temkinli tarafta kalır: emin
 * olunamayan komut transaction dışı sayılır. Listede olmayanlar için yedek, Postgres'in `25001`
 * hatasıdır.
 */
import { positionOf, type Statement } from './ifade-bolme';

/**
 * `okuma`: tüm ifadeler okuma ifadesi; `BEGIN READ ONLY` ile karar sorulmadan çalışır (ADR-0004).
 * `karisik`: transaction dışı ve içi ifadeler bir arada; çalıştırılamaz.
 */
export type RunMode = 'transaction' | 'autocommit' | 'okuma' | 'karisik';

/**
 * Reddin nedeni. `transaction`: transaction'ı Tezgah yönetir. `saltOkunur`: oturumun salt
 * okunurluğunu değiştirir (prod koruması). `meta`: psql `\` meta komutu.
 */
export type RejectReason = 'transaction' | 'saltOkunur' | 'meta';

export interface ScriptAnalysis {
  mod: RunMode;
  /** Transaction dışı ifadelerin indeksleri. */
  transactionDisi: number[];
  reddedilenler: { i: number; neden: RejectReason }[];
}

/** Transaction içinde çalışamayan komut hatası; desende olmayan komutların yedeği. */
export const ACTIVE_SQL_TRANSACTION = '25001';

/**
 * Salt okunur transaction'da yazma hatası. Okuma deseni yanılırsa (ör. `SELECT nextval(…)`)
 * Postgres bununla reddeder; arayüz Transaction modunda yeniden çalıştırmayı önerir.
 */
export const READ_ONLY_SQL_TRANSACTION = '25006';

export const REJECT_MESSAGES: Record<RejectReason, string> = {
  transaction: "Transaction'ı Tezgah yönetir; BEGIN, COMMIT ve ROLLBACK script'te kullanılamaz.",
  saltOkunur: 'Oturumun salt okunurluğu script içinden değiştirilemez.',
  meta: 'psql meta komutları desteklenmez.',
};

export const MIXED_SCRIPT_MESSAGE =
  'Karışık script: ⚠ ile işaretli transaction dışı ifadeler transaction içinde çalışamaz; onları ayrı çalıştırın.';

export const NON_TRANSACTIONAL_FALLBACK = 'Bu komut tek başına autocommit olarak çalıştırılmalı.';

export function analyzeScript(statements: Statement[]): ScriptAnalysis {
  const transactionDisi: number[] = [];
  const reddedilenler: ScriptAnalysis['reddedilenler'] = [];
  let transactionalCount = 0;
  let okumaCount = 0;
  statements.forEach((s, i) => {
    if (isReadStatement(s)) okumaCount++;
    const neden = rejectionOf(s);
    if (neden) reddedilenler.push({ i, neden });
    else if (isNonTransactional(s)) transactionDisi.push(i);
    else transactionalCount++;
  });
  const mod: RunMode =
    transactionDisi.length > 0
      ? transactionalCount === 0
        ? 'autocommit'
        : 'karisik'
      : okumaCount > 0 && okumaCount === statements.length
        ? 'okuma'
        : 'transaction';
  return { mod, transactionDisi, reddedilenler };
}

/**
 * `zorlaTransaction` (25006 sonrası): Okuma çıkan analiz Transaction moduna çevrilir. Yalnızca bu
 * yönde etkilidir; başka bir mod değişmez.
 */
export function forceTransaction(analysis: ScriptAnalysis, zorla: boolean | undefined): ScriptAnalysis {
  return zorla && analysis.mod === 'okuma' ? { ...analysis, mod: 'transaction' } : analysis;
}

/**
 * Script'in neden çalıştırılamadığı: reddedilen her ifade (satırıyla) ve Karışık script (satırsız).
 * Boşsa script çalıştırılabilir. Sunucu da arayüz de aynı metni gösterir.
 */
export function blockReasons(
  script: string,
  statements: Statement[],
  analysis: ScriptAnalysis = analyzeScript(statements),
): { satir: number | null; mesaj: string }[] {
  const reasons: { satir: number | null; mesaj: string }[] = analysis.reddedilenler.map(({ i, neden }) => ({
    satir: positionOf(script, statements[i]!.start).satir,
    mesaj: REJECT_MESSAGES[neden],
  }));
  if (analysis.mod === 'karisik') reasons.push({ satir: null, mesaj: MIXED_SCRIPT_MESSAGE });
  return reasons;
}

/** Reddedilen ifadenin nedeni; kabul edilirse `null`. */
export function rejectionOf(s: Statement): RejectReason | null {
  if (s.meta) return 'meta';
  const [k0, k1, k2] = s.keywords;
  switch (k0) {
    case 'BEGIN':
    case 'END':
    case 'ABORT':
      return 'transaction';
    case 'START':
    case 'PREPARE':
      return k1 === 'TRANSACTION' ? 'transaction' : null;
    case 'COMMIT':
      return k1 === 'PREPARED' ? null : 'transaction';
    case 'ROLLBACK':
      return k1 === 'PREPARED' || k1 === 'TO' ? null : 'transaction';
    case 'SET': {
      const scoped = k1 === 'SESSION' || k1 === 'LOCAL';
      const name = scoped ? k2 : k1;
      if (name === 'DEFAULT_TRANSACTION_READ_ONLY') return 'saltOkunur';
      // Oturumun sonraki transaction'larının varsayılanı; pool'daki client'a sızar.
      if (k1 === 'SESSION' && k2 === 'CHARACTERISTICS') return 'saltOkunur';
      return null;
    }
    case 'RESET':
      return k1 === 'DEFAULT_TRANSACTION_READ_ONLY' ? 'saltOkunur' : null;
    default:
      return null;
  }
}

/**
 * Yalnızca okuyan ifade mi (ADR-0004): `SELECT`, `TABLE`, `VALUES`, `SHOW`, ANALYZE'sız `EXPLAIN`,
 * DML içermeyen `WITH`. `… INTO` ve satır kilitleyen `FOR UPDATE/SHARE` okuma sayılmaz. Desen
 * yanılırsa (yazan fonksiyon) Postgres `25006` ile reddeder; yanılma güvenli yöndedir.
 */
export function isReadStatement(s: Statement): boolean {
  const w = s.words;
  switch (s.keywords[0]) {
    case 'SHOW':
      return true;
    case 'EXPLAIN':
      return !w.includes('ANALYZE') && !w.includes('ANALYSE');
    case 'WITH':
      if (w.some((word) => DML_WORDS.has(word))) return false;
      return readsWithoutSideEffects(w);
    case 'SELECT':
    case 'TABLE':
    case 'VALUES':
      return readsWithoutSideEffects(w);
    default:
      return false;
  }
}

const DML_WORDS = new Set(['INSERT', 'UPDATE', 'DELETE', 'MERGE']);
/** `FOR` sonrası satır kilidi: `FOR UPDATE`, `FOR NO KEY UPDATE`, `FOR SHARE`, `FOR KEY SHARE`. */
const LOCK_WORDS = new Set(['UPDATE', 'SHARE', 'NO', 'KEY']);

/** `SELECT … INTO` tablo oluşturur, `FOR UPDATE/SHARE` satır kilitler. */
function readsWithoutSideEffects(words: string[]): boolean {
  if (words.includes('INTO')) return false;
  return !words.some((word, i) => word === 'FOR' && LOCK_WORDS.has(words[i + 1] ?? ''));
}

/** Postgres'in transaction bloğu içinde çalıştırmayı reddettiği komut mu. */
export function isNonTransactional(s: Statement): boolean {
  const k = s.keywords;
  const w = s.words;
  switch (k[0]) {
    case 'VACUUM':
      return true;
    case 'COMMIT':
    case 'ROLLBACK':
      return k[1] === 'PREPARED';
    case 'CREATE': {
      if (k[1] === 'DATABASE' || k[1] === 'TABLESPACE' || k[1] === 'SUBSCRIPTION') return true;
      const index = k[1] === 'UNIQUE' ? 2 : 1;
      return k[index] === 'INDEX' && k[index + 1] === 'CONCURRENTLY';
    }
    case 'DROP':
      if (k[1] === 'DATABASE' || k[1] === 'TABLESPACE' || k[1] === 'SUBSCRIPTION') return true;
      return k[1] === 'INDEX' && k[2] === 'CONCURRENTLY';
    case 'ALTER':
      if (k[1] === 'SYSTEM') return true;
      if (k[1] === 'TABLE') {
        const detach = follows(w, ['DETACH', 'PARTITION']);
        return detach !== -1 && w.indexOf('CONCURRENTLY', detach) !== -1;
      }
      if (k[1] === 'DATABASE') return follows(w, ['SET', 'TABLESPACE']) !== -1;
      return false;
    case 'REINDEX':
      if (k[1] === 'SCHEMA' || k[1] === 'DATABASE' || k[1] === 'SYSTEM') return true;
      // `REINDEX (…)`: CONCURRENTLY bir seçenek de olabilir; temkinli taraf.
      if (k.length === 1 && w.length > 1) return true;
      return w.includes('CONCURRENTLY');
    case 'CLUSTER':
      // Tablo adsız CLUSTER tüm kümelenmiş tabloları dolaşır; seçenekler dışında kelime yok.
      return w.slice(1).every((word) => CLUSTER_OPTION_WORDS.has(word)) && !hasQuotedIdentifier(s);
    default:
      return false;
  }
}

const CLUSTER_OPTION_WORDS = new Set(['VERBOSE', 'TRUE', 'FALSE', 'ON', 'OFF']);

/** `CLUSTER "Tablo"`: tırnaklı ad kelime sayılmaz ama bir tablo adıdır. */
function hasQuotedIdentifier(s: Statement): boolean {
  return s.text.includes('"');
}

/** `sequence`'ın `words` içinde ardışık geçtiği yerden sonraki indeks; yoksa `-1`. */
function follows(words: string[], sequence: string[]): number {
  for (let i = 0; i + sequence.length <= words.length; i++) {
    if (sequence.every((word, j) => words[i + j] === word)) return i + sequence.length;
  }
  return -1;
}
