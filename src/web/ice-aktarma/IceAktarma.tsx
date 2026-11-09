import { useEffect, useId, useState, type FormEvent } from 'react';
import type { Folder } from '../../core/ayarlar';
import {
  DEFAULT_ENV_COLORS,
  ENV_TAGS,
  SSL_PATH_FIELDS,
  connectionAddress,
  isProd,
  sshSummary,
  type Connection,
  type EnvTag,
  type SshSettings,
  type SslSettings,
} from '../../core/baglanti';
import {
  initialChoice,
  previewSections,
  selectionsOf,
  type CandidateChoice,
  type PreviewRow,
} from '../../core/ice-aktarma/onizleme';
import type {
  ImportApplyResponse,
  ImportPreviewRequest,
  ImportPreviewResponse,
  PreviewCandidate,
} from '../../core/ice-aktarma/sozlesme';
import { ApiError, useApi } from '../api/client';

interface Props {
  connections: Connection[];
  folders: Folder[];
  onImported: (response: ImportApplyResponse, testAfter: boolean) => void;
  onCancel: () => void;
}

const NEW_FOLDER = '__yeni-klasor__';

function errorText(err: unknown): string {
  return err instanceof ApiError && err.body?.hata ? err.body.hata : 'Tezgah sunucusuna ulaşılamıyor.';
}

const SSL_FILE_LABELS = { sslrootcert: 'CA', sslcert: 'sertifika', sslkey: 'anahtar' } as const;

/** Ayrıntı panelindeki SSL özeti: `verify-full · CA: /etc/ssl/root.pem`. */
function sslSummary(ssl: SslSettings): string {
  return [ssl.sslmode, ...SSL_PATH_FIELDS.flatMap((f) => (ssl[f] ? [`${SSL_FILE_LABELS[f]}: ${ssl[f]}`] : []))].join(' · ');
}

/** SSH özeti; anahtarla girişte anahtar dosyası da. */
function tunnelSummary(ssh: SshSettings | null): string {
  return ssh?.auth === 'key' && ssh.keyPath ? `${sshSummary(ssh)} · ${ssh.keyPath}` : sshSummary(ssh);
}

/** Adayın tüm uyarıları; "zaten var" en başta. */
function warningsOf(c: PreviewCandidate): string[] {
  return [...(c.existing ? [`zaten var: ${c.existing.name} (işaretlersen yinelenir)`] : []), ...c.warnings];
}

/**
 * İçe aktarma diyaloğu: açılınca kaynaklar taranır. Üstte kaynak çipleri, solda içe aktarmadan sonraki
 * bağlantı listesi, sağda seçilen adayın ayrıntısı, altta toplu test seçeneği.
 */
