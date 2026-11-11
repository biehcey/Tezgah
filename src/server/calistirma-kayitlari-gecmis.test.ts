import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { finishedLine, formatLine, startedLine, type RecordResult, type TargetSnapshot } from '../core/calistirma-kaydi';
import { startTestServer, type TestServer } from './test/sunucu';

const URL = '/api/calistirma-kayitlari';

const CANLI: TargetSnapshot = { baglantiId: 'p1', ad: 'Canlı', veritabani: 'app', ortam: 'prod' };
const YEREL: TargetSnapshot = { baglantiId: 'd1', ad: 'Yerel', veritabani: 'postgres', ortam: 'dev' };

interface Fixture {
  runId: string;
  zaman: string;
  sonuc: RecordResult | 'bilinmiyor';
  hedef?: TargetSnapshot;
  script?: string;
}

let t: TestServer;
beforeEach(async () => {
  t = await startTestServer();
});
afterEach(async () => {
  await t.close();
});

/**
 * Aylık dosyalar; satırlar başlama sırasıyla yazılır. Zamanlar ayın ortasında: dosya adı yerel ayla
 * seçilir, saat dilimi testin ayını değiştirmesin.
 */
async function writeHistory(files: Record<string, Fixture[]>) {
  const dir = join(t.configDir, 'history');
  await mkdir(dir, { recursive: true });
  for (const [name, fixtures] of Object.entries(files)) {
    const lines = fixtures.flatMap(({ runId, zaman, sonuc, hedef = CANLI, script = `SELECT '${runId}'` }) => {
      const at = new Date(zaman);
      const started = startedLine({
        runId,
        zaman: at,
        script,
        hedef,
        mod: sonuc === 'okuma' ? 'okuma' : 'transaction',
        deneme: sonuc === 'deneme-rollback',
        yazmaKilidi: null,
      });
      if (sonuc === 'bilinmiyor') return [started];
      return [started, finishedLine({ runId, baslangic: at, bitis: at, sonuc, ifadeler: [] })];
    });
    await writeFile(join(dir, name), lines.map(formatLine).join(''));
  }
}

const get = (query = '') => t.api('GET', `${URL}${query}`);
const runIds = (body: { kayitlar: { runId: string }[] }) => body.kayitlar.map((k) => k.runId);

/** Tüm sayfaları imleçle gezer. */
async function allPages(query: string): Promise<string[][]> {
  const pages: string[][] = [];
  let cursor: string | null = null;
  do {
    const res = await get(`?${query}${cursor ? `&imlec=${encodeURIComponent(cursor)}` : ''}`);
    expect(res.status).toBe(200);
    pages.push(runIds(res.body));
    cursor = res.body.sonraki;
  } while (cursor && pages.length < 20);
  return pages;
}

const THREE_MONTHS = {
  '2026-09.jsonl': [
    { runId: 'eylul-1', zaman: '2026-09-15T10:00:00.000Z', sonuc: 'commit' },
    { runId: 'eylul-2', zaman: '2026-09-15T11:00:00.000Z', sonuc: 'hata', hedef: YEREL },
  ],
  '2026-10.jsonl': [
    { runId: 'ekim-1', zaman: '2026-10-15T10:00:00.000Z', sonuc: 'deneme-rollback' },
    { runId: 'ekim-2', zaman: '2026-10-15T11:00:00.000Z', sonuc: 'bilinmiyor' },
    { runId: 'ekim-3', zaman: '2026-10-15T12:00:00.000Z', sonuc: 'okuma', hedef: YEREL },
  ],
  '2026-11.jsonl': [
    { runId: 'kasim-1', zaman: '2026-11-15T10:00:00.000Z', sonuc: 'rollback', script: 'UPDATE siparis SET durum = 2' },
    { runId: 'kasim-2', zaman: '2026-11-15T11:00:00.000Z', sonuc: 'commit', hedef: YEREL },
  ],
} satisfies Record<string, Fixture[]>;

