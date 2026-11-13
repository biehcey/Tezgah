/**
 * Tablo sekmesinin "+ Kolon"u (harita Q22): `ALTER TABLE … ADD COLUMN` üretimi, doğrulaması ve
 * engellemeyen uyarıları. Kolon silme, yeniden adlandırma ve tip değiştirme kapsam dışı.
 */
import { qualifiedName, quoteIdent } from './grid/sql';
import { splitStatements } from './ifade-bolme';

/** Formdaki kolon; metinler kullanıcının yazdığı gibi (baştaki ve sondaki boşluk üretimde atılır). */
export interface NewColumn {
  ad: string;
  /** Olduğu gibi SQL'e girer, ör. `character varying(20)`, `int[]`. */
  tip: string;
  notNull: boolean;
  /** Varsayılan ifade; boşsa `DEFAULT` yok. */
  varsayilan: string;
}

/** Kolonun ekleneceği tablo ve var olan kolonları. */
export interface TargetTable {
  sema: string;
  tablo: string;
  kolonlar: readonly string[];
}

export type ColumnField = 'ad' | 'tip' | 'varsayilan';

export interface AddColumnResult {
  /** `ALTER TABLE "s"."t" ADD COLUMN "ad" tip [NOT NULL] [DEFAULT …];`; hata olsa da üretilir (önizleme). */
  metin: string;
  /** Alan başına engelleyen hata; boşsa çalıştırılabilir. */
  hatalar: Partial<Record<ColumnField, string>>;
}

const NOT_CLOSED = 'Tip ve varsayılan ifade kendi içinde kapanmalı: “;”, satır yorumu ya da kapanmamış tırnak/yorum olamaz.';

/**
 * Parça, ALTER'da ardından gelen metni bozmadan yerleşir mi: `;` ikinci ifade açmaz, satır yorumu
 * ya da kapanmamış dizge/yorum sonrakini yutmaz. Sınama: arkasına konan kelime aynı ifadenin son
 * çıplak kelimesi olarak görünmeli.
 */
function isClosedFragment(text: string): boolean {
  const statements = splitStatements(`${text} tezgah_son`);
  return statements.length === 1 && statements[0]!.words.at(-1) === 'TEZGAH_SON';
}

export function addColumn({ sema, tablo, kolonlar }: TargetTable, column: NewColumn): AddColumnResult {
  const ad = column.ad.trim();
  const tip = column.tip.trim();
  const varsayilan = column.varsayilan.trim();
  const parts = [`ALTER TABLE ${qualifiedName({ sema, ad: tablo })} ADD COLUMN ${quoteIdent(ad)}`];
  if (tip !== '') parts.push(tip);
  if (column.notNull) parts.push('NOT NULL');
  if (varsayilan !== '') parts.push(`DEFAULT ${varsayilan}`);

  const hatalar: AddColumnResult['hatalar'] = {};
  // Ad her zaman tırnaklanır: büyük/küçük harf farklı ad başka bir kolondur.
  if (ad === '') hatalar.ad = 'Kolon adı boş olamaz.';
  else if (kolonlar.includes(ad)) hatalar.ad = `“${ad}” kolonu tabloda zaten var.`;
  if (tip === '') hatalar.tip = 'Tip boş olamaz.';
  else if (!isClosedFragment(tip)) hatalar.tip = NOT_CLOSED;
  if (!isClosedFragment(varsayilan)) hatalar.varsayilan = NOT_CLOSED;
  return { metin: `${parts.join(' ')};`, hatalar };
}

/** `pg_proc.provolatile`: immutable, stable, volatile. */
export type Volatility = 'i' | 's' | 'v';

export interface WarningContext {
  /** Fonksiyon adı → oynaklık (sunucudan); bilinmeyen ad uyarı üretmez. */
  oynaklik: Readonly<Record<string, Volatility>>;
  /** Tablonun ilk sayfasında satır var. */
  tablodaSatirVar: boolean;
}

