import { describe, expect, it } from 'vitest';
import { historyFileName, finishedLine, parseRecords, startedLine } from './calistirma-kaydi';

const hedef = { baglantiId: 'b-1', ad: 'Prod DB', veritabani: 'app', ortam: 'prod' as const };

const started = () =>
  startedLine({
    runId: 'r-1',
    zaman: new Date('2026-11-05T10:00:00.000Z'),
    script: 'UPDATE t SET a = 1;\nSELECT 1',
    hedef,
    mod: 'transaction',
    deneme: false,
    yazmaKilidi: 'salt-okunur',
  });

describe('Çalıştırma kaydı satırları', () => {
  it('başladı satırı: sürüm, script, hedefin anlık kopyası, mod, deneme ve yazma kilidi', () => {
    expect(started()).toEqual({
      v: 1,
      tur: 'başladı',
      runId: 'r-1',
      zaman: '2026-11-05T10:00:00.000Z',
      script: 'UPDATE t SET a = 1;\nSELECT 1',
      hedef: { baglantiId: 'b-1', ad: 'Prod DB', veritabani: 'app', ortam: 'prod' },
      mod: 'transaction',
      deneme: false,
      yazmaKilidi: 'salt-okunur',
    });
  });

  it('bitti satırı: sonuç, zamanlar ve ifade özetleri', () => {
    expect(
      finishedLine({
        runId: 'r-1',
        baslangic: new Date('2026-11-05T10:00:00.000Z'),
        bitis: new Date('2026-11-05T10:00:02.500Z'),
        sonuc: 'rollback',
        ifadeler: [
          { offset: 0, ms: 12, komut: 'UPDATE', satirSayisi: 3 },
          { offset: 20, ms: 4, komut: 'SELECT', satirSayisi: null, hata: { kod: '42P01', mesaj: 'relation "t" does not exist', satir: 2 } },
        ],
      }),
    ).toEqual({
      v: 1,
      tur: 'bitti',
      runId: 'r-1',
      baslangic: '2026-11-05T10:00:00.000Z',
      bitis: '2026-11-05T10:00:02.500Z',
      sonuc: 'rollback',
      ifadeler: [
        { offset: 0, ms: 12, komut: 'UPDATE', satirSayisi: 3 },
        { offset: 20, ms: 4, komut: 'SELECT', satirSayisi: null, hata: { kod: '42P01', mesaj: 'relation "t" does not exist', satir: 2 } },
      ],
    });
  });

  it('mesaj varsa bitti satırına girer', () => {
    const line = finishedLine({ runId: 'r', baslangic: new Date(0), bitis: new Date(0), sonuc: 'hata', mesaj: 'Bağlantı koptu', ifadeler: [] });
    expect(line.mesaj).toBe('Bağlantı koptu');
  });
});

describe('aylık dosya', () => {
  it('ad yerel saatle YYYY-MM.jsonl', () => {
    expect(historyFileName(new Date(2026, 0, 31, 23, 59))).toBe('2026-01.jsonl');
    expect(historyFileName(new Date(2026, 10, 1, 0, 0))).toBe('2026-11.jsonl');
  });

  const jsonl = (...lines: unknown[]) => lines.map((l) => `${JSON.stringify(l)}\n`).join('');

  it('başladı ve bitti aynı runId ile tek kayıtta birleşir', () => {
    const bitti = finishedLine({ runId: 'r-1', baslangic: new Date(0), bitis: new Date(1), sonuc: 'commit', ifadeler: [] });
    const [record, ...rest] = parseRecords(jsonl(started(), bitti));
    expect(rest).toEqual([]);
    expect(record).toEqual({ runId: 'r-1', sonuc: 'commit', basladi: started(), bitti });
  });

  it('bitti satırı olmayan kayıt "bilinmiyor" olarak çıkar', () => {
    const other = { ...started(), runId: 'r-2' };
    const bitti = finishedLine({ runId: 'r-2', baslangic: new Date(0), bitis: new Date(1), sonuc: 'iptal', ifadeler: [] });
    expect(parseRecords(jsonl(started(), other, bitti)).map((r) => [r.runId, r.sonuc, r.bitti])).toEqual([
      ['r-1', 'bilinmiyor', null],
      ['r-2', 'iptal', bitti],
    ]);
  });

  it('bozuk, yarım yazılmış ya da daha yeni sürümlü satırlar atlanır', () => {
    const text = `${jsonl(started(), { ...started(), runId: 'r-3', v: 2 })}{"v":1,"tur":"bit\nçöp\n\n`;
    expect(parseRecords(text).map((r) => r.runId)).toEqual(['r-1']);
  });

  it('başladı satırı olmayan bitti satırı kayıt üretmez', () => {
    const bitti = finishedLine({ runId: 'yetim', baslangic: new Date(0), bitis: new Date(1), sonuc: 'commit', ifadeler: [] });
    expect(parseRecords(jsonl(bitti))).toEqual([]);
  });
});
