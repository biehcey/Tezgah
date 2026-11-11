import { describe, expect, it } from 'vitest';
import type { RecordResult, RunRecord } from './calistirma-kaydi';
import { ALL_RESULT_GROUPS, filterHistory, type HistoryFilter } from './gecmis-filtresi';

const HEDEF = { baglantiId: 'b-1', ad: 'Canlı', veritabani: 'app', ortam: 'prod' as const };

function record(
  runId: string,
  { sonuc = 'commit', zaman = '2026-11-05T10:00:00.000Z', script = 'SELECT 1', mod = 'transaction', hedef = HEDEF }: {
    sonuc?: RecordResult | 'bilinmiyor';
    zaman?: string;
    script?: string;
    mod?: 'transaction' | 'autocommit' | 'okuma';
    hedef?: typeof HEDEF | { baglantiId: string; ad: string; veritabani: string; ortam: null };
  } = {},
): RunRecord {
  return {
    runId,
    sonuc,
    basladi: { v: 1, tur: 'başladı', runId, zaman, script, hedef, mod, deneme: sonuc === 'deneme-rollback', yazmaKilidi: null },
    bitti:
      sonuc === 'bilinmiyor'
        ? null
        : { v: 1, tur: 'bitti', runId, baslangic: zaman, bitis: zaman, sonuc, ifadeler: [] },
  };
}

const ALL: HistoryFilter = { hedef: null, metin: '', sonuclar: ALL_RESULT_GROUPS, baslangic: null, bitis: null };
const ids = (records: RunRecord[]) => records.map((r) => r.runId);

describe('Geçmiş filtresi: sonuç', () => {
  const records = [
    record('commit', { sonuc: 'commit' }),
    record('autocommit', { sonuc: 'commit', mod: 'autocommit' }),
    record('okuma', { sonuc: 'okuma', mod: 'okuma' }),
    record('hata', { sonuc: 'hata' }),
    record('iptal', { sonuc: 'iptal' }),
    record('deneme', { sonuc: 'deneme-rollback' }),
    record('rollback', { sonuc: 'rollback' }),
    record('sure', { sonuc: 'karar-suresi-doldu' }),
    record('kopma', { sonuc: 'kopma-rollback' }),
    record('bilinmiyor', { sonuc: 'bilinmiyor' }),
  ];

  it.each([
    [['basarili'], ['commit', 'autocommit', 'okuma', 'bilinmiyor']],
    [['hata'], ['hata', 'iptal', 'bilinmiyor']],
    [['deneme'], ['deneme', 'bilinmiyor']],
    [['rollback'], ['rollback', 'sure', 'kopma', 'bilinmiyor']],
    [['hata', 'deneme'], ['hata', 'iptal', 'deneme', 'bilinmiyor']],
    [[], ['bilinmiyor']],
  ] as const)('%j seçiliyken: %j (bilinmiyor her zaman görünür)', (sonuclar, expected) => {
    expect(ids(filterHistory(records, { ...ALL, sonuclar })).sort()).toEqual([...expected].sort());
  });

  it('daha yeni bir Tezgah’ın bilmediğimiz sonuç değeri bilinmiyor gibi her zaman görünür', () => {
    const newer = record('yeni', { sonuc: 'gelecekte-eklenen' as RecordResult });
    expect(ids(filterHistory([newer], { ...ALL, sonuclar: ['basarili'] }))).toEqual(['yeni']);
  });
});

describe('Geçmiş filtresi: sıra', () => {
  it('yeniden eskiye; aynı anda başlayanlar runId’ye göre (sayfalama imleciyle aynı sıra)', () => {
    const records = [
      record('a', { zaman: '2026-11-01T09:00:00.000Z' }),
      record('c', { zaman: '2026-11-03T09:00:00.000Z' }),
      record('b1', { zaman: '2026-11-02T09:00:00.000Z' }),
      record('b2', { zaman: '2026-11-02T09:00:00.000Z' }),
    ];
    expect(ids(filterHistory(records, ALL))).toEqual(['c', 'b2', 'b1', 'a']);
  });
});

describe('Geçmiş filtresi: hedef', () => {
  it('hedef bağlantı + veritabanıdır; ad ya da ortam değişse de eşleşir', () => {
    const records = [
      record('app', { hedef: HEDEF }),
      record('yeniden-adlandirildi', { hedef: { ...HEDEF, ad: 'Eski ad' } }),
      record('baska-db', { hedef: { ...HEDEF, veritabani: 'rapor' } }),
      record('baska-baglanti', { hedef: { baglantiId: 'b-2', ad: 'Yerel', veritabani: 'app', ortam: null } }),
    ];
    expect(ids(filterHistory(records, { ...ALL, hedef: { baglantiId: 'b-1', veritabani: 'app' } })).sort()).toEqual([
      'app',
      'yeniden-adlandirildi',
    ]);
    expect(filterHistory(records, ALL)).toHaveLength(4);
  });
});

describe('Geçmiş filtresi: metin', () => {
  const records = [
    record('upd', { script: 'UPDATE siparis SET durum = 1' }),
    record('sel', { script: 'select *\nfrom Musteri' }),
  ];

  it.each([
    ['siparis', ['upd']],
    ['SIPARIS', ['upd']],
    ['from musteri', ['sel']],
    ['  musteri  ', ['sel']],
    ['', ['upd', 'sel']],
    ['yok', []],
  ])('“%s” → %j (büyük/küçük harf duyarsız, baş/son boşluk yok sayılır)', (metin, expected) => {
    expect(ids(filterHistory(records, { ...ALL, metin })).sort()).toEqual([...expected].sort());
  });
});

describe('Geçmiş filtresi: tarih aralığı', () => {
  const records = [
    record('once', { zaman: '2026-11-01T23:59:59.999Z' }),
    record('ilk-an', { zaman: '2026-11-02T00:00:00.000Z' }),
    record('ici', { zaman: '2026-11-02T12:00:00.000Z' }),
    record('son-an', { zaman: '2026-11-03T00:00:00.000Z' }),
  ];
  const at = (iso: string) => new Date(iso);

  it.each([
    ['başlangıç dahil, bitiş hariç', at('2026-11-02T00:00:00.000Z'), at('2026-11-03T00:00:00.000Z'), ['ici', 'ilk-an']],
    ['yalnızca başlangıç', at('2026-11-02T12:00:00.000Z'), null, ['son-an', 'ici']],
    ['yalnızca bitiş', null, at('2026-11-02T00:00:00.000Z'), ['once']],
  ])('%s', (_, baslangic, bitis, expected) => {
    expect(ids(filterHistory(records, { ...ALL, baslangic, bitis }))).toEqual(expected);
  });
});
