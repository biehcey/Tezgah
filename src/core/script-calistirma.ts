/**
 * Script çalıştırmanın WebSocket sözleşmesi (wayfinder 06, ADR-0002) ve arayüzün olaylardan
 * kurduğu çalıştırma görünümü. Olaylar ifade indeksiyle gelir; indeksler `splitStatements`'in
 * aynı betik için verdiği sıradır.
 */
import { ACTIVE_SQL_TRANSACTION, NON_TRANSACTIONAL_FALLBACK, READ_ONLY_SQL_TRANSACTION, type ScriptAnalysis } from './calistirma-modu';
import type { FallbackReason } from './deneme';
import type { RowChanges, SchemaChange } from './deneme-farki';
import { splitStatements, positionOf, type Statement } from './ifade-bolme';
import type { Target } from './veritabani-secimi';

/** SELECT önizlemesinde ve Deneme modunun değişiklik önizlemesinde sunucudan çekilen en fazla satır. */
export const PREVIEW_ROWS = 100;

// ---------- İstemci → sunucu ----------

export type ClientMessage =
  /**
   * `yazmaModu`: prod hedefte yazma kilidi açık; prod olmayan hedefte etkisizdir. `deneme`: Deneme
   * modu; transaction sonunda karar beklenmeden her zaman geri alınır. `zorlaTransaction`: içerik
   * Okuma çıksa da Transaction modunda çalıştır (25006 sonrası); yalnızca bu yönde etkilidir.
   */
  | { type: 'run'; target: Target; script: string; yazmaModu: boolean; deneme: boolean; zorlaTransaction?: boolean }
  | { type: 'commit' }
  | { type: 'rollback' }
  /** Karar süresini baştan başlatır. */
  | { type: 'uzat' }
  | { type: 'iptal' };

export function parseClientMessage(raw: unknown): ClientMessage | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const m = raw as Record<string, unknown>;
  if (m.type === 'commit' || m.type === 'rollback' || m.type === 'uzat' || m.type === 'iptal') return { type: m.type };
  if (m.type !== 'run' || typeof m.script !== 'string') return null;
  const target = m.target as Record<string, unknown> | null | undefined;
  if (typeof target?.connectionId !== 'string' || typeof target.database !== 'string') return null;
  return {
    type: 'run',
    target: { connectionId: target.connectionId, database: target.database },
    script: m.script,
    // Yalnızca açıkça `true` yazma modudur; eksik ya da belirsiz değer salt okunur kalır.
    yazmaModu: m.yazmaModu === true,
    // Belirsiz değer Deneme sayılmaz; normal çalıştırma da karar bekler, kendiliğinden commit etmez.
    deneme: m.deneme === true,
    ...(m.zorlaTransaction === true && { zorlaTransaction: true }),
  };
}

// ---------- Sunucu → istemci ----------

/** Kolon adları ve metin olarak değerler (NULL `null`). */
export interface Preview {
  kolonlar: string[];
  satirlar: (string | null)[][];
}

/** Deneme modunda bir ifadenin değişiklik çıktısı (bkz. `done`). */
export interface DenemeOutput {
  degisiklik?: Preview;
  farkYok?: FallbackReason;
  fark?: RowChanges;
  sema?: SchemaChange[];
}

/**
 * Çalıştırmanın sonu. `sureDoldu`: Karar süresi doldu, transaction geri alındı. `hata`: çalıştırma
 * başlayamadı, bağlantı koptu ya da commit başarısız oldu. `autocommit`: Autocommit script'i bitti
 * ya da hatada durdu (ayrıntı `ozet`'te). `reddedildi`: script analizden geçmedi, hiçbir şey
 * çalışmadı. `deneme`: Deneme modu bitti ya da hatada durdu; transaction her durumda geri alındı.
 * `okuma`: Okuma script'inin transaction'ı kapandı (yeniden çalıştırma, kopma, Karar süresi ya da
 * hata); yazılan bir şey yoktu.
 */
export type RunResult = 'commit' | 'rollback' | 'sureDoldu' | 'iptal' | 'hata' | 'autocommit' | 'reddedildi' | 'deneme' | 'okuma';

/** Autocommit çalıştırmasının sonu: uygulananlar kalıcıdır. */
export interface AutocommitSummary {
  uygulandi: number;
  hatali: number;
  calistirilmadi: number;
}

/** `total` ifadeden `applied` tanesi uygulandı; `failed`: sonraki ifade hatayla (iptal dahil) durdu. */
export function autocommitSummary(total: number, applied: number, failed: boolean): AutocommitSummary {
  const hatali = failed ? 1 : 0;
  return { uygulandi: applied, hatali, calistirilmadi: total - applied - hatali };
}

