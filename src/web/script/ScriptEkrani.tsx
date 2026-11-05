import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isProd, type Connection } from '../../core/baglanti';
import { splitStatements } from '../../core/ifade-bolme';
import { decisionStatus, formatRemaining, startDecision, type DecisionPhase, type DecisionTimer } from '../../core/karar-suresi';
import {
  PREVIEW_ROWS,
  applyEvent,
  startRunView,
  targetLock,
  type RunView,
  type StatementStatus,
  type StatementView,
} from '../../core/script-calistirma';
import { useApi, type ScriptRunHandle } from '../api/client';
import { STATUS_LABELS, STATUS_SYMBOLS } from './durum';
import { ScriptEditoru, type EditorMarks, type ScriptEditoruHandle } from './ScriptEditoru';

interface Props {
  /** Hedefin bağlantısı ve veritabanı; hedef seçilmediyse `null`. */
  target: { connection: Connection; database: string } | null;
  /** "hedefi değiştir ▾": hızlı geçiş paletini açar. */
  onChangeTarget: () => void;
  /** Hedef kilidinin nedeni değişti (`null`: hedef değiştirilebilir); ekran kapanınca `null`. */
  onTargetLockChange?: (reason: string | null) => void;
}

/** Aynı satırda başlayan birden çok ifadede satır işareti en önemli durumu gösterir. */
const PRIORITY: Record<StatementStatus, number> = { hatali: 4, calisiyor: 3, calistirilmadi: 2, basarili: 1, sirada: 0 };

const NO_MARKS: EditorMarks = { lines: new Map(), error: null };

/**
 * Script ekranı (ticket 23 varyant B): üstte büyük hedef başlığı, solda editör ve çalıştırma çubuğu,
 * sağda karar kartı ve ifade kartları. prod hedefte başlık kırmızımsıdır; uygulamanın kırmızı
 * çerçevesi kökte verilir.
 */
