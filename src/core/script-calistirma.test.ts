import { describe, expect, it } from 'vitest';
import {
  MORE_CLOSED_FAILED,
  MORE_CLOSED_FINISHED,
  ROW_LIMIT_MESSAGE,
  applyEvent,
  autocommitSummary,
  canFetchMore,
  requestMore,
  formatSummary,
  parseClientMessage,
  startRunView,
  targetLock,
  type RunView,
  type ServerEvent,
} from './script-calistirma';

describe('parseClientMessage', () => {
  it.each([
    ['run', { type: 'run', target: { connectionId: 'b1', database: 'app' }, script: 'SELECT 1', fazla: 1 }, { type: 'run', target: { connectionId: 'b1', database: 'app' }, script: 'SELECT 1', yazmaModu: false, deneme: false }],
    ['yazma modunda run', { type: 'run', target: { connectionId: 'b1', database: 'app' }, script: 'SELECT 1', yazmaModu: true }, { type: 'run', target: { connectionId: 'b1', database: 'app' }, script: 'SELECT 1', yazmaModu: true, deneme: false }],
    ['deneme', { type: 'run', target: { connectionId: 'b1', database: 'app' }, script: 'SELECT 1', deneme: true }, { type: 'run', target: { connectionId: 'b1', database: 'app' }, script: 'SELECT 1', yazmaModu: false, deneme: true }],
    ['deneme metin', { type: 'run', target: { connectionId: 'b1', database: 'app' }, script: 'SELECT 1', deneme: 'evet' }, { type: 'run', target: { connectionId: 'b1', database: 'app' }, script: 'SELECT 1', yazmaModu: false, deneme: false }],
    // Yalnızca açıkça `true` yazma modudur; belirsiz değer salt okunur kalır.
    ['yazmaModu metin', { type: 'run', target: { connectionId: 'b1', database: 'app' }, script: 'SELECT 1', yazmaModu: 'true' }, { type: 'run', target: { connectionId: 'b1', database: 'app' }, script: 'SELECT 1', yazmaModu: false, deneme: false }],
    // Yalnızca açıkça `true` Transaction modunu zorlar; yoksa alan da yoktur.
    ['zorlaTransaction', { type: 'run', target: { connectionId: 'b1', database: 'app' }, script: 'SELECT 1', zorlaTransaction: true }, { type: 'run', target: { connectionId: 'b1', database: 'app' }, script: 'SELECT 1', yazmaModu: false, deneme: false, zorlaTransaction: true }],
    ['zorlaTransaction metin', { type: 'run', target: { connectionId: 'b1', database: 'app' }, script: 'SELECT 1', zorlaTransaction: 'true' }, { type: 'run', target: { connectionId: 'b1', database: 'app' }, script: 'SELECT 1', yazmaModu: false, deneme: false }],
    // Yalnızca `1` tanınır (Bekleyen değişiklik script'leri); başka değerde denetim yoktur.
    ['beklenenSatir', { type: 'run', target: { connectionId: 'b1', database: 'app' }, script: 'SELECT 1', beklenenSatir: 1 }, { type: 'run', target: { connectionId: 'b1', database: 'app' }, script: 'SELECT 1', yazmaModu: false, deneme: false, beklenenSatir: 1 }],
    ['beklenenSatir 2', { type: 'run', target: { connectionId: 'b1', database: 'app' }, script: 'SELECT 1', beklenenSatir: 2 }, { type: 'run', target: { connectionId: 'b1', database: 'app' }, script: 'SELECT 1', yazmaModu: false, deneme: false }],
    ['beklenenSatir metin', { type: 'run', target: { connectionId: 'b1', database: 'app' }, script: 'SELECT 1', beklenenSatir: '1' }, { type: 'run', target: { connectionId: 'b1', database: 'app' }, script: 'SELECT 1', yazmaModu: false, deneme: false }],
    ['commit', { type: 'commit' }, { type: 'commit' }],
    ['rollback', { type: 'rollback' }, { type: 'rollback' }],
    ['iptal', { type: 'iptal' }, { type: 'iptal' }],
    ['uzat', { type: 'uzat' }, { type: 'uzat' }],
    ['dahaFazla', { type: 'dahaFazla', i: 2, fazla: 1 }, { type: 'dahaFazla', i: 2 }],
    ['dahaFazla indekssiz', { type: 'dahaFazla' }, null],
    ['dahaFazla negatif', { type: 'dahaFazla', i: -1 }, null],
    ['dahaFazla kesirli', { type: 'dahaFazla', i: 1.5 }, null],
    ['bilinmeyen tür', { type: 'yok' }, null],
    ['hedefsiz run', { type: 'run', script: 'SELECT 1' }, null],
    ['script metin değil', { type: 'run', target: { connectionId: 'b1', database: 'app' }, script: 1 }, null],
    ['nesne değil', 'commit', null],
    ['null', null, null],
  ])('%s', (_, raw, expected) => {
    expect(parseClientMessage(raw)).toEqual(expected);
  });
});

