import { describe, expect, it } from 'vitest';
import { analyzeScript, blockReasons, forceTransaction, isNonTransactional, rejectionOf } from './calistirma-modu';
import { splitStatements } from './ifade-bolme';

const only = (sql: string) => {
  const statements = splitStatements(sql);
  expect(statements).toHaveLength(1);
  return statements[0]!;
};

describe('transaction dışı komut deseni', () => {
  it.each([
    'VACUUM',
    'vacuum full t',
    'VACUUM (ANALYZE) t',
    'VACUUM ANALYZE t',
    'CREATE DATABASE yeni',
    'DROP DATABASE IF EXISTS eski',
    "CREATE TABLESPACE ts LOCATION '/x'",
    'DROP TABLESPACE ts',
    "ALTER SYSTEM SET work_mem = '64MB'",
    'ALTER SYSTEM RESET ALL',
    'CREATE INDEX CONCURRENTLY ix ON t (a)',
    'CREATE UNIQUE INDEX CONCURRENTLY ix ON t (a)',
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS ix ON t (a)',
    'DROP INDEX CONCURRENTLY ix',
    'DROP INDEX CONCURRENTLY IF EXISTS ix',
    'REINDEX INDEX CONCURRENTLY ix',
    'REINDEX TABLE CONCURRENTLY public.t',
    'REINDEX (VERBOSE) TABLE CONCURRENTLY t',
    // Seçenekli REINDEX'te sonrası görülmeden temkinli taraf.
    'REINDEX (VERBOSE) TABLE t',
    'REINDEX SCHEMA public',
    'REINDEX DATABASE app',
    'REINDEX SYSTEM',
    'REINDEX SYSTEM app',
    'CLUSTER',
    'CLUSTER VERBOSE',
    'CLUSTER (VERBOSE)',
    'ALTER TABLE t DETACH PARTITION p CONCURRENTLY',
    'ALTER TABLE IF EXISTS ONLY "s".t DETACH PARTITION s.p CONCURRENTLY',
    "COMMIT PREPARED 'tx1'",
    "ROLLBACK PREPARED 'tx1'",
    "CREATE SUBSCRIPTION abone CONNECTION 'host=x' PUBLICATION yayin",
    // Seçeneğe bağlı (`create_slot = false`) olsa da temkinli taraf.
    "CREATE SUBSCRIPTION abone CONNECTION 'host=x' PUBLICATION yayin WITH (create_slot = false)",
    'DROP SUBSCRIPTION abone',
    'DROP SUBSCRIPTION IF EXISTS abone',
    'ALTER DATABASE app SET TABLESPACE hizli',
    'ALTER DATABASE "App" SET TABLESPACE hizli',
  ])('%s', (sql) => {
    expect(isNonTransactional(only(sql))).toBe(true);
  });
});

describe('transaction içinde çalışabilen komutlar', () => {
  it.each([
    'ANALYZE',
    'ANALYZE t',
    'ANALYZE VERBOSE t',
    'SELECT 1',
    "SELECT 'VACUUM'",
    'CREATE INDEX ix ON t (a)',
    'CREATE UNIQUE INDEX ix ON t (a)',
    // `concurrently` adlı bir index.
    'CREATE INDEX concurrently_ix ON t (a)',
    'DROP INDEX ix',
    'REINDEX INDEX ix',
    'REINDEX TABLE t',
    'CLUSTER t',
    'CLUSTER VERBOSE t',
    'CLUSTER public.t USING ix',
    'ALTER TABLE t DETACH PARTITION p',
    'ALTER TABLE t DETACH PARTITION p FINALIZE',
    'ALTER TABLE t ADD COLUMN concurrently int',
    'CREATE TABLE database (id int)',
    'ALTER DATABASE app SET work_mem = 1',
    'ALTER DATABASE app RENAME TO yeni',
    'ALTER SUBSCRIPTION abone DISABLE',
    'PREPARE p AS SELECT 1',
    'DO $$ BEGIN VACUUM; END $$',
  ])('%s', (sql) => {
    expect(isNonTransactional(only(sql))).toBe(false);
  });
});

