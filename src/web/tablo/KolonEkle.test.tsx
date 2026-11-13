import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { Connection } from '../../core/baglanti';
import type { Catalog } from '../../core/katalog';
import { TABS_VERSION, type SavedTabs } from '../../core/konsol-sekmeleri';
import type { TablePageResponse } from '../../core/tablo-sayfasi';
import { App } from '../App';
import { editorScript, fill } from '../test/eylemler';
import { connection, createFakeConnections, createFakeScriptRuns, emptyCatalog, renderWithApi } from '../test/sahte-api';

const DK = 60_000;
const DEV = connection({ id: 'd1', name: 'Yerel', databaseSelection: [{ database: 'postgres', schemas: null }] });
const PROD = connection({ id: 'p1', name: 'Canlı', envTag: 'prod', color: '#dc2626', databaseSelection: [{ database: 'postgres', schemas: null }] });

const CATALOG: Catalog = emptyCatalog({ semalar: ['public'], kullaniciTipleri: ['public.durum'] });

const page = (overrides: Partial<TablePageResponse> = {}): TablePageResponse => ({
  kolonlar: ['id', 'ad'],
  tipler: [23, 25],
  pk: ['id'],
  uretilmis: [],
  satirlar: [
    ['1', 'Ali'],
    ['2', 'Ayşe'],
  ],
  sonraki: null,
  tutarlilikNotu: false,
  ...overrides,
});

/** `users` Tablo sekmesi "Yükle" ile yüklenir, sonra "+ Kolon" formu açılır. */
async function setup({ conn = DEV, firstPage = page() }: { conn?: Connection; firstPage?: TablePageResponse } = {}) {
  const user = userEvent.setup();
  const runs = createFakeScriptRuns();
  const fake = createFakeConnections([structuredClone(conn)]);
  const tabs: SavedTabs = {
    version: TABS_VERSION,
    sekmeler: [
      { id: 'k1', tur: 'konsol', hedef: { connectionId: conn.id, database: 'postgres', schema: null }, metin: '' },
      { id: 't1', tur: 'tablo', hedef: { connectionId: conn.id, database: 'postgres', schema: 'public' }, sema: 'public', tablo: 'users', where: '', orderBy: '' },
    ],
    aktif: 't1',
  };
  fake.savedTabs = tabs;
  fake.catalogs.set(`${conn.id}/postgres`, CATALOG);
  fake.volatility = { random: 'v', now: 's' };
  fake.tablePage = async () => firstPage;
  fake.api.runScript = runs.runScript;
  renderWithApi(<App />, fake.api);
  await screen.findByRole('region', { name: 'public.users tablosu' });
  await user.click(t().getByRole('button', { name: 'Yükle' }));
  await within(tableTab()).findByRole('grid');
  await user.click(t().getByRole('button', { name: '+ Kolon' }));
  return { user, fake, runs };
}

const tableTab = () => screen.getByRole('region', { name: 'public.users tablosu' });
const t = () => within(tableTab());
const form = () => within(t().getByRole('region', { name: 'Kolon ekle' }));
const nameBox = () => form().getByRole('textbox', { name: 'Kolon adı' });
const typeBox = () => form().getByRole('combobox', { name: 'Tip' });
const defaultBox = () => form().getByRole('textbox', { name: 'Varsayılan ifade' });
const alterSql = () => form().getByRole('region', { name: 'ALTER önizlemesi' }).textContent;
const warnings = () => form().queryByRole('list', { name: 'Uyarılar' })?.textContent ?? '';
const button = (name: string) => form().getByRole('button', { name });

async function fillColumn(user: ReturnType<typeof userEvent.setup>, ad: string, tip: string) {
  await fill(user, nameBox(), ad);
  await fill(user, typeBox(), tip);
}

