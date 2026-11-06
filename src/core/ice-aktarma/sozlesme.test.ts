import { describe, expect, it } from 'vitest';
import { emptySettings } from '../ayarlar';
import { DEFAULT_SSL } from '../baglanti';
import type { ImportCandidate } from './gruplama';
import { CandidateNotFound, addImported, parseImportApplyInput, parseImportPreviewInput } from './sozlesme';

const candidate = (id: string, name: string): ImportCandidate => ({
  id,
  name,
  host: `${id}.internal`,
  port: 5432,
  user: 'app',
  database: 'billing',
  databases: ['billing', 'archive'],
  ssh: null,
  ...DEFAULT_SSL,
  envTag: null,
  envReason: null,
  folder: null,
  warnings: [],
  sources: [{ id: 'pgpass', label: '.pgpass satır 1' }],
  existing: null,
  selected: true,
});

describe('içe aktarma girdisi', () => {
  it('varsayılanlar: kendiliğinden arama, açık kaynaklar; boş yol null olur', () => {
    expect(parseImportPreviewInput({})).toEqual({ ok: true, value: { pgpassPath: null, disabled: [] } });
    expect(parseImportPreviewInput({ pgpassPath: '  ' })).toMatchObject({ value: { pgpassPath: null } });
    expect(parseImportPreviewInput({ disabled: [1] }).ok).toBe(false);
  });

  it('seçimde ad gerekli, etiket geçerli olmalı, aynı aday iki kez seçilemez; klasör ve ad kırpılır', () => {
    const base = { selections: [{ id: 'a', name: ' db ', folder: ' Billing ', envTag: 'prod' }] };
    expect(parseImportApplyInput(base)).toMatchObject({ ok: true, value: { selections: [{ name: 'db', folder: 'Billing', envTag: 'prod' }] } });
    expect(parseImportApplyInput({ selections: [{ id: 'a', name: '' }] }).ok).toBe(false);
    expect(parseImportApplyInput({ selections: [{ id: 'a', name: 'x', envTag: 'uretim' }] }).ok).toBe(false);
    expect(parseImportApplyInput({ selections: [{ id: 'a', name: 'x' }, { id: 'a', name: 'y' }] }).ok).toBe(false);
  });
});

describe('seçilenlerin eklenmesi', () => {
  it('klasör adla eşleşir ya da oluşur; alınmış ad "ad (2)"; şifresizde şifre ilk bağlanmada sorulur', () => {
    const settings = emptySettings();
    settings.folders.push({ id: 'k1', name: 'Billing' });
    let n = 0;
    const result = addImported(
      settings,
      [candidate('a', 'db'), candidate('b', 'db')],
      [
        { id: 'a', name: 'db', folder: 'billing', envTag: 'staging' },
        { id: 'b', name: 'db', folder: 'Yeni', envTag: null },
      ],
      { newId: () => `id-${++n}`, hasPassword: (id) => id === 'a' },
    );
    expect(result.connections.map(({ connection: c, candidateId }) => [candidateId, c.name, c.folderId, c.savePassword, c.color])).toEqual([
      ['a', 'db', 'k1', true, '#d97706'],
      ['b', 'db (2)', 'id-2', false, null],
    ]);
    expect(result.folders).toEqual([{ id: 'id-2', name: 'Yeni' }]);
    expect(result.connections[0]!.connection.databaseSelection).toEqual([
      { database: 'billing', schemas: null },
      { database: 'archive', schemas: null },
    ]);
  });

  it('kaynaklarda olmayan aday hata verir', () => {
    expect(() =>
      addImported(emptySettings(), [], [{ id: 'yok', name: 'x', folder: null, envTag: null }], { newId: () => 'i', hasPassword: () => false }),
    ).toThrow(CandidateNotFound);
  });
});
