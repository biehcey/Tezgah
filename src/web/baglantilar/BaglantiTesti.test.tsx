import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { ConnectionTestResponse, TestStep } from '../../core/baglanti-testi';
import { App } from '../App';
import type { ConnectionTestBody } from '../api/client';
import { connection, createFakeConnections, renderWithApi } from '../test/sahte-api';

const form = () => screen.getByRole('form', { name: /bağlantı/i });

/** Sunucudan gelen JSON gibi: `kod` düz metin. */
const step = (
  id: TestStep['id'],
  sonuc: TestStep['sonuc'],
  { kod = null, ...extra }: Partial<Omit<TestStep, 'kod'>> & { kod?: string | null } = {},
): TestStep => ({
  id,
  sonuc,
  kod: kod as TestStep['kod'],
  mesaj: sonuc === 'calistirilmadi' ? '' : `${id} mesajı`,
  alan: null,
  oneriler: [],
  ...extra,
});

const success: ConnectionTestResponse = {
  adimlar: [
    step('ulasma', 'basarili'),
    step('tls', 'basarili', { mesaj: 'SSL ile bağlanıldı' }),
    step('kimlik', 'basarili'),
    step('listeleme', 'basarili', { mesaj: 'PostgreSQL 16.4 · 3 veritabanı' }),
  ],
  sunucu: { surum: '16.4', veritabaniSayisi: 3 },
};

const failedAt = (failing: TestStep): ConnectionTestResponse => {
  const order: TestStep['id'][] = ['ulasma', 'tls', 'kimlik', 'listeleme'];
  const at = order.indexOf(failing.id);
  return {
    adimlar: order.map((id, i) => (i < at ? step(id, 'basarili') : i === at ? failing : step(id, 'calistirilmadi'))),
    sunucu: null,
  };
};

async function setup(
  responses: ConnectionTestResponse[],
  { existing }: { existing?: ReturnType<typeof connection> } = {},
) {
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
  if (existing) await user.click(await screen.findByRole('button', { name: new RegExp(existing.name) }));
  else await user.click(screen.getByRole('button', { name: 'Yeni bağlantı' }));
  const f = within(form());
  return { user, fake, sent, f };
}

async function fillNew(user: ReturnType<typeof userEvent.setup>, f: ReturnType<typeof within>) {
  await user.type(f.getByLabelText('Host'), 'db.example');
  await user.type(f.getByLabelText('Kullanıcı'), 'app');
  await user.type(f.getByLabelText('Şifre'), 'gizli');
}

const section = (name: string) => within(screen.getByRole('group', { name }));

