import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SSL } from '../../core/baglanti';
import type { ConnectionTestResponse } from '../../core/baglanti-testi';
import {
  addImported,
  type ImportApplyRequest,
  type ImportPreviewRequest,
  type ImportPreviewResponse,
  type PreviewCandidate,
} from '../../core/ice-aktarma/sozlesme';
import { App } from '../App';
import { connection, createFakeConnections, folder, renderWithApi, type FakeConnections } from '../test/sahte-api';

function candidate(overrides: Partial<PreviewCandidate> & Pick<PreviewCandidate, 'id' | 'name' | 'host'>): PreviewCandidate {
  return {
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
    sources: [{ id: 'pgpass', label: '.pgpass satır 2' }],
    existing: null,
    selected: true,
    password: { label: '.pgpass satır 2', line: 2, wildcard: false },
    ...overrides,
  };
}

const CANDIDATES: PreviewCandidate[] = [
  candidate({ id: 'c-prod', name: 'prod-db.internal', host: 'prod-db.internal', password: { label: '.pgpass satır 2', line: 2, wildcard: true } }),
  candidate({
    id: 'c-etl',
    name: '10.0.4.12',
    host: '10.0.4.12',
    user: 'etl',
    database: 'warehouse',
    databases: ['warehouse', 'staging'],
    sources: [
      { id: 'pgpass', label: '.pgpass satır 3' },
      { id: 'pgpass', label: '.pgpass satır 4' },
    ],
    password: { label: '.pgpass satır 3', line: 3, wildcard: false },
  }),
  candidate({ id: 'c-local', name: 'Yerel', host: 'localhost', user: 'postgres', existing: { id: 'b1', name: 'Yerel' }, selected: false }),
];

interface ImportFake extends FakeConnections {
  previews: ImportPreviewRequest[];
  applies: ImportApplyRequest[];
  tests: string[];
  /** Kaynak hatası (kırmızı çip). */
  sourceError: string | null;
  testResults: Map<string, ConnectionTestResponse>;
}

const OK_TEST: ConnectionTestResponse = {
  adimlar: [{ id: 'listeleme', sonuc: 'basarili', kod: null, mesaj: '', alan: null, oneriler: [] }],
  sunucu: { surum: '16.4', veritabaniSayisi: 4 },
};

function setup(initial = [connection({ id: 'b1', name: 'Yerel', host: 'localhost' })], folders = [folder('k1', 'Billing')]) {
  const fake = createFakeConnections(initial, {}, folders) as ImportFake;
  fake.previews = [];
  fake.applies = [];
  fake.tests = [];
  fake.sourceError = null;
  fake.testResults = new Map();
  let next = 1;
  const response = (req: ImportPreviewRequest): ImportPreviewResponse => {
    const enabled = !req.disabled.includes('pgpass');
    const error = fake.sourceError;
    return {
      sources: [
        {
          id: 'pgpass',
          label: '.pgpass',
          path: req.pgpassPath ?? '~/.pgpass',
          status: error ? 'error' : 'ok',
          error,
          candidateCount: error ? 0 : 4,
          enabled,
        },
      ],
      candidates: enabled && !error ? structuredClone(CANDIDATES) : [],
    };
  };
  Object.assign(fake.api, {
    previewImport: async (req: ImportPreviewRequest) => {
      fake.previews.push(req);
      return response(req);
    },
    applyImport: async (req: ImportApplyRequest) => {
      fake.applies.push(req);
      const candidates = response(req).candidates;
      const settings = { version: 3, folders: fake.folders, connections: fake.connections };
      const added = addImported(settings, candidates, req.selections, {
        newId: () => `ice-${next++}`,
        hasPassword: (id) => candidates.find((c) => c.id === id)?.password !== null,
      });
      const password = fake.deny ? ('reddedildi' as const) : ('kaydedildi' as const);
      for (const { connection: c } of added.connections) {
        if (fake.deny) c.savePassword = false;
        else fake.passwords.set(c.id, 'sifre');
      }
      return {
        added: added.connections.map(({ connection: c }) => ({ connection: structuredClone(c), password })),
        folders: added.folders,
        skipped: candidates.length - added.connections.length,
      };
    },
    testConnection: async (body: { connectionId: string }) => {
      fake.tests.push(body.connectionId);
      return fake.testResults.get(body.connectionId) ?? OK_TEST;
    },
  });
  const user = userEvent.setup();
  renderWithApi(<App />, fake.api);
  return { user, fake };
}

