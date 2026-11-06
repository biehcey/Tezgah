import type { ReactNode } from 'react';
import {
  STEP_LABELS,
  STEP_SECTION,
  testSummary,
  type ConnectionTestResponse,
  type FixId,
  type TestSection,
  type TestStep,
} from '../../core/baglanti-testi';

/** Formdaki test durumu: sürüyor ya da son yanıt. */
export type TestState = { durum: 'calisiyor' } | { durum: 'bitti'; yanit: ConnectionTestResponse } | { durum: 'basarisiz'; hata: string };

export const FIX_LABELS: Record<FixId, string> = {
  tekrarDene: 'Tekrar dene',
  hostuDuzelt: "Host'u düzelt",
  portuDuzelt: "Port'u düzelt",
  kullaniciyiDuzelt: 'Kullanıcıyı düzelt',
  sifreyiDuzelt: 'Şifreyi düzelt',
  sifreGir: 'Şifre gir',
  veritabaniniDuzelt: 'Veritabanını düzelt',
  postgresKullan: 'postgres kullan',
  requireYap: 'require yap',
  caDosyasiSec: 'CA dosyası seç',
  verifyCaDene: 'verify-ca dene',
  sshHostuDuzelt: "SSH host'unu düzelt",
  sshPortuDuzelt: 'SSH portunu düzelt',
  sshKullaniciyiDuzelt: 'SSH kullanıcısını düzelt',
  sshSirriDuzelt: 'SSH şifresini/passphrase’i düzelt',
  anahtarDosyasiniDuzelt: 'Anahtar dosyasını düzelt',
  agentYolunuDuzelt: 'Agent yolunu düzelt',
};

const ICONS = { basarili: '✓', uyari: '⚠', hata: '✗', calistirilmadi: '·' } as const;

/** Formun tepesindeki tek satırlık özet. */
export function TestOzeti({ state }: { state: TestState }) {
  let text: string;
  let tone: 'calisiyor' | 'basarili' | 'uyari' | 'hata';
  if (state.durum === 'calisiyor') {
    text = 'Test ediliyor…';
    tone = 'calisiyor';
  } else if (state.durum === 'basarisiz') {
    text = `Test çalıştırılamadı: ${state.hata}`;
    tone = 'hata';
  } else {
    const summary = testSummary(state.yanit.adimlar);
    const server = state.yanit.sunucu
      ? ` · PostgreSQL ${state.yanit.sunucu.surum} · ${state.yanit.sunucu.veritabaniSayisi} veritabanı`
      : '';
    tone = summary.sonuc;
    if (summary.sonuc === 'hata') text = `${ICONS.hata} ${STEP_LABELS[summary.adim!]} adımında başarısız`;
    else if (summary.sonuc === 'uyari') {
      text = `${ICONS.uyari} Bağlantı başarılı, uyarıyla (${STEP_LABELS[summary.adim!]})${server}`;
    } else text = `${ICONS.basarili} Bağlantı başarılı${server}`;
  }
  return (
    <p role="status" aria-label="Test sonucu" className={`test-ozeti ${tone}`}>
      {text}
    </p>
  );
}

/** Bir bölümün altındaki adım satırları; düzeltme düğmeleri yalnızca formun uygulayabildikleri. */
export function TestAdimlari({
  state,
  section,
  onFix,
  canFix,
  below,
}: {
  state: TestState | null;
  section: TestSection;
  onFix: (fix: FixId) => void;
  canFix: (fix: FixId) => boolean;
  /** Adım satırının altında gösterilecek ek içerik (ör. SSH adımının host anahtarı kutusu). */
  below?: (step: TestStep) => ReactNode;
}) {
  if (state?.durum !== 'bitti') return null;
  const steps = state.yanit.adimlar.filter((s) => STEP_SECTION[s.id] === section);
  if (steps.length === 0) return null;
  return (
    <ul aria-label="Test adımları" className="test-adimlari">
      {steps.map((s) => (
        <li key={s.id} data-adim={s.id} data-sonuc={s.sonuc} className={`test-adimi ${s.sonuc}`}>
          <span className="test-ikonu" aria-hidden="true">
            {ICONS[s.sonuc]}
          </span>
          <span>
            <strong>{STEP_LABELS[s.id]}</strong>
            {': '}
            {s.sonuc === 'calistirilmadi' ? <span className="soluk">çalıştırılmadı</span> : s.mesaj}
            {s.kod && s.sonuc !== 'basarili' && (
              <>
                {' '}
                <code>{s.kod}</code>
              </>
            )}
          </span>
          {s.oneriler.some(canFix) && (
            <span className="test-duzeltmeleri">
              {s.oneriler.filter(canFix).map((fix) => (
                <button key={fix} type="button" className="kucuk" onClick={() => onFix(fix)}>
                  {FIX_LABELS[fix]}
                </button>
              ))}
            </span>
          )}
          {below?.(s)}
        </li>
      ))}
    </ul>
  );
}

/** Kapalı SSL/TLS ya da SSH bölümünün özetindeki son adım sonucu. */
export function AdimDurumu({ state, step }: { state: TestState | null; step: 'tls' | 'ssh' }) {
  if (state?.durum !== 'bitti') return null;
  const found = state.yanit.adimlar.find((s) => s.id === step);
  if (!found || found.sonuc === 'calistirilmadi') return null;
  return <span className={`test-ikonu ${found.sonuc}`}> {ICONS[found.sonuc]}</span>;
}

export function TlsDurumu({ state }: { state: TestState | null }) {
  return <AdimDurumu state={state} step="tls" />;
}
