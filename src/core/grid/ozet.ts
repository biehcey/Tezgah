/** Bir sonucun yüklenen sayfası. */
interface ResultPage {
  satirlar: readonly unknown[];
  /** Yüklenenlerden sonra satır kaldı mı. */
  dahaVar?: boolean;
}

/**
 * Sonucun toplam satırı: sunucu saydıysa (`rowCount`) o; saymadıysa ve devamı yoksa yüklenenler; aksi hâlde
 * bilinmez (`null`).
 */
export function resultTotal(sayfa: ResultPage, rowCount: number | null | undefined): number | null {
  if (rowCount != null) return rowCount;
  return sayfa.dahaVar ? null : sayfa.satirlar.length;
}

/** "N satır" ya da yüklenenden fazlası varsa kaçının gösterildiği. */
export function resultSummary(sayfa: ResultPage, rowCount: number | null | undefined): string {
  const loaded = sayfa.satirlar.length;
  const total = resultTotal(sayfa, rowCount);
  if (total === null) return `ilk ${loaded} satır gösteriliyor`;
  if (total > loaded) return `${total} satır · ilk ${loaded} satır gösteriliyor`;
  return `${loaded} satır`;
}
