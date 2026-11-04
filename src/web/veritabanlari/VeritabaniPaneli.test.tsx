import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { App } from '../App';
import { editConnection } from '../test/eylemler';
import { connection, createFakeConnections, renderWithApi, type FakeConnections } from '../test/sahte-api';

const nav = () => screen.getByRole('navigation', { name: 'Bağlantılar' });
const panel = () => screen.getByRole('region', { name: 'Veritabanları' });
const header = () => screen.getByRole('region', { name: 'Hedef' });

/** Bağlantı listesindeki satır (`li`); satır düğmesi ve ⋯ menüsü içinde. */
const rowOf = (name: string) => within(nav()).getByText(name, { selector: '.baglanti-adi' }).closest('li')!;

function setup(fake: FakeConnections = createFakeConnections([connection()])) {
  const user = userEvent.setup();
  renderWithApi(<App />, fake.api);
  return { user, fake };
}

async function selectConnection(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(await within(nav()).findByRole('button', { name: new RegExp(name) }));
}

function withServer(fake: FakeConnections, id = 'b1') {
  fake.servers.set(id, {
    databases: {
      postgres: ['information_schema', 'pg_catalog', 'pg_toast', 'public'],
      app: ['information_schema', 'pg_catalog', 'public', 'raporlar'],
      analitik: ['public'],
    },
  });
  return fake;
}

describe('Veritabanı paneli: bağlanmamış bağlantı', () => {
  it('bağlantı seçilince kayıtlı seçim görünür ve hiçbir sunucuya bağlanılmaz', async () => {
    const { user, fake } = setup(
      createFakeConnections([
        connection({
          databaseSelection: [
            { database: 'postgres', schemas: null },
            { database: 'app', schemas: ['public'] },
          ],
        }),
      ]),
    );
    expect(screen.queryByRole('region', { name: 'Veritabanları' })).not.toBeInTheDocument();
    await selectConnection(user, 'Yerel');
    const p = within(panel());
    expect(p.getByRole('button', { name: 'postgres' })).toBeInTheDocument();
    expect(p.getByRole('button', { name: 'app' })).toBeInTheDocument();
    expect(p.getByRole('button', { name: 'Bağlan ve tüm veritabanlarını listele' })).toBeInTheDocument();
    expect(fake.databaseRequests).toEqual([]);
  });

  it('bağlanmadan bir veritabanına tıklamak onu hedef yapar', async () => {
    const { user, fake } = setup();
    expect(within(header()).getByText('Hedef seçilmedi')).toBeInTheDocument();
    await selectConnection(user, 'Yerel');
    await user.click(within(panel()).getByRole('button', { name: 'postgres' }));
    expect(within(header()).getByRole('heading')).toHaveTextContent('Yerel / postgres');
    expect(within(panel()).getByRole('button', { name: 'postgres' })).toHaveAttribute('aria-current', 'true');
    expect(within(rowOf('Yerel')).getByText('● hedef')).toBeInTheDocument();
    expect(fake.databaseRequests).toEqual([]);
  });
});

