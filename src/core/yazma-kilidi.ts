/**
 * prod salt okunurluğu (wayfinder 07, 23). Bir kaza önleyicidir, güvenlik sınırı değildir: prod
 * pool'u `default_transaction_read_only=on` ile açılır, transaction kilide göre `BEGIN READ ONLY`
 * ya da `BEGIN READ WRITE` ile başlar ve yazmayı Postgres reddeder. Yazma kilidi editör ve hedef
 * başına, sayfa açık kaldıkça tutulur; tek tıkla açılır, çalıştırmadan önce onay istenmez.
 */
import { isProd, type EnvTag } from './baglanti';
import { analyzeScript, blockReasons, type ScriptAnalysis } from './calistirma-modu';
import type { Statement } from './ifade-bolme';
import { isTarget, type Target } from './veritabani-secimi';

/** Yazma kilidi: prod hedef salt okunur ya da yazma modunda; prod olmayan hedefte `null`. */
export type WriteLockState = 'salt-okunur' | 'yazma-acik' | null;

/** Hedefin yazma kilidi durumu; prod olmayan hedefte kilit yok (`null`). */
export function writeLockState(envTag: EnvTag | null | undefined, yazmaModu: boolean): WriteLockState {
  if (!isProd(envTag)) return null;
  return yazmaModu ? 'yazma-acik' : 'salt-okunur';
}

/** Transaction modunun açılış ifadesi. */
export function beginStatement(lock: WriteLockState): string {
  switch (lock) {
    case 'salt-okunur':
      return 'BEGIN READ ONLY';
    case 'yazma-acik':
      return 'BEGIN READ WRITE';
    default:
      return 'BEGIN';
  }
}

// ---------- Yazma modu açık hedefler ----------

/** Yazma modu açılmış hedefler; listede olmayan prod hedef salt okunurdur. */
export type WritableTargets = readonly Target[];

export function isWritable(writable: WritableTargets, target: Target): boolean {
  return writable.some((t) => isTarget(t, target.connectionId, target.database));
}

/** Hedefin yazma modunu açar ya da kapatır (tek tık). */
export function toggleWritable(writable: WritableTargets, target: Target): WritableTargets {
  if (!isWritable(writable, target)) return [...writable, { connectionId: target.connectionId, database: target.database }];
  return writable.filter((t) => !isTarget(t, target.connectionId, target.database));
}

// ---------- Çalıştırma engelleri ----------

export const READ_ONLY_AUTOCOMMIT_MESSAGE =
  "Salt okunur prod'da Autocommit script'i çalıştırılamaz; çalıştırmak için yazma modunu açın.";

/**
 * Script'in bu yazma kilidiyle neden çalıştırılamadığı: önce analiz engelleri (reddedilen
 * ifadeler, Karışık script), sonra kilit. Salt okunur prod'da Autocommit script'i (her ifadesi
 * anında kalıcıdır) sunucuya hiç gitmeden reddedilir. Boşsa script çalıştırılabilir; sunucu da
 * arayüz de aynı metni gösterir.
 */
export function runBlockReasons(
  script: string,
  statements: Statement[],
  lock: WriteLockState,
  analysis: ScriptAnalysis = analyzeScript(statements),
): { satir: number | null; mesaj: string }[] {
  const reasons = blockReasons(script, statements, analysis);
  if (analysis.mod === 'autocommit' && lock === 'salt-okunur') reasons.push({ satir: null, mesaj: READ_ONLY_AUTOCOMMIT_MESSAGE });
  return reasons;
}
