import { describe, expect, it } from 'vitest';
import { splitStatements } from './ifade-bolme';
import {
  DENEME_NON_TRANSACTIONAL_MESSAGE,
  DENEME_READ_MESSAGE,
  READ_ONLY_AUTOCOMMIT_MESSAGE,
  beginStatement,
  runBlockReasons,
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

  it.each(['salt-okunur', 'yazma-acik', null] as const)('denemede %s kilidinden bağımsız BEGIN READ WRITE', (lock) => {
    expect(beginStatement(lock, { deneme: true })).toBe('BEGIN READ WRITE');
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

    it('Okuma script’i denenmez: bir şey değiştirmez', () => {
      expect(dene('SELECT 1')).toEqual([{ satir: null, mesaj: DENEME_READ_MESSAGE }]);
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
