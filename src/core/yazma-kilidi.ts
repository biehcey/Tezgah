/**
 * prod salt okunurluğu (wayfinder 07, 23). Bir kaza önleyicidir, güvenlik sınırı değildir: prod
 * pool'u `default_transaction_read_only=on` ile açılır, transaction kilide göre `BEGIN READ ONLY`
 * ya da `BEGIN READ WRITE` ile başlar ve yazmayı Postgres reddeder. Yazma kilidi editör ve hedef
 * başına, sayfa açık kaldıkça tutulur; tek tıkla açılır, çalıştırmadan önce onay istenmez.
 */
import { isProd, type EnvTag } from './baglanti';
import type { WriteLockState } from './calistirma-kaydi';
import type { RunMode } from './calistirma-modu';

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

export const READ_ONLY_AUTOCOMMIT_MESSAGE =
  "Salt okunur prod'da Autocommit script'i çalıştırılamaz; çalıştırmak için yazma modunu açın.";

/**
 * Yazma kilidinin engellediği çalıştırma: salt okunur prod'da Autocommit script'i (her ifadesi
 * anında kalıcıdır) sunucuya hiç gitmeden reddedilir. Engel yoksa `null`.
 */
export function writeLockBlock(mode: RunMode, lock: WriteLockState): string | null {
  return mode === 'autocommit' && lock === 'salt-okunur' ? READ_ONLY_AUTOCOMMIT_MESSAGE : null;
}
