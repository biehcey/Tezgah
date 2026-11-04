import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { ConnectionTestResponse, TestStep } from '../../core/baglanti-testi';
import { App } from '../App';
import type { ConnectionTestBody } from '../api/client';
import { editConnection } from '../test/eylemler';
import { connection, createFakeConnections, renderWithApi } from '../test/sahte-api';

const form = () => screen.getByRole('form', { name: /bağlantı/i });
const sslSection = () => within(screen.getByRole('group', { name: 'SSL/TLS' }));
const sslToggle = () => sslSection().getByRole('button', { name: /SSL\/TLS/ });

const step = (id: TestStep['id'], sonuc: TestStep['sonuc'], extra: Partial<TestStep> = {}): TestStep => ({
  id,
  sonuc,
  kod: null,
  mesaj: sonuc === 'calistirilmadi' ? '' : `${id} mesajı`,
  alan: null,
  oneriler: [],
  ...extra,
});

const tlsFailure = (extra: Partial<TestStep>): ConnectionTestResponse => ({
  adimlar: [
    step('ulasma', 'basarili'),
    step('tls', 'hata', extra),
    step('kimlik', 'calistirilmadi'),
    step('listeleme', 'calistirilmadi'),
  ],
  sunucu: null,
});

async function setup({
  existing,
  responses = [],
}: { existing?: ReturnType<typeof connection>; responses?: ConnectionTestResponse[] } = {}) {
  const user = userEvent.setup();
  const sent: ConnectionTestBody[] = [];
  const fake = createFakeConnections(existing ? [existing] : [], {
    async testConnection(body) {
      sent.push(body);
      return responses[Math.min(sent.length - 1, responses.length - 1)]!;
    },
  });
  if (existing) fake.passwords.set(existing.id, 'kayitli');
  renderWithApi(<App />, fake.api);
  if (existing) await editConnection(user, new RegExp(existing.name));
  else await user.click(screen.getByRole('button', { name: 'Yeni bağlantı' }));
  return { user, fake, sent, f: within(form()) };
}