const nav = () => screen.getByRole('navigation', { name: 'Bağlantılar' });
const dialog = () => screen.getByRole('dialog', { name: 'İçe aktar' });
const tree = () => within(dialog()).getByRole('region', { name: 'Önizleme' });
const details = () => within(dialog()).getByRole('region', { name: 'Ayrıntı' });
const rowOf = (name: string) => within(tree()).getByText(name, { selector: '.agac-adi' }).closest('.agac-satiri') as HTMLElement;

async function openImport(user: ReturnType<typeof userEvent.setup>) {
  await within(nav()).findByText('Yerel');
  await user.click(screen.getByRole('button', { name: 'İçe aktar' }));
  await within(dialog()).findByText('prod-db.internal', { selector: '.agac-adi' });
}

describe('içe aktarma diyaloğu', () => {
  it('açılınca .pgpass taranır; önizleme listenin sonraki hâli: mevcut gri, gelenler seçili, zaten var eşinin altında', async () => {
    const { user, fake } = setup();
    await openImport(user);
    expect(fake.previews).toEqual([{ pgpassPath: null, disabled: [] }]);
    expect(within(dialog()).getByRole('button', { name: /\.pgpass 4/ })).toHaveAttribute('aria-pressed', 'true');

    const unfiled = within(tree()).getByRole('group', { name: 'Klasörsüz' });
    const rows = [...unfiled.querySelectorAll('.agac-satiri')].map((r) => [
      r.querySelector('.agac-adi')?.textContent,
      r.querySelector('.agac-rozeti')?.textContent,
    ]);
    expect(rows).toEqual([
      ['Yerel', 'mevcut'],
      ['Yerel', 'atlanacak'],
      ['prod-db.internal', 'yeni'],
      ['10.0.4.12', 'yeni'],
    ]);
    expect(within(rowOf('prod-db.internal')).getByRole('checkbox')).toBeChecked();
    expect(within(rowOf('prod-db.internal')).getByLabelText('şifre .pgpass’tan')).toBeInTheDocument();
    expect(within(dialog()).getByText('2 yeni bağlantı')).toBeInTheDocument();
    expect(within(dialog()).getByRole('checkbox', { name: 'İçe aktardıktan sonra test et' })).not.toBeChecked();
  });

  it('zaten var olan işaretlenince "ad (2)" olur', async () => {
    const { user } = setup();
    await openImport(user);
    const twin = within(tree()).getAllByText('Yerel', { selector: '.agac-adi' })[1]!.closest('.agac-satiri') as HTMLElement;
    await user.click(within(twin).getByRole('checkbox'));
    expect(within(tree()).getByText('Yerel (2)', { selector: '.agac-adi' })).toBeInTheDocument();
    expect(within(dialog()).getByText('3 yeni bağlantı')).toBeInTheDocument();
  });

  it('seçilen adayın adı, klasörü ve ortamı sağ panelde düzenlenir; ayrıntılar görünür', async () => {
    const { user, fake } = setup();
    await openImport(user);
    await user.click(within(rowOf('10.0.4.12')).getByText('10.0.4.12'));
    expect(within(details()).getByText('etl@10.0.4.12')).toBeInTheDocument();
    expect(within(details()).getByText(/^🔑/)).toHaveTextContent('.pgpass satır 3');
    expect(within(details()).getByText('2 kaynaktan birleştirildi')).toBeInTheDocument();
    expect(within(details()).getByText('warehouse')).toHaveTextContent('başlangıç');

    await user.click(within(rowOf('prod-db.internal')).getByText('prod-db.internal'));
    expect(within(details()).getByText(/joker/)).toBeInTheDocument();
    const name = within(details()).getByLabelText('Ad');
    await user.clear(name);
    await user.type(name, 'billing-prod');
    await user.selectOptions(within(details()).getByLabelText('Klasör'), 'yeni klasör…');
    await user.type(within(details()).getByLabelText('Yeni klasör adı'), 'Billing/Prod');
    await user.selectOptions(within(details()).getByLabelText('Ortam'), 'prod');
    const section = within(tree()).getByRole('group', { name: /Billing\/Prod/ });
    expect(section).toHaveTextContent('yeni klasör');
    expect(within(section).getByText('billing-prod')).toBeInTheDocument();

    await user.click(within(dialog()).getByRole('button', { name: 'İçe aktar' }));
    expect(fake.applies).toEqual([
      {
        pgpassPath: null,
        disabled: [],
        selections: [
          { id: 'c-prod', name: 'billing-prod', folder: 'Billing/Prod', envTag: 'prod' },
          { id: 'c-etl', name: '10.0.4.12', folder: null, envTag: null },
        ],
      },
    ]);
    const result = await screen.findByRole('dialog', { name: 'İçe aktarma sonucu' });
    expect(result).toHaveTextContent('2 eklendi, 1 atlandı');
    expect(screen.queryByRole('dialog', { name: 'İçe aktar' })).not.toBeInTheDocument();
    // Yeni bağlantılar listede "yeni" rozetli, yeni klasör listede.
    expect(within(nav()).getByRole('region', { name: 'Billing/Prod' })).toBeInTheDocument();
    const row = within(nav()).getByRole('button', { name: /billing-prod/ });
    expect(row).toHaveTextContent('yeni');
    expect(fake.tests).toEqual([]);
  });

  it('kaynak çipi kapatılınca yeniden taranır; hatalı kaynak kırmızı ⚠; yol elle girilebilir', async () => {
    const { user, fake } = setup();
    await openImport(user);
    await user.click(within(dialog()).getByRole('button', { name: /\.pgpass 4/ }));
    await waitFor(() => expect(fake.previews.at(-1)).toEqual({ pgpassPath: null, disabled: ['pgpass'] }));
    expect(within(tree()).queryByText('prod-db.internal')).not.toBeInTheDocument();
    expect(within(dialog()).getByText('0 yeni bağlantı')).toBeInTheDocument();

    fake.sourceError = 'Yalnızca .pgpass ya da pgpass.conf adlı dosyalar okunur';
    await user.click(within(dialog()).getByRole('button', { name: '.pgpass yolu…' }));
    await user.type(within(dialog()).getByLabelText('.pgpass yolu'), '/tmp/gizli.txt{Enter}');
    await waitFor(() => expect(fake.previews.at(-1)).toEqual({ pgpassPath: '/tmp/gizli.txt', disabled: ['pgpass'] }));
    const chip = await within(dialog()).findByText(/⚠/);
    expect(chip.closest('.cip')).toHaveClass('hatali');
    expect(chip.closest('.cip')).toHaveAttribute('title', expect.stringMatching(/pgpass\.conf/));
  });

  it('İptal ve Escape diyaloğu kapatır, hiçbir şey eklenmez', async () => {
    const { user, fake } = setup();
    await openImport(user);
    await user.click(within(dialog()).getByRole('button', { name: 'İptal' }));
    expect(screen.queryByRole('dialog', { name: 'İçe aktar' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'İçe aktar' }));
    await within(dialog()).findByText('prod-db.internal', { selector: '.agac-adi' });
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'İçe aktar' })).not.toBeInTheDocument();
    expect(fake.applies).toEqual([]);
  });
});

