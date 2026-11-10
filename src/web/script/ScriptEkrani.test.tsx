import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiProvider, CONNECTION_LOST } from '../api/client';
import type { ServerEvent } from '../../core/script-calistirma';
import { editorCursorLine, editorScript, gutterMarks, setEditorScript } from '../test/eylemler';
import { connection, createFakeApi, createFakeScriptRuns, renderWithApi } from '../test/sahte-api';
import { ScriptEkrani } from './ScriptEkrani';

/** Metni ve Yazma kilidini konsolun (sekmenin) yerine tutan sarmalayıcı. */
function Ekran(props: Omit<ComponentProps<typeof ScriptEkrani>, 'script' | 'onScriptChange' | 'writeMode' | 'onToggleWriteMode'>) {
  const [script, setScript] = useState('');
  const [writeMode, setWriteMode] = useState(false);
  return (
    <ScriptEkrani
      {...props}
      script={script}
      onScriptChange={setScript}
      writeMode={writeMode}
      onToggleWriteMode={() => setWriteMode((w) => !w)}
    />
  );
}

const DK = 60_000;
const SCRIPT = 'INSERT INTO t VALUES (1);\nSELECT nope FROM t;\nDELETE FROM t';

function setup({ withTarget = true, openRunHistoryFolder = vi.fn(() => Promise.resolve()) } = {}) {
  const user = userEvent.setup();
  const fake = createFakeScriptRuns();
  const target = withTarget ? { connection: connection({ id: 'b1', name: 'Yerel' }), database: 'app' } : null;
  const view = renderWithApi(
    <Ekran target={target} onChangeTarget={() => {}} />,
    createFakeApi({ runScript: fake.runScript, openRunHistoryFolder }),
  );
  return { user, fake, view, openRunHistoryFolder };
}

const runButton = () => screen.getByRole('button', { name: '▶ Çalıştır' });
const column = () => screen.getByRole('complementary', { name: 'Çalıştırma' });
const decision = () => screen.getByRole('region', { name: 'Karar' });
const cards = () => within(column()).queryAllByRole('listitem');
const results = () => screen.getByRole('region', { name: 'Sonuçlar' });
const resultTabs = () => within(results()).queryAllByRole('tab');

async function startRun(script = SCRIPT) {
  const ctx = setup();
  setEditorScript(script);
  await ctx.user.click(runButton());
  return { ...ctx, run: ctx.fake.last() };
}

describe('Script ekranı: çalıştırma başlatma', () => {
  it('hedef yoksa ya da script boşsa Çalıştır devre dışı', () => {
    setup({ withTarget: false });
    setEditorScript('SELECT 1');
    expect(runButton()).toBeDisabled();
  });

  it('boş ya da yalnızca yorum olan script çalıştırılamaz', () => {
    setup();
    expect(runButton()).toBeDisabled();
    setEditorScript('-- yalnızca yorum');
    expect(runButton()).toBeDisabled();
    setEditorScript('SELECT 1');
    expect(runButton()).toBeEnabled();
  });

  it('Çalıştır hedefe ve script\'e çalıştırma açar; ifadeler sırada görünür', async () => {
    const { run } = await startRun();
    expect(run.target).toEqual({ connectionId: 'b1', database: 'app' });
    expect(run.script).toBe(SCRIPT);
    expect(gutterMarks()).toEqual({ 1: '○', 2: '○', 3: '○' });
    expect(cards().map((c) => c.textContent)).toEqual([
      expect.stringContaining('satır 1'),
      expect.stringContaining('satır 2'),
      expect.stringContaining('satır 3'),
    ]);
    // Çalışırken düzenleme ve ikinci çalıştırma yok; İptal var.
    expect(screen.queryByRole('button', { name: '▶ Çalıştır' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '■ İptal' })).toBeInTheDocument();
  });
});

describe('Script ekranı: canlı olaylar', () => {
  it('started ve done satır işaretini ve kartı günceller', async () => {
    const { run } = await startRun();
    run.emit({ type: 'started', i: 0 });
    expect(gutterMarks()).toEqual({ 1: '●', 2: '○', 3: '○' });
    run.emit({ type: 'done', i: 0, rowCount: 1, ms: 3, komut: 'INSERT' });
    expect(gutterMarks()[1]).toBe('✓');
    const card = cards()[0]!;
    expect(card).toHaveTextContent('INSERT');
    expect(card).toHaveTextContent('3 ms');
    expect(card).toHaveTextContent('1 satır etkilendi');
  });

  it('hatada satır kırmızı ve dalgalı çizgili; kalanlar çalıştırılmadı; kartta SQLSTATE ve mesaj', async () => {
    const { run } = await startRun();
    run.emit(
      { type: 'started', i: 0 },
      { type: 'done', i: 0, rowCount: 1, ms: 3, komut: 'INSERT' },
      { type: 'started', i: 1 },
      { type: 'error', i: 1, ms: 1, sqlstate: '42703', mesaj: 'column "nope" does not exist', satir: 2, sutun: 8, bas: 33, bit: 37 },
    );
    expect(gutterMarks()).toEqual({ 1: '✓', 2: '✗', 3: '–' });
    expect(document.querySelectorAll('.cm-hatali-satir')).toHaveLength(1);
    expect(document.querySelector('.cm-hatali-satir')).toHaveTextContent('SELECT nope FROM t;');
    expect(document.querySelector('.cm-hata-alti')).toHaveTextContent('nope');
    expect(cards()[1]).toHaveTextContent('42703');
    expect(cards()[1]).toHaveTextContent('column "nope" does not exist');
    expect(cards()[2]).toHaveTextContent('çalıştırılmadı');
  });

  it('SELECT kartı satır sayısını gösterir; satırlar kartta değil sonuç grid’inde', async () => {
    const { run } = await startRun('SELECT g FROM generate_series(1, 750) g');
    run.emit({
      type: 'done',
      i: 0,
      rowCount: 750,
      ms: 9,
      komut: 'SELECT',
      onizleme: { kolonlar: ['g', 'bos'], tipler: [23, 25], satirlar: [['1', null], ['2', null]], dahaVar: true },
    });
    const card = cards()[0]!;
    expect(card).toHaveTextContent('750 satır');
    expect(within(card).queryByRole('grid')).not.toBeInTheDocument();
    const grid = within(results()).getByRole('grid');
    expect(within(grid).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['g', 'bos']);
    expect(within(grid).getAllByRole('gridcell').map((c) => c.textContent)).toEqual(['1', 'NULL', '2', 'NULL']);
    expect(grid).toHaveAttribute('aria-rowcount', '751');
    expect(results()).toHaveTextContent('750 satır · ilk 2 satır gösteriliyor');
  });

  it('karta tıklayınca editör o satıra gider', async () => {
    const { user, run } = await startRun();
    run.emit({ type: 'started', i: 0 });
    await user.click(within(cards()[2]!).getByRole('button'));
    expect(editorCursorLine()).toBe(3);
  });

  it('İptal sunucuya iptal gönderir', async () => {
    const { user, run } = await startRun();
    await user.click(screen.getByRole('button', { name: '■ İptal' }));
    expect(run.sent).toEqual(['iptal']);
    run.emit(
      { type: 'error', i: 0, ms: 5, sqlstate: '57014', mesaj: 'canceling statement due to user request', satir: 1, sutun: 1, bas: 0, bit: 24 },
      { type: 'bitti', sonuc: 'iptal' },
    );
    expect(within(decision()).getByText(/İptal edildi/)).toBeInTheDocument();
    expect(runButton()).toBeEnabled();
  });
});

