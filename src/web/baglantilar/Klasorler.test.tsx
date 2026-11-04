import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { App } from '../App';
import { connection, createFakeConnections, folder, renderWithApi, type FakeConnections } from '../test/sahte-api';

const nav = () => screen.getByRole('navigation', { name: 'Bağlantılar' });
const section = (name: string) => within(nav()).getByRole('region', { name });
const rowNames = (region: HTMLElement) =>
  within(region)
    .queryAllByRole('listitem')
    .map((li) => li.querySelector('.baglanti-adi')?.textContent);

/** Satırdaki ⋯ düğmesi. */
const menuButton = (name: string) =>
  within(within(nav()).getByText(name, { selector: '.baglanti-adi' }).closest('li')!).getByRole('button', {
    name: 'Bağlantı menüsü',
  });

function setup(fake: FakeConnections) {
  const user = userEvent.setup();
  renderWithApi(<App />, fake.api);
  return { user, fake };
}

function withFolders() {
  return createFakeConnections(
    [
      connection({ id: 'a', name: 'Fatura Prod', folderId: 'k1' }),
      connection({ id: 'b', name: 'Fatura Dev', folderId: 'k1' }),
      connection({ id: 'c', name: 'Yerel', folderId: null }),
    ],
    {},
    [folder('k1', 'Billing'), folder('k2', 'Boş')],
  );
}

describe('klasörlü liste', () => {
  it('klasörler bağlantı sayılı bölümler, en altta Klasörsüz', async () => {
    setup(withFolders());
    await within(nav()).findByText('Fatura Prod');
    const regions = within(nav()).getAllByRole('region');
    expect(regions.map((r) => r.getAttribute('aria-label'))).toEqual(['Billing', 'Boş', 'Klasörsüz']);
    expect(within(regions[0]!).getByRole('button', { name: /Billing/, expanded: true })).toHaveTextContent('2');
    expect(within(regions[1]!).getByRole('button', { name: /Boş/ })).toHaveTextContent('0');
    expect(rowNames(regions[0]!)).toEqual(['Fatura Prod', 'Fatura Dev']);
    expect(rowNames(regions[2]!)).toEqual(['Yerel']);
  });

  it('klasör başlığı katlanır ve açılır', async () => {
    const { user } = setup(withFolders());
    await within(nav()).findByText('Fatura Prod');
    const header = within(section('Billing')).getByRole('button', { name: /Billing/ });
    await user.click(header);
    expect(header).toHaveAttribute('aria-expanded', 'false');
    expect(within(nav()).queryByText('Fatura Prod')).not.toBeInTheDocument();
    expect(header).toHaveTextContent('2');
    await user.click(header);
    expect(within(nav()).getByText('Fatura Prod')).toBeInTheDocument();
  });

  it('klasör yokken bölüm başlığı olmadan düz liste görünür', async () => {
    setup(createFakeConnections([connection({ name: 'Tek' })]));
    await within(nav()).findByText('Tek');
    expect(within(nav()).queryByRole('region')).not.toBeInTheDocument();
  });
});

