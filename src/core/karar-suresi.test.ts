import { describe, expect, it } from 'vitest';
import {
  commitRequest,
  decisionDurationMs,
  decisionStatus,
  extendDecision,
  formatRemaining,
  serverIdleTimeoutMs,
  startDecision,
} from './karar-suresi';

const DK = 60_000;

describe('Karar süresi', () => {
  it.each([
    ['prod', 5 * DK],
    ['local', 30 * DK],
    ['test', 30 * DK],
    [null, 30 * DK],
  ] as const)('%s ortamında süre %i ms', (envTag, ms) => {
    expect(decisionDurationMs(envTag)).toBe(ms);
  });

  it('sunucudaki yedek zaman aşımı süreden 1 dk uzun', () => {
    expect(serverIdleTimeoutMs(5 * DK)).toBe(6 * DK);
  });

  it('başlat: süre işler; son 1 dakikada geri sayım; bitişte süre doldu', () => {
    const t = startDecision(5 * DK, 1_000);
    expect(decisionStatus(t, 1_000)).toEqual({ kalanMs: 5 * DK, evre: 'bekliyor' });
    expect(decisionStatus(t, 1_000 + 4 * DK - 1)).toEqual({ kalanMs: DK + 1, evre: 'bekliyor' });
    expect(decisionStatus(t, 1_000 + 4 * DK)).toEqual({ kalanMs: DK, evre: 'geriSayim' });
    expect(decisionStatus(t, 1_000 + 5 * DK - 1)).toEqual({ kalanMs: 1, evre: 'geriSayim' });
    expect(decisionStatus(t, 1_000 + 5 * DK)).toEqual({ kalanMs: 0, evre: 'doldu' });
    expect(decisionStatus(t, 1_000 + 9 * DK)).toEqual({ kalanMs: 0, evre: 'doldu' });
  });

  it('uzat: süre o andan baştan başlar; sınırsız', () => {
    let t = startDecision(5 * DK, 0);
    t = extendDecision(t, 4.5 * DK)!;
    expect(decisionStatus(t, 4.5 * DK)).toEqual({ kalanMs: 5 * DK, evre: 'bekliyor' });
    t = extendDecision(t, 9 * DK)!;
    expect(decisionStatus(t, 13 * DK)).toEqual({ kalanMs: DK, evre: 'geriSayim' });
  });

  it('süre dolduktan sonra uzatılamaz', () => {
    expect(extendDecision(startDecision(5 * DK, 0), 5 * DK)).toBeNull();
  });

  it('commit isteği: süre içinde kabul; bitişte ve sonrasında süre doldu (tolerans yok)', () => {
    const t = startDecision(5 * DK, 0);
    expect(commitRequest(t, 5 * DK - 1)).toBe('kabul');
    expect(commitRequest(t, 5 * DK)).toBe('sureDoldu');
    expect(commitRequest(t, 6 * DK)).toBe('sureDoldu');
  });
});

describe('Karar süresi: gösterim', () => {
  it('başlamadan önceki bir an sorulsa da kalan süre tam süreyi aşmaz', () => {
    expect(decisionStatus(startDecision(5 * DK, 10_000), 0)).toEqual({ kalanMs: 5 * DK, evre: 'bekliyor' });
  });

  it.each([
    [60_000, '1:00'],
    [42_000, '0:42'],
    [41_001, '0:42'],
    [500, '0:01'],
    [0, '0:00'],
    [5 * DK, '5:00'],
  ])('%i ms → %s', (ms, text) => {
    expect(formatRemaining(ms)).toBe(text);
  });
});
