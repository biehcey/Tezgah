import { describe, expect, it } from 'vitest';
import { DEFAULT_SSL, type Connection } from '../baglanti';
import { initialChoice, previewSections, selectionsOf, type CandidateChoice } from './onizleme';
import type { PreviewCandidate } from './sozlesme';

const conn = (id: string, name: string, folderId: string | null = null): Connection => ({
  id,
  name,
  folderId,
  host: `${id}.internal`,
  port: 5432,
  user: 'app',
  database: 'postgres',
  envTag: null,
  color: null,
  savePassword: true,
  ...DEFAULT_SSL,
  ssh: null,
  databaseSelection: [{ database: 'postgres', schemas: null }],
});

const cand = (id: string, name: string, existing: { id: string; name: string } | null = null): PreviewCandidate => ({
  id,
  name,
  host: `${id}.internal`,
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
  sources: [{ id: 'pgpass', label: '.pgpass satır 1' }],
  existing,
  selected: existing === null,
  password: null,
});

const rowNames = (sections: ReturnType<typeof previewSections>) =>
  sections.map((s) => [s.name, s.isNew, s.rows.map((r) => (r.kind === 'mevcut' ? `mevcut:${r.connection.name}` : `aday:${r.name}`))]);

describe('önizleme ağacı', () => {
  const folders = [{ id: 'k1', name: 'Billing' }];
  const connections = [conn('a', 'billing-staging', 'k1'), conn('b', 'local')];

  it('zaten var olan aday eşinin klasöründe ve hemen altında; yeni klasör en sonda "yeni", Klasörsüz en altta', () => {
    const candidates = [
      cand('x', 'yeni-db'),
      cand('a', 'billing-staging', { id: 'a', name: 'billing-staging' }),
      cand('y', 'prod'),
      cand('l', 'local', { id: 'b', name: 'local' }),
    ];
    const choices: Record<string, CandidateChoice> = Object.fromEntries(candidates.map((c) => [c.id, initialChoice(c, connections, folders)]));
    choices.y = { ...choices.y!, folder: 'Billing/Prod' };
    expect(choices.a).toMatchObject({ folder: 'Billing', selected: false });
    expect(rowNames(previewSections(connections, folders, candidates, choices))).toEqual([
      ['Billing', false, ['mevcut:billing-staging', 'aday:billing-staging']],
      ['Billing/Prod', true, ['aday:prod']],
      ['Klasörsüz', false, ['mevcut:local', 'aday:local', 'aday:yeni-db']],
    ]);
  });

  it('seçilen yinelenen aday "ad (2)" olarak görünür; seçilmeyenler istekte yok', () => {
    const candidates = [cand('a', 'billing-staging', { id: 'a', name: 'billing-staging' }), cand('z', 'local')];
    const choices: Record<string, CandidateChoice> = {
      a: { selected: true, name: 'billing-staging', folder: 'billing', envTag: null },
      z: { selected: false, name: 'local', folder: null, envTag: null },
    };
    const sections = previewSections(connections, folders, candidates, choices);
    expect(rowNames(sections)[0]).toEqual(['Billing', false, ['mevcut:billing-staging', 'aday:billing-staging (2)']]);
    expect(selectionsOf(candidates, choices)).toEqual([{ id: 'a', name: 'billing-staging', folder: 'billing', envTag: null }]);
  });
});