/** "X ifade kalıcı uygulandı · 1 hatalı · Y çalıştırılmadı"; sıfır olan ekler yazılmaz. */
export function formatSummary({ uygulandi, hatali, calistirilmadi }: AutocommitSummary): string {
  const parts = [`${uygulandi} ifade kalıcı uygulandı`];
  if (hatali > 0) parts.push(`${hatali} hatalı`);
  if (calistirilmadi > 0) parts.push(`${calistirilmadi} çalıştırılmadı`);
  return parts.join(' · ');
}

export type ServerEvent =
  /** Sunucunun script analizi; her çalıştırmanın ilk olayı. */
  | ({ type: 'analiz' } & ScriptAnalysis)
  | { type: 'started'; i: number }
  /**
   * `onizleme`: ifadenin döndürdüğü satırlar (SELECT). Yalnızca Deneme modunda: `fark` PG18+ ve PK'lı
   * tabloda DML'in önce/sonra satırları; yoksa `degisiklik` DML'in `RETURNING` satırları ve
   * `farkYok` nedeni. `sema`: DDL'in dokunduğu tabloların ifadeden önceki ve sonraki şeması. Satırlar
   * en fazla 100; `rowCount` her durumda etkilenen satırların tamamıdır.
   */
  | ({ type: 'done'; i: number; rowCount: number | null; ms: number; komut: string; onizleme?: Preview } & DenemeOutput)
  | { type: 'error'; i: number; sqlstate: string | null; mesaj: string; satir: number; sutun: number; bas: number; bit: number; ms: number }
  /** Script bitti, transaction açık; hatadan sonra commit edilemez. `kalanMs`: Karar süresi. */
  | { type: 'kararBekleniyor'; commitEdilebilir: boolean; kalanMs: number }
  /**
   * Okuma script'i bitti; transaction yalnızca daha fazla satır çekilebilsin diye açık, karar
   * sorulmaz. `kalanMs` dolunca sunucu geri alır.
   */
  | { type: 'okumaAcik'; kalanMs: number }
  /** "Uzat" sunucuda işlendi; Karar süresi baştan başladı. */
  | { type: 'uzatildi'; kalanMs: number }
  /**
   * `ozet` yalnızca Autocommit'te. `kod: 'havuzDolu'`: hedefte `oturum` açık oturumla sınır doldu,
   * hiçbir şey çalışmadı; arayüz mesajı kendi bildiği açık sekmelerle kurar (`mesaj` yedektir).
   */
  | { type: 'bitti'; sonuc: RunResult; kod?: RunFailureCode; oturum?: number; mesaj?: string; ozet?: AutocommitSummary }
  /** İstek reddedildi ya da Çalıştırma kaydı yazılamadı; çalıştırma sürüyor. */
  | { type: 'uyari'; tur: 'commitReddedildi' | 'mesgul' | 'gecersizIstek' | 'kayitYazilamadi'; mesaj: string };

/** `bitti`'nin yapısal hata kodu. */
export type RunFailureCode = 'havuzDolu';

// ---------- Arayüzün görünümü ----------

export type StatementStatus = 'sirada' | 'calisiyor' | 'basarili' | 'hatali' | 'calistirilmadi';

export interface StatementView extends DenemeOutput {
  i: number;
  /** İfadenin başladığı 1 tabanlı satır. */
  satir: number;
  /** Sunucu dönmeden önce ilk anahtar kelime; sonra komut etiketi. */
  komut: string;
  durum: StatementStatus;
  ms?: number;
  rowCount?: number | null;
  onizleme?: Preview;
  hata?: {
    sqlstate: string | null;
    mesaj: string;
    satir: number;
    sutun: number;
    bas: number;
    bit: number;
    /** Hatanın nasıl giderileceği; ör. desende olmayan transaction dışı komut (`25001`). */
    ipucu?: string;
    /** Okuma deseni yanıldı (`25006`): Transaction modunda yeniden çalıştırma önerilir. */
    transactionOnerisi?: true;
  };
}

/** `okuma`: Okuma script'i bitti, transaction daha fazla satır için açık; karar beklenmez. */
export type RunPhase = 'calisiyor' | 'karar' | 'okuma' | 'bitti';

export interface RunView {
  script: string;
  /** Deneme modu: karar beklenmez, sonuç her zaman geri alınır. */
  deneme: boolean;
  /** Sunucunun analizinden; `analiz` gelene kadar yok. */
  mod?: ScriptAnalysis['mod'];
  reddedilenler?: ScriptAnalysis['reddedilenler'];
  ifadeler: StatementView[];
  evre: RunPhase;
  commitEdilebilir: boolean;
  /** İstemci commit/rollback/uzat/iptal gönderdi, yanıt bekleniyor. */
  bekleyenIstek: 'commit' | 'rollback' | 'uzat' | 'iptal' | null;
  /**
   * Sunucunun bildirdiği kalan Karar süresi; `surum` her bildirimde artar ki arayüz geri sayımı
   * o andan yeniden kursun. Yetkili sayaç sunucudadır.
   */
  kararSuresi?: { kalanMs: number; surum: number };
  sonuc?: RunResult;
  /** Yapısal hata kodu, ör. hedefte açık oturum sınırı doldu (`havuzDolu`). */
  kod?: RunFailureCode;
  /** `havuzDolu`'da hedefteki açık oturum sayısı (arayüzün bilmediği oturumlar dahil). */
  oturum?: number;
  mesaj?: string;
  ozet?: AutocommitSummary;
  /** Son reddedilen istek ya da uyarı. */
  uyari?: string;
  /** Çalıştırma kaydı yazılamadı; çalıştırma sürer, uyarı kalıcıdır. */
  kayitUyarisi?: string;
}