describe('SSL/TLS bölümü', () => {
  it('kapalıyken tek satır özet gösterir; açınca sslmode ve modun açıklaması görünür', async () => {
    const { user } = await setup();
    expect(sslToggle()).toHaveAttribute('aria-expanded', 'false');
    expect(sslToggle()).toHaveTextContent('prefer');
    expect(sslSection().queryByLabelText('sslmode')).not.toBeInTheDocument();

    await user.click(sslToggle());
    expect(sslSection().getByLabelText('sslmode')).toHaveValue('prefer');
    expect(sslSection().getByText(/sunucu desteklemiyorsa şifresiz/i)).toBeInTheDocument();

    await user.selectOptions(sslSection().getByLabelText('sslmode'), 'verify-ca');
    expect(sslSection().getByText(/CA zinciri doğrulanır; host adı doğrulanmaz/)).toBeInTheDocument();
    expect(sslToggle()).toHaveTextContent('verify-ca');
  });

  it.each([
    ['disable', false, false],
    ['prefer', false, true],
    ['require', true, true],
    ['verify-ca', true, true],
    ['verify-full', true, true],
  ] as const)('sslmode=%s: CA alanı %s, istemci sertifikası alanları %s', async (mode, ca, client) => {
    const { user } = await setup();
    await user.click(sslToggle());
    await user.selectOptions(sslSection().getByLabelText('sslmode'), mode);
    expect(!!sslSection().queryByLabelText('CA dosyası')).toBe(ca);
    expect(!!sslSection().queryByLabelText('İstemci sertifikası')).toBe(client);
    expect(!!sslSection().queryByLabelText('İstemci anahtarı')).toBe(client);
  });

  it('prod’da verify-full değilse öneri gösterir, kapalı özette ⚠; "Uygula" verify-full yapar', async () => {
    const { user, f } = await setup();
    await user.click(f.getByRole('radio', { name: 'prod' }));
    expect(sslToggle()).toHaveTextContent('⚠');

    await user.click(sslToggle());
    expect(sslSection().getByText(/prod için verify-full önerilir/)).toBeInTheDocument();
    await user.click(sslSection().getByRole('button', { name: 'Uygula' }));
    expect(sslSection().getByLabelText('sslmode')).toHaveValue('verify-full');
    expect(sslSection().queryByText(/verify-full önerilir/)).not.toBeInTheDocument();
    expect(sslToggle()).not.toHaveTextContent('⚠');
  });

  it('prod olmayan bağlantıda öneri yok', async () => {
    const { user, f } = await setup();
    await user.click(f.getByRole('radio', { name: 'dev' }));
    await user.click(sslToggle());
    expect(sslSection().queryByText(/verify-full önerilir/)).not.toBeInTheDocument();
  });

  it('SSL ayarları kaydedilir; düzenlerken kayıtlı değerler gelir', async () => {
    const existing = connection({ sslmode: 'verify-ca', sslrootcert: '/etc/ssl/ca.pem' });
    const { user, fake, f } = await setup({ existing });
    expect(sslToggle()).toHaveTextContent('verify-ca');
    await user.click(sslToggle());
    expect(sslSection().getByLabelText('CA dosyası')).toHaveValue('/etc/ssl/ca.pem');

    await user.type(sslSection().getByLabelText('İstemci sertifikası'), '~/c.crt');
    await user.type(sslSection().getByLabelText('İstemci anahtarı'), '~/c.key');
    await user.click(f.getByRole('button', { name: 'Kaydet' }));
    expect(fake.requests[0]?.body).toMatchObject({
      sslmode: 'verify-ca',
      sslrootcert: '/etc/ssl/ca.pem',
      sslcert: '~/c.crt',
      sslkey: '~/c.key',
    });
  });

  it('modu prefer’e çekip kaydetmek gizlenen CA yolunu silmez', async () => {
    const existing = connection({ sslmode: 'verify-ca', sslrootcert: '/etc/ssl/ca.pem' });
    const { user, fake, f } = await setup({ existing });
    await user.click(sslToggle());
    await user.selectOptions(sslSection().getByLabelText('sslmode'), 'prefer');
    expect(sslSection().queryByLabelText('CA dosyası')).not.toBeInTheDocument();
    await user.click(f.getByRole('button', { name: 'Kaydet' }));
    expect(fake.requests[0]?.body).toMatchObject({ sslmode: 'prefer', sslrootcert: '/etc/ssl/ca.pem' });
  });

  it('geçersiz yol alan hatası olarak gösterilir ve bölüm açılır', async () => {
    const { user, fake, f } = await setup();
    await user.type(f.getByLabelText('Ad'), 'A');
    await user.type(f.getByLabelText('Host'), 'h');
    await user.type(f.getByLabelText('Kullanıcı'), 'u');
    await user.click(sslToggle());
    await user.selectOptions(sslSection().getByLabelText('sslmode'), 'require');
    await user.type(sslSection().getByLabelText('CA dosyası'), 'ca.pem');
    await user.click(sslToggle());
    await user.click(f.getByRole('button', { name: 'Kaydet' }));

    expect(sslToggle()).toHaveAttribute('aria-expanded', 'true');
    expect(sslSection().getByLabelText('CA dosyası')).toHaveAttribute('aria-invalid', 'true');
    expect(sslSection().getByText(/tam yol/)).toBeInTheDocument();
    expect(fake.requests).toEqual([]);
  });

  it('test SSL alanlarını gönderir', async () => {
    const existing = connection({ sslmode: 'verify-full', sslrootcert: '/ca.pem' });
    const { user, sent, f } = await setup({ existing, responses: [tlsFailure({})] });
    await user.click(f.getByRole('button', { name: 'Bağlantıyı test et' }));
    await f.findByRole('status', { name: 'Test sonucu' });
    expect(sent[0]).toMatchObject({ sslmode: 'verify-full', sslrootcert: '/ca.pem', sslcert: null, sslkey: null });
  });

  it('"CA dosyası seç" CA alanına götürür ve alanı kırmızı gösterir', async () => {
    const existing = connection({ sslmode: 'verify-full' });
    const failure = tlsFailure({
      kod: 'SELF_SIGNED_CERT_IN_CHAIN' as TestStep['kod'],
      mesaj: 'Sunucu sertifikası doğrulanamadı',
      alan: 'sslrootcert',
      oneriler: ['caDosyasiSec', 'tekrarDene'],
    });
    const { user, f } = await setup({ existing, responses: [failure] });
    await user.click(f.getByRole('button', { name: 'Bağlantıyı test et' }));
    await user.click(await sslSection().findByRole('button', { name: 'CA dosyası seç' }));
    const ca = sslSection().getByLabelText('CA dosyası');
    expect(ca).toHaveFocus();
    expect(ca).toHaveAttribute('aria-invalid', 'true');
  });

  it('"verify-ca dene" modu verify-ca yapar ve testi yeniden çalıştırır', async () => {
    const existing = connection({ sslmode: 'verify-full', sslrootcert: '/ca.pem' });
    const failure = tlsFailure({ alan: 'host', oneriler: ['verifyCaDene', 'hostuDuzelt'] });
    const { user, sent, f } = await setup({ existing, responses: [failure, failure] });
    await user.click(f.getByRole('button', { name: 'Bağlantıyı test et' }));
    await user.click(await sslSection().findByRole('button', { name: 'verify-ca dene' }));
    expect(sslSection().getByLabelText('sslmode')).toHaveValue('verify-ca');
    expect(sent.map((b) => b.sslmode)).toEqual(['verify-full', 'verify-ca']);
  });

  it('"require yap" modu require yapar', async () => {
    const warned: ConnectionTestResponse = {
      adimlar: [
        step('ulasma', 'basarili'),
        step('tls', 'uyari', { kod: 'sifresizDusus', oneriler: ['requireYap'] }),
        step('kimlik', 'basarili'),
        step('listeleme', 'basarili'),
      ],
      sunucu: { surum: '16.4', veritabaniSayisi: 1 },
    };
    const { user, f } = await setup({ existing: connection(), responses: [warned] });
    await user.click(f.getByRole('button', { name: 'Bağlantıyı test et' }));
    await f.findByRole('status', { name: 'Test sonucu' });
    await user.click(sslToggle());
    await user.click(sslSection().getByRole('button', { name: 'require yap' }));
    expect(sslSection().getByLabelText('sslmode')).toHaveValue('require');
  });
});