describe('Script ekranı: karar kartı', () => {
  it('script bitince Commit ve Rollback sunulur; commit sonucu gösterilir', async () => {
    const { user, run } = await startRun('SELECT 1');
    run.emit({ type: 'done', i: 0, rowCount: 1, ms: 1, komut: 'SELECT' }, { type: 'kararBekleniyor', commitEdilebilir: true, kalanMs: 30 * DK });
    expect(screen.queryByRole('button', { name: '■ İptal' })).not.toBeInTheDocument();
    await user.click(within(decision()).getByRole('button', { name: 'Commit' }));
    expect(run.sent).toEqual(['commit']);
    run.emit({ type: 'bitti', sonuc: 'commit' });
    expect(within(decision()).getByText('Commit edildi')).toBeInTheDocument();
    expect(within(decision()).queryByRole('button')).not.toBeInTheDocument();
    expect(runButton()).toBeEnabled();
  });

  it('hatadan sonra yalnızca Rollback vardır', async () => {
    const { user, run } = await startRun('SELECT 1/0');
    run.emit(
      { type: 'error', i: 0, ms: 1, sqlstate: '22012', mesaj: 'division by zero', satir: 1, sutun: 1, bas: 0, bit: 10 },
      { type: 'kararBekleniyor', commitEdilebilir: false, kalanMs: 30 * DK },
    );
    expect(within(decision()).queryByRole('button', { name: 'Commit' })).not.toBeInTheDocument();
    expect(within(decision()).getByText(/yalnızca geri alınabilir/)).toBeInTheDocument();
    await user.click(within(decision()).getByRole('button', { name: 'Rollback' }));
    expect(run.sent).toEqual(['rollback']);
    run.emit({ type: 'bitti', sonuc: 'rollback' });
    expect(within(decision()).getByText(/Geri alındı/)).toBeInTheDocument();
  });

  it('sunucuyla bağlantı koparsa mesaj gösterilir', async () => {
    const { run } = await startRun('SELECT 1');
    run.emit({ type: 'bitti', sonuc: 'hata', mesaj: 'Tezgah sunucusuyla bağlantı koptu; açık transaction sunucuda geri alındı.' });
    expect(within(decision()).getByText(/bağlantı koptu/)).toBeInTheDocument();
    expect(gutterMarks()).toEqual({ 1: '–' });
  });

  it('ekran kapanınca çalıştırma kapatılır (transaction geri alınır)', async () => {
    const { run, view } = await startRun('SELECT 1');
    run.emit({ type: 'kararBekleniyor', commitEdilebilir: true, kalanMs: 30 * DK });
    view.unmount();
    expect(run.closed).toBe(true);
  });

  it('çalıştırma bitince script düzenlenirse satır işaretleri kalkar, log kalır', async () => {
    const { run } = await startRun('SELECT 1');
    run.emit({ type: 'done', i: 0, rowCount: 1, ms: 1, komut: 'SELECT' }, { type: 'kararBekleniyor', commitEdilebilir: true, kalanMs: 30 * DK }, { type: 'bitti', sonuc: 'rollback' });
    setEditorScript('SELECT 2');
    expect(editorScript()).toBe('SELECT 2');
    expect(gutterMarks()).toEqual({});
    expect(cards()).toHaveLength(1);
  });
});

