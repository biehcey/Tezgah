import { describe, expect, it } from 'vitest';
import { DataSourcesXmlError, dataSourceCandidates, type DataSourcesContext, type DataSourcesFiles } from './datasources';

const PROJECT: DataSourcesContext = {
  source: { id: 'proje:/work/billing', label: 'billing' },
  homeDir: '/home/dev',
  projectDir: '/work/billing',
  defaultFolder: 'billing',
};
const GLOBAL: DataSourcesContext = {
  source: { id: 'jetbrains:DataGrip2026.2', label: 'DataGrip2026.2' },
  homeDir: '/home/dev',
  projectDir: null,
  defaultFolder: null,
};

const SHARED = `<?xml version="1.0" encoding="UTF-8"?>
<project version="4">
  <component name="DataSourceManagerImpl" format="xml" multifile-model="true">
    <data-source source="LOCAL" name="billing-prod" group="Billing" read-only="true" uuid="u-prod">
      <driver-ref>postgresql</driver-ref>
      <synchronize>true</synchronize>
      <jdbc-driver>org.postgresql.Driver</jdbc-driver>
      <jdbc-url>jdbc:postgresql://prod-db.internal:5433/billing</jdbc-url>
      <working-dir>$ProjectFileDir$</working-dir>
    </data-source>
    <data-source source="LOCAL" name="yerel" uuid="u-local">
      <driver-ref>postgresql</driver-ref>
      <jdbc-url>jdbc:postgresql://localhost/app</jdbc-url>
    </data-source>
  </component>
</project>`;

const LOCAL = `<?xml version="1.0" encoding="UTF-8"?>
<project version="4">
  <component name="dataSourceStorageLocal" created-in="DB-253.29346.170">
    <data-source name="billing-prod" uuid="u-prod">
      <database-info product="PostgreSQL" version="15.14" dbms="POSTGRES" />
      <secret-storage>master_key</secret-storage>
      <user-name>billing_ro</user-name>
      <schema-mapping>
        <introspection-scope>
          <node kind="database">
            <name qname="billing" />
            <name qname="billing_archive" />
            <node kind="schema" qname="public" />
          </node>
        </introspection-scope>
      </schema-mapping>
    </data-source>
    <data-source name="yerel" uuid="u-local">
      <user-name>postgres</user-name>
      <schema-mapping>
        <introspection-scope>
          <node kind="database" qname="@"><node kind="schema" qname="@" /></node>
        </introspection-scope>
      </schema-mapping>
    </data-source>
  </component>
</project>`;

const files = (overrides: Partial<DataSourcesFiles> = {}): DataSourcesFiles => ({ dataSources: SHARED, local: LOCAL, sshConfigs: [], ...overrides });

/** Tek data source'lu paylaşılan ve local dosya çifti. */
function single(shared: { attrs?: string; body?: string }, local = ''): DataSourcesFiles {
  return {
    dataSources: `<project><component name="DataSourceManagerImpl"><data-source source="LOCAL" name="ds" uuid="u1" ${shared.attrs ?? ''}>
      <driver-ref>postgresql</driver-ref>${shared.body ?? '<jdbc-url>jdbc:postgresql://db.internal:5432/app</jdbc-url>'}
    </data-source></component></project>`,
    local: `<project><component name="dataSourceStorageLocal"><data-source name="ds" uuid="u1"><user-name>app</user-name>${local}</data-source></component></project>`,
    sshConfigs: [],
  };
}

