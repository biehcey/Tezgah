import { describe, expect, it } from 'vitest';
import {
  TABS_VERSION,
  TabsFormatError,
  activateTab,
  closeTab,
  forgetConnection,
  openConsoleTab,
  parseTabs,
  restoreTabs,
  savedTabs,
  sessionTabs,
  setTabScript,
  setTabTarget,
  toggleWriteMode,
  type ConsoleState,
  type SavedTabs,
} from './konsol-sekmeleri';

const prodHedef = { connectionId: 'p1', database: 'app', schema: 'public' };

const SAVED: SavedTabs = {
  version: TABS_VERSION,
  aktif: 's2',
  sekmeler: [
    { id: 's1', tur: 'konsol', hedef: null, metin: '' },
    { id: 's2', tur: 'konsol', hedef: prodHedef, metin: 'SELECT 1;\nSELECT 2' },
    { id: 's3', tur: 'tablo', hedef: { ...prodHedef, schema: null }, sema: 'public', tablo: 'siparis', where: 'id > 3', orderBy: 'id DESC' },
  ],
};

describe('Sekme kalıcılığı: biçim', () => {
  it('kaydedilen sekmeler sırası, aktif sekmesi ve alanlarıyla geri okunur', () => {
    expect(parseTabs(JSON.parse(JSON.stringify(SAVED)))).toEqual(SAVED);
  });

  it.each([
    ['nesne değil', 'SELECT 1'],
    ['kimliksiz', { tur: 'konsol', hedef: null, metin: 'x' }],
    ['bilinmeyen tür', { id: 'x', tur: 'pencere', hedef: null }],
    ['metinsiz konsol', { id: 'x', tur: 'konsol', hedef: null }],
    ['veritabanısız hedef', { id: 'x', tur: 'konsol', hedef: { connectionId: 'p1' }, metin: '' }],
    ['tablosuz tablo sekmesi', { id: 'x', tur: 'tablo', hedef: null, sema: 'public' }],
    ['aynı kimlikli ikinci sekme', { id: 's1', tur: 'konsol', hedef: null, metin: 'ikinci' }],
  ])('bozuk sekme (%s) atlanır, kalanlar geri gelir', (_, bozuk) => {
    const raw = { ...SAVED, sekmeler: [SAVED.sekmeler[0], bozuk, SAVED.sekmeler[1]] };
    expect(parseTabs(raw).sekmeler.map((t) => t.id)).toEqual(['s1', 's2']);
  });

  it('aktif sekme bulunamazsa ilk sekme aktiftir; sekme yoksa aktif yok', () => {
    expect(parseTabs({ ...SAVED, aktif: 'silinmis' }).aktif).toBe('s1');
    expect(parseTabs({ version: 1, sekmeler: [], aktif: 's1' })).toEqual({ version: 1, sekmeler: [], aktif: null });
  });

  it('tablo sekmesinin boş WHERE ve ORDER BY\'ı varsayılanla gelir', () => {
    const raw = { version: 1, aktif: 't', sekmeler: [{ id: 't', tur: 'tablo', hedef: null, sema: 'public', tablo: 'x' }] };
    expect(parseTabs(raw).sekmeler[0]).toEqual({ id: 't', tur: 'tablo', hedef: null, sema: 'public', tablo: 'x', where: '', orderBy: '' });
  });

  it('nesne olmayan ya da daha yeni sürümlü dosya reddedilir', () => {
    expect(() => parseTabs([])).toThrow(TabsFormatError);
    expect(() => parseTabs({ sekmeler: [] })).toThrow(TabsFormatError);
    expect(() => parseTabs({ ...SAVED, version: TABS_VERSION + 1 })).toThrow(/daha yeni/);
  });
});