describe('Script ekranı: Karar süresi', () => {
  beforeEach(() => {
    // Yalnızca geri sayımın saati sahte; userEvent'in setTimeout'u gerçek kalır.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const countdown = () => within(decision()).queryByRole('timer');
  const tick = (ms: number) => act(() => vi.advanceTimersByTime(ms));

  async function waiting(kalanMs = 5 * DK) {
    const ctx = await startRun('INSERT INTO t VALUES (1)');
    ctx.run.emit({ type: 'done', i: 0, rowCount: 1, ms: 1, komut: 'INSERT' }, { type: 'kararBekleniyor', commitEdilebilir: true, kalanMs });
    return ctx;
  }

  it('son dakikaya kadar geri sayım ve Uzat yok; son dakikada görünür ve işler', async () => {
    await waiting();
    expect(countdown()).not.toBeInTheDocument();
    expect(within(decision()).queryByRole('button', { name: 'Uzat' })).not.toBeInTheDocument();

    tick(4 * DK);
    expect(countdown()).toHaveTextContent('1:00');
    expect(within(decision()).getByRole('button', { name: 'Uzat' })).toBeEnabled();
    tick(18_000);
    expect(countdown()).toHaveTextContent('0:42');
  });

  it('Uzat sunucuya gönderilir; sunucu süreyi yenileyince geri sayım kalkar', async () => {
    const { user, run } = await waiting();
    tick(4.5 * DK);
    await user.click(within(decision()).getByRole('button', { name: 'Uzat' }));
    expect(run.sent).toEqual(['uzat']);
    expect(within(decision()).getByRole('button', { name: 'Uzat' })).toBeDisabled();

    run.emit({ type: 'uzatildi', kalanMs: 5 * DK });
    expect(countdown()).not.toBeInTheDocument();
    tick(4 * DK);
    expect(countdown()).toHaveTextContent('1:00');
  });

  it('süre dolunca düğmeler devre dışı; sunucu geri alınca mesaj gösterilir, log korunur', async () => {
    const { run } = await waiting();
    tick(5 * DK);
    for (const name of ['Commit', 'Rollback', 'Uzat']) {
      expect(within(decision()).getByRole('button', { name })).toBeDisabled();
    }
    run.emit({ type: 'bitti', sonuc: 'sureDoldu', mesaj: 'Süre doldu; transaction geri alındı' });
    expect(within(decision()).getByText('Süre doldu; transaction geri alındı')).toBeInTheDocument();
    expect(within(decision()).queryByRole('button')).not.toBeInTheDocument();
    expect(cards()).toHaveLength(1);
    expect(cards()[0]).toHaveTextContent('INSERT');
  });
});

describe('Script ekranı: Çalıştırma modu', () => {
  const badge = () => screen.getByTitle('Çalıştırma modu');
  const strip = () => screen.queryByRole('note', { name: 'Autocommit uyarısı' });

  it('rozet script yazılırken Transaction, Autocommit ya da Karışık olur', async () => {
    setup();
    expect(badge()).toHaveTextContent('Transaction');
    setEditorScript('VACUUM t;\nCREATE INDEX CONCURRENTLY ix ON t (a)');
    await waitFor(() => expect(badge()).toHaveTextContent('Autocommit'));
    expect(badge()).toHaveClass('autocommit');
    setEditorScript('INSERT INTO t VALUES (1);\nVACUUM t');
    await waitFor(() => expect(badge()).toHaveTextContent('Karışık'));
    expect(badge()).toHaveClass('karisik');
  });

  it('Karışık script\'te Çalıştır devre dışı; transaction dışı ifadeler ⚠ ve turuncu zeminle işaretli', async () => {
    setup();
    setEditorScript('INSERT INTO t VALUES (1);\nVACUUM t;\nSELECT 1');
    await waitFor(() => expect(runButton()).toBeDisabled());
    expect(screen.getByText(/ayrı çalıştır/)).toBeInTheDocument();
    expect(gutterMarks()).toEqual({ 2: '⚠' });
    expect(document.querySelectorAll('.cm-transaction-disi')).toHaveLength(1);
    expect(document.querySelector('.cm-transaction-disi')).toHaveTextContent('VACUUM t;');
  });

  it('reddedilen ifadeler işaretli, nedeni yazılı ve Çalıştır devre dışı', async () => {
    setup();
    setEditorScript('BEGIN;\nSELECT 1;\n\\set x 1');
    await waitFor(() => expect(runButton()).toBeDisabled());
    expect(screen.getByText(/Satır 1: Transaction'ı Tezgah yönetir/)).toBeInTheDocument();
    expect(screen.getByText(/Satır 3: psql meta komutları desteklenmez/)).toBeInTheDocument();
    expect(gutterMarks()).toEqual({ 1: '⛔', 3: '⛔' });
    expect(document.querySelectorAll('.cm-reddedilen')).toHaveLength(2);
  });

  it('Autocommit\'te başlığın altında kalıcı uyarı şeridi var; Transaction\'da yok', async () => {
    setup();
    setEditorScript('VACUUM t;\nVACUUM u');
    await waitFor(() => expect(strip()).toHaveTextContent('2 ifade anında kalıcı uygulanır, geri alınamaz'));
    setEditorScript('SELECT 1');
    await waitFor(() => expect(strip()).not.toBeInTheDocument());
  });

  it('Autocommit çalıştırması onaysız başlar; karar kartı yok, sonda özet gösterilir', async () => {
    const { run } = await startRun('VACUUM t;\nVACUUM yok;\nVACUUM u');
    expect(run.script).toBe('VACUUM t;\nVACUUM yok;\nVACUUM u');
    run.emit(
      { type: 'analiz', mod: 'autocommit', transactionDisi: [0, 1, 2], reddedilenler: [] },
      { type: 'started', i: 0 },
      { type: 'done', i: 0, rowCount: null, ms: 3, komut: 'VACUUM' },
      { type: 'started', i: 1 },
      { type: 'error', i: 1, ms: 1, sqlstate: '42P01', mesaj: 'relation "yok" does not exist', satir: 2, sutun: 8, bas: 17, bit: 20 },
      { type: 'bitti', sonuc: 'autocommit', ozet: { uygulandi: 1, hatali: 1, calistirilmadi: 1 } },
    );
    expect(within(decision()).getByText('1 ifade kalıcı uygulandı · 1 hatalı · 1 çalıştırılmadı')).toBeInTheDocument();
    expect(within(decision()).queryByRole('button')).not.toBeInTheDocument();
    expect(gutterMarks()).toEqual({ 1: '✓', 2: '✗', 3: '–' });
  });

  it('Autocommit iptal edilince "geri alındı" denmez; özet gösterilir', async () => {
    const { run } = await startRun('VACUUM t;\nVACUUM u');
    run.emit(
      { type: 'analiz', mod: 'autocommit', transactionDisi: [0, 1], reddedilenler: [] },
      { type: 'bitti', sonuc: 'iptal', ozet: { uygulandi: 1, hatali: 1, calistirilmadi: 0 } },
    );
    expect(within(decision()).getByText(/İptal edildi/)).toHaveTextContent('İptal edildi · 1 ifade kalıcı uygulandı · 1 hatalı');
    expect(within(decision()).queryByText(/geri alındı/)).not.toBeInTheDocument();
  });

  it('25001 hatasında kart "tek başına autocommit" ipucunu gösterir', async () => {
    const { run } = await startRun('INSERT INTO t VALUES (1);\nDISCARD ALL');
    run.emit({ type: 'error', i: 1, ms: 1, sqlstate: '25001', mesaj: 'DISCARD ALL cannot run inside a transaction block', satir: 2, sutun: 1, bas: 26, bit: 37 });
    expect(cards()[1]).toHaveTextContent('Bu komut tek başına autocommit olarak çalıştırılmalı.');
    expect(gutterMarks()[2]).toBe('✗');
  });

  it('Autocommit’te sunucuyla bağlantı koparsa "geri alındı" denmez', async () => {
    const { run } = await startRun('VACUUM t');
    run.emit(CONNECTION_LOST);
    expect(within(decision()).getByText(/bağlantı koptu/)).toHaveTextContent('çalışan ifade iptal edildi');
    expect(within(decision()).queryByText(/geri alındı/)).not.toBeInTheDocument();
  });

  it('sunucu reddederse nedeni gösterilir', async () => {
    const { run } = await startRun('SELECT 1');
    run.emit({ type: 'bitti', sonuc: 'reddedildi', mesaj: 'Satır 1: olmaz' });
    expect(within(decision()).getByText('Satır 1: olmaz')).toBeInTheDocument();
  });
});

describe('Script ekranı: Okuma modu', () => {
  const badge = () => screen.getByTitle('Çalıştırma modu');
  const tryButton = () => screen.getByRole('button', { name: '⟲ Dene' });
  const readStatus = () => screen.queryByRole('status', { name: 'Okuma durumu' });
  const okuma: ServerEvent = { type: 'analiz', mod: 'okuma', transactionDisi: [], reddedilenler: [] };

  it('salt okuyan script’te rozet Okuma; Dene devre dışı ve nedeni yazılı', async () => {
    setup();
    setEditorScript('SELECT 1;\nSHOW search_path');
    await waitFor(() => expect(badge()).toHaveTextContent('Okuma'));
    expect(badge()).toHaveClass('okuma');
    expect(tryButton()).toBeDisabled();
    expect(tryButton()).toHaveAttribute('title', expect.stringContaining('Deneme gerekmez'));
    expect(runButton()).toBeEnabled();
    setEditorScript('SELECT 1;\nDELETE FROM t');
    await waitFor(() => expect(badge()).toHaveTextContent('Transaction'));
    expect(tryButton()).toBeEnabled();
  });

  it('Okuma bitince karar kartı yok; yerinde transaction açık ve kalan süre yazan durum satırı', async () => {
    const { run } = await startRun('SELECT 1');
    run.emit(okuma, { type: 'started', i: 0 }, { type: 'done', i: 0, rowCount: 1, ms: 1, komut: 'SELECT' }, { type: 'okumaAcik', kalanMs: 30 * DK });
    expect(screen.queryByRole('region', { name: 'Karar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Commit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Rollback' })).not.toBeInTheDocument();
    expect(readStatus()).toHaveTextContent('transaction açık');
    expect(within(readStatus()!).getByRole('timer')).toHaveTextContent('30:00');
    // Script düzenlenebilir ve yeniden çalıştırılabilir.
    expect(runButton()).toBeEnabled();
  });

  it('yeniden çalıştırma önceki çalıştırmayı kapatır (Okuma transaction’ı geri alınır)', async () => {
    const { user, run } = await startRun('SELECT 1');
    run.emit(okuma, { type: 'okumaAcik', kalanMs: 30 * DK });
    await user.click(runButton());
    expect(run.closed).toBe(true);
  });

  it('transaction kapanınca durum satırı bunu söyler', async () => {
    const { run } = await startRun('SELECT 1');
    run.emit(okuma, { type: 'okumaAcik', kalanMs: 30 * DK }, { type: 'bitti', sonuc: 'okuma', mesaj: "Süre doldu; Okuma transaction'ı kapandı" });
    expect(screen.queryByRole('region', { name: 'Karar' })).not.toBeInTheDocument();
    expect(readStatus()).toHaveTextContent("Süre doldu; Okuma transaction'ı kapandı");
  });

  it('25006 hatasında "Transaction modunda çalıştır" aynı script’i zorlaTransaction ile yeniden çalıştırır', async () => {
    const { user, fake, run } = await startRun("SELECT nextval('s')");
    expect(run.zorlaTransaction).toBeUndefined();
    run.emit(
      okuma,
      { type: 'error', i: 0, ms: 1, sqlstate: '25006', mesaj: 'cannot execute nextval() in a read-only transaction', satir: 1, sutun: 1, bas: 0, bit: 19 },
      { type: 'bitti', sonuc: 'okuma' },
    );
    // Editör sonradan değişse de hata alan script yeniden çalışır.
    setEditorScript("SELECT nextval('s') -- düzenlendi");
    await user.click(within(cards()[0]!).getByRole('button', { name: 'Transaction modunda çalıştır' }));
    expect(fake.runs).toHaveLength(2);
    expect(fake.last()).toMatchObject({ script: "SELECT nextval('s')", zorlaTransaction: true, deneme: false });
    expect(run.closed).toBe(true);
    // Sunucu Transaction modu bildirince karar kartı gelir.
    fake.last().emit({ ...okuma, mod: 'transaction' }, { type: 'kararBekleniyor', commitEdilebilir: true, kalanMs: 30 * DK });
    expect(within(decision()).getByRole('button', { name: 'Commit' })).toBeInTheDocument();
  });

  it('Transaction modunda 25006 (salt okunur prod) düğme getirmez', async () => {
    const { run } = await startRun('INSERT INTO t VALUES (1)');
    run.emit(
      { ...okuma, mod: 'transaction' },
      { type: 'error', i: 0, ms: 1, sqlstate: '25006', mesaj: 'read-only', satir: 1, sutun: 1, bas: 0, bit: 6 },
    );
    expect(screen.queryByRole('button', { name: 'Transaction modunda çalıştır' })).not.toBeInTheDocument();
  });
});

describe('Script ekranı: Çalıştırma kaydı', () => {
  const header = () => screen.getByRole('region', { name: 'Hedef' });

  it('hedef başlığındaki bağlantı kayıt klasörünü açar', async () => {
    const { user, openRunHistoryFolder } = setup();
    await user.click(within(header()).getByRole('button', { name: 'Çalıştırma kayıtları klasörünü aç' }));
    expect(openRunHistoryFolder).toHaveBeenCalledOnce();
  });

  it('klasör açılamazsa nedeni başlıkta görünür', async () => {
    const { user } = setup({ openRunHistoryFolder: vi.fn(() => Promise.reject(new Error('izin yok'))) });
    await user.click(within(header()).getByRole('button', { name: 'Çalıştırma kayıtları klasörünü aç' }));
    expect(await within(header()).findByRole('alert')).toHaveTextContent('Kayıt klasörü açılamadı: izin yok');
  });

  it('kayıt yazılamazsa çalıştırma sürer; uyarı karar kartında kalır', async () => {
    const { run, user } = await startRun('SELECT 1');
    run.emit({ type: 'uyari', tur: 'kayitYazilamadi', mesaj: 'Çalıştırma kaydı yazılamadı' });
    run.emit({ type: 'started', i: 0 }, { type: 'done', i: 0, rowCount: 1, ms: 1, komut: 'SELECT' });
    run.emit({ type: 'kararBekleniyor', commitEdilebilir: true, kalanMs: 30 * DK });
    expect(within(decision()).getByRole('status')).toHaveTextContent('Çalıştırma kaydı yazılamadı');
    await user.click(within(decision()).getByRole('button', { name: 'Commit' }));
    run.emit({ type: 'bitti', sonuc: 'commit' });
    expect(decision()).toHaveTextContent('Commit edildi');
    expect(within(decision()).getByRole('status')).toHaveTextContent('Çalıştırma kaydı yazılamadı');
  });
});

describe('Script ekranı: prod yazma kilidi', () => {
  const prodTarget = (database = 'app') => ({
    connection: connection({ id: 'p1', name: 'Canlı', envTag: 'prod', color: '#d33' }),
    database,
  });

  function setupProd() {
    const user = userEvent.setup();
    const fake = createFakeScriptRuns();
    const api = createFakeApi({ runScript: fake.runScript });
    const screenFor = (target: ReturnType<typeof prodTarget> | null) => (
      <ApiProvider client={api}>
        <Ekran target={target} onChangeTarget={() => {}} />
      </ApiProvider>
    );
    const view = render(screenFor(prodTarget()));
    const showTarget = (target: ReturnType<typeof prodTarget> | null) => view.rerender(screenFor(target));
    return { user, fake, showTarget };
  }

  const lockButton = () => screen.getByRole('button', { name: /Salt okunur|Yazma açık/ });

  it('prod hedef 🔒 Salt okunur açılır ve çalıştırma salt okunur gider', async () => {
    const { user, fake } = setupProd();
    expect(lockButton()).toHaveTextContent('🔒 Salt okunur');
    expect(lockButton()).toHaveAttribute('aria-pressed', 'false');
    setEditorScript('SELECT 1');
    await user.click(runButton());
    expect(fake.last().yazmaModu).toBe(false);
  });

  it('hedef başlığında ortam etiketinin yanında kilit rozeti durumu gösterir', async () => {
    const { user } = setupProd();
    const header = screen.getByRole('region', { name: 'Hedef' });
    expect(within(header).getByTitle('Yazma kilidi')).toHaveTextContent('🔒 Salt okunur');
    await user.click(lockButton());
    expect(within(header).getByTitle('Yazma kilidi')).toHaveTextContent('🔓 Yazma açık');
  });

  it('düğme yazma modunu tek tıkla açar ve kapatır; çalıştırma onaysız yazma moduyla gider', async () => {
    const { user, fake } = setupProd();
    await user.click(lockButton());
    expect(lockButton()).toHaveTextContent('🔓 Yazma açık');
    expect(lockButton()).toHaveAttribute('aria-pressed', 'true');
    setEditorScript('INSERT INTO t VALUES (1)');
    await user.click(runButton());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(fake.last().yazmaModu).toBe(true);
    // Ek şerit yok.
    expect(screen.queryByRole('note')).not.toBeInTheDocument();

    fake.last().emit({ type: 'bitti', sonuc: 'iptal' });
    await user.click(lockButton());
    expect(lockButton()).toHaveTextContent('🔒 Salt okunur');
    await user.click(runButton());
    expect(fake.last().yazmaModu).toBe(false);
  });

  it('prod olmayan hedefte kilit düğmesi yok ve yazma modu gönderilmez', async () => {
    const { user, fake } = setup();
    expect(screen.queryByRole('button', { name: /Salt okunur|Yazma açık/ })).not.toBeInTheDocument();
    setEditorScript('SELECT 1');
    await user.click(runButton());
    expect(fake.last().yazmaModu).toBe(false);
  });

  it('salt okunur prod’da Autocommit script’i çalıştırılamaz; yazma modu açılınca çalışır', async () => {
    const { user, fake } = setupProd();
    setEditorScript('VACUUM t');
    await waitFor(() => expect(runButton()).toBeDisabled());
    expect(screen.getByText(/Salt okunur prod'da Autocommit/)).toBeInTheDocument();
    await user.click(lockButton());
    expect(runButton()).toBeEnabled();
    await user.click(runButton());
    expect(fake.last().yazmaModu).toBe(true);
  });

  it('çalıştırma sürerken kilit değiştirilemez', async () => {
    const { user, fake } = setupProd();
    setEditorScript('SELECT 1');
    await user.click(runButton());
    expect(lockButton()).toBeDisabled();
    fake.last().emit({ type: 'kararBekleniyor', commitEdilebilir: true, kalanMs: 5 * DK });
    expect(lockButton()).toBeDisabled();
    fake.last().emit({ type: 'bitti', sonuc: 'rollback' });
    expect(lockButton()).toBeEnabled();
  });
});

describe('Script ekranı: prod’da deneme', () => {
  const strip = () => screen.queryByRole('note', { name: 'Deneme yan etki uyarısı' });

  function setupTarget(envTag: 'prod' | 'staging') {
    const user = userEvent.setup();
    const fake = createFakeScriptRuns();
    const api = createFakeApi({ runScript: fake.runScript });
    const screenFor = (tag: 'prod' | 'staging') => (
      <ApiProvider client={api}>
        <Ekran target={{ connection: connection({ id: 'p1', name: 'Canlı', envTag: tag }), database: 'app' }} onChangeTarget={() => {}} />
      </ApiProvider>
    );
    const view = render(screenFor(envTag));
    return { user, fake, showTarget: (tag: 'prod' | 'staging') => view.rerender(screenFor(tag)) };
  }

  it('salt okunur prod’da Dene onaysız başlar; deneme sürdükçe ve bitince kapatılamayan yan etki şeridi', async () => {
    const { user, fake } = setupTarget('prod');
    setEditorScript('UPDATE t SET a = 1');
    expect(strip()).toBeNull();
    await user.click(screen.getByRole('button', { name: '⟲ Dene' }));
    expect(fake.last()).toMatchObject({ deneme: true, yazmaModu: false });
    expect(strip()).toHaveTextContent(
      "Deneme prod'da çalışır: satır kilitleri alır, sequence'ler ilerler (nextval geri alınmaz), tetikleyici/FDW/dblink dış etkileri geri alınmaz.",
    );
    expect(within(strip()!).queryByRole('button')).toBeNull();
    fake.last().emit({ type: 'bitti', sonuc: 'deneme' });
    expect(await screen.findByText(/Deneme geri alındı/)).toBeInTheDocument();
    expect(strip()).toBeInTheDocument();

    // Normal çalıştırmada şerit yok.
    await user.click(runButton());
    expect(strip()).toBeNull();
  });

  it('prod dışında şerit yok; hedef sonradan prod’a değişse de o deneme için çıkmaz', async () => {
    const { user, fake, showTarget } = setupTarget('staging');
    setEditorScript('UPDATE t SET a = 1');
    await user.click(screen.getByRole('button', { name: '⟲ Dene' }));
    expect(strip()).toBeNull();
    fake.last().emit({ type: 'bitti', sonuc: 'deneme' });
    await screen.findByText(/Deneme geri alındı/);
    showTarget('prod');
    expect(strip()).toBeNull();
  });
});

describe('Script ekranı: Deneme modu', () => {
  const tryButton = () => screen.getByRole('button', { name: '⟲ Dene' });
  const tabs = () => within(column()).getAllByRole('tab').map((t) => [t.textContent, t.getAttribute('aria-selected')]);
  const changes = () => within(column()).getByRole('tabpanel', { name: 'Değişiklikler' });
  const DML = 'UPDATE t SET a = 1;\nSELECT a FROM t;\nINSERT INTO t VALUES (9);\nDELETE FROM t WHERE id = 2';

  async function startTry(script = DML) {
    const ctx = setup();
    setEditorScript(script);
    await ctx.user.click(tryButton());
    return { ...ctx, run: ctx.fake.last() };
  }

  it('normal çalıştırmada yalnızca Log sekmesi var', async () => {
    const { run } = await startRun();
    expect(run.deneme).toBe(false);
    expect(tabs()).toEqual([['Log', 'true']]);
  });

  it('Dene denemeyi başlatır; Değişiklikler varsayılan, Log da var', async () => {
    const { user, run } = await startTry();
    expect(run).toMatchObject({ deneme: true, script: DML });
    expect(tabs()).toEqual([
      ['Değişiklikler', 'true'],
      ['Log', 'false'],
    ]);
    await user.click(within(column()).getByRole('tab', { name: 'Log' }));
    expect(tabs()).toEqual([
      ['Değişiklikler', 'false'],
      ['Log', 'true'],
    ]);
    expect(cards()).toHaveLength(4);
  });

  it('Değişiklikler ifade başına DML önizlemesini ve satır sayısını gösterir; SELECT sonucu sonuç sekmesinde', async () => {
    const { user, run } = await startTry();
    run.emit(
      { type: 'done', i: 0, rowCount: 250, ms: 3, komut: 'UPDATE', degisiklik: { kolonlar: ['id', 'a'], satirlar: [['1', '1'], ['2', null]] } },
      { type: 'done', i: 1, rowCount: 1, ms: 1, komut: 'SELECT', onizleme: { kolonlar: ['a'], satirlar: [['secilen']] } },
      { type: 'done', i: 2, rowCount: 1, ms: 1, komut: 'INSERT', degisiklik: { kolonlar: ['id', 'a'], satirlar: [['9', null]] } },
      { type: 'done', i: 3, rowCount: 0, ms: 1, komut: 'DELETE', degisiklik: { kolonlar: ['id', 'a'], satirlar: [] } },
      { type: 'bitti', sonuc: 'deneme' },
    );
    const sections = within(changes()).getAllByRole('article');
    expect(sections.map((s) => within(s).getByRole('heading').textContent)).toEqual([
      'UPDATE · satır 1 · 250 satır güncellendi',
      'INSERT · satır 3 · 1 satır eklendi',
      'DELETE · satır 4 · 0 satır silindi',
    ]);
    expect(sections[0]).toHaveTextContent('ilk 100 satır gösteriliyor');
    expect(within(sections[0]!).getAllByRole('row')).toHaveLength(3);
    expect(within(sections[2]!).queryByRole('table')).not.toBeInTheDocument();
    expect(changes()).not.toHaveTextContent('secilen');

    expect(within(results()).getByRole('grid')).toHaveTextContent('secilen');
    await user.click(within(column()).getByRole('tab', { name: 'Log' }));
    expect(cards()[1]).toHaveTextContent('1 satır');
    // DML'in satırları Log'da tekrarlanmaz; satır sayısı yeter.
    expect(cards()[0]).toHaveTextContent('250 satır etkilendi');
    expect(within(cards()[0]!).queryByRole('table')).not.toBeInTheDocument();
  });

  describe('önce/sonra farkı', () => {
    const MUSTERI = { oid: '100', ad: 'public.musteri' };
    const NONE = { eklendi: 0, guncellendi: 0, silindi: 0 };
    const fark = (satirlar: { once: (string | null)[] | null; sonra: (string | null)[] | null }[], gorulmeyen = NONE) => ({
      tablo: MUSTERI,
      kolonlar: ['id', 'ad', 'sehir'],
      anahtar: ['id'],
      satirlar,
      gorulmeyen,
    });
    const section = () => within(changes()).getByRole('region', { name: 'public.musteri' });

    it('tabloya göre gruplanır: sayılar, eklenen/silinen satır ve yalnızca değişen hücrede eski değer üstü çizili', async () => {
      const { run } = await startTry();
      run.emit(
        { type: 'done', i: 0, rowCount: 1, ms: 3, komut: 'UPDATE', fark: fark([{ once: ['1', 'Ali', 'İzmir'], sonra: ['1', 'Ali', 'Ankara'] }]) },
        { type: 'done', i: 1, rowCount: 1, ms: 1, komut: 'SELECT', onizleme: { kolonlar: ['a'], satirlar: [['1']] } },
        { type: 'done', i: 2, rowCount: 1, ms: 1, komut: 'INSERT', fark: fark([{ once: null, sonra: ['9', 'Can', null] }]) },
        { type: 'done', i: 3, rowCount: 1, ms: 1, komut: 'DELETE', fark: fark([{ once: ['2', 'Ayşe', 'Bursa'], sonra: null }]) },
        { type: 'bitti', sonuc: 'deneme' },
      );
      expect(within(section()).getByRole('heading')).toHaveTextContent('public.musteri+1 eklendi · ~1 güncellendi · −1 silindi');
      const [, updated, inserted, deleted] = within(section()).getAllByRole('row');
      const cells = (row: HTMLElement) => within(row).getAllByRole('cell');
      expect(cells(updated!).map((c) => c.textContent)).toEqual(['~', '1', 'Ali', 'İzmirAnkara']);
      expect(within(cells(updated!)[3]!).getByRole('deletion')).toHaveTextContent('İzmir');
      expect(within(cells(updated!)[2]!).queryByRole('deletion')).not.toBeInTheDocument();
      expect(cells(inserted!).map((c) => c.textContent)).toEqual(['+', '9', 'Can', 'NULL']);
      expect(inserted).toHaveClass('eklendi');
      expect(cells(deleted!).map((c) => c.textContent)).toEqual(['−', '2', 'Ayşe', 'Bursa']);
      expect(deleted).toHaveClass('silindi');
      // Farkı olan DML için ayrıca ifade kartı yok.
      expect(within(changes()).queryByRole('article')).not.toBeInTheDocument();
    });

    it('100 satırdan fazlası "… N satır daha" ile söylenir', async () => {
      const { run } = await startTry('UPDATE t SET a = 1');
      const rows = Array.from({ length: 100 }, (_, i) => ({ once: [String(i), 'a', null], sonra: [String(i), 'b', null] }));
      run.emit({ type: 'done', i: 0, rowCount: 130, ms: 3, komut: 'UPDATE', fark: fark(rows, { ...NONE, guncellendi: 30 }) }, { type: 'bitti', sonuc: 'deneme' });
      expect(within(section()).getByRole('heading')).toHaveTextContent('~130 güncellendi');
      expect(section()).toHaveTextContent('… 30 satır daha');
      expect(within(section()).getAllByRole('row')).toHaveLength(101);
    });

    it('DDL’in şema farkı tablonun bölümünde', async () => {
      const { run } = await startTry('ALTER TABLE musteri ADD COLUMN son_giris timestamptz');
      const kolon = (no: number, ad: string, tip: string) => ({ no, ad, tip, bos: true, varsayilan: null });
      run.emit(
        {
          type: 'done',
          i: 0,
          rowCount: null,
          ms: 3,
          komut: 'ALTER TABLE',
          sema: [
            { oid: '100', once: { ad: 'public.musteri', kolonlar: [kolon(1, 'id', 'integer')] }, sonra: { ad: 'public.musteri', kolonlar: [kolon(1, 'id', 'integer'), kolon(2, 'son_giris', 'timestamp with time zone')] } },
          ],
        },
        { type: 'bitti', sonuc: 'deneme' },
      );
      expect(within(section()).getByRole('list', { name: 'Şema farkı' })).toHaveTextContent('+ kolon son_giris timestamp with time zone NULL');
      expect(within(section()).queryByRole('table')).not.toBeInTheDocument();
    });

    it('tablo bölümleri ve yedek kartları script sırasıyla dizilir', async () => {
      const { run } = await startTry();
      run.emit(
        { type: 'done', i: 0, rowCount: 1, ms: 3, komut: 'UPDATE', degisiklik: { kolonlar: ['id'], satirlar: [['1']] }, farkYok: 'anahtar' },
        { type: 'done', i: 2, rowCount: 1, ms: 1, komut: 'INSERT', fark: fark([{ once: null, sonra: ['9', 'Can', null] }]) },
        { type: 'done', i: 3, rowCount: 1, ms: 1, komut: 'DELETE', degisiklik: { kolonlar: ['id'], satirlar: [['2']] }, farkYok: 'anahtar' },
        { type: 'bitti', sonuc: 'deneme' },
      );
      const blocks = within(changes()).getAllByRole('heading').map((h) => h.textContent);
      expect(blocks).toEqual([
        'UPDATE · satır 1 · 1 satır güncellendi',
        'public.musteri+1 eklendi',
        'DELETE · satır 4 · 1 satır silindi',
      ]);
    });

    it('yedeğe düşen ifade nedenini söyleyen notla önizlenir', async () => {
      const { run } = await startTry();
      run.emit(
        { type: 'done', i: 0, rowCount: 1, ms: 3, komut: 'UPDATE', degisiklik: { kolonlar: ['id'], satirlar: [['1']] }, farkYok: 'surum' },
        { type: 'bitti', sonuc: 'deneme' },
      );
      const [card] = within(changes()).getAllByRole('article');
      expect(within(card!).getByRole('note')).toHaveTextContent('Sunucu PostgreSQL 18’den eski');
    });
  });

  it('karar kartı yerine "deneme geri alındı" özeti; Commit/Rollback yok', async () => {
    const { run } = await startTry();
    run.emit({ type: 'done', i: 0, rowCount: 1, ms: 3, komut: 'UPDATE', degisiklik: { kolonlar: ['id'], satirlar: [['1']] } });
    run.emit({ type: 'bitti', sonuc: 'deneme' });
    expect(within(decision()).getByText('Deneme geri alındı; hiçbir şey kalıcı yazılmadı')).toBeInTheDocument();
    expect(within(decision()).queryByRole('button')).not.toBeInTheDocument();
    expect(tryButton()).toBeEnabled();
  });

  it('hata: banner’da hatalı satır ve SQLSTATE, altında hataya kadar olan önizlemeler; sonuç yine geri alındı', async () => {
    const { run } = await startTry();
    run.emit(
      { type: 'done', i: 0, rowCount: 1, ms: 3, komut: 'UPDATE', degisiklik: { kolonlar: ['id'], satirlar: [['1']] } },
      { type: 'done', i: 1, rowCount: 1, ms: 1, komut: 'SELECT', onizleme: { kolonlar: ['a'], satirlar: [['1']] } },
      { type: 'error', i: 2, ms: 1, sqlstate: '23505', mesaj: 'duplicate key', satir: 3, sutun: 1, bas: 37, bit: 61 },
      { type: 'bitti', sonuc: 'deneme' },
    );
    expect(within(changes()).getByRole('alert')).toHaveTextContent('Satır 3 · 23505 · duplicate key');
    expect(within(changes()).getAllByRole('article').map((s) => within(s).getByRole('heading').textContent)).toEqual([
      'UPDATE · satır 1 · 1 satır güncellendi',
    ]);
    expect(within(decision()).getByText('Deneme hatada durdu; geri alındı')).toBeInTheDocument();
    expect(gutterMarks()).toEqual({ 1: '✓', 2: '✓', 3: '✗', 4: '–' });
  });

  it('Autocommit script’i denenemez; nedeni Dene’nin açıklamasında, Çalıştır açık', async () => {
    setup();
    setEditorScript('VACUUM t;\nVACUUM u');
    await waitFor(() => expect(tryButton()).toBeDisabled());
    expect(runButton()).toBeEnabled();
    expect(tryButton()).toHaveAccessibleDescription(
      'Satır 1: Transaction dışı komut Deneme modunda çalıştırılamaz; geri alınamaz.\nSatır 2: Transaction dışı komut Deneme modunda çalıştırılamaz; geri alınamaz.',
    );
    // Normal çalıştırmanın önünde engel yok; editörün altında liste çıkmaz.
    expect(screen.queryByText(/Deneme modunda çalıştırılamaz/)).not.toBeInTheDocument();
  });

  it('Karışık script’te transaction dışı ifadeler işaretli; Dene de Çalıştır da kapalı', async () => {
    setup();
    setEditorScript('UPDATE t SET a = 1;\nVACUUM t');
    await waitFor(() => expect(tryButton()).toBeDisabled());
    expect(runButton()).toBeDisabled();
    expect(gutterMarks()).toEqual({ 2: '⚠' });
    expect(tryButton()).toHaveAccessibleDescription(expect.stringContaining('Satır 2: Transaction dışı komut Deneme modunda'));
  });
});

describe('Script ekranı: sonuç sekmeleri', () => {
  const page = (deger: string) => ({ kolonlar: ['a'], tipler: [25], satirlar: [[deger]], dahaVar: false });

  it('çalıştırmadan önce sonuç sekmesi yok', () => {
    setup();
    expect(resultTabs()).toEqual([]);
    expect(results()).toHaveTextContent('SELECT sonuçları burada açılır');
  });

  it('her SELECT kendi sonuç sekmesinde; satır döndürmeyen ifadenin sekmesi yok; sekme seçilince grid’i görünür', async () => {
    const { user, run } = await startRun('SELECT 1;\nINSERT INTO t VALUES (1);\nSELECT 2');
    run.emit(
      { type: 'done', i: 0, rowCount: 1, ms: 1, komut: 'SELECT', onizleme: page('bir') },
      { type: 'done', i: 1, rowCount: 1, ms: 1, komut: 'INSERT' },
      { type: 'done', i: 2, rowCount: 1, ms: 1, komut: 'SELECT', onizleme: page('iki') },
    );
    expect(resultTabs().map((t) => t.textContent)).toEqual(['SELECT · satır 1', 'SELECT · satır 3']);
    expect(resultTabs()[0]).toHaveAttribute('aria-selected', 'true');
    expect(within(results()).getByRole('grid')).toHaveTextContent('bir');
    await user.click(resultTabs()[1]!);
    expect(within(results()).getByRole('grid')).toHaveTextContent('iki');
    expect(resultTabs()[1]).toHaveAttribute('aria-selected', 'true');
  });

  it('yeniden çalıştırınca eski sonuç sekmeleri silinir', async () => {
    const { user, fake } = await startRun('SELECT 1;\nSELECT 2');
    fake.last().emit(
      { type: 'done', i: 0, rowCount: 1, ms: 1, komut: 'SELECT', onizleme: page('eski 1') },
      { type: 'done', i: 1, rowCount: 1, ms: 1, komut: 'SELECT', onizleme: page('eski 2') },
      { type: 'okumaAcik', kalanMs: DK },
    );
    expect(resultTabs()).toHaveLength(2);
    await user.click(runButton());
    expect(resultTabs()).toEqual([]);
    expect(screen.queryByText('eski 1')).not.toBeInTheDocument();
    fake.last().emit({ type: 'done', i: 0, rowCount: 1, ms: 1, komut: 'SELECT', onizleme: page('yeni') });
    expect(resultTabs()).toHaveLength(1);
    expect(within(results()).getByRole('grid')).toHaveTextContent('yeni');
  });

  it('sonuç grid’inde Ctrl+C seçili hücreyi panoya kopyalar', async () => {
    const { user, run } = await startRun('SELECT 1');
    run.emit({ type: 'done', i: 0, rowCount: 1, ms: 1, komut: 'SELECT', onizleme: page('panoya') });
    await user.click(within(results()).getByRole('gridcell'));
    await user.keyboard('{Control>}c{/Control}');
    expect(await navigator.clipboard.readText()).toBe('panoya');
  });
});
