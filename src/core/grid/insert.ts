import { qualifiedName, quoteIdent, sqlLiteral, type TableName } from './sql';
import { typeName } from './tipler';

/** Konsol sonucunda tablo bilinmez; INSERT bu yer tutucuyla yazılır. */
export const PLACEHOLDER_TABLE: TableName = { ad: 'tablo' };

export interface InsertInput {
  tablo: TableName;
  kolonlar: readonly string[];
  /** Kolon tip OID'leri; yoksa ya da çözülmezse değer tipsiz literal olur. */
  tipler?: readonly number[];
  satirlar: readonly (readonly (string | null)[])[];
  /** Katalogdan gelen OID → ad eşlemesi (bkz. `typeName`). */
  katalog?: ReadonlyMap<number, string>;
}

/** Satır başına bir `INSERT INTO … (…) VALUES (…);`, satır sonuyla ayrılmış. */
export function insertStatements({ tablo, kolonlar, tipler, satirlar, katalog }: InsertInput): string {
  const head = `INSERT INTO ${qualifiedName(tablo)} (${kolonlar.map(quoteIdent).join(', ')}) VALUES`;
  const types = kolonlar.map((_, c) => (tipler?.[c] === undefined ? null : typeName(tipler[c], katalog)));
  return satirlar.map((row) => `${head} (${kolonlar.map((_, c) => sqlLiteral(row[c] ?? null, types[c])).join(', ')});`).join('\n');
}