describe('dataSources.xml ayrıştırma', () => {
  it('paylaşılan ve local dosya uuid ile birleşir: ad, host, port, kullanıcı, veritabanları, grup, read-only → prod', () => {
    const { candidates, skipped } = dataSourceCandidates(files(), PROJECT);
    expect(skipped).toEqual([]);
    expect(candidates).toHaveLength(2);
    expect(candidates[0]).toMatchObject({
      source: { id: 'proje:/work/billing', label: 'billing · billing-prod' },
      name: 'billing-prod',
      host: 'prod-db.internal',
      port: 5433,
      user: 'billing_ro',
      database: 'billing',
      databases: ['billing', 'billing_archive'],
      ssh: null,
      sslmode: 'prefer',
      envTag: 'prod',
      envReason: expect.stringMatching(/read-only/),
      folder: 'Billing',
      warnings: [],
      tunnelUnmapped: false,
    });
    // Grupsuz proje kaynağı proje klasörüne; `@` varsayılan veritabanıdır.
    expect(candidates[1]).toMatchObject({ name: 'yerel', host: 'localhost', port: 5432, user: 'postgres', database: 'app', databases: ['app'], folder: 'billing', envTag: null });
  });

  it('global kaynak (<application> kökü) klasörsüz; group-name de okunur, iç içe grup tek düzey klasör olur ve uyarılır', () => {
    const shared = SHARED.replace(/<project version="4">/, '<application>')
      .replace('</project>', '</application>')
      .replace('group="Billing"', 'group-name="Billing/Prod"');
    const local = LOCAL.replace(/<project version="4">/, '<application>').replace('</project>', '</application>');
    const { candidates } = dataSourceCandidates(files({ dataSources: shared, local }), GLOBAL);
    expect(candidates[0]).toMatchObject({ folder: 'Billing/Prod', warnings: ['iç içe grup tek düzey klasöre: Billing/Prod'] });
    expect(candidates[1]).toMatchObject({ folder: null });
  });

  it('çoklu host’ta yalnızca ilki alınır ve uyarılır; [IPv6] okunur', () => {
    const multi = dataSourceCandidates(single({ body: '<jdbc-url>jdbc:postgresql://h1:5433,h2:5434/app?targetServerType=primary</jdbc-url>' }), PROJECT);
    expect(multi.candidates[0]).toMatchObject({ host: 'h1', port: 5433, database: 'app', warnings: ['çoklu host: yalnızca ilki (h1:5433) alındı'] });
    const v6 = dataSourceCandidates(single({ body: '<jdbc-url>jdbc:postgresql://[::1]:5740/db</jdbc-url>' }), PROJECT);
    expect(v6.candidates[0]).toMatchObject({ host: '::1', port: 5740, database: 'db', warnings: [] });
  });

  it('URL’deki düz şifre atılır ve uyarılır; yolda veritabanı yoksa pgjdbc gibi kullanıcı adı', () => {
    const files = single({ body: '<jdbc-url>jdbc:postgresql://db.internal/?user=svc&amp;password=gizli</jdbc-url>' });
    files.local = files.local!.replace('<user-name>app</user-name>', '');
    const { candidates } = dataSourceCandidates(files, PROJECT);
    expect(candidates[0]).toMatchObject({ user: 'svc', database: 'svc', warnings: ['JDBC URL’deki şifre alınmadı'] });
    expect(JSON.stringify(candidates)).not.toContain('gizli');
  });

  it('Postgres dışı sürücüler atlanır; jdbc:postgresql URL’li bilinmeyen sürücü (ör. türev) kabul edilir', () => {
    const shared = `<application><component name="dataSourceStorage">
      <data-source source="LOCAL" name="SE MySQL" uuid="m1"><driver-ref>mysql.8</driver-ref><jdbc-url>jdbc:mysql://h:3306/x</jdbc-url></data-source>
      <data-source source="LOCAL" name="Özel PG" uuid="p1"><driver-ref>custom</driver-ref><jdbc-url>jdbc:postgresql://pg/x</jdbc-url></data-source>
      <data-source source="LOCAL" name="Redshift" uuid="r1"><driver-ref>redshift</driver-ref><jdbc-url>jdbc:redshift://r:5439/x</jdbc-url></data-source>
    </component></application>`;
    const { candidates, skipped } = dataSourceCandidates({ dataSources: shared, local: null, sshConfigs: [] }, GLOBAL);
    expect(candidates.map((c) => c.name)).toEqual(['Özel PG']);
    expect(skipped).toEqual([
      { source: { id: 'jetbrains:DataGrip2026.2', label: 'DataGrip2026.2 · SE MySQL' }, name: 'SE MySQL', reason: 'Postgres değil (mysql.8)' },
      { source: { id: 'jetbrains:DataGrip2026.2', label: 'DataGrip2026.2 · Redshift' }, name: 'Redshift', reason: 'Postgres değil (redshift)' },
    ]);
  });

  it('gruptaki görünmez karakterler temizlenir', () => {
    const { candidates } = dataSourceCandidates(single({ attrs: 'group="​backend "' }), PROJECT);
    expect(candidates[0]!.folder).toBe('backend');
  });
});

