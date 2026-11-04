import { describe, expect, it } from 'vitest';
import { SETTINGS_VERSION, emptySettings, migrateSettings } from './ayarlar';

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
