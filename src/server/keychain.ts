/**
 * İşletim sisteminin anahtar zinciri (macOS Keychain / Windows Credential Manager).
 * Erişimin reddedilmesi ("Deny", istem iptali) sırrın olmamasından ayrı bir sonuçtur.
 */
export interface Keychain {
  get(account: string): Promise<SecretRead>;
  set(account: string, value: string): Promise<SecretWrite>;
  delete(account: string): Promise<SecretDelete>;
}

export type Denied = { result: 'reddedildi'; message: string };
export type SecretRead = { result: 'bulundu'; value: string } | { result: 'yok' } | Denied;
export type SecretWrite = { result: 'kaydedildi' } | Denied;
export type SecretDelete = { result: 'silindi' } | { result: 'yok' } | Denied;

/** Keychain'de service adı; account bağlantı kimliğidir. İlk sürümden sonra değiştirilmez. */
export const KEYCHAIN_SERVICE = 'tezgah';

/** DB şifresinin keychain hesabı. */
export const passwordAccount = (connectionId: string) => connectionId;

/**
 * `@napi-rs/keyring` ile gerçek implementasyon. Native modül ilk kullanımda yüklenir; böylece
 * açılış ve keychain'e dokunmayan testler ona bağlı değildir.
 */
export function createOsKeychain(): Keychain {
  let lib: Promise<typeof import('@napi-rs/keyring')> | undefined;
  const entry = async (account: string) => {
    lib ??= import('@napi-rs/keyring');
    const { AsyncEntry } = await lib;
    return new AsyncEntry(KEYCHAIN_SERVICE, account);
  };
  // Kütüphane "kayıt yok"u null/false ile bildirir; reddetme, kilitli depo ve diğer
  // platform hataları reject olur. Hepsi kullanıcı için "erişilemedi" anlamına gelir.
  const denied = (err: unknown): Denied => ({ result: 'reddedildi', message: String((err as Error)?.message ?? err) });

  return {
    async get(account) {
      try {
        const value = await (await entry(account)).getPassword();
        return value === null ? { result: 'yok' } : { result: 'bulundu', value };
      } catch (err) {
        return denied(err);
      }
    },
    async set(account, value) {
      try {
        await (await entry(account)).setPassword(value);
        return { result: 'kaydedildi' };
      } catch (err) {
        return denied(err);
      }
    },
    async delete(account) {
      try {
        return (await (await entry(account)).deletePassword()) ? { result: 'silindi' } : { result: 'yok' };
      } catch (err) {
        return denied(err);
      }
    },
  };
}
