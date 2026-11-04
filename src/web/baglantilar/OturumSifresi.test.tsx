import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { App } from '../App';
import { connection, createFakeConnections, renderWithApi, type FakeConnections } from '../test/sahte-api';

const nav = () => screen.getByRole('navigation', { name: 'Bağlantılar' });
const panel = () => screen.getByRole('region', { name: 'Veritabanları' });
const dialog = () => screen.getByRole('dialog', { name: /şifresi/ });

/** Keychain'e kaydedilmeyen, şifre isteyen sunucuya giden prod bağlantısı. */
function sessionFake(): FakeConnections {
  const fake = createFakeConnections([
    connection({ name: 'Prod', host: 'db.example.com', user: 'deploy', envTag: 'prod', color: '#dc2626', savePassword: false }),
  ]);
  fake.servers.set('b1', { databases: { postgres: ['public'], app: ['public'] }, password: 'gizli' });
  return fake;
}

async function setup(fake = sessionFake()) {
  const user = userEvent.setup();
  renderWithApi(<App />, fake.api);
  await user.click(await within(nav()).findByRole('button', { name: /Prod/ }));
  const connect = () => user.click(within(panel()).getByRole('button', { name: 'Bağlan ve tüm veritabanlarını listele' }));
  return { user, fake, connect };
}

describe('Oturumluk şifre penceresi', () => {
  it('ilk bağlanmada bağlantının adı, rengi ve kullanıcı@host ile açılır; girilen şifreyle bağlanır', async () => {
    const { user, fake, connect } = await setup();
    await connect();

    const d = within(await screen.findByRole('dialog', { name: /Prod/ }));
    expect(d.getByText('deploy@db.example.com')).toBeInTheDocument();
    expect(d.getByText('Tezgah kapanana kadar bellekte tutulur, diske yazılmaz.')).toBeInTheDocument();
    expect(d.getByLabelText("Keychain'e kaydet (bağlantı ayarını değiştirir)")).not.toBeChecked();
    expect(dialog().querySelector('.ortam-noktasi')).toHaveStyle({ backgroundColor: '#dc2626' });

    await user.type(d.getByLabelText('Şifre'), 'gizli');
    await user.click(d.getByRole('button', { name: 'Bağlan' }));

    expect(await within(panel()).findByRole('heading', { name: 'Gizli (1)' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(fake.sessionPasswords.get('b1')).toBe('gizli');
    expect(fake.passwords.has('b1')).toBe(false);
  });

  it('sunucu şifreyi reddedince (28P01) pencere nedeniyle yeniden açılır', async () => {
    const { user, connect } = await setup();
    await connect();
    await user.type(within(dialog()).getByLabelText('Şifre'), 'yanlis');
    await user.click(within(dialog()).getByRole('button', { name: 'Bağlan' }));

    const d = within(await screen.findByRole('dialog', { name: /Prod/ }));
    expect(await d.findByRole('alert')).toHaveTextContent('Şifre kabul edilmedi');
    expect(d.getByLabelText('Şifre')).toHaveValue('');
    await user.type(d.getByLabelText('Şifre'), 'gizli');
    await user.click(d.getByRole('button', { name: 'Bağlan' }));
    expect(await within(panel()).findByRole('heading', { name: 'Gizli (1)' })).toBeInTheDocument();
  });

  it('bağlantı kesilip yeniden açılınca şifre sorulmaz', async () => {
    const { user, connect } = await setup();
    await connect();
    await user.type(within(dialog()).getByLabelText('Şifre'), 'gizli');
    await user.click(within(dialog()).getByRole('button', { name: 'Bağlan' }));
    await within(panel()).findByRole('heading', { name: 'Gizli (1)' });

    await user.click(within(panel()).getByRole('button', { name: 'Bağlantı menüsü' }));
    await user.click(screen.getByRole('menuitem', { name: 'Bağlantıyı kes' }));
    await connect();
    expect(await within(panel()).findByRole('heading', { name: 'Gizli (1)' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('İptal edilince panelde hata kalır; "Tekrar dene" pencereyi yeniden açar', async () => {
    const { user, connect } = await setup();
    await connect();
    await user.click(within(dialog()).getByRole('button', { name: 'İptal' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(within(panel()).getByRole('alert')).toHaveTextContent('şifre girilmedi');
    await user.click(within(panel()).getByRole('button', { name: 'Tekrar dene' }));
    expect(await screen.findByRole('dialog', { name: /Prod/ })).toBeInTheDocument();
  });

  it("\"Keychain'e kaydet\" seçilirse şifre keychain'e yazılır ve bağlantı ayarı değişir", async () => {
    const { user, fake, connect } = await setup();
    await connect();
    await user.type(within(dialog()).getByLabelText('Şifre'), 'gizli');
    await user.click(within(dialog()).getByLabelText("Keychain'e kaydet (bağlantı ayarını değiştirir)"));
    await user.click(within(dialog()).getByRole('button', { name: 'Bağlan' }));

    await within(panel()).findByRole('heading', { name: 'Gizli (1)' });
    expect(fake.passwords.get('b1')).toBe('gizli');
    expect(fake.connections[0]!.savePassword).toBe(true);
  });

  it('keychain reddederse şifre bellekte kalır ve bunu söyleyen uyarı görünür', async () => {
    const { user, fake, connect } = await setup();
    fake.deny = true;
    await connect();
    await user.type(within(dialog()).getByLabelText('Şifre'), 'gizli');
    await user.click(within(dialog()).getByLabelText("Keychain'e kaydet (bağlantı ayarını değiştirir)"));
    await user.click(within(dialog()).getByRole('button', { name: 'Bağlan' }));

    await within(panel()).findByRole('heading', { name: 'Gizli (1)' });
    expect(screen.getByText(/keychain'e kaydedilemedi.*bellekte tutuluyor/)).toBeInTheDocument();
    expect(fake.connections[0]!.savePassword).toBe(false);
  });

  it("şifresi keychain'e kaydedilen bağlantıda pencere açılmaz, hata panelde görünür", async () => {
    const fake = createFakeConnections([connection({ name: 'Prod', savePassword: true })]);
    fake.servers.set('b1', { databases: { postgres: ['public'] }, password: 'gizli' });
    const { connect } = await setup(fake);
    await connect();

    expect(await within(panel()).findByRole('alert')).toHaveTextContent('şifre girilmedi');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('şema listesinde şifre reddedilirse pencere açılır ve şemalar yeni şifreyle gelir', async () => {
    const { user, fake, connect } = await setup();
    await connect();
    await user.type(within(dialog()).getByLabelText('Şifre'), 'gizli');
    await user.click(within(dialog()).getByRole('button', { name: 'Bağlan' }));
    await within(panel()).findByRole('heading', { name: 'Gizli (1)' });

    // Şifre sunucuda değişti.
    fake.servers.get('b1')!.password = 'yeni';
    await user.click(within(panel()).getByRole('button', { name: 'postgres şemaları' }));
    const d = within(await screen.findByRole('dialog', { name: /Prod/ }));
    expect(d.getByRole('alert')).toHaveTextContent('Şifre kabul edilmedi');
    await user.type(d.getByLabelText('Şifre'), 'yeni');
    await user.click(d.getByRole('button', { name: 'Bağlan' }));
    expect(await within(panel()).findByRole('group', { name: 'postgres şemaları' })).toBeInTheDocument();
  });
});
