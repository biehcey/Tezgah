import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { App } from '../App';
import { connection, createFakeConnections, renderWithApi, type FakeConnections } from '../test/sahte-api';

function renderApp(fake = createFakeConnections()) {
  renderWithApi(<App />, fake.api);
  return fake;
}

const nav = () => screen.getByRole('navigation', { name: 'Bağlantılar' });

describe('bağlantı listesi', () => {
  it('her satırda ortam rengi, ad ve kullanıcı@host[:port] görünür', async () => {
    renderApp(
      createFakeConnections([
        connection({ id: 'a', name: 'Yerel', user: 'postgres', host: 'localhost', envTag: 'local', color: '#64748b' }),
        connection({ id: 'b', name: 'Analitik', user: 'app', host: 'db.example', port: 6432 }),
      ]),
    );
    const rows = await within(nav()).findAllByRole('button', { name: /@/ });
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining('Yerel'),
      expect.stringContaining('Analitik'),
    ]);
    expect(rows[0]).toHaveTextContent('postgres@localhost');
    expect(rows[0]).not.toHaveTextContent(':5432');
    expect(rows[1]).toHaveTextContent('app@db.example:6432');
    expect(within(rows[0]!).getByTestId('ortam-noktasi')).toHaveStyle({ backgroundColor: '#64748b' });
  });

  it('prod bağlantı kırmızı sol şeritle ayrışır', async () => {
    renderApp(
      createFakeConnections([
        connection({ id: 'a', name: 'Dev', envTag: 'dev', color: '#16a34a' }),
        connection({ id: 'b', name: 'Prod', envTag: 'prod', color: '#dc2626' }),
      ]),
    );
    const prod = await within(nav()).findByRole('button', { name: /Prod/ });
    const dev = within(nav()).getByRole('button', { name: /Dev/ });
    expect(prod).toHaveAttribute('data-ortam', 'prod');
    expect(prod).toHaveClass('prod-serit');
    expect(dev).not.toHaveClass('prod-serit');
  });

  it('bağlantı yokken boş liste mesajı gösterir', async () => {
    renderApp();
    expect(await within(nav()).findByText(/Henüz bağlantı yok/)).toBeInTheDocument();
  });

  it('kenar çubuğu başlığında yeni bağlantı düğmesi var', async () => {
    renderApp();
    expect(screen.getByRole('button', { name: 'Yeni bağlantı' })).toBeInTheDocument();
  });
});

const form = () => screen.getByRole('form', { name: /bağlantı/i });

describe('yeni bağlantı formu', () => {
  it('doldurulan bağlantı test istenmeden kaydedilir ve listede görünür', async () => {
    const user = userEvent.setup();
    const fake = renderApp();
    await user.click(screen.getByRole('button', { name: 'Yeni bağlantı' }));
    const f = within(form());
    expect(f.getByLabelText('Başlangıç veritabanı')).toHaveValue('postgres');
    expect(f.getByLabelText('Port')).toHaveValue('5432');
    expect(f.getByLabelText("Keychain'e kaydet")).toBeChecked();

    await user.type(f.getByLabelText('Ad'), 'Staging API');
    await user.type(f.getByLabelText('Host'), 'stg.example');
    await user.clear(f.getByLabelText('Port'));
    await user.type(f.getByLabelText('Port'), '6543');
    await user.type(f.getByLabelText('Kullanıcı'), 'api');
    await user.type(f.getByLabelText('Şifre'), 's3cret');
    await user.clear(f.getByLabelText('Başlangıç veritabanı'));
    await user.type(f.getByLabelText('Başlangıç veritabanı'), 'api_db');
    await user.click(f.getByRole('radio', { name: 'staging' }));
    await user.click(f.getByRole('button', { name: 'Kaydet' }));

    expect(fake.requests).toEqual([
      {
        method: 'POST',
        body: {
          name: 'Staging API',
          folderId: null,
          host: 'stg.example',
          port: 6543,
          user: 'api',
          database: 'api_db',
          envTag: 'staging',
          color: '#d97706',
          savePassword: true,
          password: 's3cret',
          sslmode: 'prefer',
          sslrootcert: null,
          sslcert: null,
          sslkey: null,
        },
      },
    ]);
    expect(await within(nav()).findByRole('button', { name: /Staging API/ })).toHaveTextContent('api@stg.example:6543');
    expect(screen.queryByRole('form', { name: /bağlantı/i })).not.toBeInTheDocument();
  });
});

