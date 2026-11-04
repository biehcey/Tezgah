import { isProd, type Connection } from '../../core/baglanti';

interface Props {
  /** Hedefin bağlantısı ve veritabanı; hedef seçilmediyse `null`. */
  target: { connection: Connection; database: string } | null;
}

/**
 * Script ekranı iskeleti (ticket 23 varyant B): üstte büyük hedef başlığı, altında editör alanı.
 * prod hedefte başlık kırmızımsıdır; uygulamanın kırmızı çerçevesi kökte verilir.
 */
export function ScriptEkrani({ target }: Props) {
  const prod = target !== null && isProd(target.connection.envTag);
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
      </section>
      <section aria-label="Script editörü" className="editor-alani" />
    </div>
  );
}
