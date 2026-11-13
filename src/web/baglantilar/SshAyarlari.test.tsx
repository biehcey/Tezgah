import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { SshSettings } from '../../core/baglanti';
import type { ConnectionTestResponse, TestStep } from '../../core/baglanti-testi';
import type { HostKeyProblem } from '../../core/ssh-tuneli';
import { App } from '../App';
import type { ConnectionTestBody } from '../api/client';
import { editConnection, fill } from '../test/eylemler';
import { connection, createFakeConnections, renderWithApi } from '../test/sahte-api';

const form = () => screen.getByRole('form', { name: /bağlantı/i });
const sshSection = () => within(screen.getByRole('group', { name: 'SSH tüneli' }));
const sshToggle = () => sshSection().getByRole('button', { name: /SSH tüneli/ });

const TUNNEL: SshSettings = {
  host: 'bastion.example.com',
  port: 22,
  user: 'deploy',
  auth: 'key',
  keyPath: '/home/u/.ssh/id_ed25519',
  agentPath: null,
  saveSecret: true,
};

const UNKNOWN: HostKeyProblem = {
  host: 'bastion.example.com',
  port: 22,
  tur: 'ssh-ed25519',
  parmakIzi: 'SHA256:/aVfHyjB4cQdc1A3AIz9e7iLfEjEgWvgxjZr1g5opAI',
  anahtar: 'AAAAC3NzaC1lZDI1NTE5AAAAIEU8D5up28tG1prR24yj9n15BaO74pWE01De7QehVbhR',
  digerTurler: [],
  kayitli: [],
  kaynak: null,
  iptal: false,
};

const MISMATCH: HostKeyProblem = {
  ...UNKNOWN,
  kayitli: ['SHA256:nsK4jZTmc4LQvZA4GlALZoYYwbvwFt11c09fwTQhKf8'],
  kaynak: 'tezgah',
};

const step = (id: TestStep['id'], sonuc: TestStep['sonuc'], extra: Partial<TestStep> = {}): TestStep => ({
  id,
  sonuc,
  kod: null,
  mesaj: sonuc === 'calistirilmadi' ? '' : `${id} mesajı`,
  alan: null,
  oneriler: [],
  ...extra,
});

const sshResult = (ssh: TestStep): ConnectionTestResponse => ({
  adimlar: [
    step('sirlar', 'basarili'),
    ssh,
    ...(['ulasma', 'tls', 'kimlik', 'listeleme'] as const).map((id) =>
      step(id, ssh.sonuc === 'basarili' ? 'basarili' : 'calistirilmadi'),
    ),
  ],
  sunucu: null,
});

async function setup({
  existing,
  responses = [],
  sshSecret,
}: { existing?: ReturnType<typeof connection>; responses?: ConnectionTestResponse[]; sshSecret?: string } = {}) {
  const user = userEvent.setup();
  const sent: ConnectionTestBody[] = [];
  const fake = createFakeConnections(existing ? [existing] : [], {
    async testConnection(body) {
      sent.push(body);
      return responses[Math.min(sent.length - 1, responses.length - 1)]!;
    },
  });
  if (existing) fake.passwords.set(existing.id, 'kayitli');
  if (existing && sshSecret !== undefined) fake.sshSecrets.set(existing.id, sshSecret);
  renderWithApi(<App />, fake.api);
  if (existing) await editConnection(user, new RegExp(existing.name));
  else await user.click(screen.getByRole('button', { name: 'Yeni bağlantı' }));
  return { user, fake, sent, f: within(form()) };
}

