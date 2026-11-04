import { describe, expect, it } from 'vitest';
import { DEFAULT_SSL, type Connection } from './baglanti';
import {
  changesServerSession,
  databasePanel,
  defaultTargetDatabase,
  parseDatabaseSelection,
  setDatabaseVisible,
  setSchemaVisible,
  visibleSchemas,
} from './veritabani-secimi';

function connection(): Connection {
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
    databaseSelection: [{ database: 'postgres', schemas: null }],
  };
}

const ALL = ['information_schema', 'pg_catalog', 'pg_toast', 'public', 'raporlar'];

describe('visibleSchemas', () => {
  it('varsayılanda pg_catalog, information_schema ve pg_toast gizli, diğerleri görünür', () => {
    expect(visibleSchemas({ database: 'app', schemas: null }, ALL)).toEqual(['public', 'raporlar']);
  });

  it('açık listede yalnızca listedekiler görünür, sunucudaki sırayla', () => {
    expect(visibleSchemas({ database: 'app', schemas: ['raporlar', 'pg_catalog'] }, ALL)).toEqual([
      'pg_catalog',
      'raporlar',
    ]);
  });
});

describe('setDatabaseVisible', () => {
  it('⭐ ile görünür yapılan veritabanı varsayılan şema görünürlüğüyle sona eklenir', () => {
    expect(setDatabaseVisible([{ database: 'postgres', schemas: null }], 'app', true)).toEqual([
      { database: 'postgres', schemas: null },
      { database: 'app', schemas: null },
    ]);
  });

  it('gizlenen veritabanı seçimden çıkar; zaten görünürse değişmez', () => {
    const sel = [
      { database: 'postgres', schemas: null },
      { database: 'app', schemas: ['public'] },
    ];
    expect(setDatabaseVisible(sel, 'postgres', false)).toEqual([{ database: 'app', schemas: ['public'] }]);
    expect(setDatabaseVisible(sel, 'app', true)).toEqual(sel);
  });
});

describe('setSchemaVisible', () => {
  it('varsayılandan bir şema gizlenince açık listeye geçer', () => {
    expect(setSchemaVisible([{ database: 'app', schemas: null }], 'app', 'raporlar', false, ALL)).toEqual([
      { database: 'app', schemas: ['public'] },
    ]);
  });

  it('gizli bir sistem şeması görünür yapılabilir', () => {
    expect(setSchemaVisible([{ database: 'app', schemas: null }], 'app', 'pg_catalog', true, ALL)).toEqual([
      { database: 'app', schemas: ['pg_catalog', 'public', 'raporlar'] },
    ]);
  });

  it('liste varsayılan görünürlüğe dönünce yeniden varsayılan olur (sonradan eklenen şemalar görünür kalsın)', () => {
    expect(setSchemaVisible([{ database: 'app', schemas: ['public'] }], 'app', 'raporlar', true, ALL)).toEqual([
      { database: 'app', schemas: null },
    ]);
  });

  it('seçimde olmayan veritabanına dokunmaz', () => {
    const sel = [{ database: 'app', schemas: null }];
    expect(setSchemaVisible(sel, 'baska', 'public', false, ALL)).toEqual(sel);
  });
});

describe('databasePanel', () => {
  it('bağlanmamışken yalnızca kayıtlı seçim görünür, gizli liste bilinmez', () => {
    expect(databasePanel([{ database: 'postgres', schemas: null }], null)).toEqual({
      visible: ['postgres'],
      hidden: null,
    });
  });

  it('bağlıyken seçimde olmayan sunucu veritabanları gizlidir', () => {
    const sel = [
      { database: 'app', schemas: null },
      { database: 'postgres', schemas: null },
    ];
    expect(databasePanel(sel, ['analitik', 'app', 'postgres'])).toEqual({
      visible: ['app', 'postgres'],
      hidden: ['analitik'],
    });
  });
});

describe('parseDatabaseSelection', () => {
  it('geçerli seçimi kabul eder', () => {
    const value = [
      { database: 'app', schemas: null },
      { database: 'postgres', schemas: ['public'] },
    ];
    expect(parseDatabaseSelection(value)).toEqual({ ok: true, value });
  });

  it.each([
    ['dizi değil', { database: 'app' }],
    ['boş ad', [{ database: '', schemas: null }]],
    ['şema dizisi değil', [{ database: 'app', schemas: 'public' }]],
    ['şema adı metin değil', [{ database: 'app', schemas: [1] }]],
    ['aynı veritabanı iki kez', [{ database: 'app', schemas: null }, { database: 'app', schemas: null }]],
  ])('%s: reddeder', (_, raw) => {
    expect(parseDatabaseSelection(raw).ok).toBe(false);
  });
});

describe('defaultTargetDatabase', () => {
  const base = { database: 'postgres' };
  it('"Hedef yap": başlangıç veritabanı görünürse onu seçer', () => {
    const selection = [
      { database: 'app', schemas: null },
      { database: 'postgres', schemas: null },
    ];
    expect(defaultTargetDatabase({ ...base, databaseSelection: selection })).toBe('postgres');
  });

  it('başlangıç veritabanı gizliyse ilk görünürü, hiç görünür yoksa null döner', () => {
    expect(defaultTargetDatabase({ ...base, databaseSelection: [{ database: 'app', schemas: null }] })).toBe('app');
    expect(defaultTargetDatabase({ ...base, databaseSelection: [] })).toBeNull();
  });
});

describe('changesServerSession', () => {
  const before = connection();
  it.each([
    ['ad', { name: 'Yeni ad' }, false],
    ['klasör', { folderId: 'k1' }, false],
    ['renk', { color: '#000000' }, false],
    ['host', { host: 'baska' }, true],
    ['port', { port: 6432 }, true],
    ['kullanıcı', { user: 'app' }, true],
    ['başlangıç veritabanı', { database: 'app' }, true],
    ['sslmode', { sslmode: 'require' as const }, true],
    ['CA yolu', { sslrootcert: '/ca.pem' }, true],
    ['keychain seçeneği', { savePassword: false }, true],
    ['ortam etiketi (prod salt okunur pool)', { envTag: 'prod' as const }, true],
  ])('%s değişince: %s', (_, change, expected) => {
    expect(changesServerSession(before, { ...before, ...change })).toBe(expected);
  });
});