describe('içe aktardıktan sonra', () => {
  it('toplu test sırayla koşar; sonuç pencerede ve listede durum ikonu olarak görünür', async () => {
    const { user, fake } = setup();
    fake.testResults.set('ice-2', {
      adimlar: [
        {
          id: 'ulasma',
          sonuc: 'hata',
          kod: null,
          mesaj: '10.0.4.12:5432 zamanında yanıt vermedi (zaman aşımı).',
          alan: 'host',
          oneriler: [],
        },
      ],
      sunucu: null,
    });
    await openImport(user);
    await user.click(within(dialog()).getByRole('checkbox', { name: 'İçe aktardıktan sonra test et' }));
    await user.click(within(dialog()).getByRole('button', { name: 'İçe aktar' }));
    const result = await screen.findByRole('dialog', { name: 'İçe aktarma sonucu' });
    await within(result).findByText(/zaman aşımı/);
    expect(fake.tests).toEqual(['ice-1', 'ice-2']);
    expect(within(result).getByText('PostgreSQL 16.4 · 4 veritabanı')).toBeInTheDocument();
    expect(within(nav()).getByRole('button', { name: /prod-db\.internal/ })).toContainElement(
      within(nav()).getByRole('img', { name: /test: PostgreSQL 16\.4/ }),
    );
    expect(within(within(nav()).getByRole('button', { name: /10\.0\.4\.12/ })).getByRole('img', { name: /test: .*zaman aşımı/ })).toHaveTextContent('⚠');
  });

  it('keychain yazamazsa sonuçta listelenir; şifresiz bağlantı test edilmez', async () => {
    const { user, fake } = setup();
    fake.deny = true;
    await openImport(user);
    await user.click(within(dialog()).getByRole('checkbox', { name: 'İçe aktardıktan sonra test et' }));
    await user.click(within(dialog()).getByRole('button', { name: 'İçe aktar' }));
    const result = await screen.findByRole('dialog', { name: 'İçe aktarma sonucu' });
    expect(within(result).getByRole('alert')).toHaveTextContent(
      'şifre kaydedilemedi: prod-db.internal, 10.0.4.12; ilk bağlanmada sorulur',
    );
    expect(await within(result).findAllByText('şifre yok, test atlandı')).toHaveLength(2);
    expect(fake.tests).toEqual([]);
  });

  it('"Formda aç" sonuç penceresini kapatıp bağlantının formunu açar', async () => {
    const { user } = setup();
    await openImport(user);
    await user.click(within(dialog()).getByRole('button', { name: 'İçe aktar' }));
    const result = await screen.findByRole('dialog', { name: 'İçe aktarma sonucu' });
    await user.click(within(result).getAllByRole('button', { name: 'Formda aç' })[1]!);
    expect(screen.queryByRole('dialog', { name: 'İçe aktarma sonucu' })).not.toBeInTheDocument();
    expect(screen.getByRole('form', { name: /bağlantı/i })).toBeInTheDocument();
    expect(screen.getByLabelText('Ad')).toHaveValue('10.0.4.12');
  });

  it('"yeni" rozeti bir sonraki içe aktarmaya kadar kalır', async () => {
    const { user } = setup();
    await openImport(user);
    await user.click(within(dialog()).getByRole('button', { name: 'İçe aktar' }));
    await user.click(within(await screen.findByRole('dialog', { name: 'İçe aktarma sonucu' })).getByRole('button', { name: 'Kapat' }));
    expect(within(nav()).getByRole('button', { name: /10\.0\.4\.12/ })).toHaveTextContent('yeni');
    await openImport(user);
    // Yalnızca prod yeniden içe aktarılır: önceki içe aktarılanların rozeti temizlenir.
    const etl = within(tree()).getAllByText('10.0.4.12 (2)', { selector: '.agac-adi' })[0]!.closest('.agac-satiri') as HTMLElement;
    await user.click(within(etl).getByRole('checkbox'));
    await user.click(within(dialog()).getByRole('button', { name: 'İçe aktar' }));
    await screen.findByRole('dialog', { name: 'İçe aktarma sonucu' });
    expect(within(nav()).getByRole('button', { name: /^10\.0\.4\.12/ })).not.toHaveTextContent('yeni');
    expect(within(nav()).getByRole('button', { name: /prod-db\.internal \(2\)/ })).toHaveTextContent('yeni');
  });
});

describe('giriş noktaları', () => {
  it('boş listede "İçe aktar…" ve palette "İçe aktar" komutu diyaloğu açar', async () => {
    const { user } = setup([], []);
    await user.click(await within(nav()).findByRole('button', { name: 'İçe aktar…' }));
    expect(await screen.findByRole('dialog', { name: 'İçe aktar' })).toBeInTheDocument();
    await user.click(within(dialog()).getByRole('button', { name: 'İptal' }));

    await user.keyboard('{Control>}k{/Control}');
    await user.type(screen.getByRole('combobox'), 'içe aktar');
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('dialog', { name: 'İçe aktar' })).toBeInTheDocument();
  });
});
