import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { addColumn, addColumnWarnings, defaultFunctions, typeSuggestions, type NewColumn, type Volatility } from '../../core/kolon-ekle';
import type { Target } from '../../core/veritabani-secimi';
import { useApi } from '../api/client';

/** Varsayılan ifade yazılırken oynaklık bu kadar duraklamadan sonra sorulur. */
const VOLATILITY_DEBOUNCE_MS = 300;

const EMPTY: NewColumn = { ad: '', tip: '', notNull: false, varsayilan: '' };

interface Props {
  sema: string;
  tablo: string;
  /** Tablonun var olan kolonları (aynı adla kolon eklenemez). */
  kolonlar: readonly string[];
  /** Tabloda satır var (varsayılansız NOT NULL uyarısı; bkz. `tableHasRows`). */
  tablodaSatirVar: boolean;
  /** Katalogdaki kullanıcı tipleri; tip kutusu yaygın tiplerin ardından önerir. */
  kullaniciTipleri: readonly string[];
  /** Oynaklığın sorulacağı hedef; yoksa sorulmaz. */
  target: Target | null;
  /** Çalışma sürerken form kapatılamaz. */
  busy: boolean;
  /** Uygula/Dene/Konsola aktar çubuğu; `metin` doğrulamadan geçmediyse `null`. */
  eylemler: (metin: string | null) => ReactNode;
  onClose: () => void;
}

/**
 * "+ Kolon" formu (harita Q22): ad, tip (tamamlamalı), NOT NULL ve varsayılan ifade; `ALTER TABLE …
 * ADD COLUMN` önizlemesi her tuşta güncellenir. Uyarılar engellemez; doğrulama hataları engeller.
 */
export function KolonFormu({ sema, tablo, kolonlar, tablodaSatirVar, kullaniciTipleri, target, busy, eylemler, onClose }: Props) {
  const api = useApi();
  const id = useId();
  const [column, setColumn] = useState<NewColumn>(EMPTY);
  const set = (change: Partial<NewColumn>) => setColumn((c) => ({ ...c, ...change }));
  const { metin, hatalar } = addColumn({ sema, tablo, kolonlar }, column);
  const valid = Object.keys(hatalar).length === 0;
  const suggestions = useMemo(() => typeSuggestions(kullaniciTipleri), [kullaniciTipleri]);

  // Varsayılandaki fonksiyonların oynaklığı: yeni adlar duraklamadan sonra sunucuya sorulur.
  const [oynaklik, setOynaklik] = useState<Readonly<Record<string, Volatility>>>({});
  const [volatilityError, setVolatilityError] = useState(false);
  const asked = useRef(new Set<string>());
  /** Adlar tek metinde: efekt her tuşta değil, ad kümesi değişince yeniden kurulur. */
  const namesKey = defaultFunctions(column.varsayilan).join('\u0000');
  const connectionId = target?.connectionId;
  const database = target?.database;
  useEffect(() => {
    const missing = namesKey === '' ? [] : namesKey.split('\u0000').filter((n) => !asked.current.has(n));
    if (connectionId === undefined || database === undefined || missing.length === 0) return;
    const timer = setTimeout(() => {
      for (const n of missing) asked.current.add(n);
      api.functionVolatility(connectionId, database, missing).then(
        (r) => {
          setVolatilityError(false);
          setOynaklik((current) => ({ ...current, ...r.oynaklik }));
        },
        () => {
          // Ad kümesi yeniden değişince tekrar sorulur.
          for (const n of missing) asked.current.delete(n);
          setVolatilityError(true);
        },
      );
    }, VOLATILITY_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [api, namesKey, connectionId, database]);

  const warnings = addColumnWarnings(column, { oynaklik, tablodaSatirVar });
  /** Boş alanın hatası yazılmaz (düğmeler zaten kapalı); dolu alanın hatası altında görünür. */
  const shown = (alan: keyof typeof hatalar) => (column[alan].trim() === '' ? undefined : hatalar[alan]);
  const fieldError = (alan: keyof typeof hatalar) => shown(alan) && <span className="alan-hatasi">{shown(alan)}</span>;

  return (
    <section aria-label="Kolon ekle" className="kolon-formu">
      <h3 className="kucuk">
        Kolon ekle · {sema}.{tablo}
      </h3>
      <div className="alan">
        <label htmlFor={`${id}-ad`}>Kolon adı</label>
        <input id={`${id}-ad`} value={column.ad} onChange={(e) => set({ ad: e.target.value })} aria-invalid={Boolean(shown('ad'))} autoFocus />
        {fieldError('ad')}
      </div>
      <div className="alan">
        <label htmlFor={`${id}-tip`}>Tip</label>
        <input
          id={`${id}-tip`}
          list={`${id}-tipler`}
          value={column.tip}
          onChange={(e) => set({ tip: e.target.value })}
          aria-invalid={Boolean(shown('tip'))}
          placeholder="ör. text, timestamptz"
        />
        <datalist id={`${id}-tipler`}>
          {suggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
        {fieldError('tip')}
      </div>
      <div className="alan">
        <label className="kutu">
          <input type="checkbox" checked={column.notNull} onChange={(e) => set({ notNull: e.target.checked })} />
          NOT NULL
        </label>
      </div>
      <div className="alan">
        <label htmlFor={`${id}-varsayilan`}>Varsayılan ifade</label>
        <input
          id={`${id}-varsayilan`}
          value={column.varsayilan}
          onChange={(e) => set({ varsayilan: e.target.value })}
          aria-invalid={Boolean(shown('varsayilan'))}
          placeholder="ör. now(), 0, 'yeni'"
        />
        {fieldError('varsayilan')}
      </div>
      {warnings.length > 0 && (
        <ul aria-label="Uyarılar" className="kolon-uyarilari kucuk">
          {warnings.map((w) => (
            <li key={w}>⚠ {w}</li>
          ))}
        </ul>
      )}
      {volatilityError && <p className="soluk kucuk">Fonksiyon oynaklığı okunamadı; yeniden yazma uyarısı eksik olabilir.</p>}
      <section aria-label="ALTER önizlemesi" className="sql-onizlemesi">
        <pre className="uretilen-sql kucuk">{metin}</pre>
      </section>
      {eylemler(valid ? metin : null)}
      <div className="kolon-formu-alt">
        <button type="button" onClick={onClose} disabled={busy}>
          Vazgeç
        </button>
      </div>
    </section>
  );
}
