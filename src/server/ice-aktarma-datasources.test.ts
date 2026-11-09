import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startTestServer, type TestServer } from './test/sunucu';

const GLOBAL_SHARED = `<application><component name="dataSourceStorage">
  <data-source source="LOCAL" name="billing-prod" group="Billing" read-only="true" uuid="g1">
    <driver-ref>postgresql</driver-ref><jdbc-url>jdbc:postgresql://prod-db.internal:5432/billing</jdbc-url>
  </data-source>
  <data-source source="LOCAL" name="SE MySQL" uuid="g2"><driver-ref>mysql.8</driver-ref><jdbc-url>jdbc:mysql://h:3306/x</jdbc-url></data-source>
</component></application>`;
const GLOBAL_LOCAL = `<application><component name="dataSourceStorageLocal">
  <data-source name="billing-prod" uuid="g1"><user-name>app</user-name>
    <ssl-config><enabled>true</enabled><mode>VERIFY_FULL</mode><ca-cert>$USER_HOME$/certs/root.pem</ca-cert></ssl-config>
  </data-source>
</component></application>`;
const GLOBAL_SSH = `<application><component name="SshConfigs"><configs>
  <sshConfig id="s1" host="bastion.example.com" port="22" username="deploy" authType="OPEN_SSH" />
</configs></component></application>`;
const PROJECT_SHARED = `<project version="4"><component name="DataSourceManagerImpl">
  <data-source source="LOCAL" name="analytics" uuid="p1">
    <driver-ref>postgresql</driver-ref><jdbc-url>jdbc:postgresql://inner-db:5432/warehouse</jdbc-url>
  </data-source>
</component></project>`;
const PROJECT_LOCAL = `<project version="4"><component name="dataSourceStorageLocal">
  <data-source name="analytics" uuid="p1"><user-name>etl</user-name>
    <ssh-properties><enabled>true</enabled><ssh-config-id>s1</ssh-config-id></ssh-properties>
  </data-source>
</component></project>`;

let t: TestServer;
let home: string;
let env: Record<string, string | undefined>;

async function start(platform = 'linux') {
  t = await startTestServer({ homeDir: home, importEnvironment: { platform, env } });
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'tezgah-home-'));
  env = {};
});
afterEach(async () => {
  await t?.close();
  await rm(home, { recursive: true, force: true });
});

const preview = (body: object = {}) => t.api('POST', '/api/ice-aktarma/onizleme', { pgpassPath: null, disabled: [], projectPaths: [], ...body });
const apply = (body: object) => t.api('POST', '/api/ice-aktarma/uygula', { pgpassPath: null, disabled: [], projectPaths: [], ...body });

async function writeTree(root: string, files: Record<string, string>) {
  for (const [path, text] of Object.entries(files)) {
    await mkdir(join(root, path, '..'), { recursive: true });
    await writeFile(join(root, path), text);
  }
}

/** Linux'ta `~/.config/JetBrains`; ürün/sürüm dizinlerinden yalnızca dataSources'u olan kaynak olur. */
async function jetbrainsFixture(root = join(home, '.config', 'JetBrains')) {
  await writeTree(root, {
    'DataGrip2026.2/options/dataSources.xml': GLOBAL_SHARED,
    'DataGrip2026.2/options/dataSources.local.xml': GLOBAL_LOCAL,
    'DataGrip2026.2/options/sshConfigs.xml': GLOBAL_SSH,
    'IntelliJIdea2025.3/options/other.xml': '<application />',
  });
}

async function analyticsProject() {
  const project = join(home, 'work', 'analytics');
  await writeTree(project, { '.idea/dataSources.xml': PROJECT_SHARED, '.idea/dataSources.local.xml': PROJECT_LOCAL });
  return project;
}