export function startRunView(script: string, { deneme = false }: { deneme?: boolean } = {}): RunView {
  return {
    script,
    deneme,
    ifadeler: splitStatements(script).map((s, i) => statementView(script, s, i)),
    evre: 'calisiyor',
    commitEdilebilir: false,
    bekleyenIstek: null,
  };
}

function statementView(script: string, s: Statement, i: number): StatementView {
  return { i, satir: positionOf(script, s.start).satir, komut: s.keywords[0] ?? s.text.slice(0, 12), durum: 'sirada' };
}

export function applyEvent(view: RunView, event: ServerEvent): RunView {
  const update = (i: number, patch: Partial<StatementView>) => ({
    ...view,
    ifadeler: view.ifadeler.map((s) => (s.i === i ? { ...s, ...patch } : s)),
  });
  switch (event.type) {
    case 'analiz':
      return { ...view, mod: event.mod, reddedilenler: event.reddedilenler };
    case 'started':
      return update(event.i, { durum: 'calisiyor' });
    case 'done':
      return update(event.i, {
        durum: 'basarili',
        komut: event.komut,
        ms: event.ms,
        rowCount: event.rowCount,
        onizleme: event.onizleme,
        degisiklik: event.degisiklik,
        farkYok: event.farkYok,
        fark: event.fark,
        sema: event.sema,
      });
    case 'error': {
      const { type: _t, i, ms, ...hata } = event;
      const ipucu = hata.sqlstate === ACTIVE_SQL_TRANSACTION ? NON_TRANSACTIONAL_FALLBACK : undefined;
      // Transaction modunda 25006 Yazma kilidinindir (salt okunur prod); öneri yalnızca Okuma'da.
      const oneri = view.mod === 'okuma' && hata.sqlstate === READ_ONLY_SQL_TRANSACTION;
      const next = update(i, {
        durum: 'hatali',
        ms,
        hata: { ...hata, ...(ipucu && { ipucu }), ...(oneri && { transactionOnerisi: true as const }) },
      });
      return { ...next, ifadeler: next.ifadeler.map((s) => (s.durum === 'sirada' ? { ...s, durum: 'calistirilmadi' } : s)) };
    }
    case 'kararBekleniyor':
      return { ...view, evre: 'karar', commitEdilebilir: event.commitEdilebilir, kararSuresi: nextTimer(view, event.kalanMs) };
    case 'okumaAcik':
      return { ...view, evre: 'okuma', kararSuresi: nextTimer(view, event.kalanMs) };
    case 'uzatildi':
      return { ...view, bekleyenIstek: null, kararSuresi: nextTimer(view, event.kalanMs) };
    case 'bitti':
      return {
        ...view,
        evre: 'bitti',
        bekleyenIstek: null,
        sonuc: event.sonuc,
        kod: event.kod,
        oturum: event.oturum,
        mesaj: event.mesaj,
        ozet: event.ozet,
        ifadeler: view.ifadeler.map((s) =>
          s.durum === 'sirada' || s.durum === 'calisiyor' ? { ...s, durum: 'calistirilmadi' } : s,
        ),
      };
    case 'uyari':
      // Kayıt uyarısı bir isteğin yanıtı değil; bekleyen isteğe dokunmaz.
      if (event.tur === 'kayitYazilamadi') return { ...view, kayitUyarisi: event.mesaj };
      return { ...view, bekleyenIstek: null, uyari: event.mesaj };
  }
}

function nextTimer(view: RunView, kalanMs: number): RunView['kararSuresi'] {
  return { kalanMs, surum: (view.kararSuresi?.surum ?? 0) + 1 };
}

/**
 * Editörün hedefi değiştirilebilir mi; değiştirilemiyorsa neden. Açık transaction'ın hedefi
 * başlıkta görünenle aynı kalmalı: script çalışırken ve karar beklenirken hedef kilitlidir.
 */
export function targetLock(view: RunView | null): string | null {
  switch (view?.evre) {
    case 'karar':
      return 'Commit/rollback kararı bekleniyor';
    case 'calisiyor':
      return 'Script çalışıyor';
    default:
      return null;
  }
}