describe('reddedilen ifadeler', () => {
  it.each([
    ['BEGIN', 'transaction'],
    ['begin transaction isolation level serializable', 'transaction'],
    ['BEGIN WORK', 'transaction'],
    ['START TRANSACTION READ WRITE', 'transaction'],
    ['COMMIT', 'transaction'],
    ['COMMIT AND CHAIN', 'transaction'],
    ['END', 'transaction'],
    ['ROLLBACK', 'transaction'],
    ['ROLLBACK WORK', 'transaction'],
    ['ABORT', 'transaction'],
    ["PREPARE TRANSACTION 'tx1'", 'transaction'],
    ['SET default_transaction_read_only = off', 'saltOkunur'],
    ['SET SESSION default_transaction_read_only TO off', 'saltOkunur'],
    ['set local default_transaction_read_only = on', 'saltOkunur'],
    ['RESET default_transaction_read_only', 'saltOkunur'],
    ['SET SESSION CHARACTERISTICS AS TRANSACTION READ WRITE', 'saltOkunur'],
    ['\\set x 1', 'meta'],
    ['\\c baska', 'meta'],
  ])('%s', (sql, neden) => {
    expect(rejectionOf(only(sql))).toBe(neden);
  });

  it.each([
    'ROLLBACK TO SAVEPOINT a',
    'ROLLBACK TO a',
    "COMMIT PREPARED 'tx1'",
    "ROLLBACK PREPARED 'tx1'",
    'SAVEPOINT a',
    'RELEASE SAVEPOINT a',
    'SET search_path = app',
    'SET TRANSACTION ISOLATION LEVEL SERIALIZABLE',
    "SELECT 'BEGIN'",
    'SHOW default_transaction_read_only',
    'ALTER ROLE r SET default_transaction_read_only = on',
  ])('kabul: %s', (sql) => {
    expect(rejectionOf(only(sql))).toBeNull();
  });
});

describe('analyzeScript: Çalıştırma modu', () => {
  const analyze = (sql: string) => analyzeScript(splitStatements(sql));

  it.each([
    // Boş script Okuma değildir.
    ['boş script', '', 'transaction'],
    ['yalnızca transaction içi ifadeler', 'INSERT INTO t VALUES (1); SELECT 1', 'transaction'],
    ['tek başına ANALYZE', 'ANALYZE t', 'transaction'],
    ['yalnızca transaction dışı ifadeler', 'VACUUM t; CREATE INDEX CONCURRENTLY ix ON t (a)', 'autocommit'],
    ['karışık', 'INSERT INTO t VALUES (1); VACUUM t', 'karisik'],
    // Reddedilen ifade modu belirlemez; script yine de çalıştırılamaz.
    ['reddedilenler mod sayılmaz', 'BEGIN; VACUUM t; COMMIT', 'autocommit'],
  ])('%s', (_, sql, mod) => {
    expect(analyze(sql).mod).toBe(mod);
  });

  it('transaction dışı ve reddedilen ifadelerin indekslerini döndürür', () => {
    expect(analyze('BEGIN;\nINSERT INTO t VALUES (1);\nVACUUM t;\n\\echo x\nREINDEX DATABASE app')).toEqual({
      mod: 'karisik',
      transactionDisi: [2, 4],
      reddedilenler: [
        { i: 0, neden: 'transaction' },
        { i: 3, neden: 'meta' },
      ],
    });
  });
});

