import { describe, expect, it } from 'vitest';
import { typeName } from './tipler';

describe('tip OID → ad', () => {
  it('yaygın yerleşik tipler sabit haritadan çözülür', () => {
    expect(typeName(23)).toBe('integer');
    expect(typeName(25)).toBe('text');
    expect(typeName(1184)).toBe('timestamp with time zone');
    expect(typeName(3802)).toBe('jsonb');
    expect(typeName(1007)).toBe('integer[]');
  });

  it('uzunluk ekiyle anlam değiştiren tipler eksiz adla yazılır: `::character` kırpar, `::bit` hata verir', () => {
    expect(typeName(1042)).toBe('bpchar');
    expect(typeName(1014)).toBe('bpchar[]');
    expect(typeName(1560)).toBe('varbit');
    expect(typeName(1561)).toBe('varbit[]');
  });

  it('bilinmeyen OID çözülmez', () => {
    expect(typeName(99999)).toBeNull();
  });

  it('eşleme parametresi kullanıcı tiplerini çözer; yerleşikler önce gelir ki format_type adı (`character`) kırpmasın', () => {
    const katalog = new Map([
      [99999, 'public.durum'],
      [1042, 'character'],
    ]);
    expect(typeName(99999, katalog)).toBe('public.durum');
    expect(typeName(1042, katalog)).toBe('bpchar');
  });
});