describe('+ Kolon: form ve canlı önizleme', () => {
  it('önizleme her tuşta güncellenir; ad ve tip dolmadan çalıştırılamaz', async () => {
    const { user } = await setup();
    expect(alterSql()).toBe('ALTER TABLE "public"."users" ADD COLUMN "";');
    expect(button('Uygula')).toBeDisabled();
    expect(button('⟲ Dene')).toBeDisabled();

    await user.type(nameBox(), 'son');
    expect(alterSql()).toBe('ALTER TABLE "public"."users" ADD COLUMN "son";');
    await user.type(typeBox(), 'timestamptz');
    expect(alterSql()).toBe('ALTER TABLE "public"."users" ADD COLUMN "son" timestamptz;');
    expect(button('Uygula')).toBeEnabled();

    await user.click(form().getByRole('checkbox', { name: 'NOT NULL' }));
    await user.type(defaultBox(), "'2020-01-01'");
    expect(alterSql()).toBe(`ALTER TABLE "public"."users" ADD COLUMN "son" timestamptz NOT NULL DEFAULT '2020-01-01';`);
  });

  it('var olan kolon adı hatası çalıştırmayı engeller', async () => {
    const { user } = await setup();
    await fillColumn(user, 'ad', 'text');
    expect(form().getByText('“ad” kolonu tabloda zaten var.')).toBeInTheDocument();
    expect(button('Uygula')).toBeDisabled();
    expect(button('Konsola aktar')).toBeDisabled();
  });

  it('tip kutusu yaygın tipleri ve katalogdaki kullanıcı tiplerini önerir', async () => {
    await setup();
    const listId = typeBox().getAttribute('list')!;
    const options = [...document.getElementById(listId)!.querySelectorAll('option')].map((o) => o.value);
    expect(options).toEqual(expect.arrayContaining(['text', 'timestamptz', 'jsonb', 'public.durum']));
  });

  it('“Vazgeç” formu kapatır; tekrar açılan form boştur', async () => {
    const { user } = await setup();
    await fill(user, nameBox(), 'son');
    await user.click(button('Vazgeç'));
    expect(t().queryByRole('region', { name: 'Kolon ekle' })).not.toBeInTheDocument();
    await user.click(t().getByRole('button', { name: '+ Kolon' }));
    expect(nameBox()).toHaveValue('');
  });
});

describe('+ Kolon: uyarılar', () => {
  const REWRITE = 'Tablo yeniden yazılır';
  const FAILS = 'Boş olmayan tabloda hata verecek';

  it('volatile varsayılan: oynaklık sunucuya sorulur ve uyarı çıkar; çalıştırmayı engellemez', async () => {
    const { user, fake } = await setup();
    await fillColumn(user, 'kod', 'double precision');
    await fill(user, defaultBox(), 'random()');
    await waitFor(() => expect(warnings()).toContain(REWRITE));
    expect(fake.volatilityRequests).toEqual([['random']]);
    expect(button('Uygula')).toBeEnabled();
  });

  it('stable varsayılan uyarmaz', async () => {
    const { user, fake } = await setup();
    await fillColumn(user, 'ts', 'timestamptz');
    await fill(user, defaultBox(), 'now()');
    await waitFor(() => expect(fake.volatilityRequests).toEqual([['now']]));
    expect(warnings()).not.toContain(REWRITE);
  });

  it('satırlı tabloda varsayılansız NOT NULL uyarır; varsayılan girilince kalkar', async () => {
    const { user } = await setup();
    await fillColumn(user, 'kod', 'int');
    await user.click(form().getByRole('checkbox', { name: 'NOT NULL' }));
    expect(warnings()).toContain(FAILS);
    expect(button('Uygula')).toBeEnabled();
    await fill(user, defaultBox(), '0');
    expect(warnings()).not.toContain(FAILS);
  });

  it('boş tabloda varsayılansız NOT NULL uyarmaz', async () => {
    const { user } = await setup({ firstPage: page({ satirlar: [] }) });
    await fillColumn(user, 'kod', 'int');
    await user.click(form().getByRole('checkbox', { name: 'NOT NULL' }));
    expect(warnings()).toBe('');
  });
});