/**
 * Engellemeyen uyarılar: (a) varsayılan ifadede volatile fonksiyon → tablo yeniden yazılır;
 * (b) NOT NULL + varsayılan yok + tabloda satır var → Postgres hata verecek.
 */
export function addColumnWarnings(column: NewColumn, { oynaklik, tablodaSatirVar }: WarningContext): string[] {
  const warnings: string[] = [];
  const varsayilan = column.varsayilan.trim();
  const volatile = defaultFunctions(varsayilan).filter((ad) => Object.hasOwn(oynaklik, ad) && oynaklik[ad] === 'v');
  if (volatile.length > 0) {
    warnings.push(`Tablo yeniden yazılır: varsayılan ifadede volatile fonksiyon var (${volatile.join(', ')}). Büyük tabloda uzun sürer ve tabloyu kilitler.`);
  }
  if (column.notNull && varsayilan === '' && tablodaSatirVar) {
    warnings.push('Boş olmayan tabloda hata verecek: NOT NULL kolonun varsayılanı yok, var olan satırlar NULL kalır.');
  }
  return warnings;
}

/**
 * Varsayılansız NOT NULL uyarısı için tabloda satır var mı. Filtresiz ilk sayfa kesin söyler;
 * filtre hiçbir satırı tutmadıysa ya da sayfa yüklenmediyse (`satir: null`) tahmine (`reltuples`)
 * bakılır; tahmin bilinmiyorsa (`-1`) filtreli boş sayfada temkinli olarak var sayılır.
 */
export function tableHasRows({ satir, filtreli, tahmin }: { satir: number | null; filtreli: boolean; tahmin: number | null }): boolean {
  if (satir !== null && (satir > 0 || !filtreli)) return satir > 0;
  if (tahmin === null) return satir !== null;
  return tahmin !== 0;
}

/** Varsayılan ifadede çağrılan fonksiyon adları, ilk görülme sırasıyla ve tekrarsız (ifade bölücünün lexer'ıyla). */
export function defaultFunctions(expr: string): string[] {
  return [...new Set(splitStatements(expr).flatMap((s) => s.calls))];
}

/** Tip kutusunun sabit önerileri, en sık kullanılandan başlayarak. */
export const COMMON_TYPES: readonly string[] = [
  'text',
  'integer',
  'bigint',
  'smallint',
  'boolean',
  'numeric',
  'numeric(12,2)',
  'real',
  'double precision',
  'character varying(255)',
  'uuid',
  'date',
  'time',
  'timestamp',
  'timestamptz',
  'interval',
  'jsonb',
  'json',
  'bytea',
  'inet',
  'text[]',
  'integer[]',
];

/** Tip kutusunun önerileri: yaygın tipler, ardından katalogdaki kullanıcı tipleri (enum, domain…). */
export function typeSuggestions(userTypes: readonly string[]): string[] {
  return [...new Set([...COMMON_TYPES, ...userTypes])];
}

// --- Fonksiyon oynaklığı ucu ---

/** Bir istekte sorulabilecek en fazla ad. */
export const MAX_VOLATILITY_NAMES = 100;

/** `POST …/veritabanlari/:db/fonksiyon-oynakligi` gövdesi. */
export interface VolatilityRequest {
  fonksiyonlar: string[];
}

/** Yanıt: ad başına oynaklık; katalogda olmayan ad yanıtta yer almaz. Aşırı yüklemelerden en oynak olanı. */
export interface VolatilityResponse {
  oynaklik: Record<string, Volatility>;
}

export function parseVolatilityRequest(body: unknown): VolatilityRequest | null {
  if (typeof body !== 'object' || body === null) return null;
  const { fonksiyonlar } = body as Record<string, unknown>;
  if (!Array.isArray(fonksiyonlar) || fonksiyonlar.length > MAX_VOLATILITY_NAMES) return null;
  if (!fonksiyonlar.every((f): f is string => typeof f === 'string' && f !== '')) return null;
  return { fonksiyonlar };
}
