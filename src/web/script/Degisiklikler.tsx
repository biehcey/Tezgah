import { useMemo } from 'react';
import { DML_VERBS, FALLBACK_NOTES } from '../../core/deneme';
import { mergeChanges, type DiffRow, type SchemaLine, type TableDiff } from '../../core/deneme-farki';
import { PREVIEW_ROWS, type RunView, type StatementView } from '../../core/script-calistirma';

// Deneme modunun sonucu: Script ekranının ve Tablo sekmesinin "Dene"si aynı görünümü kullanır.

/** prod'da denemenin şeridi; sabit metin, kapatılamaz (wayfinder 20): rollback'in geri almadığı yan etkiler. */
export function DenemeProdUyarisi() {
  return (
    <div role="note" aria-label="Deneme yan etki uyarısı" className="uyari-seridi deneme-prod">
      ⚠ Deneme prod'da çalışır: satır kilitleri alır, sequence'ler ilerler (<code>nextval</code> geri alınmaz),
      tetikleyici/FDW/dblink dış etkileri geri alınmaz.
    </div>
  );
}

/**
 * Deneme modunun Değişiklikler sekmesi: hata varsa üstte hatalı satır ve SQLSTATE; altında hataya
 * kadar çalışan ifadelerin tabloya göre gruplanmış önce/sonra farkı ve DDL şema farkı. Önce/sonra
 * farkı alınamayan DML (PG18 öncesi, PK yok) nedenini söyleyen notla ifade başına önizlenir.
 */
export function Degisiklikler({ run }: { run: RunView }) {
  const failed = run.ifadeler.find((s) => s.hata);
  const tables = useMemo(() => mergeChanges(run.ifadeler), [run.ifadeler]);
  const fallbacks = run.ifadeler.filter((s) => s.degisiklik);
  // Tablo bölümleri ilk dokunan ifadenin, yedek kartları kendi ifadesinin sırasında durur.
  const blocks = [
    ...tables.map((t) => ({ i: t.ilk, node: <TabloFarki key={`t${t.tablo.oid}`} diff={t} /> })),
    ...fallbacks.map((s) => ({ i: s.i, node: <YedekKarti key={`s${s.i}`} statement={s} /> })),
  ].sort((a, b) => a.i - b.i);
  return (
    <>
      {failed?.hata && (
        <p role="alert" className="deneme-hatasi kucuk">
          Satır {failed.hata.satir}
          {failed.hata.sqlstate && <> · {failed.hata.sqlstate}</>} · {failed.hata.mesaj}
        </p>
      )}
      {blocks.map((b) => b.node)}
      {tables.length === 0 && fallbacks.length === 0 && !failed && (
        <p className="soluk kucuk">{run.evre === 'bitti' ? 'Değişiklik yok.' : 'DML ifadelerinin değiştirdiği satırlar burada görünür.'}</p>
      )}
    </>
  );
}

/** Önce/sonra farkı alınamayan DML: ifade başına `RETURNING` önizlemesi ve nedeni (ticket 14). */
function YedekKarti({ statement: s }: { statement: StatementView }) {
  return (
    <article className="degisiklik">
      <h3 className="degisiklik-basligi kucuk">
        {s.komut} · satır {s.satir} · {s.rowCount ?? s.degisiklik!.satirlar.length} satır {DML_VERBS[s.komut] ?? 'etkilendi'}
      </h3>
      {s.farkYok && (
        <p role="note" className="yedek-notu soluk kucuk">
          {FALLBACK_NOTES[s.farkYok]}
        </p>
      )}
      {(s.rowCount ?? 0) > PREVIEW_ROWS && <p className="soluk kucuk">ilk {PREVIEW_ROWS} satır gösteriliyor</p>}
      {s.degisiklik!.satirlar.length > 0 && <Onizleme preview={s.degisiklik!} />}
    </article>
  );
}

const ROW_SYMBOLS: Record<DiffRow['tur'], string> = { eklendi: '+', guncellendi: '~', silindi: '−' };
/** Şema satırı da satır farkıyla aynı renkleri kullanır. */
const SCHEMA_CLASSES: Record<SchemaLine['tur'], DiffRow['tur']> = { '+': 'eklendi', '~': 'guncellendi', '−': 'silindi' };

/** Bir tablonun bölümü: `+N eklendi · ~N güncellendi · −N silindi`, şema farkı ve satırlar. */
function TabloFarki({ diff }: { diff: TableDiff }) {
  // Yaklaşık sayılar `≈` ile başlar (bkz. `TableDiff.yaklasik`).
  const approx = diff.yaklasik ? '≈' : '';
  const counts = [
    diff.eklendi > 0 && <span className="eklendi">{approx}+{diff.eklendi} eklendi</span>,
    diff.guncellendi > 0 && <span className="guncellendi">{approx}~{diff.guncellendi} güncellendi</span>,
    diff.silindi > 0 && <span className="silindi">{approx}−{diff.silindi} silindi</span>,
  ].filter(Boolean);
  return (
    <section aria-label={diff.tablo.ad} className="degisiklik tablo-farki">
      <h3 className="degisiklik-basligi kucuk">
        <span className="tablo-adi">{diff.tablo.ad}</span>
        {counts.length > 0 && (
          <span className="fark-sayilari">
            {counts.map((c, i) => (
              <span key={i}>
                {i > 0 && ' · '}
                {c}
              </span>
            ))}
          </span>
        )}
      </h3>
      {diff.sema.length > 0 && (
        <ul aria-label="Şema farkı" className="sema-farki kucuk">
          {diff.sema.map((line, i) => (
            <li key={i} className={SCHEMA_CLASSES[line.tur]}>
              {line.tur} {line.metin}
            </li>
          ))}
        </ul>
      )}
      {diff.satirlar.length > 0 && (
        <div className="onizleme">
          <table className="fark-tablosu">
            <thead>
              <tr>
                <th scope="col" aria-label="Değişiklik" />
                {diff.kolonlar.map((k) => (
                  <th key={k} scope="col">
                    {k}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {diff.satirlar.map((row, r) => (
                <tr key={r} className={row.tur}>
                  <td className="fark-isareti">{ROW_SYMBOLS[row.tur]}</td>
                  {diff.kolonlar.map((k, c) => {
                    const value = (row.sonra ?? row.once)![c] ?? null;
                    if (!row.degisen.includes(k)) return <td key={k}>{cell(value)}</td>;
                    return (
                      <td key={k} className="degisti">
                        <del className="eski">{cell(row.once![c] ?? null)}</del>
                        {cell(value)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {diff.daha > 0 && <p className="soluk kucuk">… {diff.daha} satır daha</p>}
      {diff.yaklasik && (
        <p className="soluk kucuk">≈ İlk 100 satırdan sonrası sunucudan çekilmedi; aynı satıra birden çok ifade dokunduysa iki kez sayılmış olabilir.</p>
      )}
    </section>
  );
}

function cell(value: string | null) {
  return value === null ? <span className="null">NULL</span> : value;
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
                <td key={c}>{cell(v)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