describe('GET /api/calistirma-kayitlari', () => {
  it('kayıt dizini yokken boş sayfa', async () => {
    expect(await get()).toEqual({ status: 200, body: { kayitlar: [], sonraki: null } });
  });

  it('kayıt: zaman, hedefin anlık kopyası, mod, deneme, sonuç ve script; bitti satırı olmayan bilinmiyor', async () => {
    await writeHistory(THREE_MONTHS);
    const { body } = await get('?limit=50');
    expect(body.kayitlar.find((k: { runId: string }) => k.runId === 'ekim-3')).toEqual({
      runId: 'ekim-3',
      zaman: '2026-10-15T12:00:00.000Z',
      hedef: YEREL,
      mod: 'okuma',
      deneme: false,
      sonuc: 'okuma',
      script: "SELECT 'ekim-3'",
    });
    expect(body.kayitlar.find((k: { runId: string }) => k.runId === 'ekim-2').sonuc).toBe('bilinmiyor');
  });

  it('aylık dosyaları yeniden eskiye okur; imleçle sayfa sayfa, ay sınırlarını aşarak', async () => {
    await writeHistory(THREE_MONTHS);
    expect(await allPages('limit=3')).toEqual([
      ['kasim-2', 'kasim-1', 'ekim-3'],
      ['ekim-2', 'ekim-1', 'eylul-2'],
      ['eylul-1'],
    ]);
  });

  it('son sayfa tam dolduğunda sonraki imleç yok', async () => {
    await writeHistory(THREE_MONTHS);
    const pages = await allPages('limit=7');
    expect(pages).toHaveLength(1);
    expect(pages[0]).toHaveLength(7);
  });

  it('filtre sayfalamadan önce uygulanır: hedef, sonuç (bilinmiyor her zaman), metin, tarih', async () => {
    await writeHistory(THREE_MONTHS);
    expect(await allPages('limit=2&baglanti=d1&veritabani=postgres')).toEqual([['kasim-2', 'ekim-3'], ['eylul-2']]);
    expect(await allPages('limit=2&sonuc=basarili,rollback')).toEqual([['kasim-2', 'kasim-1'], ['ekim-3', 'ekim-2'], ['eylul-1']]);
    expect(await allPages('sonuc=')).toEqual([['ekim-2']]);
    expect(await allPages('metin=SIPARIS')).toEqual([['kasim-1']]);
    expect(await allPages(`baslangic=${encodeURIComponent('2026-10-15T11:00:00.000Z')}&bitis=${encodeURIComponent('2026-11-15T11:00:00.000Z')}`)).toEqual([
      ['kasim-1', 'ekim-3', 'ekim-2'],
    ]);
  });

  it('sayfalar arasında yeni çalıştırma eklense de sonraki sayfa kaymaz', async () => {
    await writeHistory(THREE_MONTHS);
    const first = await get('?limit=2');
    expect(runIds(first.body)).toEqual(['kasim-2', 'kasim-1']);
    await writeHistory({
      ...THREE_MONTHS,
      '2026-11.jsonl': [...THREE_MONTHS['2026-11.jsonl'], { runId: 'kasim-3', zaman: '2026-11-15T12:00:00.000Z', sonuc: 'commit' }],
    });
    const second = await get(`?limit=2&imlec=${encodeURIComponent(first.body.sonraki)}`);
    expect(runIds(second.body)).toEqual(['ekim-3', 'ekim-2']);
  });

  it('kayıt dosyası olmayan adlar ve bozuk satırlar atlanır', async () => {
    await writeHistory({ ...THREE_MONTHS, 'notlar.txt': [{ runId: 'yabanci', zaman: '2026-12-15T10:00:00.000Z', sonuc: 'commit' }] });
    await writeFile(join(t.configDir, 'history', '2026-08.jsonl'), '{bozuk\n');
    expect((await allPages('limit=50')).flat()).toHaveLength(7);
  });

  it.each([
    ['?limit=0'],
    ['?limit=abc'],
    ['?sonuc=basarili,bilinmeyen'],
    ['?baglanti=p1'],
    ['?baslangic=dun'],
    ['?imlec=bozuk'],
  ])('geçersiz sorgu %s → 400', async (query) => {
    expect((await get(query)).status).toBe(400);
  });

  it('yalnızca GET', async () => {
    expect((await t.api('POST', URL)).status).toBe(405);
  });
});
