import { describe, expect, it } from 'vitest';
import { HIDDEN, formatWait, parseBlockedSessions, sameSessions, orHidden, type BlockedSession } from './bekletme';

describe('parseBlockedSessions', () => {
  it.each([
    ['boş', [], []],
    [
      'tam satır (gerçek Postgres sayıları sayı olarak verir)',
      [{ pid: 4242, usename: 'ali', application_name: 'psql', wait_event_type: 'Lock', sorgu: 'UPDATE t SET a = 2', sure_sn: 12 }],
      [{ pid: 4242, kullanici: 'ali', uygulama: 'psql', beklemeTuru: 'Lock', sorgu: 'UPDATE t SET a = 2', sureSn: 12 }],
    ],
    [
      'metin sayılar (ham tipler)',
      [{ pid: '7', usename: 'veli', application_name: '', wait_event_type: 'Lock', sorgu: 'SELECT 1', sure_sn: '3' }],
      [{ pid: 7, kullanici: 'veli', uygulama: '', beklemeTuru: 'Lock', sorgu: 'SELECT 1', sureSn: 3 }],
    ],
    [
      'yetkisiz: NULL alanlar ve Postgres’in gizlediği sorgu',
      [{ pid: 9, usename: null, application_name: null, wait_event_type: null, sorgu: '<insufficient privilege>', sure_sn: null }],
      [{ pid: 9, kullanici: null, uygulama: null, beklemeTuru: null, sorgu: null, sureSn: null }],
    ],
  ])('%s', (_, rows, expected) => {
    expect(parseBlockedSessions(rows)).toEqual(expected);
  });
});

const session = (pid: number, sureSn: number | null = 1): BlockedSession => ({
  pid,
  kullanici: 'ali',
  uygulama: 'psql',
  beklemeTuru: 'Lock',
  sorgu: 'UPDATE t',
  sureSn,
});

describe('sameSessions', () => {
  it.each([
    ['ikisi de boş', [], [], true],
    ['aynı', [session(1)], [session(1)], true],
    ['süre değişti', [session(1, 1)], [session(1, 6)], false],
    ['oturum eklendi', [session(1)], [session(1), session(2)], false],
    ['başka oturum', [session(1)], [session(2)], false],
  ])('%s', (_, a, b, expected) => {
    expect(sameSessions(a, b)).toBe(expected);
  });
});

describe('gösterim', () => {
  it.each([
    [null, HIDDEN],
    ['', ''],
    ['psql', 'psql'],
  ])('orHidden(%j) → %j', (value, expected) => {
    expect(orHidden(value)).toBe(expected);
  });

  it.each([
    [null, HIDDEN],
    [0, '0 sn'],
    [59, '59 sn'],
    [60, '1 dk'],
    [125, '2 dk 5 sn'],
    [3600, '1 sa'],
    [3725, '1 sa 2 dk'],
  ])('formatWait(%j) → %j', (sn, expected) => {
    expect(formatWait(sn)).toBe(expected);
  });
});
