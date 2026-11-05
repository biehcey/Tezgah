import { describe, expect, it } from 'vitest';
import { READ_ONLY_AUTOCOMMIT_MESSAGE, beginStatement, writeLockBlock, writeLockState } from './yazma-kilidi';

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

  it('salt okunur prod’da Autocommit script’i engellenir', () => {
    expect(writeLockBlock('autocommit', 'salt-okunur')).toBe(READ_ONLY_AUTOCOMMIT_MESSAGE);
  });

  it.each([
    ['autocommit', 'yazma-acik'],
    ['autocommit', null],
    ['transaction', 'salt-okunur'],
    ['transaction', 'yazma-acik'],
  ] as const)('%s modu %s kilidinde engellenmez', (mode, lock) => {
    expect(writeLockBlock(mode, lock)).toBeNull();
  });
});
