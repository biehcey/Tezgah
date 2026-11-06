import { describe, expect, it } from 'vitest';
import type { TestStep } from '../baglanti-testi';
import { importTestResult } from './toplu-baglanti-testi';

const step = (overrides: Partial<TestStep>): TestStep => ({
  id: 'kimlik',
  sonuc: 'basarili',
  kod: null,
  mesaj: '',
  alan: null,
  oneriler: [],
  ...overrides,
});

describe('toplu test özeti', () => {
  it('başarılı test sunucu sürümü ve veritabanı sayısını gösterir', () => {
    expect(importTestResult({ adimlar: [step({})], sunucu: { surum: '17.2', veritabaniSayisi: 2 } })).toEqual({
      sonuc: 'basarili',
      mesaj: 'PostgreSQL 17.2 · 2 veritabanı',
    });
  });

  it('hata ilk hatalı adımın mesajıyla; bilinmeyen host anahtarı "onay gerekli" uyarısı', () => {
    const failed = { adimlar: [step({ id: 'ulasma', sonuc: 'hata', mesaj: 'zaman aşımı' })], sunucu: null };
    expect(importTestResult(failed)).toEqual({ sonuc: 'hata', mesaj: 'zaman aşımı' });
    const hostKey = { adimlar: [step({ id: 'ssh', sonuc: 'hata', kod: 'hostKeyUnknown', mesaj: 'tanınmıyor' })], sunucu: null };
    expect(importTestResult(hostKey)).toEqual({ sonuc: 'uyari', mesaj: 'SSH: bilinmeyen host anahtarı, onay gerekli' });
  });
});
