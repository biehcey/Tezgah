import { describe, expect, it } from 'vitest';
import { buildConnectionUrl, parseConnectionUrl } from './baglanti-url';

describe('parseConnectionUrl: alanlar', () => {
  it.each([
    [
      'tüm temel alanlar',
      'postgres://app:s3cret@db.example:6432/uygulama',
      { host: 'db.example', port: 6432, user: 'app', password: 's3cret', database: 'uygulama' },
    ],
    ['postgresql şeması', 'postgresql://app@db.example/uygulama', { host: 'db.example', user: 'app', database: 'uygulama' }],
    ['şema büyük harf', 'POSTGRES://db.example', { host: 'db.example' }],
    ['yalnızca host', 'postgres://db.example', { host: 'db.example' }],
    ['sondaki eğik çizgi veritabanı vermez', 'postgres://db.example/', { host: 'db.example' }],
    ['şifresiz kullanıcı', 'postgres://app@db.example', { host: 'db.example', user: 'app' }],
    ['boş şifre', 'postgres://app:@db.example', { host: 'db.example', user: 'app', password: '' }],
    [
      'yüzde kodlu kullanıcı, şifre ve veritabanı',
      'postgres://us%40er:p%3Ass%2Fw%40rd%23@db.example/a%20b',
      { host: 'db.example', user: 'us@er', password: 'p:ss/w@rd#', database: 'a b' },
    ],
    ['şifrede kodlanmamış @', 'postgres://app:p@ss@db.example', { host: 'db.example', user: 'app', password: 'p@ss' }],
    ['IPv6 host', 'postgres://[::1]:6432/db', { host: '::1', port: 6432, database: 'db' }],
    ['IPv6 host portsuz', 'postgres://app@[2001:db8::1]', { host: '2001:db8::1', user: 'app' }],
    ['host yok (yerel soket)', 'postgres:///uygulama', { database: 'uygulama' }],
    ['baştaki ve sondaki boşluk kırpılır', '  postgres://db.example/x \n', { host: 'db.example', database: 'x' }],
    ['query parametreleri yolu kesmez', 'postgres://db.example/uygulama?sslmode=require', { host: 'db.example', database: 'uygulama', sslmode: 'require' }],
    [
      'SSL parametreleri',
      'postgres://db.example/x?sslmode=verify-full&sslrootcert=%2Fetc%2Fca.pem&sslcert=/c.crt&sslkey=/c.key',
      { host: 'db.example', database: 'x', sslmode: 'verify-full', sslrootcert: '/etc/ca.pem', sslcert: '/c.crt', sslkey: '/c.key' },
    ],
    [
      'query’deki libpq alanları yolu ezer',
      'postgres://a@h1:1/d1?host=h2&port=2&user=b&password=p&dbname=d2',
      { host: 'h2', port: 2, user: 'b', password: 'p', database: 'd2' },
    ],
  ])('%s', (_, url, fields) => {
    expect(parseConnectionUrl(url)).toEqual({ ok: true, fields, ignored: [] });
  });

  it.each(['disable', 'prefer', 'require', 'verify-ca', 'verify-full'])('sslmode=%s kabul edilir', (mode) => {
    expect(parseConnectionUrl(`postgres://h?sslmode=${mode}`)).toEqual({
      ok: true,
      fields: { host: 'h', sslmode: mode },
      ignored: [],
    });
  });
});

describe('parseConnectionUrl: yok sayılan parametreler', () => {
  it('tanınmayan parametreler adlarıyla, sırasıyla listelenir; alanlar yine dolar', () => {
    expect(parseConnectionUrl('postgres://h/db?application_name=x&sslmode=require&connect_timeout=5&target_session_attrs=any')).toEqual({
      ok: true,
      fields: { host: 'h', database: 'db', sslmode: 'require' },
      ignored: ['application_name', 'connect_timeout', 'target_session_attrs'],
    });
  });

  it('aynı parametre iki kez yazılsa da bir kez listelenir', () => {
    const result = parseConnectionUrl('postgres://h?options=a&options=b');
    expect(result).toEqual({ ok: true, fields: { host: 'h' }, ignored: ['options'] });
  });
});

describe('parseConnectionUrl: ret', () => {
  it.each([
    ['başka şema', 'mysql://root@localhost/db', /postgres:\/\//],
    ['JDBC URL', 'jdbc:postgresql://localhost/db', /postgres:\/\//],
    ['şemasız metin', 'localhost:5432', /postgres:\/\//],
    ['çok host', 'postgres://h1,h2/db', /birden çok host/i],
    ['çok host portlu', 'postgres://h1:5432,h2:5433/db', /birden çok host/i],
    ['query’de çok host', 'postgres://h/db?host=h1,h2', /birden çok host/i],
    ['geçersiz sslmode', 'postgres://h/db?sslmode=sometimes', /sslmode/],
    ['libpq allow modu desteklenmez', 'postgres://h/db?sslmode=allow', /sslmode/],
    ['sayı olmayan port', 'postgres://h:abc/db', /port/i],
    ['aralık dışı port', 'postgres://h:70000/db', /port/i],
    ['query’de geçersiz port', 'postgres://h/db?port=0', /port/i],
    ['kapanmayan IPv6 parantezi', 'postgres://[::1/db', /host/i],
    ['bozuk yüzde kodlama', 'postgres://a%zz@h/db', /kodlama/i],
  ])('%s', (_, url, reason) => {
    const result = parseConnectionUrl(url);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toMatch(reason);
  });
});

describe('buildConnectionUrl (şifresiz)', () => {
  const base = { host: 'db.example', port: 5432, user: 'app', database: 'uygulama' };
  it.each([
    ['temel', base, 'postgres://app@db.example:5432/uygulama'],
    ['varsayılan dışı port', { ...base, port: 6432 }, 'postgres://app@db.example:6432/uygulama'],
    [
      'özel karakterler kodlanır',
      { ...base, user: 'us@er:x', database: 'a b/c?' },
      'postgres://us%40er%3Ax@db.example:5432/a%20b%2Fc%3F',
    ],
    ['IPv6 host parantezlenir', { ...base, host: '::1' }, 'postgres://app@[::1]:5432/uygulama'],
    ['sslmode verilirse eklenir', { ...base, sslmode: 'verify-full' as const }, 'postgres://app@db.example:5432/uygulama?sslmode=verify-full'],
    [
      'SSL dosya yolları kodlanır',
      { ...base, sslmode: 'verify-ca' as const, sslrootcert: '/etc/ssl/ca root.pem' },
      'postgres://app@db.example:5432/uygulama?sslmode=verify-ca&sslrootcert=%2Fetc%2Fssl%2Fca%20root.pem',
    ],
  ])('%s', (_, connection, url) => {
    expect(buildConnectionUrl(connection)).toBe(url);
  });

  it('üretilen URL ayrıştırılınca aynı alanlar geri gelir', () => {
    const connection = { host: '2001:db8::1', port: 6543, user: 'ö@z:', database: 'veri tabanı', sslmode: 'require' as const, sslkey: 'C:\\k.key' };
    expect(parseConnectionUrl(buildConnectionUrl(connection))).toEqual({ ok: true, fields: connection, ignored: [] });
  });

  it('nesnede şifre olsa da URL’e yazılmaz', () => {
    const withSecret = { ...base, password: 'gizli' } as typeof base;
    expect(buildConnectionUrl(withSecret)).not.toContain('gizli');
  });
});