const SCRIPT = 'INSERT INTO t VALUES (1);\n\nSELECT 2; SELECT 3';
const play = (...events: ServerEvent[]): RunView => events.reduce(applyEvent, startRunView(SCRIPT));
const states = (view: RunView) => view.ifadeler.map((s) => s.durum);

describe('çalıştırma görünümü', () => {
  it('başta her ifade sırada; satır ifadenin ilk satırı, komut ilk anahtar kelime', () => {
    const view = startRunView(SCRIPT);
    expect(view.evre).toBe('calisiyor');
    expect(view.ifadeler.map((s) => [s.satir, s.komut, s.durum])).toEqual([
      [1, 'INSERT', 'sirada'],
      [3, 'SELECT', 'sirada'],
      [3, 'SELECT', 'sirada'],
    ]);
  });

  it('started ve done ifadeyi ilerletir; done komut etiketini ve sonucu taşır', () => {
    const view = play({ type: 'started', i: 0 }, { type: 'done', i: 0, rowCount: 1, ms: 4, komut: 'INSERT' }, { type: 'started', i: 1 });
    expect(states(view)).toEqual(['basarili', 'calisiyor', 'sirada']);
    expect(view.ifadeler[0]).toMatchObject({ komut: 'INSERT', rowCount: 1, ms: 4 });
  });

  it('Deneme: görünüm denemeyi bilir; done DML’in değişiklik önizlemesini taşır; bitti deneme', () => {
    const degisiklik = { kolonlar: ['id'], satirlar: [['1']] };
    const view = [
      { type: 'done', i: 0, rowCount: 1, ms: 4, komut: 'INSERT', degisiklik },
      { type: 'bitti', sonuc: 'deneme' },
    ].reduce((v, e) => applyEvent(v, e as ServerEvent), startRunView(SCRIPT, { deneme: true }));
    expect(view).toMatchObject({ deneme: true, evre: 'bitti', sonuc: 'deneme' });
    expect(view.ifadeler[0]).toMatchObject({ rowCount: 1, degisiklik });
    expect(startRunView(SCRIPT).deneme).toBe(false);
  });

  it('hata ifadeyi hatalı, kalanları çalıştırılmadı yapar', () => {
    const view = play(
      { type: 'started', i: 0 },
      { type: 'error', i: 0, ms: 2, sqlstate: '42P01', mesaj: 'yok', satir: 1, sutun: 13, bas: 12, bit: 13 },
    );
    expect(states(view)).toEqual(['hatali', 'calistirilmadi', 'calistirilmadi']);
    expect(view.ifadeler[0]!.hata).toEqual({ sqlstate: '42P01', mesaj: 'yok', satir: 1, sutun: 13, bas: 12, bit: 13 });
  });

  it('kararBekleniyor karar evresine geçirir; commit edilebilirliği ve kalan Karar süresini taşır', () => {
    expect(play({ type: 'kararBekleniyor', commitEdilebilir: false, kalanMs: 300_000 })).toMatchObject({
      evre: 'karar',
      commitEdilebilir: false,
      kararSuresi: { kalanMs: 300_000, surum: 1 },
    });
  });

  it('uzatildi kalan süreyi yeniler ve bekleyen uzat isteğini temizler', () => {
    const waiting = play({ type: 'kararBekleniyor', commitEdilebilir: true, kalanMs: 300_000 });
    const view = applyEvent({ ...waiting, bekleyenIstek: 'uzat' }, { type: 'uzatildi', kalanMs: 300_000 });
    expect(view).toMatchObject({ evre: 'karar', bekleyenIstek: null, kararSuresi: { kalanMs: 300_000, surum: 2 } });
  });

  it('bitti sonucu yazar, bekleyen isteği temizler, bitmemiş ifadeleri çalıştırılmadı yapar', () => {
    const view = applyEvent({ ...play({ type: 'started', i: 0 }), bekleyenIstek: 'iptal' }, { type: 'bitti', sonuc: 'iptal' });
    expect(view).toMatchObject({ evre: 'bitti', sonuc: 'iptal', bekleyenIstek: null });
    expect(states(view)).toEqual(['calistirilmadi', 'calistirilmadi', 'calistirilmadi']);
  });

  it('uyarı mesajı gösterilir ve bekleyen istek yeniden gönderilebilir', () => {
    const view = applyEvent({ ...play(), bekleyenIstek: 'commit' }, { type: 'uyari', tur: 'commitReddedildi', mesaj: 'olmaz' });
    expect(view).toMatchObject({ uyari: 'olmaz', bekleyenIstek: null, evre: 'calisiyor' });
  });

  it('Çalıştırma kaydı yazılamadı uyarısı ayrı tutulur; bekleyen isteğe ve sonraki uyarılara dokunmaz', () => {
    const warned = applyEvent(
      { ...play({ type: 'kararBekleniyor', commitEdilebilir: true, kalanMs: 1 }), bekleyenIstek: 'commit' },
      { type: 'uyari', tur: 'kayitYazilamadi', mesaj: 'Çalıştırma kaydı yazılamadı' },
    );
    expect(warned).toMatchObject({ kayitUyarisi: 'Çalıştırma kaydı yazılamadı', bekleyenIstek: 'commit' });
    expect(warned.uyari).toBeUndefined();
    const done = applyEvent(warned, { type: 'bitti', sonuc: 'commit' });
    expect(done.kayitUyarisi).toBe('Çalıştırma kaydı yazılamadı');
  });
});