const SSH_CONFIGS = `<application><component name="SshConfigs"><configs>
  <sshConfig id="s-pass" host="bastion.example.com" port="2222" username="deploy" authType="PASSWORD" nameFormat="DESCRIPTIVE" />
  <sshConfig id="s-key" host="bastion" username="ops" authType="KEY_PAIR" keyPath="$USER_HOME$/.ssh/id_ed25519" />
  <sshConfig id="s-agent" host="bastion" username="ops" authType="OPEN_SSH" keyPath="$USER_HOME$/.ssh/id_rsa" useOpenSSHConfig="true" />
  <sshConfig id="s-jump" host="inner" username="ops" authType="OPEN_SSH" proxyJump="outer.example.com" />
</configs></component></application>`;

const sshRef = (id: string) => `<ssh-properties><enabled>true</enabled><ssh-config-id>${id}</ssh-config-id></ssh-properties>`;

describe('SSH eşlemesi', () => {
  it('yeni biçim: ssh-config-id sshConfigs.xml’de çözülür; PASSWORD → password, KEY_PAIR → key, OPEN_SSH → agent', () => {
    const map = (id: string) => dataSourceCandidates({ ...single({}, sshRef(id)), sshConfigs: [SSH_CONFIGS] }, PROJECT).candidates[0]!;
    expect(map('s-pass').ssh).toEqual({ host: 'bastion.example.com', port: 2222, user: 'deploy', auth: 'password', keyPath: null, agentPath: null, saveSecret: true });
    expect(map('s-key').ssh).toMatchObject({ host: 'bastion', port: 22, user: 'ops', auth: 'key', keyPath: '/home/dev/.ssh/id_ed25519' });
    expect(map('s-agent').ssh).toMatchObject({ auth: 'agent', keyPath: '/home/dev/.ssh/id_rsa' });
    expect(map('s-pass').tunnelUnmapped).toBe(false);
  });

  it('referans önce kaynağın kendi, sonra sonraki sshConfigs.xml’lerde aranır; enabled=false tünel değildir', () => {
    const own = `<project><component name="SshConfigs"><configs><sshConfig id="s-pass" host="proje-bastion" username="u" authType="PASSWORD" /></configs></component></project>`;
    const found = dataSourceCandidates({ ...single({}, sshRef('s-key')), sshConfigs: [own, SSH_CONFIGS] }, PROJECT).candidates[0]!;
    expect(found.ssh).toMatchObject({ host: 'bastion', auth: 'key' });
    const first = dataSourceCandidates({ ...single({}, sshRef('s-pass')), sshConfigs: [own, SSH_CONFIGS] }, PROJECT).candidates[0]!;
    expect(first.ssh).toMatchObject({ host: 'proje-bastion' });
    const off = dataSourceCandidates({ ...single({}, '<ssh-properties><enabled>false</enabled><ssh-config-id>s-pass</ssh-config-id></ssh-properties>'), sshConfigs: [SSH_CONFIGS] }, PROJECT);
    expect(off.candidates[0]!.ssh).toBeNull();
  });

  it('eski satır içi biçim: proxy-host/port, user; anahtar yolu makrosu genişletilir, şifre ya da agent', () => {
    const inline = (extra: string) =>
      dataSourceCandidates(
        single({}, `<ssh-properties><enabled>true</enabled><proxy-host>localhost</proxy-host><proxy-port>2200</proxy-port><user>vagrant</user>${extra}</ssh-properties>`),
        PROJECT,
      ).candidates[0]!.ssh;
    expect(inline('<use-password>false</use-password><private-key-path>$PROJECT_DIR$/support/vagrant.key</private-key-path>')).toEqual({
      host: 'localhost',
      port: 2200,
      user: 'vagrant',
      auth: 'key',
      keyPath: '/work/billing/support/vagrant.key',
      agentPath: null,
      saveSecret: true,
    });
    expect(inline('<use-password>true</use-password>')).toMatchObject({ auth: 'password', keyPath: null });
    expect(inline('<use-password>false</use-password>')).toMatchObject({ auth: 'agent' });
  });

  it('ProxyJump ya da bulunamayan referans: tünel boş, aday seçilmeyecek, "tünel eşlenemedi" uyarısı', () => {
    const jump = dataSourceCandidates({ ...single({}, sshRef('s-jump')), sshConfigs: [SSH_CONFIGS] }, PROJECT).candidates[0]!;
    expect(jump).toMatchObject({ ssh: null, tunnelUnmapped: true, warnings: ['tünel eşlenemedi: ProxyJump desteklenmiyor (inner)'] });
    const missing = dataSourceCandidates({ ...single({}, sshRef('yok')), sshConfigs: [SSH_CONFIGS] }, PROJECT).candidates[0]!;
    expect(missing).toMatchObject({ ssh: null, tunnelUnmapped: true, warnings: ['tünel eşlenemedi: SSH yapılandırması bulunamadı (yok)'] });
    // Bozuk sshConfigs.xml kaynağı düşürmez; referans bulunamamış olur.
    const broken = dataSourceCandidates({ ...single({}, sshRef('s-pass')), sshConfigs: ['<application><configs>'] }, PROJECT).candidates[0]!;
    expect(broken).toMatchObject({ ssh: null, tunnelUnmapped: true });
  });
});