describe('ortam etiketi ve renk', () => {
  async function openNew() {
    const user = userEvent.setup();
    const fake = renderApp();
    await user.click(screen.getByRole('button', { name: 'Yeni bağlantı' }));
    return { user, fake, f: within(form()) };
  }

  it('sabit küme çipleriyle seçilir; varsayılan etiketsiz ve renk kapalı', async () => {
    const { f } = await openNew();
    const chips = within(f.getByRole('radiogroup', { name: 'Ortam etiketi' })).getAllByRole('radio');
    expect(chips.map((c) => c.closest('label')?.textContent)).toEqual(['yok', 'local', 'dev', 'test', 'staging', 'prod']);
    expect(f.getByRole('radio', { name: 'yok' })).toBeChecked();
    expect(f.getByLabelText('Renk')).toBeDisabled();
  });

  it('prod seçilince form kırmızı çerçeveli olur, başka etikete geçince kalkar', async () => {
    const { user, f } = await openNew();
    await user.click(f.getByRole('radio', { name: 'prod' }));
    expect(form()).toHaveClass('prod-cerceve');
    expect(form()).toHaveAttribute('data-ortam', 'prod');
    await user.click(f.getByRole('radio', { name: 'dev' }));
    expect(form()).not.toHaveClass('prod-cerceve');
  });

  it('seçilen renk kaydedilir', async () => {
    const { user, fake, f } = await openNew();
    await user.type(f.getByLabelText('Ad'), 'A');
    await user.type(f.getByLabelText('Host'), 'h');
    await user.type(f.getByLabelText('Kullanıcı'), 'u');
    await user.click(f.getByRole('radio', { name: 'test' }));
    expect(f.getByLabelText('Renk')).toHaveValue('#0891b2');
    // jsdom renk seçicisini açamaz; değer değişikliği doğrudan verilir.
    fireEvent.input(f.getByLabelText('Renk'), { target: { value: '#ff00aa' } });
    await user.click(f.getByRole('button', { name: 'Kaydet' }));
    expect(fake.requests[0]?.body).toMatchObject({ envTag: 'test', color: '#ff00aa' });
  });
});

describe('form doğrulaması', () => {
  it('eksik alanlar istek gönderilmeden alanın yanında gösterilir', async () => {
    const user = userEvent.setup();
    const fake = renderApp();
    await user.click(screen.getByRole('button', { name: 'Yeni bağlantı' }));
    const f = within(form());
    await user.clear(f.getByLabelText('Port'));
    await user.type(f.getByLabelText('Port'), 'abc');
    await user.click(f.getByRole('button', { name: 'Kaydet' }));
    expect(fake.requests).toEqual([]);
    expect(f.getByLabelText('Ad')).toHaveAccessibleDescription('Ad gerekli');
    expect(f.getByLabelText('Host')).toHaveAttribute('aria-invalid', 'true');
    expect(f.getByLabelText('Port')).toHaveAccessibleDescription(/1–65535/);
  });
});