describe('çalıştırma görünümü: Çalıştırma modu', () => {
  it('analiz modu ve reddedilenleri yazar', () => {
    const view = play({ type: 'analiz', mod: 'autocommit', transactionDisi: [0, 1, 2], reddedilenler: [] });
    expect(view).toMatchObject({ mod: 'autocommit', reddedilenler: [] });
  });

  it('autocommit sonu özeti taşır', () => {
    const ozet = { uygulandi: 1, hatali: 1, calistirilmadi: 1 };
    expect(play({ type: 'bitti', sonuc: 'autocommit', ozet })).toMatchObject({ evre: 'bitti', sonuc: 'autocommit', ozet });
  });

  it('25001 hatasına "tek başına autocommit" ipucu eklenir; diğer hatalara eklenmez', () => {
    const error = (sqlstate: string): ServerEvent => ({ type: 'error', i: 0, ms: 1, sqlstate, mesaj: 'x', satir: 1, sutun: 1, bas: 0, bit: 1 });
    expect(play(error('25001')).ifadeler[0]!.hata?.ipucu).toBe('Bu komut tek başına autocommit olarak çalıştırılmalı.');
    expect(play(error('42P01')).ifadeler[0]!.hata?.ipucu).toBeUndefined();
  });

  it.each([
    ['hepsi uygulandı', 3, 3, false, { uygulandi: 3, hatali: 0, calistirilmadi: 0 }],
    ['ortada hata', 4, 1, true, { uygulandi: 1, hatali: 1, calistirilmadi: 2 }],
    ['hatasız durduruldu', 4, 2, false, { uygulandi: 2, hatali: 0, calistirilmadi: 2 }],
  ])('özet: %s', (_, total, applied, failed, ozet) => {
    expect(autocommitSummary(total, applied, failed)).toEqual(ozet);
  });

  it.each([
    [{ uygulandi: 3, hatali: 0, calistirilmadi: 0 }, '3 ifade kalıcı uygulandı'],
    [{ uygulandi: 2, hatali: 1, calistirilmadi: 4 }, '2 ifade kalıcı uygulandı · 1 hatalı · 4 çalıştırılmadı'],
    [{ uygulandi: 0, hatali: 1, calistirilmadi: 0 }, '0 ifade kalıcı uygulandı · 1 hatalı'],
  ])('özet metni %o', (ozet, text) => {
    expect(formatSummary(ozet)).toBe(text);
  });
});

