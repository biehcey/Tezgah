import { describe, expect, it } from 'vitest';
import { DEFAULT_SSL, type Connection, type SshSettings } from '../baglanti';
import { groupCandidates, uniqueName, type SourceCandidate } from './gruplama';

function source(overrides: Partial<SourceCandidate> = {}): SourceCandidate {
  return {
    source: { id: 'pgpass', label: '.pgpass satır 1' },
    name: 'db.internal',
    host: 'db.internal',
    port: 5432,
    user: 'app',
    database: 'postgres',
    databases: ['postgres'],
    ssh: null,
    ...DEFAULT_SSL,
    envTag: null,
    envReason: null,
    folder: null,
    warnings: [],
    tunnelUnmapped: false,
    ...overrides,
  };
}

function existing(overrides: Partial<Connection> = {}): Connection {
  return {
    id: 'mevcut-1',
    name: 'Mevcut DB',
    folderId: null,
    host: 'db.internal',
    port: 5432,
    user: 'app',
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

const tunnel: SshSettings = {
  host: 'bastion',
  port: 22,
  user: 'deploy',
  auth: 'agent',
  keyPath: null,
  agentPath: null,
  saveSecret: true,
};

describe('gruplama', () => {
  it('aynı (host, port, kullanıcı) kaynaklar tek adayda birleşir; Veritabanı seçimi birleşimdir, ad ve başlangıç ilk kaynaktan', () => {
    const candidates = groupCandidates(
      [
        source({ source: { id: 'pgpass', label: '.pgpass satır 5' }, name: '10.0.4.12', host: '10.0.4.12', database: 'warehouse', databases: ['warehouse'] }),
        source({ source: { id: 'pgpass', label: '.pgpass satır 6' }, name: 'ikinci', host: '10.0.4.12', database: 'staging', databases: ['staging', 'warehouse'] }),
        source({ name: 'baska', host: '10.0.4.13' }),
      ],
      [],
    );
    expect(candidates).toHaveLength(2);
    expect(candidates[0]).toMatchObject({
      name: '10.0.4.12',
      database: 'warehouse',
      databases: ['warehouse', 'staging'],
      sources: [{ label: '.pgpass satır 5' }, { label: '.pgpass satır 6' }],
      existing: null,
      selected: true,
    });
    expect(candidates[1]!.name).toBe('baska');
  });

  it('host büyük/küçük harf duyarsız eşleşir; port, kullanıcı ya da tünel farklıysa ayrı aday', () => {
    const candidates = groupCandidates(
      [
        source(),
        source({ host: 'DB.internal' }),
        source({ port: 6432 }),
        source({ user: 'baska' }),
        source({ ssh: tunnel }),
        source({ ssh: { ...tunnel, user: 'root' } }),
      ],
      [],
    );
    expect(candidates).toHaveLength(5);
    expect(candidates[0]!.sources).toHaveLength(2);
    expect(new Set(candidates.map((c) => c.id)).size).toBe(5);
  });

  it('mevcut bağlantıyla aynı anahtar "zaten var": seçilmemiş, adı mevcut bağlantının adı', () => {
    const [candidate] = groupCandidates([source()], [existing()]);
    expect(candidate).toMatchObject({ existing: { id: 'mevcut-1', name: 'Mevcut DB' }, selected: false, name: 'Mevcut DB' });
    // Tünelli mevcut bağlantı tünelsiz adayla eşleşmez.
    expect(groupCandidates([source()], [existing({ ssh: tunnel })])[0]!.existing).toBeNull();
  });

  it('tüneli eşlenemeyen kaynak ayrı aday ve seçilmez; aynı host’a doğrudan aday ya da mevcut bağlantıyla birleşmez', () => {
    const unmapped = source({ source: { id: 'jetbrains:DG', label: 'DG · iç' }, warnings: ['tünel eşlenemedi: x'], tunnelUnmapped: true });
    const candidates = groupCandidates([source({ warnings: ['a'] }), unmapped, { ...unmapped }], [existing()]);
    expect(candidates.map((c) => [c.selected, c.existing?.name ?? null, c.warnings])).toEqual([
      [false, 'Mevcut DB', ['a']],
      [false, null, ['tünel eşlenemedi: x']],
    ]);
    expect(candidates[1]!.sources).toHaveLength(2);
  });
});

describe('benzersiz ad', () => {
  it('alınmamış ad aynen kalır; alınmışsa "ad (2)", "ad (3)"…', () => {
    expect(uniqueName('db', ['x'])).toBe('db');
    expect(uniqueName('db', ['db'])).toBe('db (2)');
    expect(uniqueName('db', ['db', 'db (2)'])).toBe('db (3)');
  });
});
