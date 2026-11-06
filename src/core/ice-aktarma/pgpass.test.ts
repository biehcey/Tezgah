import { describe, expect, it } from 'vitest';
import { findPassword, parsePgpass, pgpassCandidates } from './pgpass';

const FIXTURE = [
  '# yorum satırı',
  '*:*:*:postgres:joker-sifre',
  'prod-db.internal:5432:*:app:prod\\:gizli',
  '',
  '10.0.4.12:5432:warehouse:etl:etl-sifre',
  '10.0.4.12:5432:staging:etl:etl-sifre-2',
  'localhost:*:*:postgres:yerel',
  'eksik:5432:alan',
  'ters\\\\egik:5433:db:kullanici:a\\\\b',
].join('\n');

describe('pgpass ayrıştırma', () => {
  it('satırları satır numarasıyla okur; yorum, boş ve eksik alanlı satırlar atlanır', () => {
    const entries = parsePgpass(FIXTURE);
    expect(entries.map((e) => e.line)).toEqual([2, 3, 5, 6, 7, 9]);
    expect(entries[0]).toEqual({ line: 2, host: '*', port: '*', database: '*', user: 'postgres', password: 'joker-sifre' });
  });

  it('\\: ve \\\\ kaçışlarını çözer', () => {
    const entries = parsePgpass(FIXTURE);
    expect(entries[1]!.password).toBe('prod:gizli');
    expect(entries[5]).toMatchObject({ host: 'ters\\egik', password: 'a\\b' });
  });

  it('Windows satır sonlarını tanır', () => {
    expect(parsePgpass('h:1:d:u:p\r\nh2:2:d:u:q\r\n').map((e) => e.password)).toEqual(['p', 'q']);
  });
});

describe('libpq şifre eşlemesi', () => {
  const entries = parsePgpass(FIXTURE);

  it('ilk eşleşen satırın şifresini döndürür; * her değerle eşleşir', () => {
    expect(findPassword(entries, { host: 'prod-db.internal', port: 5432, database: 'billing', user: 'app' })).toMatchObject({
      line: 3,
      password: 'prod:gizli',
      wildcard: true,
    });
    // Joker satır daha önce geldiğinden localhost satırı hiç eşleşmez.
    expect(findPassword(entries, { host: 'localhost', port: 5432, database: 'postgres', user: 'postgres' })).toMatchObject({
      line: 2,
      password: 'joker-sifre',
    });
  });

  it('jokersiz tam eşleşme joker değildir; eşleşme yoksa null', () => {
    expect(findPassword(entries, { host: '10.0.4.12', port: 5432, database: 'warehouse', user: 'etl' })).toMatchObject({
      line: 5,
      wildcard: false,
    });
    expect(findPassword(entries, { host: '10.0.4.12', port: 5432, database: 'baska', user: 'etl' })).toBeNull();
  });
});

describe('pgpass adayları', () => {
  it('host, port ve kullanıcısı somut satırlar aday olur; db somutsa başlangıç veritabanı, değilse postgres', () => {
    const candidates = pgpassCandidates(parsePgpass(FIXTURE));
    expect(candidates.map((c) => [c.host, c.port, c.user, c.database, c.line])).toEqual([
      ['prod-db.internal', 5432, 'app', 'postgres', 3],
      ['10.0.4.12', 5432, 'etl', 'warehouse', 5],
      ['10.0.4.12', 5432, 'etl', 'staging', 6],
      ['ters\\egik', 5433, 'kullanici', 'db', 9],
    ]);
  });

  it('sayı olmayan port aday olmaz', () => {
    expect(pgpassCandidates(parsePgpass('h:abc:d:u:p\nh:0:d:u:p\nh:70000:d:u:p'))).toEqual([]);
  });
});
