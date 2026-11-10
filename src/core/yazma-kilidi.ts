/**
 * prod salt okunurluğu (wayfinder 07, 23). Bir kaza önleyicidir, güvenlik sınırı değildir: prod
 * pool'u `default_transaction_read_only=on` ile açılır, transaction kilide göre `BEGIN READ ONLY`
 * ya da `BEGIN READ WRITE` ile başlar ve yazmayı Postgres reddeder. Yazma kilidi sekme ve hedef
 * başınadır (bkz. `konsol-sekmeleri`); tek tıkla açılır, çalıştırmadan önce onay istenmez.
 */
import { isProd, type EnvTag } from './baglanti';
import { analyzeScript, blockReasons, type ScriptAnalysis } from './calistirma-modu';
import { positionOf, type Statement } from './ifade-bolme';

/** Yazma kilidi: prod hedef salt okunur ya da yazma modunda; prod olmayan hedefte `null`. */
export type WriteLockState = 'salt-okunur' | 'yazma-acik' | null;

/** Hedefin yazma kilidi durumu; prod olmayan hedefte kilit yok (`null`). */
export function writeLockState(envTag: EnvTag | null | undefined, yazmaModu: boolean): WriteLockState {
  if (!isProd(envTag)) return null;
  return yazmaModu ? 'yazma-acik' : 'salt-okunur';
}

/**
 * Transaction modunun açılış ifadesi. Deneme (wayfinder 20) kilitten bağımsız `BEGIN READ WRITE`
 * ile açılır: sonu her zaman rollback'tir, kalıcı yazamaz. Pool'un salt okunur varsayılanına
 * dokunulmaz; yalnızca bu transaction aşılır.
 */
export function beginStatement(lock: WriteLockState, { deneme = false }: { deneme?: boolean } = {}): string {
  if (deneme) return 'BEGIN READ WRITE';
  switch (lock) {
    case 'salt-okunur':
      return 'BEGIN READ ONLY';
    case 'yazma-acik':
      return 'BEGIN READ WRITE';
    default:
      return 'BEGIN';
  }
}

// ---------- Çalıştırma engelleri ----------

export const READ_ONLY_AUTOCOMMIT_MESSAGE =
  "Salt okunur prod'da Autocommit script'i çalıştırılamaz; çalıştırmak için yazma modunu açın.";

export const DENEME_NON_TRANSACTIONAL_MESSAGE = 'Transaction dışı komut Deneme modunda çalıştırılamaz; geri alınamaz.';

export const DENEME_READ_MESSAGE = "Okuma script'i bir şey değiştirmez; Deneme gerekmez.";

/**
 * Script'in bu yazma kilidiyle neden çalıştırılamadığı: önce analiz engelleri (reddedilen
 * ifadeler, Karışık script), sonra kilit. Salt okunur prod'da Autocommit script'i (her ifadesi
 * anında kalıcıdır) sunucuya hiç gitmeden reddedilir. Deneme modunda (wayfinder 15) transaction
 * dışı her ifade engeldir: geri alınamaz, atlamak da sonraki ifadelerin sonucunu yanıltır. Okuma
 * script'i denenmez (ADR-0004). Boşsa script çalıştırılabilir; sunucu da arayüz de aynı metni
 * gösterir.
 */
export function runBlockReasons(
  script: string,
  statements: Statement[],
  lock: WriteLockState,
  { deneme = false, analysis = analyzeScript(statements) }: { deneme?: boolean; analysis?: ScriptAnalysis } = {},
): { satir: number | null; mesaj: string }[] {
  const reasons = blockReasons(script, statements, analysis);
  if (deneme) {
    if (analysis.mod === 'okuma') reasons.push({ satir: null, mesaj: DENEME_READ_MESSAGE });
    for (const i of analysis.transactionDisi) {
      reasons.push({ satir: positionOf(script, statements[i]!.start).satir, mesaj: DENEME_NON_TRANSACTIONAL_MESSAGE });
    }
  } else if (analysis.mod === 'autocommit' && lock === 'salt-okunur') {
    reasons.push({ satir: null, mesaj: READ_ONLY_AUTOCOMMIT_MESSAGE });
  }
  return reasons;
}
