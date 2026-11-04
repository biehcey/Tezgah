import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { App } from '../App';
import { connection, createFakeConnections, folder, renderWithApi, type FakeConnections } from '../test/sahte-api';

const palette = () => screen.getByRole('dialog', { name: 'Hızlı geçiş' });
const search = () => within(palette()).getByRole('combobox');
const group = (name: string) => within(palette()).getByRole('group', { name });
const options = (name: string) =>
  within(group(name))
    .getAllByRole('option')
    .map((o) => o.textContent);
const header = () => screen.getByRole('region', { name: 'Hedef' });
const panel = () => screen.getByRole('region', { name: 'Veritabanları' });
const nav = () => screen.getByRole('navigation', { name: 'Bağlantılar' });

function twoConnections() {
  return createFakeConnections([
    connection({
      databaseSelection: [
        { database: 'postgres', schemas: null },
        { database: 'app', schemas: ['public'] },
      ],
    }),
    connection({
      id: 'b2',
      name: 'Prod',
      host: 'db.prod',
      envTag: 'prod',
      color: '#dc2626',
      databaseSelection: [{ database: 'faturalar', schemas: null }],
    }),
  ]);
}

async function setup(fake: FakeConnections = twoConnections()) {
  const user = userEvent.setup();
  renderWithApi(<App />, fake.api);
  await screen.findByText('Prod', { selector: '.baglanti-adi' });
  return { user, fake };
}

