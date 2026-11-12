import { useEffect, useState } from 'react';
import { decisionStatus, formatRemaining, type DecisionPhase, type DecisionTimer } from '../../core/karar-suresi';
import type { SessionTab } from '../../core/konsol-sekmeleri';
import { formatSummary, type RunView } from '../../core/script-calistirma';

/**
 * Transaction'ın karar kartı: çalışırken ilerleme, karar beklenirken Commit/Rollback/Uzat ve Karar
 * süresi, bitince sonuç. Script ekranı ve Tablo sekmesinin "Uygula"sı aynı kartı kullanır.
 */

/** Geri sayımı saniyede bir yeniler; süre yoksa `null`. */
export function useCountdown(deadline: DecisionTimer | null): { kalanMs: number; evre: DecisionPhase } | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!deadline) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [deadline]);
  return deadline ? decisionStatus(deadline, now) : null;
}

export function KararKarti({
  run,
  deadline,
  onRequest,
  poolFullTabs = [],
  onGoToTab,
}: {
  run: RunView | null;
  deadline: DecisionTimer | null;
  onRequest: (type: 'commit' | 'rollback' | 'uzat') => void;
  /** `havuzDolu`'da listelenecek, aynı hedefte açık oturumu olan sekmeler; yoksa sunucunun mesajı. */
  poolFullTabs?: readonly SessionTab[];
  onGoToTab?: (id: string) => void;
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
  } else if (run.kod === 'havuzDolu' && poolFullTabs.length > 0) {
    // Sayı sunucudan (başka penceredeki oturumlar dahil); sekmeleri arayüz kendi bildiklerinden listeler.
    // Hiç bilmiyorsa sunucunun mesajı gösterilir.
    body = (
      <p className={`karar-sonucu ${run.sonuc}`}>
        Bu hedefte {Math.max(run.oturum ?? 0, poolFullTabs.length)} açık oturum var:{' '}
        {poolFullTabs.map((tab, i) => (
          <span key={tab.id}>
            {i > 0 && ', '}
            <button type="button" className="baglanti-dugme" onClick={() => onGoToTab?.(tab.id)}>
              {tab.ad}
            </button>
          </span>
        ))}
        . Birini bitirip tekrar deneyin.
      </p>
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
      {run?.kayitUyarisi && (
        <p role="status" className="uyari kucuk">
          ⚠ {run.kayitUyarisi}
        </p>
      )}
    </section>
  );
}

export function resultText(run: RunView): string {
  switch (run.sonuc) {
    case 'deneme':
      return run.ifadeler.some((s) => s.hata) ? 'Deneme hatada durdu; geri alındı' : 'Deneme geri alındı; hiçbir şey kalıcı yazılmadı';
    case 'commit':
      return 'Commit edildi';
    case 'rollback':
      return 'Geri alındı (rollback)';
    case 'autocommit':
      return run.ozet ? formatSummary(run.ozet) : 'Autocommit tamamlandı';
    case 'iptal':
      return run.ozet ? `İptal edildi · ${formatSummary(run.ozet)}` : 'İptal edildi; transaction geri alındı';
    case 'sureDoldu':
      return run.mesaj ?? 'Süre doldu; transaction geri alındı';
    case 'okuma':
      if (run.ifadeler.some((s) => s.hata)) return 'Okuma hatada durdu; transaction kapandı';
      return run.mesaj ?? "Okuma transaction'ı kapandı";
    default: {
      const mesaj = run.mesaj ?? 'Çalıştırma başarısız';
      return run.ozet ? `${mesaj} · ${formatSummary(run.ozet)}` : mesaj;
    }
  }
}
