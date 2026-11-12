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

/**
 * Yapıştırılan TSV'nin hücre matrisi; `toTsv`'nin tersi. Satırlar `\n` ya da `\r\n` ile ayrılır,
 * sondaki satır sonu yeni satır açmaz (tablolama programları ekler). `"` ile başlayan hücre
 * tırnaklıdır: içteki `""` tek `"` olur, sekme ve satır sonu değerin parçasıdır. Boş hücre NULL;
 * `NULL` metni düz metindir; `""` boş metindir.
 */
export function parseTsv(text: string): (string | null)[][] {
  const rows: (string | null)[][] = [];
  if (text === '') return rows;
  let row: (string | null)[] = [];
  let i = 0;
  const atSeparator = () => i >= text.length || text[i] === '\t' || text[i] === '\n' || (text[i] === '\r' && text[i + 1] === '\n');
  for (;;) {
    let value = '';
    let quoted = false;
    if (text[i] === '"') {
      quoted = true;
      i++;
      while (i < text.length) {
        if (text[i] === '"' && text[i + 1] === '"') {
          value += '"';
          i += 2;
        } else if (text[i] === '"') {
          i++;
          break;
        } else value += text[i++];
      }
    }
    // Tırnaksız hücre; tırnaklıda kapanıştan sonra ayırıcıya kadar kalan (bozuk girdi) eklenir.
    while (!atSeparator()) value += text[i++];
    row.push(value === '' && !quoted ? null : value);
    if (text[i] === '\t') {
      i++;
      continue;
    }
    rows.push(row);
    row = [];
    if (i >= text.length) break;
    i += text[i] === '\r' ? 2 : 1;
    // Sondaki satır sonu yeni satır açmaz.
    if (i >= text.length) break;
  }
  return rows;
}
