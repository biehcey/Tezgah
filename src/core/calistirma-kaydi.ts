/**
 * Çalıştırma kaydının satırları (wayfinder 22). Her çalıştırma aylık bir JSON Lines dosyasına aynı
 * `runId` ile iki satır yazar: başlarken `başladı`, bitişte `bitti`. `bitti` satırı olmayan kaydın
 * sonucu bilinmez (süreç çöktü, yazma başarısız oldu). Satır verisi (SELECT önizlemesi, deneme
 * farkı) kayda girmez: ifade özetinde yalnızca sayılar ve hata vardır.
 */
import type { EnvTag } from './baglanti';

/** Satır biçiminin sürümü; okurken daha yeni sürümlü satırlar atlanır. */
export const RECORD_VERSION = 1;

/** Kayıttaki sonuç; arayüzün `bitti` olayındaki sonuçtan ayrıdır (nedeni de söyler). */
export type RecordResult = 'commit' | 'rollback' | 'deneme-rollback' | 'karar-suresi-doldu' | 'kopma-rollback' | 'hata' | 'iptal';

/** Çalıştırma anındaki hedef; bağlantı sonradan değişse ya da silinse de kayıt okunabilir kalır. */
export interface TargetSnapshot {
  baglantiId: string;
  ad: string;
  veritabani: string;
  ortam: EnvTag | null;
}

/** prod hedefte yazma kilidinin durumu; prod olmayan hedefte `null`. */
export type WriteLockState = 'salt-okunur' | 'yazma-acik' | null;

export interface StartedLine {
  v: typeof RECORD_VERSION;
  tur: 'başladı';
  runId: string;
  /** ISO 8601 (UTC). */
  zaman: string;
  script: string;
  hedef: TargetSnapshot;
  mod: 'transaction' | 'autocommit';
  deneme: boolean;
  yazmaKilidi: WriteLockState;
}

/** Çalışan bir ifadenin özeti; çalıştırılmayan ifadeler yazılmaz. */
export interface StatementSummary {
  /** İfadenin script'teki başlangıç offset'i. */
  offset: number;
  ms: number;
  komut: string;
  /** Etkilenen ya da dönen satır sayısı; hatada ve bilinmeyende `null`. */
  satirSayisi: number | null;
  hata?: { kod: string | null; mesaj: string; satir: number };
}

export interface FinishedLine {
  v: typeof RECORD_VERSION;
  tur: 'bitti';
  runId: string;
  baslangic: string;
  bitis: string;
  sonuc: RecordResult;
  mesaj?: string;
  ifadeler: StatementSummary[];
}

export type RecordLine = StartedLine | FinishedLine;

export function startedLine(input: Omit<StartedLine, 'v' | 'tur' | 'zaman'> & { zaman: Date }): StartedLine {
  const { runId, zaman, script, hedef, mod, deneme, yazmaKilidi } = input;
  return { v: RECORD_VERSION, tur: 'başladı', runId, zaman: zaman.toISOString(), script, hedef, mod, deneme, yazmaKilidi };
}

export function finishedLine(
  input: Omit<FinishedLine, 'v' | 'tur' | 'baslangic' | 'bitis'> & { baslangic: Date; bitis: Date },
): FinishedLine {
  const { runId, baslangic, bitis, sonuc, mesaj, ifadeler } = input;
  return {
    v: RECORD_VERSION,
    tur: 'bitti',
    runId,
    baslangic: baslangic.toISOString(),
    bitis: bitis.toISOString(),
    sonuc,
    ...(mesaj !== undefined && { mesaj }),
    ifadeler,
  };
}

/** Dosyaya eklenecek metin: tek satır JSON. */
export function formatLine(line: RecordLine): string {
  return `${JSON.stringify(line)}\n`;
}

/** Çalıştırmanın başladığı ayın dosyası (yerel saat): `2026-11.jsonl`. */
export function historyFileName(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}.jsonl`;
}

export interface RunRecord {
  runId: string;
  sonuc: RecordResult | 'bilinmiyor';
  basladi: StartedLine;
  bitti: FinishedLine | null;
}

/**
 * Aylık dosyanın satırlarından kayıtlar, başlama sırasıyla. Bozuk, yarım yazılmış ya da daha yeni
 * sürümlü satırlar atlanır; `başladı` satırı olmayan `bitti` kayıt üretmez.
 */
export function parseRecords(text: string): RunRecord[] {
  const records = new Map<string, RunRecord>();
  for (const raw of text.split('\n')) {
    const line = parseLine(raw);
    if (!line) continue;
    if (line.tur === 'başladı') {
      if (!records.has(line.runId)) records.set(line.runId, { runId: line.runId, sonuc: 'bilinmiyor', basladi: line, bitti: null });
      continue;
    }
    const record = records.get(line.runId);
    if (record && !record.bitti) Object.assign(record, { sonuc: line.sonuc, bitti: line });
  }
  return [...records.values()];
}

function parseLine(raw: string): RecordLine | null {
  if (raw.trim() === '') return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const line = value as Partial<RecordLine>;
  if (line.v !== RECORD_VERSION || typeof line.runId !== 'string') return null;
  return line.tur === 'başladı' || line.tur === 'bitti' ? (line as RecordLine) : null;
}