describe('Veritabanı paneli: bağlanınca', () => {
  it('görünürler ⭐ ile üstte, diğerleri "Gizli (N)" altında; satırda bağlı işareti', async () => {
    const { user } = setup(withServer(createFakeConnections([connection()])));
    await selectConnection(user, 'Yerel');
    await user.click(within(panel()).getByRole('button', { name: 'Bağlan ve tüm veritabanlarını listele' }));

    const p = within(panel());
    expect(await p.findByRole('heading', { name: 'Gizli (2)' })).toBeInTheDocument();
    const visible = within(p.getByRole('list', { name: 'Görünür veritabanları' }));
    expect(visible.getByRole('button', { name: 'postgres' })).toBeInTheDocument();
    expect(visible.getByRole('button', { name: 'postgres görünürlükten çıkar' })).toBeInTheDocument();
    const hidden = within(p.getByRole('list', { name: 'Gizli veritabanları' }));
    expect(hidden.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      expect.stringContaining('analitik'),
      expect.stringContaining('app'),
    ]);
    expect(within(rowOf('Yerel')).getByLabelText('bağlı')).toBeInTheDocument();
  });

  it('bağlanırken satırda ◌ görünür, düğme beklemeye geçer', async () => {
    let finish!: () => void;
    const fake = withServer(createFakeConnections([connection()]));
    const list = fake.api.listDatabases;
    fake.api.listDatabases = (id) => new Promise((resolve) => (finish = () => resolve(list(id))));
    const { user } = setup(fake);
    await selectConnection(user, 'Yerel');
    await user.click(within(panel()).getByRole('button', { name: 'Bağlan ve tüm veritabanlarını listele' }));
    expect(within(rowOf('Yerel')).getByLabelText('bağlanıyor')).toBeInTheDocument();
    expect(within(panel()).getByRole('button', { name: 'Bağlanıyor…' })).toBeDisabled();
    finish();
    expect(await within(rowOf('Yerel')).findByLabelText('bağlı')).toBeInTheDocument();
  });

  it('⭐ gizli veritabanını görünür, görünürü gizli yapar ve seçim kaydedilir', async () => {
    const { user, fake } = setup(withServer(createFakeConnections([connection()])));
    await selectConnection(user, 'Yerel');
    await user.click(within(panel()).getByRole('button', { name: 'Bağlan ve tüm veritabanlarını listele' }));

    await user.click(await within(panel()).findByRole('button', { name: 'app görünür yap' }));
    await waitFor(() =>
      expect(fake.connections[0]!.databaseSelection).toEqual([
        { database: 'postgres', schemas: null },
        { database: 'app', schemas: null },
      ]),
    );
    expect(within(panel()).getByRole('heading', { name: 'Gizli (1)' })).toBeInTheDocument();

    await user.click(within(panel()).getByRole('button', { name: 'postgres görünürlükten çıkar' }));
    await waitFor(() => expect(fake.connections[0]!.databaseSelection).toEqual([{ database: 'app', schemas: null }]));
    expect(within(panel()).getByRole('heading', { name: 'Gizli (2)' })).toBeInTheDocument();
  });

  it('şema çipleri açılıp kapanır; sistem şemaları kapalı, çipe tıklamak görünürlüğü değiştirir', async () => {
    const { user, fake } = setup(
      withServer(
        createFakeConnections([
          connection({
            databaseSelection: [
              { database: 'postgres', schemas: null },
              { database: 'app', schemas: null },
            ],
          }),
        ]),
      ),
    );
    await selectConnection(user, 'Yerel');
    await user.click(within(panel()).getByRole('button', { name: 'Bağlan ve tüm veritabanlarını listele' }));
    const toggle = await within(panel()).findByRole('button', { name: 'app şemaları' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    const chips = within(await within(panel()).findByRole('group', { name: 'app şemaları' }));
    expect(chips.getByRole('button', { name: 'public' })).toHaveAttribute('aria-pressed', 'true');
    expect(chips.getByRole('button', { name: 'raporlar' })).toHaveAttribute('aria-pressed', 'true');
    expect(chips.getByRole('button', { name: 'pg_catalog' })).toHaveAttribute('aria-pressed', 'false');

    await user.click(chips.getByRole('button', { name: 'raporlar' }));
    await waitFor(() => expect(chips.getByRole('button', { name: 'raporlar' })).toHaveAttribute('aria-pressed', 'false'));
    expect(fake.connections[0]!.databaseSelection).toEqual([
      { database: 'postgres', schemas: null },
      { database: 'app', schemas: ['public'] },
    ]);

    await user.click(toggle);
    expect(within(panel()).queryByRole('group', { name: 'app şemaları' })).not.toBeInTheDocument();
  });

  it('⟳ veritabanı listesini yeniler', async () => {
    const { user, fake } = setup(withServer(createFakeConnections([connection()])));
    await selectConnection(user, 'Yerel');
    await user.click(within(panel()).getByRole('button', { name: 'Bağlan ve tüm veritabanlarını listele' }));
    await within(panel()).findByRole('heading', { name: 'Gizli (2)' });
    fake.servers.get('b1')!.databases.yeni = ['public'];
    await user.click(within(panel()).getByRole('button', { name: 'Yenile' }));
    expect(await within(panel()).findByRole('heading', { name: 'Gizli (3)' })).toBeInTheDocument();
  });
});

describe('Veritabanı paneli: bağlantı düzenlenince', () => {
  async function connected() {
    const ctx = setup(withServer(createFakeConnections([connection()])));
    await selectConnection(ctx.user, 'Yerel');
    await ctx.user.click(within(panel()).getByRole('button', { name: 'Bağlan ve tüm veritabanlarını listele' }));
    await within(rowOf('Yerel')).findByLabelText('bağlı');
    await editConnection(ctx.user, /Yerel/);
    return { ...ctx, f: within(screen.getByRole('form', { name: /bağlantı/i })) };
  }

  it('yalnızca ad değişince bağlı kalır', async () => {
    const { user, f } = await connected();
    await user.type(f.getByLabelText('Ad'), ' 2');
    await user.click(f.getByRole('button', { name: 'Kaydet' }));
    expect(await within(rowOf('Yerel 2')).findByLabelText('bağlı')).toBeInTheDocument();
  });

  it('host değişince sunucu pool’ları kapattığı için bağlı değil görünür', async () => {
    const { user, f } = await connected();
    await user.type(f.getByLabelText('Host'), '.example');
    await user.click(f.getByRole('button', { name: 'Kaydet' }));
    await waitFor(() => expect(within(rowOf('Yerel')).queryByLabelText('bağlı')).not.toBeInTheDocument());
    expect(within(panel()).getByRole('button', { name: 'Bağlan ve tüm veritabanlarını listele' })).toBeInTheDocument();
  });
});

describe('Veritabanı paneli: hata', () => {
  it('bağlanılamazsa mesaj, "Tekrar dene" ve "Düzenle" görünür; satırda ⚠', async () => {
    const { user, fake } = setup();
    await selectConnection(user, 'Yerel');
    await user.click(within(panel()).getByRole('button', { name: 'Bağlan ve tüm veritabanlarını listele' }));
    expect(await within(panel()).findByRole('alert')).toHaveTextContent('bağlantıyı reddetti');
    expect(within(rowOf('Yerel')).getByLabelText('bağlanamadı')).toBeInTheDocument();

    withServer(fake);
    await user.click(within(panel()).getByRole('button', { name: 'Tekrar dene' }));
    expect(await within(panel()).findByRole('heading', { name: 'Gizli (2)' })).toBeInTheDocument();
    expect(within(panel()).queryByRole('alert')).not.toBeInTheDocument();
  });

  it('"Düzenle" bağlantı formunu açar', async () => {
    const { user } = setup();
    await selectConnection(user, 'Yerel');
    await user.click(within(panel()).getByRole('button', { name: 'Bağlan ve tüm veritabanlarını listele' }));
    await user.click(await within(panel()).findByRole('button', { name: 'Düzenle' }));
    expect(screen.getByRole('form', { name: /bağlantı/i })).toBeInTheDocument();
  });
});

describe('bağlantı menüsü', () => {
  async function openMenu(user: ReturnType<typeof userEvent.setup>, name: string) {
    await user.click(within(rowOf(name)).getByRole('button', { name: 'Bağlantı menüsü' }));
  }

  it('"Hedef yap" bağlantının ilk görünür veritabanını hedef yapar', async () => {
    const { user } = setup(
      createFakeConnections([connection({ databaseSelection: [{ database: 'app', schemas: null }] })]),
    );
    await within(nav()).findByRole('button', { name: /Yerel/ });
    await openMenu(user, 'Yerel');
    await user.click(screen.getByRole('menuitem', { name: 'Hedef yap' }));
    expect(within(header()).getByRole('heading')).toHaveTextContent('Yerel / app');
  });

  it('"Bağlan" listeler; bağlıyken "Yenile" ve "Bağlantıyı kes" sunulur, kesince kayıtlı seçime döner', async () => {
    const { user, fake } = setup(withServer(createFakeConnections([connection()])));
    await within(nav()).findByRole('button', { name: /Yerel/ });
    await openMenu(user, 'Yerel');
    expect(screen.getByRole('menuitem', { name: 'Bağlantıyı kes' })).toBeDisabled();
    await user.click(screen.getByRole('menuitem', { name: 'Bağlan' }));
    expect(await within(panel()).findByRole('heading', { name: 'Gizli (2)' })).toBeInTheDocument();

    await openMenu(user, 'Yerel');
    expect(screen.getByRole('menuitem', { name: 'Yenile' })).toBeInTheDocument();
    await user.click(screen.getByRole('menuitem', { name: 'Bağlantıyı kes' }));
    await waitFor(() => expect(fake.databaseRequests).toContain('b1: kes'));
    expect(within(panel()).getByRole('button', { name: 'Bağlan ve tüm veritabanlarını listele' })).toBeInTheDocument();
    expect(within(rowOf('Yerel')).queryByLabelText('bağlı')).not.toBeInTheDocument();
  });

  it('panel başlığındaki ⋯ aynı menüyü açar', async () => {
    const { user } = setup();
    await selectConnection(user, 'Yerel');
    await user.click(within(panel()).getByRole('button', { name: 'Bağlantı menüsü' }));
    expect(screen.getByRole('menuitem', { name: 'Hedef yap' })).toBeInTheDocument();
  });
});

describe('hedef başlığı', () => {
  it('hedefin renk noktası, bağlantı / veritabanı ve ortam rozeti görünür', async () => {
    const { user } = setup(
      createFakeConnections([connection({ name: 'Dev DB', envTag: 'dev', color: '#16a34a' })]),
    );
    await selectConnection(user, 'Dev DB');
    await user.click(within(panel()).getByRole('button', { name: 'postgres' }));
    const h = within(header());
    expect(h.getByRole('heading')).toHaveTextContent('Dev DB / postgres');
    expect(h.getByText('dev')).toBeInTheDocument();
    expect(h.getByTestId('hedef-noktasi')).toHaveStyle({ backgroundColor: '#16a34a' });
    expect(header()).not.toHaveClass('prod');
    expect(document.querySelector('.tezgah')).not.toHaveClass('prod-cerceve');
  });

  it('prod hedefte başlık kırmızımsı, uygulama kırmızı çerçeveli', async () => {
    const { user } = setup(
      createFakeConnections([connection({ name: 'Canlı', envTag: 'prod', color: '#dc2626' })]),
    );
    await selectConnection(user, 'Canlı');
    await user.click(within(panel()).getByRole('button', { name: 'postgres' }));
    expect(header()).toHaveClass('prod');
    expect(within(header()).getByText('prod')).toBeInTheDocument();
    expect(document.querySelector('.tezgah')).toHaveClass('prod-cerceve');
  });

  it('başlığın altında henüz boş bir editör alanı var', async () => {
    setup();
    expect(await screen.findByRole('region', { name: 'Script editörü' })).toBeInTheDocument();
  });

  it('hedefin bağlantısı silinince hedef temizlenir', async () => {
    const { user } = setup();
    await selectConnection(user, 'Yerel');
    await user.click(within(panel()).getByRole('button', { name: 'postgres' }));
    await user.click(within(rowOf('Yerel')).getByRole('button', { name: 'Bağlantı menüsü' }));
    await user.click(screen.getByRole('menuitem', { name: 'Sil' }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Sil' }));
    await waitFor(() => expect(within(header()).getByText('Hedef seçilmedi')).toBeInTheDocument());
  });
});
