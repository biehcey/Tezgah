/** Bir bağlantının sunucu oturumu (Veritabanı paneli ve liste satırındaki durum). */
export type ConnectionSession =
  | { durum: 'baglaniyor' }
  | { durum: 'bagli'; veritabanlari: string[] }
  | { durum: 'hata'; hata: string };
