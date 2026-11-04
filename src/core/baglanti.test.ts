import { describe, expect, it } from 'vitest';
import { copyConnection, copyName, newConnection, parseConnectionInput, passwordAction, type ConnectionInput } from './baglanti';

const minimal = { name: 'Yerel', host: 'localhost', user: 'postgres' };

describe('parseConnectionInput', () => {
  it('eksik alanları varsayılanlarla doldurur', () => {
    expect(parseConnectionInput(minimal)).toEqual({
      ok: true,
      value: {
        name: 'Yerel',
        folderId: null,
        host: 'localhost',
        port: 5432,
        user: 'postgres',
        database: 'postgres',
        envTag: null,
        color: null,
        savePassword: true,
        password: undefined,
      },
    });
  });

  it('ortam etiketi verilip renk verilmezse etiketin varsayılan rengini kullanır', () => {
    const result = parseConnectionInput({ ...minimal, envTag: 'prod' });
    expect(result.ok && result.value.color).toBe('#dc2626');
  });

  it('verilen rengi korur ve boşlukları kırpar', () => {
    const result = parseConnectionInput({ ...minimal, name: '  Yerel  ', envTag: 'dev', color: '#123ABC' });
    expect(result.ok && result.value).toMatchObject({ name: 'Yerel', color: '#123abc' });
  });

  it.each([
    [{ ...minimal, name: ' ' }, 'name'],
    [{ ...minimal, host: '' }, 'host'],
    [{ ...minimal, user: '' }, 'user'],
    [{ ...minimal, port: 0 }, 'port'],
    [{ ...minimal, port: 70000 }, 'port'],
    [{ ...minimal, port: 54.5 }, 'port'],
    [{ ...minimal, envTag: 'uretim' }, 'envTag'],
    [{ ...minimal, color: 'red' }, 'color'],
    [{ ...minimal, savePassword: 'evet' }, 'savePassword'],
    [{ ...minimal, password: 42 }, 'password'],
    [{ ...minimal, password: 'x'.repeat(1025) }, 'password'],
    [{ ...minimal, database: '' }, 'database'],
  ])('geçersiz alanı adıyla bildirir (%#)', (input, field) => {
    const result = parseConnectionInput(input);
    expect(result.ok).toBe(false);
    expect(!result.ok && Object.keys(result.errors)).toEqual([field]);
  });

  it('nesne olmayan girdiyi reddeder', () => {
    expect(parseConnectionInput(null).ok).toBe(false);
    expect(parseConnectionInput([]).ok).toBe(false);
  });
});

describe('passwordAction', () => {
  it.each([
    [{ savePassword: true, password: 'p' }, false, 'yaz'],
    [{ savePassword: true, password: 'p' }, true, 'yaz'],
    [{ savePassword: true, password: undefined }, false, 'dokunma'],
    [{ savePassword: true, password: '' }, false, 'sil'],
    [{ savePassword: true, password: '' }, true, 'dokunma'],
    [{ savePassword: false, password: 'p' }, false, 'sil'],
    [{ savePassword: false, password: 'p' }, true, 'dokunma'],
  ] as const)('%o, yeni=%s → %s', (input, isNew, expected) => {
    expect(passwordAction(input, { isNew })).toBe(expected);
  });
});

describe('newConnection', () => {
  it('yeni bağlantıda yalnızca başlangıç veritabanı görünür, şemalar varsayılan', () => {
    const parsed = parseConnectionInput({ name: 'A', host: 'h', user: 'u', database: 'app', password: 'gizli' });
    if (!parsed.ok) throw new Error('girdi geçersiz');
    const connection = newConnection('id-1', parsed.value);
    expect(connection.databaseSelection).toEqual([{ database: 'app', schemas: null }]);
    expect(connection).not.toHaveProperty('password');
    expect(connection.id).toBe('id-1');
  });
});

describe('copyName', () => {
  it.each([
    ['ilk kopya', 'Yerel', ['Yerel'], 'Yerel (kopya)'],
    ['kopya adı alınmışsa numaralanır', 'Yerel', ['Yerel', 'Yerel (kopya)'], 'Yerel (kopya 2)'],
    ['boşluk atlanmaz, ilk boş numara', 'Yerel', ['Yerel (kopya)', 'Yerel (kopya 2)', 'Yerel (kopya 4)'], 'Yerel (kopya 3)'],
    ['kopyanın kopyası', 'Yerel (kopya)', ['Yerel', 'Yerel (kopya)'], 'Yerel (kopya) (kopya)'],
  ])('%s', (_, name, taken, expected) => {
    expect(copyName(name, taken)).toBe(expected);
  });
});

describe('copyConnection', () => {
  it('alanları ve Veritabanı seçimini kopyalar; kimlik ve ad yenidir, seçim kaynakla paylaşılmaz', () => {
    const source = newConnection('a', { ...(parseConnectionInput(minimal) as { value: ConnectionInput }).value, folderId: 'k1' });
    source.databaseSelection = [{ database: 'postgres', schemas: ['public'] }];
    const copy = copyConnection(source, 'b', ['Yerel']);
    expect(copy).toEqual({ ...source, id: 'b', name: 'Yerel (kopya)' });
    copy.databaseSelection[0]!.schemas!.push('x');
    expect(source.databaseSelection[0]!.schemas).toEqual(['public']);
  });
});
