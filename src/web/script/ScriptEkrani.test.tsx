import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toggleWritable, type WritableTargets } from '../../core/yazma-kilidi';
import { ApiProvider, CONNECTION_LOST } from '../api/client';
import { editorCursorLine, editorScript, gutterMarks, setEditorScript } from '../test/eylemler';
import { connection, createFakeApi, createFakeScriptRuns, renderWithApi } from '../test/sahte-api';
import { ScriptEkrani } from './ScriptEkrani';

/** Yazma kilidini uygulamanın (App) yerine tutan sarmalayıcı. */
function Ekran(props: Omit<ComponentProps<typeof ScriptEkrani>, 'writable' | 'onToggleWriteMode'>) {
  const [writable, setWritable] = useState<WritableTargets>([]);
  return <ScriptEkrani {...props} writable={writable} onToggleWriteMode={(t) => setWritable((w) => toggleWritable(w, t))} />;
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

  it('SELECT kartı satır sayısını ve önizlemeyi gösterir', async () => {
    const { run } = await startRun('SELECT g FROM generate_series(1, 250) g');
    run.emit({
      type: 'done',
      i: 0,
      rowCount: 250,
      ms: 9,
      komut: 'SELECT',
      onizleme: { kolonlar: ['g', 'bos'], satirlar: [['1', null], ['2', null]] },
    });
    const card = cards()[0]!;
    expect(card).toHaveTextContent('250 satır');
    expect(card).toHaveTextContent('ilk 100');
    const table = within(card).getByRole('table');
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['g', 'bos']);
    expect(within(table).getAllByRole('row')).toHaveLength(3);
    expect(within(table).getAllByText('NULL')).toHaveLength(2);
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

  it('kilit hedef başına tutulur: başka hedef salt okunur açılır, geri dönünce yazma açık kalır', async () => {
    const { user, showTarget } = setupProd();
    await user.click(lockButton());
    showTarget(prodTarget('raporlar'));
    expect(lockButton()).toHaveTextContent('🔒 Salt okunur');
    showTarget(prodTarget('app'));
    expect(lockButton()).toHaveTextContent('🔓 Yazma açık');
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