describe('+ Kolon: Uygula, Dene, Konsola aktar', () => {
  it('Uygula: ALTER Transaction modunda, satır beklentisi olmadan çalışır; commit sonrası katalog ve sayfa yeniden çekilir, form kapanır', async () => {
    const { user, fake, runs } = await setup();
    await fillColumn(user, 'son', 'timestamptz');
    await user.click(button('Uygula'));
    expect(runs.last()).toMatchObject({
      target: { connectionId: 'd1', database: 'postgres' },
      script: 'ALTER TABLE "public"."users" ADD COLUMN "son" timestamptz;',
      deneme: false,
      yazmaModu: false,
    });
    expect(runs.last().beklenenSatir).toBeUndefined();

    runs.last().emit(
      { type: 'done', i: 0, rowCount: null, ms: 2, komut: 'ALTER TABLE' },
      { type: 'kararBekleniyor', commitEdilebilir: true, kalanMs: 30 * DK },
    );
    fake.tablePage = async () => page({ kolonlar: ['id', 'ad', 'son'], tipler: [23, 25, 1184], satirlar: [['1', 'Ali', null]] });
    const catalogReads = fake.catalogRequests.length;
    await user.click(within(t().getByRole('region', { name: 'Karar' })).getByRole('button', { name: 'Commit' }));
    runs.last().emit({ type: 'bitti', sonuc: 'commit', katalogYenilendi: true });

    await waitFor(() => expect(fake.tablePageRequests).toHaveLength(2));
    expect(fake.catalogRequests.slice(catalogReads)).toEqual(['getir d1/postgres']);
    await waitFor(() => expect(t().getAllByRole('columnheader').map((h) => h.textContent)).toEqual(expect.arrayContaining([expect.stringContaining('son')])));
    expect(t().queryByRole('region', { name: 'Kolon ekle' })).not.toBeInTheDocument();
    expect(within(t().getByRole('region', { name: 'Karar' })).getByText('Commit edildi')).toBeInTheDocument();
  });

  it('rollback sonrası form değerleriyle kalır', async () => {
    const { user, runs } = await setup();
    await fillColumn(user, 'son', 'timestamptz');
    await user.click(button('Uygula'));
    runs.last().emit({ type: 'done', i: 0, rowCount: null, ms: 2, komut: 'ALTER TABLE' }, { type: 'kararBekleniyor', commitEdilebilir: true, kalanMs: 30 * DK });
    await user.click(within(t().getByRole('region', { name: 'Karar' })).getByRole('button', { name: 'Rollback' }));
    runs.last().emit({ type: 'bitti', sonuc: 'rollback' });
    expect(nameBox()).toHaveValue('son');
    expect(button('Uygula')).toBeEnabled();
  });

  it('Dene: Deneme modunda çalışır ve DDL şema farkını gösterir', async () => {
    const { user, runs } = await setup();
    await fillColumn(user, 'son', 'timestamptz');
    await user.click(button('⟲ Dene'));
    expect(runs.last()).toMatchObject({ deneme: true, script: 'ALTER TABLE "public"."users" ADD COLUMN "son" timestamptz;' });
    expect(runs.last().beklenenSatir).toBeUndefined();
    const kolon = (no: number, ad: string, tip: string) => ({ no, ad, tip, bos: true, varsayilan: null });
    runs.last().emit(
      {
        type: 'done',
        i: 0,
        rowCount: null,
        ms: 3,
        komut: 'ALTER TABLE',
        sema: [
          {
            oid: '100',
            once: { ad: 'public.users', kolonlar: [kolon(1, 'id', 'integer')] },
            sonra: { ad: 'public.users', kolonlar: [kolon(1, 'id', 'integer'), kolon(2, 'son', 'timestamp with time zone')] },
          },
        ],
      },
      { type: 'bitti', sonuc: 'deneme' },
    );
    const changes = t().getByRole('region', { name: 'Değişiklikler' });
    expect(within(changes).getByRole('list', { name: 'Şema farkı' })).toHaveTextContent('+ kolon son timestamp with time zone NULL');
    expect(nameBox()).toHaveValue('son');
  });

  it('prod 🔒 iken Uygula kapalı, Dene açık; kilit tek tıkla açılır', async () => {
    const { user } = await setup({ conn: PROD });
    await fillColumn(user, 'son', 'timestamptz');
    expect(button('Uygula')).toBeDisabled();
    expect(button('⟲ Dene')).toBeEnabled();
    await user.click(form().getByRole('button', { name: '🔒 Salt okunur' }));
    expect(button('Uygula')).toBeEnabled();
  });

  it('Konsola aktar: ALTER aynı hedefte yeni konsol sekmesinde açılır', async () => {
    const { user, runs } = await setup();
    await fillColumn(user, 'son', 'timestamptz');
    await user.click(button('Konsola aktar'));
    expect(editorScript()).toBe('ALTER TABLE "public"."users" ADD COLUMN "son" timestamptz;');
    expect(runs.runs).toHaveLength(0);
  });

  it('PK’sız tabloda da kolon eklenir', async () => {
    const { user, runs } = await setup({ firstPage: page({ pk: [] }) });
    await fillColumn(user, 'son', 'timestamptz');
    await user.click(button('Uygula'));
    expect(runs.last().script).toBe('ALTER TABLE "public"."users" ADD COLUMN "son" timestamptz;');
  });
});
