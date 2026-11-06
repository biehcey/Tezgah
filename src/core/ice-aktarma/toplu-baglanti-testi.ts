/**
 * İçe aktardıktan sonra toplu test: her bağlantı kayıtlı değerleriyle "Bağlantıyı test et" adımlarından
 * geçer; hiçbir şey sorulmaz. Sonuç tek satırlık bir özet olur (● / ⚠).
 */
import type { Connection } from '../baglanti';
import { testSummary, type ConnectionTestRequest, type ConnectionTestResponse } from '../baglanti-testi';

export interface ImportTestResult {
  sonuc: 'basarili' | 'uyari' | 'hata';
  mesaj: string;
}

/** Toplu testte bağlantının durumu: sırası bekleniyor, test ediliyor ya da sonuç. */
export type ImportTestState = 'bekliyor' | 'calisiyor' | ImportTestResult;

export const TEST_ICONS: Record<ImportTestResult['sonuc'], string> = { basarili: '●', uyari: '⚠', hata: '⚠' };

/** Şifresi keychain'de olmayan bağlantı test edilmez; şifre ilk bağlanmada sorulur. */
export const SKIPPED_WITHOUT_PASSWORD: ImportTestResult = { sonuc: 'uyari', mesaj: 'şifre yok, test atlandı' };

/** Kayıtlı bağlantının test isteği: şifreler sunucuda keychain'den okunur. */
export function importTestRequest(c: Connection): ConnectionTestRequest {
  const { id, host, port, user, database, savePassword, sslmode, sslrootcert, sslcert, sslkey, ssh } = c;
  return { connectionId: id, host, port, user, database, password: undefined, savePassword, sslmode, sslrootcert, sslcert, sslkey, ssh, sshSecret: undefined };
}

export function importTestResult({ adimlar, sunucu }: ConnectionTestResponse): ImportTestResult {
  const summary = testSummary(adimlar);
  if (summary.sonuc === 'basarili') {
    return { sonuc: 'basarili', mesaj: sunucu ? `PostgreSQL ${sunucu.surum} · ${sunucu.veritabaniSayisi} veritabanı` : 'bağlanıldı' };
  }
  const step = adimlar.find((s) => s.id === summary.adim)!;
  // Bilinmeyen host anahtarı etkileşim ister: uyarı olarak kalır, formdan ya da ilk bağlanmada onaylanır.
  if (step.kod === 'hostKeyUnknown') return { sonuc: 'uyari', mesaj: 'SSH: bilinmeyen host anahtarı, onay gerekli' };
  return { sonuc: summary.sonuc, mesaj: step.mesaj };
}