describe('Cmd/Ctrl+K paleti: hedefler', () => {
  it('Ctrl+K paleti açar; görünür veritabanları bağlanmadan listelenir, prod rozetli', async () => {
    const { user, fake } = await setup();
    await user.keyboard('{Control>}k{/Control}');
    expect(search()).toHaveFocus();
    expect(options('Hedefler')).toEqual(['Yerel / postgres', 'Yerel / app', 'Prod / faturalarprod']);
    expect(within(group('Hedefler')).getByRole('option', { name: /Prod \/ faturalar/ })).toHaveTextContent('prod');
    expect(fake.databaseRequests).toEqual([]);
  });

  it('Cmd+K da açar; Escape kapatır', async () => {
    const { user } = await setup();
    await user.keyboard('{Meta>}k{/Meta}');
    expect(palette()).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Hızlı geçiş' })).not.toBeInTheDocument();
  });

  it('yazınca bulanık süzülür; Enter ilk sonucu editörün hedefi yapar ve paleti kapatır', async () => {
    const { user } = await setup();
    await user.keyboard('{Control>}k{/Control}');
    await user.type(search(), 'prfat');
    expect(options('Hedefler')).toEqual(['Prod / faturalarprod']);
    await user.keyboard('{Enter}');
    expect(screen.queryByRole('dialog', { name: 'Hızlı geçiş' })).not.toBeInTheDocument();
    expect(within(header()).getByRole('heading')).toHaveTextContent('Prod / faturalar');
  });

  it('ok tuşlarıyla gezinilir; mevcut hedef işaretli', async () => {
    const { user } = await setup();
    await user.keyboard('{Control>}k{/Control}');
    await user.keyboard('{ArrowDown}{Enter}');
    expect(within(header()).getByRole('heading')).toHaveTextContent('Yerel / app');

    await user.keyboard('{Control>}k{/Control}');
    const current = within(group('Hedefler')).getByRole('option', { name: /Yerel \/ app/ });
    expect(current).toHaveTextContent('● hedef');
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowUp}');
    expect(within(group('Hedefler')).getByRole('option', { name: /Yerel \/ app/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('Alt+Enter seçimi listede gösterir, hedefi değiştirmez', async () => {
    const { user } = await setup();
    await user.keyboard('{Control>}k{/Control}');
    await user.type(search(), 'fatura');
    await user.keyboard('{Alt>}{Enter}{/Alt}');
    expect(screen.queryByRole('dialog', { name: 'Hızlı geçiş' })).not.toBeInTheDocument();
    expect(within(header()).getByText('Hedef seçilmedi')).toBeInTheDocument();
    expect(within(panel()).getByRole('button', { name: 'faturalar' })).toHaveFocus();
  });

  it('sonuca tıklamak da hedef yapar', async () => {
    const { user } = await setup();
    await user.keyboard('{Control>}k{/Control}');
    await user.click(within(group('Hedefler')).getByRole('option', { name: /Yerel \/ postgres/ }));
    expect(within(header()).getByRole('heading')).toHaveTextContent('Yerel / postgres');
  });
});

describe('Cmd/Ctrl+K paleti: gizli veritabanları', () => {
  function connected() {
    const fake = twoConnections();
    fake.servers.set('b1', { databases: { postgres: ['public'], app: ['public'], analitik: ['public'] } });
    return fake;
  }

  async function connectYerel(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', { name: /^Yerel/ }));
    await user.click(within(panel()).getByRole('button', { name: 'Bağlan ve tüm veritabanlarını listele' }));
    await within(panel()).findByRole('heading', { name: 'Gizli (1)' });
  }

  it('bağlanmamışken ve sorgu yokken gizli veritabanı grubu yok', async () => {
    const { user } = await setup(connected());
    await user.keyboard('{Control>}k{/Control}');
    await user.type(search(), 'analitik');
    expect(within(palette()).queryByRole('group', { name: 'Gizli veritabanları' })).not.toBeInTheDocument();
    await user.keyboard('{Escape}');

    await connectYerel(user);
    await user.keyboard('{Control>}k{/Control}');
    expect(within(palette()).queryByRole('group', { name: 'Gizli veritabanları' })).not.toBeInTheDocument();
    await user.type(search(), 'analitik');
    expect(options('Gizli veritabanları')).toEqual(['Yerel / analitik']);
  });

  it('Enter gizli veritabanını görünür yapar ve hedef yapar', async () => {
    const { user, fake } = await setup(connected());
    await connectYerel(user);
    await user.keyboard('{Control>}k{/Control}');
    await user.type(search(), 'analitik');
    await user.keyboard('{Enter}');
    expect(within(header()).getByRole('heading')).toHaveTextContent('Yerel / analitik');
    expect(await within(panel()).findByRole('button', { name: 'analitik' })).toHaveAttribute('aria-current', 'true');
    expect(fake.connections[0]!.databaseSelection.map((d) => d.database)).toEqual(['postgres', 'app', 'analitik']);
  });

  it('Alt+Enter gizli veritabanını görünür yapmadan panelde gösterir', async () => {
    const { user, fake } = await setup(connected());
    await connectYerel(user);
    await user.keyboard('{Control>}k{/Control}');
    await user.type(search(), 'analitik');
    await user.keyboard('{Alt>}{Enter}{/Alt}');
    expect(within(panel()).getByRole('button', { name: 'analitik görünür yap' })).toHaveFocus();
    expect(fake.connections[0]!.databaseSelection).toHaveLength(2);
  });
});

describe('Cmd/Ctrl+K paleti: komutlar', () => {
  it('yeni bağlantı formu ve yeni klasör penceresi açılır; henüz olmayanlar pasif', async () => {
    const { user } = await setup();
    await user.keyboard('{Control>}k{/Control}');
    expect(options('Komutlar')).toEqual([
      'Yeni bağlantı',
      'Yeni klasör',
      'İçe aktaryakında',
      'Çalıştırma kayıtları klasörünü açyakında',
    ]);
    expect(within(group('Komutlar')).getByRole('option', { name: /İçe aktar/ })).toHaveAttribute('aria-disabled', 'true');

    await user.type(search(), 'yeni bag');
    expect(within(palette()).queryByRole('group', { name: 'Hedefler' })).not.toBeInTheDocument();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('form', { name: /bağlantı/i })).toBeInTheDocument();

    await user.keyboard('{Control>}k{/Control}');
    await user.type(search(), 'klasor');
    await user.keyboard('{Enter}');
    expect(screen.getByRole('dialog', { name: 'Yeni klasör' })).toBeInTheDocument();
  });

  it('pasif komut Enter ya da tıklamayla çalışmaz, gezinmede atlanır', async () => {
    const { user } = await setup();
    await user.keyboard('{Control>}k{/Control}');
    await user.type(search(), 'ice aktar');
    await user.keyboard('{Enter}');
    await user.click(within(group('Komutlar')).getByRole('option', { name: /İçe aktar/ }));
    expect(palette()).toBeInTheDocument();
  });
});

describe('Cmd/Ctrl+K paleti: URL yapıştırma', () => {
  it('aynı host, port ve kullanıcıya giden bağlantılar; seçince URL’deki veritabanı hedef olur', async () => {
    const { user } = await setup();
    await user.keyboard('{Control>}k{/Control}');
    await user.paste('postgres://postgres:gizli@db.prod/raporlar');
    expect(within(palette()).queryByRole('group', { name: 'Hedefler' })).not.toBeInTheDocument();
    expect(options('Bu sunucuya giden mevcut bağlantı')).toEqual(['Prod / raporlarprod']);
    await user.keyboard('{Enter}');
    expect(within(header()).getByRole('heading')).toHaveTextContent('Prod / raporlar');
  });

  it('seçimde olmayan veritabanı Veritabanı seçimine eklenir ve panelde hedef görünür', async () => {
    const { user, fake } = await setup();
    await user.keyboard('{Control>}k{/Control}');
    await user.paste('postgres://postgres@db.prod/raporlar');
    await user.keyboard('{Enter}');
    expect(within(header()).getByRole('heading')).toHaveTextContent('Prod / raporlar');
    await user.click(screen.getByRole('button', { name: /^Prod/ }));
    expect(await within(panel()).findByRole('button', { name: 'raporlar' })).toHaveAttribute('aria-current', 'true');
    expect(fake.connections[1]!.databaseSelection.map((d) => d.database)).toEqual(['faturalar', 'raporlar']);
  });

  it('seçimde olan veritabanında seçime dokunulmaz', async () => {
    const { user, fake } = await setup();
    await user.keyboard('{Control>}k{/Control}');
    await user.paste('postgres://postgres@db.prod/faturalar');
    await user.keyboard('{Enter}');
    expect(within(header()).getByRole('heading')).toHaveTextContent('Prod / faturalar');
    expect(fake.requests).toEqual([]);
  });

  it('bağlı sunucuda olmayan veritabanı “sunucuda yok” notuyla gösterilir', async () => {
    const fake = twoConnections();
    fake.servers.set('b2', { databases: { faturalar: ['public'] } });
    const { user } = await setup(fake);
    await user.click(screen.getByRole('button', { name: /^Prod/ }));
    await user.click(within(panel()).getByRole('button', { name: 'Bağlan ve tüm veritabanlarını listele' }));
    await within(panel()).findByRole('list', { name: 'Görünür veritabanları' });
    await user.keyboard('{Control>}k{/Control}');
    await user.paste('postgres://postgres@db.prod/raporlar');
    expect(options('Bu sunucuya giden mevcut bağlantı')).toEqual(['Prod / raporlarprodsunucuda yok']);
  });

  it('“URL’den yeni bağlantı…” formu dolu açar', async () => {
    const { user } = await setup();
    await user.keyboard('{Control>}k{/Control}');
    await user.paste('postgresql://app:s%40cret@yeni.example:6432/uygulama');
    expect(within(palette()).queryByRole('group', { name: 'Bu sunucuya giden mevcut bağlantı' })).not.toBeInTheDocument();
    await user.click(within(group('Komutlar')).getByRole('option', { name: 'URL’den yeni bağlantı…' }));
    const f = within(screen.getByRole('form', { name: /bağlantı/i }));
    expect(f.getByLabelText('Host')).toHaveValue('yeni.example');
    expect(f.getByLabelText('Port')).toHaveValue('6432');
    expect(f.getByLabelText('Kullanıcı')).toHaveValue('app');
    expect(f.getByLabelText('Şifre')).toHaveValue('s@cret');
    expect(f.getByLabelText('Başlangıç veritabanı')).toHaveValue('uygulama');
    expect(f.getByLabelText('URL')).toHaveValue('');
  });

  it('geçersiz URL için tek satır hata', async () => {
    const { user } = await setup();
    await user.keyboard('{Control>}k{/Control}');
    await user.paste('postgres://a@h:99999/db');
    expect(within(palette()).getByRole('alert')).toHaveTextContent('Geçersiz URL: Geçersiz port “99999”; 1–65535 arasında olmalı');
    expect(within(palette()).queryAllByRole('option')).toEqual([]);
  });
});

describe('paleti açan düğmeler', () => {
  it('kenar çubuğundaki kısayol düğmesi ve hedef başlığındaki "hedefi değiştir ▾"', async () => {
    const { user } = await setup();
    await user.click(screen.getByRole('button', { name: 'Hızlı geçiş' }));
    expect(search()).toHaveFocus();
    await user.keyboard('{Escape}');
    await user.click(within(header()).getByRole('button', { name: 'hedefi değiştir ▾' }));
    expect(search()).toHaveFocus();
  });
});

describe('Cmd/Ctrl+K paleti: uygulamayla etkileşim', () => {
  it('başka bir pencere açıkken kısayol paleti açmaz', async () => {
    const { user } = await setup();
    await user.click(screen.getByRole('button', { name: 'Yeni klasör' }));
    await user.keyboard('{Control>}k{/Control}');
    expect(screen.queryByRole('dialog', { name: 'Hızlı geçiş' })).not.toBeInTheDocument();
  });

  it('Alt+Enter bağlantının kapalı klasörünü açar', async () => {
    const fake = twoConnections();
    fake.folders.push(folder('k1', 'Billing'));
    fake.connections[1]!.folderId = 'k1';
    const { user } = await setup(fake);
    await user.click(within(nav()).getByRole('button', { name: /Billing/ }));
    expect(within(nav()).queryByText('Prod', { selector: '.baglanti-adi' })).not.toBeInTheDocument();

    await user.keyboard('{Control>}k{/Control}');
    await user.type(search(), 'fatura');
    await user.keyboard('{Alt>}{Enter}{/Alt}');
    expect(within(nav()).getByText('Prod', { selector: '.baglanti-adi' })).toBeInTheDocument();
    expect(within(panel()).getByRole('button', { name: 'faturalar' })).toHaveFocus();
  });
});
