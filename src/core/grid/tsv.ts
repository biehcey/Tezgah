/**
 * Panoya kopyalanan aralığın başlıksız TSV'si. NULL boş yazılır; sekme, satır sonu ya da çift
 * tırnak içeren hücre Excel tarzında `"…"` içine alınır ve içteki `"` ikilenir.
 */
export function toTsv(rows: readonly (readonly (string | null)[])[]): string {
  return rows.map((row) => row.map(tsvCell).join('\t')).join('\n');
}

function tsvCell(value: string | null): string {
  if (value === null) return '';
  return /[\t\n\r"]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}
