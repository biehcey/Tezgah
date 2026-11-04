import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { editorCursorLine, editorScript, gutterMarks, setEditorScript } from '../test/eylemler';
import { connection, createFakeApi, createFakeScriptRuns, renderWithApi } from '../test/sahte-api';
import { ScriptEkrani } from './ScriptEkrani';

const SCRIPT = 'INSERT INTO t VALUES (1);\nSELECT nope FROM t;\nDELETE FROM t';

function setup({ withTarget = true } = {}) {
  const user = userEvent.setup();
  const fake = createFakeScriptRuns();
  const target = withTarget ? { connection: connection({ id: 'b1', name: 'Yerel' }), database: 'app' } : null;
  const view = renderWithApi(<ScriptEkrani target={target} onChangeTarget={() => {}} />, createFakeApi({ runScript: fake.runScript }));
  return { user, fake, view };
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
    run.emit({ type: 'done', i: 0, rowCount: 1, ms: 1, komut: 'SELECT' }, { type: 'kararBekleniyor', commitEdilebilir: true });
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
      { type: 'kararBekleniyor', commitEdilebilir: false },
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
    run.emit({ type: 'kararBekleniyor', commitEdilebilir: true });
    view.unmount();
    expect(run.closed).toBe(true);
  });

  it('çalıştırma bitince script düzenlenirse satır işaretleri kalkar, log kalır', async () => {
    const { run } = await startRun('SELECT 1');
    run.emit({ type: 'done', i: 0, rowCount: 1, ms: 1, komut: 'SELECT' }, { type: 'kararBekleniyor', commitEdilebilir: true }, { type: 'bitti', sonuc: 'rollback' });
    setEditorScript('SELECT 2');
    expect(editorScript()).toBe('SELECT 2');
    expect(gutterMarks()).toEqual({});
    expect(cards()).toHaveLength(1);
  });
});
