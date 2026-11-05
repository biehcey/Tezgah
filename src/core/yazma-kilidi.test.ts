import { describe, expect, it } from 'vitest';
import { splitStatements } from './ifade-bolme';
import {
  DENEME_NON_TRANSACTIONAL_MESSAGE,
  READ_ONLY_AUTOCOMMIT_MESSAGE,
  beginStatement,
  isWritable,
  runBlockReasons,
  toggleWritable,
  writeLockState,
  type WriteLockState,
} from './yazma-kilidi';

describe('yazma kilidi', () => {
  it.each([
    ['prod', false, 'salt-okunur'],
    ['prod', true, 'yazma-acik'],
    ['staging', true, null],
    ['local', false, null],
    [null, true, null],
  ] as const)('%s ortamında yazmaModu=%s → %s', (envTag, yazmaModu, expected) => {
    expect(writeLockState(envTag, yazmaModu)).toBe(expected);
  });

  it.each([
    ['salt-okunur', 'BEGIN READ ONLY'],
    ['yazma-acik', 'BEGIN READ WRITE'],
    [null, 'BEGIN'],
  ] as const)('%s kilidinde transaction %s ile açılır', (lock, expected) => {
    expect(beginStatement(lock)).toBe(expected);
  });
});

describe('yazma modu açık hedefler', () => {
  const app = { connectionId: 'p1', database: 'app' };
  const raporlar = { connectionId: 'p1', database: 'raporlar' };

  it('başta hiçbir hedef yazma modunda değil', () => {
    expect(isWritable([], app)).toBe(false);
  });

  it('aç/kapa yalnızca o hedefi değiştirir', () => {
    const opened = toggleWritable(toggleWritable([], app), raporlar);
    expect(isWritable(opened, app)).toBe(true);
    expect(isWritable(opened, raporlar)).toBe(true);
    const closed = toggleWritable(opened, { ...app });
    expect(isWritable(closed, app)).toBe(false);
    expect(isWritable(closed, raporlar)).toBe(true);
  });

  it('aynı bağlantının başka veritabanı ya da başka bağlantının aynı veritabanı ayrı hedeftir', () => {
    const opened = toggleWritable([], app);
    expect(isWritable(opened, raporlar)).toBe(false);
    expect(isWritable(opened, { connectionId: 'p2', database: 'app' })).toBe(false);
  });
});

describe('runBlockReasons: çalıştırma engelleri', () => {
  const reasons = (script: string, lock: WriteLockState) => runBlockReasons(script, splitStatements(script), lock);

  it('salt okunur prod’da Autocommit script’i satırsız bir nedenle engellenir', () => {
    expect(reasons('VACUUM t', 'salt-okunur')).toEqual([{ satir: null, mesaj: READ_ONLY_AUTOCOMMIT_MESSAGE }]);
  });

  it.each([
    ['VACUUM t', 'yazma-acik'],
    ['VACUUM t', null],
    ['INSERT INTO t VALUES (1)', 'salt-okunur'],
    ['INSERT INTO t VALUES (1)', 'yazma-acik'],
  ] as const)('%s, %s kilidinde engellenmez', (script, lock) => {
    expect(reasons(script, lock)).toEqual([]);
  });

  describe('Deneme modu', () => {
    const dene = (script: string, lock: WriteLockState = null) =>
      runBlockReasons(script, splitStatements(script), lock, { deneme: true });

    it('transaction dışı her ifade satırıyla engellenir; Autocommit kilit nedeni eklenmez', () => {
      expect(dene('VACUUM t;\nCREATE INDEX CONCURRENTLY i ON t (a)', 'salt-okunur')).toEqual([
        { satir: 1, mesaj: DENEME_NON_TRANSACTIONAL_MESSAGE },
        { satir: 2, mesaj: DENEME_NON_TRANSACTIONAL_MESSAGE },
      ]);
    });

    it('Karışık script’te Karışık nedeninin ardından transaction dışı ifadeler gelir', () => {
      expect(dene('INSERT INTO t VALUES (1);\nVACUUM t')).toEqual([
        { satir: null, mesaj: expect.stringContaining('Karışık script') },
        { satir: 2, mesaj: DENEME_NON_TRANSACTIONAL_MESSAGE },
      ]);
    });

    it('Transaction script’i salt okunur prod’da da denenebilir', () => {
      expect(dene('UPDATE t SET a = 1', 'salt-okunur')).toEqual([]);
    });
  });

  it('analiz engelleri kilitten bağımsız ve önce gelir', () => {
    expect(reasons('BEGIN;\nSELECT 1', 'yazma-acik')).toEqual([{ satir: 1, mesaj: expect.stringContaining("Transaction'ı Tezgah yönetir") }]);
    expect(reasons('INSERT INTO t VALUES (1);\nVACUUM t', 'salt-okunur')).toEqual([
      { satir: null, mesaj: expect.stringContaining('Karışık script') },
    ]);
  });
});