describe('IntelliJ kaynakları', () => {
  it('global JetBrains dizinleri kendiliğinden taranır; ürün/sürüm başına çip, Postgres dışı "Atlandı", .pgpass ile birleşir', async () => {
    await jetbrainsFixture();
    await writeFile(join(home, '.pgpass'), 'prod-db.internal:5432:*:app:prod-sifre');
    await mkdir(join(home, 'certs'));
    await writeFile(join(home, 'certs', 'root.pem'), 'CA');
    await start();
    const { body } = await preview();
    expect(body.sources.map((s: { id: string; label: string; status: string; candidateCount: number }) => [s.id, s.label, s.status, s.candidateCount])).toEqual([
      ['jetbrains:DataGrip2026.2', 'DataGrip2026.2', 'ok', 1],
      ['pgpass', '.pgpass', 'ok', 1],
    ]);
    expect(body.candidates).toHaveLength(1);
    expect(body.candidates[0]).toMatchObject({
      name: 'billing-prod',
      folder: 'Billing',
      envTag: 'prod',
      sslmode: 'verify-full',
      sslrootcert: join(home, 'certs', 'root.pem'),
      warnings: [],
      sources: [
        { id: 'jetbrains:DataGrip2026.2', label: 'DataGrip2026.2 · billing-prod' },
        { id: 'pgpass', label: '.pgpass satır 1' },
      ],
      password: { label: '.pgpass satır 1', line: 1, wildcard: true },
    });
    expect(body.skipped).toEqual([
      { source: { id: 'jetbrains:DataGrip2026.2', label: 'DataGrip2026.2 · SE MySQL' }, name: 'SE MySQL', reason: 'Postgres değil (mysql.8)' },
    ]);
  });

  it('SSL dosyası yoksa uyarı verilir, aday seçili kalır; kapatılan JetBrains çipinin adayı ve atlananı gelmez', async () => {
    await jetbrainsFixture();
    await start();
    const { body } = await preview();
    expect(body.candidates[0]).toMatchObject({ selected: true, warnings: [`SSL dosyası bulunamadı: ${join(home, 'certs', 'root.pem')}`] });
    const off = (await preview({ disabled: ['jetbrains:DataGrip2026.2'] })).body;
    expect(off.candidates).toEqual([]);
    expect(off.skipped).toEqual([]);
    expect(off.sources[0]).toMatchObject({ enabled: false, candidateCount: 1 });
  });

  it('macOS’ta ~/Library/Application Support, Windows’ta %APPDATA% altındaki JetBrains taranır', async () => {
    await jetbrainsFixture(join(home, 'Library', 'Application Support', 'JetBrains'));
    await start('darwin');
    expect((await preview()).body.sources[0]).toMatchObject({ id: 'jetbrains:DataGrip2026.2', status: 'ok' });
    await t.close();
    env.APPDATA = join(home, 'Roaming');
    await jetbrainsFixture(join(home, 'Roaming', 'JetBrains'));
    await start('win32');
    expect((await preview()).body.sources[0]).toMatchObject({
      id: 'jetbrains:DataGrip2026.2',
      path: join(home, 'Roaming', 'JetBrains', 'DataGrip2026.2', 'options'),
    });
  });

  it('proje yolu (kök ya da .idea): grupsuz kaynak proje klasörüne; SSH referansı global sshConfigs’ten; şifre uzak host adıyla', async () => {
    await jetbrainsFixture();
    const project = await analyticsProject();
    await writeFile(join(home, '.pgpass'), 'inner-db:5432:warehouse:etl:etl-sifre');
    await start();
    for (const path of [project, join(project, '.idea')]) {
      const { body } = await preview({ projectPaths: [path] });
      const chip = body.sources.find((s: { id: string }) => s.id === `proje:${path}`);
      expect(chip).toMatchObject({ label: 'analytics', status: 'ok', candidateCount: 1, enabled: true });
      const analytics = body.candidates.find((c: { name: string }) => c.name === 'analytics');
      expect(analytics).toMatchObject({
        host: 'inner-db',
        user: 'etl',
        folder: 'analytics',
        ssh: { host: 'bastion.example.com', user: 'deploy', auth: 'agent' },
        password: { label: '.pgpass satır 1', line: 1, wildcard: false },
      });
    }
  });

  it('bulunamayan proje, göreli yol ve bozuk XML yalnızca o çipi hatalı yapar', async () => {
    await jetbrainsFixture();
    const broken = join(home, 'work', 'broken');
    await writeTree(broken, { '.idea/dataSources.xml': '<project><component>' });
    await start();
    const { body } = await preview({ projectPaths: [join(home, 'work', 'yok'), 'work/rel', broken] });
    const chips = body.sources.filter((s: { id: string }) => s.id.startsWith('proje:'));
    expect(chips.map((s: { status: string; error: string }) => [s.status, s.error])).toEqual([
      ['error', expect.stringMatching(/dataSources\.xml bulunamadı/)],
      ['error', expect.stringMatching(/Tam yol/)],
      ['error', expect.stringMatching(/dataSources\.xml okunamadı/)],
    ]);
    expect(body.candidates.map((c: { name: string }) => c.name)).toEqual(['billing-prod']);
  });

  it('uygula: IntelliJ adayının SSH ve Veritabanı seçimi bağlantıya taşınır', async () => {
    await jetbrainsFixture();
    const project = await analyticsProject();
    await start();
    const req = { projectPaths: [project] };
    const { body: p } = await preview(req);
    const analytics = p.candidates.find((c: { name: string }) => c.name === 'analytics');
    const { status, body } = await apply({ ...req, selections: [{ id: analytics.id, name: 'analytics', folder: 'analytics', envTag: null }] });
    expect(status).toBe(200);
    expect(body.added[0]).toMatchObject({
      password: 'yok',
      connection: { host: 'inner-db', ssh: { host: 'bastion.example.com', auth: 'agent' }, databaseSelection: [{ database: 'warehouse', schemas: null }] },
    });
  });
});
