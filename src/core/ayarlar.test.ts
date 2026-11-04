import { describe, expect, it } from 'vitest';
import { SETTINGS_VERSION, deleteFolder, emptySettings, migrateSettings, parseFolderName } from './ayarlar';
import type { Connection } from './baglanti';

describe('migrateSettings', () => {
  it('güncel sürümdeki ayarı olduğu gibi döndürür', () => {
    const settings = { version: SETTINGS_VERSION, folders: [], connections: [] };
    expect(migrateSettings(settings)).toEqual(settings);
  });

  it('eski sürümü sırayla migration adımlarından geçirir', () => {
    const migrations = {
      1: (s: Record<string, unknown>) => ({ ...s, version: 2, adim1: true }),
      2: (s: Record<string, unknown>) => ({ ...s, version: 3, adim2: true }),
    };
    expect(migrateSettings({ version: 1, folders: [], connections: [] }, { current: 3, migrations })).toEqual({
      version: 3,
      folders: [],
      connections: [],
      adim1: true,
      adim2: true,
    });
  });

  it('sürüm 1 bağlantılarına SSL varsayılanlarını (prefer, dosya yok) ekler', () => {
    const v1 = { id: 'b1', name: 'Yerel', host: 'localhost', port: 5432, user: 'postgres' };
    const settings = migrateSettings({ version: 1, folders: [], connections: [v1] });
    expect(settings.version).toBe(SETTINGS_VERSION);
    expect(settings.connections).toEqual([
      { ...v1, sslmode: 'prefer', sslrootcert: null, sslcert: null, sslkey: null },
    ]);
  });

  it('daha yeni bir Tezgah\'ın yazdığı ayarı reddeder', () => {
    expect(() => migrateSettings({ version: SETTINGS_VERSION + 1, folders: [], connections: [] })).toThrow(
      /daha yeni/,
    );
  });

  it.each([null, [], { folders: [], connections: [] }, { version: 1, folders: {}, connections: [] }])(
    'biçimi bozuk ayarı reddeder (%#)',
    (raw) => {
      expect(() => migrateSettings(raw)).toThrow();
    },
  );

  it('boş ayar güncel sürümdedir', () => {
    expect(emptySettings()).toEqual({ version: SETTINGS_VERSION, folders: [], connections: [] });
  });
});

describe('parseFolderName', () => {
  const folders = [
    { id: 'k1', name: 'Billing' },
    { id: 'k2', name: 'İzmir' },
  ];
  it.each([
    ['ad kırpılır', { name: '  Müşteri A ' }, undefined, { ok: true, name: 'Müşteri A' }],
    ['boş ad', { name: '   ' }, undefined, { ok: false, error: 'Klasör adı gerekli' }],
    ['ad yok', {}, undefined, { ok: false, error: 'Klasör adı gerekli' }],
    ['nesne değil', 'Billing', undefined, { ok: false, error: 'Klasör adı gerekli' }],
    ['büyük/küçük harf duyarsız çakışma', { name: 'BILLING' }, undefined, { ok: false, error: '“BILLING” adlı bir klasör zaten var' }],
    ['Türkçe harflerde çakışma', { name: 'izmir' }, undefined, { ok: false, error: '“izmir” adlı bir klasör zaten var' }],
    ['farklı harfler çakışmaz', { name: 'Özel' }, undefined, { ok: true, name: 'Özel' }],
    ['kendi adını almak serbest', { name: 'billing' }, 'k1', { ok: true, name: 'billing' }],
  ])('%s', (_, raw, selfId, expected) => {
    expect(parseFolderName(raw, folders, selfId)).toEqual(expected);
  });
});

describe('deleteFolder', () => {
  it('klasörü siler, içindeki bağlantıları Klasörsüz’e taşır, diğerlerine dokunmaz', () => {
    const conn = (id: string, folderId: string | null) => ({ id, folderId }) as Connection;
    const settings = {
      folders: [
        { id: 'k1', name: 'A' },
        { id: 'k2', name: 'B' },
      ],
      connections: [conn('a', 'k1'), conn('b', 'k2'), conn('c', 'k1'), conn('d', null)],
    };
    expect(deleteFolder(settings, 'k1')).toBe(2);
    expect(settings.folders).toEqual([{ id: 'k2', name: 'B' }]);
    expect(settings.connections.map((c) => c.folderId)).toEqual([null, 'k2', null, null]);
  });
});