describe('SSH tüneli bölümü', () => {
  it('kapalıyken "kapalı" özeti; açılıp anahtar dosyasıyla doldurulunca tünel ve passphrase kaydedilir', async () => {
    const { user, fake, f } = await setup();
    expect(sshToggle()).toHaveTextContent('kapalı');
    await fill(user, f.getByLabelText('Ad'), 'A');
    await fill(user, f.getByLabelText('Host'), 'db.internal');
    await fill(user, f.getByLabelText('Kullanıcı'), 'u');

    await user.click(sshToggle());
    await user.click(sshSection().getByLabelText('SSH tüneli kullan'));
    await fill(user, sshSection().getByLabelText('SSH host'), 'bastion');
    await fill(user, sshSection().getByLabelText('SSH kullanıcısı'), 'deploy');
    expect(sshSection().getByRole('radio', { name: 'anahtar dosyası' })).toBeChecked();
    await fill(user, sshSection().getByLabelText('Anahtar dosyası'), '/home/u/.ssh/id_ed25519');
    await fill(user, sshSection().getByLabelText('Passphrase'), 'parola');
    expect(sshToggle()).toHaveTextContent('deploy@bastion · anahtar');
    await user.click(f.getByRole('button', { name: 'Kaydet' }));

    expect(fake.requests[0]?.body).toMatchObject({
      ssh: { host: 'bastion', port: 22, user: 'deploy', auth: 'key', keyPath: '/home/u/.ssh/id_ed25519', agentPath: null, saveSecret: true },
      sshSecret: 'parola',
    });
    expect(fake.connections[0]?.ssh?.host).toBe('bastion');
    expect(fake.sshSecrets.get(fake.connections[0]!.id)).toBe('parola');
  });

  it('agent seçilince sır alanı yoktur; boş yol varsayılanı açıklar ve sır gönderilmez', async () => {
    const { user, fake, f } = await setup({ existing: connection({ name: 'Uzak', ssh: TUNNEL }) });
    await user.click(sshToggle());
    await user.click(sshSection().getByRole('radio', { name: 'agent' }));
    expect(sshSection().queryByLabelText('Passphrase')).not.toBeInTheDocument();
    expect(sshSection().queryByLabelText("SSH sırrını keychain'e kaydet")).not.toBeInTheDocument();
    expect(sshSection().getByLabelText('Agent soketi / pipe')).toHaveAttribute('placeholder', expect.stringMatching(/^boşsa /));
    await user.click(f.getByRole('button', { name: 'Kaydet' }));
    expect(fake.requests[0]?.body).toMatchObject({ ssh: { auth: 'agent', agentPath: null } });
    expect(fake.requests[0]?.body).not.toHaveProperty('sshSecret');
  });

  it('keychain kapalıyken sır yalnızca teste gider, kaydedilmez; her açılışta sorulacağı yazılır', async () => {
    const { user, fake, sent, f } = await setup({
      existing: connection({ name: 'Uzak', ssh: { ...TUNNEL, auth: 'password', keyPath: null } }),
      responses: [sshResult(step('ssh', 'basarili'))],
    });
    await user.click(sshToggle());
    await user.click(sshSection().getByLabelText("SSH sırrını keychain'e kaydet"));
    expect(sshSection().getByText('SSH şifresi her açılışta ilk bağlanmada sorulur, yalnızca bellekte tutulur.')).toBeInTheDocument();
    await user.type(sshSection().getByLabelText('SSH şifresi (yalnızca test için)'), 'ssh-gizli');

    await user.click(f.getByRole('button', { name: 'Bağlantıyı test et' }));
    await f.findByRole('status', { name: 'Test sonucu' });
    expect(sent[0]).toMatchObject({ ssh: { saveSecret: false }, sshSecret: 'ssh-gizli' });

    await user.click(f.getByRole('button', { name: 'Kaydet' }));
    expect(fake.requests[0]?.body).toMatchObject({ ssh: { saveSecret: false } });
    expect(fake.requests[0]?.body).not.toHaveProperty('sshSecret');
  });

  it('keychain\'de kayıtlı sır satır olarak görünür; dokunulmadan kaydedilince sır gönderilmez', async () => {
    const { user, fake, f } = await setup({ existing: connection({ name: 'Uzak', ssh: TUNNEL }), sshSecret: 'eski' });
    await user.click(sshToggle());
    expect(await sshSection().findByText(/keychain'de kayıtlı/)).toBeInTheDocument();
    await user.click(f.getByRole('button', { name: 'Kaydet' }));
    expect(fake.requests[0]?.body).not.toHaveProperty('sshSecret');
    expect(fake.sshSecrets.get('b1')).toBe('eski');
  });

  it('test SSH alanlarını gönderir; SSH adımı SSH bölümünde görünür', async () => {
    const { user, sent, f } = await setup({
      existing: connection({ name: 'Uzak', ssh: TUNNEL }),
      responses: [sshResult(step('ssh', 'basarili', { mesaj: 'deploy@bastion.example.com · anahtar: host anahtarı doğrulandı, giriş yapıldı.' }))],
    });
    await user.click(f.getByRole('button', { name: 'Bağlantıyı test et' }));
    await f.findByRole('status', { name: 'Test sonucu' });
    expect(sent[0]).toMatchObject({ ssh: TUNNEL });
    await user.click(sshToggle());
    expect(sshSection().getByText(/host anahtarı doğrulandı, giriş yapıldı/)).toBeInTheDocument();
  });

  it('bilinmeyen host anahtarı: parmak izi gösterilir; "Güven ve tekrar dene" anahtarı kaydedip testi yeniden koşar', async () => {
    const { user, fake, sent, f } = await setup({
      existing: connection({ name: 'Uzak', ssh: TUNNEL }),
      responses: [
        sshResult(step('ssh', 'hata', { kod: 'hostKeyUnknown', alan: 'sshHost', hostAnahtari: UNKNOWN })),
        sshResult(step('ssh', 'basarili')),
      ],
    });
    await user.click(f.getByRole('button', { name: 'Bağlantıyı test et' }));
    const box = within(await sshSection().findByRole('group', { name: 'Bilinmeyen host anahtarı' }));
    expect(box.getByLabelText('Sunulan parmak izi')).toHaveTextContent(UNKNOWN.parmakIzi);

    await user.click(box.getByRole('button', { name: 'Güven ve tekrar dene' }));
    expect(fake.trustedHostKeys).toEqual([`bastion.example.com:22 ${UNKNOWN.anahtar}`]);
    await vi.waitFor(() => expect(sent).toHaveLength(2));
    expect(sshSection().queryByRole('group', { name: 'Bilinmeyen host anahtarı' })).not.toBeInTheDocument();
  });

  it('uyuşmazlık: devam seçeneği yok; yalnızca Tezgah kaydı unutulabilir', async () => {
    const { user, fake, f } = await setup({
      existing: connection({ name: 'Uzak', ssh: TUNNEL }),
      responses: [sshResult(step('ssh', 'hata', { kod: 'hostKeyMismatch', alan: 'sshHost', hostAnahtari: MISMATCH }))],
    });
    await user.click(f.getByRole('button', { name: 'Bağlantıyı test et' }));
    const box = within(await sshSection().findByRole('group', { name: 'Host anahtarı uyuşmazlığı' }));
    expect(box.getByLabelText('Kayıtlı parmak izi')).toHaveTextContent(MISMATCH.kayitli[0]!);
    expect(box.getByLabelText('Sunulan parmak izi')).toHaveTextContent(MISMATCH.parmakIzi);
    expect(box.queryByRole('button', { name: /Güven/ })).not.toBeInTheDocument();

    await user.click(box.getByRole('button', { name: 'Kayıtlı host anahtarını unut' }));
    expect(fake.forgottenHostKeys).toEqual(['bastion.example.com:22']);
  });

  it('kullanıcının known_hosts kaydıyla uyuşmazlıkta unut düğmesi yok, ssh-keygen -R önerilir', async () => {
    const { user, f } = await setup({
      existing: connection({ name: 'Uzak', ssh: { ...TUNNEL, port: 2222 } }),
      responses: [
        sshResult(step('ssh', 'hata', { kod: 'hostKeyMismatch', hostAnahtari: { ...MISMATCH, port: 2222, kaynak: 'kullanici' } })),
      ],
    });
    await user.click(f.getByRole('button', { name: 'Bağlantıyı test et' }));
    const box = within(await sshSection().findByRole('group', { name: 'Host anahtarı uyuşmazlığı' }));
    expect(box.queryByRole('button', { name: 'Kayıtlı host anahtarını unut' })).not.toBeInTheDocument();
    expect(box.getByText('ssh-keygen -R "[bastion.example.com]:2222"')).toBeInTheDocument();
  });

  it('bölümdeki "Kayıtlı host anahtarını unut" sonucu yazar', async () => {
    const { user, fake } = await setup({ existing: connection({ name: 'Uzak', ssh: TUNNEL }) });
    await user.click(sshToggle());
    await user.click(sshSection().getByRole('button', { name: 'Kayıtlı host anahtarını unut' }));
    expect(fake.forgottenHostKeys).toEqual(['bastion.example.com:22']);
    expect(await sshSection().findByRole('status')).toHaveTextContent("Tezgah'ta bu host için kayıtlı anahtar yok.");
  });
});

describe('Listeden tünelle bağlanma', () => {
  const nav = () => screen.getByRole('navigation', { name: 'Bağlantılar' });
  const panel = () => screen.getByRole('region', { name: 'Veritabanları' });

  async function open(ssh: SshSettings, setupFake?: (fake: ReturnType<typeof createFakeConnections>) => void) {
    const user = userEvent.setup();
    const fake = createFakeConnections([connection({ name: 'Uzak', host: 'db.internal', ssh })]);
    fake.servers.set('b1', { databases: { postgres: ['public'] } });
    fake.passwords.set('b1', 'kayitli');
    setupFake?.(fake);
    renderWithApi(<App />, fake.api);
    await user.click(await within(nav()).findByRole('button', { name: /Uzak/ }));
    await user.click(within(panel()).getByRole('button', { name: 'Bağlan ve tüm veritabanlarını listele' }));
    return { user, fake };
  }

  it('bilinmeyen host anahtarı pencere olarak sorulur; güvenilince bağlanır', async () => {
    const { user, fake } = await open(TUNNEL, (f) => (f.unknownHostKey = UNKNOWN));
    const d = within(await screen.findByRole('dialog', { name: 'Host anahtarı' }));
    expect(d.getByLabelText('Sunulan parmak izi')).toHaveTextContent(UNKNOWN.parmakIzi);
    await user.click(d.getByRole('button', { name: 'Güven ve tekrar dene' }));
    await vi.waitFor(() => expect(fake.databaseRequests).toEqual(['b1: listele', 'b1: listele']));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(within(panel()).queryByRole('alert')).not.toBeInTheDocument();
    expect(fake.trustedHostKeys).toHaveLength(1);
  });

  it('"Vazgeç" pencereyi kapatır, panelde hata kalır', async () => {
    const { user } = await open(TUNNEL, (f) => (f.unknownHostKey = UNKNOWN));
    await user.click(within(await screen.findByRole('dialog', { name: 'Host anahtarı' })).getByRole('button', { name: 'Vazgeç' }));
    expect(await within(panel()).findByRole('alert')).toHaveTextContent('host anahtarı tanınmıyor');
  });

  it('keychain\'e kaydedilmeyen SSH şifresi oturumluk pencereyle sorulur', async () => {
    const ssh: SshSettings = { ...TUNNEL, auth: 'password', keyPath: null, saveSecret: false };
    const { user, fake } = await open(ssh, (f) => f.servers.set('b1', { databases: { postgres: ['public'] }, sshSecret: 'ssh-gizli' }));
    const d = within(await screen.findByRole('dialog', { name: 'Uzak SSH şifresi' }));
    expect(d.getByText('SSH tüneli · deploy@bastion.example.com')).toBeInTheDocument();
    await user.type(d.getByLabelText('SSH şifresi'), 'yanlis');
    await user.click(d.getByRole('button', { name: 'Bağlan' }));
    expect(await within(screen.getByRole('dialog', { name: 'Uzak SSH şifresi' })).findByRole('alert')).toHaveTextContent(
      'SSH sunucusu şifreyi kabul etmedi',
    );

    await user.type(screen.getByLabelText('SSH şifresi'), 'ssh-gizli');
    await user.click(screen.getByRole('button', { name: 'Bağlan' }));
    expect(await within(panel()).findByText('postgres')).toBeInTheDocument();
    expect(fake.sessionPasswords.get('b1:ssh')).toBe('ssh-gizli');
    expect(fake.requests.map((r) => r.id)).toContain('b1/oturum-sifresi:ssh');
  });
});