describe('klasör işlemleri', () => {
  it('başlıktaki düğmeyle klasör oluşturulur', async () => {
    const { user, fake } = setup(createFakeConnections([connection({ name: 'Yerel' })]));
    await within(nav()).findByText('Yerel');
    await user.click(screen.getByRole('button', { name: 'Yeni klasör' }));
    const dialog = screen.getByRole('dialog', { name: 'Yeni klasör' });
    await user.type(within(dialog).getByLabelText('Klasör adı'), 'Müşteri A{Enter}');
    expect(await within(nav()).findByRole('region', { name: 'Müşteri A' })).toBeInTheDocument();
    expect(fake.folders).toEqual([{ id: expect.any(String), name: 'Müşteri A' }]);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('aynı adlı klasör hatası pencerede gösterilir, pencere açık kalır', async () => {
    const { user } = setup(withFolders());
    await within(nav()).findByText('Yerel');
    await user.click(screen.getByRole('button', { name: 'Yeni klasör' }));
    const dialog = screen.getByRole('dialog', { name: 'Yeni klasör' });
    await user.type(within(dialog).getByLabelText('Klasör adı'), 'billing');
    await user.click(within(dialog).getByRole('button', { name: 'Oluştur' }));
    expect(await within(dialog).findByText(/zaten var/)).toBeInTheDocument();
  });

  it('başlıkta sağ tıkla yeniden adlandırılır', async () => {
    const { user, fake } = setup(withFolders());
    await within(nav()).findByText('Yerel');
    fireEvent.contextMenu(within(section('Billing')).getByRole('button', { name: /Billing/ }));
    await user.click(screen.getByRole('menuitem', { name: 'Yeniden adlandır' }));
    const input = within(screen.getByRole('dialog', { name: 'Klasörü yeniden adlandır' })).getByLabelText('Klasör adı');
    expect(input).toHaveValue('Billing');
    await user.clear(input);
    await user.type(input, 'Faturalama{Enter}');
    expect(await within(nav()).findByRole('region', { name: 'Faturalama' })).toBeInTheDocument();
    expect(fake.folders[0]).toEqual({ id: 'k1', name: 'Faturalama' });
    expect(rowNames(section('Faturalama'))).toEqual(['Fatura Prod', 'Fatura Dev']);
  });

  it('silinen klasördeki bağlantılar silinmez, Klasörsüz bölümüne taşınır', async () => {
    const { user, fake } = setup(withFolders());
    await within(nav()).findByText('Yerel');
    fireEvent.contextMenu(within(section('Billing')).getByRole('button', { name: /Billing/ }));
    await user.click(screen.getByRole('menuitem', { name: 'Sil' }));
    const dialog = screen.getByRole('alertdialog', { name: '“Billing” klasörü silinsin mi?' });
    expect(dialog).toHaveAccessibleDescription('İçindeki 2 bağlantı silinmez, Klasörsüz bölümüne taşınır.');
    await user.click(within(dialog).getByRole('button', { name: 'Sil' }));
    await waitFor(() => expect(within(nav()).queryByRole('region', { name: 'Billing' })).not.toBeInTheDocument());
    expect(rowNames(section('Klasörsüz'))).toEqual(['Fatura Prod', 'Fatura Dev', 'Yerel']);
    expect(fake.connections.map((c) => c.folderId)).toEqual([null, null, null]);
  });

  it('son klasör silinince liste başlıksız düz listeye döner', async () => {
    const fake = createFakeConnections([connection({ name: 'İçeride', folderId: 'k1' })], {}, [folder('k1', 'Tek')]);
    const { user } = setup(fake);
    await within(nav()).findByText('İçeride');
    fireEvent.contextMenu(within(section('Tek')).getByRole('button', { name: /Tek/ }));
    await user.click(screen.getByRole('menuitem', { name: 'Sil' }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Sil' }));
    await waitFor(() => expect(within(nav()).queryByRole('region')).not.toBeInTheDocument());
    expect(within(nav()).getByText('İçeride')).toBeInTheDocument();
  });

  it('Escape menüyü kapatır', async () => {
    const { user } = setup(withFolders());
    await within(nav()).findByText('Yerel');
    fireEvent.contextMenu(within(section('Billing')).getByRole('button', { name: /Billing/ }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});

describe('bağlantıyı klasöre taşıma', () => {
  /** jsdom DataTransfer'ı desteklemez; sürükle-bırak boyunca paylaşılan basit bir taklit. */
  function dataTransfer() {
    const data = new Map<string, string>();
    return {
      setData: (type: string, value: string) => data.set(type, value),
      getData: (type: string) => data.get(type) ?? '',
      get types() {
        return [...data.keys()];
      },
      effectAllowed: 'all',
      dropEffect: 'none',
    };
  }

  it('sürükle-bırakla başka klasöre ve Klasörsüz’e taşınır', async () => {
    const { fake } = setup(withFolders());
    const row = await within(nav()).findByRole('button', { name: /Yerel/ });
    let dt = dataTransfer();
    fireEvent.dragStart(row, { dataTransfer: dt });
    fireEvent.dragOver(section('Boş'), { dataTransfer: dt });
    fireEvent.drop(section('Boş'), { dataTransfer: dt });
    await waitFor(() => expect(rowNames(section('Boş'))).toEqual(['Yerel']));
    expect(fake.requests.at(-1)).toMatchObject({ method: 'PUT', id: 'c', body: { folderId: 'k2', name: 'Yerel' } });
    expect(fake.requests.at(-1)?.body).not.toHaveProperty('password');

    dt = dataTransfer();
    fireEvent.dragStart(within(nav()).getByRole('button', { name: /Fatura Dev/ }), { dataTransfer: dt });
    fireEvent.drop(section('Klasörsüz'), { dataTransfer: dt });
    await waitFor(() => expect(rowNames(section('Klasörsüz'))).toEqual(['Fatura Dev']));
    expect(within(section('Billing')).getByRole('button', { name: /Billing/ })).toHaveTextContent('1');
  });

  it('aynı klasöre bırakmak istek göndermez', async () => {
    const { fake } = setup(withFolders());
    const row = await within(nav()).findByRole('button', { name: /Fatura Prod/ });
    const dt = dataTransfer();
    fireEvent.dragStart(row, { dataTransfer: dt });
    fireEvent.drop(section('Billing'), { dataTransfer: dt });
    expect(fake.requests).toEqual([]);
  });

  it('menüdeki "Klasöre taşı" ile taşınır; bulunduğu klasör seçilemez', async () => {
    const { user, fake } = setup(withFolders());
    await within(nav()).findByText('Fatura Prod');
    await user.click(menuButton('Fatura Prod'));
    await user.click(screen.getByRole('menuitem', { name: /Klasöre taşı/ }));
    const targets = screen.getAllByRole('menuitem');
    expect(targets.map((t) => t.textContent)).toEqual(['Billing', 'Boş', 'Klasörsüz']);
    expect(screen.getByRole('menuitem', { name: 'Billing' })).toBeDisabled();
    await user.click(screen.getByRole('menuitem', { name: 'Klasörsüz' }));
    await waitFor(() => expect(rowNames(section('Klasörsüz'))).toEqual(['Fatura Prod', 'Yerel']));
    expect(fake.connections[0]?.folderId).toBeNull();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});

describe('bağlantı menüsü', () => {
  it('sağ tık ve ⋯ aynı menüyü açar: hedef yap, bağlan, düzenle, kopyala, klasöre taşı, URL’yi kopyala, bağlantıyı kes, sil', async () => {
    const { user } = setup(withFolders());
    const row = await within(nav()).findByRole('button', { name: /Yerel/ });
    fireEvent.contextMenu(row);
    const items = () => screen.getAllByRole('menuitem').map((i) => i.textContent);
    const expected = [
      'Hedef yap',
      'Bağlan',
      'Düzenle',
      'Kopyala',
      'Klasöre taşı ▸',
      'URL’yi kopyala (şifresiz)',
      'Bağlantıyı kes',
      'Sil',
    ];
    expect(items()).toEqual(expected);
    await user.keyboard('{Escape}');
    await user.click(menuButton('Yerel'));
    expect(items()).toEqual(expected);
  });

  it('Düzenle formu açar, Sil onay penceresini açar', async () => {
    const { user } = setup(withFolders());
    fireEvent.contextMenu(await within(nav()).findByRole('button', { name: /Yerel/ }));
    await user.click(screen.getByRole('menuitem', { name: 'Düzenle' }));
    expect(screen.getByRole('form', { name: 'Bağlantıyı düzenle: Yerel' })).toBeInTheDocument();
    fireEvent.contextMenu(within(nav()).getByRole('button', { name: /Fatura Dev/ }));
    await user.click(screen.getByRole('menuitem', { name: 'Sil' }));
    expect(screen.getByRole('alertdialog', { name: '“Fatura Dev” silinsin mi?' })).toBeInTheDocument();
  });

  it('URL’yi şifresiz kopyalar', async () => {
    const fake = createFakeConnections([
      connection({ id: 'a', name: 'Analitik', user: 'app', host: 'db.example', port: 6432, database: 'analytics' }),
    ]);
    fake.passwords.set('a', 'gizli');
    const { user } = setup(fake);
    fireEvent.contextMenu(await within(nav()).findByRole('button', { name: /Analitik/ }));
    await user.click(screen.getByRole('menuitem', { name: 'URL’yi kopyala (şifresiz)' }));
    expect(await navigator.clipboard.readText()).toBe('postgres://app@db.example:6432/analytics');
    expect(await screen.findByRole('status')).toHaveTextContent('URL kopyalandı: postgres://app@db.example:6432/analytics');
  });
});

describe('bağlantı kopyalama', () => {
  it('hemen yanına "ad (kopya)" oluşur, şifre yeni kimliğe kopyalanır ve form açılır', async () => {
    const fake = withFolders();
    fake.passwords.set('a', 'gizli');
    const { user } = setup(fake);
    fireEvent.contextMenu(await within(nav()).findByRole('button', { name: /Fatura Prod/ }));
    await user.click(screen.getByRole('menuitem', { name: 'Kopyala' }));

    const f = await screen.findByRole('form', { name: 'Bağlantıyı düzenle: Fatura Prod (kopya)' });
    expect(rowNames(section('Billing'))).toEqual(['Fatura Prod', 'Fatura Prod (kopya)', 'Fatura Dev']);
    const copy = fake.connections[1]!;
    expect(copy).toMatchObject({ name: 'Fatura Prod (kopya)', folderId: 'k1' });
    expect(fake.passwords.get(copy.id)).toBe('gizli');
    expect(await within(f).findByText(/keychain'de kayıtlı/)).toBeInTheDocument();
    expect(within(nav()).getByRole('button', { name: /Fatura Prod \(kopya\)/ })).toHaveAttribute('aria-current', 'true');
  });

  it('keychain reddederse kopya oluşur ama şifrenin kopyalanamadığı söylenir', async () => {
    const fake = withFolders();
    fake.deny = true;
    const { user } = setup(fake);
    fireEvent.contextMenu(await within(nav()).findByRole('button', { name: /Yerel/ }));
    await user.click(screen.getByRole('menuitem', { name: 'Kopyala' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/“Yerel \(kopya\)” oluşturuldu ama şifre kopyalanamadı/);
  });
});
