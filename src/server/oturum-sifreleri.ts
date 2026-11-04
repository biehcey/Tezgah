/**
 * Keychain'e kaydedilmeyen bağlantıların oturumluk şifreleri: yalnızca süreç belleğinde, Tezgah
 * kapanana kadar. Bağlantı kesilince ya da düşünce unutulmaz; yalnızca sunucu reddedince (`28P01`)
 * ve bağlantı silinince.
 */
export interface SessionPasswords {
  get(connectionId: string): string | undefined;
  remember(connectionId: string, password: string): void;
  /**
   * Sunucu `tried` şifresini reddetti. Yalnızca o şifre hâlâ kayıtlıysa unutulur: geç gelen bir ret,
   * kullanıcının arada girdiği yeni şifreyi silmesin.
   */
  forgetRejected(connectionId: string, tried: string | undefined): void;
  /** Bağlantı silindi ya da şifresi artık keychain'de. */
  forget(connectionId: string): void;
}

export function createSessionPasswords(): SessionPasswords {
  const passwords = new Map<string, string>();
  return {
    get: (id) => passwords.get(id),
    remember: (id, password) => void passwords.set(id, password),
    forgetRejected(id, tried) {
      if (tried !== undefined && passwords.get(id) === tried) passwords.delete(id);
    },
    forget: (id) => void passwords.delete(id),
  };
}