describe('bağlantı düzenleme ve keychain', () => {
  const saved = connection({ id: 'b1', name: 'Dev DB', host: 'dev.example', user: 'app', envTag: 'dev', color: '#16a34a' });

  async function openEdit(setup: (fake: FakeConnections) => void = () => {}) {
    const user = userEvent.setup();
    const fake = createFakeConnections([saved]);
    setup(fake);
    renderApp(fake);
    await user.click(await within(nav()).findByRole('button', { name: /Dev DB/ }));
    return { user, fake, f: within(form()) };
  }

  it('kayıtlı şifre varsa alan yerine "keychain\'de kayıtlı · değiştir" görünür ve şifre gönderilmez', async () => {
    const { user, fake, f } = await openEdit((fake) => fake.passwords.set('b1', 'eski'));
    expect(await f.findByText(/keychain'de kayıtlı/)).toHaveTextContent("🔑 keychain'de kayıtlı · değiştir");
    expect(f.queryByLabelText('Şifre')).not.toBeInTheDocument();
    expect(f.getByLabelText('Ad')).toHaveValue('Dev DB');

    await user.clear(f.getByLabelText('Ad'));
    await user.type(f.getByLabelText('Ad'), 'Dev 2');
    await user.click(f.getByRole('button', { name: 'Kaydet' }));
    expect(fake.requests).toHaveLength(1);
    expect(fake.requests[0]).toMatchObject({ method: 'PUT', id: 'b1' });
    expect(fake.requests[0]?.body).not.toHaveProperty('password');
    expect(fake.passwords.get('b1')).toBe('eski');
    expect(await within(nav()).findByRole('button', { name: /Dev 2/ })).toBeInTheDocument();
  });

  it('"değiştir" ile yeni şifre girilir ve kaydedilir', async () => {
    const { user, fake, f } = await openEdit((fake) => fake.passwords.set('b1', 'eski'));
    await user.click(await f.findByRole('button', { name: 'değiştir' }));
    await user.type(f.getByLabelText('Şifre'), 'yeni');
    await user.click(f.getByRole('button', { name: 'Kaydet' }));
    expect(fake.requests[0]?.body).toMatchObject({ password: 'yeni' });
    expect(fake.passwords.get('b1')).toBe('yeni');
  });

  it('kayıtlı şifre yoksa boş şifre alanı görünür, uyarı yok', async () => {
    const { f } = await openEdit();
    expect(await f.findByLabelText('Şifre')).toHaveValue('');
    expect(f.queryByText(/reddedildi/)).not.toBeInTheDocument();
  });

  it('keychain erişimi reddedilince "sır yok"tan ayrı bir mesaj gösterilir', async () => {
    const { f } = await openEdit((fake) => {
      fake.passwords.set('b1', 'eski');
      fake.deny = true;
    });
    expect(await f.findByText(/Keychain'e erişilemedi/)).toBeInTheDocument();
    expect(f.queryByText(/keychain'de kayıtlı/)).not.toBeInTheDocument();
  });

  it('kaydederken keychain reddederse bağlantının kaydedildiği ama şifrenin yazılamadığı söylenir', async () => {
    const user = userEvent.setup();
    const fake = renderApp();
    fake.deny = true;
    await user.click(screen.getByRole('button', { name: 'Yeni bağlantı' }));
    const f = within(form());
    await user.type(f.getByLabelText('Ad'), 'Yeni');
    await user.type(f.getByLabelText('Host'), 'h');
    await user.type(f.getByLabelText('Kullanıcı'), 'u');
    await user.type(f.getByLabelText('Şifre'), 'p');
    await user.click(f.getByRole('button', { name: 'Kaydet' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /kaydedildi ama keychain'deki şifre güncellenemedi: keychain'e erişilemedi/,
    );
  });

  it('"Keychain\'e kaydet" kapatılınca şifre alanı yerine bellekte tutulacağı uyarısı görünür', async () => {
    const { user, fake, f } = await openEdit((fake) => fake.passwords.set('b1', 'eski'));
    await f.findByText(/keychain'de kayıtlı/);
    await user.click(f.getByLabelText("Keychain'e kaydet"));
    expect(f.getByText(/her açılışta ilk bağlanmada sorulur, yalnızca bellekte/)).toBeInTheDocument();
    expect(f.queryByLabelText('Şifre')).not.toBeInTheDocument();
    await user.click(f.getByRole('button', { name: 'Kaydet' }));
    expect(fake.requests[0]?.body).toMatchObject({ savePassword: false });
    expect(fake.passwords.has('b1')).toBe(false);
  });

  it('iptal formu kaydetmeden kapatır', async () => {
    const { user, fake, f } = await openEdit();
    await user.type(f.getByLabelText('Ad'), 'x');
    await user.click(f.getByRole('button', { name: 'İptal' }));
    expect(screen.queryByRole('form', { name: /bağlantı/i })).not.toBeInTheDocument();
    expect(fake.requests).toEqual([]);
  });
});

describe('bağlantı silme', () => {
  async function openDelete(setup: (fake: FakeConnections) => void = () => {}) {
    const user = userEvent.setup();
    const fake = createFakeConnections([
      connection({ id: 'b1', name: 'Silinecek' }),
      connection({ id: 'b2', name: 'Kalan' }),
    ]);
    fake.passwords.set('b1', 'p');
    setup(fake);
    renderApp(fake);
    await user.click(await within(nav()).findByRole('button', { name: /Silinecek/ }));
    await user.click(within(form()).getByRole('button', { name: 'Sil' }));
    return { user, fake, dialog: screen.getByRole('alertdialog') };
  }

  it('onay penceresi neyin silineceğini ve geri alınamayacağını söyler', async () => {
    const { dialog } = await openDelete();
    expect(dialog).toHaveAccessibleName('“Silinecek” silinsin mi?');
    expect(dialog).toHaveAccessibleDescription(
      "Bağlantının ayarı ve keychain'deki sırları silinir. Çalıştırma kayıtları kalır. Bu işlem geri alınamaz.",
    );
  });

  it('vazgeçilince hiçbir şey silinmez', async () => {
    const { user, fake, dialog } = await openDelete();
    await user.click(within(dialog).getByRole('button', { name: 'Vazgeç' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(fake.requests).toEqual([]);
  });

  it('onaylanınca bağlantı ve şifresi silinir, listeden kalkar', async () => {
    const { user, fake, dialog } = await openDelete();
    await user.click(within(dialog).getByRole('button', { name: 'Sil' }));
    await waitFor(() => expect(within(nav()).getAllByRole('button', { name: /@/ })).toHaveLength(1));
    expect(within(nav()).getByRole('button', { name: /Kalan/ })).toBeInTheDocument();
    expect(fake.requests).toEqual([{ method: 'DELETE', id: 'b1' }]);
    expect(fake.passwords.has('b1')).toBe(false);
    expect(screen.queryByRole('form', { name: /bağlantı/i })).not.toBeInTheDocument();
  });

  it('keychain reddederse bağlantı silinir ama şifrenin keychain\'de kaldığı söylenir', async () => {
    const { user, dialog } = await openDelete((fake) => (fake.deny = true));
    await user.click(within(dialog).getByRole('button', { name: 'Sil' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/silindi ama keychain'e erişilemediği için şifresi keychain'de kaldı/);
  });
});

describe('kayıtlı şifreyi koruma', () => {
  const saved = connection({ id: 'b1', name: 'Dev DB' });

  async function openEdit(fake: FakeConnections) {
    const user = userEvent.setup();
    renderApp(fake);
    await user.click(await within(nav()).findByRole('button', { name: /Dev DB/ }));
    return { user, f: within(form()) };
  }

  it('"değiştir" deyip alanı boş bırakmak kayıtlı şifreyi silmez', async () => {
    const fake = createFakeConnections([saved]);
    fake.passwords.set('b1', 'eski');
    const { user, f } = await openEdit(fake);
    await user.click(await f.findByRole('button', { name: 'değiştir' }));
    await user.click(f.getByRole('button', { name: 'Kaydet' }));
    expect(fake.requests[0]?.body).not.toHaveProperty('password');
    expect(fake.passwords.get('b1')).toBe('eski');
  });

  it('şifre durumu alınamazsa "sır yok" gibi değil ayrı bir mesajla gösterilir', async () => {
    const fake = createFakeConnections([saved], { passwordStatus: () => Promise.reject(new Error('ağ')) });
    const { f } = await openEdit(fake);
    expect(await f.findByText(/Keychain durumu alınamadı/)).toBeInTheDocument();
  });

  it('keychain\'den silme reddedilince "yazılamadı" değil "güncellenemedi" denir', async () => {
    const fake = createFakeConnections([saved]);
    fake.passwords.set('b1', 'eski');
    const { user, f } = await openEdit(fake);
    await f.findByText(/keychain'de kayıtlı/);
    fake.deny = true;
    await user.click(f.getByLabelText("Keychain'e kaydet"));
    await user.click(f.getByRole('button', { name: 'Kaydet' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/kaydedildi ama keychain'deki şifre güncellenemedi/);
    expect(alert).not.toHaveTextContent(/yazılamadı/);
  });
});