describe('çalıştırma görünümü: Okuma modu', () => {
  const okuma: ServerEvent = { type: 'analiz', mod: 'okuma', transactionDisi: [], reddedilenler: [] };
  const error = (sqlstate: string): ServerEvent => ({ type: 'error', i: 0, ms: 1, sqlstate, mesaj: 'x', satir: 1, sutun: 1, bas: 0, bit: 1 });

  it('okumaAcik Okuma evresine geçirir ve kalan Karar süresini taşır; karar evresi değildir', () => {
    const view = play(okuma, { type: 'okumaAcik', kalanMs: 1000 });
    expect(view).toMatchObject({ evre: 'okuma', kararSuresi: { kalanMs: 1000 } });
  });

  it('Okuma transaction’ı kapanınca sonuç okuma', () => {
    expect(play(okuma, { type: 'okumaAcik', kalanMs: 1 }, { type: 'bitti', sonuc: 'okuma' })).toMatchObject({ evre: 'bitti', sonuc: 'okuma' });
  });

  it('Okuma’da 25006 hatası Transaction modunda çalıştırmayı önerir', () => {
    expect(play(okuma, error('25006')).ifadeler[0]!.hata?.transactionOnerisi).toBe(true);
  });

  it('Transaction modunda 25006 (salt okunur prod) ve Okuma’da başka hata öneri getirmez', () => {
    expect(play({ ...okuma, mod: 'transaction' }, error('25006')).ifadeler[0]!.hata?.transactionOnerisi).toBeUndefined();
    expect(play(okuma, error('42P01')).ifadeler[0]!.hata?.transactionOnerisi).toBeUndefined();
  });
});

describe('hedef kilidi', () => {
  it('çalıştırma yokken ya da bitmişken hedef değiştirilebilir', () => {
    expect(targetLock(null)).toBeNull();
    expect(targetLock(play({ type: 'bitti', sonuc: 'commit' }))).toBeNull();
    // Okuma transaction'ı yazmaz; hedef değişirse yeni çalıştırma onu kapatır.
    expect(targetLock(play({ type: 'okumaAcik', kalanMs: 1 }))).toBeNull();
  });

  it('karar beklenirken ve script çalışırken hedef değiştirilemez; neden döner', () => {
    expect(targetLock(play({ type: 'kararBekleniyor', commitEdilebilir: true, kalanMs: 1 }))).toBe('Commit/rollback kararı bekleniyor');
    expect(targetLock(play())).toBe('Script çalışıyor');
  });
});

