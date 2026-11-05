import { describe, expect, it } from 'vitest';
import { applyEvent, autocommitSummary, formatSummary, parseClientMessage, startRunView, targetLock, type RunView, type ServerEvent } from './script-calistirma';

describe('parseClientMessage', () => {
  it.each([
    ['run', { type: 'run', target: { connectionId: 'b1', database: 'app' }, script: 'SELECT 1', fazla: 1 }, { type: 'run', target: { connectionId: 'b1', database: 'app' }, script: 'SELECT 1', yazmaModu: false }],
    ['yazma modunda run', { type: 'run', target: { connectionId: 'b1', database: 'app' }, script: 'SELECT 1', yazmaModu: true }, { type: 'run', target: { connectionId: 'b1', database: 'app' }, script: 'SELECT 1', yazmaModu: true }],
    // Yalnızca açıkça `true` yazma modudur; belirsiz değer salt okunur kalır.
    ['yazmaModu metin', { type: 'run', target: { connectionId: 'b1', database: 'app' }, script: 'SELECT 1', yazmaModu: 'true' }, { type: 'run', target: { connectionId: 'b1', database: 'app' }, script: 'SELECT 1', yazmaModu: false }],
    ['commit', { type: 'commit' }, { type: 'commit' }],
    ['rollback', { type: 'rollback' }, { type: 'rollback' }],
    ['iptal', { type: 'iptal' }, { type: 'iptal' }],
    ['uzat', { type: 'uzat' }, { type: 'uzat' }],
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

describe('hedef kilidi', () => {
  it('çalıştırma yokken ya da bitmişken hedef değiştirilebilir', () => {
    expect(targetLock(null)).toBeNull();
    expect(targetLock(play({ type: 'bitti', sonuc: 'commit' }))).toBeNull();
  });

  it('karar beklenirken ve script çalışırken hedef değiştirilemez; neden döner', () => {
    expect(targetLock(play({ type: 'kararBekleniyor', commitEdilebilir: true, kalanMs: 1 }))).toBe('Commit/rollback kararı bekleniyor');
    expect(targetLock(play())).toBe('Script çalışıyor');
  });
});