describe('analyzeScript: Okuma modu', () => {
  const mod = (sql: string) => analyzeScript(splitStatements(sql)).mod;

  it.each([
    'SELECT 1',
    'select * from t where a = 1',
    'TABLE t',
    'VALUES (1), (2)',
    'SHOW search_path',
    'EXPLAIN SELECT * FROM t',
    'EXPLAIN (VERBOSE, COSTS OFF) SELECT 1',
    // ANALYZE'sız EXPLAIN DML'i çalıştırmaz.
    'EXPLAIN DELETE FROM t',
    'WITH x AS (SELECT 1) SELECT * FROM x',
    "SELECT 'INSERT INTO t'",
    'SELECT substring(a FROM 1 FOR 2) FROM t',
    'SELECT 1; TABLE t; SHOW work_mem',
  ])('Okuma: %s', (sql) => {
    expect(mod(sql)).toBe('okuma');
  });

  it.each([
    ["ANALYZE'lı EXPLAIN", 'EXPLAIN ANALYZE DELETE FROM t'],
    ['ANALYSE yazımı', 'EXPLAIN ANALYSE SELECT 1'],
    ['seçenekli ANALYZE', 'EXPLAIN (ANALYZE, BUFFERS) SELECT 1'],
    ["DML'li WITH", 'WITH x AS (DELETE FROM t RETURNING *) SELECT * FROM x'],
    ['WITH içinde INSERT', 'WITH x AS (INSERT INTO t VALUES (1) RETURNING *) SELECT 1'],
    ['WITH içinde UPDATE', 'WITH x AS (SELECT 1) UPDATE t SET a = 1'],
    ['WITH içinde MERGE', 'WITH s AS (SELECT 1 AS a) MERGE INTO t USING s ON true WHEN MATCHED THEN DELETE'],
    ['SELECT … INTO', 'SELECT * INTO yeni FROM t'],
    ['FOR UPDATE', 'SELECT * FROM t FOR UPDATE'],
    ['FOR SHARE', 'SELECT * FROM t FOR SHARE'],
    ['FOR NO KEY UPDATE', 'SELECT * FROM t FOR NO KEY UPDATE'],
    ['FOR KEY SHARE', 'SELECT * FROM t FOR KEY SHARE'],
    ['WITH … FOR UPDATE', 'WITH x AS (SELECT 1) SELECT * FROM t FOR UPDATE'],
    ['okuma + yazma', 'SELECT 1; INSERT INTO t VALUES (1)'],
    ['okuma + SET', 'SET search_path = app; SELECT 1'],
    ['okuma + reddedilen', 'SELECT 1; BEGIN'],
  ])('Okuma değil: %s', (_, sql) => {
    expect(mod(sql)).toBe('transaction');
  });

  it('zorlaTransaction yalnızca Okuma’yı Transaction’a çevirir', () => {
    const analyze = (sql: string) => analyzeScript(splitStatements(sql));
    expect(forceTransaction(analyze('SELECT 1'), true).mod).toBe('transaction');
    expect(forceTransaction(analyze('SELECT 1'), false).mod).toBe('okuma');
    expect(forceTransaction(analyze('VACUUM t'), true).mod).toBe('autocommit');
  });

  it('okuma + transaction dışı Karışık’tır', () => {
    expect(mod('SELECT 1; VACUUM t')).toBe('karisik');
  });
});

describe('blockReasons: script neden çalıştırılamaz', () => {
  const reasons = (sql: string) => blockReasons(sql, splitStatements(sql));

  it('Transaction ve Autocommit script’i engellenmez', () => {
    expect(reasons('INSERT INTO t VALUES (1)')).toEqual([]);
    expect(reasons('VACUUM t')).toEqual([]);
  });

  it('reddedilen her ifade satırıyla, Karışık script tek mesajla', () => {
    expect(reasons('SELECT 1;\nBEGIN;\nVACUUM t;\n\\echo x')).toEqual([
      { satir: 2, mesaj: "Transaction'ı Tezgah yönetir; BEGIN, COMMIT ve ROLLBACK script'te kullanılamaz." },
      { satir: 4, mesaj: 'psql meta komutları desteklenmez.' },
      { satir: null, mesaj: 'Karışık script: ⚠ ile işaretli transaction dışı ifadeler transaction içinde çalışamaz; onları ayrı çalıştırın.' },
    ]);
  });
});
