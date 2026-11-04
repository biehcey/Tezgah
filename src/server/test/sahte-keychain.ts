import type { Keychain } from '../keychain';

export interface FakeKeychain extends Keychain {
  /** Keychain'de duran sırlar (account → değer). */
  entries: Map<string, string>;
  /** Açıkken her işlem kullanıcı "Deny" demiş gibi reddedilir. */
  deny: boolean;
}

export function createFakeKeychain(): FakeKeychain {
  const entries = new Map<string, string>();
  const denied = { result: 'reddedildi', message: 'Kullanıcı erişimi reddetti' } as const;
  const keychain: FakeKeychain = {
    entries,
    deny: false,
    async get(account) {
      if (keychain.deny) return denied;
      const value = entries.get(account);
      return value === undefined ? { result: 'yok' } : { result: 'bulundu', value };
    },
    async set(account, value) {
      if (keychain.deny) return denied;
      entries.set(account, value);
      return { result: 'kaydedildi' };
    },
    async delete(account) {
      if (keychain.deny) return denied;
      return entries.delete(account) ? { result: 'silindi' } : { result: 'yok' };
    },
  };
  return keychain;
}