describe('Bağlantıyı test et', () => {
  it('kaydedilmemiş değerlerle test eder, hiçbir şey kaydetmez; başarıda sürüm ve veritabanı sayısı görünür', async () => {
    const { user, fake, sent, f } = await setup([success]);
    await fillNew(user, f);
    await user.click(f.getByRole('button', { name: 'Bağlantıyı test et' }));

    expect(await f.findByRole('status', { name: 'Test sonucu' })).toHaveTextContent(
      'Bağlantı başarılı · PostgreSQL 16.4 · 3 veritabanı',
    );
    expect(sent).toEqual([
      {
        connectionId: null,
        host: 'db.example',
        port: 5432,
        user: 'app',
        database: 'postgres',
        password: 'gizli',
        savePassword: true,
        sslmode: 'prefer',
      },
    ]);
    expect(fake.requests).toEqual([]);
    expect(fake.connections).toEqual([]);
  });

  it('adım satırları ait oldukları bölümün altında: TLS SSL/TLS bölümünde, diğerleri Bağlantı bölümünde', async () => {
    const { user, f } = await setup([success]);
    await fillNew(user, f);
    await user.click(f.getByRole('button', { name: 'Bağlantıyı test et' }));
    await f.findByRole('status', { name: 'Test sonucu' });

    const baglanti = section('Bağlantı').getByRole('list', { name: 'Test adımları' });
    expect(within(baglanti).getAllByRole('listitem').map((li) => li.dataset.adim)).toEqual([
      'ulasma',
      'kimlik',
      'listeleme',
    ]);
    const ssl = section('SSL/TLS');
    await user.click(ssl.getByRole('button', { name: /SSL\/TLS/ }));
    expect(within(ssl.getByRole('list', { name: 'Test adımları' })).getByRole('listitem')).toHaveTextContent(
      'SSL ile bağlanıldı',
    );
  });

  it('ulaşılamayan portta hangi adımda durduğu özetlenir, Port kırmızı olur, "Port\'u düzelt" alana götürür', async () => {
    const refused = step('ulasma', 'hata', {
      kod: 'ECONNREFUSED',
      mesaj: 'db.example:5432 bağlantıyı reddetti',
      alan: 'port',
      oneriler: ['portuDuzelt', 'tekrarDene'],
    });
    const { user, sent, f } = await setup([failedAt(refused), success]);
    await fillNew(user, f);
    await user.click(f.getByRole('button', { name: 'Bağlantıyı test et' }));

    expect(await f.findByRole('status', { name: 'Test sonucu' })).toHaveTextContent(
      'Sunucuya ulaşma adımında başarısız',
    );
    expect(f.getByLabelText('Port')).toHaveAttribute('aria-invalid', 'true');
    const row = section('Bağlantı').getByText(/bağlantıyı reddetti/).closest('li')!;
    expect(row).toHaveTextContent('ECONNREFUSED');
    const steps = within(section('Bağlantı').getByRole('list', { name: 'Test adımları' })).getAllByRole('listitem');
    expect(steps.find((li) => li.dataset.adim === 'kimlik')).toHaveTextContent('Kimlik doğrulama: çalıştırılmadı');

    await user.click(within(row).getByRole('button', { name: "Port'u düzelt" }));
    expect(f.getByLabelText('Port')).toHaveFocus();

    await user.click(within(row).getByRole('button', { name: 'Tekrar dene' }));
    await waitFor(() => expect(sent).toHaveLength(2));
    expect(await f.findByRole('status', { name: 'Test sonucu' })).toHaveTextContent('Bağlantı başarılı');
    expect(f.getByLabelText('Port')).not.toHaveAttribute('aria-invalid');
  });

  it('"postgres kullan" başlangıç veritabanını değiştirip yeniden test eder', async () => {
    const missing = step('kimlik', 'hata', {
      kod: '3D000',
      mesaj: 'database "app" does not exist',
      alan: 'database',
      oneriler: ['postgresKullan', 'veritabaniniDuzelt'],
    });
    const { user, sent, f } = await setup([failedAt(missing), success]);
    await fillNew(user, f);
    await user.clear(f.getByLabelText('Başlangıç veritabanı'));
    await user.type(f.getByLabelText('Başlangıç veritabanı'), 'app');
    await user.click(f.getByRole('button', { name: 'Bağlantıyı test et' }));

    expect(await f.findByLabelText('Başlangıç veritabanı')).toHaveAttribute('aria-invalid', 'true');
    await user.click(f.getByRole('button', { name: 'postgres kullan' }));
    expect(f.getByLabelText('Başlangıç veritabanı')).toHaveValue('postgres');
    await waitFor(() => expect(sent.map((b) => b.database)).toEqual(['app', 'postgres']));
  });

  it('TLS adımında hata olursa SSL/TLS bölümü kendiliğinden açılır', async () => {
    const tls = step('tls', 'hata', { kod: 'ERR_SSL_WRONG_VERSION_NUMBER', mesaj: 'TLS kurulamadı' });
    const { user, f } = await setup([failedAt(tls)]);
    await fillNew(user, f);
    expect(section('SSL/TLS').getByRole('button', { name: /SSL\/TLS/ })).toHaveAttribute('aria-expanded', 'false');
    await user.click(f.getByRole('button', { name: 'Bağlantıyı test et' }));

    await f.findByRole('status', { name: 'Test sonucu' });
    expect(section('SSL/TLS').getByRole('button', { name: /SSL\/TLS/ })).toHaveAttribute('aria-expanded', 'true');
    expect(section('SSL/TLS').getByRole('listitem')).toHaveTextContent('TLS: TLS kurulamadı ERR_SSL_WRONG_VERSION_NUMBER');
  });

  it('uyarılı başarı özetlenir', async () => {
    const warned: ConnectionTestResponse = {
      ...success,
      adimlar: success.adimlar.map((s) =>
        s.id === 'tls' ? step('tls', 'uyari', { kod: 'sifresizDusus', mesaj: 'Sunucu SSL desteklemiyor' }) : s,
      ),
    };
    const { user, f } = await setup([warned]);
    await fillNew(user, f);
    await user.click(f.getByRole('button', { name: 'Bağlantıyı test et' }));
    expect(await f.findByRole('status', { name: 'Test sonucu' })).toHaveTextContent(
      'Bağlantı başarılı, uyarıyla (TLS) · PostgreSQL 16.4 · 3 veritabanı',
    );
  });

  it('kayıtlı bağlantıda şifre yazılmadıysa keychain\'den okunsun diye bağlantı kimliğini gönderir, şifreyi göndermez', async () => {
    const existing = connection({ id: 'b1', name: 'Kayıtlı', host: 'db.example' });
    const { user, sent, f } = await setup([success], { existing });
    await f.findByText(/keychain'de kayıtlı/);
    await user.click(f.getByRole('button', { name: 'Bağlantıyı test et' }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ connectionId: 'b1', host: 'db.example' });
    expect(sent[0]).not.toHaveProperty('password');
  });

  it('eksik alanlarda sunucuya gitmeden alan hatası gösterir', async () => {
    const { user, sent, f } = await setup([success]);
    await user.click(f.getByRole('button', { name: 'Bağlantıyı test et' }));
    expect(f.getByLabelText('Host')).toHaveAttribute('aria-invalid', 'true');
    expect(sent).toEqual([]);
  });
});