export function ScriptEkrani({ target, onChangeTarget, onTargetLockChange }: Props) {
  const api = useApi();
  const prod = target !== null && isProd(target.connection.envTag);
  const [script, setScript] = useState('');
  const [run, setRun] = useState<RunView | null>(null);
  const handle = useRef<ScriptRunHandle | null>(null);
  /** Sunucunun son bildirdiği kalan süreden kurulan yerel geri sayım; yetkili sayaç sunucudadır. */
  const [deadline, setDeadline] = useState<DecisionTimer | null>(null);
  const editor = useRef<ScriptEditoruHandle>(null);

  // Ekran kapanırsa açık transaction sunucuda geri alınır (ADR-0002).
  useEffect(() => () => handle.current?.close(), []);

  const lock = targetLock(run);
  useEffect(() => {
    onTargetLockChange?.(lock);
  }, [lock, onTargetLockChange]);
  useEffect(() => () => onTargetLockChange?.(null), [onTargetLockChange]);

  const running = run?.evre === 'calisiyor';
  const busy = run !== null && run.evre !== 'bitti';
  const hasStatements = useMemo(() => splitStatements(script).length > 0, [script]);

  function start() {
    if (!target || busy) return;
    handle.current?.close();
    setRun(startRunView(script));
    setDeadline(null);
    handle.current = api.runScript({ connectionId: target.connection.id, database: target.database }, script, (event) => {
      setRun((current) => (current ? applyEvent(current, event) : current));
      if (event.type === 'kararBekleniyor' || event.type === 'uzatildi') setDeadline(startDecision(event.kalanMs, Date.now()));
    });
  }

  function request(type: 'commit' | 'rollback' | 'uzat' | 'iptal') {
    handle.current?.send({ type });
    setRun((current) => (current ? { ...current, bekleyenIstek: type, uyari: undefined } : current));
  }

  // Satır işaretleri yalnızca editördeki metin çalıştırılanla aynıyken anlamlı.
  const marks = useMemo((): EditorMarks => {
    if (!run || run.script !== script) return NO_MARKS;
    const lines = new Map<number, StatementStatus>();
    for (const s of run.ifadeler) {
      const existing = lines.get(s.satir);
      if (existing === undefined || PRIORITY[s.durum] > PRIORITY[existing]) lines.set(s.satir, s.durum);
    }
    const failed = run.ifadeler.find((s) => s.hata);
    return { lines, error: failed?.hata ? { bas: failed.hata.bas, bit: failed.hata.bit } : null };
  }, [run, script]);

  const goToLine = useCallback((line: number) => editor.current?.goToLine(line), []);

  return (
    <div className="script-ekrani">
      <section aria-label="Hedef" className={`hedef-basligi${prod ? ' prod' : ''}`}>
        {target ? (
          <>
            <span
              className="hedef-noktasi"
              data-testid="hedef-noktasi"
              style={{ backgroundColor: target.connection.color ?? 'transparent' }}
              aria-hidden="true"
            />
            <h2 className="hedef-adi">
              {target.connection.name} <span className="soluk">/</span> {target.database}
            </h2>
            {target.connection.envTag && (
              <span className="ortam-rozeti" style={{ backgroundColor: target.connection.color ?? undefined }}>
                {target.connection.envTag}
              </span>
            )}
          </>
        ) : (
          <>
            <h2 className="hedef-adi soluk">Hedef seçilmedi</h2>
            <span className="soluk kucuk">Soldaki Veritabanı panelinden bir veritabanı seçin.</span>
          </>
        )}
        <button type="button" className="hedef-degistir" onClick={onChangeTarget}>
          hedefi değiştir ▾
        </button>
      </section>
      <div className="script-govde">
        <div className="script-sol">
          <section aria-label="Script editörü" className="editor-alani">
            <ScriptEditoru ref={editor} value={script} onChange={setScript} readOnly={busy} marks={marks} />
          </section>
          <div className="script-cubugu">
            {running ? (
              <button type="button" className="tehlikeli" onClick={() => request('iptal')} disabled={run.bekleyenIstek === 'iptal'}>
                ■ İptal
              </button>
            ) : (
              <button type="button" className="birincil" onClick={start} disabled={!target || busy || !hasStatements}>
                ▶ Çalıştır
              </button>
            )}
          </div>
        </div>
        <aside aria-label="Çalıştırma" className="calistirma-sutunu">
          <KararKarti run={run} deadline={run?.evre === 'karar' ? deadline : null} onRequest={request} />
          <div role="tablist" className="sekmeler">
            <button type="button" role="tab" aria-selected="true" className="sekme secili">
              Log
            </button>
          </div>
          <div role="tabpanel" aria-label="Log" className="ifade-listesi">
            {run ? (
              <ol className="ifade-kartlari">
                {run.ifadeler.map((s) => (
                  <IfadeKarti key={s.i} statement={s} onGoTo={goToLine} />
                ))}
              </ol>
            ) : (
              <p className="soluk kucuk">Script çalıştırılınca ifadeler burada listelenir.</p>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

/** Geri sayımı saniyede bir yeniler; süre yoksa `null`. */
function useCountdown(deadline: DecisionTimer | null): { kalanMs: number; evre: DecisionPhase } | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!deadline) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [deadline]);
  return deadline ? decisionStatus(deadline, now) : null;
}

function KararKarti({
  run,
  deadline,
  onRequest,
}: {
  run: RunView | null;
  deadline: DecisionTimer | null;
  onRequest: (type: 'commit' | 'rollback' | 'uzat') => void;
}) {
  const remaining = useCountdown(deadline);
  let body;
  if (!run) body = <p className="soluk kucuk">Henüz çalıştırma yok.</p>;
  else if (run.evre === 'calisiyor') {
    const finished = run.ifadeler.filter((s) => s.durum === 'basarili').length;
    body = (
      <p className="kucuk">
        Çalışıyor… {finished}/{run.ifadeler.length} ifade
      </p>
    );
  } else if (run.evre === 'karar') {
    // Süre dolunca sunucunun geri almasını beklerken düğmeler kapalı.
    const expired = remaining?.evre === 'doldu';
    const pending = run.bekleyenIstek !== null || expired;
    const counting = remaining !== null && remaining.evre !== 'bekliyor';
    body = (
      <>
        <p className="karar-sorusu">
          {run.commitEdilebilir ? 'Script bitti. Commit ya da rollback?' : 'Hata alındı; transaction yalnızca geri alınabilir.'}
        </p>
        {counting && (
          <p className="geri-sayim kucuk">
            {expired ? 'Süre doldu; transaction geri alınıyor…' : 'Karar süresi doluyor:'}{' '}
            <span role="timer" aria-label="Kalan karar süresi">
              {formatRemaining(remaining.kalanMs)}
            </span>
          </p>
        )}
        <div className="karar-dugmeleri">
          {run.commitEdilebilir && (
            <button type="button" className="birincil" onClick={() => onRequest('commit')} disabled={pending}>
              Commit
            </button>
          )}
          <button type="button" onClick={() => onRequest('rollback')} disabled={pending}>
            Rollback
          </button>
          {counting && (
            <button type="button" onClick={() => onRequest('uzat')} disabled={pending}>
              Uzat
            </button>
          )}
        </div>
      </>
    );
  } else {
    body = <p className={`karar-sonucu ${run.sonuc}`}>{resultText(run)}</p>;
  }
  return (
    <section aria-label="Karar" className={`karar-karti${run?.evre === 'karar' ? ' bekliyor' : ''}`}>
      {body}
      {run?.uyari && (
        <p role="alert" className="uyari kucuk">
          {run.uyari}
        </p>
      )}
    </section>
  );
}

function resultText(run: RunView): string {
  switch (run.sonuc) {
    case 'commit':
      return 'Commit edildi';
    case 'rollback':
      return 'Geri alındı (rollback)';
    case 'iptal':
      return 'İptal edildi; transaction geri alındı';
    case 'sureDoldu':
      return run.mesaj ?? 'Süre doldu; transaction geri alındı';
    default:
      return run.mesaj ?? 'Çalıştırma başarısız';
  }
}

function IfadeKarti({ statement: s, onGoTo }: { statement: StatementView; onGoTo: (line: number) => void }) {
  return (
    <li className={`ifade-karti ${s.durum}`}>
      <button type="button" className="ifade-karti-basligi" onClick={() => onGoTo(s.satir)}>
        <span className={`ifade-isareti ${s.durum}`} aria-hidden="true">
          {STATUS_SYMBOLS[s.durum]}
        </span>
        <span className="komut-etiketi">{s.komut}</span>
        <span className="soluk">satır {s.satir}</span>
        {s.ms !== undefined && <span className="soluk sure">{s.ms} ms</span>}
      </button>
      <StatementDetail statement={s} />
    </li>
  );
}

function StatementDetail({ statement: s }: { statement: StatementView }) {
  switch (s.durum) {
    case 'sirada':
    case 'calisiyor':
    case 'calistirilmadi':
      return <p className="soluk kucuk">{STATUS_LABELS[s.durum]}</p>;
    case 'hatali':
      return (
        <p className="ifade-hatasi kucuk">
          {s.hata?.sqlstate && <code>{s.hata.sqlstate}</code>} {s.hata?.mesaj}
        </p>
      );
    case 'basarili':
      if (s.onizleme) {
        const total = s.rowCount ?? s.onizleme.satirlar.length;
        return (
          <>
            <p className="kucuk">
              {total} satır{total > PREVIEW_ROWS && <span className="soluk"> · ilk {PREVIEW_ROWS} satır gösteriliyor</span>}
            </p>
            {s.onizleme.kolonlar.length > 0 && <Onizleme preview={s.onizleme} />}
          </>
        );
      }
      return s.rowCount === null || s.rowCount === undefined ? null : <p className="kucuk">{s.rowCount} satır etkilendi</p>;
  }
}

function Onizleme({ preview }: { preview: NonNullable<StatementView['onizleme']> }) {
  return (
    <div className="onizleme">
      <table>
        <thead>
          <tr>
            {preview.kolonlar.map((k, i) => (
              <th key={i} scope="col">
                {k}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {preview.satirlar.map((row, r) => (
            <tr key={r}>
              {row.map((v, c) => (
                <td key={c}>{v === null ? <span className="null">NULL</span> : v}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
