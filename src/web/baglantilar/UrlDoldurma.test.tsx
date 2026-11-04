import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { App } from '../App';
import { connection, createFakeConnections, folder, renderWithApi, type FakeConnections } from '../test/sahte-api';

const nav = () => screen.getByRole('navigation', { name: 'Bağlantılar' });
const form = () => screen.getByRole('form', { name: /bağlantı/i });

async function openNew(fake: FakeConnections = createFakeConnections()) {
  const user = userEvent.setup();
  renderWithApi(<App />, fake.api);
  await user.click(screen.getByRole('button', { name: 'Yeni bağlantı' }));
  return { user, fake, f: within(form()) };
}

describe('URL’den doldurma', () => {
  it('formun ilk alanı URL; yapıştırınca alanlar dolar, şifre şifre alanına gider, URL alanda kalmaz', async () => {
    const { user, fake, f } = await openNew();
    const fields = f.getAllByRole('textbox');
    expect(fields[0]).toHaveAccessibleName('URL');

    await user.click(f.getByLabelText('URL'));
    await user.paste('postgres://app:s%40cret@db.example:6432/uygulama');
    expect(f.getByLabelText('Host')).toHaveValue('db.example');
    expect(f.getByLabelText('Port')).toHaveValue('6432');
    expect(f.getByLabelText('Kullanıcı')).toHaveValue('app');
    expect(f.getByLabelText('Şifre')).toHaveValue('s@cret');
    expect(f.getByLabelText('Başlangıç veritabanı')).toHaveValue('uygulama');
    expect(f.getByLabelText('URL')).toHaveValue('');
    expect(f.getByRole('status')).toHaveTextContent('URL’den dolduruldu.');

    await user.type(f.getByLabelText('Ad'), 'Uygulama');
    await user.click(f.getByRole('button', { name: 'Kaydet' }));
    expect(fake.requests[0]?.body).toEqual({
      name: 'Uygulama',
      folderId: null,
      host: 'db.example',
      port: 6432,
      user: 'app',
      database: 'uygulama',
      envTag: null,
      color: null,
      savePassword: true,
      password: 's@cret',
      sslmode: 'prefer',
      sslrootcert: null,
      sslcert: null,
      sslkey: null,
    });
    expect(JSON.stringify(fake.requests)).not.toContain('postgres://');
    expect(fake.passwords.get(fake.connections[0]!.id)).toBe('s@cret');
  });

  it('Host alanına yapıştırılan URL de algılanır', async () => {
    const { user, f } = await openNew();
    await user.click(f.getByLabelText('Host'));
    await user.paste('postgresql://ro@replica.internal/analytics');
    expect(f.getByLabelText('Host')).toHaveValue('replica.internal');
    expect(f.getByLabelText('Kullanıcı')).toHaveValue('ro');
    expect(f.getByLabelText('Başlangıç veritabanı')).toHaveValue('analytics');
  });

  it('Host alanına düz host adı yapıştırmak normal çalışır', async () => {
    const { user, f } = await openNew();
    await user.click(f.getByLabelText('Host'));
    await user.paste('db.example');
    expect(f.getByLabelText('Host')).toHaveValue('db.example');
    expect(f.queryByRole('status')).not.toBeInTheDocument();
  });

  it('portsuz URL portu varsayılana çeker; URL’de olmayan alanlara dokunmaz', async () => {
    const { user, f } = await openNew();
    await user.type(f.getByLabelText('Ad'), 'Elle');
    await user.clear(f.getByLabelText('Port'));
    await user.type(f.getByLabelText('Port'), '7000');
    await user.click(f.getByLabelText('URL'));
    await user.paste('postgres://db.example');
    expect(f.getByLabelText('Ad')).toHaveValue('Elle');
    expect(f.getByLabelText('Port')).toHaveValue('5432');
    expect(f.getByLabelText('Başlangıç veritabanı')).toHaveValue('postgres');
  });

  it('yok sayılan parametreler listelenir; SSL parametreleri SSL/TLS alanlarına dolar ve kaydedilir', async () => {
    const { user, fake, f } = await openNew();
    await user.click(f.getByLabelText('URL'));
    await user.paste(
      'postgres://u@h/db?sslmode=verify-full&sslrootcert=/ca.pem&sslcert=/c.crt&sslkey=/c.key&application_name=x&connect_timeout=3',
    );
    expect(f.getByRole('status')).toHaveTextContent('Yok sayıldı: application_name, connect_timeout');

    const ssl = within(screen.getByRole('group', { name: 'SSL/TLS' }));
    expect(ssl.getByRole('button', { name: /SSL\/TLS/ })).toHaveTextContent('verify-full');
    await user.click(ssl.getByRole('button', { name: /SSL\/TLS/ }));
    expect(ssl.getByLabelText('sslmode')).toHaveValue('verify-full');
    expect(ssl.getByLabelText('CA dosyası')).toHaveValue('/ca.pem');
    expect(ssl.getByLabelText('İstemci sertifikası')).toHaveValue('/c.crt');
    expect(ssl.getByLabelText('İstemci anahtarı')).toHaveValue('/c.key');

    await user.type(f.getByLabelText('Ad'), 'A');
    await user.click(f.getByRole('button', { name: 'Kaydet' }));
    expect(fake.requests[0]?.body).toMatchObject({
      sslmode: 'verify-full',
      sslrootcert: '/ca.pem',
      sslcert: '/c.crt',
      sslkey: '/c.key',
    });
  });

  it.each([
    ['başka şema', 'mysql://root@localhost/db', /postgres:\/\//],
    ['çok host', 'postgres://h1,h2/db', /birden çok host/i],
    ['geçersiz sslmode', 'postgres://h/db?sslmode=sometimes', /sslmode/],
  ])('reddedilen URL (%s) nedeniyle gösterilir, alanlar değişmez', async (_, url, reason) => {
    const { user, f } = await openNew();
    await user.click(f.getByLabelText('URL'));
    await user.paste(url);
    expect(f.getByLabelText('URL')).toHaveAccessibleDescription(reason);
    expect(f.getByLabelText('URL')).toHaveAttribute('aria-invalid', 'true');
    expect(f.getByLabelText('Host')).toHaveValue('');
  });

  it('URL alanına yazıp Enter’a basmak da doldurur ve formu göndermez', async () => {
    const { user, fake, f } = await openNew();
    await user.type(f.getByLabelText('URL'), 'postgres://u@yazilan.example{Enter}');
    expect(f.getByLabelText('Host')).toHaveValue('yazilan.example');
    expect(fake.requests).toEqual([]);
  });

  it('kayıtlı şifresi olan bağlantıda URL’deki şifre "değiştir" alanına gelir', async () => {
    const fake = createFakeConnections([connection({ id: 'b1', name: 'Dev' })]);
    fake.passwords.set('b1', 'eski');
    const user = userEvent.setup();
    renderWithApi(<App />, fake.api);
    await user.click(await within(nav()).findByRole('button', { name: /Dev/ }));
    const f = within(form());
    await f.findByText(/keychain'de kayıtlı/);
    await user.click(f.getByLabelText('URL'));
    await user.paste('postgres://postgres:yeni@localhost/postgres');
    expect(f.getByLabelText('Şifre')).toHaveValue('yeni');
    await user.click(f.getByRole('button', { name: 'Kaydet' }));
    expect(fake.passwords.get('b1')).toBe('yeni');
  });
});

describe('formda klasör', () => {
  it('klasör seçilerek kaydedilir; düzenlerken mevcut klasör seçili gelir', async () => {
    const fake = createFakeConnections([], {}, [folder('k1', 'Billing')]);
    const { user, f } = await openNew(fake);
    expect(f.getByLabelText('Klasör')).toHaveValue('');
    await user.selectOptions(f.getByLabelText('Klasör'), 'Billing');
    await user.type(f.getByLabelText('Ad'), 'A');
    await user.type(f.getByLabelText('Host'), 'h');
    await user.type(f.getByLabelText('Kullanıcı'), 'u');
    await user.click(f.getByRole('button', { name: 'Kaydet' }));
    expect(fake.requests[0]?.body).toMatchObject({ folderId: 'k1' });

    await user.click(await within(nav()).findByRole('button', { name: /^A/ }));
    expect(within(form()).getByLabelText('Klasör')).toHaveValue('k1');
  });
});

describe('URL ve klasör: inceleme düzeltmeleri', () => {
  it('Host alanına yapıştırılıp reddedilen URL, hatasıyla URL alanında görünür', async () => {
    const { user, f } = await openNew();
    await user.click(f.getByLabelText('Host'));
    await user.paste('postgres://h1,h2/db');
    expect(f.getByLabelText('Host')).toHaveValue('');
    expect(f.getByLabelText('URL')).toHaveValue('postgres://h1,h2/db');
    expect(f.getByLabelText('URL')).toHaveAccessibleDescription(/birden çok host/i);
  });

  it('form açıkken menüden taşınan bağlantı, formda kaydedilince yeni klasöründe kalır', async () => {
    const fake = createFakeConnections([connection({ id: 'b1', name: 'Dev', folderId: null })], {}, [folder('k1', 'Billing')]);
    const user = userEvent.setup();
    renderWithApi(<App />, fake.api);
    await user.click(await within(nav()).findByRole('button', { name: /Dev/ }));
    const li = within(nav()).getByText('Dev', { selector: '.baglanti-adi' }).closest('li')!;
    await user.click(within(li).getByRole('button', { name: 'Bağlantı menüsü' }));
    await user.click(screen.getByRole('menuitem', { name: /Klasöre taşı/ }));
    await user.click(screen.getByRole('menuitem', { name: 'Billing' }));
    await within(form()).findByDisplayValue('Billing');
    await user.click(within(form()).getByRole('button', { name: 'Kaydet' }));
    expect(fake.requests.at(-1)?.body).toMatchObject({ folderId: 'k1' });
  });
});