describe('Sekme durumu', () => {
  const restored = () => restoreTabs(SAVED, ['p1']);
  const tab = (state: ConsoleState, id: string) => state.tabs.find((t) => t.id === id)!;

  it('geri gelen sekmelerde Yazma kilidi her zaman kapalı', () => {
    expect(restored().tabs.map((t) => t.yazmaModu)).toEqual([false, false, false]);
    expect(restored().active).toBe('s2');
  });

  it('Yazma kilidi sekme başına: bir sekmede açmak diğerini etkilemez', () => {
    const state = openConsoleTab(restored(), 's4', prodHedef);
    const opened = toggleWriteMode(state, 's4');
    expect(tab(opened, 's4').yazmaModu).toBe(true);
    expect(tab(opened, 's2').yazmaModu).toBe(false);
  });

  it('sekmenin hedefi değişince Yazma kilidi kapanır; aynı hedef yeniden seçilince kalır', () => {
    const open = toggleWriteMode(restored(), 's2');
    expect(tab(setTabTarget(open, 's2', prodHedef), 's2').yazmaModu).toBe(true);
    const changed = setTabTarget(open, 's2', { ...prodHedef, database: 'raporlar' });
    expect(tab(changed, 's2')).toMatchObject({ yazmaModu: false, hedef: { database: 'raporlar' } });
  });

  it('Yazma kilidi biçime yazılmaz; kaydedip geri okuyunca kapalı gelir', () => {
    const open = toggleWriteMode(restored(), 's2');
    const saved = savedTabs(open);
    expect(JSON.stringify(saved)).not.toMatch(/yazma/i);
    expect(saved).toEqual(SAVED);
    expect(tab(restoreTabs(parseTabs(JSON.parse(JSON.stringify(saved))), ['p1']), 's2').yazmaModu).toBe(false);
  });

  it('silinmiş bağlantıya işaret eden sekme hedefsiz açılır, metni korunur', () => {
    const state = restoreTabs(SAVED, ['baska']);
    expect(tab(state, 's2')).toMatchObject({ hedef: null, metin: 'SELECT 1;\nSELECT 2' });
    expect(tab(state, 's3').hedef).toBeNull();
  });

  it('yeni sekme aktif sekmenin sağında açılır ve aktif olur', () => {
    const state = openConsoleTab(activateTab(restored(), 's1'), 's4', null);
    expect(state.tabs.map((t) => t.id)).toEqual(['s1', 's4', 's2', 's3']);
    expect(state.active).toBe('s4');
    expect(tab(state, 's4')).toMatchObject({ tur: 'konsol', metin: '', hedef: null, yazmaModu: false });
  });

  it('aktif sekme kapanınca sağındaki, yoksa solundaki aktif olur; son sekme kapanınca aktif yok', () => {
    expect(closeTab(restored(), 's2').active).toBe('s3');
    expect(closeTab(activateTab(restored(), 's3'), 's3').active).toBe('s2');
    expect(closeTab(restored(), 's1')).toMatchObject({ active: 's2' });
    let state = restored();
    for (const id of ['s1', 's2', 's3']) state = closeTab(state, id);
    expect(state).toEqual({ tabs: [], active: null });
  });

  it('konsol metni sekmeye yazılır', () => {
    expect(tab(setTabScript(restored(), 's1', 'SELECT 3'), 's1')).toMatchObject({ metin: 'SELECT 3' });
  });

  it('bağlantı silinince ona işaret eden sekmeler hedefsiz kalır', () => {
    const state = forgetConnection(toggleWriteMode(restored(), 's2'), 'p1');
    expect(state.tabs.map((t) => t.hedef)).toEqual([null, null, null]);
    expect(tab(state, 's2').yazmaModu).toBe(false);
  });
});

describe('sessionTabs', () => {
  const tab = (id: string, hedef: { connectionId: string; database: string; schema: string | null } | null) => ({
    id,
    tur: 'konsol' as const,
    hedef,
    metin: '',
    yazmaModu: false,
  });
  const state: ConsoleState = {
    tabs: [
      tab('s1', prodHedef),
      tab('s2', { connectionId: 'd1', database: 'app', schema: null }),
      tab('s3', { ...prodHedef, schema: 'rapor' }),
      tab('s4', { ...prodHedef, database: 'baska' }),
      tab('s5', prodHedef),
      tab('s6', prodHedef),
    ],
    active: 's6',
  };

  it('aynı bağlantı + veritabanında açık oturumu olan diğer sekmeler, şeritteki sırayla', () => {
    expect(sessionTabs(state, 's6', new Set(['s1', 's2', 's3', 's4', 's6']))).toEqual([
      { id: 's1', ad: 'Sekme 1' },
      { id: 's3', ad: 'Sekme 3' },
    ]);
  });

  it('hedefsiz sekmede liste boş', () => {
    expect(sessionTabs({ tabs: [tab('s1', null), tab('s2', null)], active: 's1' }, 's1', new Set(['s2']))).toEqual([]);
  });
});