export function IceAktarma({ connections, folders, onImported, onCancel }: Props) {
  const api = useApi();
  const id = useId();
  const [request, setRequest] = useState<ImportPreviewRequest>({ pgpassPath: null, disabled: [], projectPaths: [] });
  const [preview, setPreview] = useState<ImportPreviewResponse | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [choices, setChoices] = useState<Record<string, CandidateChoice>>({});
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  /** Açık yol satırı: `.pgpass` dosyası ya da proje klasörü. */
  const [pathOpen, setPathOpen] = useState<'pgpass' | 'proje' | null>(null);
  const [pathText, setPathText] = useState('');
  const [projectText, setProjectText] = useState('');
  const [testAfter, setTestAfter] = useState(false);
  const [busy, setBusy] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api.previewImport(request).then(
      (next) => {
        if (!active) return;
        setPreview(next);
        setScanError(null);
        // Yeniden taramada kullanıcının düzenlemeleri aday kimliğiyle korunur.
        setChoices((prev) =>
          Object.fromEntries(next.candidates.map((c) => [c.id, prev[c.id] ?? initialChoice(c, connections, folders)])),
        );
        setCurrentId((prev) => (prev && next.candidates.some((c) => c.id === prev) ? prev : (next.candidates[0]?.id ?? null)));
      },
      (err: unknown) => active && setScanError(errorText(err)),
    );
    return () => {
      active = false;
    };
    // Mevcut bağlantılar diyalog açıkken değişmez; tarama yalnızca istek değişince yenilenir.
  }, [api, request]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const candidates = preview?.candidates ?? [];
  const sections = previewSections(connections, folders, candidates, choices);
  const selections = selectionsOf(candidates, choices);
  const current = candidates.find((c) => c.id === currentId) ?? null;
  const currentChoice = current ? choices[current.id] : undefined;
  const currentRow = sections.flatMap((s) => s.rows).find((r) => r.kind === 'aday' && r.candidate.id === currentId);

  function change(candidateId: string, patch: Partial<CandidateChoice>) {
    setChoices((prev) => ({ ...prev, [candidateId]: { ...prev[candidateId]!, ...patch } }));
  }

  function select(candidateId: string) {
    setCurrentId(candidateId);
    setNewFolderOpen(false);
  }

  function toggleSource(sourceId: string) {
    setRequest((r) => ({
      ...r,
      disabled: r.disabled.includes(sourceId) ? r.disabled.filter((d) => d !== sourceId) : [...r.disabled, sourceId],
    }));
  }

  function scanPath(e: FormEvent) {
    e.preventDefault();
    setRequest((r) => ({ ...r, pgpassPath: pathText.trim() || null }));
  }

  /** Proje yolu eklenir ve taranır; bulunamazsa sunucu çipi hatalı döndürür. */
  function scanProject(e: FormEvent) {
    e.preventDefault();
    const path = projectText.trim();
    if (path === '') return;
    setRequest((r) => (r.projectPaths.includes(path) ? r : { ...r, projectPaths: [...r.projectPaths, path] }));
    setProjectText('');
  }

  async function submit() {
    setBusy(true);
    setApplyError(null);
    try {
      onImported(await api.applyImport({ ...request, selections }), testAfter);
    } catch (err) {
      setApplyError(errorText(err));
      setBusy(false);
    }
  }

  /** Klasör seçenekleri: mevcutlar, sonra adaylara verilen yeni klasör adları. */
  const folderNames = [
    ...folders.map((f) => f.name),
    ...sections.filter((s) => s.isNew).map((s) => s.name),
  ];

  const row = (r: PreviewRow) => {
    if (r.kind === 'mevcut') {
      const c = r.connection;
      return (
        <div key={`m-${c.id}`} className={`agac-satiri mevcut${isProd(c.envTag) ? ' prod-serit' : ''}`}>
          <span className="ortam-noktasi" style={{ backgroundColor: c.color ?? 'transparent' }} aria-hidden="true" />
          <span className="agac-adi">{c.name}</span>
          <span className="baglanti-adresi">{connectionAddress(c)}</span>
          <span className="agac-rozeti">mevcut</span>
        </div>
      );
    }
    const { candidate: c, choice, name } = r;
    const warnings = warningsOf(c);
    const color = choice.envTag ? DEFAULT_ENV_COLORS[choice.envTag] : 'transparent';
    return (
      <div
        key={`a-${c.id}`}
        className={`agac-satiri aday${choice.selected ? '' : ' secilmemis'}${c.id === currentId ? ' secili' : ''}${
          isProd(choice.envTag) ? ' prod-serit' : ''
        }`}
      >
        <input
          type="checkbox"
          checked={choice.selected}
          aria-label={`${name} içe aktar`}
          onChange={(e) => change(c.id, { selected: e.target.checked })}
        />
        <button type="button" className="agac-dugme" aria-current={c.id === currentId ? 'true' : undefined} onClick={() => select(c.id)}>
          <span className="ortam-noktasi" style={{ backgroundColor: color }} aria-hidden="true" />
          <span className="agac-adi">{name}</span>
          <span className="baglanti-adresi">{connectionAddress(c)}</span>
        </button>
        {c.ssh && (
          <span role="img" aria-label="SSH tüneli" title={sshSummary(c.ssh)}>
            ⇄
          </span>
        )}
        {c.password && (
          <span role="img" aria-label="şifre .pgpass’tan" title={c.password.label}>
            🔑
          </span>
        )}
        {warnings.length > 0 && (
          <span className="agac-uyari" title={warnings.join('\n')}>
            ⚠{warnings.length}
          </span>
        )}
        <span className="agac-rozeti">{choice.selected ? 'yeni' : 'atlanacak'}</span>
      </div>
    );
  };

  return (
    <div className="perde">
      <div role="dialog" aria-modal="true" aria-labelledby={`${id}-baslik`} className="diyalog ice-aktarma">
        <header className="ice-aktarma-baslik">
          <h2 id={`${id}-baslik`}>İçe aktar</h2>
          <div role="group" aria-label="Kaynaklar" className="kaynak-cipleri">
            {preview?.sources.map((s) =>
              s.status === 'error' ? (
                <span key={s.id} className="cip hatali" title={`${s.path}: ${s.error}`}>
                  ⚠ {s.label}
                </span>
              ) : (
                <button
                  key={s.id}
                  type="button"
                  className="cip"
                  aria-pressed={s.enabled}
                  title={s.status === 'missing' ? `${s.path} (bulunamadı)` : s.path}
                  onClick={() => toggleSource(s.id)}
                >
                  {s.label} <span className="sayi">{s.candidateCount}</span>
                </button>
              ),
            )}
            <button type="button" className="cip" aria-expanded={pathOpen === 'proje'} onClick={() => setPathOpen((o) => (o === 'proje' ? null : 'proje'))}>
              ＋ Proje klasörü…
            </button>
            <button type="button" className="cip" aria-expanded={pathOpen === 'pgpass'} onClick={() => setPathOpen((o) => (o === 'pgpass' ? null : 'pgpass'))}>
              .pgpass yolu…
            </button>
          </div>
          {pathOpen === 'proje' && (
            <form className="yol-satiri" onSubmit={scanProject}>
              <input
                aria-label="Proje klasörü"
                placeholder="Proje kökü ya da .idea klasörü (ör. ~/projeler/billing)"
                value={projectText}
                autoFocus
                onChange={(e) => setProjectText(e.target.value)}
              />
              <button type="submit">Tara</button>
            </form>
          )}
          {pathOpen === 'pgpass' && (
            <form className="yol-satiri" onSubmit={scanPath}>
              <input
                aria-label=".pgpass yolu"
                placeholder="Boş bırakılırsa PGPASSFILE ya da varsayılan konum"
                value={pathText}
                onChange={(e) => setPathText(e.target.value)}
              />
              <button type="submit">Tara</button>
            </form>
          )}
        </header>

        <div className="ice-aktarma-govde">
          <section aria-label="Önizleme" className="sonuc-agaci">
            <p className="soluk">Bağlantı listesi içe aktarmadan sonra böyle görünecek</p>
            {scanError && (
              <p role="alert" className="uyari">
                {scanError}
              </p>
            )}
            {!preview && !scanError && <p className="soluk">Kaynaklar taranıyor…</p>}
            {preview &&
              sections.map((s) => (
                <div key={s.key} role="group" aria-label={s.name} className="agac-bolumu">
                  <div className="agac-basligi">
                    <span>{s.name}</span>
                    {s.isNew && <span className="rozet">yeni klasör</span>}
                  </div>
                  {s.rows.map(row)}
                </div>
              ))}
            {preview && preview.skipped.length > 0 && (
              <div role="group" aria-label="Atlandı (Postgres değil)" className="agac-bolumu atlandi">
                <div className="agac-basligi">
                  <span>Atlandı (Postgres değil)</span>
                </div>
                {preview.skipped.map((s, i) => (
                  <div key={`${s.source.id}-${i}`} className="agac-satiri mevcut" title={s.source.label}>
                    <span className="agac-adi">{s.name}</span>
                    <span className="baglanti-adresi">{s.reason}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section aria-label="Ayrıntı" className="aday-ayrintisi">
            {current && currentChoice && currentRow?.kind === 'aday' ? (
              <dl className="ayrinti-listesi">
                <dt>
                  <label htmlFor={`${id}-ad`}>Ad</label>
                </dt>
                <dd>
                  <input id={`${id}-ad`} value={currentChoice.name} onChange={(e) => change(current.id, { name: e.target.value })} />
                  {currentRow.name !== currentChoice.name && <div className="soluk">“{currentRow.name}” olarak kaydedilecek</div>}
                </dd>
                <dt />
                <dd>
                  <label>
                    <input
                      type="checkbox"
                      checked={currentChoice.selected}
                      onChange={(e) => change(current.id, { selected: e.target.checked })}
                    />{' '}
                    {current.existing ? 'Yinele' : 'İçe aktar'}
                  </label>
                </dd>
                <dt>
                  <label htmlFor={`${id}-klasor`}>Klasör</label>
                </dt>
                <dd>
                  <select
                    id={`${id}-klasor`}
                    value={newFolderOpen ? NEW_FOLDER : (currentChoice.folder ?? '')}
                    onChange={(e) => {
                      if (e.target.value === NEW_FOLDER) {
                        setNewFolderOpen(true);
                        return;
                      }
                      setNewFolderOpen(false);
                      change(current.id, { folder: e.target.value || null });
                    }}
                  >
                    <option value="">(klasörsüz)</option>
                    {folderNames.map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                    <option value={NEW_FOLDER}>yeni klasör…</option>
                  </select>
                  {newFolderOpen && (
                    <input
                      aria-label="Yeni klasör adı"
                      autoFocus
                      onChange={(e) => change(current.id, { folder: e.target.value.trim() || null })}
                    />
                  )}
                </dd>
                <dt>
                  <label htmlFor={`${id}-ortam`}>Ortam</label>
                </dt>
                <dd>
                  <select
                    id={`${id}-ortam`}
                    value={currentChoice.envTag ?? ''}
                    onChange={(e) => change(current.id, { envTag: (e.target.value || null) as EnvTag | null })}
                  >
                    <option value="">—</option>
                    {ENV_TAGS.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                  {current.envReason && <div className="soluk">öneri: {current.envReason}</div>}
                </dd>
                <dt>Sunucu</dt>
                <dd>{connectionAddress(current)}</dd>
                <dt>Şifre</dt>
                <dd>
                  {current.password
                    ? `🔑 ${current.password.label}${current.password.wildcard ? ' (joker)' : ''}`
                    : 'yok, ilk bağlanmada sorulur'}
                </dd>
                <dt>SSL</dt>
                <dd>{sslSummary(current)}</dd>
                <dt>SSH</dt>
                <dd>{tunnelSummary(current.ssh)}</dd>
                <dt>Veritabanları</dt>
                <dd>
                  <ul className="duz-liste">
                    {current.databases.map((d) => (
                      <li key={d}>
                        {d} {d === current.database && <span className="rozet">başlangıç</span>}
                      </li>
                    ))}
                  </ul>
                </dd>
                <dt>Kaynaklar</dt>
                <dd>
                  {current.sources.length > 1 && <div>{current.sources.length} kaynaktan birleştirildi</div>}
                  <ul className="duz-liste">
                    {current.sources.map((s) => (
                      <li key={s.label}>{s.label}</li>
                    ))}
                  </ul>
                </dd>
                {warningsOf(current).length > 0 && (
                  <>
                    <dt>Uyarılar</dt>
                    <dd>
                      <ul className="duz-liste uyari-listesi">
                        {warningsOf(current).map((w) => (
                          <li key={w}>⚠ {w}</li>
                        ))}
                      </ul>
                    </dd>
                  </>
                )}
              </dl>
            ) : (
              <p className="soluk">{preview && candidates.length === 0 ? 'Kaynaklarda içe aktarılacak bağlantı yok.' : 'Soldan bir aday seçin.'}</p>
            )}
          </section>
        </div>

        {applyError && (
          <p role="alert" className="uyari">
            {applyError}
          </p>
        )}
        <footer className="form-alt">
          <label>
            <input type="checkbox" checked={testAfter} onChange={(e) => setTestAfter(e.target.checked)} /> İçe aktardıktan sonra test et
          </label>
          <span className="bosluk" />
          <span className="soluk">{selections.length} yeni bağlantı</span>
          <button type="button" onClick={onCancel}>
            İptal
          </button>
          <button type="button" className="birincil" disabled={busy || selections.length === 0} onClick={() => void submit()}>
            İçe aktar
          </button>
        </footer>
      </div>
    </div>
  );
}