describe('SSL eşlemesi', () => {
  const sslConfig = `<ssl-config use-ide-store="true">
      <ca-cert>$PROJECT_DIR$/certs/root.pem</ca-cert>
      <client-cert>$USER_HOME$/pg/client.crt</client-cert>
      <client-key>$USER_HOME$/pg/client.key</client-key>
      <enabled>true</enabled>
      <mode>VERIFY_FULL</mode>
    </ssl-config>`;
  const urlSsl = '<jdbc-url>jdbc:postgresql://db.internal/app?sslmode=verify-ca&amp;sslrootcert=/etc/ssl/ca.pem</jdbc-url>';

  it('önce ssl-config: mod ve dosyalar, makrolar genişletilir', () => {
    const c = dataSourceCandidates(single({ body: urlSsl }, sslConfig), PROJECT).candidates[0]!;
    expect(c).toMatchObject({
      sslmode: 'verify-full',
      sslrootcert: '/work/billing/certs/root.pem',
      sslcert: '/home/dev/pg/client.crt',
      sslkey: '/home/dev/pg/client.key',
    });
  });

  it('ssl-config yoksa ya da kapalıysa JDBC sslmode/sslrootcert; o da yoksa prefer', () => {
    const fromUrl = dataSourceCandidates(single({ body: urlSsl }, sslConfig.replace('<enabled>true', '<enabled>false')), PROJECT).candidates[0]!;
    expect(fromUrl).toMatchObject({ sslmode: 'verify-ca', sslrootcert: '/etc/ssl/ca.pem', sslcert: null, sslkey: null });
    expect(dataSourceCandidates(single({}), PROJECT).candidates[0]).toMatchObject({ sslmode: 'prefer', sslrootcert: null });
  });

  it('enum adları libpq adlarına çevrilir; ALLOW → prefer, modsuz ssl-config → require', () => {
    const mode = (m: string) =>
      dataSourceCandidates(single({}, `<ssl-config><enabled>true</enabled>${m}</ssl-config>`), PROJECT).candidates[0]!.sslmode;
    expect(mode('<mode>REQUIRE</mode>')).toBe('require');
    expect(mode('<mode>VERIFY_CA</mode>')).toBe('verify-ca');
    expect(mode('<mode>ALLOW</mode>')).toBe('prefer');
    expect(mode('')).toBe('require');
  });
});

describe('Veritabanı seçimi (introspection-scope)', () => {
  it('negative="1" tümü demek: başlangıç veritabanı alınır, uyarılır; eski düz metin biçimi okunur', () => {
    const all = dataSourceCandidates(
      single({}, '<schema-mapping><introspection-scope><node kind="database" negative="1"><node kind="schema" negative="1" /></node></introspection-scope></schema-mapping>'),
      PROJECT,
    ).candidates[0]!;
    expect(all).toMatchObject({ databases: ['app'], warnings: ['IntelliJ’de tüm veritabanları görünür; içe aktardıktan sonra Veritabanı panelinden seçin'] });
    const old = dataSourceCandidates(
      single({}, '<schema-mapping><introspection-scope>harbinger:pg_catalog,public;reach:public</introspection-scope></schema-mapping>'),
      PROJECT,
    ).candidates[0]!;
    expect(old.databases).toEqual(['harbinger', 'reach']);
  });
});

describe('bozuk XML', () => {
  it('bozuk dataSources.xml ya da dataSources.local.xml kaynak düzeyinde DataSourcesXmlError', () => {
    expect(() => dataSourceCandidates(files({ dataSources: '<project><component>' }), PROJECT)).toThrow(DataSourcesXmlError);
    expect(() => dataSourceCandidates(files({ local: '<project><data-source name="x"' }), PROJECT)).toThrow(/dataSources\.local\.xml/);
  });
});
