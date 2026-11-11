import { describe, expect, it } from 'vitest';
import { resultSummary, resultTotal } from './ozet';

const page = (n: number, dahaVar: boolean) => ({ satirlar: Array.from({ length: n }, () => ['x']), dahaVar });

describe('Sonuç toplamı', () => {
  it('sunucunun saydığı toplam yüklenenlerden fazla olabilir', () => {
    expect(resultTotal(page(500, true), 750)).toBe(750);
  });

  it('sayılmamışsa ve devamı yoksa yüklenenler toplamdır', () => {
    expect(resultTotal(page(3, false), undefined)).toBe(3);
  });

  it('sayılmamış ve devamı varsa toplam bilinmez', () => {
    expect(resultTotal(page(500, true), null)).toBeNull();
  });
});

describe('Sonuç özeti', () => {
  it('hepsi yüklendiyse yalnızca satır sayısı', () => {
    expect(resultSummary(page(3, false), 3)).toBe('3 satır');
  });

  it('toplam yüklenenlerden fazlaysa kaçının gösterildiği', () => {
    expect(resultSummary(page(500, true), 750)).toBe('750 satır · ilk 500 satır gösteriliyor');
  });

  it('toplam bilinmiyorsa yalnızca gösterilenler', () => {
    expect(resultSummary(page(500, true), undefined)).toBe('ilk 500 satır gösteriliyor');
  });
});