describe('çalıştırma görünümü: daha fazla satır', () => {
  const okuma: ServerEvent = { type: 'analiz', mod: 'okuma', transactionDisi: [], reddedilenler: [] };
  const rows = (from: number, n: number) => Array.from({ length: n }, (_, k) => [String(from + k)]);
  const first: ServerEvent = { type: 'done', i: 1, rowCount: null, ms: 1, komut: 'SELECT', onizleme: { kolonlar: ['g'], tipler: [23], satirlar: rows(1, 500), dahaVar: true } };
  const open = (...events: ServerEvent[]) => play(okuma, first, { type: 'okumaAcik', kalanMs: 1000 }, ...events);
  const result = (view: RunView) => view.ifadeler[1]!;

  it('Okuma açıkken devamı olan sonuçtan daha fazla istenebilir; çalışırken ve devamı yokken istenemez', () => {
    expect(canFetchMore(open(), 1)).toBe(true);
    expect(canFetchMore(play(okuma, first), 1)).toBe(false);
    expect(canFetchMore(open(), 0)).toBe(false);
  });

  it('karar beklenirken istenebilir; hata alan transaction’da istenemez ve sonuçta belirtilir', () => {
    const karar = (commitEdilebilir: boolean) => play(first, { type: 'kararBekleniyor', commitEdilebilir, kalanMs: 1 });
    expect(canFetchMore(karar(true), 1)).toBe(true);
    expect(canFetchMore(karar(false), 1)).toBe(false);
    expect(result(karar(false)).devamKapandi).toBe(MORE_CLOSED_FAILED);
  });

  it('istek yanıtlanana kadar ikinci istek yok; gelen satırlar eklenir ve devamı yeniden istenebilir', () => {
    const asked = requestMore(open(), 1);
    expect(result(asked).yukleniyor).toBe(true);
    expect(canFetchMore(asked, 1)).toBe(false);
    const loaded = applyEvent(asked, { type: 'satirlar', i: 1, satirlar: rows(501, 500), dahaVar: true });
    expect(result(loaded).onizleme!.satirlar).toEqual(rows(1, 1000));
    expect(result(loaded).yukleniyor).toBeUndefined();
    expect(result(loaded).rowCount).toBeNull();
    expect(canFetchMore(loaded, 1)).toBe(true);
  });

  it('imlecin sonuna gelince devamı yok ve satır sayısı bilinir', () => {
    const view = open({ type: 'satirlar', i: 1, satirlar: rows(501, 20), dahaVar: false });
    expect(result(view)).toMatchObject({ rowCount: 520, onizleme: { dahaVar: false } });
    expect(canFetchMore(view, 1)).toBe(false);
  });

  it('transaction kapanınca yüklenenler kalır, daha fazla kapanır ve bu not edilir', () => {
    const view = open({ type: 'satirlar', i: 1, satirlar: rows(501, 500), dahaVar: true }, { type: 'bitti', sonuc: 'okuma' });
    expect(result(view).onizleme!.satirlar).toHaveLength(1000);
    expect(result(view).devamKapandi).toBe(MORE_CLOSED_FINISHED);
    expect(canFetchMore(view, 1)).toBe(false);
    // Devamı olmayan sonuçta not yok.
    expect(play(okuma, { ...first, onizleme: { kolonlar: ['g'], satirlar: [], dahaVar: false } } as ServerEvent, { type: 'bitti', sonuc: 'okuma' }).ifadeler[1]!.devamKapandi).toBeUndefined();
  });

  it('yanıt beklenirken transaction kapanırsa yükleniyor da kapanır', () => {
    const view = applyEvent(requestMore(open(), 1), { type: 'bitti', sonuc: 'okuma' });
    expect(result(view).yukleniyor).toBeUndefined();
  });

  it('sınıra ulaşınca daha fazla istenemez; sınır mesajı sonuçta', () => {
    const view = open({ type: 'satirlar', i: 1, satirlar: rows(501, 500), dahaVar: true, sinir: true });
    expect(result(view).sinir).toBe(true);
    expect(canFetchMore(view, 1)).toBe(false);
    expect(ROW_LIMIT_MESSAGE).toBe('Sınıra ulaşıldı, filtrele');
  });

  it('sunucu isteği reddederse yükleniyor kapanır, neden sonuçta kalır ve yeniden istenmez; bekleyen karar isteğine dokunmaz', () => {
    const asked = { ...requestMore(open(), 1), bekleyenIstek: 'uzat' as const };
    const view = applyEvent(asked, { type: 'uyari', tur: 'dahaFazla', i: 1, mesaj: 'Satırlar çekilemedi' });
    expect(result(view)).toMatchObject({ devamKapandi: 'Satırlar çekilemedi' });
    expect(result(view).yukleniyor).toBeUndefined();
    expect(view.bekleyenIstek).toBe('uzat');
    expect(canFetchMore(view, 1)).toBe(false);
  });
});
