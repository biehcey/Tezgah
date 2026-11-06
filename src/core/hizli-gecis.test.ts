import { describe, expect, it } from 'vitest';
import { DEFAULT_SSL, type Connection } from './baglanti';
import { fuzzyScore, matchUrl, searchHiddenDatabases, searchTargets } from './hizli-gecis';

function connection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: 'b1',
    name: 'Yerel',
    folderId: null,
    host: 'localhost',
    port: 5432,
    user: 'postgres',
    database: 'postgres',
    envTag: null,
    color: null,
    savePassword: true,
    ...DEFAULT_SSL,
    ssh: null,
    databaseSelection: [{ database: 'postgres', schemas: null }],
    ...overrides,
  };
}

describe('fuzzyScore', () => {
  it.each([
    ['ypg', 'Yerel / postgres'],
    ['YEREL', 'Yerel / postgres'],
    ['yerel postgres', 'Yerel / postgres'],
    ['istanbul', 'İstanbul / app'],
    ['sirket', 'Şirket / app'],
  ])('“%s”, “%s” ile eşleşir', (query, text) => {
    expect(fuzzyScore(query, text)).not.toBeNull();
  });

  it.each([
    ['gpy', 'Yerel / postgres'],
    ['yerelx', 'Yerel / postgres'],
  ])('“%s”, “%s” ile eşleşmez', (query, text) => {
    expect(fuzzyScore(query, text)).toBeNull();
  });

  it('boş sorgu her şeyle eşleşir', () => {
    expect(fuzzyScore('  ', 'Yerel / postgres')).not.toBeNull();
  });

  it('bitişik ve kelime başı eşleşme dağınık eşleşmeden yüksek puan alır', () => {
    const tight = fuzzyScore('app', 'Prod / app')!;
    const scattered = fuzzyScore('app', 'Analitik / pipeline_p')!;
    expect(tight).toBeGreaterThan(scattered);
    expect(fuzzyScore('pr', 'Prod / app')!).toBeGreaterThan(fuzzyScore('pr', 'Staging / reports_pr')!);
  });
});

const yerel = connection({
  databaseSelection: [
    { database: 'postgres', schemas: null },
    { database: 'app', schemas: ['public'] },
  ],
});
const prod = connection({
  id: 'b2',
  name: 'Prod',
  host: 'db.prod',
  envTag: 'prod',
  databaseSelection: [{ database: 'app', schemas: null }],
});

describe('searchTargets', () => {
  it('boş sorguda tüm bağlantıların görünür veritabanları, bağlantı ve seçim sırasıyla', () => {
    const items = searchTargets([yerel, prod], '', null);
    expect(items.map((i) => i.label)).toEqual(['Yerel / postgres', 'Yerel / app', 'Prod / app']);
    expect(items[2]).toEqual({ connectionId: 'b2', database: 'app', label: 'Prod / app', prod: true, current: false });
  });

  it('mevcut hedef işaretli', () => {
    const items = searchTargets([yerel, prod], '', { connectionId: 'b1', database: 'app' });
    expect(items.filter((i) => i.current).map((i) => i.label)).toEqual(['Yerel / app']);
  });

  it('sorguyla eşleşmeyenler düşer, kalanlar puana göre sıralanır', () => {
    expect(searchTargets([yerel, prod], 'app', null).map((i) => i.label)).toEqual(['Yerel / app', 'Prod / app']);
    expect(searchTargets([yerel, prod], 'prodapp', null).map((i) => i.label)).toEqual(['Prod / app']);
    const analitik = connection({ id: 'b3', name: 'Analitik', databaseSelection: [{ database: 'raporlama_p', schemas: null }] });
    expect(searchTargets([analitik, yerel, prod], 'app', null).map((i) => i.label)).toEqual([
      'Yerel / app',
      'Prod / app',
      'Analitik / raporlama_p',
    ]);
  });
});

describe('searchHiddenDatabases', () => {
  const servers = { b1: ['analitik', 'app', 'postgres'], b2: ['app', 'arsiv'] };

  it('yalnızca bağlı bağlantılarda, seçimde olmayan veritabanları sorguyla eşleşince', () => {
    expect(searchHiddenDatabases([yerel, prod], { b1: servers.b1 }, 'a').map((i) => i.label)).toEqual(['Yerel / analitik']);
    expect(searchHiddenDatabases([yerel, prod], servers, 'ar').map((i) => i.label)).toEqual(['Prod / arsiv']);
  });

  it('sorgu yokken boş', () => {
    expect(searchHiddenDatabases([yerel, prod], servers, ' ')).toEqual([]);
  });
});

describe('matchUrl', () => {
  const replica = connection({ id: 'b3', name: 'Prod okuma', host: 'db.prod', user: 'okuyucu', envTag: 'prod' });
  const all = [yerel, prod, replica];

  it('URL değilse null', () => {
    expect(matchUrl(all, 'yerel app', null)).toBeNull();
  });

  it('aynı host, port ve kullanıcıya giden bağlantılar; hedef URL’deki veritabanı', () => {
    const result = matchUrl(all, '  postgres://postgres:gizli@DB.prod:5432/faturalar?sslmode=require ', null);
    expect(result).toEqual({
      ok: true,
      fields: expect.objectContaining({ host: 'DB.prod', database: 'faturalar', password: 'gizli' }),
      matches: [
        { connectionId: 'b2', database: 'faturalar', label: 'Prod / faturalar', prod: true, current: false, missingOnServer: false },
      ],
    });
  });

  it('port yazılmadıysa 5432; farklı port eşleşmez', () => {
    expect(matchUrl(all, 'postgres://okuyucu@db.prod/app', null)).toMatchObject({ ok: true, matches: [{ connectionId: 'b3' }] });
    expect(matchUrl(all, 'postgres://okuyucu@db.prod:6432/app', null)).toMatchObject({ ok: true, matches: [] });
  });

  it('kullanıcı yazılmadıysa o sunucudaki tüm bağlantılar; veritabanı yazılmadıysa başlangıç veritabanı', () => {
    const result = matchUrl(all, 'postgresql://db.prod', { connectionId: 'b2', database: 'postgres' });
    expect(result).toMatchObject({
      ok: true,
      matches: [
        { connectionId: 'b2', database: 'postgres', current: true },
        { connectionId: 'b3', database: 'postgres', current: false },
      ],
    });
  });

  it('bağlı bağlantının sunucusunda olmayan veritabanı işaretlenir; bağlı değilse bilinmez', () => {
    const servers = { b2: ['app', 'faturalar'] };
    expect(matchUrl(all, 'postgres://postgres@db.prod/yok', null, servers)).toMatchObject({
      ok: true,
      matches: [{ connectionId: 'b2', missingOnServer: true }],
    });
    expect(matchUrl(all, 'postgres://postgres@db.prod/app', null, servers)).toMatchObject({
      matches: [{ missingOnServer: false }],
    });
    expect(matchUrl(all, 'postgres://okuyucu@db.prod/yok', null, servers)).toMatchObject({
      matches: [{ connectionId: 'b3', missingOnServer: false }],
    });
  });

  it('geçersiz URL için ayrıştırıcının nedeni', () => {
    expect(matchUrl(all, 'postgres://a@h:99999/db', null)).toEqual({ ok: false, reason: 'Geçersiz port “99999”; 1–65535 arasında olmalı' });
  });
});
