import { describe, expect, it } from 'vitest';
import { qualifiedName, quoteIdent, sqlLiteral } from './sql';

describe('SQL literal üretici', () => {
  it('değer tip adıyla `…::tip` olur', () => {
    expect(sqlLiteral('42', 'integer')).toBe("'42'::integer");
  });

  it('tek tırnak ikilenir', () => {
    expect(sqlLiteral("O'Brien", 'text')).toBe("'O''Brien'::text");
  });

  it('NULL tipten bağımsız `NULL`', () => {
    expect(sqlLiteral(null, 'integer')).toBe('NULL');
    expect(sqlLiteral(null)).toBe('NULL');
  });

  it('tipsiz değer yalnızca tırnaklanır', () => {
    expect(sqlLiteral("it's")).toBe("'it''s'");
  });

  it('ters bölü ve satır sonu olduğu gibi kalır', () => {
    expect(sqlLiteral('a\\b\nc', 'text')).toBe("'a\\b\nc'::text");
  });
});

describe('tanımlayıcı tırnaklama', () => {
  it('her ad çift tırnağa alınır, içteki `"` ikilenir', () => {
    expect(quoteIdent('id')).toBe('"id"');
    expect(quoteIdent('Ad Soyad')).toBe('"Ad Soyad"');
    expect(quoteIdent('say "hi"')).toBe('"say ""hi"""');
  });
});

describe('nitelenmiş tablo adı', () => {
  it('her parçayı tırnaklar; to_regclass sözdizimi hatası vermez', () => {
    expect(qualifiedName({ ad: 'a"b' })).toBe('"a""b"');
    expect(qualifiedName({ sema: 's', ad: 't' })).toBe('"s"."t"');
  });
});
