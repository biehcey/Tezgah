import { describe, expect, it } from 'vitest';
import { defaultConfigDir } from './ayar-deposu';

describe('defaultConfigDir', () => {
  it('Windows\'ta %APPDATA%\\Tezgah', () => {
    expect(
      defaultConfigDir({ platform: 'win32', env: { APPDATA: 'C:\\Users\\a\\AppData\\Roaming' }, home: 'C:\\Users\\a' }),
    ).toBe('C:\\Users\\a\\AppData\\Roaming\\Tezgah');
  });

  it('Windows\'ta APPDATA yoksa profildeki Roaming dizini', () => {
    expect(defaultConfigDir({ platform: 'win32', env: {}, home: 'C:\\Users\\a' })).toBe(
      'C:\\Users\\a\\AppData\\Roaming\\Tezgah',
    );
  });

  it('macOS\'ta ~/Library/Application Support/Tezgah', () => {
    expect(defaultConfigDir({ platform: 'darwin', env: {}, home: '/Users/a' })).toBe(
      '/Users/a/Library/Application Support/Tezgah',
    );
  });
});
